import Foundation
import GRDB

/// iCloud sync for Safari on the Mac. The extension keeps its library in the browser's IndexedDB, which
/// native code can't read, so the Mac app's extension handler keeps a copy (a `RecordDatabase` with
/// `recordsOutbound` on) that `CloudSync` syncs exactly as on the iPhone. The extension's background
/// (keepsake/src/shared/syncBridge.js) moves records in and out of it over native messaging:
///
///   push  `receive`: the extension's changes, written here as local changes (so they go to iCloud)
///   pull  `outbound`: what came from iCloud since the extension's cursor, read from `sync_outbound`
///   off   `forget`: sync was turned off in Safari; the copy and everything about iCloud go
///
/// Bodies travel as JSON objects; a deletion is a null body.
public enum ExtensionMirror {
    static let batchBytes = 4 * 1024 * 1024

    /// Writes the extension's changes and returns the ones taken, as `{store, key, rev}` for its journal.
    ///
    /// A record that came from iCloud after `cursor` (so the extension never saw it) is merged rather
    /// than overwritten, three-way against the version the extension last took (`sync_ext_base`), as two
    /// devices merge: each side's changes kept, learned words added once. The extension gets the merged
    /// record on its next pull.
    public static func receive(_ changes: [[String: Any]], cursor: Int64, into db: RecordDatabase) throws -> [[String: Any]] {
        var acked: [[String: Any]] = []
        try takeOffers(upTo: cursor, in: db)
        let unseen = Set(try db.pool.read { d in
            try Row.fetchAll(d, sql: "SELECT store, key FROM sync_outbound WHERE seq > ?", arguments: [cursor]).map { "\($0["store"] as String)\u{0}\($0["key"] as String)" }
        })
        for change in changes {
            guard let store = change["store"] as? String, let key = change["key"] as? String, let id = SyncID(store: store, key: key) else { continue }
            let body = change["body"] as? [String: Any]
            if id == SyncID.aiSettings {
                var settings = try db.settings([RecordDatabase.settingsKey])[RecordDatabase.settingsKey] as? [String: Any] ?? [:]
                settings["ai"] = body?["value"] ?? [:]
                try db.setSettings([RecordDatabase.settingsKey: settings])
            } else if var body {
                let theirs = try SyncJSON.text(body)
                if unseen.contains("\(store)\u{0}\(key)"), let mine = try db.get(store, key) {
                    let base = try db.pool.read { d in try String.fetchOne(d, sql: "SELECT body FROM sync_ext_base WHERE store = ? AND key = ?", arguments: [store, key]) }
                    body = SyncMerge.merge(id, base: try base.map { try SyncJSON.object($0) }, local: body, remote: try SyncJSON.object(mine))
                }
                try db.put(store, bodies: [try SyncJSON.text(body)])
                try setBase(store, key, theirs, in: db)
            } else {
                try db.remove(store, keys: [key])
                try setBase(store, key, nil, in: db)
            }
            acked.append(["store": store, "key": key, "rev": change["rev"] ?? 0])
        }
        return acked
    }

    /// Records that came from iCloud after `cursor`, each once with its current body, a few megabytes at a
    /// time. Rows up to `cursor` were taken by the extension and are dropped. A cursor of 0 (the extension
    /// starting over) queues the whole copy first.
    public static func outbound(after cursor: Int64, from db: RecordDatabase) throws -> (changes: [[String: Any]], cursor: Int64, more: Bool) {
        try takeOffers(upTo: cursor, in: db)
        try db.pool.write { d in
            try d.execute(sql: "DELETE FROM sync_outbound WHERE seq <= ?", arguments: [cursor])
            if cursor == 0 {
                for (store, spec) in RecordDatabase.specs {
                    for key in try String.fetchAll(d, sql: "SELECT key FROM \"\(spec.table)\"") where SyncID.syncs(store: store, key: key) {
                        try d.execute(sql: "INSERT INTO sync_outbound (store, key) VALUES (?, ?)", arguments: [store, key])
                    }
                }
                if try db.localBody(d, SyncID.aiSettings) != nil {
                    try d.execute(sql: "INSERT INTO sync_outbound (store, key) VALUES (?, ?)", arguments: [SyncID.aiSettings.store, SyncID.aiSettings.key])
                }
            }
        }
        return try db.pool.write { d in
            var rows: [(seq: Int64, id: SyncID)] = []
            var seen: [SyncID: Int] = [:]
            for row in try Row.fetchAll(d, sql: "SELECT seq, store, key FROM sync_outbound WHERE seq > ? ORDER BY seq", arguments: [cursor]) {
                guard let id = SyncID(store: row["store"], key: row["key"]) else { continue }
                // A record written twice goes once, at its later place.
                if let at = seen[id] { rows[at].seq = row["seq"]; continue }
                seen[id] = rows.count
                rows.append((row["seq"], id))
            }
            rows.sort { $0.seq < $1.seq }
            var changes: [[String: Any]] = []
            var size = 0
            var last = cursor
            for (i, row) in rows.enumerated() {
                let text = try db.localBody(d, row.id)
                if !changes.isEmpty, size + (text?.utf8.count ?? 0) > batchBytes {
                    // The rest waits for the next pull; rows before the next one are all taken.
                    return (changes, rows[i - 1].seq, true)
                }
                size += text?.utf8.count ?? 0
                try d.execute(sql: "INSERT OR REPLACE INTO sync_ext_offer (store, key, seq, body) VALUES (?, ?, ?, ?)",
                              arguments: [row.id.store, row.id.key, row.seq, try text.map { try SyncJSON.hashedPictures($0, store: row.id.store) }])
                let body: Any = try text.map { try SyncJSON.object($0) } ?? NSNull()
                changes.append(["seq": row.seq, "store": row.id.store, "key": row.id.key, "body": body])
                last = row.seq
            }
            let top = try Int64.fetchOne(d, sql: "SELECT MAX(seq) FROM sync_outbound") ?? last
            return (changes, max(last, top), false)
        }
    }

    /// Records the extension skipped in a pull because it had edited them meanwhile: logged again, so
    /// they count as unseen when that edit is pushed (`receive` merges) and go back in the next pull.
    public static func hold(_ changes: [[String: Any]], in db: RecordDatabase) throws {
        try db.pool.write { d in
            for change in changes {
                guard let store = change["store"] as? String, let key = change["key"] as? String, SyncID.syncs(store: store, key: key) else { continue }
                try d.execute(sql: "INSERT INTO sync_outbound (store, key) VALUES (?, ?)", arguments: [store, key])
                // Not taken: the extension's base stays the version it had before.
                try d.execute(sql: "DELETE FROM sync_ext_offer WHERE store = ? AND key = ?", arguments: [store, key])
            }
        }
    }

    /// The extension has taken everything handed over up to `cursor` (it asks with that cursor only after
    /// writing them): those versions are its base now.
    static func takeOffers(upTo cursor: Int64, in db: RecordDatabase) throws {
        try db.pool.write { d in
            try d.execute(sql: "INSERT OR REPLACE INTO sync_ext_base (store, key, body) SELECT store, key, body FROM sync_ext_offer WHERE seq <= ? AND body IS NOT NULL", arguments: [cursor])
            try d.execute(sql: "DELETE FROM sync_ext_base WHERE (store, key) IN (SELECT store, key FROM sync_ext_offer WHERE seq <= ? AND body IS NULL)", arguments: [cursor])
            try d.execute(sql: "DELETE FROM sync_ext_offer WHERE seq <= ?", arguments: [cursor])
        }
    }

    /// The version the extension holds now (it just sent it).
    static func setBase(_ store: String, _ key: String, _ body: String?, in db: RecordDatabase) throws {
        try db.pool.write { d in
            if let body {
                try d.execute(sql: "INSERT OR REPLACE INTO sync_ext_base (store, key, body) VALUES (?, ?, ?)",
                              arguments: [store, key, try SyncJSON.hashedPictures(body, store: store)])
            } else {
                try d.execute(sql: "DELETE FROM sync_ext_base WHERE store = ? AND key = ?", arguments: [store, key])
            }
        }
    }

    /// Sync was turned off in Safari: the copy, the log and everything about iCloud go. Turning it on
    /// again sends the extension's whole library back.
    public static func forget(_ db: RecordDatabase) throws {
        try db.clear(Array(RecordDatabase.specs.keys))
        try db.removeSettings([RecordDatabase.settingsKey])
        try db.resetSync()
        try db.pool.write { d in try d.execute(sql: "DELETE FROM sync_outbound; DELETE FROM sync_ext_base; DELETE FROM sync_ext_offer") }
    }
}

extension RecordDatabase {
    func noteOutbound(_ db: Database, store: String, key: String) throws {
        guard recordsOutbound, SyncID.syncs(store: store, key: key) else { return }
        try db.execute(sql: "INSERT INTO sync_outbound (store, key) VALUES (?, ?)", arguments: [store, key])
    }
}
