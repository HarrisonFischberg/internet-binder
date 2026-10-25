import Foundation
import GRDB

/// The local half of iCloud sync, on top of the record store. It knows nothing about CloudKit:
/// `CloudSync` moves `SyncRecord`s between this and iCloud, and tests move them through a fake cloud.
///
/// Every write the shared code makes is marked pending (`RecordDatabase.upsert`/`delete`). Sending takes
/// a record with the revision it had (`outgoing`), and `markSent` clears it only if nothing changed
/// since. Records from iCloud are merged with the local copy and the base (`applyRemote`), written
/// without being marked, and marked again only when the merge kept something iCloud doesn't have yet.
public struct PendingChange: Hashable, Sendable {
    public let id: SyncID
    public let rev: Int64
}

public enum OutgoingChange: Equatable, Sendable {
    case save(SyncRecord, rev: Int64)
    case delete(SyncID, rev: Int64)
}

extension RecordDatabase {
    static func markPending(_ db: Database, store: String, key: String) throws {
        guard SyncID.syncs(store: store, key: key) else { return }
        try db.execute(sql: """
            INSERT INTO sync_pending (store, key, rev) VALUES (?, ?, 1)
            ON CONFLICT (store, key) DO UPDATE SET rev = rev + 1
            """, arguments: [store, key])
    }

    // MARK: sending

    public func pendingChanges() throws -> [PendingChange] {
        try pool.read { db in
            try Row.fetchAll(db, sql: "SELECT store, key, rev FROM sync_pending ORDER BY store, key").compactMap { row in
                SyncID(store: row["store"], key: row["key"]).map { PendingChange(id: $0, rev: row["rev"]) }
            }
        }
    }

    /// What to send for one record: its current body, or its deletion. Nil when it isn't pending.
    public func outgoing(_ id: SyncID) throws -> OutgoingChange? {
        try pool.read { db in
            guard let rev = try Int64.fetchOne(db, sql: "SELECT rev FROM sync_pending WHERE store = ? AND key = ?", arguments: [id.store, id.key]) else { return nil }
            guard let body = try localBody(db, id) else { return .delete(id, rev: rev) }
            return .save(try SyncRecord(id: id, stored: body), rev: rev)
        }
    }

    /// iCloud has `record` (or its deletion, when nil). Clears the pending mark unless the record changed again.
    public func markSent(_ id: SyncID, rev: Int64, record: SyncRecord?, system: Data?) throws {
        try pool.write { db in
            try db.execute(sql: "DELETE FROM sync_pending WHERE store = ? AND key = ? AND rev = ?", arguments: [id.store, id.key, rev])
            if let record {
                try setBase(db, id, body: try SyncJSON.hashedPictures(try record.stored(), store: id.store), system: system)
            } else {
                try db.execute(sql: "DELETE FROM sync_base WHERE store = ? AND key = ?", arguments: [id.store, id.key])
            }
        }
    }

    /// Marks a record to be sent again (CloudKit lost it, or the zone was reset).
    public func markPending(_ id: SyncID) throws {
        try pool.write { db in try Self.markPending(db, store: id.store, key: id.key) }
    }

    /// Marks every synced record, for the first sync or after iCloud lost the zone.
    public func markAllPending() throws {
        try pool.write { db in
            for (store, s) in Self.specs {
                for key in try String.fetchAll(db, sql: "SELECT key FROM \"\(s.table)\"") { try Self.markPending(db, store: store, key: key) }
            }
            if try localBody(db, SyncID.aiSettings) != nil { try Self.markPending(db, store: SyncID.aiSettings.store, key: SyncID.aiSettings.key) }
        }
    }

    // MARK: receiving

    public enum Applied: Equatable, Sendable {
        case unchanged     // the local copy already matched
        case updated       // written locally, iCloud is up to date
        case merged        // written locally and pending: the merge kept local changes iCloud needs
    }

    /// Merges a record from iCloud into the local copy. `system` is CloudKit's system fields for the
    /// version received, kept so the next send is an update rather than a conflict.
    @discardableResult
    public func applyRemote(_ remote: SyncRecord, system: Data?) throws -> Applied {
        let id = remote.id
        let remoteStored = try remote.stored()
        let remoteObj = try SyncJSON.object(remoteStored)
        return try pool.write { db in
            let localBody = try localBody(db, id)
            let pending = try Bool.fetchOne(db, sql: "SELECT 1 FROM sync_pending WHERE store = ? AND key = ?", arguments: [id.store, id.key]) ?? false
            let baseBody = try String.fetchOne(db, sql: "SELECT body FROM sync_base WHERE store = ? AND key = ?", arguments: [id.store, id.key])
            try setBase(db, id, body: try SyncJSON.hashedPictures(remoteStored, store: id.store), system: system)

            guard let localBody else {
                // Deleted here but not yet sent: the deletion stands and goes out next.
                if pending { return .merged }
                try writeLocal(db, id, body: remoteStored)
                return .updated
            }
            let localObj = try SyncJSON.object(localBody)
            if SyncJSON.same(localObj, remoteObj) {
                try db.execute(sql: "DELETE FROM sync_pending WHERE store = ? AND key = ?", arguments: [id.store, id.key])
                return .unchanged
            }
            guard pending else {
                try writeLocal(db, id, body: remoteStored)
                return .updated
            }
            let base = try baseBody.map { try SyncJSON.object($0) }
            let merged = SyncMerge.merge(id, base: base, local: localObj, remote: remoteObj)
            try writeLocal(db, id, body: try SyncJSON.text(merged))
            if SyncJSON.same(merged, remoteObj) {
                try db.execute(sql: "DELETE FROM sync_pending WHERE store = ? AND key = ?", arguments: [id.store, id.key])
                return .updated
            }
            try Self.markPending(db, store: id.store, key: id.key)
            return .merged
        }
    }

    /// iCloud deleted a record (the Trash was emptied on another device): it goes here too, even if
    /// it was edited here meanwhile.
    public func applyRemoteDeletion(_ id: SyncID) throws {
        let s = try spec(id.store)
        try pool.write { db in
            if id != SyncID.aiSettings { try delete(db, s, store: id.store, key: id.key, track: false) }
            for table in ["sync_pending", "sync_base", "sync_sealed"] {
                try db.execute(sql: "DELETE FROM \(table) WHERE store = ? AND key = ?", arguments: [id.store, id.key])
            }
        }
    }

    // MARK: CloudKit bookkeeping

    /// CloudKit's system fields for the last version of each record this device saw.
    public func systemFields(_ id: SyncID) throws -> Data? {
        try pool.read { db in try Data.fetchOne(db, sql: "SELECT system FROM sync_base WHERE store = ? AND key = ?", arguments: [id.store, id.key]) }
    }

    public func setSystemFields(_ id: SyncID, _ system: Data?) throws {
        try pool.write { db in
            try db.execute(sql: """
                INSERT INTO sync_base (store, key, system) VALUES (?, ?, ?)
                ON CONFLICT (store, key) DO UPDATE SET system = excluded.system
                """, arguments: [id.store, id.key, system])
        }
    }

    /// Forgets what iCloud had (signed out, zone deleted): the next sync starts from scratch.
    public func resetSyncBase() throws {
        try pool.write { db in try db.execute(sql: "DELETE FROM sync_base; DELETE FROM sync_sealed") }
    }

    /// Pictures that came sealed with a key this device doesn't have yet (iCloud Keychain still syncing).
    public func keepSealed(_ id: SyncID, _ data: Data) throws {
        try pool.write { db in
            try db.execute(sql: "INSERT OR REPLACE INTO sync_sealed (store, key, data) VALUES (?, ?, ?)", arguments: [id.store, id.key, data])
        }
    }

    public func sealedPictures() throws -> [(SyncID, Data)] {
        try pool.read { db in
            try Row.fetchAll(db, sql: "SELECT store, key, data FROM sync_sealed").compactMap { row in
                SyncID(store: row["store"], key: row["key"]).map { ($0, row["data"] as Data) }
            }
        }
    }

    /// Puts pictures that could finally be opened back into their save, unless it changed since.
    public func restorePictures(_ id: SyncID, _ pictures: [String]) throws {
        let s = try spec(id.store)
        try pool.write { db in
            try db.execute(sql: "DELETE FROM sync_sealed WHERE store = ? AND key = ?", arguments: [id.store, id.key])
            guard let body = try String.fetchOne(db, sql: "SELECT body FROM \"\(s.table)\" WHERE key = ?", arguments: [id.key]) else { return }
            let filled = try SyncRecord(id: id, body: body, pictures: pictures).stored()
            try upsert(db, s, store: id.store, body: filled, track: false)
        }
    }

    public func syncState(_ key: String) throws -> Data? {
        try pool.read { db in try Data.fetchOne(db, sql: "SELECT value FROM sync_state WHERE key = ?", arguments: [key]) }
    }

    public func setSyncState(_ key: String, _ value: Data?) throws {
        try pool.write { db in
            if let value { try db.execute(sql: "INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)", arguments: [key, value]) }
            else { try db.execute(sql: "DELETE FROM sync_state WHERE key = ?", arguments: [key]) }
        }
    }

    /// The record as stored here; the AI settings come out of the settings as `{key, value}`.
    func localBody(_ db: Database, _ id: SyncID) throws -> String? {
        if id == SyncID.aiSettings {
            guard let text = try String.fetchOne(db, sql: "SELECT value FROM setting WHERE key = ?", arguments: [Self.settingsKey]),
                  let ai = (try SyncJSON.object(text))["ai"] as? [String: Any] else { return nil }
            return try SyncJSON.text(["key": id.key, "value": ai])
        }
        let s = try spec(id.store)
        return try String.fetchOne(db, sql: "SELECT body FROM \"\(s.table)\" WHERE key = ?", arguments: [id.key])
    }

    /// Writes a record from iCloud without marking it pending.
    func writeLocal(_ db: Database, _ id: SyncID, body: String) throws {
        if id == SyncID.aiSettings {
            let text = try String.fetchOne(db, sql: "SELECT value FROM setting WHERE key = ?", arguments: [Self.settingsKey])
            var settings = try text.map { try SyncJSON.object($0) } ?? [:]
            settings["ai"] = (try SyncJSON.object(body))["value"] ?? [:]
            try db.execute(sql: "INSERT OR REPLACE INTO setting (key, value) VALUES (?, ?)", arguments: [Self.settingsKey, try SyncJSON.text(settings)])
            return
        }
        try upsert(db, try spec(id.store), store: id.store, body: body, track: false)
    }

    /// Whether writing `value` as the settings changes the synced AI settings.
    static func aiSettingsChanged(_ db: Database, to value: Any) throws -> Bool {
        let old = try String.fetchOne(db, sql: "SELECT value FROM setting WHERE key = ?", arguments: [settingsKey]).map { try SyncJSON.object($0)["ai"] }
        return !SyncJSON.same(old ?? nil, (value as? [String: Any])?["ai"])
    }

    /// Forgets everything about iCloud on this device (sync turned off, or the library erased): nothing
    /// pending, no base, no engine state. The library itself stays.
    public func resetSync() throws {
        try pool.write { db in
            try db.execute(sql: "DELETE FROM sync_pending; DELETE FROM sync_base; DELETE FROM sync_sealed; DELETE FROM sync_state")
        }
    }

    private func setBase(_ db: Database, _ id: SyncID, body: String, system: Data?) throws {
        try db.execute(sql: """
            INSERT INTO sync_base (store, key, body, system) VALUES (?, ?, ?, ?)
            ON CONFLICT (store, key) DO UPDATE SET body = excluded.body, system = COALESCE(excluded.system, sync_base.system)
            """, arguments: [id.store, id.key, body, system])
    }
}
