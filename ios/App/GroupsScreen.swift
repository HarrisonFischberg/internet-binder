import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Lifestyle: every Lifestyle view that has saves (Places, Recipes, Workouts…), each a stack you open.
struct LifestyleScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model

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
    }
}

/// The grid both pages and the Library use: two stacks across on iPhone, more on iPad.
let groupColumns = [GridItem(.adaptive(minimum: 150), spacing: 16)]

/// Each Lifestyle view with saves, as a stack linking to its view: Chrome's order until you drag them
/// into your own (kept on this iPhone).
struct LifestyleTiles: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var order: [String] = []
    @State private var dragging: String?
    static let key = "lifestyleOrder"

    private var present: [String] { KindStyle.lifestyle.filter { k in model.saves.contains { $0.kind == k } } }

    var body: some View {
        LazyVGrid(columns: groupColumns, spacing: 20) {
            ForEach(order, id: \.self) { kind in
                let items = model.saves.filter { $0.kind == kind }
                let k = KindStyle(kind)
                NavigationLink(value: Route.kind(kind)) {
                    GroupTile(k.plural, subtitle: items.isEmpty ? "Empty" : (items.count == 1 ? "1 save" : "\(items.count) saves"),
                              cover: items.first(where: \.hasImage) ?? items.first, symbol: k.symbol, tint: k.color, kind: kind)
                }
                .buttonStyle(PressStyle())
                .reorderable(kind, in: $order, dragging: $dragging, reduce: reduce) { SavedOrder.set(Self.key, $0) }
            }
        }
        .onChange(of: present, initial: true) { _, kinds in order = kinds.arranged(by: SavedOrder.get(Self.key)) { $0 } }
    }
}

/// Each collection as a stack with one of its pictures on top, linking to the collection. Pinned
/// collections come first, then your order (Chrome's, which dragging here changes for every device).
struct CollectionTiles: View {
    let collections: [SaveCollection]
    var onNew: (() -> Void)?
    @Environment(LibraryModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var order: [String] = []
    @State private var dragging: String?

    var body: some View {
        LazyVGrid(columns: groupColumns, spacing: 20) {
            ForEach(order.compactMap { id in collections.first { $0.id == id } }) { c in
                let items = model.saves.filter { $0.collectionId == c.id }
                NavigationLink(value: Route.collection(c.id, c.name)) {
                    GroupTile(c.name, subtitle: items.isEmpty ? "Empty" : (items.count == 1 ? "1 save" : "\(items.count) saves"),
                              cover: items.first(where: \.hasImage) ?? items.first, symbol: c.pinned == true ? "pin" : "bag", tint: KindStyle("product").color)
                }
                .buttonStyle(PressStyle())
                .reorderable(c.id, in: $order, dragging: $dragging, reduce: reduce) { ids in
                    Task { try? await model.library?.reorderCollections(ids) }
                }
            }
            if let onNew {
                Button(action: onNew) { NewGroupTile("New collection") }
                    .buttonStyle(PressStyle())
            }
        }
        .onChange(of: collections.map(\.id), initial: true) { _, ids in order = ids }
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
