import SwiftUI
import UIKit
import UserNotifications
import CloudKit
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
        // Silent pushes from iCloud when another device changes the library (CloudSync's engine listens).
        application.registerForRemoteNotifications()
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
    private(set) var saves: [Save] = [] {
        didSet {
            index = SaveIndex(saves)
            reviewCount = index.review.count
        }
    }
    /// The groupings screens draw from, worked out once per library change rather than on every redraw.
    private(set) var index = SaveIndex([])
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
    /// Apple Intelligence is ready, or Optional AI is on with a key: the Fix with AI buttons show.
    private(set) var aiReady = false
    /// Apple Intelligence on this device (OnDeviceAI): it reads every save first.
    private(set) var appleAI = OnDeviceAI.Status.unsupported
    /// Optional AI is on with a key: your provider takes over when Apple Intelligence can't help.
    private(set) var aiBackup = false
    /// A Fix with AI run in progress (one save, a collection, a Lifestyle view or everything).
    var aiRun: AIRun?
    struct AIRun: Equatable {
        var done: Int
        let total: Int
        var stopping = false
        /// Run AI on imported saves (rather than Fix with AI): the bar says "Reading" and offers Pause.
        var imported = false
        /// Find on the map (Places): the bar and progress screen say "Finding", and Stop leaves the rest for next time.
        var mapping = false
        /// Your provider asked to slow down: the bar says so until then.
        var waitingUntil: Date?
        let startedAt = Date()
        /// The saves your provider is reading right now (the progress screen shows them).
        var current: [String] = []
        /// What it just did, newest first, a few lines for the progress screen.
        var recent: [WorkLine] = []
        /// iOS ended the time it gave the run in the background: what's left waits for "Finish fixing".
        var cutOff = false
    }
    /// Saves a Fix with AI run didn't get to before iOS stopped it: Home offers "Finish fixing".
    var aiFixLeft = AIFixLeft.ids { didSet { AIFixLeft.ids = aiFixLeft } }
    /// iCloud's first copy of a library (turning sync on): records sent so far, for the progress screen.
    var syncRun: SyncRun?
    struct SyncRun: Equatable {
        var total: Int
        var left: Int
        let startedAt = Date()
        var done: Int { max(0, total - left) }
    }
    /// How the last long run ended, for the progress screen's last page (Done).
    var workEnd: WorkEnd?
    struct WorkEnd: Equatable {
        let title: String
        let text: String
        /// The last few things it did, shown under the ending.
        var lines: [WorkLine] = []
        var undo: (@MainActor () async -> Void)?
        static func == (a: WorkEnd, b: WorkEnd) -> Bool { a.title == b.title && a.text == b.text && a.lines == b.lines }
    }
    /// The progress screen for a long run (Fix everything, imports, iCloud's first copy) is up.
    var workShowing = false
    /// Which screen presents it: Settings while its sheet is open (a cover can't go over a sheet from below).
    var workHost = WorkHost.root
    enum WorkHost { case root, settings }
    /// Where Move to… can send saves (every Lifestyle view and collection), for the long-press menus.
    var destinations: [Destination] = []
    /// Saves waiting on "New collection…" from a Move to menu: RootView asks for the name, then moves them.
    var newCollectionFor: [String]?
    /// Counts collection changes no save count shows (deleting an empty one, Undo), so lists reload.
    var collectionsChanged = 0
    /// Imported saves your provider hasn't read yet (needsAi), newest first.
    var aiBacklog: [Save] { index.aiBacklog }
    let library: Library?
    /// iCloud sync (Settings → iCloud).
    let cloud: SyncModel

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
        #if DEBUG
        // UI tests: -ks.freshAppleNote YES shows Home's Apple Intelligence note again (a launch argument
        // for ks.appleAINoteSeen itself would pin it, so Dismiss couldn't hide it).
        if UserDefaults.standard.bool(forKey: "ks.freshAppleNote") { UserDefaults.standard.removeObject(forKey: "ks.appleAINoteSeen") }
        #endif
        do {
            // UI tests pass a name in KEEPSAKE_DB for a fresh library in the app's temporary folder.
            let name = ProcessInfo.processInfo.environment["KEEPSAKE_DB"]
            let library = try Library(path: name.map { NSTemporaryDirectory() + $0 + ".sqlite" })
            self.library = library
            ThumbnailStore.shared.use(library)
            // A few indexed reads, so Home opens filled in rather than waiting on the whole library.
            let first = try? library.glance()
            glance = first
            reviewCount = first?.reviewCount ?? 0
            cloud = SyncModel(database: library.database)
        } catch {
            library = nil
            problem = "Internet Binder couldn't open your library. \(error.localizedDescription)"
            cloud = SyncModel(database: nil)
        }
        cloud.onRemoteChange = { [weak self] in self?.syncChanged() }
        cloud.onTurned = { [weak self] on in if on { self?.beginSyncRun() } else { self?.endSyncRun() } }
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
                if let path = UserDefaults.standard.string(forKey: "importOnLaunch"), (try? library.isEmpty()) == true {
                    _ = try? await library.importExport(try Data(contentsOf: URL(fileURLWithPath: path)), replace: true)
                }
                // Performance runs on a device: -seedPerf 5000 fills an empty library with that many products.
                let seed = UserDefaults.standard.integer(forKey: "seedPerf")
                if seed > 0, (try? library.isEmpty()) == true {
                    _ = try? await library.importExport(Self.syntheticExport(seed), replace: true)
                }
                #endif
                finishSaves()
                await refreshAIReady()
                await loadDestinations()
                cloud.decide { (try? library.isEmpty()) ?? true }
            } catch {
                problem = error.localizedDescription
            }
        }
        do {
            for try await list in library.observeSaves() {
                // An in-process write arrives here and from the refresh() after it: the second, unchanged
                // list would redraw every screen that reads the library for nothing.
                if list != saves { saves = list }
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

    // MARK: iCloud sync

    /// Records from another device landed: lists, collections, AI settings and widgets catch up.
    private func syncChanged() {
        refresh()
        collectionsChanged += 1
        widgetsChanged()
        Task { await refreshAIReady() }
    }

    /// Picks up saves made in the Share Extension while the app was in the background. Read off the main
    /// thread, so a tap that calls it never waits on the whole library.
    func refresh() { Task { await reload() } }

    /// One read of the library at a time: calls that land while one runs share a single read after it (an
    /// AI run or an Undo asks several times in a row), rather than each reading every save again.
    @ObservationIgnored private var reloading: Task<Void, Never>?
    @ObservationIgnored private var reloadAgain = false
    func reload() async {
        guard let library else { return }
        if let reloading {
            reloadAgain = true
            await reloading.value
            return
        }
        let run = Task {
            repeat {
                reloadAgain = false
                let list = try? await Task.detached(priority: .userInitiated) { try library.saves() }.value
                // Unchanged (the usual case after a write this app made, which observeSaves already showed):
                // nothing redraws.
                if let list, list != saves { saves = list }
                await loadDestinations()
            } while reloadAgain
            reloading = nil
        }
        reloading = run
        await run.value
    }

    /// The after-save work that's turned on (AI tidy, Lifestyle fill-in), for saves made in the Share
    /// Extension or while the app was away, and Apple Intelligence reading a few saves it hasn't yet
    /// (views.readOnDevice). Runs quietly, one run at a time; changes appear as they land.
    func finishSaves() {
        guard let library, !finishing else { return }
        finishing = true
        Task {
            try? await library.finishSaves()
            finishing = false
            refresh()
        }
    }
    @ObservationIgnored private var finishing = false

    /// Whether the Fix with AI buttons show (after Settings turns Optional AI on or off, or a key changes).
    func refreshAIReady() async {
        appleAI = OnDeviceAI.status
        aiBackup = await library?.aiBackupReady() ?? false
        aiReady = await library?.aiReady() ?? false
    }

    /// Who reads saves again when you ask (Fix with AI), for the confirmations: your provider with your key
    /// (Apple Intelligence has had its go already), else Apple Intelligence on this iPhone.
    var aiReadsAgain: String {
        aiBackup || appleAI != .ready
            ? "Your AI provider reads each save again: what it is from its picture, a product's shop page, and where it goes."
            : "Apple Intelligence reads each save again on this iPhone, so nothing leaves it."
    }

    /// Rewrites the widgets' snapshot and asks WidgetKit to redraw them, once things settle: a run of
    /// changes (an import, Fix with AI on a collection) writes it once, not once per save.
    private var widgetWrite: Task<Void, Never>?
    func widgetsChanged() {
        guard let library else { return }
        widgetWrite?.cancel()
        widgetWrite = Task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
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
            await reload()
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

/// A library's saves grouped the ways the screens show them. Built once per change (a few milliseconds for
/// thousands of saves) so a redraw reads a dictionary instead of filtering every save.
struct SaveIndex {
    var byId: [String: Save] = [:]
    var byKind: [String: [Save]] = [:]
    var byCollection: [String: [Save]] = [:]
    var hostCounts: [String: Int] = [:]
    var collected: [Save] = []
    var lifestyle: [Save] = []
    var review: [Save] = []
    var aiBacklog: [Save] = []
    /// Saved over six weeks ago and not opened since (Home's "Come back to" in Chrome).
    var comeBackTo: Save?
    /// Changes when a save comes or goes or its status changes (what the map's places depend on).
    var placesKey = 0

    nonisolated(unsafe) private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    init(_ saves: [Save], now: Date = Date()) {
        let cutoff = now.addingTimeInterval(-42 * 86_400)
        func old(_ s: String?) -> Bool { s.flatMap { Self.iso.date(from: $0) }.map { $0 < cutoff } ?? true }
        var places = Hasher()
        byId.reserveCapacity(saves.count)
        for s in saves {
            byId[s.id] = s
            byKind[s.kind, default: []].append(s)
            if let c = s.collectionId, !c.isEmpty { byCollection[c, default: []].append(s); collected.append(s) }
            if let h = s.host, !h.isEmpty { hostCounts[h, default: 0] += 1 }
            if s.hasOwnView { lifestyle.append(s) }
            if s.needsCollection && s.purchased != true { review.append(s) }
            if s.needsAi == true { aiBacklog.append(s) }
            if comeBackTo == nil, s.status != "done", s.purchased != true, old(s.createdAt), old(s.openedAt) { comeBackTo = s }
            places.combine(s.id)
            places.combine(s.status)
            // A place's name, area and pin too, so Places redraws as Find on the map pins them.
            if s.kind == "place" {
                places.combine(s.title)
                places.combine(s.details?["locality"]?.string)
                places.combine(s.details?["region"]?.string)
                places.combine(s.details?["lat"]?.number)
            }
        }
        placesKey = places.finalize()
    }

    func kind(_ k: String) -> [Save] { byKind[k] ?? [] }
    func collection(_ id: String) -> [Save] { byCollection[id] ?? [] }
}

extension String {
    var firstLink: String? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        return detector?.firstMatch(in: self, range: NSRange(startIndex..., in: self))?.url?.absoluteString
    }
}
