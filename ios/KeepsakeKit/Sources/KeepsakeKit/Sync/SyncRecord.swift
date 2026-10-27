import Foundation
import CryptoKit

/// Which records iCloud sync carries, and how each one is named in CloudKit.
///
/// Every record of the shared schema's stores becomes one CloudKit record named `<Type>.<key>`, in one
/// zone of the private database. Of the `kv` store only the two library-wide records travel (learned
/// words and Instagram import history); the AI undo log stays on the device that made the change.
/// Settings outside the record stores stay per device, except the AI settings (`aiSettings`); the AI key
/// never syncs.
public struct SyncID: Hashable, Sendable, CustomStringConvertible {
    public let store: String
    public let key: String

    public init?(store: String, key: String) {
        guard Self.syncs(store: store, key: key) else { return nil }
        self.store = store
        self.key = key
    }

    static let types: [String: String] = ["items": "Item", "collections": "Collection", "goals": "Goal", "checkins": "Checkin", "kv": "Value"]
    static let syncedValues: Set<String> = ["prefs", "importHistory", "aiSettings"]

    /// AI on or off, provider, model, effort and web search (`keepsake_settings.ai`), kept in the settings
    /// rather than a record store but synced like one. The key is never part of it.
    public static let aiSettings = SyncID(store: "kv", key: "aiSettings")!

    public static func syncs(store: String, key: String) -> Bool {
        guard types[store] != nil, !key.isEmpty else { return false }
        return store != "kv" || syncedValues.contains(key)
    }

    public var recordType: String { Self.types[store]! }
    public var recordName: String { "\(recordType).\(key)" }
    public var description: String { recordName }

    public init?(recordName: String) {
        guard let dot = recordName.firstIndex(of: ".") else { return nil }
        let type = String(recordName[..<dot])
        guard let store = Self.types.first(where: { $0.value == type })?.key else { return nil }
        self.init(store: store, key: String(recordName[recordName.index(after: dot)...]))
    }
}

/// One record as it travels: the JSON body with stored pictures taken out, and the pictures themselves.
///
/// Pictures kept inside a save are `data:` URLs (up to 400 KB each) in `image` and `images`. They go to
/// CloudKit as one sealed asset instead of inside the record (a record holds 1 MB at most), and the body
/// keeps a marker `ks-picture:<n>` where each one was.
public struct SyncRecord: Equatable, Sendable {
    public let id: SyncID
    public var body: String
    public var pictures: [String]
    /// Pictures that came from iCloud sealed with a key this device doesn't have yet (`sync_sealed`),
    /// still sealed. The body keeps their markers, so they go back to iCloud as they came.
    public var sealed: Data?

    public init(id: SyncID, body: String, pictures: [String] = []) {
        self.id = id
        self.body = body
        self.pictures = pictures
    }

    static let markerPrefix = "ks-picture:"
    static let pictureFields = ["image", "images"]

    /// Splits a record as stored on this device into body and pictures.
    public init(id: SyncID, stored: String) throws {
        var obj = try SyncJSON.object(stored)
        var pictures: [String] = []
        func take(_ v: Any) -> Any {
            guard let s = v as? String, s.hasPrefix("data:") else { return v }
            pictures.append(s)
            return Self.markerPrefix + String(pictures.count - 1)
        }
        if id.store == "items" {
            if let image = obj["image"] { obj["image"] = take(image) }
            if let images = obj["images"] as? [Any] { obj["images"] = images.map(take) }
        }
        self.init(id: id, body: try SyncJSON.text(obj), pictures: pictures)
    }

    /// The record as this device stores it, pictures back in place.
    public func stored() throws -> String {
        guard !pictures.isEmpty else { return body }
        var obj = try SyncJSON.object(body)
        func put(_ v: Any) -> Any {
            guard let s = v as? String, s.hasPrefix(Self.markerPrefix), let n = Int(s.dropFirst(Self.markerPrefix.count)), pictures.indices.contains(n) else { return v }
            return pictures[n]
        }
        if let image = obj["image"] { obj["image"] = put(image) }
        if let images = obj["images"] as? [Any] { obj["images"] = images.map(put) }
        return try SyncJSON.text(obj)
    }

    /// Pictures as one blob for the asset: a JSON array of the `data:` URLs.
    public func picturesData() throws -> Data? {
        pictures.isEmpty ? nil : try JSONSerialization.data(withJSONObject: pictures)
    }

    public static func pictures(from data: Data) throws -> [String] {
        guard let list = try JSONSerialization.jsonObject(with: data) as? [String] else { throw SyncError.badRecord("pictures") }
        return list
    }
}

public enum SyncError: Error, Equatable {
    case badRecord(String)
    case missingKey(String)
    /// The Keychain refused to keep a new picture key (its OSStatus).
    case keyNotSaved(Int)
}

/// JSON helpers shared by the sync code. Bodies are compared as values, never as text, because key
/// order differs between the shared code and Foundation.
enum SyncJSON {
    static func object(_ text: String) throws -> [String: Any] {
        guard let obj = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else { throw SyncError.badRecord("not an object") }
        return obj
    }

    static func text(_ obj: [String: Any]) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys, .withoutEscapingSlashes]), as: UTF8.self)
    }

    static func same(_ a: Any?, _ b: Any?) -> Bool {
        switch (a, b) {
        case (nil, nil): return true
        case (nil, is NSNull), (is NSNull, nil): return true
        case let (a?, b?): return (a as AnyObject).isEqual(b as AnyObject)
        default: return false
        }
    }

    /// A body with each stored picture replaced by its hash, so the merge base stays small and two
    /// copies of the same picture compare equal.
    static func hashedPictures(_ stored: String, store: String) throws -> String {
        guard store == "items" else { return stored }
        var obj = try object(stored)
        func hash(_ v: Any) -> Any {
            guard let s = v as? String, s.hasPrefix("data:") else { return v }
            return "ks-sha256:" + SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
        }
        if let image = obj["image"] { obj["image"] = hash(image) }
        if let images = obj["images"] as? [Any] { obj["images"] = images.map(hash) }
        return try text(obj)
    }
}
