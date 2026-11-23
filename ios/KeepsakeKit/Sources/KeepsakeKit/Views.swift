import Foundation

/// Any JSON value, for the parts of a record the screens read loosely (a kind's details).
public enum JSONValue: Codable, Hashable, Sendable {
    case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        case .null: try c.encodeNil()
        }
    }

    public var string: String? { if case .string(let s) = self { s } else { nil } }
    public var number: Double? { if case .number(let n) = self { n } else { nil } }
    public var array: [JSONValue]? { if case .array(let a) = self { a } else { nil } }
    public subscript(key: String) -> JSONValue? { if case .object(let o) = self { o[key] } else { nil } }
}

public struct SearchResult: Decodable, Sendable {
    public let items: [Save]
    /// The query that matched: the person's, or its correction ("Showing results for …").
    public let query: String
    public let corrected: Bool
}

public struct PlacesView: Decodable, Sendable {
    public struct City: Decodable, Sendable, Hashable { public let city: String; public let items: [Save] }
    public struct StateGroup: Decodable, Sendable, Hashable { public let state: String; public let cities: [City] }
    public struct Waiting: Decodable, Sendable, Hashable {
        public let item: Save
        /// "no place name", "no state" (places.js placeReviewReasons), "choose place" (choices below).
        public let reasons: [String]
        /// The places the place check found it could be, for you to pick (placeResolve.js placeChoices).
        public let choices: [Choice]?
    }
    public struct Choice: Decodable, Sendable, Hashable { public let name: String; public let area: String; public let why: String; public let lat: Double?; public let lng: Double? }
    public let groups: [StateGroup]
    public let review: [Waiting]
}

/// A place a save can go: a Lifestyle view ("kind:place") or a collection.
public struct Destination: Decodable, Sendable, Hashable, Identifiable {
    public let value: String
    public let label: String
    /// "lifestyle" or "collection".
    public let group: String
    public let kind: String?
    public var id: String { value }
}

/// What Internet Binder learned from your moves (categorizer.js learnedSummary), strongest first.
public struct LearnedView: Decodable, Sendable {
    public struct Term: Decodable, Sendable, Hashable { public let term: String; public let collectionId: String; public let collectionName: String; public let weight: Double }
    public struct Retailer: Decodable, Sendable, Hashable { public let host: String; public let collectionId: String; public let collectionName: String; public let count: Double }
    public let terms: [Term]
    public let retailers: [Retailer]
    public let termCount: Int
    public let moveCount: Int
}

/// Words that already file saves into a collection besides the ones you typed (categorizer.js collectionWords).
public struct CollectionWords: Decodable, Sendable {
    public struct BuiltIn: Decodable, Sendable, Hashable { public let word: String; public let label: String }
    public let learned: [String]
    public let builtIn: [BuiltIn]
    /// The built-in collection whose words these are ("Kitchen"), or nil.
    public let builtInName: String?
}

/// A save's own screen: the save plus what Chrome's code formats for it.
public struct SaveDetail: Decodable, Sendable {
    public struct Maps: Decodable, Sendable { public let google: String?; public let apple: String? }
    public let item: Save
    /// "Squats 3×12 rest 60s" (kinds.js formatExercise).
    public let exercises: [String]
    public let goals: [GoalView]
    public let maps: Maps?
    /// "25 min" (formatMinutes).
    public let time: String
    /// Where the details came from ("Recipe read by AI"), or nothing.
    public let sourceLabel: String?
    /// The fields your AI provider drafted because the save didn't say them ("ingredients", "steps", "exercises").
    public let drafted: [String]?
    /// A recipe your AI provider found online because the post never wrote one down: the page it's based on.
    /// linked: the page you pointed it to yourself (Import recipe from a link); readByAI: AI read the recipe from it.
    public struct BasedOn: Decodable, Sendable { public let url: String; public let site: String?; public let title: String?; public let linked: Bool?; public let readByAI: Bool? }
    public let basedOn: BasedOn?
}

/// What Import recipe from a link did: the site and counts, or words to show; logId undoes it.
public struct RecipeImport: Decodable, Sendable {
    public let ok: Bool
    public let error: String?
    public let site: String?
    public let ingredients: Int?
    public let steps: Int?
    public let logId: String?
}

/// What "Add product link" did (understand.js linkProductPage). `read` is false when the store wouldn't let
/// the page be read: the link is kept and nothing else changed. `price` is set when the save had none.
public struct ProductLink: Decodable, Sendable {
    public let ok: Bool
    public let error: String?
    public let site: String?
    public let read: Bool?
    /// Your AI read the page too (a rewrite); `aiError` says why it didn't when it was asked and failed.
    public let ai: Bool?
    public let aiError: String?
    /// The save's title afterwards.
    public let title: String?
    public let price: String?
    public let logId: String?
    /// What the link taught: the account that posted the save, and its other saves (ids) that no shop page
    /// has confirmed yet, which a new read can now look for in the same shop.
    public let creator: String?
    /// The shop's site the link taught for that account (empty when it taught nothing).
    public let lessonSite: String?
    public let related: [String]?
}

/// The Wish List (shared/wishlist.js): everything still to buy, from every collection and Review, with the
/// deals found for each. Prices arrive formatted ("$199.99").
public struct WishList: Decodable, Sendable, Equatable {
    public struct Offer: Decodable, Sendable, Hashable, Identifiable {
        public let store: String
        public let url: String
        public let price: String
        /// What the store calls the offer ("Black Friday deal"), or empty.
        public let sale: String
        public let note: String
        /// The price was read from the store's own page, not only from a search result.
        public let confirmed: Bool
        public let outOfStock: Bool
        /// The lowest price in stock.
        public let lowest: Bool
        /// Far below what known stores charge, at a store that isn't one: shown with a warning, never as the best price.
        public let doubt: Bool
        public var id: String { url }
    }
    public struct Row: Decodable, Sendable, Hashable, Identifiable {
        public let item: Save
        /// The collection it's in, or empty (Review).
        public let collection: String
        /// The price it was saved at, or empty.
        public let savedPrice: String
        /// "unchecked", "found", "none" (no prices found) or "unsure" (couldn't tell which product).
        public let state: String
        public let offers: [Offer]
        public let bestStore: String
        public let bestPrice: String
        /// How far the lowest price is below the saved one ("$79.01"), or empty when it isn't lower.
        public let saving: String
        public let savingPct: Int?
        public let checkedAt: String?
        /// Checked more than two days ago.
        public let old: Bool
        /// What the last lookup took the product to be ("Sony WH-1000XM6, black"), or empty.
        public let product: String
        /// The exact product in your own words, which Find deals searches for; empty when you haven't said.
        public let wishName: String
        public var id: String { item.id }
    }
    public struct Spend: Decodable, Sendable, Equatable {
        /// Dollars this month for the lookups whose model has a known price.
        public let usd: Double
        public let lookups: Int
        /// Lookups this month with no known price (another provider or model): not in usd.
        public let unpriced: Int
    }
    public let rows: [Row]
    /// Saves you took off the list, to put back.
    public let hidden: [Save]
    /// Optional AI is on with a key (Apple Intelligence can't search the web).
    public let keyReady: Bool
    /// That provider can search the web (Anthropic or OpenAI, not a custom endpoint).
    public let searchReady: Bool
    /// What Check all would look up: nothing checked in the last 12 hours.
    public let toCheck: [String]
    /// One save's row, for its own page.
    public struct One: Decodable, Sendable, Equatable {
        /// Nil when the save isn't on the Wish List (bought, hidden, not something to buy).
        public let row: Row?
        public let keyReady: Bool
        public let searchReady: Bool
    }
    /// Dollars one lookup probably costs on your key; nil when the model's price isn't known.
    public let estimateEach: Double?
    /// Find deals on this device this month.
    public let spend: Spend
}

extension Library {
    public func wishList() async throws -> WishList { try await prepare(); return try await core.call("views.wishList", as: WishList.self) }

    /// One save's Wish List row, for its own page. Nothing is looked up.
    public func wishRow(_ id: String) async throws -> WishList.One { try await prepare(); return try await core.call("views.wishRow", [id], as: WishList.One.self) }

    /// Add product link: the store page you paste becomes this save's shop page. Read once, without
    /// cookies.
    /// Undo of a product link: the shop it taught for that account is forgotten too.
    public func forgetProductLesson(creator: String, site: String) async throws {
        try await prepare()
        _ = try await core.call("views.forgetProductLesson", [creator, site])
    }

    /// `rewrite`: the page is the product, so the card is rebuilt from it (name, price, picture) and your AI
    /// reads the page for the summary, features and specs.
    public func linkProduct(_ id: String, link: String, rewrite: Bool = false) async throws -> ProductLink {
        try await prepare()
        return try await core.call("views.linkProduct", [id, link, rewrite], as: ProductLink.self)
    }

    /// What each product's card says about its deals ("Now $36.99 at Brewhaus"), by save id.
    public func dealLines() async throws -> [String: String] { try await prepare(); return try await core.call("views.dealLines", as: [String: String].self) }

    /// Find deals for one save with your own key (you asked): your provider searches the web, then each
    /// store page it found is read once, without cookies, for its price. Returns how many offers it kept.
    /// Throws the provider's error ("Provider error (429): …"); the save's last results stay.
    @discardableResult public func findDeals(_ id: String) async throws -> Int {
        try await prepare()
        return ((try await core.call("views.findDeals", [id]) as? [String: Any])?["offers"] as? Int) ?? 0
    }

    /// Takes saves off the Wish List, or puts them back. Their deals stay.
    public func setWishHidden(_ ids: [String], _ hidden: Bool) async throws { try await core.call("views.setWishHidden", [ids, hidden]) }

    /// "Not the same item": removes one store's offer and leaves that store out of this save's later
    /// lookups. Returns what `restoreOffer` needs to undo it, or nil when the offer was already gone.
    public func removeOffer(_ id: String, url: String) async throws -> String? {
        let undo = try await core.callJSON("views.removeOffer", argsJSON: try argsJSON([id, url]))
        return undo == "null" ? nil : undo
    }

    public func restoreOffer(_ id: String, _ undo: String) async throws { try await core.call("views.restoreOffer", [id, undo]) }

    /// The exact product in your words, for Find deals (the save's title stays). Empty goes back to the title.
    public func setWishName(_ id: String, _ name: String) async throws { try await core.call("views.setWishName", [id, name]) }
}

public struct GoalView: Decodable, Sendable {
    public struct Goal: Decodable, Sendable { public let id: String; public let itemId: String; public let kind: String; public let startsOn: String; public let endsOn: String? }
    public struct Week: Decodable, Sendable, Hashable { public let week: Int; public let count: Int; public let target: Int; public let met: Bool; public let current: Bool; public let past: Bool }
    public struct Progress: Decodable, Sendable {
        public let status: String
        public let summary: String
        public let ring: Double
        public let strip: [Week]?
        public let lastWeekNote: String?
    }
    public let goal: Goal
    public let progress: Progress
    /// Today's check-ins: Done today is stamped while there are any.
    public let today: [String]?
}

extension Library {
    func argsJSON(_ args: [Any]) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: args, options: .fragmentsAllowed), as: UTF8.self)
    }

    /// Saves Internet Binder wasn't sure where to put (Chrome's Review).
    public func review() async throws -> [Save] { try await prepare(); return try await core.call("views.review", as: [Save].self) }

    /// One Lifestyle view or kind ("place", "recipe", "workout", "video", "article", "media", "book", "product").
    public func saves(ofKind kind: String) async throws -> [Save] { try await prepare(); return try await core.call("views.ofKind", [kind], as: [Save].self) }

    public func saves(inCollection id: String) async throws -> [Save] { try await prepare(); return try await core.call("views.inCollection", [id], as: [Save].self) }

    public func search(_ query: String) async throws -> SearchResult { try await prepare(); return try await core.call("views.search", [query], as: SearchResult.self) }

    /// Search only these saves (one page's: a collection, a Lifestyle view, Places), ranked the same way.
    public func search(_ query: String, within ids: [String]) async throws -> SearchResult {
        try await prepare(); return try await core.call("views.search", [query, ids], as: SearchResult.self)
    }

    public func places() async throws -> PlacesView { try await prepare(); return try await core.call("views.places", as: PlacesView.self) }

    public func detail(_ id: String) async throws -> SaveDetail? {
        try await prepare()
        return try await core.call("views.detail", [id], as: SaveDetail?.self)
    }

    public func learned() async throws -> LearnedView { try await prepare(); return try await core.call("views.learned", as: LearnedView.self) }

    public func words(forCollection id: String) async throws -> CollectionWords { try await prepare(); return try await core.call("views.collectionWords", [id], as: CollectionWords.self) }

    /// Forgets every learned word and shop habit; collections and their keywords stay. Returns what
    /// `restoreLearned` needs to undo it.
    public func clearLearned() async throws -> String { try await prepare(); return try await core.callJSON("views.clearLearned") }

    /// Forgets one learned word (or, with `shop`, a shop's habit). Returns what `restoreLearned` needs to undo it.
    public func forgetLearned(_ key: String, shop: Bool = false) async throws -> String? {
        try await prepare()
        let args = String(decoding: try JSONSerialization.data(withJSONObject: [shop ? "shop" : "term", key]), as: UTF8.self)
        let undo = try await core.callJSON("views.forgetLearned", argsJSON: args)
        return undo == "null" || undo.isEmpty ? nil : undo
    }

    /// Undo for `forgetLearned` and `clearLearned`.
    public func restoreLearned(_ undo: String) async throws { _ = try await core.callJSON("views.restoreLearned", argsJSON: "[\(undo)]") }

    public func goals(for itemId: String) async throws -> [GoalView] { try await prepare(); return try await core.call("views.goals", [itemId], as: [GoalView].self) }

    // MARK: writes

    public func destinations() async throws -> [Destination] { try await prepare(); return try await core.call("views.destinations", as: [Destination].self) }

    /// Puts saves in a Lifestyle view or a collection; returns its name ("Places", "Kitchen").
    @discardableResult
    public func put(_ ids: [String], in destination: String, learn: String = "light") async throws -> String {
        try await prepare()
        return try await core.call("views.put", [ids, destination, learn], as: String.self)
    }

    /// Sends saves to Review, for when you're not sure where they go.
    public func toReview(_ ids: [String]) async throws { try await prepare(); try await core.call("views.toReview", [ids]) }

    /// "Not this kind": drops the wrong category and files the save in Review. The sorter is told too, which
    /// only helps for social posts the rules called a link. Returns the token `undoNotThisKind` takes.
    public func notThisKind(_ id: String) async throws -> Any {
        try await prepare()
        return try await core.call("views.notThisKind", [id]) as Any
    }

    /// Puts the save back as it was, and the sorter's lessons with it.
    public func undoNotThisKind(_ id: String, _ token: Any) async throws {
        try await core.call("views.undoNotThisKind", [id, token])
    }

    /// Undo right after a save: it's removed outright, never reaching the Trash.
    public func undoSave(_ id: String) async throws { try await core.call("views.undoSave", [id]) }

    /// You kept a save where it was filed (Done on the share card): a quiet lesson for the sorter, once per save.
    public func confirmFiling(_ id: String) async throws { try await core.call("views.confirmFiling", [id]) }

    /// Edits fields by hand; the shared store records them in `userFields` so AI and lookups leave them alone.
    public func update(_ id: String, _ patch: [String: Any]) async throws { try await core.call("store.updateItem", [id, patch]) }

    /// Files saves into a collection and learns from it (Chrome's Move / Review).
    public func move(_ ids: [String], to collectionId: String) async throws { try await core.call("store.moveItems", [ids, collectionId]) }

    /// Creates a collection, or returns the one with that name (case, plural and "&"/"and" differences allowed).
    @discardableResult
    public func createCollection(named name: String) async throws -> SaveCollection {
        struct Created: Decodable { let collection: SaveCollection }
        try await prepare()
        return try await core.call("store.createCollection", [["name": name]], as: Created.self).collection
    }

    /// Renames a collection, changes its keywords (what files saves there) or pins it.
    public func updateCollection(_ id: String, _ patch: [String: Any]) async throws { try await core.call("store.updateCollection", [id, patch]) }

    /// Puts collections in this order (Chrome's drag-to-reorder; pinned ones still lead).
    public func reorderCollections(_ ids: [String]) async throws { try await core.call("store.reorderCollections", [ids]) }

    /// Deletes a collection; its saves go back to Review (Chrome's rule).
    public func deleteCollection(_ id: String) async throws { try await core.call("store.deleteCollection", [id]) }

    /// Deletes several collections at once (their saves wait in Review, or go to the Trash with
    /// `deleteSaves`). Returns what `restoreCollections` needs to undo it exactly, or nil if none existed.
    public func deleteCollections(_ ids: [String], deleteSaves: Bool = false) async throws -> String? {
        try await prepare()
        let args = String(decoding: try JSONSerialization.data(withJSONObject: [ids, ["deleteItems": deleteSaves]]), as: UTF8.self)
        let undo = try await core.callJSON("store.deleteCollections", argsJSON: args)
        return undo == "null" || undo.isEmpty ? nil : undo
    }

    /// Undo for `deleteCollections`: the collections come back with their saves filed in them again.
    public func restoreCollections(_ undo: String) async throws {
        _ = try await core.callJSON("store.restoreCollections", argsJSON: "[\(undo)]")
    }

    /// "3× a week for 4 weeks".
    @discardableResult
    public func createGoal(itemId: String, perWeek: Int, weeks: Int) async throws -> String {
        let g = try await core.call("store.createGoal", [["itemId": itemId, "kind": "frequency", "spec": ["perWeek": perWeek, "weeks": weeks]]]) as? [String: Any]
        return g?["id"] as? String ?? ""
    }

    /// One-tap check-in; returns its id for Undo.
    @discardableResult
    public func checkIn(goalId: String, sets: Int? = nil, reps: Int? = nil, seconds: Int? = nil, note: String? = nil, at: Date? = nil) async throws -> String {
        var result: [String: Any] = [:]
        if let sets { result["sets"] = sets }
        if let reps { result["reps"] = reps }
        if let seconds { result["durationSeconds"] = seconds }
        if let note { result["note"] = note }
        var opts: [String: Any] = [:]
        if let at { opts["at"] = ISO8601DateFormatter.keepsake.string(from: at) }
        let c = try await core.call("store.addCheckin", [goalId, result, opts]) as? [String: Any]
        return c?["id"] as? String ?? ""
    }

    public func undoCheckIn(_ id: String) async throws { try await core.call("store.removeCheckin", [id]) }

    /// Removes a goal. It and its check-ins stay in the trash for a while, so Undo can bring it back.
    public func removeGoal(_ id: String) async throws { try await core.call("store.deleteGoal", [id]) }

    public func restoreGoal(_ id: String) async throws { try await core.call("store.restoreGoal", [id]) }
}

/// What the widgets read (written by the app to the App Group; the widget never runs the shared code).
public struct WidgetSnapshot: Codable, Sendable {
    public struct Week: Codable, Sendable, Hashable { public let week: Int; public let met: Bool; public let count: Int; public let target: Int; public let current: Bool }
    public struct Goal: Codable, Sendable, Identifiable {
        public let goalId: String
        public let itemId: String
        public let title: String
        public let summary: String
        public let ring: Double
        public let weeks: [Week]
        public var id: String { goalId }
    }
    public struct Latest: Codable, Sendable { public let id: String; public let title: String; public let kind: String; public let fact: String }
    public let at: String
    public let count: Int
    public let goals: [Goal]
    public let latest: Latest?

    public static func url(appGroup: String = "group.com.harrisonfischberg.keepsake") throws -> URL {
        URL(fileURLWithPath: try RecordDatabase.defaultPath(appGroup: appGroup)).deletingLastPathComponent().appendingPathComponent("widgets.json")
    }

    /// The last snapshot the app wrote, if any.
    public static func read() -> WidgetSnapshot? {
        guard let url = try? url(), let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }
}

extension Library {
    /// Rewrites the widgets' snapshot. Call after anything that changes what they show.
    @discardableResult
    public func writeWidgetSnapshot() async throws -> WidgetSnapshot {
        try await prepare()
        let json = try await core.callJSON("views.widgetSnapshot")
        let snap = try JSONDecoder().decode(WidgetSnapshot.self, from: Data(json.utf8))
        try Data(json.utf8).write(to: try WidgetSnapshot.url(), options: .atomic)
        return snap
    }
}

public struct ReviewSuggestions: Decodable, Sendable {
    public struct Pick: Decodable, Sendable, Hashable, Identifiable { public let value: String; public let label: String; public let isNew: Bool; public var id: String { value } }
    /// Why Internet Binder wasn't sure (the categorizer's reason).
    public let reason: String
    public let picks: [Pick]
}

public struct AIChange: Decodable, Sendable, Identifiable {
    public struct Change: Decodable, Sendable, Hashable { public let field: String; public let from: String?; public let to: String? }
    public let id: String
    public let at: String
    public let itemId: String?
    public let itemTitle: String?
    public let changes: [Change]
    public let reason: String?
    public let undone: Bool
}

/// What Fix with AI did to the saves it read.
public struct AIFixReport: Decodable, Sendable {
    public struct Filed: Decodable, Sendable { public let id: String; public let collection: String }
    public let checked: Int
    public let changed: Int
    /// Things to buy your provider named and filled in from their picture and shop page.
    public let products: Int?
    public let filed: [Filed]
    public let error: String
    /// The AI change log entries it wrote, for Undo.
    public let logIds: [String]?
}

extension Library {
    /// Runs the after-save work that is turned on (AI tidy, fill-in with AI and Lookups).
    public func finishSaves() async throws { try await prepare(); try await core.call("views.finishSaves") }
    public func fixPlace(_ id: String) async throws -> Save { try await core.call("views.fixPlace", [id], as: Save.self) }
    /// You picked one of the places Fix with AI found; it's applied as yours.
    public func choosePlace(_ id: String, index: Int) async throws -> Save { try await core.call("views.choosePlace", [id, index], as: Save.self) }
    /// None of the places Fix with AI found is it: the choices go, the save stays as it was.
    public func dismissPlaceChoices(_ id: String) async throws -> Save { try await core.call("views.dismissPlaceChoices", [id], as: Save.self) }
    /// Undo the last pick or dismiss on this save: it goes back to how it was, choices and all.
    public func undoPlace(_ id: String) async throws { try await core.call("views.undoPlace", [id]) }
    /// Find on the map: the places with no pin that haven't been looked for with what they say now, and
    /// whether Lookups → Places (OpenStreetMap) is on.
    public func placesToMap() async throws -> (ids: [String], lookupsOn: Bool) {
        try await prepare()
        let r = (try await core.call("views.placesToMap") as? [String: Any]) ?? [:]
        return (r["ids"] as? [String] ?? [], r["lookupsOn"] as? Bool ?? false)
    }
    /// One place for Find on the map: "pinned", "choose" (several it could be) or "unclear".
    public func mapPlace(_ id: String) async throws -> String {
        ((try await core.call("views.mapPlace", [id]) as? [String: Any])?["outcome"] as? String) ?? "unclear"
    }
    public func aiLog() async throws -> [AIChange] { try await prepare(); return try await core.call("views.aiLog", as: [AIChange].self) }
    @discardableResult public func undoAI(_ ids: [String]) async throws -> Int { try await core.call("views.undoAi", [ids], as: Int.self) }
    /// Optional AI is on and a key is set.
    public func aiReady() async -> Bool { (try? await core.call("views.aiReady") as? Bool) ?? false }
    /// Optional AI is on with a key, so your provider takes over when Apple Intelligence can't help.
    public func aiBackupReady() async -> Bool { (try? await core.call("views.aiBackupReady") as? Bool) ?? false }
    /// Chrome's Fix with AI for any saves: reads each again (a product from its picture and shop page) and
    /// files the ones in Review the AI is confident about.
    public func fixWithAI(_ ids: [String]) async throws -> AIFixReport { try await prepare(); return try await core.call("views.fixWithAI", [ids], as: AIFixReport.self) }
    /// Import recipe from a link: the page you pasted fills this recipe (its recipe card, or AI reads it).
    public func importRecipe(_ id: String, link: String) async throws -> RecipeImport {
        try await prepare()
        return try await core.call("views.importRecipe", [id, link], as: RecipeImport.self)
    }
    public func testAI() async throws { try await core.call("views.testAi") }
    /// Run AI on imported saves, one save (fill.js readImported): your provider reads it, then its details
    /// or collection. Throws the provider's error ("Provider error (429): …") so the caller can wait and retry.
    @discardableResult public func readImported(_ id: String) async throws -> Bool {
        try await prepare()
        return ((try await core.call("views.readImported", [id]) as? [String: Any])?["changed"] as? Bool) ?? false
    }
    public func suggestions(for id: String) async throws -> ReviewSuggestions { try await core.call("views.suggestions", [id], as: ReviewSuggestions.self) }
    /// Files a save from Review and learns from it strongly (Chrome's Review filing).
    @discardableResult public func file(_ id: String, into target: String) async throws -> String { try await core.call("views.file", [id, target], as: String.self) }

    public func settings() async throws -> [String: Any] { try await prepare(); return (try await core.call("store.getSettings") as? [String: Any]) ?? [:] }
    public func updateSettings(_ patch: [String: Any]) async throws { try await core.call("store.updateSettings", [patch]) }
    public func aiKey() async throws -> String { (try await core.call("store.getSecret", ["aiApiKey"]) as? String) ?? "" }
    public func setAIKey(_ key: String) async throws { try await core.call("store.setSecret", ["aiApiKey", key]) }
    /// Erases the whole library on this device (Chrome's Delete all local data).
    public func eraseEverything() async throws {
        try await core.call("store.clearAll")
        try await core.call("store.init")
    }
}
