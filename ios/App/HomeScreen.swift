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
    @State private var collections: [SaveCollection] = []
    /// Recent and the two sections, in the order you've dragged them into.
    @State private var recentOrder: [String] = []
    @State private var sectionOrder: [String] = []
    @State private var dragging: String?
    @Environment(\.accessibilityReduceMotion) private var reduce
    /// Recent shelf cards: all one size, growing with Dynamic Type.
    @ScaledMetric(relativeTo: .headline) private var shelfWidth: CGFloat = 170
    @Environment(\.horizontalSizeClass) private var size

    private var lifestyleSaves: [Save] { model.saves.filter(\.hasOwnView) }
    private var collectedSaves: [Save] { model.saves.filter { !($0.collectionId ?? "").isEmpty } }
    private var lifestyleViews: Int { Set(lifestyleSaves.map(\.kind)).count }

    /// Saved over six weeks ago and not opened since (Home's "Come back to" in Chrome).
    private var comeBackTo: Save? {
        let cutoff = Date().addingTimeInterval(-42 * 86_400)
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func old(_ s: String?) -> Bool { s.flatMap { iso.date(from: $0) }.map { $0 < cutoff } ?? true }
        return model.saves.first { $0.status != "done" && $0.purchased != true && old($0.createdAt) && old($0.openedAt) }
    }

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .top) {
                        ScreenHeader(title: "Keepsake", subtitle: nil)
                        if size != .regular { Button { settings = true } label: {
                            Image(systemName: "gearshape").font(.body.weight(.semibold)).foregroundStyle(t.ink)
                                .padding(12).frame(minWidth: 44, minHeight: 44)
                                .background(t.paper, in: Circle()).overlay(Circle().strokeBorder(t.rule, lineWidth: 0.75))
                        }
                        .accessibilityLabel("Settings")
                        .padding(.top, 8) }
                    }
                    if model.reviewCount > 0 { reviewBanner }
                    if model.saves.isEmpty && model.loaded {
                        EmptyNote(symbol: "bookmark", text: "Nothing saved yet. Share a page, a post or a place to Keepsake from any app.")
                    }
                    if !model.saves.isEmpty { recent.padding(.bottom, -8) }
                    VStack(spacing: 12) {
                        ForEach(sectionOrder, id: \.self) { section in
                            Group {
                                if section == "collections" {
                                    shelfRow("Collections", route: .collections, saves: collectedSaves, symbol: "bag", tint: KindStyle("product").color,
                                             detail: count(collections.count, "collection") + " · " + count(collectedSaves.count, "save"))
                                } else {
                                    shelfRow("Lifestyle", route: .lifestyle, saves: lifestyleSaves, symbol: "sparkles", tint: KindStyle("recipe").color,
                                             detail: lifestyleSaves.isEmpty ? "Places, recipes, workouts and more" : count(lifestyleViews, "view") + " · " + count(lifestyleSaves.count, "save"))
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
        .task(id: model.saves.count) { collections = (try? model.library?.collections()) ?? [] }
        .onAppear { sectionOrder = HomeSections.order() }
        // The newest eight, in your order; a new save joins at the front.
        .onChange(of: model.saves.prefix(8).map(\.id), initial: true) { _, latest in
            recentOrder = latest.arranged(by: SavedOrder.get("recentOrder"), newFirst: true) { $0 }
        }
    }

    private func count(_ n: Int, _ noun: String) -> String { n == 1 ? "1 \(noun)" : "\(n) \(noun)s" }

    /// A folded section: a fan of its pictures, its name and what it holds. One tap opens its page.
    private func shelfRow(_ title: String, route: Route, saves: [Save], symbol: String, tint: Color, detail: String) -> some View {
        NavigationLink(value: route) {
            HStack(spacing: 14) {
                CoverFan(saves, symbol: symbol, tint: tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(KSFont.name(.title3)).foregroundStyle(t.ink)
                    Text(detail).font(.subheadline).foregroundStyle(t.inkMuted).lineLimit(2)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.subheadline.weight(.semibold)).foregroundStyle(t.inkMuted)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
            .background(t.paper).resting()
        }
        .buttonStyle(PressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(detail)
        .accessibilityAddTraits(.isButton)
    }

    private var reviewBanner: some View {
        NavigationLink(value: Route.review) {
            HStack(spacing: 14) {
                Image(systemName: "tray.full").font(.title3).foregroundStyle(t.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.reviewCount == 1 ? "1 save needs a collection" : "\(model.reviewCount) saves need a collection")
                        .font(.headline).foregroundStyle(t.ink)
                    Text("Keepsake wasn't sure where these go.").font(.subheadline).foregroundStyle(t.inkMuted)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(t.inkMuted)
            }
            .padding(16)
            .background(t.paper)
            .overlay(alignment: .leading) { Rectangle().fill(t.accent).frame(width: 3) }
            .resting()
        }
        .buttonStyle(PressStyle())
    }

    private var recent: some View {
        VStack(alignment: .leading, spacing: 6) {
            section("Recent")
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    ForEach(recentOrder.compactMap { id in model.saves.first { $0.id == id } }) { save in
                        NavigationLink(value: save) {
                            ShelfCard(save, width: min(shelfWidth, 320)).matchedTransitionSource(id: save.id, in: zoom)
                        }
                        .buttonStyle(PressStyle())
                        // Hold and slide to put Recent in your own order.
                        .reorderable(save.id, in: $recentOrder, dragging: $dragging, reduce: reduce) { SavedOrder.set("recentOrder", $0) }
                        // Long press: the same menu as the Library's cards.
                        .contextMenu {
                            Button("Move to Trash", systemImage: "trash", role: .destructive) { Task { await model.trash(save) } }
                        }
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
