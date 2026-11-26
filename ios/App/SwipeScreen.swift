import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// One run of Play: the saves still to decide, what was kept, and each step for Undo. Kept on the device
/// as it changes, so leaving for Safari to copy a link (even if iOS closes the app meanwhile) comes back
/// to the same card with the Add URL field still open.
struct SwipeSession: Codable, Equatable {
    struct Step: Codable, Equatable {
        let id: String
        let kept: Bool
    }
    /// "Wish List", or the collection's name.
    var title: String
    /// Saves still to decide; the first is the card on top.
    var queue: [String]
    /// Every save of the list this run is for, the ones kept in earlier runs included (for starting over).
    var all: [String] = []
    var kept: [String] = []
    var steps: [Step] = []
    /// The Add URL field is open on the top card, with what's typed so far.
    var linking = false
    var draft = ""
    /// Closed with cards left and something kept: what was kept shows first, with the way back to the cards.
    var stopped = false
    /// Which library this belongs to (UI tests open a fresh one each launch).
    var library = SwipeSession.libraryName

    var trashed: Int { steps.count(where: { !$0.kept }) }
    var total: Int { queue.count + steps.count }

    static var libraryName: String { ProcessInfo.processInfo.environment["KEEPSAKE_DB"] ?? "" }
    private static let key = "swipeSession"
    private static var keptKey: String { "swipeKept." + libraryName }
    /// What was kept in earlier runs, on this device.
    static var storedKept: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: keptKey) ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: keptKey) }
    }
    static var stored: SwipeSession? {
        get {
            guard let data = UserDefaults.standard.data(forKey: key), let s = try? JSONDecoder().decode(SwipeSession.self, from: data),
                  s.library == libraryName else { return nil }
            return s
        }
        set {
            if let newValue, let data = try? JSONEncoder().encode(newValue) { UserDefaults.standard.set(data, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }
    }
}

extension LibraryModel {
    /// Play: these saves, one card at a time. What you kept in an earlier run is left out, so a run picks up
    /// where the last one stopped; `again` (or nothing left to decide) forgets that and shows them all.
    func startSwipe(_ title: String, ids: [String], again: Bool = false) {
        guard !ids.isEmpty else { return }
        var queue = again ? [] : ids.filter { !swipeKept.contains($0) }
        if queue.isEmpty {
            swipeKept.subtract(ids)
            queue = ids
        }
        Haptic.pageTurned()
        swipe = SwipeSession(title: title, queue: queue, all: ids)
    }

    /// Keep leaves the save as it is. Otherwise it goes to the Trash, and Undo brings it back.
    func swipeDecide(_ id: String, keep: Bool) {
        guard var s = swipe, let i = s.queue.firstIndex(of: id) else { return }
        s.queue.remove(at: i)
        s.steps.append(.init(id: id, kept: keep))
        if keep { s.kept.append(id); swipeKept.insert(id) }
        swipe = s
        guard !keep, let library else { return }
        Task {
            do {
                try await library.trash([id])
                refresh()
            } catch {
                // Still in the library: the card comes back.
                if var s = swipe, let j = s.steps.lastIndex(where: { $0.id == id && !$0.kept }) {
                    s.steps.remove(at: j)
                    s.queue.insert(id, at: 0)
                    swipe = s
                }
                failed("Couldn't move to Trash. Try again.")
            }
        }
    }

    /// Takes back the last card: out of the Trash or off the kept list, and on top again.
    func swipeUndo() async {
        guard let last = swipe?.steps.last else { return }
        if !last.kept {
            do { try await library?.restore([last.id]) } catch { return failed("Couldn't bring it back. Try again.") }
            await reload()
        }
        guard var s = swipe, s.steps.last == last else { return }
        s.steps.removeLast()
        if last.kept { s.kept.removeAll { $0 == last.id }; swipeKept.remove(last.id) }
        s.queue.insert(last.id, at: 0)
        swipe = s
        Haptic.undo()
    }
}

/// Presents Play over the whole app while a run is on.
struct SwipeCover: ViewModifier {
    @Environment(LibraryModel.self) private var model
    func body(content: Content) -> some View {
        content.fullScreenCover(isPresented: Binding(get: { model.swipe != nil }, set: { if !$0 { model.swipe = nil } })) {
            SwipeScreen().environment(\.ksTableFrame, nil)
        }
    }
}

/// The Play button beside a list's title.
struct SwipePlayButton: View {
    let title: String
    let ids: [String]
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t

    /// Not kept in an earlier run: what Play shows.
    private var left: Int { ids.count(where: { !model.swipeKept.contains($0) }) }
    /// You kept everything here: Play goes through them all again.
    private var again: Bool { left == 0 }
    private var value: String {
        if again || left == ids.count { return "" }
        return "\(left) left to decide, \(ids.count - left) kept before"
    }
    private var hint: String {
        if again { return "You kept everything here. Shows all \(ids.count) again, one at a time." }
        let what = left == 1 ? "the save" : "\(left) saves"
        return "Shows \(what) one at a time. Swipe right to keep, left to move to the Trash."
    }

    var body: some View {
        Button { model.startSwipe(title, ids: ids) } label: {
            Label(again ? "Play again" : "Play", systemImage: again ? "arrow.counterclockwise" : "play.fill")
                .font(.subheadline.weight(.semibold)).foregroundStyle(t.onPrimary)
                .frame(minHeight: 30)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
        .tint(t.primary)
        .frame(minHeight: 44)
        .contextMenu {
            if left < ids.count {
                Button("Start over with all \(ids.count)", systemImage: "arrow.counterclockwise") { model.startSwipe(title, ids: ids, again: true) }
            }
        }
        .accessibilityLabel(again ? "Play \(title) again" : "Play \(title)")
        .accessibilityValue(value)
        .accessibilityHint(hint)
        .accessibilityIdentifier("swipe.play")
    }
}

/// Play: each save as one big card. Swipe right (or Keep) to keep it, left (or Trash) to move it to the
/// Trash; Undo takes the last one back. Add URL on a card rewrites the save from the page you paste.
/// When the cards run out, what you kept is listed to open one by one.
struct SwipeScreen: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var path = NavigationPath()
    @State private var drag = CGSize.zero
    /// The card on top is on its way out, kept or not.
    @State private var leaving: Bool?
    @State private var undoing = false
    /// The save being rebuilt from its own store page (Update from its page).
    @State private var updating: String?
    /// The save Fix with AI is reading.
    @State private var fixing: String?
    @State private var editing: Save?
    @Environment(\.dynamicTypeSize) private var typeSize

    private enum Page: Hashable { case kept }
    private var session: SwipeSession { model.swipe ?? SwipeSession(title: "", queue: []) }
    private var cards: [Save] { session.queue.compactMap { model.index.byId[$0] } }
    private let far: CGFloat = 110
    /// How far the card leans toward Keep (up to 1) or Trash (down to -1): the stamp and the button on that
    /// side grow with it.
    private var lean: CGFloat { max(-1, min(1, drag.width / far)) }
    /// Far enough that letting go decides: 1 keeps, -1 trashes.
    private var armed: Int { lean >= 1 ? 1 : lean <= -1 ? -1 : 0 }
    private let no = Color(red: 0.86, green: 0.21, blue: 0.2)

    var body: some View {
        let cards = cards
        let top = session.stopped ? nil : cards.first
        NavigationStack(path: $path) {
            ZStack {
                TableBackground().ignoresSafeArea()
                if let top {
                    VStack(spacing: 16) {
                        deck(top, next: cards.dropFirst().first)
                        controls(top)
                    }
                    .padding(.horizontal, 18).padding(.bottom, 12)
                    .frame(maxWidth: 560)
                } else if model.loaded {
                    ScrollView { SwipeKept(session: session, finished: true, left: cards.count).padding(.horizontal, 18).padding(.bottom, 120) }
                        .safeAreaInset(edge: .bottom) { endBar }
                } else {
                    RoundedRectangle(cornerRadius: 24, style: .continuous).fill(t.well)
                        .padding(18).frame(maxWidth: 560).accessibilityLabel("Loading")
                }
            }
            .navigationTitle(top == nil ? session.title : "\(session.steps.count + 1) of \(session.total)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close", systemImage: "xmark") {
                        // Something was kept: it's listed before the run ends, rather than vanishing with it.
                        if top != nil, !session.kept.isEmpty { model.swipe?.stopped = true } else { model.swipe = nil }
                    }
                        .accessibilityIdentifier("swipe.close")
                }
                if top != nil, !session.kept.isEmpty {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Kept \(session.kept.count)") { path.append(Page.kept) }
                            .monospacedDigit()
                            .accessibilityHint("Lists what you kept so far")
                            .accessibilityIdentifier("swipe.kept")
                    }
                }
            }
            .navigationDestination(for: Save.self) { save in
                SaveDetailScreen(save: save).modifier(PageBar(t: t))
            }
            .navigationDestination(for: Page.self) { _ in
                ZStack {
                    TableBackground().ignoresSafeArea()
                    ScrollView { SwipeKept(session: session, finished: false, left: cards.count).padding(.horizontal, 18).padding(.bottom, 40) }
                }
                .navigationBarTitleDisplayMode(.inline)
                .modifier(PageBar(t: t))
            }
        }
        .tint(t.ink)
        // The app's own toast sits under this cover: "Updated from …" with Undo shows here.
        .overlay(alignment: .bottom) { ToastView().padding(.horizontal, 16).padding(.bottom, 148) }
        .sheet(isPresented: Binding(get: { session.linking && top != nil }, set: { on in
            model.swipe?.linking = on
            if !on { model.swipe?.draft = "" }
        })) {
            if let top {
                let draft = Binding(get: { session.draft }, set: { model.swipe?.draft = $0 })
                if top.kind == "recipe" {
                    RecipeLinkSheet(save: top, done: {}, draft: draft)
                } else {
                    ProductLinkSheet(save: top, link: draft, title: "Add URL", action: "Save")
                }
            }
        }
        .sheet(item: $editing) { EditSaveSheet(save: $0) }
        // A run restored after iOS closed the app: nothing left of it (every save gone meanwhile) ends it.
        .task(id: model.loaded) {
            if model.loaded, cards.isEmpty, session.steps.isEmpty { model.swipe = nil }
        }
        .task(id: model.dealsChanged) { await model.loadDealLines() }
    }

    // MARK: The cards

    private func deck(_ top: Save, next: Save?) -> some View {
        let pull = min(abs(drag.width) / far, 1)
        return ZStack {
            if let next {
                SwipeCard(save: next, actions: [])
                    .scaleEffect(reduce ? 1 : 0.94 + 0.06 * pull)
                    .opacity(0.55 + 0.45 * pull)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                    .id(next.id)
            }
            SwipeCard(save: top, actions: actions(top))
                .overlay(alignment: .topLeading) { stamp("Keep", symbol: "checkmark", color: t.primary, on: t.onPrimary, tilt: -12, shown: max(0, lean)) }
                .overlay(alignment: .topTrailing) { stamp("Trash", symbol: "trash", color: no, on: .white, tilt: 12, shown: max(0, -lean)) }
                .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .onTapGesture { path.append(top) }
                .offset(x: reduce && leaving != nil ? 0 : drag.width, y: reduce ? 0 : drag.height * 0.25)
                .rotationEffect(.degrees(reduce ? 0 : Double(drag.width / 24)), anchor: .bottom)
                .opacity(reduce && leaving != nil ? 0 : 1)
                .gesture(DragGesture(minimumDistance: 12)
                    .onChanged { v in if leaving == nil { drag = v.translation } }
                    .onEnded { v in
                        guard leaving == nil else { return }
                        let w = abs(v.translation.width) > far ? v.translation.width : v.predictedEndTranslation.width
                        if abs(w) > far, abs(v.translation.width) > 40, (w > 0) == (v.translation.width > 0) { decide(top, keep: w > 0) }
                        else { withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { drag = .zero } }
                    })
                .accessibilityElement(children: .contain)
                .accessibilityAction(named: "Keep") { decide(top, keep: true) }
                .accessibilityAction(named: "Move to Trash") { decide(top, keep: false) }
                .id(top.id)
        }
    }

    /// "Keep" or "Trash" on the card's corner as it's pulled that way.
    /// It grows as the card goes, and lands at full size, tilted like a rubber stamp, once letting go decides.
    private func stamp(_ text: String, symbol: String, color: Color, on: Color, tilt: Double, shown: CGFloat) -> some View {
        Label(text.uppercased(), systemImage: symbol)
            .font(.largeTitle.weight(.heavy)).foregroundStyle(on)
            .symbolEffect(.bounce, value: armed)
            .padding(.horizontal, 22).frame(minHeight: 68)
            .background(color, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(on.opacity(0.5), lineWidth: 3))
            .shadow(color: .black.opacity(0.25), radius: 8, y: 4)
            .rotationEffect(.degrees(reduce ? 0 : tilt))
            .scaleEffect(reduce ? 1 : 0.45 + 0.55 * shown + (shown >= 1 ? 0.15 : 0), anchor: tilt < 0 ? .topLeading : .topTrailing)
            .padding(20)
            .opacity(min(1, shown * 1.4))
            .animation(KSMotion.or(KSMotion.stamp, reduce: reduce), value: armed)
            .accessibilityHidden(true)
    }

    private func controls(_ top: Save) -> some View {
        HStack(alignment: .top, spacing: 0) {
            round("Trash", symbol: "trash", size: 64, id: "swipe.trash", grow: max(0, -lean), glow: no) { decide(top, keep: false) }
                .opacity(1 - 0.6 * max(0, lean))
                .accessibilityLabel("Move to Trash").accessibilityHint("Undo brings it back")
            Spacer(minLength: 8)
            round("Undo", symbol: "arrow.uturn.backward", size: 48, id: "swipe.undo") { undo() }
                .disabled(session.steps.isEmpty || undoing)
                .padding(.top, 8)
                .opacity(1 - 0.6 * abs(lean))
            Spacer(minLength: 8)
            round("Keep", symbol: "checkmark", size: 64, id: "swipe.keep", filled: true, grow: max(0, lean)) { decide(top, keep: true) }
                .opacity(1 - 0.6 * max(0, -lean))
        }
        .padding(.horizontal, 28)
        .disabled(leaving != nil)
        // The tick as the card passes the point where letting go decides.
        .onChange(of: armed) { _, now in if now != 0, leaving == nil { Haptic.detent() } }
    }

    /// grow: how far the card leans this button's way (0 to 1): it swells with the card, and pops past its
    /// full size once letting go decides. glow: the colour it takes on as it grows (Trash turns red).
    private func round(_ title: String, symbol: String, size: CGFloat, id: String, filled: Bool = false, grow: CGFloat = 0, glow: Color? = nil, action: @escaping () -> Void) -> some View {
        let full = grow >= 1
        return Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: symbol).font(size > 50 ? .title2.weight(.semibold) : .body.weight(.semibold))
                    .foregroundStyle(filled ? t.onPrimary : glow != nil && grow > 0.5 ? .white : t.ink)
                    .symbolEffect(.bounce, value: full)
                    .frame(width: size, height: size)
                    .ksGlass(Circle(), tint: filled ? t.primary : glow.map { $0.opacity(Double(grow)) })
                    .scaleEffect(reduce ? 1 : 1 + 0.5 * grow + (full ? 0.2 : 0))
                    .animation(KSMotion.or(KSMotion.stamp, reduce: reduce), value: full)
                // The largest text sizes leave the room to the card; the symbols and VoiceOver still say which is which.
                if !typeSize.isAccessibilitySize {
                    Text(title).font(.footnote.weight(full ? .bold : .medium)).foregroundStyle(grow > 0.5 ? t.ink : t.inkMuted)
                        .offset(y: reduce ? 0 : 24 * grow)
                }
            }
        }
        .buttonStyle(PressStyle())
        .accessibilityIdentifier(id)
    }

    /// Under the list at the end: Undo for the last card, and Done.
    private var endBar: some View {
        HStack(spacing: 12) {
            if session.stopped && !cards.isEmpty {
                Button("Keep going", systemImage: "play.fill") { model.swipe?.stopped = false }
                    .buttonStyle(.bordered).buttonBorderShape(.capsule).controlSize(.large).tint(t.ink)
                    .accessibilityIdentifier("swipe.resume")
            } else if !session.steps.isEmpty {
                Button("Undo last", systemImage: "arrow.uturn.backward") { undo() }
                    .buttonStyle(.bordered).buttonBorderShape(.capsule).controlSize(.large).tint(t.ink)
                    .disabled(undoing)
                    .accessibilityIdentifier("swipe.undo")
            }
            PrimarySlab("Done", symbol: "checkmark") { model.swipe = nil }
                .accessibilityIdentifier("swipe.done")
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .frame(maxWidth: 560)
    }

    private func decide(_ save: Save, keep: Bool) {
        guard leaving == nil else { return }
        leaving = keep
        if keep { Haptic.checked() } else { Haptic.trashed() }
        withAnimation(reduce ? KSMotion.quiet : .easeIn(duration: 0.2)) {
            drag = CGSize(width: keep ? 640 : -640, height: drag.height)
        }
        Task {
            try? await Task.sleep(for: .milliseconds(200))
            model.swipeDecide(save.id, keep: keep)
            drag = .zero
            leaving = nil
            UIAccessibility.post(notification: .announcement, argument: keep ? "Kept" : "Moved to Trash")
        }
    }

    /// The store page a save already points to: the shop page found for it, else its own link unless that is
    /// a social post (which says little about the product, and needs a login to read).
    static func storePage(_ save: Save) -> String? {
        if let shop = save.details?["shopUrl"]?.string, shop.hasPrefix("http") { return shop }
        guard let link = save.url, link.hasPrefix("http"), let host = URL(string: link)?.host()?.lowercased() else { return nil }
        let social = host.range(of: #"(^|\.)(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|x\.com|twitter\.com|threads\.net|pinterest\.[a-z.]+|reddit\.com|linkedin\.com)$"#, options: .regularExpression) != nil
        return social ? nil : link
    }

    /// The ways to put a card right, by what it is: the first two show on the card, the rest under More.
    private func actions(_ save: Save) -> [SwipeAction] {
        var list: [SwipeAction] = []
        let busy = updating == save.id || fixing == save.id
        if save.kind == "product", let link = Self.storePage(save) {
            list.append(SwipeAction(id: "swipe.update", title: "Update", symbol: "arrow.clockwise", busyTitle: "Reading the page…",
                                    busy: updating == save.id, disabled: busy,
                                    hint: "Reads the store page this save links to and rewrites the card from it. You can undo it.") { update(save, from: link) })
        }
        if save.kind == "recipe" {
            list.append(SwipeAction(id: "swipe.addURL", title: "Add recipe URL", symbol: "link", disabled: busy,
                                    hint: "Paste the page with the full recipe, and its ingredients and steps go on this save.") { model.swipe?.linking = true })
        } else if save.kind == "product" || save.kind == "link" {
            list.append(SwipeAction(id: "swipe.addURL", title: "Add URL", symbol: "link", disabled: busy,
                                    hint: "Paste the product's page, and this save is rewritten from it.") { model.swipe?.linking = true })
        }
        if model.aiReady {
            list.append(SwipeAction(id: "swipe.fix", title: "Fix with AI", symbol: "sparkles", busyTitle: "Fixing…",
                                    busy: fixing == save.id, disabled: busy || model.aiRun != nil,
                                    hint: "Your AI reads this save again and fills in what's missing or wrong. You can undo it.") { fix(save) })
        }
        list.append(SwipeAction(id: "swipe.edit", title: "Edit title or note", symbol: "pencil", disabled: busy, hint: "") { editing = save })
        return list
    }

    private func fix(_ save: Save) {
        guard fixing == nil else { return }
        fixing = save.id
        Task {
            await model.fixWithAI([save])
            fixing = nil
        }
    }

    /// Update from its page: the same rebuild as Add URL, from the link the save already has.
    private func update(_ save: Save, from link: String) {
        guard updating == nil else { return }
        updating = save.id
        Task {
            if let failed = await model.rewriteProduct(save, from: link) { model.failed(failed) }
            updating = nil
        }
    }

    private func undo() {
        guard !undoing else { return }
        undoing = true
        Task {
            await model.swipeUndo()
            undoing = false
        }
    }
}

/// One save, as big as the screen allows: its picture, name, price and where it's from.
private struct SwipeCard: View {
    let save: Save
    /// The ways to put this card right; none for the one waiting underneath.
    let actions: [SwipeAction]
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.dynamicTypeSize) private var typeSize

    private var from: String { [save.retailer, save.host].compactMap { $0 }.first { !$0.isEmpty } ?? "" }
    private var deal: String { model.dealLines[save.id] ?? "" }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear
                .frame(maxWidth: .infinity, minHeight: 100, maxHeight: .infinity)
                .overlay { SaveImage(save, symbolSize: 56) }
                .clipped()
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(save.title).font(KSFont.name(.title2)).foregroundStyle(t.ink)
                    .lineLimit(typeSize.isAccessibilitySize ? 2 : 3).multilineTextAlignment(.leading)
                    .minimumScaleFactor(0.8)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("swipe.title")
                if let fact = save.fact, !fact.isEmpty {
                    Text(fact).font(.headline).foregroundStyle(t.ink).monospacedDigit()
                }
                if !deal.isEmpty { Text(deal).font(.subheadline.weight(.semibold)).foregroundStyle(t.ink) }
                if !from.isEmpty { Text(from).font(.subheadline).foregroundStyle(t.inkMuted).lineLimit(1) }
                if let about = save.description, !about.isEmpty, !typeSize.isAccessibilitySize {
                    Text(about).font(.subheadline).foregroundStyle(t.inkMuted).lineLimit(3).padding(.top, 2)
                }
                if !actions.isEmpty {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 10) { fixes(shown: 2) }
                        HStack(spacing: 10) { fixes(shown: 1) }
                    }
                    .padding(.top, 8)
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
        }
        .ksSurface(radius: 24)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .accessibilityIdentifier("swipe.card")
    }
}

/// One way to put a card right (Update from its page, Add URL, Fix with AI, Edit).
struct SwipeAction: Identifiable {
    let id: String
    let title: String
    let symbol: String
    var busyTitle = ""
    var busy = false
    var disabled = false
    let hint: String
    let run: () -> Void
}

extension SwipeCard {
    /// The first few as buttons, the rest under More.
    @ViewBuilder fileprivate func fixes(shown: Int) -> some View {
        ForEach(actions.prefix(shown)) { a in
            Button(action: a.run) {
                HStack(spacing: 8) {
                    if a.busy { ProgressView().controlSize(.small).tint(t.ink) } else { Image(systemName: a.symbol) }
                    Text(a.busy ? a.busyTitle : a.title).lineLimit(1)
                }
                .font(.subheadline.weight(.semibold)).frame(minHeight: 32)
            }
            .buttonStyle(.bordered).buttonBorderShape(.capsule).tint(t.ink)
            .disabled(a.disabled)
            .accessibilityHint(a.hint)
            .accessibilityIdentifier(a.id)
        }
        if actions.count > shown {
            Menu {
                ForEach(actions.dropFirst(shown)) { a in
                    Button(a.busy ? a.busyTitle : a.title, systemImage: a.symbol, action: a.run).disabled(a.disabled)
                }
            } label: {
                Image(systemName: "ellipsis").font(.subheadline.weight(.bold)).frame(minWidth: 20, minHeight: 32)
            }
            .buttonStyle(.bordered).buttonBorderShape(.capsule).tint(t.ink)
            .accessibilityLabel("More ways to fix this save")
            .accessibilityIdentifier("swipe.more")
        }
    }
}

/// What you kept, each opening its own page; at the end of a run, with how it went.
private struct SwipeKept: View {
    let session: SwipeSession
    let finished: Bool
    /// Cards not decided yet.
    let left: Int
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t

    private var kept: [Save] { session.kept.compactMap { model.index.byId[$0] } }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ScreenHeader(title: finished && left == 0 ? "All done" : "Kept", subtitle: summary)
            if kept.isEmpty {
                EmptyNote(symbol: "checkmark.circle", text: finished ? "Nothing kept this time." : "Nothing kept yet.")
            } else {
                LazyVStack(spacing: 10) {
                    ForEach(kept) { save in
                        NavigationLink(value: save) {
                            HStack(spacing: 12) {
                                SaveImage(save, symbolSize: 22)
                                    .frame(width: 64, height: 64)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(save.title).font(.headline).foregroundStyle(t.ink).lineLimit(2).multilineTextAlignment(.leading)
                                    if let fact = save.fact, !fact.isEmpty {
                                        Text(fact).font(.footnote).foregroundStyle(t.inkMuted).monospacedDigit().lineLimit(1)
                                    }
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right").font(.body.weight(.bold)).foregroundStyle(t.inkMuted).accessibilityHidden(true)
                            }
                            .padding(12)
                            .ksSurface(radius: 14)
                        }
                        .buttonStyle(PressStyle())
                        .accessibilityHint("Opens the save")
                        .accessibilityIdentifier("swipe.keptRow")
                    }
                }
            }
            startOver
        }
    }

    /// At the end: what you kept won't come up next time, and the way to see everything again anyway.
    @ViewBuilder private var startOver: some View {
        let all = session.all.filter { model.index.byId[$0] != nil }
        if finished, left == 0, !all.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("What you kept stays out of the next Play, so it picks up where you stopped.")
                    .font(.footnote).foregroundStyle(t.inkMuted)
                Button("Go through all \(all.count) again", systemImage: "arrow.counterclockwise") {
                    model.startSwipe(session.title, ids: all, again: true)
                }
                .font(.subheadline.weight(.semibold)).tint(t.ink).frame(minHeight: 44)
                .accessibilityIdentifier("swipe.again")
            }
            .padding(.top, 4)
        }
    }

    /// "Kept 5. Moved 3 to the Trash. 2 left."
    private var summary: String {
        let k = kept.count, x = session.trashed
        var parts: [String] = []
        if finished || k > 0 { parts.append("Kept \(k).") }
        if x > 0 { parts.append("Moved \(x) to the Trash.") }
        if left > 0 { parts.append("\(left) left.") }
        return parts.joined(separator: " ")
    }
}
