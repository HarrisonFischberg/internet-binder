import Testing
import Foundation
@testable import KeepsakeKit

/// Safari on the Mac: the extension's library reaches iCloud through the Mac app's copy (ExtensionMirror).
@Suite("iCloud sync: Safari's copy on the Mac")
struct ExtensionMirrorTests {
    let phone: Device
    let mac: Device // the Mac app's copy of the extension's library
    let cloud = FakeCloud()

    init() throws {
        phone = try Device()
        mac = try Device()
        mac.db.recordsOutbound = true
    }

    func pull(_ cursor: Int64) throws -> (changes: [[String: Any]], cursor: Int64, more: Bool) {
        try ExtensionMirror.outbound(after: cursor, from: mac.db)
    }

    @Test func aSaveFromThePhoneGoesToSafariOnce() throws {
        try phone.put(["id": "s1", "title": "Shakshuka", "updatedAt": "2026-10-25T10:00:00.000Z"])
        try syncAll(cloud, phone, mac)
        let first = try pull(0)
        #expect(first.changes.map { $0["key"] as? String } == ["s1"])
        #expect((first.changes[0]["body"] as? [String: Any])?["title"] as? String == "Shakshuka")
        #expect(try pull(first.cursor).changes.isEmpty, "taken once")
        #expect(try mac.db.pendingChanges().isEmpty)
    }

    @Test func aSaveFromSafariGoesToThePhone() throws {
        let acked = try ExtensionMirror.receive([["store": "items", "key": "s1", "rev": 3, "body": ["id": "s1", "title": "Lamp"]]], cursor: 0, into: mac.db)
        #expect(acked.first?["rev"] as? Int == 3)
        #expect(try pull(0).changes.count == 1, "starting over hands back the whole copy")
        try syncAll(cloud, mac, phone)
        #expect(try phone.item("s1")?["title"] as? String == "Lamp")
        #expect(try pull(100).changes.isEmpty, "what Safari sent doesn't come back to it")

        _ = try ExtensionMirror.receive([["store": "items", "key": "s1", "rev": 4, "body": NSNull()]], cursor: 0, into: mac.db)
        try syncAll(cloud, mac, phone)
        #expect(try phone.item("s1") == nil)
    }

    @Test func anEditSafariHadNotSeenIsMergedNotOverwritten() throws {
        try phone.put(["id": "s1", "title": "Pasta", "collectionId": "food", "updatedAt": "2026-10-25T10:00:00.000Z"])
        try syncAll(cloud, phone, mac)
        let seen = try pull(0).cursor
        try phone.put(["id": "s1", "title": "Cacio e pepe", "collectionId": "food", "userFields": ["title"], "updatedAt": "2026-10-25T11:00:00.000Z"])
        try syncAll(cloud, phone, mac)
        // Safari moved it before pulling the rename.
        _ = try ExtensionMirror.receive([["store": "items", "key": "s1", "rev": 1, "body": ["id": "s1", "title": "Pasta", "collectionId": "dinner", "updatedAt": "2026-10-25T11:05:00.000Z"]]], cursor: seen, into: mac.db)
        try syncAll(cloud, mac, phone)
        for s in [try phone.item("s1"), try mac.item("s1")] {
            #expect(s?["title"] as? String == "Cacio e pepe")
            #expect(s?["collectionId"] as? String == "dinner")
        }
        let back = try pull(seen).changes.first { $0["key"] as? String == "s1" }
        #expect((back?["body"] as? [String: Any])?["title"] as? String == "Cacio e pepe", "Safari gets the merge")
    }

    @Test func aRecordSafariHeldBackIsMergedWhenItArrives() throws {
        try phone.put(["id": "s1", "title": "Pasta", "updatedAt": "2026-10-25T10:00:00.000Z"])
        try syncAll(cloud, phone, mac)
        let page = try pull(0)
        try ExtensionMirror.hold([["store": "items", "key": "s1"]], in: mac.db)
        try phone.put(["id": "s1", "title": "Cacio e pepe", "userFields": ["title"], "updatedAt": "2026-10-25T10:30:00.000Z"])
        try syncAll(cloud, phone, mac)
        _ = try ExtensionMirror.receive([["store": "items", "key": "s1", "rev": 1, "body": ["id": "s1", "title": "Pasta", "note": "for Sunday", "updatedAt": "2026-10-25T11:00:00.000Z"]]], cursor: page.cursor, into: mac.db)
        let s = try mac.item("s1")
        #expect(s?["title"] as? String == "Cacio e pepe")
        #expect(s?["note"] as? String == "for Sunday")
    }

    @Test func aiSettingsGoBothWays() throws {
        _ = try ExtensionMirror.receive([["store": "kv", "key": "aiSettings", "rev": 1, "body": ["key": "aiSettings", "value": ["model": "claude-sonnet-5-5"]]]], cursor: 0, into: mac.db)
        try syncAll(cloud, mac, phone)
        #expect((try phone.db.settings([RecordDatabase.settingsKey])[RecordDatabase.settingsKey] as? [String: Any])?["ai"] as? [String: String] == ["model": "claude-sonnet-5-5"])
        let cursor = try pull(0).cursor
        try phone.db.setSettings([RecordDatabase.settingsKey: ["ai": ["model": "claude-opus-5-5"]]])
        try syncAll(cloud, phone, mac)
        let ai = try pull(cursor).changes.first { $0["key"] as? String == "aiSettings" }
        #expect(((ai?["body"] as? [String: Any])?["value"] as? [String: String])?["model"] == "claude-opus-5-5")
    }

    @Test func pullsComeInBatches() throws {
        let picture = "data:image/jpeg;base64," + String(repeating: "A", count: 3 * 1024 * 1024)
        for i in 0..<3 { try phone.put(["id": "s\(i)", "image": picture, "updatedAt": "2026-10-25T10:00:00.000Z"]) }
        try syncAll(cloud, phone, mac)
        var cursor: Int64 = 0, got = 0, pages = 0
        repeat {
            let page = try pull(cursor)
            got += page.changes.count; cursor = page.cursor; pages += 1
            if !page.more { break }
        } while pages < 10
        #expect(got == 3)
        #expect(pages == 3)
    }

    @Test func turningSyncOffInSafariForgetsTheCopy() throws {
        try phone.put(["id": "s1", "title": "Lamp", "updatedAt": "2026-10-25T10:00:00.000Z"])
        try syncAll(cloud, phone, mac)
        try ExtensionMirror.forget(mac.db)
        #expect(try mac.db.count("items") == 0)
        #expect(try mac.db.pendingChanges().isEmpty, "forgetting the copy deletes nothing in iCloud")
        #expect(try pull(0).changes.isEmpty)
        #expect(cloud.records[SyncID(store: "items", key: "s1")!] != nil)
    }
}
