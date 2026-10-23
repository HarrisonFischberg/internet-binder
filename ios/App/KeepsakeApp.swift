import SwiftUI
import UIKit
import UserNotifications
import WidgetKit
import KeepsakeKit
import KeepsakeUI

@main
struct KeepsakeApp: App {
    @UIApplicationDelegateAdaptor private var notices: NoticeDelegate
    @State private var model = LibraryModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(notices)
                .keepsakeAppearance(model.appearance)
        }
    }
}

/// Taps on "Saved to …" notifications (SaveNotice): the link waits in `tapped` for RootView to open.
/// Set as the delegate at launch, so a tap that starts the app isn't missed.
@MainActor @Observable
final class NoticeDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    var tapped: URL?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    // The completion-handler forms, finished on the main thread: with the async forms Swift calls UIKit's
    // completion handler from a background thread, and UIKit stops the app (SIGABRT after a tap).
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler done: @escaping () -> Void) {
        let link = SaveNotice.link(from: response.notification.request.content.userInfo)
        Task { @MainActor in
            tapped = link
            done()
        }
    }

    /// Shown as a banner even while Internet Binder is open (iPad, with Safari beside it).
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        Task { @MainActor in done([.banner, .list]) }
    }
}

/// Holds the library for the app's screens.
@MainActor @Observable
final class LibraryModel {
    private(set) var saves: [Save] = []
    private(set) var reviewCount = 0
    private(set) var problem: String?
    private(set) var loaded = false
    /// Home's first frame (Recent, the shelves, their counts) until every save is read.
    private(set) var glance: Library.Glance?
    var toast: Toast?
    /// "🎉 Cooked!": a moment in the middle of the screen when a stamp lands.
    var celebration: Toast?
    /// Theme, mode, haptics and sound (Settings → Appearance), shared with the extensions.
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
    /// Optional AI is on with a key: the Fix with AI buttons show.
    private(set) var aiReady = false
    /// A Fix with AI run in progress (one save, a collection, a Lifestyle view or everything).
    var aiRun: AIRun?
    struct AIRun: Equatable {
        var done: Int
        let total: Int
        var stopping = false
        /// Run AI on imported saves (rather than Fix with AI): the bar says "Reading" and offers Pause.
        var imported = false
        /// Your provider asked to slow down: the bar says so until then.
        var waitingUntil: Date?
    }
    /// Where Move to… can send saves (every Lifestyle view and collection), for the long-press menus.
    var destinations: [Destination] = []
    /// Counts collection changes no save count shows (deleting an empty one, Undo), so lists reload.
    var collectionsChanged = 0
    /// Imported saves your provider hasn't read yet (needsAi), newest first.
    var aiBacklog: [Save] { saves.filter { $0.needsAi == true } }
    let library: Library?

    struct Toast: Identifiable, Equatable {
        let id = UUID()
        let text: String
        var undo: (@MainActor () async -> Void)?
        static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
    }

    /// The saved appearance; in Debug, -ksTheme <id> and -ksMode light|dark override it (screenshots of every theme).
    static func startingAppearance() -> Appearance {
        var a = Appearance.load()
        #if DEBUG
        if let theme = UserDefaults.standard.string(forKey: "ksTheme") { a.theme = theme }
        if let mode = UserDefaults.standard.string(forKey: "ksMode") { a.mode = mode }
        // Screenshots: the simulator's Safari keeps its share sheet light, so -ksShareMode tells the Share Extension.
        if let m = UserDefaults.standard.string(forKey: "ksShareMode") { Appearance.defaults.set(m, forKey: "ks.mode") }
        #endif
        return a
    }

    init() {
        do {
            // UI tests pass a name in KEEPSAKE_DB for a fresh library in the app's temporary folder.
            let name = ProcessInfo.processInfo.environment["KEEPSAKE_DB"]
            let library = try Library(path: name.map { NSTemporaryDirectory() + $0 + ".sqlite" })
            self.library = library
            // A few indexed reads, so Home opens filled in rather than waiting on the whole library.
            glance = try? library.glance()
            reviewCount = glance?.reviewCount ?? 0
        } catch {
            library = nil
            problem = "Internet Binder couldn't open your library. \(error.localizedDescription)"
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
                await refreshAIReady()
                await loadDestinations()
            } catch {
                problem = error.localizedDescription
            }
        }
        do {
            for try await list in library.observeSaves() {
                saves = list
                reviewCount = list.filter { $0.needsCollection && $0.purchased != true }.count
                loaded = true
                glance = nil
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
        Task { await loadDestinations() }
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

    /// Whether the Fix with AI buttons show (after Settings turns Optional AI on or off, or a key changes).
    func refreshAIReady() async {
        aiReady = await library?.aiReady() ?? false
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
            let added = max(0, saves.count - before)
            // Imported saves don't go to your AI provider by themselves: Home offers Run AI on them.
            show(added == 0 ? "Nothing new to import: those saves are already here" : "Imported \(added) \(added == 1 ? "save" : "saves")\(aiReady ? ". Run AI on them from Home when you like" : "")")
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
