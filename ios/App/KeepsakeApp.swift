import SwiftUI
import WidgetKit
import KeepsakeKit
import KeepsakeUI

@main
struct KeepsakeApp: App {
    @State private var model = LibraryModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .keepsakeAppearance(model.appearance)
        }
    }
}

/// Holds the library for the app's screens.
@MainActor @Observable
final class LibraryModel {
    private(set) var saves: [Save] = []
    private(set) var reviewCount = 0
    private(set) var problem: String?
    private(set) var loaded = false
    var toast: Toast?
    /// "🎉 Cooked!": a moment in the middle of the screen when a stamp lands.
    var celebration: Toast?
    /// Theme, density, cards, haptics and sound (Settings → Appearance), shared with the extensions.
    var appearance = LibraryModel.startingAppearance() {
        didSet {
            appearance.save()
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
    /// A save to open in a tab's stack (from a widget link).
    var opening: (stack: String, id: String)?
    /// ⌘F on iPad: focus the Library's search.
    var focusSearch = false
    let library: Library?

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let text: String
        var undo: (@MainActor () async -> Void)?
        static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
    }

    /// The saved appearance; in Debug, -ksTheme <id> overrides it (screenshots of every theme).
    static func startingAppearance() -> Appearance {
        var a = Appearance.load()
        #if DEBUG
        if let theme = UserDefaults.standard.string(forKey: "ksTheme") { a.theme = theme }
        #endif
        return a
    }

    init() {
        do {
            // UI tests pass a name in KEEPSAKE_DB for a fresh library in the app's temporary folder.
            let name = ProcessInfo.processInfo.environment["KEEPSAKE_DB"]
            library = try Library(path: name.map { NSTemporaryDirectory() + $0 + ".sqlite" })
        } catch {
            library = nil
            problem = "Keepsake couldn't open your library. \(error.localizedDescription)"
        }
    }

    func start() async {
        guard let library else { return }
        // The Library reads SQLite straight away; the shared store starts alongside (it is only needed
        // for writes), so a usable Library never waits on JavaScript.
        Task {
            do {
                try await library.prepare()
                #if DEBUG
                // Screenshots and UI tests: -importOnLaunch <path to a Chrome export> fills an empty library.
                if let path = UserDefaults.standard.string(forKey: "importOnLaunch"), (try? library.saves().isEmpty) == true {
                    _ = try? await library.importExport(try Data(contentsOf: URL(fileURLWithPath: path)), replace: true)
                }
                // Performance runs on a device: -seedPerf 5000 fills an empty library with that many products.
                let seed = UserDefaults.standard.integer(forKey: "seedPerf")
                if seed > 0, (try? library.saves().isEmpty) == true {
                    _ = try? await library.importExport(Self.syntheticExport(seed), replace: true)
                }
                #endif
                finishSaves()
            } catch {
                problem = error.localizedDescription
            }
        }
        do {
            for try await list in library.observeSaves() {
                saves = list
                reviewCount = list.filter { $0.needsCollection && $0.purchased != true }.count
                loaded = true
                widgetsChanged()
            }
        } catch {
            problem = error.localizedDescription
        }
    }

    #if DEBUG
    static func syntheticExport(_ n: Int) -> Data {
        let titles = ["Two-person ultralight tent", "Noise-cancelling headphones", "Enameled Dutch oven", "Waxed field jacket", "Ceramic bedside lamp", "Burr coffee grinder"]
        var items: [String: Any] = [:]
        let iso = ISO8601DateFormatter()
        for i in 0..<n {
            let id = "perf-\(i)"
            items[id] = ["id": id, "title": "\(titles[i % titles.count]) #\(i + 1)", "url": "https://shop\(i % 40).example.com/p/\(i + 1)",
                         "price": Double(i % 300) + 9.99, "currency": "USD", "retailer": "Test Shop \(i % 40)", "kind": "product",
                         "createdAt": iso.string(from: Date(timeIntervalSinceNow: Double(-i) * 3600))]
        }
        return (try? JSONSerialization.data(withJSONObject: ["format": "keepsake-export", "schemaVersion": 3, "collections": [:], "items": items])) ?? Data()
    }
    #endif

    /// Picks up saves made in the Share Extension while the app was in the background.
    func refresh() {
        guard let library, let list = try? library.saves() else { return }
        saves = list
        reviewCount = list.filter { $0.needsCollection && $0.purchased != true }.count
    }

    /// The after-save work that's turned on (AI tidy, Lifestyle fill-in), for saves made in the Share
    /// Extension or while the app was away. Runs quietly; changes appear as they land.
    func finishSaves() {
        guard let library else { return }
        Task {
            try? await library.finishSaves()
            refresh()
        }
    }

    /// Rewrites the widgets' snapshot and asks WidgetKit to redraw them.
    func widgetsChanged() {
        guard let library else { return }
        Task {
            _ = try? await library.writeWidgetSnapshot()
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    func show(_ text: String, undo: (@MainActor () async -> Void)? = nil) {
        toast = Toast(text: text, undo: undo)
    }

    /// "Cooked!", "Cool!", "Purchased!": shown big in the middle of the screen for a moment.
    func celebrate(_ text: String) {
        celebration = Toast(text: text)
    }

    func importFile(_ url: URL) async {
        guard let library else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let before = saves.count
            _ = try await library.importExport(try Data(contentsOf: url), replace: false)
            refresh()
            show("Imported \(max(0, saves.count - before)) saves from Chrome")
            Haptic.saved()
        } catch {
            show(error.localizedDescription)
            Haptic.refused()
        }
    }

    /// Saves a link from the clipboard the way the Share Sheet does.
    func pasteLink(_ text: String?) async {
        guard let library, let text, let link = text.firstLink ?? (text.hasPrefix("http") ? text : nil) else {
            show("Copy a link first, then tap Paste")
            return
        }
        do {
            let r = try await library.capture(product: await library.sharedProduct(url: link, title: nil, text: nil), source: "paste")
            refresh()
            if let dup = r.duplicateOf {
                show("Already saved: \(dup.title)")
            } else if let s = r.save {
                Haptic.saved()
                show("Saved to \(r.destination ?? KindStyle(s.kind).label)") { [weak self] in
                    try? await library.undoSave(s.id)
                    self?.refresh()
                }
            }
        } catch {
            show(error.localizedDescription)
        }
    }

    func trash(_ save: Save) async {
        guard let library else { return }
        try? await library.trash([save.id])
        Haptic.trashed()
        refresh()
        show("Moved to Trash") { [weak self] in
            try? await library.restore([save.id])
            self?.refresh()
        }
    }

    func setDone(_ save: Save, _ done: Bool) async {
        try? await library?.update(save.id, ["status": done ? "done" : "saved"])
        refresh()
    }
}

extension String {
    var firstLink: String? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        return detector?.firstMatch(in: self, range: NSRange(startIndex..., in: self))?.url?.absoluteString
    }
}
