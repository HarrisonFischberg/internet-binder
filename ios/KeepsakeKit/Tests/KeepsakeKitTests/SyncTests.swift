import Testing
import Foundation
import CryptoKit
import CloudKit
@testable import KeepsakeKit

/// iCloud's side of sync, without iCloud: records with a change tag, a log of changes to fetch from,
/// and the same conflict rule CloudKit has (a save based on an old tag is refused with the server copy).
final class FakeCloud {
    var records: [SyncID: (record: SyncRecord, tag: Int)] = [:]
    var log: [SyncID] = []
    var nextTag = 1
    var refusals = 0

    static func tagData(_ tag: Int) -> Data { Data("tag-\(tag)".utf8) }
}

/// One device: its library and how far into the cloud's log it has read.
final class Device {
    let db: RecordDatabase
    var cursor = 0
    init() throws { db = try tempDatabase() }

    /// Fetch, then send, as the sync engine does; a refused save is merged and sent on the next round.
    func sync(_ cloud: FakeCloud) throws {
        let ids = Array(cloud.log[cursor...])
        cursor = cloud.log.count
        for id in ids {
            if let entry = cloud.records[id] { try db.applyRemote(entry.record, system: FakeCloud.tagData(entry.tag)) } else { try db.applyRemoteDeletion(id) }
        }
        for p in try db.pendingChanges() {
            switch try db.outgoing(p.id) {
            case .save(let rec, let rev):
                if let server = cloud.records[p.id], try db.systemFields(p.id) != FakeCloud.tagData(server.tag) {
                    cloud.refusals += 1
                    try db.applyRemote(server.record, system: FakeCloud.tagData(server.tag))
                    continue
                }
                let tag = cloud.nextTag
                cloud.nextTag += 1
                cloud.records[p.id] = (rec, tag)
                cloud.log.append(p.id)
                try db.markSent(p.id, rev: rev, record: rec, system: FakeCloud.tagData(tag))
            case .delete(let id, let rev):
                cloud.records[id] = nil
                cloud.log.append(id)
                try db.markSent(id, rev: rev, record: nil, system: nil)
            case nil:
                break
            }
        }
        cursor = max(cursor, cloud.log.count) // what this device just sent, it already has
    }

    func put(_ store: String, _ obj: [String: Any]) throws {
        try db.put(store, bodies: [try SyncJSON.text(obj)])
    }

    // Swift can't default a leading unlabeled parameter before a required one, so items get their own overload.
    func put(_ obj: [String: Any]) throws { try put("items", obj) }

    func item(_ id: String) throws -> [String: Any]? {
        try db.get("items", id).map { try SyncJSON.object($0) }
    }
}

func syncAll(_ cloud: FakeCloud, _ devices: Device...) throws {
    for _ in 0..<3 { for d in devices { try d.sync(cloud) } }
}

@Suite("iCloud sync")
struct SyncTests {
    let phone: Device
    let mac: Device
    let cloud = FakeCloud()

    init() throws {
        phone = try Device()
        mac = try Device()
    }

    @Test func recordNames() {
        #expect(SyncID(store: "items", key: "abc")?.recordName == "Item.abc")
        #expect(SyncID(recordName: "Collection.c1") == SyncID(store: "collections", key: "c1"))
        #expect(SyncID(recordName: "Value.prefs") == SyncID(store: "kv", key: "prefs"))
        #expect(SyncID(store: "kv", key: "aiLog:x") == nil, "AI undo stays on its device")
        #expect(SyncID(recordName: "Nope.x") == nil)
    }

    @Test func aSaveOnThePhoneShowsUpOnTheMac() throws {
        try phone.put(["id": "s1", "title": "Shakshuka", "collectionId": "lifestyle", "updatedAt": "2026-10-25T10:00:00.000Z"])
        try phone.put("collections", ["id": "lifestyle", "name": "Lifestyle", "updatedAt": "2026-10-25T10:00:00.000Z"])
        try syncAll(cloud, phone, mac)
        #expect(try mac.item("s1")?["title"] as? String == "Shakshuka")
        #expect(try mac.db.get("collections", "lifestyle") != nil)
        #expect(try phone.db.pendingChanges().isEmpty)
        #expect(try mac.db.pendingChanges().isEmpty, "what came from iCloud isn't sent back")
    }

    @Test func editsToDifferentFieldsBothSurvive() throws {
        try phone.put(["id": "s1", "title": "Pasta", "collectionId": "food", "updatedAt": "2026-10-25T10:00:00.000Z"])
        try syncAll(cloud, phone, mac)
        // Offline at the same time: the Mac renames it, the phone moves it.
        try mac.put(["id": "s1", "title": "Cacio e pepe", "collectionId": "food", "userFields": ["title"], "updatedAt": "2026-10-25T11:00:00.000Z"])
        try phone.put(["id": "s1", "title": "Pasta", "collectionId": "dinner", "updatedAt": "2026-10-25T11:05:00.000Z"])
        try syncAll(cloud, mac, phone)
        for d in [phone, mac] {
            let s = try #require(try d.item("s1"))
            #expect(s["title"] as? String == "Cacio e pepe")
            #expect(s["collectionId"] as? String == "dinner")
            #expect(s["updatedAt"] as? String == "2026-10-25T11:05:00.000Z")
        }
    }

    @Test func aHandEditBeatsANewerAIResult() throws {
        try phone.put(["id": "s1", "title": "IMG_2041", "updatedAt": "2026-10-25T10:00:00.000Z"])
        try syncAll(cloud, phone, mac)
        try phone.put(["id": "s1", "title": "Grandma's lamp", "userFields": ["title"], "updatedAt": "2026-10-25T11:00:00.000Z"])
        try mac.put(["id": "s1", "title": "Ceramic table lamp", "ai": ["summary": "A lamp"], "updatedAt": "2026-10-25T12:00:00.000Z"])
        try syncAll(cloud, phone, mac)
        for d in [phone, mac] {
            let s = try #require(try d.item("s1"))
            #expect(s["title"] as? String == "Grandma's lamp")
            #expect((s["ai"] as? [String: Any])?["summary"] as? String == "A lamp", "the AI's other results still land")
        }
    }

    @Test func trashUndoAndEmptyingTheTrash() throws {
        try phone.put(["id": "s1", "title": "Tent", "updatedAt": "2026-10-25T10:00:00.000Z"])
        try syncAll(cloud, phone, mac)
        try mac.put(["id": "s1", "title": "Tent", "deletedAt": "2026-10-25T11:00:00.000Z", "updatedAt": "2026-10-25T11:00:00.000Z"])
        try syncAll(cloud, mac, phone)
        #expect(try phone.item("s1")?["deletedAt"] as? String == "2026-10-25T11:00:00.000Z")
        try phone.put(["id": "s1", "title": "Tent", "updatedAt": "2026-10-25T11:01:00.000Z"]) // Undo
        try syncAll(cloud, phone, mac)
        #expect(try mac.item("s1")?["deletedAt"] == nil)
        try mac.db.remove("items", keys: ["s1"]) // emptied
        try syncAll(cloud, mac, phone)
        #expect(try phone.item("s1") == nil)
        #expect(cloud.records.isEmpty)
    }

    @Test func aChangeMadeWhileSendingStaysPending() throws {
        try phone.put(["id": "s1", "title": "One", "updatedAt": "2026-10-25T10:00:00.000Z"])
        guard case .save(let rec, let rev) = try phone.db.outgoing(try #require(SyncID(store: "items", key: "s1"))) else { Issue.record("not pending"); return }
        try phone.put(["id": "s1", "title": "Two", "updatedAt": "2026-10-25T10:00:01.000Z"])
        try phone.db.markSent(rec.id, rev: rev, record: rec, system: nil)
        #expect(try phone.db.pendingChanges().map(\.id.key) == ["s1"])
    }

    @Test func learnedWordsMergeAndForgetTravels() throws {
        let prefs: [String: Any] = ["learnedKeywords": ["tent": ["camping": 2]], "retailerPrefs": [:], "corrections": []]
        try phone.put("kv", ["key": "prefs", "value": prefs])
        try syncAll(cloud, phone, mac)
        // Each device learns something; the phone also forgets "tent".
        try phone.put("kv", ["key": "prefs", "value": ["learnedKeywords": ["linen": ["home": 1]], "retailerPrefs": [:], "corrections": []]])
        try mac.put("kv", ["key": "prefs", "value": ["learnedKeywords": ["tent": ["camping": 2], "stove": ["camping": 1]], "retailerPrefs": ["rei.com": ["camping": 3]], "corrections": []]])
        try syncAll(cloud, phone, mac)
        for d in [phone, mac] {
            let value = try SyncJSON.object(try #require(try d.db.get("kv", "prefs")))["value"] as! [String: Any]
            let words = value["learnedKeywords"] as! [String: [String: Double]]
            #expect(words == ["linen": ["home": 1], "stove": ["camping": 1]])
            #expect((value["retailerPrefs"] as! [String: [String: Double]]) == ["rei.com": ["camping": 3]])
        }
    }

    @Test func theAIUndoLogStaysOnItsDevice() throws {
        try phone.put("kv", ["key": "aiLog:1", "value": ["id": "1"]])
        try syncAll(cloud, phone, mac)
        #expect(try mac.db.get("kv", "aiLog:1") == nil)
        #expect(cloud.records.isEmpty)
    }

    @Test func storedPicturesTravelApartFromTheRecord() throws {
        let pic = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
        let id = try #require(SyncID(store: "items", key: "s1"))
        let stored = try SyncJSON.text(["id": "s1", "image": pic, "images": [pic, "https://example.com/b.jpg"], "updatedAt": "x"])
        let rec = try SyncRecord(id: id, stored: stored)
        #expect(rec.pictures == [pic, pic])
        #expect(!rec.body.contains("data:"))
        #expect(try SyncJSON.object(try rec.stored()) as NSDictionary == (try SyncJSON.object(stored)) as NSDictionary)
        #expect(try SyncJSON.hashedPictures(stored, store: "items").contains("ks-sha256:"))
    }

    @Test func cloudKitRecordsRoundTripSealed() throws {
        let keys = LibraryKeys(store: MemoryLibraryKeys())
        let id = try #require(SyncID(store: "items", key: "s1"))
        let rec = SyncRecord(id: id, body: #"{"id":"s1","image":"ks-picture:0"}"#, pictures: ["data:image/png;base64,iVBORw0KGgo="])
        let (record, file) = try CloudSync.makeRecord(rec, system: nil, keys: keys)
        #expect(record.recordType == "Item")
        #expect(record.recordID.zoneID == CloudSync.zoneID)
        let sealed = try Data(contentsOf: try #require(file))
        #expect(!String(decoding: sealed, as: UTF8.self).contains("iVBOR"), "pictures leave sealed")
        let (back, waiting) = try CloudSync.decode(record, keys: keys)
        #expect(back == rec)
        #expect(waiting == nil)

        // Another device that hasn't got the key from iCloud Keychain yet keeps the sealed pictures for later.
        let other = LibraryKeys(store: MemoryLibraryKeys())
        let (early, kept) = try CloudSync.decode(record, keys: other)
        #expect(early.pictures.isEmpty)
        #expect(kept == sealed)
        for (kid, key) in keys.store.all() { other.store.add(id: kid, key: key) }
        #expect(try SyncRecord.pictures(from: try other.open(try #require(kept), recordName: id.recordName)) == rec.pictures)

        // An update carries the change tag of the version iCloud has.
        let system = CloudSync.systemFields(record)
        let (update, _) = try CloudSync.makeRecord(rec, system: system, keys: keys)
        #expect(update.recordID == record.recordID)
    }

    @Test func keysConvergeOnTheSmallestId() {
        let store = MemoryLibraryKeys()
        let keys = LibraryKeys(store: store)
        let first = keys.current().id
        store.add(id: "0000000000000000", key: SymmetricKey(size: .bits256))
        #expect(keys.current().id == "0000000000000000")
        #expect(first != "0000000000000000")
    }

    @Test func aiSettingsSyncButTheKeyNeverDoes() throws {
        try phone.db.setSettings(["keepsake_settings": ["style": "swiss", "ai": ["on": true, "provider": "anthropic", "model": "claude-sonnet-5-5", "effort": "medium"]],
                                  "keepsake_secrets": ["aiApiKey": "sk-test"]])
        try syncAll(cloud, phone, mac)
        var macSettings = try mac.db.settings(nil)
        let ai = (macSettings["keepsake_settings"] as? [String: Any])?["ai"] as? [String: Any]
        #expect(ai?["model"] as? String == "claude-sonnet-5-5")
        #expect((macSettings["keepsake_settings"] as? [String: Any])?["style"] == nil, "the look stays per device")
        #expect(macSettings["keepsake_secrets"] == nil, "the key never leaves the phone")

        // Changing the effort on the Mac reaches the phone, and the phone keeps its own look.
        var next = macSettings["keepsake_settings"] as! [String: Any]
        next["ai"] = ["on": true, "provider": "anthropic", "model": "claude-sonnet-5-5", "effort": "high"]
        try mac.db.setSettings(["keepsake_settings": next])
        try syncAll(cloud, mac, phone)
        let phoneSettings = try phone.db.settings(["keepsake_settings"])["keepsake_settings"] as? [String: Any]
        #expect((phoneSettings?["ai"] as? [String: Any])?["effort"] as? String == "high")
        #expect(phoneSettings?["style"] as? String == "swiss")
        macSettings = try mac.db.settings(nil)
        #expect(try mac.db.pendingChanges().isEmpty)
    }

    @Test func turningSyncBackOnAfterAnEraseKeepsICloud() throws {
        try phone.put(["id": "s1", "title": "Lamp", "updatedAt": "2026-10-25T10:00:00.000Z"])
        try syncAll(cloud, phone)
        // Sync off, library erased, sync on again (LibraryModel.setSync).
        try phone.db.resetSync()
        try phone.db.clear(["items"])
        try phone.db.resetSync()
        try phone.db.markAllPending()
        phone.cursor = 0
        try syncAll(cloud, phone)
        #expect(cloud.records[try #require(SyncID(store: "items", key: "s1"))] != nil)
        #expect(try phone.item("s1")?["title"] as? String == "Lamp", "it comes back from iCloud")
    }
}
