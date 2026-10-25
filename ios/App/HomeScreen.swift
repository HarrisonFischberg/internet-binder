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
    /// Recent shelf cards: all one size, growing with Dynamic Type.
    @ScaledMetric(relativeTo: .headline) private var shelfWidth: CGFloat = 170
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
                        ScreenHeader(title: "Internet Binder", subtitle: nil)
                        if size != .regular {
                            HStack(spacing: 10) {
                                if model.aiReady && !model.saves.isEmpty {
                                    headerButton("sparkles", "Fix everything with AI") { fixingAll = true }
                                        .disabled(model.aiRun != nil)
                                }
                                headerButton("paintpalette", "Appearance") { appearance = true }
                                headerButton("gearshape", "Settings") { settings = true }
                            }
                            .padding(.top, 8)
                        }
                    }
                    if model.reviewCount > 0 { reviewBanner }
                    if model.aiReady && !model.aiBacklog.isEmpty {
                        RunAIOnImportedButton()
                            .font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
                            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading).padding(.horizontal, 16)
                            .ksSurface(radius: 14)
                    }
                    if model.saves.isEmpty && model.loaded {
                        EmptyNote(symbol: "bookmark", text: "Nothing saved yet. Share a page, a post or a place to Internet Binder from any app.")
                    }
                    if !newest.isEmpty { recent.padding(.bottom, -8) }
                    VStack(spacing: 12) {
                        ForEach(sectionOrder, id: \.self) { section in
                            Group {
                                if section == "collections" {
                                    shelfRow("Collections", route: .collections, saves: collectedSaves, symbol: "bag", tint: KindStyle("product").color, fill: "place",
                                             detail: count(collectionCount, "collection") + " · " + count(collectedCount, "save"))
                                } else {
                                    shelfRow("Lifestyle", route: .lifestyle, saves: lifestyleSaves, symbol: "sparkles", tint: KindStyle("recipe").color, fill: "video",
                                             detail: lifestyleCount == 0 ? "Places, recipes, workouts and more" : count(lifestyleViews, "kind") + " · " + count(lifestyleCount, "save"))
                                }
                            }
                            .reorderable(section, in: $sectionOrder, dragging: $dragging, reduce: reduce) { SavedOrder.set(HomeSections.key, $0) }
                        }
                    }
                    if let save = comeBackTo { comeBack(save).padding(.top, 6) }
                }
                .padding(.horizontal, 18).padding(.bottom, 40)
            }
            .safeAreaInset(edge: .top, spacing: 0) { TopScrim() }
        }
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $settings) { SettingsScreen() }
        .confirmationDialog("Fix all \(model.saves.count) saves with AI?", isPresented: $fixingAll, titleVisibility: .visible) {
            Button("Fix everything") { Task { await model.fixWithAI(model.saves) } }
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
        Button(action: action) {
            Image(systemName: symbol).font(.body.weight(.bold)).foregroundStyle(t.ink)
                .frame(width: 44, height: 44)
                .ksSurface(radius: 22, scale: 0.75)
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(label)
    }

    private func count(_ n: Int, _ noun: String) -> String { n == 1 ? "1 \(noun)" : "\(n) \(noun)s" }

    /// A folded section: a fan of its pictures, its name and what it holds. One tap opens its page.
    private func shelfRow(_ title: String, route: Route, saves: [Save], symbol: String, tint: Color, fill: String, detail: String) -> some View {
        // Pantry Pop paints the two shelves in kind colours (teal and pink), with ink text.
        let bold = t.style == .pantry
        return NavigationLink(value: route) {
            HStack(spacing: 14) {
                CoverFan(saves, symbol: symbol, tint: tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(KSFont.name(.title2)).foregroundStyle(bold ? t.onKind : t.ink)
                    Text(detail).font(.subheadline.weight(bold ? .bold : .regular)).foregroundStyle(bold ? t.onKind : t.inkMuted).lineLimit(2)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.subheadline.weight(.bold)).foregroundStyle(bold ? t.onKind : t.inkMuted)
            }
            .padding(.horizontal, 14).padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 84, alignment: .leading)
            .ksSurface(bold ? t.kindFill(fill) : nil)
        }
        .buttonStyle(PressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(detail)
        .accessibilityAddTraits(.isButton)
    }

    private var reviewBanner: some View {
        NavigationLink(value: Route.review) {
            // What needs you, in the style's one loud colour (mustard, highlighter, amber, signal red).
            let ink = t.style == .gallery ? t.ink : t.onHighlight
            HStack(spacing: 14) {
                Image(systemName: "tray.full").font(.title3.weight(.semibold)).foregroundStyle(t.style == .pantry ? t.ink : ink)
                    .frame(width: 40, height: 40)
                    .background { if t.style == .pantry { RoundedRectangle(cornerRadius: 10).fill(t.paper).overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(t.line, lineWidth: 2)) } }
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.reviewCount == 1 ? "1 save needs a collection" : "\(model.reviewCount) saves need a collection")
                        .font(t.style == .pantry ? KSFont.name(.headline) : .headline).foregroundStyle(ink)
                    Text("One tap each, and it learns.").font(.subheadline.weight(t.style == .pantry ? .semibold : .regular)).foregroundStyle(ink)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.body.weight(.bold)).foregroundStyle(ink)
            }
            .padding(14)
            .ksSurface(t.style == .gallery ? t.well : t.highlight)
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
                            ShelfCard(save, width: min(shelfWidth, 320)).matchedTransitionSource(id: save.id, in: zoom)
                        }
                        .buttonStyle(PressStyle())
                        // Hold and slide to put Recent in your own order.
                        .reorderable(save.id, in: $recentOrder, dragging: $dragging, reduce: reduce) { SavedOrder.set("recentOrder", $0) }
                        // Long press: the same menu as the Library's cards.
                        .contextMenu { SaveMenu(save: save) }
                        .accessibilityAction(named: "Move to Trash") { Task { await model.trash(save) } }
                    }
                }
                .padding(.horizontal, 18).padding(.top, 6).padding(.bottom, 10)
            }
            .scrollIndicators(.hidden)
            .padding(.horizontal, -18)
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
        Text(title).font(KSFont.name(.title2)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
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
