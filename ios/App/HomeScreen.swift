import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Home: what needs you, what's new, your Collections and Lifestyle (each folded into one row that
/// opens its own page), and one save to come back to. Nothing else.
struct HomeScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @State private var settings = false
    @State private var appearance = false
    @State private var fixingAll = false
    @State private var collections: [SaveCollection] = []
    /// Recent and the two sections, in the order you've dragged them into.
    @State private var recentOrder: [String] = []
    @State private var sectionOrder: [String] = []
    @State private var dragging: String?
    @Environment(\.accessibilityReduceMotion) private var reduce
    /// Recent shelf cards: all one size (168 pt at the default text size), growing with Dynamic Type.
    @ScaledMetric(relativeTo: .headline) private var shelfWidth: CGFloat = 164
    @Environment(\.horizontalSizeClass) private var size
    @Environment(\.dynamicTypeSize) private var typeSize

    private var lifestyleSaves: [Save] { model.glance?.lifestyle ?? model.index.lifestyle }
    private var collectedSaves: [Save] { model.glance?.collected ?? model.index.collected }
    /// Until the whole library is read, Home draws from the launch glance (newest saves, counts).
    private var newest: [Save] { model.glance?.recent ?? Array(model.saves.prefix(8)) }
    private var collectionCount: Int { model.glance?.collections ?? collections.count }
    private var collectedCount: Int { model.glance?.collectedCount ?? collectedSaves.count }
    private var lifestyleCount: Int { model.glance?.lifestyleCount ?? lifestyleSaves.count }
    private var lifestyleViews: Int { model.glance?.lifestyleKinds ?? Set(lifestyleSaves.map(\.kind)).count }

    /// Saved over six weeks ago and not opened since (Home's "Come back to" in Chrome).
    private var comeBackTo: Save? { model.index.comeBackTo }

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // At accessibility sizes the buttons drop below the name, so the name gets the full width.
                    (typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .trailing, spacing: 4)) : AnyLayout(HStackLayout(alignment: .top))) {
                        Wordmark()
                        if size != .regular {
                            // One piece of glass for the header's controls.
                            GlassEffectContainer(spacing: 10) {
                                HStack(spacing: 10) {
                                    if model.aiReady && !model.saves.isEmpty {
                                        headerButton("sparkles", "Fix everything with AI") { fixingAll = true }
                                            .disabled(model.aiRun != nil)
                                    }
                                    headerButton("paintpalette", "Appearance") { appearance = true }
                                    headerButton("gearshape", "Settings") { settings = true }
                                }
                            }
                            .padding(.top, 8)
                        }
                    }
                    if model.reviewCount > 0 { reviewBanner }
                    FinishFixingButton()
                        .font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
                    if model.aiReady && !model.aiBacklog.isEmpty {
                        RunAIOnImportedButton()
                            .font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
                            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading).padding(.horizontal, 16)
                            .ksSurface(radius: 14)
                    }
                    if model.saves.isEmpty && model.loaded {
                        EmptyNote(symbol: "bookmark", text: "Save something worth coming back to. Share a page, a post or a place to Internet Binder from any app.")
                    }
                    if !newest.isEmpty { recent.padding(.bottom, -8) }
                    // Chromatic sets the two folders side by side; at large text sizes, and in the other
                    // appearances, they stack.
                    (t.style == .chromatic && !typeSize.isAccessibilitySize ? AnyLayout(HStackLayout(alignment: .top, spacing: 12)) : AnyLayout(VStackLayout(spacing: 12))) {
                        ForEach(sectionOrder, id: \.self) { section in
                            Group {
                                if section == "collections" {
                                    shelfRow("Collections", route: .collections, saves: collectedSaves, symbol: "bag", second: false,
                                             detail: count(collectionCount, "collection") + " · " + count(collectedCount, "save"))
                                } else {
                                    shelfRow("Lifestyle", route: .lifestyle, saves: lifestyleSaves, symbol: "sparkles", second: true,
                                             detail: lifestyleCount == 0 ? "Places, recipes, workouts and more" : count(lifestyleViews, "kind") + " · " + count(lifestyleCount, "save"))
                                }
                            }
                            .reorderable(section, in: $sectionOrder, dragging: $dragging, reduce: reduce) { SavedOrder.set(HomeSections.key, $0) }
                        }
                    }
                    if let save = comeBackTo { comeBack(save).padding(.top, 6) }
                }
                .padding(.horizontal, 20).padding(.bottom, 40)
            }
            .safeAreaInset(edge: .top, spacing: 0) { TopScrim() }
        }
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $settings) { SettingsScreen() }
        .confirmationDialog("Fix all \(model.saves.count) saves with AI?", isPresented: $fixingAll, titleVisibility: .visible) {
            Button("Fix everything") { Task { await model.fixWithAI(model.saves, screen: true) } }
        } message: {
            Text("Your AI provider reads each save again: what it is from its picture, a product's shop page, and where it goes. Every change can be undone. Fix one collection or Lifestyle view from its own page.")
        }
        .sheet(isPresented: $appearance) { AppearanceSheet() }
        .task(id: model.saves.count) { collections = (try? model.library?.collections()) ?? [] }
        .onAppear { sectionOrder = HomeSections.order() }
        // The newest eight, in your order; a new save joins at the front.
        .onChange(of: newest.map(\.id), initial: true) { _, latest in
            recentOrder = latest.arranged(by: SavedOrder.get("recentOrder"), newFirst: true) { $0 }
        }
    }

    private func headerButton(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { GlassIcon(symbol) }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
    }

    private func count(_ n: Int, _ noun: String) -> String { n == 1 ? "1 \(noun)" : "\(n) \(noun)s" }

    /// A folded section (Collections or Lifestyle): a fan of its pictures, its name and what it holds.
    /// One tap opens its page. Nocturne lights the card from one side (cyan for Collections, amber for
    /// Lifestyle); Paper & Ink lays it on sage or rose card; Chromatic files it in a lilac or coral folder.
    private func shelfRow(_ title: String, route: Route, saves: [Save], symbol: String, second: Bool, detail: String) -> some View {
        NavigationLink(value: route) {
            Group {
                if t.style == .chromatic { folderRow(title, saves: saves, symbol: symbol, second: second, detail: detail) }
                else { cardRow(title, saves: saves, symbol: symbol, second: second, detail: detail) }
            }
        }
        .buttonStyle(PressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(detail)
        .accessibilityHint("Opens \(title)")
        .accessibilityAddTraits(.isButton)
    }

    private func cardRow(_ title: String, saves: [Save], symbol: String, second: Bool, detail: String) -> some View {
        let paper = t.style == .paper
        let glow = second ? t.accent : t.detail
        let fill: Color = paper ? (second ? t.alt : t.detail) : t.paper
        let ink: Color = paper ? (second ? t.onAlt : t.onDetail) : t.ink
        return HStack(spacing: 14) {
            CoverFan(saves, symbol: symbol, tint: glow, size: 50)
            VStack(alignment: .leading, spacing: 3) {
                Label {
                    Text(title).font(paper ? .system(.title, design: .serif).weight(.medium) : KSFont.name(.title2))
                } icon: {
                    if !paper { Image(systemName: symbol).foregroundStyle(glow).font(.title3.weight(.semibold)) }
                }
                .labelStyle(.titleAndIcon)
                .foregroundStyle(ink)
                Text(detail).font(.subheadline).foregroundStyle(paper ? ink.opacity(0.78) : t.inkMuted).lineLimit(2).monospacedDigit()
            }
            Spacer(minLength: 0)
            ChevronDisc(fill: paper ? ink.opacity(0.85) : glow.opacity(0.18), ink: paper ? fill : glow)
        }
        .padding(.horizontal, 16).padding(.vertical, 16)
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .leading)
        .background {
            if !paper {
                LinearGradient(colors: [glow.opacity(0.22), glow.opacity(0.04)], startPoint: .leading, endPoint: .trailing)
            }
        }
        .ksSurface(fill, stroke: paper ? .clear : glow.opacity(0.35))
    }

    private func folderRow(_ title: String, saves: [Save], symbol: String, second: Bool, detail: String) -> some View {
        let fill = second ? t.alt : t.accent
        let ink = t.onAccent
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                Image(systemName: second ? "sparkles" : "folder.fill").font(.title3.weight(.semibold)).foregroundStyle(ink.opacity(0.85))
                    .frame(width: 40, height: 40).background(ink.opacity(0.1), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Spacer(minLength: 0)
                CoverFan(saves, symbol: symbol, tint: ink, size: 48)
                    .offset(y: -22)
            }
            Spacer(minLength: 4)
            Text(title).font(KSFont.name(.title2)).foregroundStyle(ink).lineLimit(1).minimumScaleFactor(0.7)
            HStack(alignment: .bottom) {
                Text(detail).font(.footnote.weight(.medium)).foregroundStyle(ink.opacity(0.8)).lineLimit(2).monospacedDigit()
                Spacer(minLength: 4)
                ChevronDisc(fill: ink.opacity(0.12), ink: ink)
            }
        }
        .padding(14).padding(.top, 14)
        .frame(maxWidth: .infinity, minHeight: 168, alignment: .topLeading)
        .background(FolderShape(tab: 18, radius: t.radius).fill(fill))
        .contentShape(FolderShape(tab: 18, radius: t.radius))
    }

    private var reviewBanner: some View {
        NavigationLink(value: Route.review) {
            // What needs you, in the appearance's one interactive colour.
            HStack(spacing: 14) {
                Image(systemName: "tray.full").font(.title3.weight(.semibold)).foregroundStyle(t.onHighlight)
                    .frame(width: 40, height: 40)
                    .background(t.onHighlight.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.reviewCount == 1 ? "1 save needs a collection" : "\(model.reviewCount) saves need a collection")
                        .font(.headline).foregroundStyle(t.onHighlight)
                    Text("One tap each, and it learns.").font(.subheadline).foregroundStyle(t.onHighlight.opacity(0.85))
                }
                Spacer()
                Image(systemName: "chevron.right").font(.body.weight(.bold)).foregroundStyle(t.onHighlight)
            }
            .padding(14)
            .ksSurface(t.highlight, stroke: .clear)
        }
        .buttonStyle(PressStyle())
    }

    private var recent: some View {
        VStack(alignment: .leading, spacing: 6) {
            section("Recent")
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    ForEach(recentOrder.compactMap { id in newest.first { $0.id == id } }) { save in
                        NavigationLink(value: save) {
                            ShelfCard(save, width: min(shelfWidth, 300)).matchedTransitionSource(id: save.id, in: zoom)
                        }
                        .buttonStyle(PressStyle())
                        // Hold and slide to put Recent in your own order.
                        .reorderable(save.id, in: $recentOrder, dragging: $dragging, reduce: reduce) { SavedOrder.set("recentOrder", $0) }
                        // Long press: the same menu as the Library's cards.
                        .contextMenu { SaveMenu(save: save) }
                        .accessibilityAction(named: "Move to Trash") { Task { await model.trash(save) } }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 6).padding(.bottom, 14)
            }
            .scrollIndicators(.hidden)
            .padding(.horizontal, -20)
        }
    }

    private func comeBack(_ save: Save) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            section("Come back to")
            NavigationLink(value: save) {
                SaveObject(save).frame(maxWidth: 260).matchedTransitionSource(id: save.id, in: zoom)
            }
            .buttonStyle(PressStyle())
        }
    }

    private func section(_ title: String) -> some View {
        Text(title).font(KSFont.section()).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
    }
}

/// "Internet Binder" in the appearance's display face, with its line under it. Nocturne lights the
/// second word in amber.
struct Wordmark: View {
    @Environment(\.ks) private var t
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Group {
                if t.style == .nocturne {
                    Text("Internet ") + Text("Binder").foregroundStyle(t.accent)
                } else {
                    Text("Internet Binder")
                }
            }
            .font(KSFont.display())
            .foregroundStyle(t.ink)
            .accessibilityAddTraits(.isHeader)
            .accessibilityLabel("Internet Binder")
            if let line = t.tagline {
                Text(line).font(t.style == .nocturne ? .subheadline.italic() : .subheadline).foregroundStyle(t.inkMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
    }
}

/// A chevron in a small disc: the "open" mark on Home's summary cards.
struct ChevronDisc: View {
    let fill: Color
    let ink: Color
    var body: some View {
        Image(systemName: "chevron.right").font(.subheadline.weight(.bold)).foregroundStyle(ink)
            .frame(width: 36, height: 36).background(fill, in: Circle())
            .accessibilityHidden(true)
    }
}

/// Home's two sections (and the Library's), in the order you've put them: Collections first unless
/// you've dragged Lifestyle above it.
enum HomeSections {
    static let key = "homeSectionOrder"
    static func order(_ saved: String? = nil) -> [String] {
        ["collections", "lifestyle"].arranged(by: saved.map { $0.split(separator: "\n").map(String.init) } ?? SavedOrder.get(key)) { $0 }
    }
}
