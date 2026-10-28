import Foundation
import GRDB
import os

/// Internet Binder's local store on Apple devices: SQLite (GRDB, WAL) in the App Group container, shared by
/// the app, the Share Extension and the widgets.
///
/// Each record is kept exactly as the shared store wrote it (`body`, JSON), so a Chrome export comes
/// back out byte-for-byte equivalent. Columns beside the body are copies of the fields the app queries
/// and sync needs (id, kind, collection, timestamps); they are derived from the body on every write
/// and never edited on their own. Content stays inside `body`, metadata in columns: the split
/// `replica/m3/sync-bridge.md` asks for, so sync can seal the body and leave the columns readable.
public final class RecordDatabase: @unchecked Sendable {
    public let pool: DatabasePool
    let secrets: SecretStore
    private let writeHook = OSAllocatedUnfairLock<(@Sendable () -> Void)?>(initialState: nil)

    /// Runs after each write the shared code makes that iCloud sync carries (CloudSync queues a send).
    public var onLocalWrite: (@Sendable () -> Void)? {
        get { writeHook.withLock { $0 } }
        set { writeHook.withLock { $0 = newValue } }
    }

    func wroteLocally() { onLocalWrite?() }

    /// The Mac app's copy of the Safari extension's library: logs every record written from iCloud in
    /// `sync_outbound` for the extension to pull (`ExtensionMirror`). Set once, before syncing starts.
    public var recordsOutbound = false

    /// The stores of the shared schema (keepsake/src/shared/db.js) and the columns copied out of each body.
    struct StoreSpec {
        let table: String
        let keyField: String
        let columns: [String: String] // name → SQLite type
        let indexes: [String]
    }

    static let specs: [String: StoreSpec] = [
        "items": StoreSpec(table: "item", keyField: "id", columns: [
            "kind": "TEXT", "collectionId": "TEXT", "urlKey": "TEXT", "status": "TEXT", "favorite": "INTEGER",
            "purchased": "INTEGER", "captureState": "TEXT", "needsReview": "INTEGER", "title": "TEXT", "host": "TEXT",
            "createdAt": "TEXT", "updatedAt": "TEXT", "deletedAt": "TEXT", "openedAt": "TEXT",
        ], indexes: ["urlKey", "collectionId", "kind", "createdAt", "deletedAt"]),
        "collections": StoreSpec(table: "collection", keyField: "id", columns: [
            "name": "TEXT", "pinned": "INTEGER", "sortOrder": "REAL", "createdAt": "TEXT", "updatedAt": "TEXT",
        ], indexes: []),
        "goals": StoreSpec(table: "goal", keyField: "id", columns: [
            "itemId": "TEXT", "createdAt": "TEXT", "updatedAt": "TEXT", "deletedAt": "TEXT",
        ], indexes: ["itemId"]),
        "checkins": StoreSpec(table: "checkin", keyField: "id", columns: ["goalId": "TEXT", "at": "TEXT"], indexes: ["goalId"]),
        "kv": StoreSpec(table: "kv", keyField: "key", columns: [:], indexes: []),
    ]

    /// Per-device settings keys that are not library content (storage.js `KEYS.meta`, `KEYS.settings`).
    static let secretsKey = "keepsake_secrets"
    static let settingsKey = "keepsake_settings"

    public init(path: String, secrets: SecretStore = KeychainSecrets()) throws {
        var config = Configuration()
        config.busyMode = .timeout(5)
        config.prepareDatabase { db in
            try db.execute(sql: "PRAGMA synchronous = NORMAL")
        }
        pool = try DatabasePool(path: path, configuration: config)
        self.secrets = secrets
        try Self.migrator.migrate(pool)
    }

    /// The App Group database, or a file in Application Support when the group isn't available
    /// (unsigned Simulator builds).
    public static func defaultPath(appGroup: String = "group.com.harrisonfischberg.keepsake") throws -> String {
        let fm = FileManager.default
        let base = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
            ?? fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("Keepsake", isDirectory: true)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("library.sqlite").path
    }

    static var migrator: DatabaseMigrator {
        var m = DatabaseMigrator()
        m.registerMigration("v1-records") { db in
            for spec in specs.values {
                let cols = spec.columns.sorted { $0.key < $1.key }.map { "\"\($0.key)\" \($0.value)" }
                try db.execute(sql: """
                    CREATE TABLE "\(spec.table)" (
                      "key" TEXT PRIMARY KEY NOT NULL,
                      \(cols.map { $0 + "," }.joined(separator: "\n  "))
                      "body" TEXT NOT NULL
                    )
                    """)
                for col in spec.indexes {
                    try db.execute(sql: "CREATE INDEX \"\(spec.table)_\(col)\" ON \"\(spec.table)\"(\"\(col)\")")
                }
            }
            try db.execute(sql: """
                CREATE TABLE setting ("key" TEXT PRIMARY KEY NOT NULL, "value" TEXT NOT NULL);
                CREATE TABLE outbox (
                  "seq" INTEGER PRIMARY KEY AUTOINCREMENT,
                  "store" TEXT NOT NULL, "key" TEXT NOT NULL, "op" TEXT NOT NULL, "at" TEXT NOT NULL
                );
                """)
        }
        // The card's one key fact (kinds.js keyFact), computed by the shared code when a save is written.
        // Derived, so it is not part of the record and never synced; rebuilt if missing.
        m.registerMigration("v2-item-fact") { db in
            try db.execute(sql: "ALTER TABLE item ADD COLUMN fact TEXT")
        }
        // The change log for iCloud sync: nothing read it and it only grew. Sync brings its own when it comes.
        m.registerMigration("v3-drop-outbox") { db in
            try db.execute(sql: "DROP TABLE IF EXISTS outbox")
        }
        // iCloud sync (SyncStore.swift). sync_pending: records changed here and not yet in iCloud, with a
        // revision so a change made while a send is in flight stays pending. sync_base: the last version
        // this device and iCloud agreed on (pictures replaced by their hash), for three-way merges, plus
        // CloudKit's system fields (its change tag). sync_sealed: pictures that arrived sealed with a key
        // this device doesn't have yet. sync_state: the sync engine's own saved state.
        m.registerMigration("v4-sync") { db in
            try db.execute(sql: """
                CREATE TABLE sync_pending ("store" TEXT NOT NULL, "key" TEXT NOT NULL, "rev" INTEGER NOT NULL, PRIMARY KEY ("store", "key"));
                CREATE TABLE sync_base ("store" TEXT NOT NULL, "key" TEXT NOT NULL, "body" TEXT, "system" BLOB, PRIMARY KEY ("store", "key"));
                CREATE TABLE sync_sealed ("store" TEXT NOT NULL, "key" TEXT NOT NULL, "data" BLOB NOT NULL, PRIMARY KEY ("store", "key"));
                CREATE TABLE sync_state ("key" TEXT PRIMARY KEY NOT NULL, "value" BLOB NOT NULL);
                """)
        }
        // Safari on the Mac (ExtensionMirror.swift): records that came from iCloud, in order, for the
        // extension to take back into its own storage. Only written when `recordsOutbound` is on.
        m.registerMigration("v5-sync-outbound") { db in
            try db.execute(sql: """
                CREATE TABLE sync_outbound ("seq" INTEGER PRIMARY KEY AUTOINCREMENT, "store" TEXT NOT NULL, "key" TEXT NOT NULL);
                """)
        }
        // The extension's merge base (ExtensionMirror): sync_ext_base, the version of each record Safari last
        // took (pictures hashed); sync_ext_offer, versions handed over in a pull and not yet known to be taken.
        m.registerMigration("v6-sync-ext-base") { db in
            try db.execute(sql: """
                CREATE TABLE sync_ext_base ("store" TEXT NOT NULL, "key" TEXT NOT NULL, "body" TEXT NOT NULL, PRIMARY KEY ("store", "key"));
                CREATE TABLE sync_ext_offer ("store" TEXT NOT NULL, "key" TEXT NOT NULL, "seq" INTEGER NOT NULL, "body" TEXT, PRIMARY KEY ("store", "key"));
                """)
        }
        // A counter SQLite moves on every change to a save, from any process (the app, the Share Extension,
        // iCloud sync): the shared code keeps its parsed list of saves until it moves (`itemsRevision`).
        m.registerMigration("v7-item-revision") { db in
            try db.execute(sql: """
                CREATE TABLE item_revision ("n" INTEGER NOT NULL);
                INSERT INTO item_revision VALUES (0);
                CREATE TRIGGER item_revision_insert AFTER INSERT ON item BEGIN UPDATE item_revision SET n = n + 1; END;
                CREATE TRIGGER item_revision_update AFTER UPDATE ON item BEGIN UPDATE item_revision SET n = n + 1; END;
                CREATE TRIGGER item_revision_delete AFTER DELETE ON item BEGIN UPDATE item_revision SET n = n + 1; END;
                """)
        }
        return m
    }

    // MARK: - Record store (the shared store's `db` backend)

    func spec(_ store: String) throws -> StoreSpec {
        guard let s = Self.specs[store] else { throw DatabaseError(message: "Unknown store \(store)") }
        return s
    }

    public func all(_ store: String) throws -> String {
        let s = try spec(store)
        let bodies = try pool.read { db in try String.fetchAll(db, sql: "SELECT body FROM \"\(s.table)\" ORDER BY rowid") }
        return "[" + bodies.joined(separator: ",") + "]"
    }

    public func get(_ store: String, _ key: String) throws -> String? {
        let s = try spec(store)
        return try pool.read { db in try String.fetchOne(db, sql: "SELECT body FROM \"\(s.table)\" WHERE key = ?", arguments: [key]) }
    }

    public func byIndex(_ store: String, _ index: String, _ value: String) throws -> String {
        let s = try spec(store)
        guard s.columns[index] != nil else {
            // Not a column: filter the bodies (the shared store only queries indexed fields today).
            let all = try JSONSerialization.jsonObject(with: Data(try self.all(store).utf8)) as? [[String: Any]] ?? []
            let hits = all.filter { ($0[index].map { "\($0)" } ?? "") == value }
            return String(decoding: try JSONSerialization.data(withJSONObject: hits), as: UTF8.self)
        }
        let bodies = try pool.read { db in
            value.isEmpty
                ? try String.fetchAll(db, sql: "SELECT body FROM \"\(s.table)\" WHERE \"\(index)\" IS NULL OR \"\(index)\" = '' ORDER BY rowid")
                : try String.fetchAll(db, sql: "SELECT body FROM \"\(s.table)\" WHERE \"\(index)\" = ? ORDER BY rowid", arguments: [value])
        }
        return "[" + bodies.joined(separator: ",") + "]"
    }

    public func count(_ store: String) throws -> Int {
        let s = try spec(store)
        return try pool.read { db in try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM \"\(s.table)\"") ?? 0 }
    }

    /// How many saves (not in the Trash) each value of an item column has ("collectionId", "kind"),
    /// counted from the column so no body is read. `excluding` leaves one save out.
    public func liveItemCounts(by column: String, excluding: String? = nil) throws -> [String: Int] {
        guard Self.specs["items"]?.columns[column] != nil else { throw DatabaseError(message: "Unknown column \(column)") }
        return try pool.read { db in
            let rows = try Row.fetchAll(db, sql: """
                SELECT "\(column)" AS value, COUNT(*) AS n FROM item
                WHERE deletedAt IS NULL AND "\(column)" IS NOT NULL AND "\(column)" != '' AND key IS NOT ?
                GROUP BY "\(column)"
                """, arguments: [excluding])
            return Dictionary(uniqueKeysWithValues: rows.map { ($0["value"] as String, $0["n"] as Int) })
        }
    }

    /// Inserts or replaces records given as their JSON text (with each save's key fact, for items).
    public func put(_ store: String, bodies: [String], facts: [String?]? = nil) throws {
        let s = try spec(store)
        try pool.write { db in
            for (i, body) in bodies.enumerated() { try upsert(db, s, store: store, body: body, fact: facts?[i]) }
        }
        wroteLocally()
    }

    /// Saves not in the Trash, newest first, each without the pictures stored inside it (`Library.listBody`),
    /// for the shared code's lists, search and counts: the whole library with its pictures was ~75 KB a
    /// save, parsed in JavaScript on every search keystroke and every change.
    public func liveItemsForLists() throws -> String {
        let bodies = try pool.read { db in
            try String.fetchAll(db, sql: "SELECT \(Library.listBody) FROM item WHERE deletedAt IS NULL ORDER BY createdAt DESC")
        }
        return "[" + bodies.joined(separator: ",") + "]"
    }

    /// Moves whenever any save is written or removed, by any process (the v7 triggers).
    public func itemsRevision() throws -> Int {
        try pool.read { db in try Int.fetchOne(db, sql: "SELECT n FROM item_revision") ?? 0 }
    }

    /// Keys of saves in the Trash since before `cutoff` (an ISO date), read from the column.
    public func trashedItemKeys(before cutoff: String) throws -> [String] {
        try pool.read { db in try String.fetchAll(db, sql: "SELECT key FROM item WHERE deletedAt IS NOT NULL AND deletedAt < ?", arguments: [cutoff]) }
    }

    /// Item bodies that have no key fact yet (written before v2, or by a store without the bridge).
    public func itemsMissingFacts() throws -> String {
        let bodies = try pool.read { db in try String.fetchAll(db, sql: "SELECT body FROM item WHERE fact IS NULL") }
        return "[" + bodies.joined(separator: ",") + "]"
    }

    public func setFacts(_ facts: [String: String]) throws {
        try pool.write { db in
            for (id, fact) in facts { try db.execute(sql: "UPDATE item SET fact = ? WHERE key = ?", arguments: [fact, id]) }
        }
    }

    public func remove(_ store: String, keys: [String]) throws {
        let s = try spec(store)
        try pool.write { db in
            for key in keys { try delete(db, s, store: store, key: key) }
        }
        wroteLocally()
    }

    /// Compare-and-swap for read-modify-write: each op is (key, expected body or nil, next body or nil).
    /// Returns false (and writes nothing) if any record no longer matches what was read.
    public func swap(_ store: String, ops: [(key: String, expected: String?, next: String?, fact: String?)]) throws -> Bool {
        let s = try spec(store)
        defer { wroteLocally() }
        return try pool.write { db in
            for op in ops {
                let current = try String.fetchOne(db, sql: "SELECT body FROM \"\(s.table)\" WHERE key = ?", arguments: [op.key])
                if current != op.expected { return false }
            }
            for op in ops {
                if let next = op.next { try upsert(db, s, store: store, body: next, fact: op.fact) } else { try delete(db, s, store: store, key: op.key) }
            }
            return true
        }
    }

    public func clear(_ stores: [String]) throws {
        try pool.write { db in
            for store in stores {
                let s = try spec(store)
                for key in try String.fetchAll(db, sql: "SELECT key FROM \"\(s.table)\"") { try Self.markPending(db, store: store, key: key) }
                try db.execute(sql: "DELETE FROM \"\(s.table)\"")
            }
        }
        wroteLocally()
    }

    func upsert(_ db: Database, _ s: StoreSpec, store: String, body: String, fact: String? = nil, track: Bool = true) throws {
        guard let obj = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any],
              let key = obj[s.keyField] as? String, !key.isEmpty
        else { throw DatabaseError(message: "A \(store) record has no \(s.keyField)") }
        let names = s.columns.keys.sorted()
        var args: [(any DatabaseValueConvertible)?] = [key]
        for name in names { args.append(Self.column(obj[name])) }
        args.append(body)
        let cols = (["key"] + names + ["body"]).map { "\"\($0)\"" }.joined(separator: ", ")
        let marks = Array(repeating: "?", count: names.count + 2).joined(separator: ", ")
        try db.execute(sql: "INSERT OR REPLACE INTO \"\(s.table)\" (\(cols)) VALUES (\(marks))", arguments: StatementArguments(args))
        if store == "items" { try db.execute(sql: "UPDATE item SET fact = ? WHERE key = ?", arguments: [fact, key]) }
        if track { try Self.markPending(db, store: store, key: key) } else { try noteOutbound(db, store: store, key: key) }
    }

    func delete(_ db: Database, _ s: StoreSpec, store: String, key: String, track: Bool = true) throws {
        try db.execute(sql: "DELETE FROM \"\(s.table)\" WHERE key = ?", arguments: [key])
        if track { try Self.markPending(db, store: store, key: key) } else { try noteOutbound(db, store: store, key: key) }
    }

    static func column(_ v: Any?) -> DatabaseValueConvertible? {
        switch v {
        case let n as NSNumber where CFGetTypeID(n) == CFBooleanGetTypeID(): return n.boolValue ? 1 : 0
        case let n as NSNumber: return n.doubleValue
        case let s as String: return s
        default: return nil
        }
    }

    // MARK: - Settings (the shared store's `kv` backend). Secrets go to the Keychain, never SQLite.

    public func settings(_ keys: [String]?) throws -> [String: Any] {
        var out: [String: Any] = [:]
        let rows = try pool.read { db in try Row.fetchAll(db, sql: "SELECT key, value FROM setting") }
        for row in rows {
            let k: String = row["key"]
            if let keys, !keys.contains(k) { continue }
            out[k] = try JSONSerialization.jsonObject(with: Data((row["value"] as String).utf8), options: .fragmentsAllowed)
        }
        if keys == nil || keys!.contains(Self.secretsKey), let s = secrets.read(), let obj = try? JSONSerialization.jsonObject(with: Data(s.utf8)) {
            out[Self.secretsKey] = obj
        }
        return out
    }

    public func setSettings(_ values: [String: Any]) throws {
        let aiChanged = try pool.write { db in
            var aiChanged = false
            for (k, v) in values {
                let json = String(decoding: try JSONSerialization.data(withJSONObject: v, options: .fragmentsAllowed), as: UTF8.self)
                if k == Self.secretsKey { secrets.write(json); continue }
                if k == Self.settingsKey, try Self.aiSettingsChanged(db, to: v) {
                    try Self.markPending(db, store: SyncID.aiSettings.store, key: SyncID.aiSettings.key)
                    aiChanged = true
                }
                try db.execute(sql: "INSERT OR REPLACE INTO setting (key, value) VALUES (?, ?)", arguments: [k, json])
            }
            return aiChanged
        }
        if aiChanged { wroteLocally() }
    }

    public func removeSettings(_ keys: [String]) throws {
        try pool.write { db in
            for k in keys {
                if k == Self.secretsKey { secrets.write(nil); continue }
                try db.execute(sql: "DELETE FROM setting WHERE key = ?", arguments: [k])
            }
        }
    }

    public func clearSettings() throws {
        secrets.write(nil)
        try pool.write { db in try db.execute(sql: "DELETE FROM setting") }
    }
}

extension ISO8601DateFormatter {
    nonisolated(unsafe) static let keepsake: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

// MARK: - Secrets

/// Where the AI key lives. Per device, never synced, never exported.
public protocol SecretStore: Sendable {
    func read() -> String?
    func write(_ value: String?)
}

public struct KeychainSecrets: SecretStore {
    let service = "com.harrisonfischberg.keepsake.secrets"
    public init() {}
    public func read() -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: "keepsake_secrets", kSecReturnData as String: true]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }
    public func write(_ value: String?) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrAccount as String: "keepsake_secrets"]
        SecItemDelete(q as CFDictionary)
        guard let value else { return }
        var add = q
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
}

public final class MemorySecrets: SecretStore, @unchecked Sendable {
    private var value: String?
    private let lock = NSLock()
    public init() {}
    public func read() -> String? { lock.withLock { value } }
    public func write(_ v: String?) { lock.withLock { value = v } }
}
