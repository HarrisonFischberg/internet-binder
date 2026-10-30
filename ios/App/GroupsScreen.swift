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
    private var lifestyle: [Save] { model.index.lifestyle }

    var body: some View {
        ZStack(alignment: .bottom) {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ScreenHeader(title: "Lifestyle", subtitle: "Places, recipes, workouts and more")
                    if !model.index.lifestyle.isEmpty {
                        LifestyleTiles(selection: selecting ? $selected : nil) { kind in
                            selected = [kind]
                            selecting = true
                        }
                    } else {
                        EmptyNote(symbol: "sparkles", text: "Nothing here yet. Share a recipe, a place or a workout to Internet Binder and it lands here.")
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

/// How the Collections and Lifestyle stacks are ordered (Chrome's Collections sort, same names).
/// Dragging a stack puts them in your own order instead, until you pick a sort again.
enum GroupSort: String, CaseIterable, Identifiable {
    case size, recent, name
    var id: String { rawValue }
    var label: String {
        switch self {
        case .size: "Most saves"
        case .recent: "Recently saved to"
        case .name: "A–Z"
        }
    }

    /// These groups in this order. `saves` gives a group's saves, `name` its name.
    func apply<T>(_ groups: [T], saves: (T) -> [Save], name: (T) -> String) -> [T] {
        switch self {
        case .size: return groups.mostFirst(count: { saves($0).count }, name: name)
        case .name: return groups.sorted { name($0).localizedStandardCompare(name($1)) == .orderedAscending }
        case .recent:
            let latest = groups.map { g in (g, saves(g).compactMap(\.createdAt).max() ?? "") }
            return latest.sorted { $0.1 != $1.1 ? $0.1 > $1.1 : name($0.0).localizedStandardCompare(name($1.0)) == .orderedAscending }.map(\.0)
        }
    }
}

/// The Sort menu over a row of stacks: a tick beside the sort in use, or "Your order" after a drag.
struct GroupSortMenu: View {
    let sort: GroupSort
    let manual: Bool
    let pick: (GroupSort) -> Void
    @Environment(\.ks) private var t

    var body: some View {
        Menu {
            ForEach(GroupSort.allCases) { s in
                Button { Haptic.detent(); pick(s) } label: {
                    if s == sort && !manual { Label(s.label, systemImage: "checkmark") } else { Text(s.label) }
                }
            }
        } label: {
            Label("Sort: \(manual ? "Your order" : sort.label)", systemImage: "arrow.up.arrow.down")
                .font(.footnote.weight(.semibold)).foregroundStyle(t.inkMuted)
                .frame(minHeight: 44)
        }
        .accessibilityLabel("Sort")
        .accessibilityValue(manual ? "Your order" : sort.label)
        .accessibilityIdentifier("groupSortMenu")
    }
}

/// Each Lifestyle view with saves, as a stack linking to its view: most saves first (a tie A–Z), or the
/// sort you pick, until you drag them into your own order (kept on this iPhone).
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
    @AppStorage("lifestyleSort") private var sort = GroupSort.size
    static let key = "lifestyleOrder"

    private var present: [String] {
        let index = model.index
        return sort.apply(KindStyle.lifestyle.filter { index.byKind[$0] != nil }, saves: { index.kind($0) }, name: { KindStyle($0).plural })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if order.count > 1 && selection == nil {
                GroupSortMenu(sort: sort, manual: manual) { picked in
                    SavedOrder.set(Self.key, [])
                    manual = false
                    sort = picked
                    withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { order = present }
                }
            }
            LazyVGrid(columns: groupColumns, spacing: 20) {
                ForEach(Array(order.enumerated()), id: \.element) { i, kind in
                    let items = model.index.kind(kind)
                    let k = KindStyle(kind)
                    let tile = GroupTile(k.plural, subtitle: items.isEmpty ? "Empty" : (items.count == 1 ? "1 save" : "\(items.count) saves"),
                                         cover: items.first(where: \.hasImage) ?? items.first, symbol: k.symbol, tint: k.color, kind: kind, number: i + 1)
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
        }
        .onChange(of: present, initial: true) { _, kinds in order = manual ? kinds.arranged(by: SavedOrder.get(Self.key)) { $0 } : kinds }
    }
}

/// Each collection as a stack with one of its pictures on top, linking to the collection. Pinned
/// collections come first, then the rest with the most saves first (a tie A–Z) or the sort you pick.
/// Drag them and your order is kept instead (Chrome's order, which dragging here changes), until you
/// pick a sort again.
struct CollectionTiles: View {
    let collections: [SaveCollection]
    var onNew: (() -> Void)?
    /// Select mode: a tap ticks a collection instead of opening it.
    var selection: Binding<Set<String>>?
    /// Long press → Select (only where the screen has Select mode).
    var onSelect: ((String) -> Void)?
    @Environment(LibraryModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduce
    @Environment(\.ks) private var t
    @State private var order: [String] = []
    @State private var dragging: String?
    @State private var manual = !SavedOrder.get(Self.key).isEmpty
    @AppStorage("collectionSort") private var sort = GroupSort.size
    /// Set once you drag a collection: Internet Binder stops sorting them on this iPhone.
    static let key = "collectionOrderManual"

    private var counts: [String: Int] { model.index.byCollection.mapValues(\.count) }

    /// Pinned first, then in the chosen sort; once you've dragged, the stored order as it is.
    private func arranged(manual: Bool) -> [String] {
        guard !manual else { return collections.map(\.id) }
        let index = model.index
        let pinned = collections.filter { $0.pinned == true }
        let rest = sort.apply(collections.filter { $0.pinned != true }, saves: { index.collection($0.id) }, name: \.name)
        return (pinned + rest).map(\.id)
    }

    /// What the order depends on (not whether you've dragged: the drag itself sets the order).
    private var signature: [String] {
        let counts = counts
        return collections.map { "\($0.id)|\($0.pinned == true)|\(counts[$0.id] ?? 0)" }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if collections.count > 1 && selection == nil {
                GroupSortMenu(sort: sort, manual: manual) { picked in
                    SavedOrder.set(Self.key, [])
                    manual = false
                    sort = picked
                    withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { order = arranged(manual: false) }
                }
            }
            LazyVGrid(columns: groupColumns, spacing: 20) {
                ForEach(Array(order.compactMap { id in collections.first { $0.id == id } }.enumerated()), id: \.element.id) { i, c in
                    let items = model.index.collection(c.id)
                    let tile = GroupTile(c.name, subtitle: items.isEmpty ? "Empty" : (items.count == 1 ? "1 save" : "\(items.count) saves"),
                                         cover: items.first(where: \.hasImage) ?? items.first, symbol: c.pinned == true ? "pin" : "bag", tint: t.detail,
                                         number: i + 1, menuRoom: selection == nil)
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
                        // The same menu, one tap away, for anyone who doesn't know about the long press.
                        .overlay(alignment: .bottomTrailing) {
                            Menu { CollectionMenu(collection: c, saves: items.count, onSelect: onSelect.map { f in { f(c.id) } }) } label: {
                                GlassIcon("ellipsis", size: 36, font: .footnote.weight(.bold)).frame(width: 44, height: 44)
                            }
                            .accessibilityLabel("More for \(c.name)")
                            .padding(t.style == .chromatic ? 6 : 4)
                        }
                    }
                }
                if let onNew, selection == nil {
                    Button(action: onNew) { NewGroupTile("New collection") }
                        .buttonStyle(PressStyle())
                }
            }
        }
        .onChange(of: signature, initial: true) { order = arranged(manual: manual) }
    }
}

/// A section of the Library: its name, how many it holds, and its stacks.
struct GroupSection<Content: View>: View {
    let title: String
    let detail: String
    @ViewBuilder let content: Content
    @Environment(\.ks) private var t
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            // At accessibility sizes the count goes under the title, so the title never breaks mid-word.
            (typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(alignment: .firstTextBaseline))) {
                Text(title).font(KSFont.section()).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                if !typeSize.isAccessibilitySize { Spacer() }
                Text(detail).font(.footnote).foregroundStyle(t.inkMuted).monospacedDigit()
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
