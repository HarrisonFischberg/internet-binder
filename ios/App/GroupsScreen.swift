import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Lifestyle: every Lifestyle view that has saves (Places, Recipes, Workouts…), each a stack you open.
struct LifestyleScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    private var lifestyle: [Save] { model.saves.filter(\.hasOwnView) }

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ScreenHeader(title: "Lifestyle", subtitle: "Places, recipes, workouts and more")
                    if model.saves.contains(where: \.hasOwnView) {
                        LifestyleTiles()
                    } else {
                        EmptyNote(symbol: "sparkles", text: "Nothing here yet. Share a recipe, a place or a workout to Keepsake and it lands here.")
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, 40)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.aiReady && !lifestyle.isEmpty {
                ToolbarItem(placement: .primaryAction) { FixWithAIButton(saves: lifestyle, what: "all \(lifestyle.count) Lifestyle saves") }
            }
        }
    }
}

/// The grid both pages and the Library use: two stacks across on iPhone, more on iPad.
let groupColumns = [GridItem(.adaptive(minimum: 150), spacing: 16)]

/// Each Lifestyle view with saves, as a stack linking to its view: most saves first (a tie A–Z), until
/// you drag them into your own order (kept on this iPhone). "Sort by most saves" goes back.
struct LifestyleTiles: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var order: [String] = []
    @State private var dragging: String?
    @State private var manual = !SavedOrder.get(Self.key).isEmpty
    static let key = "lifestyleOrder"

    private var counts: [String: Int] { Dictionary(model.saves.map { ($0.kind, 1) }, uniquingKeysWith: +) }
    private var present: [String] {
        let counts = counts
        return KindStyle.lifestyle.filter { counts[$0] != nil }.mostFirst(count: { counts[$0] ?? 0 }, name: { KindStyle($0).plural })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            LazyVGrid(columns: groupColumns, spacing: 20) {
                ForEach(order, id: \.self) { kind in
                    let items = model.saves.filter { $0.kind == kind }
                    let k = KindStyle(kind)
                    NavigationLink(value: Route.kind(kind)) {
                        GroupTile(k.plural, subtitle: items.isEmpty ? "Empty" : (items.count == 1 ? "1 save" : "\(items.count) saves"),
                                  cover: items.first(where: \.hasImage) ?? items.first, symbol: k.symbol, tint: k.color, kind: kind)
                    }
                    .buttonStyle(PressStyle())
                    .reorderable(kind, in: $order, dragging: $dragging, reduce: reduce) { SavedOrder.set(Self.key, $0); manual = true }
                }
            }
            if manual {
                SortByMostButton {
                    SavedOrder.set(Self.key, [])
                    manual = false
                    withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { order = present }
                }
            }
        }
        .onChange(of: present, initial: true) { _, kinds in order = manual ? kinds.arranged(by: SavedOrder.get(Self.key)) { $0 } : kinds }
    }
}

/// Each collection as a stack with one of its pictures on top, linking to the collection. Pinned
/// collections come first, then the rest with the most saves first (a tie A–Z). Drag them and your
/// order is kept instead (Chrome's order, which dragging here changes), until "Sort by most saves".
struct CollectionTiles: View {
    let collections: [SaveCollection]
    var onNew: (() -> Void)?
    @Environment(LibraryModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var order: [String] = []
    @State private var dragging: String?
    @State private var manual = !SavedOrder.get(Self.key).isEmpty
    /// Set once you drag a collection: Keepsake stops sorting them by size on this iPhone.
    static let key = "collectionOrderManual"

    private var counts: [String: Int] { Dictionary(model.saves.compactMap { $0.collectionId.map { ($0, 1) } }, uniquingKeysWith: +) }

    /// Pinned first, then by size; once you've dragged, the stored order as it is.
    private func arranged(manual: Bool) -> [String] {
        guard !manual else { return collections.map(\.id) }
        let counts = counts
        let pinned = collections.filter { $0.pinned == true }
        let rest = collections.filter { $0.pinned != true }.mostFirst(count: { counts[$0.id] ?? 0 }, name: \.name)
        return (pinned + rest).map(\.id)
    }

    /// What the order depends on (not whether you've dragged: the drag itself sets the order).
    private var signature: [String] {
        let counts = counts
        return collections.map { "\($0.id)|\($0.pinned == true)|\(counts[$0.id] ?? 0)" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            LazyVGrid(columns: groupColumns, spacing: 20) {
                ForEach(order.compactMap { id in collections.first { $0.id == id } }) { c in
                    let items = model.saves.filter { $0.collectionId == c.id }
                    NavigationLink(value: Route.collection(c.id, c.name)) {
                        GroupTile(c.name, subtitle: items.isEmpty ? "Empty" : (items.count == 1 ? "1 save" : "\(items.count) saves"),
                                  cover: items.first(where: \.hasImage) ?? items.first, symbol: c.pinned == true ? "pin" : "bag", tint: KindStyle("product").color)
                    }
                    .buttonStyle(PressStyle())
                    .reorderable(c.id, in: $order, dragging: $dragging, reduce: reduce) { ids in
                        SavedOrder.set(Self.key, ["on"])
                        manual = true
                        Task { try? await model.library?.reorderCollections(ids) }
                    }
                }
                if let onNew {
                    Button(action: onNew) { NewGroupTile("New collection") }
                        .buttonStyle(PressStyle())
                }
            }
            if manual && collections.count > 1 {
                SortByMostButton {
                    SavedOrder.set(Self.key, [])
                    manual = false
                    withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { order = arranged(manual: false) }
                }
            }
        }
        .onChange(of: signature, initial: true) { order = arranged(manual: manual) }
    }
}

/// Puts a row of stacks you dragged into your own order back to most saves first.
struct SortByMostButton: View {
    let action: () -> Void
    @Environment(\.ks) private var t

    var body: some View {
        Button(action: action) {
            Label("Sort by most saves", systemImage: "arrow.up.arrow.down")
                .font(.footnote.weight(.semibold)).foregroundStyle(t.inkMuted)
                .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
    }
}

/// A section of the Library: its name, how many it holds, and its stacks.
struct GroupSection<Content: View>: View {
    let title: String
    let detail: String
    @ViewBuilder let content: Content
    @Environment(\.ks) private var t

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(KSFont.name(.title2)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                Spacer()
                Text(detail).font(.footnote).foregroundStyle(t.inkMuted)
            }
            content
        }
    }
}
