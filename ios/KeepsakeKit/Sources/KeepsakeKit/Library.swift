import Foundation
import GRDB

/// One save as the screens need it. Decoded from the stored record (the shared schema), so it never
/// drifts from what Chrome writes; unknown fields are simply not read here.
public struct Save: Identifiable, Hashable, Sendable, Decodable {
    public let id: String
    public let kind: String
    public let title: String
    public let host: String?
    public let retailer: String?
    public let url: String?
    public let image: String?
    public let note: String?
    public let price: Double?
    public let currency: String?
    public let collectionId: String?
    public let favorite: Bool?
    public let purchased: Bool?
    public let status: String?
    public let captureState: String?
    public let needsReview: Bool?
    public let createdAt: String?
    public let deletedAt: String?
    public let openedAt: String?
    public let description: String?
    public let details: JSONValue?
    public let topics: [String]?
    /// The one fact that matters for this kind ("9 ingredients · 25 min"), from Chrome's keyFact.
    public var fact: String?

    public var isFinishing: Bool { captureState == "pending" }

    /// Chrome stores "no image" as an empty string.
    public var hasImage: Bool { !(image ?? "").isEmpty }

    /// Every kind but products and links has its own Lifestyle view (kinds.js hasOwnView).
    public var hasOwnView: Bool { kind != "product" && kind != "link" }

    /// In Review (kinds.js needsCollection): no collection, and no Lifestyle view of its own.
    public var needsCollection: Bool { (collectionId ?? "").isEmpty && !hasOwnView }
}

public struct SaveCollection: Identifiable, Hashable, Sendable, Decodable {
    public let id: String
    public let name: String
    public let pinned: Bool?
    public let sortOrder: Double?
}

/// The library for the app, the Share Extension and the widgets.
/// Reads go straight to SQLite (fast, observable); every write goes through the shared store, so
/// sorting, duplicates, learning and the Trash follow Chrome's rules exactly.
public final class Library: @unchecked Sendable {
    public let core: KeepsakeCore
    public var database: RecordDatabase { core.database }
    private let ready: Task<Void, Error>

    public init(path: String? = nil, secrets: SecretStore = KeychainSecrets(), transport: NetworkTransport = URLSessionTransport()) throws {
        let db = try RecordDatabase(path: path ?? RecordDatabase.defaultPath(), secrets: secrets)
        let core = try KeepsakeCore(database: db, transport: transport)
        self.core = core
        ready = Task {
            try await core.call("store.init")
            try await core.call("backfillFacts")
        }
    }

    /// Waits for the store's first-run setup (default collections, migrations).
    public func prepare() async throws { try await ready.value }

    // MARK: reads

    public func saves(trash: Bool = false) throws -> [Save] {
        try database.pool.read { try Self.fetchSaves($0, trash: trash) }
    }

    static func fetchSaves(_ db: Database, trash: Bool) throws -> [Save] {
        let sql = "SELECT body, fact FROM item WHERE deletedAt IS \(trash ? "NOT " : "")NULL ORDER BY createdAt DESC"
        let decoder = JSONDecoder()
        return try Row.fetchAll(db, sql: sql).compactMap { row in
            guard var save = try? decoder.decode(Save.self, from: Data((row["body"] as String).utf8)) else { return nil }
            save.fact = row["fact"]
            return save
        }
    }

    /// Recent saves for widgets: opens the shared library read-only-ish, without the JavaScript core.
    public static func recentSaves(limit: Int = 20, path: String? = nil) throws -> [Save] {
        let db = try RecordDatabase(path: path ?? RecordDatabase.defaultPath(), secrets: MemorySecrets())
        return Array(try db.pool.read { try fetchSaves($0, trash: false) }.prefix(limit))
    }

    /// One save as stored now (with its key fact).
    public func save(_ id: String) throws -> Save? {
        try database.pool.read { db in
            guard let row = try Row.fetchOne(db, sql: "SELECT body, fact FROM item WHERE key = ?", arguments: [id]),
                  var save = try? JSONDecoder().decode(Save.self, from: Data((row["body"] as String).utf8)) else { return nil }
            save.fact = row["fact"]
            return save
        }
    }

    public func collections() throws -> [SaveCollection] {
        try database.pool.read { db in
            try String.fetchAll(db, sql: "SELECT body FROM collection ORDER BY pinned DESC, sortOrder, name")
                .compactMap { try? JSONDecoder().decode(SaveCollection.self, from: Data($0.utf8)) }
        }
    }

    /// Live saves for SwiftUI. Changes made in this process arrive at once; changes from the Share
    /// Extension arrive when the app calls `refresh` (on becoming active).
    public func observeSaves() -> AsyncValueObservation<[Save]> {
        ValueObservation.tracking { try Self.fetchSaves($0, trash: false) }.values(in: database.pool)
    }

    // MARK: writes (through the shared store)

    /// What a capture did: the save, or the save it duplicates.
    public struct CaptureResult: Sendable {
        public let save: Save?
        public let duplicateOf: Save?
        public let destination: String?
        public let needsReview: Bool
    }

    /// Saves a page the way Chrome's toolbar does (src/shared/capture.js): `product` is what the page
    /// reader found (Safari), or just a URL, title and text from another app.
    public func capture(product: [String: Any], source: String = "share-sheet") async throws -> CaptureResult {
        try await prepare()
        let r = try await core.call("capture", [product, ["source": source, "instant": true]]) as? [String: Any] ?? [:]
        if let message = r["error"] as? String, r["ok"] as? Bool != true { throw CoreError.failed(message) }
        func decoded(_ v: Any?) -> Save? {
            guard let v, let d = try? JSONSerialization.data(withJSONObject: v) else { return nil }
            return try? JSONDecoder().decode(Save.self, from: d)
        }
        if r["duplicate"] as? Bool == true, let existing = r["existing"] as? [String: Any], let id = existing["id"] as? String {
            return CaptureResult(save: nil, duplicateOf: try self.save(id), destination: existing["collectionName"] as? String, needsReview: false)
        }
        let classification = r["classification"] as? [String: Any]
        let item = (r["item"] as? [String: Any])?["id"].flatMap { $0 as? String }.flatMap { try? self.save($0) } ?? decoded(r["item"])
        return CaptureResult(save: item, duplicateOf: nil, destination: classification?["collectionName"] as? String,
                             needsReview: item?.needsReview ?? false)
    }

    /// A product for `capture` from what another app shared: no page was read, so it's marked sparse
    /// (a bare link stays a link unless its address says more: YouTube, Letterboxd, a maps link…).
    public static func sharedProduct(url: String?, title: String?, text: String?) -> [String: Any] {
        var p: [String: Any] = ["sparse": true]
        if let url { p["url"] = url; p["canonicalUrl"] = url }
        if let title, !title.isEmpty { p["title"] = title }
        if let text, !text.isEmpty, text != url { p["description"] = text }
        if let url, let host = URL(string: url)?.host(), host.hasSuffix("instagram.com") { p["isInstagram"] = true }
        return p
    }

    /// Saves first, with only what the share sheet gave us; details are filled in later.
    @discardableResult
    public func capture(url: String?, title: String?, text: String? = nil, sourceApp: String? = nil) async throws -> Save {
        try await prepare()
        var input: [String: Any] = ["captureState": "complete"]
        if let url { input["url"] = url }
        if let title, !title.isEmpty { input["title"] = title }
        if let text, !text.isEmpty { input["description"] = text }
        if let sourceApp { input["capturedVia"] = sourceApp }
        let json = try await core.callJSON("store.addItem", argsJSON: String(decoding: try JSONSerialization.data(withJSONObject: [input]), as: UTF8.self))
        return try JSONDecoder().decode(Save.self, from: Data(json.utf8))
    }

    public func importExport(_ data: Data, replace: Bool) async throws -> [String: Any] {
        try await prepare()
        let payload = try JSONSerialization.jsonObject(with: data)
        return (try await core.call("store.importJSON", [payload, ["mode": replace ? "replace" : "merge"]]) as? [String: Any]) ?? [:]
    }

    public func exportData() async throws -> Data {
        try await prepare()
        return Data(try await core.callJSON("store.exportJSON").utf8)
    }

    public func trash(_ ids: [String]) async throws { try await core.call("store.deleteItems", [ids]) }
    public func restore(_ ids: [String]) async throws { try await core.call("store.restoreItems", [ids]) }
}
