import Testing
import Foundation
import CryptoKit
import AVFoundation
@testable import KeepsakeKit
import KeepsakeUI

func fixture(_ name: String) throws -> Data {
    let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")!
    return try Data(contentsOf: url)
}

func json(_ data: Data) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: data) as! [String: Any]
}

func tempDatabase(secrets: SecretStore = MemorySecrets()) throws -> RecordDatabase {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-tests-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return try RecordDatabase(path: dir.appendingPathComponent("library.sqlite").path, secrets: secrets)
}

/// Records compared field by field, ignoring the time of the write (set by every import, on both platforms).
func comparable(_ records: [String: Any]) -> NSDictionary {
    var out: [String: Any] = [:]
    for (id, r) in records {
        var rec = r as! [String: Any]
        rec.removeValue(forKey: "updatedAt")
        out[id] = rec
    }
    return out as NSDictionary
}

func byId(_ list: Any?) -> [String: Any] {
    Dictionary(uniqueKeysWithValues: ((list as? [[String: Any]]) ?? []).map { ($0["id"] as! String, $0 as Any) })
}

@Suite("Sealer matches WebCrypto")
struct SealerTests {
    @Test func vectors() throws {
        let file = try json(fixture("sealer-vectors"))
        for v in file["vectors"] as! [[String: String]] {
            let phone = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data(hex: v["phonePrivate"]!)!)
            let chrome = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data(hex: v["chromePrivate"]!)!)
            #expect(phone.publicKey.rawRepresentation.hex == v["phonePublic"])
            #expect(chrome.publicKey.rawRepresentation.hex == v["chromePublic"])

            let code = try #require(Sealer.PairingCode(v["pairingCode"]!))
            #expect(code.mailboxId.hex == v["mailboxId"])
            #expect(code.text == v["pairingCode"])

            let sealer = try Sealer(privateKey: phone, peerPublicKey: code.publicKey, mailboxId: code.mailboxId)
            #expect(sealer.key.withUnsafeBytes { Data($0) }.hex == v["key"], "\(v["name"]!): key")
            let chromeSide = try Sealer(privateKey: chrome, peerPublicKey: phone.publicKey, mailboxId: code.mailboxId)
            #expect(chromeSide.key == sealer.key)

            let nonce = try AES.GCM.Nonce(data: Data(hex: v["nonce"]!)!)
            let sealed = try sealer.seal(Data(v["plaintext"]!.utf8), recordName: v["recordName"]!, nonce: nonce)
            #expect(sealed.hex == v["sealed"], "\(v["name"]!): sealed bytes")
            let opened = try chromeSide.open(Data(hex: v["sealed"]!)!, recordName: v["recordName"]!)
            #expect(String(decoding: opened, as: UTF8.self) == v["plaintext"])
            #expect(throws: (any Error).self) { try sealer.open(sealed, recordName: "another-record") }
        }
    }

    @Test func rejectsBadPairingCodes() {
        #expect(Sealer.PairingCode("keepsake-pair:v2:AAAA:BBBB") == nil)
        #expect(Sealer.PairingCode("hello") == nil)
        #expect(Sealer.PairingCode("keepsake-pair:v1:AAECAwQFBgcICQoLDA0ODw:short") == nil)
    }
}

@Suite("Chrome export, both ways")
struct ImportExportTests {
    @Test func importMatchesChrome() async throws {
        let db = try tempDatabase()
        let core = try KeepsakeCore(database: db)
        try await core.call("store.init")
        let export = try json(fixture("chrome-export"))
        try await core.call("store.importJSON", [export, ["mode": "replace"]])
        let mine = try await core.call("store.exportJSON") as! [String: Any]
        let chrome = try json(fixture("chrome-reimport"))

        #expect(mine["format"] as? String == "keepsake-export")
        #expect(mine["schemaVersion"] as? Int == chrome["schemaVersion"] as? Int)
        #expect(comparable(mine["items"] as! [String: Any]) == comparable(chrome["items"] as! [String: Any]))
        #expect(comparable(mine["collections"] as! [String: Any]) == comparable(chrome["collections"] as! [String: Any]))
        #expect(comparable(byId(mine["goals"])) == comparable(byId(chrome["goals"])))
        #expect(comparable(byId(mine["checkins"])) == comparable(byId(chrome["checkins"])))
        #expect((mine["prefs"] as! NSDictionary) == (chrome["prefs"] as! NSDictionary))
        #expect((mine["importHistory"] as! NSDictionary) == (chrome["importHistory"] as! NSDictionary))
    }

    @Test func exportReimportsLosslessly() async throws {
        let a = try KeepsakeCore(database: try tempDatabase())
        try await a.call("store.init")
        try await a.call("store.importJSON", [try json(fixture("chrome-export")), ["mode": "replace"]])
        let first = try await a.callJSON("store.exportJSON")

        let b = try KeepsakeCore(database: try tempDatabase())
        try await b.call("store.init")
        try await b.callJSON("store.importJSON", argsJSON: "[\(first), {\"mode\":\"replace\"}]")
        let second = try json(Data(try await b.callJSON("store.exportJSON").utf8))
        let original = try json(Data(first.utf8))
        #expect(comparable(second["items"] as! [String: Any]) == comparable(original["items"] as! [String: Any]))
        #expect(comparable(byId(second["goals"])) == comparable(byId(original["goals"])))
    }

    @Test func storesRecordsWithQueryableColumns() async throws {
        let db = try tempDatabase()
        let core = try KeepsakeCore(database: db)
        try await core.call("store.init")
        try await core.call("store.importJSON", [try json(fixture("chrome-export")), ["mode": "replace"]])
        let (total, trashed, places) = try await db.pool.read { d in
            (try Int.fetchOne(d, sql: "SELECT COUNT(*) FROM item")!,
             try Int.fetchOne(d, sql: "SELECT COUNT(*) FROM item WHERE deletedAt IS NOT NULL")!,
             try Int.fetchOne(d, sql: "SELECT COUNT(*) FROM item WHERE kind = 'place'")!)
        }
        #expect(total == 12)
        #expect(trashed == 1)
        #expect(places == 2)
        let outbox = try await db.pool.read { d in try d.tableExists("outbox") }
        #expect(!outbox, "no change log grows beside the records")
    }

    @Test func rejectsWhatChromeRejects() async throws {
        let core = try KeepsakeCore(database: try tempDatabase())
        try await core.call("store.init")
        await #expect(throws: CoreError.failed("This file is not an Internet Binder export (missing format marker).")) {
            try await core.call("store.importJSON", [["items": [:]]])
        }
        await #expect(throws: CoreError.self) {
            try await core.call("store.importJSON", [["format": "keepsake-export", "schemaVersion": 99]])
        }
    }
}

@Suite("Shared rules in JavaScriptCore")
struct RulesTests {
    @Test func goldenClassification() async throws {
        let core = try KeepsakeCore(database: try tempDatabase())
        let export = try json(fixture("chrome-export"))
        let collections = Array((export["collections"] as! [String: Any]).values)
        let golden = try JSONSerialization.jsonObject(with: try fixture("golden-classify")) as! [[String: Any]]
        let prefs = try await core.call("KeepsakeCore.categorizer.emptyPrefs")
        for g in golden {
            let input = g["input"] as! [String: Any]
            let kind = try await core.call("KeepsakeCore.kinds.kindOf", [input])
            #expect((kind as? String) == (g["kindOf"] as? String), "kindOf \(input["url"]!)")
            let key = try await core.call("KeepsakeCore.url.normalizeUrl", [input["url"]!])
            #expect((key as? String) == (g["urlKey"] as? String))
            let c = try await core.call("KeepsakeCore.categorizer.classify", [input, ["collections": collections, "prefs": prefs]])
            #expect((c as! NSDictionary) == (g["classify"] as! NSDictionary), "classify \(input["title"]!)")
        }
    }
}

@Suite("Settings and secrets")
struct SettingsTests {
    @Test func secretNeverReachesSQLiteOrExport() async throws {
        let secrets = MemorySecrets()
        let db = try tempDatabase(secrets: secrets)
        let core = try KeepsakeCore(database: db)
        try await core.call("store.init")
        try await core.call("store.setSecret", ["aiApiKey", "sk-test-not-real"])
        #expect(secrets.read()?.contains("sk-test-not-real") == true)
        let inSQLite = try await db.pool.read { d in try String.fetchAll(d, sql: "SELECT value FROM setting") }.joined()
        #expect(!inSQLite.contains("sk-test-not-real"))
        let export = try await core.callJSON("store.exportJSON")
        #expect(!export.contains("sk-test-not-real"))
        let back = try await core.call("store.getSecret", ["aiApiKey"])
        #expect((back as? String) == "sk-test-not-real")
    }
}

@Suite("Two processes, one library")
struct SharedLibraryTests {
    @Test func appAndExtensionSeeEachOthersSaves() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-shared-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("library.sqlite").path
        let app = try KeepsakeCore(database: try RecordDatabase(path: path, secrets: MemorySecrets()))
        let ext = try KeepsakeCore(database: try RecordDatabase(path: path, secrets: MemorySecrets()))
        try await app.call("store.init")
        try await ext.call("store.init")
        async let a: Any = app.call("store.addItem", [["title": "From the app", "url": "https://example.com/a"]])
        async let b: Any = ext.call("store.addItem", [["title": "From the share sheet", "url": "https://example.com/b"]])
        _ = try await (a, b)
        let items = try await app.call("store.getItems") as! [[String: Any]]
        #expect(Set(items.compactMap { $0["title"] as? String }).isSuperset(of: ["From the app", "From the share sheet"]))
    }

    @Test func concurrentUpdatesDontLoseWrites() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-cas-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("library.sqlite").path
        let app = try KeepsakeCore(database: try RecordDatabase(path: path, secrets: MemorySecrets()))
        let ext = try KeepsakeCore(database: try RecordDatabase(path: path, secrets: MemorySecrets()))
        try await app.call("store.init")
        // Both processes record imports at once: each is a read-modify-write of one kv record.
        try await withThrowingTaskGroup(of: Void.self) { group in
            for i in 0..<40 {
                let core = i % 2 == 0 ? app : ext
                group.addTask { try await core.call("store.markImported", [[["https://www.instagram.com/p/post\(i)/", "item\(i)"]]]) }
            }
            try await group.waitForAll()
        }
        let history = try await app.call("store.getImportHistory") as! [String: Any]
        #expect((history["instagram"] as! [String: Any]).count == 40, "no write lost")
    }
}

@Suite("Capture follows Chrome's rules")
struct CaptureTests {
    // These tests fake your provider; Apple Intelligence on this Mac would answer first (in memory only).
    init() { UserDefaults.standard.register(defaults: ["ks.appleAIStatus": "unsupported"]) }

    func library() throws -> Library {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-capture-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return try Library(path: dir.appendingPathComponent("library.sqlite").path, secrets: MemorySecrets())
    }

    /// isEmpty asks SQLite instead of reading every save, and a save in the Trash doesn't count.
    @Test func emptyMeansNothingOutsideTheTrash() async throws {
        let lib = try library()
        #expect(try lib.isEmpty())
        let save = try await lib.capture(url: "https://example.com/trowel", title: "Trowel")
        #expect(try lib.isEmpty() == false)
        try await lib.trash([save.id])
        #expect(try lib.isEmpty())
    }

    /// Every write to a save moves the revision the shared code's cached list is keyed on, and a search
    /// after a change sees it.
    @Test func itemsRevisionMovesOnEveryWrite() async throws {
        let lib = try library()
        let start = try lib.database.itemsRevision()
        let save = try await lib.capture(url: "https://example.com/trowel", title: "Trowel")
        let added = try lib.database.itemsRevision()
        #expect(added > start)
        #expect(try await lib.search("trowel").items.map(\.id) == [save.id])
        try await lib.update(save.id, ["title": "Garden trowel"])
        #expect(try lib.database.itemsRevision() > added)
        #expect(try await lib.search("garden").items.map(\.id) == [save.id])
        try await lib.trash([save.id])
        #expect(try await lib.search("trowel").items.isEmpty)
    }

    @Test func bareLinkStaysALink() async throws {
        let r = try await library().capture(product: Library.sharedProduct(url: "https://example.com/", title: "Example Domain", text: nil))
        #expect(r.save?.kind == "link")
    }

    @Test func addressDecidesTheKind() async throws {
        let lib = try library()
        #expect(try await lib.capture(product: Library.sharedProduct(url: "https://www.youtube.com/watch?v=abcdefghijk", title: "Dumplings", text: nil)).save?.kind == "video")
        #expect(try await lib.capture(product: Library.sharedProduct(url: "https://letterboxd.com/film/the-long-summer/", title: "The Long Summer", text: nil)).save?.kind == "media")
        #expect(try await lib.capture(product: Library.sharedProduct(url: "https://maps.apple.com/?q=Ramen%20Kiri&ll=35.6595,139.7005", title: "Maps", text: nil)).save?.kind == "place")
    }

    @Test func pageDataMakesAProduct() async throws {
        let page: [String: Any] = ["url": "https://shop.example.com/p/1", "title": "Burr coffee grinder", "price": "$129.00", "schemaTypes": ["Product"], "image": "https://shop.example.com/g.jpg"]
        let r = try await library().capture(product: page)
        #expect(r.save?.kind == "product")
        #expect(r.save?.price == 129)
    }

    /// Deleting collections returns an undo that round-trips through JSON and restores them exactly.
    @Test func deleteCollectionsUndoes() async throws {
        let lib = try library()
        let a = try await lib.createCollection(named: "Garden")
        let b = try await lib.createCollection(named: "Bikes")
        let save = try await lib.capture(url: "https://example.com/trowel", title: "Trowel")
        try await lib.move([save.id], to: a.id)
        let undo = try await lib.deleteCollections([a.id, b.id])
        #expect(undo != nil)
        #expect(try lib.collections().contains { $0.id == a.id } == false)
        #expect(try lib.save(save.id)?.collectionId == nil)
        try await lib.restoreCollections(undo!)
        #expect(try lib.collections().filter { [a.id, b.id].contains($0.id) }.count == 2)
        #expect(try lib.save(save.id)?.collectionId == a.id)
        #expect(try await lib.deleteCollections(["missing"]) == nil)
    }

    @Test func sameLinkTwiceIsADuplicate() async throws {
        let lib = try library()
        let p = Library.sharedProduct(url: "https://example.com/a?utm_source=x", title: "A", text: nil)
        let first = try await lib.capture(product: p)
        let again = try await lib.capture(product: Library.sharedProduct(url: "https://example.com/a", title: "A", text: nil))
        #expect(again.duplicateOf?.id == first.save?.id)
    }

    /// A post page as Instagram serves it logged out: meta tags only (the caption is in og:description).
    struct PostPage: NetworkTransport {
        let html: String
        func send(_ request: URLRequest) async throws -> (status: Int, body: Data) {
            #expect(request.url?.absoluteString == "https://www.instagram.com/reel/AbCdEf12345/")
            #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
            return (200, Data(html.utf8))
        }
    }

    @Test func sharedInstagramReelIsReadLikeChrome() async throws {
        let caption = "Brown butter pasta &#x1f35d;\n\nIngredients\n- 350 g rigatoni\n- 90 g butter\n- 12 sage leaves\n\nMethod\n1. Boil the pasta.\n2. Brown the butter.\n#pasta"
        let html = """
        <html><head><title>Instagram</title>
        <meta property="og:title" content="Mia Chen on Instagram: &quot;Brown butter pasta&quot;" />
        <meta property="og:image" content="https://scontent.cdninstagram.com/v/pasta.jpg?stp=1&amp;oe=1" />
        <meta property="og:url" content="https://www.instagram.com/miachen/reel/AbCdEf12345/" />
        <meta property="og:description" content="1,204 likes, 33 comments - miachen on October 11, 2026: &quot;\(caption.replacingOccurrences(of: "\\n", with: "&#10;"))&quot;. " />
        </head><body></body></html>
        """
        let lib = try library()
        let p = await lib.sharedProduct(url: "https://www.instagram.com/miachen/reel/AbCdEf12345/?igsh=xyz", title: nil, text: nil, transport: PostPage(html: html))
        #expect(p["image"] as? String == "https://scontent.cdninstagram.com/v/pasta.jpg?stp=1&oe=1")
        let r = try await lib.capture(product: p)
        #expect(r.save?.kind == "recipe")
        #expect(r.save?.hasImage == true)
        #expect(r.save?.title.contains("Brown butter pasta") == true)
    }

    /// Your AI provider, faked: it files every save it's asked about in Home Decor (the shopping check's
    /// answer, or the filing answer for a link). The save's own page
    /// (read first, without cookies) isn't there.
    struct FakeProvider: NetworkTransport {
        func send(_ request: URLRequest) async throws -> (status: Int, body: Data) {
            if request.url?.host() != "api.openai.com" {
                #expect(request.httpMethod == "GET" && request.value(forHTTPHeaderField: "Cookie") == nil)
                return (404, Data())
            }
            var answer = #"{"items":[{"ref":"i0","collection":"Home Decor","confidence":0.92,"reason":"cushions for a sofa"}]}"#
            // Filing a link (shared/filing.js): the collection by its ref, and words of the save as evidence.
            let sent = (String(data: request.httpBody ?? Data(), encoding: .utf8) ?? "").replacingOccurrences(of: "\\\"", with: "\"")
            if sent.contains("THEIR OWN collections") {
                let ref = sent.firstMatch(of: #/"ref":"(c\d+)","name":"Home Decor"/#).map { String($0.1) } ?? "c1"
                answer = #"{"type":"link","topic":"home decor","collection":"\#(ref)","evidence":["Linen thing"],"needsReview":false}"#
            }
            let body: [String: Any] = ["choices": [["message": ["content": answer]]], "output_text": answer]
            return (200, try JSONSerialization.data(withJSONObject: body))
        }
    }

    @Test func fixWithAIFilesAReviewSaveWithUndo() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-ai-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let lib = try Library(path: dir.appendingPathComponent("library.sqlite").path, secrets: MemorySecrets(), transport: FakeProvider())
        #expect(await lib.aiReady() == false)
        try await lib.prepare()
        try await lib.updateSettings(["ai": ["on": true, "provider": "openai"]])
        try await lib.setAIKey("sk-test")
        #expect(await lib.aiReady() == true)
        let saved = try #require(try await lib.capture(product: Library.sharedProduct(url: "https://example.com/linen-thing", title: "Linen thing", text: nil)).save)
        #expect(saved.needsCollection)
        let r = try await lib.fixWithAI([saved.id])
        #expect(r.error.isEmpty)
        #expect(r.filed.first?.collection == "Home Decor")
        #expect(try lib.save(saved.id)?.needsCollection == false)
        try await lib.undoAI(r.logIds ?? [])
        #expect(try lib.save(saved.id)?.needsCollection == true)
    }

    @Test func instagramLoginWallStaysALink() async throws {
        let wall = #"<html><head><title>Login • Instagram</title></head><body><form id="loginForm"><input name="username"></form></body></html>"#
        let lib = try library()
        let p = await lib.sharedProduct(url: "https://www.instagram.com/reel/AbCdEf12345/", title: nil, text: nil, transport: PostPage(html: wall))
        #expect(p["igBundle"] == nil)
        #expect(try await lib.capture(product: p).save?.kind == "link")
    }
}

@Suite("Screens list what Chrome lists")
struct ViewsTests {
    func imported() async throws -> Library {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-views-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let lib = try Library(path: dir.appendingPathComponent("library.sqlite").path, secrets: MemorySecrets())
        _ = try await lib.importExport(try fixture("chrome-export"), replace: true)
        return lib
    }

    var expected: [String: Any] { get throws { try json(fixture("views-expected")) } }

    @Test func reviewQueue() async throws {
        let lib = try await imported()
        #expect(try await lib.review().map(\.id) == (try expected["review"] as! [String]))
    }

    @Test func searchRanksAndCorrectsLikeChrome() async throws {
        let lib = try await imported()
        for (query, raw) in try expected["search"] as! [String: [String: Any]] {
            let r = try await lib.search(query)
            #expect(r.items.map(\.id) == raw["ids"] as! [String], "results for \(query)")
            #expect(r.query == raw["query"] as? String, "query for \(query)")
            #expect(r.corrected == raw["corrected"] as? Bool, "corrected for \(query)")
        }
    }

    @Test func placesByStateAndReview() async throws {
        let lib = try await imported()
        let view = try await lib.places()
        let want = try expected["places"] as! [[String: Any]]
        let waiting = Set(want.filter { !($0["reasons"] as! [String]).isEmpty }.map { $0["id"] as! String })
        #expect(Set(view.review.map(\.item.id)) == waiting)
        for w in view.review {
            let reasons = want.first { $0["id"] as? String == w.item.id }!["reasons"] as! [String]
            #expect(w.reasons == reasons)
        }
        let listed = view.groups.flatMap { g in g.cities.flatMap { c in c.items.map { ($0.id, g.state) } } }
        for (id, state) in listed {
            let s = want.first { $0["id"] as? String == id }!["state"] as? String
            #expect(state == (s ?? "Somewhere"))
        }
        #expect(listed.count + view.review.count == want.count)
    }

    @Test func goalsAndCheckIns() async throws {
        let lib = try await imported()
        let workout = try #require(try await lib.saves(ofKind: "recipe").first { $0.title == "Morning mobility" })
        let before = try await lib.goals(for: workout.id)
        #expect(before.count == 1)
        let goalId = try await lib.createGoal(itemId: workout.id, perWeek: 2, weeks: 3)
        let checkin = try await lib.checkIn(goalId: goalId, sets: 3, reps: 10)
        var mine = try #require(try await lib.goals(for: workout.id).first { $0.goal.id == goalId })
        #expect(mine.progress.strip?.count == 3)
        #expect(mine.progress.summary == "1 of 2 this week · week 1 of 3")
        #expect(mine.progress.ring == 0.5)
        try await lib.undoCheckIn(checkin)
        mine = try #require(try await lib.goals(for: workout.id).first { $0.goal.id == goalId })
        #expect(mine.progress.summary == "0 of 2 this week · week 1 of 3")
    }

    @Test func editsAreProtectedAndMovesLearn() async throws {
        let lib = try await imported()
        let save = try #require(try await lib.review().first)
        let col = try await lib.createCollection(named: "Kitchen")
        try await lib.move([save.id], to: col.id)
        #expect(try await lib.saves(inCollection: col.id).map(\.id) == [save.id])
        #expect(try await lib.review().contains { $0.id == save.id } == false)
        try await lib.update(save.id, ["title": "Blue Dutch oven"])
        let raw = try #require(try lib.database.get("items", save.id))
        let rec = try json(Data(raw.utf8))
        #expect((rec["userFields"] as? [String])?.contains("title") == true)
        let prefs = try await lib.core.call("store.getPrefs") as! [String: Any]
        #expect(!(prefs["learnedKeywords"] as? [String: Any] ?? [:]).isEmpty, "moving out of Review teaches the categorizer")
    }

    // Once per library, the saves already filed teach the sorter; read through the picture-free list.
    @Test func filedLibraryTeachesTheSorterOnce() async throws {
        let lib = try await imported()
        let taught = try await lib.core.call("store.learnFromLibrary") as? Int ?? -1
        #expect(taught >= 0)
        #expect(try await lib.core.call("store.learnFromLibrary") as? Int == 0, "only once")
        let prefs = try await lib.core.call("store.getPrefs") as! [String: Any]
        #expect(prefs["libraryLearnedAt"] is String)
    }

    // The share sheet's path: one move teaches it, the next similar save lands there, and Done on
    // the card (kept where it went) teaches it a little more, once.
    @Test func shareSheetChoicesTeachTheSorter() async throws {
        let lib = try await imported()
        let col = try await lib.createCollection(named: "Trip prep")
        let first = try #require(try await lib.capture(product: ["title": "Titanium camp stove", "url": "https://shop.example/stove"]).save)
        #expect(first.collectionId != col.id, "it knows nothing about Trip prep yet")
        _ = try await lib.put([first.id], in: col.id)
        let next = try await lib.capture(product: ["title": "Camp stove windscreen", "url": "https://shop.example/screen"])
        let second = try #require(next.save)
        #expect(second.collectionId == col.id, "learned from the move")
        #expect(next.destination == "Trip prep")
        func weight() async throws -> Double {
            let prefs = try await lib.core.call("store.getPrefs") as! [String: Any]
            let entry = (prefs["learnedKeywords"] as? [String: Any])?["stove"] as? [String: Any]
            return (entry?[col.id] as? NSNumber)?.doubleValue ?? 0
        }
        let before = try await weight()
        try await lib.confirmFiling(second.id)
        #expect(try await weight() == before + 0.5, "kept where it went: a quiet lesson")
        try await lib.confirmFiling(second.id)
        #expect(try await weight() == before + 0.5, "only once per save")
    }
}

@Suite("Card facts")
struct FactTests {
    @Test func everySaveGetsChromesKeyFact() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-facts-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let lib = try Library(path: dir.appendingPathComponent("library.sqlite").path, secrets: MemorySecrets())
        _ = try await lib.importExport(try fixture("chrome-export"), replace: true)
        let saves = try lib.saves()
        let recipe = try #require(saves.first { $0.title == "Brown butter pasta with sage" })
        #expect(recipe.fact == "3 ingredients")
        let facts = try json(fixture("views-expected"))["facts"] as! [String: String]
        for save in saves { #expect(save.fact == facts[save.id], "fact of \(save.title)") }
        #expect(try await lib.review().allSatisfy { $0.fact != nil })
        // Rows written without a fact (older libraries) are filled in when the library opens.
        try await lib.database.pool.write { try $0.execute(sql: "UPDATE item SET fact = NULL") }
        let reopened = try Library(path: dir.appendingPathComponent("library.sqlite").path, secrets: MemorySecrets())
        try await reopened.prepare()
        #expect(try reopened.saves().first { $0.id == recipe.id }?.fact == "3 ingredients")
    }

    /// The Share Extension opens the library with tidy: false, so it never reads across the whole library
    /// (iOS shut the share sheet down for memory when it did). It still saves.
    @Test func shareSheetLibrarySkipsTheTidyUp() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-tidy-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("library.sqlite").path
        let lib = try Library(path: path, secrets: MemorySecrets())
        _ = try await lib.importExport(try fixture("chrome-export"), replace: true)
        try await lib.database.pool.write { try $0.execute(sql: "UPDATE item SET fact = NULL") }
        let share = try Library(path: path, secrets: MemorySecrets(), tidy: false)
        try await share.prepare()
        #expect(try share.saves().allSatisfy { $0.fact == nil }, "no backfill in the share sheet")
        let r = try await share.capture(product: Library.sharedProduct(url: "https://www.instagram.com/p/C0ffee123/", title: nil, text: nil))
        #expect(r.save != nil)
    }
}

@Suite("Where saves go")
struct DestinationTests {
    func library() throws -> Library {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-dest-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return try Library(path: dir.appendingPathComponent("library.sqlite").path, secrets: MemorySecrets())
    }

    @Test func lifestyleFirstThenCollections() async throws {
        let lib = try library()
        let d = try await lib.destinations()
        let firstCollection = try #require(d.firstIndex { $0.group == "collection" })
        #expect(d[..<firstCollection].allSatisfy { $0.group == "lifestyle" })
        #expect(d.contains { $0.value == "kind:place" && $0.label == "Places" })
    }

    @Test func intoAPlaceThenIntoACollection() async throws {
        let lib = try library()
        let saved = try #require(try await lib.capture(product: Library.sharedProduct(url: "https://example.com/spot", title: "Café Lumen", text: "Best flat white 📍 Café Lumen, Lisbon")).save)
        #expect(try await lib.put([saved.id], in: "kind:place") == "Places")
        #expect(try lib.saves().first { $0.id == saved.id }?.kind == "place")
        let col = try await lib.createCollection(named: "Gifts")
        #expect(try await lib.put([saved.id], in: col.id) == "Gifts")
        let after = try #require(try lib.saves().first { $0.id == saved.id })
        #expect(after.kind == "link")
        #expect(after.collectionId == col.id)
    }

    /// The Share Sheet's covers and counts: a few saves per group, counted without reading every save.
    @Test func shelfHoldsAFewPerGroupAndCountsThemAll() async throws {
        let lib = try library()
        let col = try await lib.createCollection(named: "Gifts")
        var ids: [String] = []
        for i in 0..<5 {
            let s = try #require(try await lib.capture(product: Library.sharedProduct(url: "https://example.com/gift-\(i)", title: "Gift \(i)", text: nil)).save)
            try await lib.put([s.id], in: col.id)
            ids.append(s.id)
        }
        let newest = try #require(try await lib.capture(product: Library.sharedProduct(url: "https://example.com/new", title: "New", text: nil)).save)
        let shelf = try lib.shelf(perGroup: 3, excluding: newest.id)
        #expect(shelf.counts[col.id] == 5)
        #expect(shelf.saves.filter { $0.collectionId == col.id }.count == 3)
        #expect(!shelf.saves.contains { $0.id == newest.id })
        try await lib.trash([ids[0]])
        #expect(try lib.shelf(excluding: newest.id).counts[col.id] == 4)
        let d = try await lib.destinations()
        #expect(d.contains { $0.value == col.id })
    }

    /// The Share Sheet's Review card: how many wait in Review, and a few of them for its fan.
    @Test func waitingCountsWhatsInReview() async throws {
        let lib = try library()
        let a = try #require(try await lib.capture(product: Library.sharedProduct(url: "https://example.com/a", title: "A thing", text: nil)).save)
        let b = try #require(try await lib.capture(product: Library.sharedProduct(url: "https://example.com/b", title: "Another", text: nil)).save)
        try await lib.toReview([a.id, b.id])
        #expect(try lib.waiting(excluding: b.id).count == 1)
        #expect(try lib.waiting().saves.map(\.id).sorted() == [a.id, b.id].sorted())
        try await lib.put([a.id], in: "kind:place")
        #expect(try lib.waiting().count == 1)
    }

    /// Home's first frame: the glance matches what the whole library says, without reading it all.
    @Test func glanceMatchesTheWholeLibrary() async throws {
        let lib = try library()
        let col = try await lib.createCollection(named: "Gifts")
        var ids: [String] = []
        for i in 0..<10 {
            let s = try #require(try await lib.capture(product: Library.sharedProduct(url: "https://example.com/g-\(i)", title: "Gift \(i)", text: nil)).save)
            ids.append(s.id)
        }
        try await lib.put(Array(ids[0..<3]), in: col.id)
        try await lib.put([ids[3]], in: "kind:place")
        try await lib.put([ids[4]], in: "kind:recipe")
        try await lib.trash([ids[9]])
        let all = try lib.saves()
        let g = try lib.glance()
        #expect(g.recent.map(\.id) == Array(all.prefix(8)).map(\.id))
        let collected = all.filter { !($0.collectionId ?? "").isEmpty }, lifestyle = all.filter(\.hasOwnView)
        #expect(g.collectedCount == collected.count)
        #expect(g.collected.map(\.id) == Array(collected.prefix(12)).map(\.id))
        #expect(g.lifestyleCount == 2)
        #expect(g.lifestyleCount == lifestyle.count)
        #expect(g.lifestyleKinds == Set(lifestyle.map(\.kind)).count)
        #expect(g.reviewCount == all.filter { $0.needsCollection && $0.purchased != true }.count)
        #expect(g.collections == (try lib.collections()).count)
    }

    @Test func undoRemovesOutright() async throws {
        let lib = try library()
        let saved = try #require(try await lib.capture(product: Library.sharedProduct(url: "https://example.com/oops", title: "Oops", text: nil)).save)
        try await lib.undoSave(saved.id)
        #expect(try lib.saves().isEmpty)
        #expect(try lib.saves(trash: true).isEmpty)
    }
}

/// Records requests and answers like OpenStreetMap; anything else gets a 404.
final class FakeNetwork: NetworkTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    var requests: [URLRequest] { lock.withLock { _requests } }
    func send(_ request: URLRequest) async throws -> (status: Int, body: Data) {
        lock.withLock { _requests.append(request) }
        if request.url?.host() == "nominatim.openstreetmap.org" {
            let body = #"[{"lat":"38.7139","lon":"-9.1394","name":"Café Lumen","display_name":"Café Lumen, Rua Augusta, Lisboa","type":"cafe","osm_type":"node","osm_id":1,"address":{"road":"Rua Augusta","house_number":"12","city":"Lisbon","state":"Lisboa","country":"Portugal"}}]"#
            return (200, Data(body.utf8))
        }
        return (404, Data())
    }
}

@Suite("Network only where you turned it on")
struct NetworkTests {
    func library(_ net: FakeNetwork) throws -> Library {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-net-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return try Library(path: dir.appendingPathComponent("library.sqlite").path, secrets: MemorySecrets(), transport: net)
    }

    func place(_ lib: Library) async throws -> Save {
        let s = try #require(try await lib.capture(product: Library.sharedProduct(url: "https://example.com/lumen", title: "Café Lumen", text: nil)).save)
        try await lib.put([s.id], in: "kind:place")
        try await lib.update(s.id, ["title": "Café Lumen", "details": ["locality": "Lisbon"]])
        return s
    }

    @Test func nothingLeavesWhenEverythingIsOff() async throws {
        let net = FakeNetwork()
        let lib = try library(net)
        _ = try await place(lib)
        try await lib.finishSaves()
        #expect(net.requests.isEmpty)
    }

    @Test func placesLookupFillsThePin() async throws {
        let net = FakeNetwork()
        let lib = try library(net)
        let s = try await place(lib)
        try await lib.updateSettings(["lookups": ["places": true]])
        try await lib.finishSaves()
        #expect(net.requests.allSatisfy { $0.url?.host() == "nominatim.openstreetmap.org" })
        #expect(net.requests.allSatisfy { $0.value(forHTTPHeaderField: "Cookie") == nil })
        #expect(!net.requests.isEmpty)
        let after = try #require(try lib.save(s.id))
        #expect(after.details?["lat"]?.number == 38.7139)
        #expect(after.details?["address"]?.string == "12 Rua Augusta")
        // Filled once: a second run sends nothing.
        let count = net.requests.count
        try await lib.finishSaves()
        #expect(net.requests.count == count)
    }

    @Test func allowlistFollowsSettings() {
        #expect(NetworkPolicy.allowedHosts(settings: [:], hasAIKey: true).isEmpty)
        #expect(NetworkPolicy.allowedHosts(settings: ["ai": ["on": true, "provider": "anthropic"]], hasAIKey: false).isEmpty, "no key, no AI")
        #expect(NetworkPolicy.allowedHosts(settings: ["ai": ["on": true, "provider": "anthropic"]], hasAIKey: true) == ["api.anthropic.com"])
        #expect(NetworkPolicy.allowedHosts(settings: ["ai": ["on": true, "baseUrl": "http://insecure.example"]], hasAIKey: true).isEmpty, "https only")
        #expect(NetworkPolicy.allowedHosts(settings: ["lookups": ["media": true, "books": false]], hasAIKey: false) == ["www.wikidata.org"])
    }

    @Test func aiWithoutPermissionIsRefused() async throws {
        let net = FakeNetwork()
        let lib = try library(net)
        await #expect(throws: CoreError.self) { try await lib.testAI() }
        #expect(net.requests.isEmpty)
    }
}

/// Timing at 5,000 saves. Runs only with KEEPSAKE_PERF_FILE pointing at a Chrome export
/// (replica/tools/make_test_library.mjs makes one).
@Suite("Performance at 5,000 saves")
struct PerformanceTests {
    /// A Chrome-shaped export of `n` products (like make_test_library.mjs), for devices that can't read a Mac file.
    static func syntheticExport(_ n: Int) throws -> URL {
        var items: [String: Any] = [:]
        let titles = ["Two-person ultralight tent", "Noise-cancelling headphones", "Enameled Dutch oven", "Waxed field jacket", "Ceramic bedside lamp", "Burr coffee grinder"]
        for i in 0..<n {
            let id = "perf-\(i)"
            items[id] = ["id": id, "title": "\(titles[i % titles.count]) #\(i + 1)", "url": "https://shop\(i % 40).example.com/p/\(i + 1)",
                         "price": Double(i % 300) + 9.99, "currency": "USD", "retailer": "Test Shop \(i % 40)", "kind": "product",
                         "createdAt": ISO8601DateFormatter().string(from: Date(timeIntervalSinceNow: Double(-i) * 3600))]
        }
        let data = try JSONSerialization.data(withJSONObject: ["format": "keepsake-export", "schemaVersion": 3, "collections": [:], "items": items])
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("perf-\(n).json")
        try data.write(to: url)
        return url
    }

    @Test(.enabled(if: ProcessInfo.processInfo.environment["KEEPSAKE_PERF_FILE"] != nil || ProcessInfo.processInfo.environment["KEEPSAKE_PERF"] != nil))
    func libraryOpensFast() async throws {
        let file = try ProcessInfo.processInfo.environment["KEEPSAKE_PERF_FILE"].map { URL(fileURLWithPath: $0) } ?? Self.syntheticExport(5000)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-perf-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let path = dir.appendingPathComponent("library.sqlite").path
        var lib: Library? = try Library(path: path, secrets: MemorySecrets())
        let clock = ContinuousClock()
        let importTime = try await clock.measure { _ = try await lib!.importExport(try Data(contentsOf: file), replace: true) }
        lib = nil
        // A cold open: a new Library on the same file, then the Library screen's first read.
        var reopened: Library!
        let openTime = try clock.measure { reopened = try Library(path: path, secrets: MemorySecrets()) }
        var count = 0
        let readTime = try clock.measure { count = try reopened.saves().count }
        let prepareTime = try await clock.measure { try await reopened.prepare() }
        print("PERF store start (JavaScriptCore + init) \(prepareTime)")
        let searchTime = try await clock.measure { _ = try await reopened.search("dutch oven") }
        print("PERF import \(importTime) · open \(openTime) · first read of \(count) saves \(readTime) · search \(searchTime)")
        if ProcessInfo.processInfo.environment["KEEPSAKE_PERF_FILE"] == nil { #expect(count == 5000) }
        #expect(openTime + readTime < .milliseconds(400), "usable Library under 400 ms")
    }
}

@Suite("Pictures stay out of lists")
struct ListPictureTests {
    func library() async throws -> Library {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-pics-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let lib = try Library(path: dir.appendingPathComponent("library.sqlite").path, secrets: MemorySecrets())
        _ = try await lib.importExport(try fixture("chrome-export"), replace: true)
        return lib
    }

    /// A save's own picture (a `data:` URL, stored twice in the body) is left out of every list read and
    /// read on its own when drawn; the save itself still has it.
    @Test func listsCarryAMarkerAndThePictureIsReadOnItsOwn() async throws {
        let lib = try await library()
        let save = try #require(try lib.saves().first)
        let picture = "data:image/jpeg;base64," + String(repeating: "QUJD", count: 5000)
        try await lib.database.pool.write {
            try $0.execute(sql: "UPDATE item SET body = json_set(body, '$.image', ?, '$.images', json_array(?)) WHERE key = ?", arguments: [picture, picture, save.id])
        }
        let listed = try #require(try lib.saves().first { $0.id == save.id })
        #expect(listed.image == Save.storedPicturePrefix + "\(picture.utf8.count)")
        #expect(listed.hasImage && listed.hasStoredPicture)
        #expect(try lib.picture(save.id) == picture)
        #expect(try lib.save(save.id)?.image == picture)
        #expect(try lib.glance().recent.first { $0.id == save.id }?.hasStoredPicture == true)
        // The shared code's lists get the marker too; its own reads of the save keep the picture.
        let found = try await lib.search(save.title)
        #expect(found.items.first { $0.id == save.id }?.hasStoredPicture == true)
        let stored = try #require(try await lib.core.call("store.getItem", [save.id]) as? [String: Any])
        #expect(stored["image"] as? String == picture)
        #expect((stored["images"] as? [String])?.first == picture)
    }

    /// Opening the library only empties the Trash of saves trashed over 30 days ago, and finds them from the
    /// column rather than reading every save.
    @Test func purgeTrashStillRemovesOldSaves() async throws {
        let lib = try await library()
        let saves = try lib.saves()
        try await lib.trash([saves[0].id, saves[1].id])
        try await lib.database.pool.write {
            try $0.execute(sql: "UPDATE item SET deletedAt = '2020-01-01T00:00:00.000Z', body = json_set(body, '$.deletedAt', '2020-01-01T00:00:00.000Z') WHERE key = ?", arguments: [saves[0].id])
        }
        #expect(try await lib.core.call("store.purgeTrash") as? Int == 1)
        #expect(try lib.save(saves[0].id) == nil)
        let trash = try lib.saves(trash: true).map(\.id)
        #expect(trash.contains(saves[1].id) && !trash.contains(saves[0].id), "a save trashed today stays")
        #expect(try await lib.core.call("store.purgeTrash") as? Int == 0)
    }
}

@Suite("Widget snapshot")
struct WidgetSnapshotTests {
    @Test func checkInShowsInTheSnapshot() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-widget-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let lib = try Library(path: dir.appendingPathComponent("library.sqlite").path, secrets: MemorySecrets())
        _ = try await lib.importExport(try fixture("chrome-export"), replace: true)
        let workout = try #require(try lib.saves().first { $0.title == "Push-up ladder" })
        let goalId = try await lib.createGoal(itemId: workout.id, perWeek: 3, weeks: 4)
        func snapshot() async throws -> WidgetSnapshot {
            try JSONDecoder().decode(WidgetSnapshot.self, from: Data(try await lib.core.callJSON("views.widgetSnapshot").utf8))
        }
        #expect(try await snapshot().goals.first { $0.goalId == goalId }?.summary == "0 of 3 this week · week 1 of 4")
        try await lib.checkIn(goalId: goalId)   // what the widget's Done today button runs
        let goal = try #require(try await snapshot().goals.first { $0.goalId == goalId })
        #expect(goal.summary == "1 of 3 this week · week 1 of 4")
        #expect(goal.weeks.first?.count == 1)
        #expect(try await snapshot().count == 11)
    }
}

@Suite("Collections")
struct CollectionTests {
    func library() throws -> Library {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("keepsake-col-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return try Library(path: dir.appendingPathComponent("library.sqlite").path, secrets: MemorySecrets())
    }

    @Test func keywordsFileNewSaves() async throws {
        let lib = try library()
        let col = try await lib.createCollection(named: "Cookware")
        try await lib.updateCollection(col.id, ["keywords": ["skillet", "saucepan"]])
        let page: [String: Any] = ["url": "https://shop.example.com/p/9", "title": "Cast iron skillet 26 cm", "price": "$45.00", "schemaTypes": ["Product"]]
        let saved = try #require(try await lib.capture(product: page).save)
        #expect(saved.collectionId == col.id, "the keyword files it")
    }

    @Test func deletingSendsSavesToReview() async throws {
        let lib = try library()
        let col = try await lib.createCollection(named: "Gifts")
        let s = try #require(try await lib.capture(product: Library.sharedProduct(url: "https://example.com/gift", title: "A gift", text: nil)).save)
        try await lib.put([s.id], in: col.id)
        try await lib.deleteCollection(col.id)
        let after = try #require(try lib.save(s.id))
        #expect(after.collectionId == nil)
        #expect(after.needsCollection)
        #expect(try lib.collections().contains { $0.id == col.id } == false)
    }
}

@Suite("Ingredients for each cooking step")
struct StepIngredientsTests {
    let carbonara = StepIngredients(
        steps: ["Cook the guanciale slowly until crisp; keep the fat.", "Whisk the yolks, egg and pecorino with lots of pepper.",
                "Boil the spaghetti in salted water until just al dente.",
                "Toss the pasta in the pan off the heat, then stir in the egg mix with a splash of pasta water until glossy."],
        ingredients: ["200 g spaghetti", "100 g guanciale", "3 egg yolks", "1 whole egg", "50 g pecorino romano, grated", "Black pepper"])

    @Test func amounts() {
        #expect(StepIngredients.split("200 g spaghetti") == ("200 g", "spaghetti"))
        #expect(StepIngredients.split("3 cloves garlic") == ("3 cloves", "garlic"))
        #expect(StepIngredients.split("Pinch of salt") == ("Pinch", "salt"))
        #expect(StepIngredients.split("Black pepper") == ("", "Black pepper"))
        #expect(StepIngredients.split("1 onion, sliced") == ("1", "onion, sliced"))
        #expect(StepIngredients.split("2 portions fresh ramen noodles") == ("2 portions", "fresh ramen noodles"))
        #expect(StepIngredients.split("½ tsp salt") == ("½ tsp", "salt"))
        #expect(StepIngredients.split("250g flour") == ("250g", "flour"))
        #expect(StepIngredients.split("1 cup (150 g) fine cornmeal (fubá)") == ("1 cup (150 g)", "fine cornmeal (fubá)"))
        #expect(StepIngredients.split("(395 g) sweetened condensed milk") == ("(395 g)", "sweetened condensed milk"))
    }

    @Test func eachStepGetsWhatItNames() {
        #expect(carbonara.steps.map(\.items) == [[1], [2, 3, 4, 5], [0], []])
        #expect(carbonara.unmatched.isEmpty)
    }

    @Test func laterStepsCarryEarlierOnes() {
        // "the pasta" is the spaghetti boiled in step 3; "the egg mix" is step 2's yolks and egg.
        #expect(carbonara.steps[3].carried == [.init(fromStep: 2, items: [0]), .init(fromStep: 1, items: [2, 3])])
    }

    @Test func groupWordsAndLeftovers() {
        let s = StepIngredients(steps: ["Boil the pasta.", "Add garlic and spices.", "Toss."],
                                ingredients: ["350 g rigatoni", "3 cloves garlic", "1 tsp cumin", "12 sage leaves"])
        #expect(s.steps.map(\.items) == [[0], [1, 2], []])
        #expect(s.unmatched == [3])
    }

    @Test func highlightsNameTheIngredients() {
        let text = "Whisk the yolks, egg and pecorino with lots of pepper."
        #expect(carbonara.highlights(in: text, step: 1).map { String(text[$0]) } == ["yolks", "egg", "pecorino", "pepper"])
        let last = "Toss the pasta in the pan off the heat, then stir in the egg mix with a splash of pasta water until glossy."
        #expect(carbonara.highlights(in: last, step: 3).map { String(last[$0]) } == ["pasta", "egg", "pasta"])
    }
}

/// The iPhone keeps its own copies of two shared rules, for screens that draw without waiting on the core.
/// These run the shared JavaScript next to them, so a change made on one side only fails here.
@Suite("Swift copies match the shared code")
struct SharedCopiesTests {
    static let recipes: [(steps: [String], ingredients: [String])] = [
        (["Cook the guanciale slowly until crisp; keep the fat.", "Whisk the yolks, egg and pecorino with lots of pepper.",
          "Boil the spaghetti in salted water until just al dente.",
          "Toss the pasta in the pan off the heat, then stir in the egg mix with a splash of pasta water until glossy."],
         ["200 g spaghetti", "100 g guanciale", "3 egg yolks", "1 whole egg", "50 g pecorino romano, grated", "Black pepper"]),
        (["Boil the pasta.", "Add garlic and spices.", "Toss."], ["350 g rigatoni", "3 cloves garlic", "1 tsp cumin", "12 sage leaves"]),
        (["Whisk the cornmeal and condensed milk.", "Fold in the eggs, then bake with the herbs."],
         ["1 cup (150 g) fine cornmeal (fubá)", "(395 g) sweetened condensed milk", "Pinch of salt", "2-3 eggs", "250g flour",
          "½ tsp ground cinnamon", "2 portions fresh ramen noodles", "a handful of basil leaves"]),
    ]

    @Test func stepIngredients() async throws {
        let core = try KeepsakeCore(database: try tempDatabase())
        for r in Self.recipes {
            let js = try await core.call("KeepsakeCore.stepIngredients.stepIngredients", [r.steps, r.ingredients]) as! [String: Any]
            let swift = StepIngredients(steps: r.steps, ingredients: r.ingredients)
            let items = (js["items"] as! [[String: Any]]).map { "\($0["amount"]!)|\($0["name"]!)" }
            #expect(items == swift.items.map { "\($0.amount)|\($0.name)" })
            let steps = (js["steps"] as! [[String: Any]]).map { step in
                "\(step["items"] as! [Int]) " + (step["carried"] as! [[String: Any]]).map { "\($0["fromStep"] as! Int):\($0["items"] as! [Int])" }.joined(separator: " ")
            }
            #expect(steps == swift.steps.map { "\($0.items) " + $0.carried.map { "\($0.fromStep):\($0.items)" }.joined(separator: " ") })
            #expect((js["unmatched"] as! [Int]) == swift.unmatched)
        }
    }

    @Test func claudeModelsAndEfforts() async throws {
        let core = try KeepsakeCore(database: try tempDatabase())
        // slice() hands back the shared list itself (the bridge only calls functions).
        let models = try await core.call("KeepsakeCore.provider.MODELS.anthropic.slice") as! [[String: String]]
        #expect(models.map { [$0["id"]!, $0["label"]!, $0["note"]!] } == ClaudeChoices.models.map { [$0.id, $0.name, $0.note] })
        let efforts = try await core.call("KeepsakeCore.provider.EFFORTS.slice") as! [[String: String]]
        #expect(efforts.map { [$0["id"]!, $0["label"]!] } == ClaudeChoices.efforts.map { [$0.id, $0.name] })
    }
}

@Suite("Sound setting's tick")
struct TickSoundTests {
    @Test func isAShortSoftWav() throws {
        let wav = TickSound.wav
        #expect(String(decoding: wav.prefix(4), as: UTF8.self) == "RIFF")
        #expect(String(decoding: wav[8..<12], as: UTF8.self) == "WAVE")
        let samples = (wav.count - 44) / 2
        #expect(samples == Int(Double(TickSound.sampleRate) * TickSound.duration))
        let peak = stride(from: 44, to: wav.count, by: 2).map { abs(Int(Int16(bitPattern: UInt16(wav[$0]) | UInt16(wav[$0 + 1]) << 8))) }.max()!
        #expect(peak > 8_000 && peak < Int(Int16.max))  // audible, never clipping
    }

    @Test func avFoundationPlaysIt() throws {
        let player = try AVAudioPlayer(data: TickSound.wav)
        #expect(abs(player.duration - TickSound.duration) < 0.01)
    }
}
