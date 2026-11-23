import UIKit
import SwiftUI
import UniformTypeIdentifiers
import KeepsakeKit
import KeepsakeUI
import os

/// The Share Sheet way in. Saves first (one tap, no waiting), then a card shows where it went: flick
/// the slip to put it somewhere else, add a note, or undo. Stays open until you tap Done (or Undo).
///
/// iOS presents it as its own sheet. It used to ask for `.overFullScreen` with a clear background,
/// which iOS 27 shows for a moment and then drops; and a swipe down no longer closes it either, so
/// the save is only finished (and its "Saved to …" notification sent) from Done.
final class ShareViewController: UIViewController {
    private let state = ShareState()
    private var watching: [NSObjectProtocol] = []

    deinit {
        watching.forEach(NotificationCenter.default.removeObserver)
        ShareTrace.note(state.session, "let go")
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        ShareTrace.note(state.session, state.closing ? "going" : "going without Done or Undo")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        isModalInPresentation = true
        view.backgroundColor = .systemBackground
        state.finish = { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) }
        let look = Appearance.load()
        let host = UIHostingController(rootView: ShareCard(state: state).keepsakeAppearance(look))
        // Light or dark, as the chosen appearance is.
        host.overrideUserInterfaceStyle = look.colorScheme == .dark ? .dark : .light
        host.view.backgroundColor = .clear
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        ShareTrace.opens += 1
        ShareTrace.note(state.session, "opened (share \(ShareTrace.opens) in this process, running \(Int(ProcessInfo.processInfo.systemUptime - ShareTrace.began)) s)")
        // What the app it was shared from did just before a sheet went: stepped back, or left the screen.
        for (name, word) in [(NSNotification.Name.NSExtensionHostWillResignActive, "host stepped back"), (.NSExtensionHostDidBecomeActive, "host active"),
                             (.NSExtensionHostDidEnterBackground, "host left the screen"), (.NSExtensionHostWillEnterForeground, "host coming back")] {
            watching.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [session = state.session] _ in ShareTrace.note(session, word) })
        }
        // From the first moment: if iOS takes the sheet away before Done, a notice still says what happened.
        state.keepNoticeReady()
        state.capture = Task { [state] in await state.save(items: extensionContext?.inputItems as? [NSExtensionItem] ?? []) }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        state.onScreen = true
        ShareTrace.note(state.session, "appeared")
    }

    /// The sheet went without Done or Undo (the app it was shared from took it down): the standby
    /// notice is no longer pushed back, so "Saved to …" arrives in a few seconds.
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        state.onScreen = false
        ShareTrace.note(state.session, state.closing ? "gone" : "gone without Done or Undo")
    }

    override func didReceiveMemoryWarning() {
        super.didReceiveMemoryWarning()
        ShareTrace.note(state.session, "memory warning")
    }
}

/// A short diary of what each opening of the share sheet did (opened, saved, gone, and how much memory
/// was left), kept beside the library. The sheet sometimes closes by itself and leaves no crash report,
/// so this is what says whether iOS stopped it or the app it was shared from took it down. Only these
/// words and times: never a link, a title or anything else from a save. The newest ~300 lines are kept.
enum ShareTrace {
    private static let queue = DispatchQueue(label: "com.harrisonfischberg.keepsake.share.trace", qos: .utility)
    private static let file = (try? RecordDatabase.defaultPath()).map {
        URL(fileURLWithPath: $0).deletingLastPathComponent().appendingPathComponent("share-trace.log")
    }
    /// How many times the sheet has opened in this process (iOS keeps the extension around between shares),
    /// and when the process started.
    static var opens = 0
    static let began = ProcessInfo.processInfo.systemUptime
    private static let logger = Logger(subsystem: "com.harrisonfischberg.keepsake.share", category: "sheet")

    static func note(_ session: String, _ event: String) {
        let line = "\(Date().formatted(.iso8601.time(includingFractionalSeconds: true))) \(session.prefix(6)) \(event) (\(os_proc_available_memory() >> 20) MB left)"
        logger.notice("\(line, privacy: .public)")
        queue.async {
            guard let file else { return }
            var text = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
            text += line + "\n"
            let lines = text.split(separator: "\n", omittingEmptySubsequences: true)
            if lines.count > 300 { text = lines.suffix(200).joined(separator: "\n") + "\n" }
            try? Data(text.utf8).write(to: file, options: .atomic)
        }
    }
}

@MainActor @Observable
final class ShareState {
    enum Phase { case saving, saved, duplicate, failed(String) }
    /// The two libraries a save can live in.
    enum Shelf: Hashable { case collections, lifestyle }
    static let review = "review"
    /// What's already waiting in Review (not counting this save).
    var waiting = Library.Waiting()
    var phase: Phase = .saving
    var save: Save?
    var destinations: [Destination] = []
    /// A few saves from each group for its cover, and how many each holds (never the whole library).
    var shelfPreview = Library.Shelf()
    var destination: String?          // Destination.value, or `review`
    var destinationLabel = ""
    /// The library being looked through; nil shows the two library cards.
    var shelf: Shelf?
    var touched = false
    /// It wasn't sure where this goes (it's waiting in Review): the three likeliest homes, shown as
    /// tiles in place of the two library cards. Empty when it filed the save by itself.
    private(set) var picks: [Destination] = []
    /// Whether the sorter ranked any of them; if not, they're the places you file to most, and the sheet says so.
    private(set) var picksSorted = false
    /// The choices can be drawn in their final shape: at once when it filed itself, and once the groups
    /// are read when it's waiting in Review (the tiles need them).
    private(set) var ready = false
    var note = ""
    var finish: () -> Void = {}
    /// Reading and saving what was shared; Done waits on it if it's still going.
    var capture: Task<Void, Never>?
    /// Done or Undo was tapped: the sheet is on its way out, so a second tap does nothing.
    private(set) var closing = false
    private var library: Library?
    /// The sheet is showing. Off it (and not closing by Done or Undo), the standby notice is left to arrive.
    var onScreen = true
    /// This opening of the sheet, for its standby notice (SaveNotice.standby).
    let session = UUID().uuidString
    private var standby: Task<Void, Never>?

    /// What the standby notice should say now; nil when there's nothing to say (a duplicate, a failure).
    private var standbyNow: SaveNotice.Standby? {
        switch phase {
        case .saving: .notSavedYet
        case .saved: save.map { .saved(id: $0.id, title: $0.title, destination: destinationLabel) }
        case .duplicate, .failed: nil
        }
    }

    /// Keeps one notice a few seconds ahead for as long as the sheet is open (SaveNotice.standby): if
    /// iOS closes the sheet by itself, the notice is what tells you the save went through.
    func keepNoticeReady() {
        guard standby == nil else { return }
        standby = Task { [weak self] in
            guard await SaveNotice.allowed() else { return }
            while !Task.isCancelled, let self {
                await self.pushNoticeBack()
                try? await Task.sleep(for: SaveNotice.standbyBeat)
            }
        }
    }

    private func pushNoticeBack() async {
        guard onScreen || closing, standby?.isCancelled == false, let what = standbyNow else { return }
        await SaveNotice.standby(session, what)
    }

    /// Done, Undo, a duplicate or a failure: no standby notice any more.
    private func endNotice() async {
        standby?.cancel()
        await standby?.value
        SaveNotice.endStandby(session)
    }

    func save(items: [NSExtensionItem]) async {
        let shared = await SharedContent.read(from: items)
        ShareTrace.note(session, "read what was shared")
        do {
            let library = try Library(tidy: false)
            ThumbnailStore.shared.use(library)
            self.library = library
            var product: [String: Any]
            // A post on X opened in Safari: X's page has no text until its script runs, so its embed data is read too.
            if let page = shared.page {
                product = await library.withXPost(page)
                // A page whose own tags said little (a TikTok or Reddit post in Safari): its site's public data too.
                if product["xBundle"] == nil, ((product["description"] as? String) ?? "").count < 40 { product = await library.withLinkRead(product) }
            } else { product = await library.sharedProduct(url: shared.url, title: shared.title, text: shared.text) }
            // A screenshot or photo with no link: its picture and the text read from it, on this device.
            if shared.page == nil, shared.url == nil, let image = shared.image {
                product = await ImageCapture.product(from: image)
            }
            let result = try await library.capture(product: product)
            if let dup = result.duplicateOf {
                save = dup
                // Where it lives: its Lifestyle view, its collection, or Review while it has no home yet.
                // (capture.js sends an empty collection name for those last two, so it can't be used as is.)
                let here = dup.hasOwnView ? "kind:\(dup.kind)" : dup.collectionId
                let homes = (try? await library.destinations()) ?? []
                destinationLabel = homes.first(where: { $0.value == here })?.label
                    ?? result.destination.flatMap { $0.isEmpty ? nil : $0 }
                    ?? (dup.hasOwnView ? KindStyle(dup.kind).plural : "Review")
                phase = .duplicate
                ShareTrace.note(session, "already saved")
                await endNotice()
                return
            }
            guard let s = result.save else {
                phase = .failed("Internet Binder couldn't read what was shared.")
                await endNotice()
                return
            }
            save = s
            // Where it went, as far as the save itself says (the exact name follows below).
            destinationLabel = s.hasOwnView ? KindStyle(s.kind).plural
                : (s.collectionId ?? "").isEmpty ? "Review" : (result.destination ?? "")
            // It filed itself: the two library cards show at once, as they always have. Headed for Review:
            // the choices wait a moment for the groups, so the three tiles are drawn once, in place.
            ready = s.hasOwnView || !(s.collectionId ?? "").isEmpty
            phase = .saved
            ShareTrace.note(session, "saved")
            // It's in the library: from here the standby notice says so, before anything else is read or drawn.
            await pushNoticeBack()
            Haptic.saved()
            Haptic.readyFiled()
            destinations = (try? await library.destinations()) ?? []
            shelfPreview = (try? library.shelf(excluding: s.id)) ?? Library.Shelf()
            waiting = (try? library.waiting(excluding: s.id)) ?? Library.Waiting()
            let here = s.hasOwnView ? "kind:\(s.kind)" : s.collectionId
            if let d = destinations.first(where: { $0.value == here }) {
                destination = d.value
                destinationLabel = d.label
            } else {
                destination = Self.review
                destinationLabel = "Review"
                picks = Library.picks(likely: result.likely, destinations: destinations, counts: shelfPreview.counts)
                picksSorted = picks.contains { result.likely.contains($0.value) }
            }
            ready = true
            UIAccessibility.post(notification: .announcement, argument: "Saved to \(destinationLabel)")
        } catch {
            phase = .failed(error.localizedDescription)
            ShareTrace.note(session, "failed")
            Haptic.refused()
            await endNotice()
        }
    }

    /// Which library it's in now, so that card wears the check.
    var shelfNow: Shelf? {
        guard let d = destinations.first(where: { $0.value == destination }) else { return nil }
        return d.group == "lifestyle" ? .lifestyle : .collections
    }

    /// One library's groups, most saves first (a tie A–Z), as in the app.
    func groups(_ shelf: Shelf) -> [Destination] {
        destinations.filter { $0.group == (shelf == .lifestyle ? "lifestyle" : "collection") }
            .mostFirst(count: count, name: \.label)
    }

    /// How many saves a group already holds (not counting this one).
    func count(_ d: Destination) -> Int { shelfPreview.counts[d.value] ?? 0 }

    /// A few saves already in a group (not this one), pictures first, for its tile.
    func members(_ d: Destination) -> [Save] {
        shelfPreview.saves.filter { s in d.kind.map { s.kind == $0 } ?? (s.collectionId == d.value) }
    }

    func members(_ shelf: Shelf) -> [Save] {
        shelfPreview.saves.filter { shelf == .lifestyle ? $0.hasOwnView : !($0.collectionId ?? "").isEmpty }
    }

    func open(_ shelf: Shelf?) {
        touched = true
        Haptic.pageTurned()
        self.shelf = shelf
    }

    /// Puts it in a group, then shows the two libraries again with where it went.
    func put(_ d: Destination) { put(d.value, d.label) }

    private func put(_ value: String, _ label: String) {
        guard let save, let library else { return }
        touched = true
        destination = value
        destinationLabel = label
        shelf = nil
        Haptic.dropped()
        UIAccessibility.post(notification: .announcement, argument: "Going to \(label)")
        Task { _ = try? await library.put([save.id], in: value) }
    }

    /// Not sure yet: it waits in Review, where Internet Binder suggests a home later.
    func toReview() {
        guard let save, let library, destination != Self.review else { shelf = nil; return }
        touched = true
        destination = Self.review
        destinationLabel = "Review"
        shelf = nil
        Haptic.settled()
        UIAccessibility.post(notification: .announcement, argument: "Going to Review")
        Task { try? await library.toReview([save.id]) }
    }

    func createCollection(_ name: String) {
        let name = name.trimmingCharacters(in: .whitespaces)
        guard let library, !name.isEmpty else { return }
        Task {
            guard let c = try? await library.createCollection(named: name) else { Haptic.refused(); return }
            destinations = (try? await library.destinations()) ?? destinations
            put(c.id, c.name)
        }
    }

    func undo() {
        guard !closing else { return }
        closing = true
        ShareTrace.note(session, "Undo")
        Haptic.undo()
        guard let save, let library else { finish(); return }
        // The save is gone before the sheet is; telling iCloud can wait for the moment after.
        Task {
            await endNotice()
            try? await library.undoSave(save.id)
            closeThen { [self] in await sendToICloud(save.id) }
        }
    }

    /// With iCloud sync on, the save (and what the sorter learned from it) goes up before the sheet
    /// closes, so it's on the Mac in seconds. Capped at a few seconds; what doesn't make it, the app sends.
    private func sendToICloud(_ id: String) async {
        guard SyncPreference.isOn, let library, let item = SyncID(store: "items", key: id) else { return }
        let ids = [item, SyncID(store: "kv", key: "prefs"), SyncID(store: "kv", key: "importHistory")].compactMap { $0 }
        let db = library.database
        let keys = LibraryKeys(store: KeychainLibraryKeys(accessGroup: CloudSync.keychainGroup))
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await CloudSync.push(ids, database: db, keys: keys) }
            group.addTask { try? await Task.sleep(for: .seconds(4)) }
            await group.next()
            group.cancelAll()
        }
    }

    /// Done: the save stays where it is now, and a notification says so (tap it to open the save).
    /// The tap answers at once (a tap you feel, the sheet goes); the note, the sorter's lesson, the
    /// notification and iCloud finish in the moment after, while iOS keeps the extension alive for them.
    func done() {
        guard !closing else { return }
        closing = true
        ShareTrace.note(session, "Done")
        // A firm press you can't miss; the sheet goes as soon as it has played.
        Haptic.filed()
        let note = note.trimmingCharacters(in: .whitespaces), capture = capture
        closeThen { [self] in
            // Done while it still says Saving: let the save land first instead of dropping it.
            await capture?.value
            // The real notice comes next, so the standby one goes.
            await endNotice()
            guard let save, let library else { return }
            let kept: Bool
            if case .saved = phase { kept = true } else { kept = false }
            if !note.isEmpty { try? await library.update(save.id, ["note": note]) }
            // Kept where it went: that's a choice the sorter learns from (a save you moved already taught it).
            if kept { try? await library.confirmFiling(save.id) }
            if kept { await SaveNotice.post(id: save.id, title: save.title, destination: destinationLabel) }
            await sendToICloud(save.id)
        }
    }

    /// Closes the sheet once the press has buzzed (a tenth of a second) and lets `work` carry on after it. The time is asked for before the sheet
    /// goes, so iOS keeps the extension running a few seconds more instead of stopping it with the sheet.
    /// If iOS says no, it does the work first and closes after, as before.
    private func closeThen(_ work: @escaping @MainActor () async -> Void) {
        let close = finish, began = Began()
        ProcessInfo.processInfo.performExpiringActivity(withReason: "Finishing a save") { expired in
            if expired {
                // Refused outright: finish here, then close. (Out of time later: nothing to do.)
                if !began.value { began.value = true; Task { @MainActor in await work(); close() } }   // work outlasts the buzz
                return
            }
            began.value = true
            let finished = DispatchSemaphore(value: 0)
            Task { @MainActor in await work(); finished.signal() }
            Task { @MainActor in try? await Task.sleep(for: Haptic.filedLength); close() }
            _ = finished.wait(timeout: .now() + 8)
        }
    }
    private final class Began: @unchecked Sendable { var value = false }
}

/// What the host app shared: Safari's page reading (ShareExtract.js, Chrome's extract.js), or a URL,
/// a title and any text from another app.
struct SharedContent {
    var page: [String: Any]?
    var image: UIImage?
    var url: String?
    var title: String?
    var text: String?

    static func read(from items: [NSExtensionItem]) async -> SharedContent {
        var out = SharedContent()
        for item in items {
            if out.title == nil, let t = item.attributedContentText?.string, !t.isEmpty { out.title = t }
            for provider in item.attachments ?? [] {
                if out.page == nil, provider.hasItemConformingToTypeIdentifier(UTType.propertyList.identifier),
                   let dict = try? await provider.loadItem(forTypeIdentifier: UTType.propertyList.identifier) as? NSDictionary,
                   let results = dict[NSExtensionJavaScriptPreprocessingResultsKey] as? [String: Any] {
                    if let json = results["product"] as? String, !json.isEmpty,
                       let product = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] {
                        out.page = product
                    }
                    out.url = out.url ?? (results["url"] as? String)
                    out.title = out.title ?? (results["title"] as? String)
                } else if out.url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                          let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                    out.url = url.absoluteString
                } else if out.image == nil, provider.hasItemConformingToTypeIdentifier(UTType.image.identifier),
                          let item = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier) {
                    // Read no bigger than a screenshot: a full-size photo decoded whole is more memory than
                    // the share sheet has (ImageCapture.load).
                    if let img = item as? UIImage { out.image = img }
                    else if let u = item as? URL { out.image = ImageCapture.load(u) }
                    else if let data = item as? Data { out.image = ImageCapture.load(data) }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    // Many apps share a link inside text ("Look at this https://…").
                    if out.url == nil, let found = text.firstLink { out.url = found }
                    out.text = text
                }
            }
        }
        return out
    }
}

extension String {
    var firstLink: String? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        return detector?.firstMatch(in: self, range: NSRange(startIndex..., in: self))?.url?.absoluteString
    }
}

struct ShareCard: View {
    let state: ShareState
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var appeared = false
    @State private var writing = false
    @State private var naming = false
    @State private var newName = ""
    @State private var query = ""
    @FocusState private var noteFocused: Bool
    // Finding a collection: the keyboard takes half the sheet, so the save card, Review and Done step aside.
    @FocusState private var searching: Bool

    // iOS presents a share extension as a full-height sheet, so the whole sheet is the table: the save
    // drawn as its object, and under the thumb the two libraries it can live in (Collections and
    // Lifestyle). Tap one to look through its groups and tap a group to put it there; Review is always
    // one tap away for when you're not sure.
    var body: some View {
        @Bindable var state = state
        ZStack {
            TableBackground()
            OrbitLines()
            VStack(alignment: .leading, spacing: 16) {
                status
                if let save = state.save {
                    // Accessibility text sizes: the save as its small card, so the three choices and Done fit.
                    if state.shelf == nil && !typeSize.isAccessibilitySize {
                        Spacer(minLength: 4)
                        SaveObject(save)
                            .frame(maxWidth: 210)
                            .frame(maxWidth: .infinity)
                            // Set down a touch askew, like the card in Chrome's popup.
                            .rotationEffect(.degrees(appeared || reduce ? -2 : -8))
                            .scaleEffect(appeared || reduce ? 1 : 0.85)
                            .opacity(appeared ? 1 : 0)
                            .transition(.opacity.combined(with: .scale(scale: 0.9)))
                        Spacer(minLength: 12)
                    } else if !searching {
                        compact(save).transition(.opacity)
                    }
                } else if case .saving = state.phase {
                    Spacer()
                    ProgressView().frame(maxWidth: .infinity)
                    Spacer()
                } else {
                    Spacer()
                }
                if case .saved = state.phase, state.ready {
                    Group {
                        if let shelf = state.shelf { groups(shelf) } else { libraries }
                    }
                    .transition(reduce ? .opacity : .asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity),
                                                                 removal: .move(edge: .leading).combined(with: .opacity)))
                }
                if writing {
                    TextField("Add a note", text: $state.note, axis: .vertical)
                        .focused($noteFocused)
                        .font(KSFont.note)
                        .padding(12).ksSurface(radius: min(t.radius, 12), scale: 0)
                }
                if !searching { HStack(spacing: 10) {
                    if case .saved = state.phase, !writing {
                        secondary("Add a note", "square.and.pencil") {
                            state.touched = true
                            writing = true
                            noteFocused = true
                        }
                    }
                    PrimarySlab("Done", symbol: "checkmark") { state.done() }
                } }
            }
            .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 12)
            .animation(KSMotion.or(KSMotion.sheet, reduce: reduce), value: state.shelf)
            .animation(KSMotion.or(KSMotion.settle, reduce: reduce), value: state.destination)
            .animation(KSMotion.or(KSMotion.settle, reduce: reduce), value: searching)
        }
        .simultaneousGesture(TapGesture().onEnded { state.touched = true })
        .onAppear { withAnimation(KSMotion.or(KSMotion.lift, reduce: reduce).delay(0.05)) { appeared = true } }
        .onChange(of: state.shelf) { query = "" }
        .alert("New collection", isPresented: $naming) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) { newName = "" }
            Button("Create") { state.createCollection(newName); newName = "" }
                .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
        } message: { Text("It goes straight in.") }
    }

    @ViewBuilder private var status: some View {
        HStack(spacing: 8) {
            switch state.phase {
            case .saving:
                ProgressView().controlSize(.small)
                Text("Saving").font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
            case .saved:
                Image(systemName: "checkmark.circle.fill").foregroundStyle(KindStyle("recipe").color)
                Text("Saved").font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
                if state.save?.isFinishing == true { Text("· finishing details").font(.subheadline).foregroundStyle(t.inkMuted) }
            case .duplicate:
                Image(systemName: "bookmark.fill").foregroundStyle(t.accent)
                Text("Already saved in \(state.destinationLabel)").font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
            case .failed(let message):
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(t.stamp)
                Text(message).font(.subheadline).foregroundStyle(t.ink)
            }
            Spacer()
            if case .saved = state.phase {
                Button("Undo") { state.undo() }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(t.accent)
                    .frame(minWidth: 44, minHeight: 44)
            }
        }
        .frame(minHeight: 30)
    }

    /// While looking through a library: the save as a small card, so the groups get the room.
    private func compact(_ save: Save) -> some View {
        HStack(spacing: 12) {
            SaveImage(save, symbolSize: 18).frame(width: 52, height: 52).clipShape(RoundedRectangle(cornerRadius: 3))
            VStack(alignment: .leading, spacing: 2) {
                Text(save.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(2)
                HStack(spacing: 5) {
                    Image(systemName: icon(state.destination)).imageScale(.small)
                    Text("In \(state.destinationLabel)").contentTransition(.opacity)
                }
                .font(.subheadline.weight(.medium)).foregroundStyle(tint(state.destination))
            }
            Spacer(minLength: 0)
        }
        .padding(10).ksSurface()
    }

    private func icon(_ value: String?) -> String {
        if value == ShareState.review { return "tray" }
        if let d = state.destinations.first(where: { $0.value == value }), let k = d.kind { return KindStyle(k).symbol }
        return "bag"
    }

    private func tint(_ value: String?) -> Color {
        if value == ShareState.review { return t.accent }
        if let d = state.destinations.first(where: { $0.value == value }), let k = d.kind { return KindStyle(k).color }
        return KindStyle("product").color
    }

    // MARK: the two libraries

    @ViewBuilder private var libraries: some View {
        if typeSize.isAccessibilitySize {
            // One card per row, scrolling above Done, so nothing is pushed off the sheet.
            ScrollView { librariesStack.padding(.horizontal, 2).padding(.bottom, 8) }
                .scrollBounceBehavior(.basedOnSize)
        } else {
            librariesStack
        }
    }

    @ViewBuilder private var librariesStack: some View {
        if state.picks.isEmpty { cardsStack } else { picksStack }
    }

    // MARK: not sure: the three likeliest homes

    /// It couldn't decide, so the three likeliest homes are one tap away, with the two libraries and
    /// Review as a small row underneath. When it filed the save by itself, the sheet is as it always was.
    private var picksStack: some View {
        let waiting = state.destination == ShareState.review
        let large = typeSize.isAccessibilitySize
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Where does it live?").font(KSFont.name(.title3)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                Group {
                    if waiting {
                        Text("Not sure about this one. ").foregroundStyle(t.inkMuted)
                        + Text(state.picksSorted ? "Tap where it goes." : "Your most used:").foregroundStyle(t.ink).fontWeight(.semibold)
                    } else {
                        Text("It's in ").foregroundStyle(t.inkMuted)
                        + Text(state.destinationLabel).foregroundStyle(tint(state.destination)).fontWeight(.semibold)
                    }
                }
                .font(.subheadline)
                .contentTransition(.opacity)
            }
            let tiles = large ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(alignment: .top, spacing: 10))
            tiles {
                ForEach(state.picks) { d in
                    Button { state.put(d) } label: { large ? AnyView(pickRow(d)) : AnyView(pickTile(d)) }
                        .buttonStyle(PressStyle())
                        .accessibilityHint("Puts it here.")
                }
            }
            Text("Somewhere else").font(.footnote.weight(.medium)).foregroundStyle(t.inkMuted).accessibilityAddTraits(.isHeader)
            let chips = large ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
            chips {
                elsewhere(.collections, "Collections", symbol: "bag")
                elsewhere(.lifestyle, "Lifestyle", symbol: "sparkles")
                chip(waiting ? "In Review" : "Review", symbol: waiting ? "checkmark" : "tray", on: waiting) { state.toReview() }
                    .accessibilityLabel("Review")
                    .accessibilityValue(waiting ? "It's waiting in Review" : "")
                    .accessibilityHint("Puts it here until you pick a home.")
                    .accessibilityAddTraits(waiting ? [.isButton, .isSelected] : .isButton)
            }
        }
    }

    private func pickTile(_ d: Destination) -> some View {
        let items = state.members(d), n = state.count(d)
        let k = d.kind.map(KindStyle.init)
        let here = state.destination == d.value
        return GroupTile(d.label, subtitle: n == 0 ? "Empty" : (n == 1 ? "1 save" : "\(n) saves"),
                         cover: items.first(where: \.hasImage) ?? items.first, symbol: k?.symbol ?? "bag",
                         tint: k?.color ?? KindStyle("product").color, kind: d.kind, selected: here, compact: true)
            .overlay(alignment: .topLeading) {
                if here {
                    Image(systemName: "checkmark.circle.fill").font(.title3)
                        .foregroundStyle(k?.color ?? KindStyle("product").color, t.paper)
                        .padding(12)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .frame(maxWidth: .infinity)
    }

    /// Large text: a pick as a row, its name taking the width.
    private func pickRow(_ d: Destination) -> some View {
        let n = state.count(d), k = d.kind.map(KindStyle.init)
        let here = state.destination == d.value
        return HStack(spacing: 12) {
            Image(systemName: k?.symbol ?? "bag").foregroundStyle(k?.color ?? KindStyle("product").color)
            VStack(alignment: .leading, spacing: 1) {
                Text(d.label).font(KSFont.name(.headline)).foregroundStyle(t.ink)
                Text(n == 1 ? "1 save" : "\(n) saves").font(.footnote).foregroundStyle(t.inkMuted)
            }
            Spacer(minLength: 0)
            if here { Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(k?.color ?? KindStyle("product").color) }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .ksSurface(stroke: here ? t.ink : nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(d.label)
        .accessibilityValue(n == 1 ? "1 save" : "\(n) saves")
        .accessibilityAddTraits(here ? [.isButton, .isSelected] : .isButton)
    }

    /// One of the two libraries, small: opens its groups. It wears the mark when the save is in one of
    /// its groups that isn't among the three tiles.
    private func elsewhere(_ shelf: ShareState.Shelf, _ title: String, symbol: String) -> some View {
        let here = state.shelfNow == shelf && !state.picks.contains { $0.value == state.destination }
        return chip(title, symbol: here ? "checkmark" : symbol, on: here) { state.open(shelf) }
            .accessibilityLabel(title)
            .accessibilityValue(here ? "It's in \(state.destinationLabel)" : "")
            .accessibilityHint("Shows its groups.")
            .accessibilityAddTraits(here ? [.isButton, .isSelected] : .isButton)
    }

    private func chip(_ title: String, symbol: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbol).imageScale(.small).foregroundStyle(on ? t.accent : t.inkMuted)
                Text(title).font(.subheadline.weight(on ? .semibold : .medium)).foregroundStyle(t.ink).lineLimit(1).minimumScaleFactor(0.8)
            }
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, minHeight: 46)
            .background(on ? t.highlight.opacity(0.25) : t.well, in: Capsule())
            .overlay { Capsule().strokeBorder(on ? t.ink : t.line, lineWidth: 1) }
            .contentShape(Capsule())
        }
        .buttonStyle(PressStyle())
        .accessibilityElement(children: .ignore)
    }

    // MARK: sure: the two libraries

    private var cardsStack: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Where does it live?").font(KSFont.name(.title3)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                (Text(state.destination == ShareState.review ? "For now it's waiting in " : "Internet Binder put it in ").foregroundStyle(t.inkMuted)
                 + Text(state.destinationLabel).foregroundStyle(tint(state.destination)).fontWeight(.semibold))
                    .font(.subheadline)
                    .contentTransition(.opacity)
            }
            let rows = typeSize.isAccessibilitySize
            let stack = rows ? AnyLayout(VStackLayout(spacing: 12)) : AnyLayout(HStackLayout(spacing: 12))
            stack {
                libraryCard(.collections, "Collections", "Your saves, sorted", symbol: "bag", tint: KindStyle("product").color, row: rows)
                libraryCard(.lifestyle, "Lifestyle", "Recipes, places & more", symbol: "sparkles", tint: KindStyle("recipe").color, row: rows)
            }
            reviewCard
        }
    }

    private func libraryCard(_ shelf: ShareState.Shelf, _ title: String, _ caption: String, symbol: String, tint: Color, row: Bool = false) -> some View {
        let here = state.shelfNow == shelf
        let count = state.groups(shelf).count
        let words = VStack(alignment: .leading, spacing: 2) {
            Text(title).font(KSFont.name(.title3)).foregroundStyle(t.ink)
            Text(here ? state.destinationLabel : caption).font(.footnote).foregroundStyle(here ? tint : t.inkMuted).lineLimit(row ? 3 : 1)
        }
        let tally = HStack(spacing: 4) {
            Text(shelf == .lifestyle ? (count == 1 ? "1 kind" : "\(count) kinds") : (count == 1 ? "1 collection" : "\(count) collections"))
            Image(systemName: "chevron.right").imageScale(.small)
        }
        .font(.caption.weight(.medium)).foregroundStyle(t.inkMuted)
        let check = Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(tint)
            .transition(.scale.combined(with: .opacity))
        return Button { state.open(shelf) } label: {
            Group {
                if row {
                    // Large text: a row like the Review card, the words taking the width.
                    HStack(alignment: .top, spacing: 14) {
                        VStack(alignment: .leading, spacing: 8) { words; tally }
                        Spacer(minLength: 0)
                        if here { check }
                    }
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .top) {
                            CoverFan(state.members(shelf), symbol: symbol, tint: tint, size: 58)
                            Spacer(minLength: 0)
                            if here { check }
                        }
                        words
                        tally
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .fixedSize(horizontal: false, vertical: true)
            .ksSurface(stroke: here ? t.ink : nil)
            .overlay { if here && t.outline == 0 { RoundedRectangle(cornerRadius: t.radius, style: .continuous).strokeBorder(t.ink, lineWidth: 2) } }
        }
        .buttonStyle(PressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(here ? "It's in \(state.destinationLabel)" : caption)
        .accessibilityHint("Shows its groups.")
        .accessibilityAddTraits(here ? [.isButton, .isSelected] : .isButton)
    }

    /// Always there: not sure yet, so it waits in Review.
    private var reviewRow: some View {
        let here = state.destination == ShareState.review
        return Button { state.toReview() } label: {
            HStack(spacing: 12) {
                Image(systemName: here ? "tray.full.fill" : "tray").font(.body.weight(.medium)).foregroundStyle(t.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text(here ? "Waiting in Review" : "Not sure? Put it in Review").font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
                    Text("Internet Binder suggests a home for it later.").font(.caption).foregroundStyle(t.inkMuted)
                }
                Spacer(minLength: 0)
                if here { Image(systemName: "checkmark").font(.subheadline.weight(.bold)).foregroundStyle(t.accent) }
            }
            .padding(.horizontal, 14).frame(minHeight: 56)
            .background(RoundedRectangle(cornerRadius: t.radius, style: .continuous).strokeBorder(here ? t.ink : t.ink.opacity(0.4), style: StrokeStyle(lineWidth: 1, dash: here ? [] : [4, 3])))
            .background(here ? t.highlight.opacity(0.25) : .clear, in: RoundedRectangle(cornerRadius: t.radius, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(here ? "Waiting in Review" : "Put it in Review")
        .accessibilityAddTraits(here ? [.isButton, .isSelected] : .isButton)
    }

    // MARK: one library's groups

    private func groups(_ shelf: ShareState.Shelf) -> some View {
        let lifestyle = shelf == .lifestyle
        return VStack(alignment: .leading, spacing: 12) {
            pageHeader(lifestyle ? "Lifestyle" : "Collections", lifestyle ? "Pick the view it belongs in" : "Pick a collection, or start one")
            // Collections only (Lifestyle's views are few): find one by name; nothing found names a new one.
            if !lifestyle {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(t.inkMuted)
                    TextField("Find a collection", text: $query)
                        .focused($searching)
                        .textInputAutocapitalization(.words).autocorrectionDisabled().submitLabel(.search)
                        // Search with nothing found starts the collection it names.
                        .onSubmit {
                            let q = query.trimmingCharacters(in: .whitespaces)
                            if !q.isEmpty, !state.groups(shelf).contains(where: { $0.label.localizedStandardContains(q) }) { newName = q; naming = true }
                        }
                    if !query.isEmpty {
                        Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(t.inkMuted) }
                            .accessibilityLabel("Clear")
                    }
                }
                .font(.subheadline).foregroundStyle(t.ink)
                .padding(.horizontal, 12).frame(minHeight: 44)
                .ksSurface(radius: min(t.radius, 12), scale: 0)
            }
            let q = query.trimmingCharacters(in: .whitespaces)
            ScrollView {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 14)], spacing: 16) {
                    if !lifestyle {
                        Button { newName = q; naming = true } label: { NewGroupTile(q.isEmpty ? "New collection" : "New “\(q)”") }
                            .buttonStyle(PressStyle())
                    }
                    ForEach(state.groups(shelf).filter { lifestyle || q.isEmpty || $0.label.localizedStandardContains(q) }) { d in
                        let items = state.members(d), n = state.count(d)
                        let k = d.kind.map(KindStyle.init)
                        let here = state.destination == d.value
                        Button { state.put(d) } label: {
                            GroupTile(d.label, subtitle: n == 0 ? "Empty" : (n == 1 ? "1 save" : "\(n) saves"),
                                      cover: items.first(where: \.hasImage) ?? items.first, symbol: k?.symbol ?? "bag",
                                      tint: k?.color ?? KindStyle("product").color, kind: d.kind, selected: here, compact: true)
                                .overlay(alignment: .topLeading) {
                                    if here {
                                        Image(systemName: "checkmark.circle.fill").font(.title3)
                                            .foregroundStyle(k?.color ?? KindStyle("product").color, t.paper)
                                            .padding(12)
                                    }
                                }
                        }
                        .buttonStyle(PressStyle())
                    }
                }
                .padding(.horizontal, 4).padding(.top, 8).padding(.bottom, 28)
            }
            .scrollIndicatorsFlash(onAppear: true)
            // The last row fades under the Review row, so it reads as "scroll for more".
            .mask {
                VStack(spacing: 0) {
                    Color.black
                    LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .top, endPoint: .bottom).frame(height: 28)
                }
            }
            .scrollDismissesKeyboard(.immediately)
            .frame(maxHeight: .infinity)
            if !searching { reviewRow }
        }
    }

    private func pageHeader(_ title: String, _ subtitle: String) -> some View {
        HStack(spacing: 6) {
            Button { state.open(nil) } label: { GlassIcon("chevron.left", font: .headline) }
                .buttonStyle(.plain)
                .accessibilityLabel("Back")
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(KSFont.name(.title3)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                Text(subtitle).font(.footnote).foregroundStyle(t.inkMuted)
            }
            .padding(.leading, 4)
            Spacer()
        }
    }

    // MARK: Review

    /// Not sure yet: Review as a third card, drawn like the two libraries, with a fan of what's already
    /// waiting there. One tap files it; Internet Binder suggests a home for it later.
    private var reviewCard: some View {
        let here = state.destination == ShareState.review
        let n = state.waiting.count
        let others = n == 0 ? "Waiting here" : (n == 1 ? "Waiting here with 1 other" : "Waiting here with \(n) others")
        let caption = here ? others : (n == 0 ? "Internet Binder suggests a home later" : "\(n) waiting · Internet Binder suggests a home later")
        return Button { state.toReview() } label: {
            HStack(alignment: typeSize.isAccessibilitySize ? .top : .center, spacing: 14) {
                if !typeSize.isAccessibilitySize { CoverFan(state.waiting.saves, symbol: "tray", tint: t.accent, size: 46) }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Review").font(KSFont.name(.title3)).foregroundStyle(t.ink)
                    Text(caption).font(.footnote).foregroundStyle(here ? t.ink : t.inkMuted).lineLimit(typeSize.isAccessibilitySize ? 4 : 2)
                }
                Spacer(minLength: 0)
                if here {
                    Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(t.accent)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .ksSurface(stroke: here ? t.ink : nil)
            .overlay { if here && t.outline == 0 { RoundedRectangle(cornerRadius: t.radius, style: .continuous).strokeBorder(t.ink, lineWidth: 2) } }
        }
        .buttonStyle(PressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Review")
        .accessibilityValue(here ? "It's in Review. \(others)" : caption)
        .accessibilityHint("Puts it here until you pick a home.")
        .accessibilityAddTraits(here ? [.isButton, .isSelected] : .isButton)
    }

    private func secondary(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol).font(.subheadline.weight(.medium)).foregroundStyle(t.ink)
                .frame(maxWidth: .infinity, minHeight: 48)
                .ksSurface(radius: t.controlRadius.isInfinite ? 24 : t.controlRadius, scale: 0.75)
        }
        .buttonStyle(PressStyle())
    }
}

/// The page behind Chrome's save popup (looks.css), in every look: faint orbit rings around a point low
/// on the right, and a few stars that thin out toward the top. Still and drawn in one pass, no images
/// (an extension has little memory); nothing for VoiceOver; plain with Increase Contrast.
private struct OrbitLines: View {
    @Environment(\.ks) private var t
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        if contrast != .increased {
            Canvas { ctx, size in
                let w = size.width, h = size.height
                // Rings 140 pt apart, one point wide, in the ink at 5%: wider than tall, as the popup's are.
                let centre = CGPoint(x: w * 0.78, y: h * 0.78), squash = (0.7 * h) / (1.2 * w)
                var rings = Path()
                var rx: CGFloat = 140
                while rx < (w + h) * 2 {
                    rings.addEllipse(in: CGRect(x: centre.x - rx, y: centre.y - rx * squash, width: rx * 2, height: rx * 2 * squash))
                    rx += 140
                }
                ctx.stroke(rings, with: .color(t.ink.opacity(0.05)), lineWidth: 1)
                // Two grids of dots, out of step with each other, fading in down the sheet.
                let dark = scheme == .dark
                for (step, start, r, color) in [(CGSize(width: 173, height: 151), CGPoint(x: 86, y: 75), 0.8, dark ? Color.white.opacity(0.55) : t.ink.opacity(0.3)),
                                                (CGSize(width: 229, height: 197), CGPoint(x: 175, y: 187), 0.9, t.detail.opacity(0.5))] {
                    var y = start.y
                    while y < h {
                        let fade = min(1, max(0, (y / h - 0.15) / 0.55))
                        var dots = Path(), x = start.x
                        while x < w {
                            dots.addEllipse(in: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
                            x += step.width
                        }
                        ctx.fill(dots, with: .color(color.opacity(fade)))
                        y += step.height
                    }
                }
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }
}
