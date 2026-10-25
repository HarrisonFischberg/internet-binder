import Testing
import Foundation
@testable import KeepsakeKit

/// Two libraries meeting in iCloud for the first time come out as one.
@Suite("iCloud sync: first meeting")
struct SyncDedupeTests {
    let phone: Device
    let mac: Device
    let cloud = FakeCloud()

    init() throws {
        phone = try Device()
        mac = try Device()
    }

    /// The sync engine's round plus the merge it runs after fetching.
    func meet() throws {
        for _ in 0..<3 {
            for d in [phone, mac] {
                try d.sync(cloud)
                try d.db.mergeDuplicates()
            }
        }
    }

    @Test func oneRoadtripsWithEverySave() throws {
        try phone.put("collections", ["id": "c-phone", "name": "Roadtrips", "updatedAt": "2026-10-20T10:00:00.000Z"])
        try mac.put("collections", ["id": "c-mac", "name": "roadtrips", "keywords": ["van"], "updatedAt": "2026-10-21T10:00:00.000Z"])
        try phone.put(["id": "p1", "title": "Big Sur", "collectionId": "c-phone", "urlKey": "a", "updatedAt": "2026-10-20T10:00:00.000Z"])
        try mac.put(["id": "m1", "title": "Zion", "collectionId": "c-mac", "urlKey": "b", "updatedAt": "2026-10-21T10:00:00.000Z"])
        try meet()
        for d in [phone, mac] {
            #expect(try d.db.count("collections") == 1)
            #expect(try d.db.get("collections", "c-mac") != nil, "the smaller id stays")
            #expect(try d.item("p1")?["collectionId"] as? String == "c-mac")
            #expect(try d.item("m1")?["collectionId"] as? String == "c-mac")
        }
        #expect(cloud.records[SyncID(store: "collections", key: "c-phone")!] == nil, "the other one is gone from iCloud too")
    }

    @Test func theSameLinkSavedOnBothBecomesOneSave() throws {
        try phone.put(["id": "z1", "title": "Shakshuka", "urlKey": "nyt/shakshuka", "note": "Sunday", "userFields": ["note"], "createdAt": "2026-10-01T10:00:00.000Z", "updatedAt": "2026-10-01T10:00:00.000Z"])
        try mac.put(["id": "a1", "title": "Shakshuka with feta", "urlKey": "nyt/shakshuka", "createdAt": "2026-10-05T10:00:00.000Z", "updatedAt": "2026-10-05T10:00:00.000Z"])
        try phone.put("goals", ["id": "g1", "itemId": "z1", "updatedAt": "2026-10-01T10:00:00.000Z"])
        try meet()
        for d in [phone, mac] {
            #expect(try d.db.count("items") == 1)
            let s = try #require(try d.item("a1"))
            #expect(s["title"] as? String == "Shakshuka with feta", "newer wins")
            #expect(s["note"] as? String == "Sunday", "the hand edit survives")
            #expect(s["createdAt"] as? String == "2026-10-01T10:00:00.000Z", "saved since the first time")
            #expect(try d.db.get("goals", "g1").map { try SyncJSON.object($0)["itemId"] as? String } == "a1")
        }
    }

    @Test func trashAndLinklessSavesStayApart() throws {
        try phone.put(["id": "t1", "urlKey": "x", "deletedAt": "2026-10-02T10:00:00.000Z", "updatedAt": "2026-10-02T10:00:00.000Z"])
        try mac.put(["id": "t2", "urlKey": "x", "updatedAt": "2026-10-02T10:00:00.000Z"])
        try phone.put(["id": "n1", "title": "Note", "updatedAt": "2026-10-02T10:00:00.000Z"])
        try mac.put(["id": "n2", "title": "Note", "updatedAt": "2026-10-02T10:00:00.000Z"])
        try meet()
        #expect(try phone.db.count("items") == 4)
    }

    @Test func safarisCopyHandsTheMergeToTheExtension() throws {
        mac.db.recordsOutbound = true
        try phone.put(["id": "p1", "urlKey": "a", "updatedAt": "2026-10-20T10:00:00.000Z"])
        _ = try ExtensionMirror.receive([["store": "items", "key": "m1", "rev": 1, "body": ["id": "m1", "urlKey": "a", "updatedAt": "2026-10-21T10:00:00.000Z"]]], cursor: 0, into: mac.db)
        let cursor = try ExtensionMirror.outbound(after: 0, from: mac.db).cursor
        try meet()
        let page = try ExtensionMirror.outbound(after: cursor, from: mac.db)
        #expect(page.changes.contains { $0["key"] as? String == "p1" && $0["body"] is NSNull }, "Safari drops the other copy")
    }
}
