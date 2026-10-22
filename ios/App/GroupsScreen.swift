import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Lifestyle: every Lifestyle view that has saves (Places, Recipes, Workouts…), each a stack you open.
/// Select mode ticks whole views: delete every save in them at once (with Undo).
struct LifestyleScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @State private var selecting = false
    @State private var selected: Set<String> = []
    private var lifestyle: [Save] { model.saves.filter(\.hasOwnView) }

    var body: some View {
        ZStack(alignment: .bottom) {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ScreenHeader(title: "Lifestyle", subtitle: "Places, recipes, workouts and more")
                    if model.saves.contains(where: \.hasOwnView) {
                        LifestyleTiles(selection: selecting ? $selected : nil) { kind in
                            selected = [kind]
                            selecting = true
                        }
                    } else {
                        EmptyNote(symbol: "sparkles", text: "Nothing here yet. Share a recipe, a place or a workout to Keepsake and it lands here.")
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, selecting ? 140 : 40)
            }
            if selecting {
                let inside = lifestyle.filter { selected.contains($0.kind) }.count
                SelectionBar(noun: { $0 == 1 ? "view" : "views" }, all: KindStyle.lifestyle.filter { k in lifestyle.contains { $0.kind == k } }, selected: $selected) {
                    Button {
                        let kinds = selected
                        Task {
                            await model.trashKinds(kinds)
                            selected = []
                            selecting = false
                        }
                    } label: {
                        BarTrashLabel(title: inside == 0 ? "Delete" : "Delete \(inside) \(inside == 1 ? "save" : "saves")")
                    }
                    .disabled(inside == 0)
                    .keyboardShortcut(.delete, modifiers: [])
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(KSMotion.settle, value: selecting)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.aiReady && !lifestyle.isEmpty && !selecting {
                ToolbarItem(placement: .primaryAction) { FixWithAIButton(saves: lifestyle, what: "all \(lifestyle.count) Lifestyle saves") }
            }
            if !lifestyle.isEmpty {
                ToolbarItem(placement: .primaryAction) { SelectButton(selecting: $selecting, selected: $selected) }
            }
        }
        .onChange(of: lifestyle.isEmpty) { _, empty in if empty { selecting = false } }
    }
}

/// The grid both pages and the Library use: two stacks across on iPhone, more on iPad.
let groupColumns = [GridItem(.adaptive(minimum: 150), spacing: 16)]

/// Each Lifestyle view with saves, as a stack linking to its view: most saves first (a tie A–Z), until
/// you drag them into your own order (kept on this iPhone). "Sort by most saves" goes back.
struct LifestyleTiles: View {
    /// Select mode: a tap ticks a view instead of opening it.
    var selection: Binding<Set<String>>?
    /// Long press → Select (only where the screen has Select mode).
    var onSelect: ((String) -> Void)?
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
                    let tile = GroupTile(k.plural, subtitle: items.isEmpty ? "Empty" : (items.count == 1 ? "1 save" : "\(items.count) saves"),
                                         cover: items.first(where: \.hasImage) ?? items.first, symbol: k.symbol, tint: k.color, kind: kind)
                    if let selection {
                        let on = selection.wrappedValue.contains(kind)
                        Button {
                            Haptic.checked()
                            if on { selection.wrappedValue.remove(kind) } else { selection.wrappedValue.insert(kind) }
                        } label: { tile.selectionCheck(on) }
                        .buttonStyle(PressStyle())
                        .accessibilityLabel(k.plural)
                    } else {
                        NavigationLink(value: Route.kind(kind)) { tile }
                        .buttonStyle(PressStyle())
                        .reorderable(kind, in: $order, dragging: $dragging, reduce: reduce) { SavedOrder.set(Self.key, $0); manual = true }
                        .contextMenu {
                            if let onSelect { Button("Select", systemImage: "checkmark.circle") { Haptic.detent(); onSelect(kind) } }
                            Button("Delete all \(items.count) \(k.plural.lowercased())", systemImage: "trash", role: .destructive) {
                                Task { await model.trashKinds([kind]) }
                            }
                        }
                    }
                }
            }
            if manual && selection == nil {
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
    /// Select mode: a tap ticks a collection instead of opening it.
    var selection: Binding<Set<String>>?
    /// Long press → Select (only where the screen has Select mode).
    var onSelect: ((String) -> Void)?
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
                    let tile = GroupTile(c.name, subtitle: items.isEmpty ? "Empty" : (items.count == 1 ? "1 save" : "\(items.count) saves"),
                                         cover: items.first(where: \.hasImage) ?? items.first, symbol: c.pinned == true ? "pin" : "bag", tint: KindStyle("product").color)
                    if let selection {
                        let on = selection.wrappedValue.contains(c.id)
                        Button {
                            Haptic.checked()
                            if on { selection.wrappedValue.remove(c.id) } else { selection.wrappedValue.insert(c.id) }
                        } label: { tile.selectionCheck(on) }
                        .buttonStyle(PressStyle())
                        .accessibilityLabel("Collection \(c.name)")
                    } else {
                        NavigationLink(value: Route.collection(c.id, c.name)) { tile }
                        .buttonStyle(PressStyle())
                        .reorderable(c.id, in: $order, dragging: $dragging, reduce: reduce) { ids in
                            SavedOrder.set(Self.key, ["on"])
                            manual = true
                            Task { try? await model.library?.reorderCollections(ids) }
                        }
                        .contextMenu { CollectionMenu(collection: c, saves: items.count, onSelect: onSelect.map { f in { f(c.id) } }) }
                    }
                }
                if let onNew, selection == nil {
                    Button(action: onNew) { NewGroupTile("New collection") }
                        .buttonStyle(PressStyle())
                }
            }
            if manual && collections.count > 1 && selection == nil {
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

/// What a long press on a collection offers: pin it, select it, or delete it (its saves wait in Review,
/// or go with it). Undo brings it back either way.
struct CollectionMenu: View {
    let collection: SaveCollection
    let saves: Int
    var onSelect: (() -> Void)?
    @Environment(LibraryModel.self) private var model

    var body: some View {
        Button(collection.pinned == true ? "Unpin" : "Pin to the top", systemImage: collection.pinned == true ? "pin.slash" : "pin") {
            Task {
                try? await model.library?.updateCollection(collection.id, ["pinned": collection.pinned != true])
                Haptic.settled()
                model.refresh()
                model.collectionsChanged += 1
            }
        }
        if let onSelect {
            Button("Select", systemImage: "checkmark.circle") { Haptic.detent(); onSelect() }
        }
        Divider()
        if saves == 0 {
            Button("Delete collection", systemImage: "trash", role: .destructive) { Task { await model.deleteCollections([collection]) } }
        } else {
            Button("Delete collection, keep its saves", systemImage: "folder.badge.minus", role: .destructive) {
                Task { await model.deleteCollections([collection]) }
            }
            Button("Delete it and its \(saves) \(saves == 1 ? "save" : "saves")", systemImage: "trash", role: .destructive) {
                Task { await model.deleteCollections([collection], deleteSaves: true) }
            }
        }
    }
}
