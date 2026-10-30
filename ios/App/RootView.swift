import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Where a link inside the app goes.
enum Route: Hashable {
    case kind(String)
    case review
    case collections
    case lifestyle
    case collection(String, String)
}

/// The app's frame: Home, Library, Places and Search tabs, each with its own stack, and the Undo
/// toast. Library keeps its own search field too.
struct RootView: View {
    @Environment(LibraryModel.self) private var model
    @Environment(NoticeDelegate.self) private var notices
    @Environment(\.scenePhase) private var phase
    @Environment(\.horizontalSizeClass) private var size
    @State private var tab = "home"

    var body: some View {
        Group {
            if size == .regular { SplitRootView() } else { tabs }
        }
        // Near the bottom, under the thumb: above the tab bar, Library's search bar and a save's
        // action buttons, clear of the Dynamic Island and of titles and navigation buttons.
        .overlay(alignment: .bottom) {
            VStack(spacing: 10) {
                AIRunBar()
                ToastView()
            }
            .frame(maxWidth: .infinity).padding(.horizontal, 16).padding(.bottom, 128)
        }
        .overlay { CelebrationView() }
        .modifier(WorkCover(host: .root))
        .modifier(NewCollectionPrompt())
        .task { await model.start() }
        .task { IconPicker.retireOldIcons() }
        #if DEBUG
        .task { if let kind = UserDefaults.standard.string(forKey: "demoWork") { await model.demoWork(kind) } }
        #endif
        // Asks once whether "Saved to …" notifications may show (not in UI tests, where the prompt would
        // cover the screen).
        .task {
            #if DEBUG
            // UI tests: -noticeFirstSave posts the notification for the newest save, as the Share Extension does.
            if UserDefaults.standard.bool(forKey: "noticeFirstSave") {
                while model.saves.isEmpty { try? await Task.sleep(for: .milliseconds(200)) }
                await SaveNotice.ask()
                // Time for the test to send Internet Binder to the background first.
                try? await Task.sleep(for: .seconds(5))
                let s = model.saves[0]
                await SaveNotice.post(id: s.id, title: s.title, destination: KindStyle(s.kind).plural)
                return
            }
            #endif
            guard SaveNotice.enabled, ProcessInfo.processInfo.environment["KEEPSAKE_DB"] == nil else { return }
            await SaveNotice.ask()
        }
        // An Internet Binder export sent by AirDrop, or opened from Files with "Open in Internet Binder": imported
        // the way Settings → Import from Chrome does (merged; saves already here are skipped).
        .onOpenURL { url in
            guard url.isFileURL else { return }
            Task { await model.importFile(url) }
        }
        .onChange(of: phase) { _, now in
            if now == .active {
                model.refresh()
                // Apple Intelligence may have been turned on in the Settings app meanwhile.
                Task { await model.refreshAIReady(); model.finishSaves() }
                model.cloud.syncNow()
            }
        }
        // Once, on a device that had a library before iCloud sync arrived (new installs just turn it on).
        .alert("Sync this library with iCloud?", isPresented: Binding(get: { model.cloud.askToSync }, set: { model.cloud.askToSync = $0 })) {
            Button("Not Now", role: .cancel) { model.cloud.set(false) }
            Button("Turn On") { model.cloud.set(true) }
        } message: {
            Text("Your saves, collections and AI settings stay the same on your iPhone and Mac. They go to your own iCloud, encrypted, and nothing here is deleted. You can change this in Settings.")
        }
    }

    private var tabs: some View {
        TabView(selection: $tab) {
            Tab("Home", systemImage: "house", value: "home") { Stack(name: "home") { HomeScreen(zoom: $0) } }
                .badge(model.reviewCount)
            Tab("Library", systemImage: "books.vertical", value: "library") { Stack(name: "library") { LibraryScreen(zoom: $0) } }
            Tab("Places", systemImage: "map", value: "places") { Stack(name: "places") { PlacesScreen(zoom: $0) } }
            // The system's search tab: its own button at the end of the tab bar.
            Tab(value: "search", role: .search) { Stack(name: "search") { SearchScreen(zoom: $0) } }
        }
        .onChange(of: tab) { Perf.mark("tab \(tab)") }
        // keepsake://save/<id> (widgets, and a tapped "Saved to …" notification): open that save in the Library.
        .onOpenURL { open($0) }
        .onChange(of: notices.tapped, initial: true) {
            guard let url = notices.tapped else { return }
            notices.tapped = nil
            open(url)
        }
    }

    private func open(_ url: URL) {
        guard url.scheme == "keepsake", url.host() == "save", let id = url.pathComponents.last else { return }
        tab = "library"
        model.opening = (stack: "library", id: id)
    }
}

/// A navigation stack that knows every destination, with a zoom namespace for card → detail.
struct Stack<Root: View>: View {
    let name: String
    @ViewBuilder let root: (Namespace.ID) -> Root
    @Namespace private var zoom
    @State private var path = NavigationPath()
    /// How deep each open save sits in the stack. The tabs step aside on a save; this stack (not the save's
    /// page) says so, so they come back the moment you go back, not when the zoom back to the card ends.
    @State private var saveDepths: Set<Int> = []
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t

    var body: some View {
        NavigationStack(path: $path) {
            root(zoom)
                .navigationDestination(for: Save.self) { save in
                    SaveDetailScreen(save: save).navigationTransition(.zoom(sourceID: save.id, in: zoom))
                        .modifier(PageBar(t: t))
                        .onAppear { saveDepths.insert(path.count) }
                }
                .navigationDestination(for: Route.self) { route in
                    Group {
                        switch route {
                        case .kind(let k): KindScreen(kind: k, zoom: zoom)
                        case .review: ReviewScreen(zoom: zoom)
                        case .collections: CollectionsScreen(zoom: zoom)
                        case .lifestyle: LifestyleScreen(zoom: zoom)
                        case .collection(let id, let name): CollectionScreen(id: id, name: name, zoom: zoom)
                        }
                    }
                    .modifier(PageBar(t: t))
                }
        }
        .toolbar(saveDepths.contains(path.count) && path.count > 0 ? .hidden : .visible, for: .tabBar)
        .animation(.easeOut(duration: 0.2), value: saveDepths.contains(path.count))
        .onChange(of: path.count) { _, depth in saveDepths = saveDepths.filter { $0 <= depth } }
        // initial: a tab first shown by the link itself (a tapped notification while on Home) opens it too.
        .onChange(of: model.opening?.id, initial: true) { openWaitingSave() }
        // A save made in the Share Extension appears once the library catches up, then opens.
        .onChange(of: model.saves.count) { openWaitingSave() }
    }

    private func openWaitingSave() {
        guard let open = model.opening, open.stack == name, let save = model.index.byId[open.id] else { return }
        path = NavigationPath()
        path.append(save)
        model.opening = nil
    }
}

/// A pushed page's navigation bar: solid in the page's own colour, so scrolled content never runs
/// under the back button.
struct PageBar: ViewModifier {
    let t: KSTheme
    func body(content: Content) -> some View {
        content
            .toolbarBackground(t.table, for: .navigationBar)
            .toolbarBackgroundVisibility(.visible, for: .navigationBar)
    }
}

/// "Saved to Places · Undo". Stays 8 s; VoiceOver reads it politely.
struct ToastView: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        @Bindable var model = model
        ZStack {
            if let toast = model.toast {
                HStack(spacing: 14) {
                    Text(toast.text).font(.subheadline.weight(.medium)).foregroundStyle(t.ink)
                    if let undo = toast.undo {
                        Button("Undo") {
                            Haptic.undo()
                            model.toast = nil
                            Task { await undo() }
                        }
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                    }
                }
                .padding(.horizontal, 18).frame(minHeight: 48)
                .ksSurface(radius: 24)
                .shadow(color: .black.opacity(0.18), radius: 14, y: 6)
                .transition(reduce ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                .task(id: toast.id) {
                    UIAccessibility.post(notification: .announcement, argument: toast.text)
                    try? await Task.sleep(for: .seconds(8))
                    if model.toast?.id == toast.id { model.toast = nil }
                }
                .accessibilityElement(children: .contain)
            }
        }
        .animation(KSMotion.or(KSMotion.sheet, reduce: reduce), value: model.toast)
    }
}

/// "🎉 Cooked!" in the middle of the screen when a stamp lands: pops in, stays a moment, fades.
/// It never takes a tap (the screen under it keeps working); VoiceOver reads it.
struct CelebrationView: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        ZStack {
            if let c = model.celebration {
                HStack(spacing: 10) {
                    Image(systemName: "party.popper.fill").font(.title.weight(.semibold)).foregroundStyle(t.onAccent)
                        .accessibilityHidden(true)
                    Text(c.text).font(KSFont.name(.title2)).foregroundStyle(t.onAccent)
                }
                .padding(.horizontal, 26).padding(.vertical, 16)
                .ksSurface(t.accent, radius: 36)
                .shadow(color: .black.opacity(0.22), radius: 18, y: 8)
                .rotationEffect(.degrees(reduce ? 0 : -3))
                .transition(reduce ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
                .task(id: c.id) {
                    UIAccessibility.post(notification: .announcement, argument: c.text)
                    try? await Task.sleep(for: .seconds(1.3))
                    if model.celebration?.id == c.id { model.celebration = nil }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .allowsHitTesting(false)
        .animation(KSMotion.or(KSMotion.stamp, reduce: reduce), value: model.celebration)
    }
}

/// A screen's big title in the appearance's display face, and a quiet line under it.
struct ScreenHeader: View {
    let title: String
    var subtitle: String?
    @Environment(\.ks) private var t
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            // A one-word title shrinks to fit rather than breaking mid-word ("Libr / ary" at the largest sizes).
            Text(title).font(KSFont.display()).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                .lineLimit(title.contains(" ") ? nil : 1).minimumScaleFactor(0.5)
            if let subtitle, !subtitle.isEmpty { Text(subtitle).font(KSFont.note).foregroundStyle(t.inkMuted).monospacedDigit() }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
    }
}

/// How a collection or Lifestyle view orders its saves (Chrome's Sort, same names). Newest saved first
/// until you pick another; each view keeps its own choice on this device.
enum SaveSort: String, CaseIterable, Identifiable {
    case newest, oldest, az, priceLow = "price-asc", priceHigh = "price-desc"
    var id: String { rawValue }

    var label: String {
        switch self {
        case .newest: "Newest first"
        case .oldest: "Oldest first"
        case .az: "Title A–Z"
        case .priceLow: "Price: low to high"
        case .priceHigh: "Price: high to low"
        }
    }

    /// The price sorts only where a save has a price.
    static func offered(for saves: [Save]) -> [SaveSort] {
        saves.contains { $0.price != nil } ? allCases : [.newest, .oldest, .az]
    }

    func apply(_ saves: [Save]) -> [Save] {
        switch self {
        case .newest: saves.sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
        case .oldest: saves.sorted { ($0.createdAt ?? "") < ($1.createdAt ?? "") }
        case .az: saves.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        // Saves without a price go last either way.
        case .priceLow: saves.sorted { ($0.price ?? Double.infinity) < ($1.price ?? Double.infinity) }
        case .priceHigh: saves.sorted { ($0.price ?? -Double.infinity) > ($1.price ?? -Double.infinity) }
        }
    }
}

/// Each view's sort ("c:<id>", "kind:<kind>", as Chrome keys them), kept in one UserDefaults string.
struct SaveSorts: RawRepresentable, Equatable {
    var byView: [String: String] = [:]
    init() {}
    init?(rawValue: String) {
        byView = (try? JSONDecoder().decode([String: String].self, from: Data(rawValue.utf8))) ?? [:]
    }
    var rawValue: String {
        (try? JSONEncoder().encode(byView)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }
    subscript(view: String) -> SaveSort {
        get { byView[view].flatMap(SaveSort.init(rawValue:)) ?? .newest }
        set { byView[view] = newValue == .newest ? nil : newValue.rawValue }
    }
}

/// The toolbar's Sort menu: a tick beside the order in use.
struct SortMenu: View {
    @Binding var sort: SaveSort
    let options: [SaveSort]
    var body: some View {
        Menu {
            Picker("Sort", selection: $sort) {
                ForEach(options) { Text($0.label).tag($0) }
            }
        } label: {
            Label("Sort", systemImage: "arrow.up.arrow.down")
        }
        .accessibilityValue(sort.label)
        .accessibilityIdentifier("sortMenu")
        .onChange(of: sort) { Haptic.detent() }
    }
}

/// Saves as objects, linking to their screens. With a selection, Select mode: a tap ticks a save instead,
/// and a long press offers Select to start it.
struct SaveGrid: View {
    let saves: [Save]
    let zoom: Namespace.ID
    var selecting = false
    var selected: Binding<Set<String>>?
    /// Long press → Select: starts Select mode with this save ticked.
    var onSelect: ((String) -> Void)?
    @Environment(LibraryModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize
    var body: some View {
        Masonry(saves, columns: typeSize.isAccessibilitySize ? 1 : nil, minColumnWidth: 170) { save in
            if selecting, let selected {
                let on = selected.wrappedValue.contains(save.id)
                Button {
                    Haptic.checked()
                    if on { selected.wrappedValue.remove(save.id) } else { selected.wrappedValue.insert(save.id) }
                } label: {
                    SaveObject(save).selectionCheck(on)
                }
                .buttonStyle(PressStyle())
                .accessibilityLabel(save.title)
                .accessibilityHint(on ? "Selected. Tap to leave it out." : "Tap to select.")
            } else {
                NavigationLink(value: save) { SaveObject(save).matchedTransitionSource(id: save.id, in: zoom) }
                    .buttonStyle(PressStyle())
                    .draggable(save.id) { SaveObject(save).frame(width: 160) }
                    // VoiceOver rotor: the card's own actions without opening it.
                    .accessibilityAction(named: save.status == "done" ? "Mark not \(KindStyle(save.kind).doneVerb.lowercased())" : "Mark \(KindStyle(save.kind).doneVerb.lowercased())") {
                        Task { await model.setDone(save, save.status != "done") }
                    }
                    .accessibilityAction(named: "Move to Trash") { Task { await model.trash(save) } }
                    .contextMenu { SaveMenu(save: save, onSelect: onSelect.map { f in { f(save.id) } }) }
            }
        }
    }
}

/// Debug timing for the performance pass (prints only in Debug builds).
enum Perf {
    nonisolated(unsafe) static var last: (String, CFAbsoluteTime)?
    static func mark(_ what: String) {
        #if DEBUG
        last = (what, CFAbsoluteTimeGetCurrent())
        #endif
    }
    static func done(_ what: String) {
        #if DEBUG
        if let (from, t) = last { print("PERF \(from) → \(what): \(Int((CFAbsoluteTimeGetCurrent() - t) * 1000)) ms") }
        last = nil
        #endif
    }
}
