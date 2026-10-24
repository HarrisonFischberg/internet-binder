import SwiftUI
import KeepsakeKit
import KeepsakeUI

// Select mode, the long-press menus and swipe to delete, shared by every screen that lists saves or
// groups of them (Chrome's Select and right-click menu). Deleting is always undoable from the toast, so
// nothing asks "Are you sure?".

/// "Select", then "Done": beside Fix with AI in a screen's toolbar.
struct SelectButton: View {
    @Binding var selecting: Bool
    @Binding var selected: Set<String>

    var body: some View {
        Button(selecting ? "Done" : "Select") {
            Haptic.detent()
            selecting.toggle()
            selected = []
        }
        .fontWeight(selecting ? .semibold : .regular)
        .accessibilityHint(selecting ? "Leaves Select mode." : "Tick several to move or delete them at once.")
    }
}

/// The same button for a screen that draws its own header (Places), in the style's capsule.
struct HeaderSelectButton: View {
    @Binding var selecting: Bool
    @Binding var selected: Set<String>
    @Environment(\.ks) private var t

    var body: some View {
        Button {
            Haptic.detent()
            selecting.toggle()
            selected = []
        } label: {
            Text(selecting ? "Done" : "Select").font(.subheadline.weight(.semibold))
                .foregroundStyle(selecting ? t.onPrimary : t.ink)
                .padding(.horizontal, 16).frame(minHeight: 44)
                .background(selecting ? t.primary : t.paper, in: Capsule())
                .overlay(Capsule().strokeBorder(t.style == .pantry ? t.line : t.rule, lineWidth: t.style == .pantry ? 2 : 1))
        }
        .buttonStyle(PressStyle())
        .accessibilityHint(selecting ? "Leaves Select mode." : "Tick several to move or delete them at once.")
    }
}

extension View {
    /// A tick in the corner while selecting: filled when chosen.
    func selectionCheck(_ on: Bool, alignment: Alignment = .topTrailing) -> some View {
        modifier(SelectionCheck(on: on, alignment: alignment))
    }

    /// Swipe a row left to reveal Delete; swipe all the way to delete it at once.
    func swipeToDelete(_ label: String = "Move to Trash", action: @escaping () -> Void) -> some View {
        modifier(SwipeToDelete(label: label, action: action))
    }
}

struct SelectionCheck: ViewModifier {
    let on: Bool
    let alignment: Alignment
    @Environment(\.ks) private var t

    func body(content: Content) -> some View {
        content
            .opacity(on ? 1 : 0.85)
            .overlay(alignment: alignment) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.title2).foregroundStyle(on ? t.accent : t.inkMuted)
                    .background(Circle().fill(t.paper)).padding(8)
                    .accessibilityHidden(true)
            }
            .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The bar at the bottom in Select mode: how many are ticked, Select all, then the screen's actions.
struct SelectionBar<Actions: View>: View {
    let noun: (Int) -> String
    let all: [String]
    @Binding var selected: Set<String>
    @ViewBuilder let actions: Actions
    @Environment(\.ks) private var t

    private var allOn: Bool { !all.isEmpty && all.allSatisfy(selected.contains) }

    var body: some View {
        VStack(spacing: 8) {
            HStack {
                Text(selected.isEmpty ? "Tap to select" : "\(selected.count) \(noun(selected.count)) selected")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(t.ink).monospacedDigit()
                    .accessibilityAddTraits(.updatesFrequently)
                Spacer()
                Button(allOn ? "Select none" : "Select all") {
                    Haptic.checked()
                    selected = allOn ? [] : Set(all)
                }
                .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                .keyboardShortcut("a", modifiers: .command)
            }
            HStack(spacing: 10) { actions }
        }
        // On iPad the actions keep a phone-like width instead of stretching across the detail pane.
        .frame(maxWidth: 600)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 6)
        .background(TablePatch().ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) { Rectangle().fill(t.rule).frame(height: 1) }
    }
}

/// The filled action in a selection bar ("Move to…"). Fades while nothing is ticked: its own colours
/// would otherwise hide that it's disabled.
struct BarLabel: View {
    let title: String
    let symbol: String
    @Environment(\.ks) private var t
    @Environment(\.isEnabled) private var enabled
    var body: some View {
        Label(title, systemImage: symbol).font(.headline).foregroundStyle(t.onPrimary)
            .frame(maxWidth: .infinity, minHeight: 54).background(t.primary, in: ControlShapeView.shape(t))
            .opacity(enabled ? 1 : 0.4)
    }
}

/// The round Delete action in a selection bar.
struct BarTrashLabel: View {
    var title: String?
    @Environment(\.ks) private var t
    @Environment(\.isEnabled) private var enabled
    var body: some View {
        Group {
            if let title {
                Label(title, systemImage: "trash").font(.headline).foregroundStyle(t.stamp)
                    .frame(maxWidth: .infinity, minHeight: 54).ksSurface(radius: 27, scale: 0.75)
            } else {
                Image(systemName: "trash").font(.headline).foregroundStyle(t.stamp)
                    .frame(width: 54, height: 54).ksSurface(radius: 27, scale: 0.75)
            }
        }
        .opacity(enabled ? 1 : 0.4)
    }
}

/// Select mode for saves: Move to… and Move to Trash, each for every ticked save at once.
struct SaveSelectionBar: View {
    let all: [String]
    @Binding var selected: Set<String>
    @Binding var selecting: Bool
    @Environment(LibraryModel.self) private var model

    var body: some View {
        SelectionBar(noun: { $0 == 1 ? "save" : "saves" }, all: all, selected: $selected) {
            Menu {
                Button("New collection…", systemImage: "plus") {
                    model.newCollectionFor = Array(selected)
                    selected = []
                    selecting = false
                }
                ForEach(model.destinations) { d in
                    Button(d.label) { finish { await model.put(Array(selected), in: d) } }
                }
            } label: {
                BarLabel(title: "Move to…", symbol: "folder")
            }
            .disabled(selected.isEmpty)
            Button {
                finish { await model.trash(ids: Array(selected)) }
            } label: {
                BarTrashLabel()
            }
            .disabled(selected.isEmpty)
            .keyboardShortcut(.delete, modifiers: [])
            .accessibilityLabel("Move \(selected.count) to Trash")
        }
    }

    private func finish(_ work: @escaping @MainActor () async -> Void) {
        Task {
            await work()
            selected = []
            selecting = false
        }
    }
}

/// What a long press on a save offers: the card's own actions without opening it.
struct SaveMenu: View {
    let save: Save
    var onSelect: (() -> Void)?
    @Environment(LibraryModel.self) private var model

    var body: some View {
        let verb = KindStyle(save.kind).doneVerb
        Button(save.status == "done" ? "Mark not \(verb.lowercased())" : "Mark \(verb.lowercased())", systemImage: save.status == "done" ? "arrow.uturn.backward" : "checkmark.seal") {
            Task { await model.setDone(save, save.status != "done") }
        }
        Button(save.favorite == true ? "Remove favorite" : "Favorite", systemImage: save.favorite == true ? "star.slash" : "star") {
            Task {
                try? await model.library?.update(save.id, ["favorite": save.favorite != true])
                Haptic.settled()
                model.refresh()
            }
        }
        if !model.destinations.isEmpty {
            Menu("Move to…", systemImage: "folder") {
                Button("New collection…", systemImage: "plus") { model.newCollectionFor = [save.id] }
                ForEach(model.destinations.filter { $0.value != save.collectionId && $0.value != "kind:\(save.kind)" }) { d in
                    Button(d.label) { Task { await model.put([save.id], in: d) } }
                }
            }
        }
        if let link = save.url, let url = URL(string: link), url.scheme?.hasPrefix("http") == true {
            ShareLink(item: url, subject: Text(save.title)) { Label("Share…", systemImage: "square.and.arrow.up") }
            Button("Copy link", systemImage: "link") {
                UIPasteboard.general.url = url
                Haptic.settled()
                model.show("Link copied")
            }
        }
        if model.aiReady {
            Button("Fix with AI", systemImage: "sparkles") { Task { await model.fixWithAI([save]) } }
                .disabled(model.aiRun != nil)
        }
        if let onSelect {
            Button("Select", systemImage: "checkmark.circle") { onSelect() }
        }
        Divider()
        Button("Move to Trash", systemImage: "trash", role: .destructive) { Task { await model.trash(save) } }
    }
}

/// Swipe left on a row: Delete shows behind it; a long swipe deletes straight away. Only a mostly
/// sideways drag counts, so scrolling the list never trips it. VoiceOver has the same action by name.
struct SwipeToDelete: ViewModifier {
    let label: String
    let action: () -> Void
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var offset: CGFloat = 0
    @State private var width: CGFloat = 320
    @State private var sideways: Bool?
    /// While a sideways swipe is on, the row's own tap is off: letting go over the row must not open it.
    @State private var swiping = false
    private let reveal: CGFloat = 92

    func body(content: Content) -> some View {
        ZStack(alignment: .trailing) {
            if offset < 0 {
                Button {
                    trash()
                } label: {
                    // Icon and word, like the system's swipe actions.
                    VStack(spacing: 4) {
                        Image(systemName: "trash").font(.title3.weight(.semibold))
                        Text("Delete").font(.caption.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.7)
                    }
                    // Paper on the stamp colour: white fails on dark mode's light coral.
                    .foregroundStyle(t.paper)
                    .frame(width: max(reveal, -offset), alignment: .center).frame(maxHeight: .infinity)
                    .background(t.stamp, in: RoundedRectangle(cornerRadius: min(t.radius, 14), style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(label)
            }
            content.offset(x: offset).disabled(swiping)
                // With Delete showing, a tap on the row closes it (the system's swipe actions do the same).
                .overlay {
                    if offset < 0 && !swiping {
                        Color.clear.contentShape(Rectangle()).offset(x: offset).onTapGesture { settle(0) }
                            .accessibilityHidden(true)
                    }
                }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .simultaneousGesture(
            DragGesture(minimumDistance: 16)
                .onChanged { v in
                    if sideways == nil { sideways = abs(v.translation.width) > abs(v.translation.height) * 1.4 }
                    guard sideways == true else { return }
                    swiping = true
                    let start: CGFloat = offset <= -reveal + 1 && v.translation.width > 0 ? -reveal : 0
                    offset = min(0, start + v.translation.width)
                }
                .onEnded { v in
                    defer {
                        sideways = nil
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { swiping = false }
                    }
                    guard sideways == true else { return }
                    // Capped, so a full swipe on a wide iPad row is no longer than on a phone.
                    if -offset > min(width * 0.55, 240) || v.predictedEndTranslation.width < -min(width * 0.8, 360) { trash() }
                    else { settle(-offset > reveal * 0.6 ? -reveal : 0) }
                }
        )
        .accessibilityAction(named: label) { action() }
    }

    private func settle(_ to: CGFloat) {
        withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { offset = to }
    }

    private func trash() {
        withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { offset = -width }
        action()
        // The row goes; if Undo brings it back, it comes back closed.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { offset = 0 }
    }
}

extension LibraryModel {
    /// Moves saves to the Trash, with one Undo for all of them.
    func trash(ids: [String]) async {
        guard let library, !ids.isEmpty else { return }
        try? await library.trash(ids)
        Haptic.trashed()
        refresh()
        show(ids.count == 1 ? "Moved to Trash" : "Moved \(ids.count) saves to Trash") { [weak self] in
            try? await library.restore(ids)
            self?.refresh()
        }
    }

    /// Puts saves in a collection or Lifestyle view (Chrome's Move to…).
    func put(_ ids: [String], in d: Destination) async {
        guard let library, !ids.isEmpty else { return }
        let name = (try? await library.put(ids, in: d.value)) ?? d.label
        Haptic.dropped()
        refresh()
        show(ids.count == 1 ? "Moved to \(name)" : "Moved \(ids.count) saves to \(name)")
    }

    /// Deletes collections. Their saves wait in Review, or go to the Trash with them; Undo puts the
    /// collections back with every save filed in them again.
    func deleteCollections(_ cols: [SaveCollection], deleteSaves: Bool = false) async {
        guard let library, !cols.isEmpty else { return }
        let ids = Set(cols.map(\.id))
        let inside = saves.filter { ids.contains($0.collectionId ?? "") }.count
        guard let undo = try? await library.deleteCollections(Array(ids), deleteSaves: deleteSaves) else { return }
        Haptic.trashed()
        refresh()
        collectionsChanged += 1
        let what = cols.count == 1 ? "Deleted “\(cols[0].name)”" : "Deleted \(cols.count) collections"
        let after = inside == 0 ? "" : deleteSaves ? " and \(inside) \(inside == 1 ? "save" : "saves")" : ". \(inside) \(inside == 1 ? "save waits" : "saves wait") in Review"
        show(what + after) { [weak self] in
            try? await library.restoreCollections(undo)
            self?.refresh()
            self?.collectionsChanged += 1
        }
    }

    /// Every save in these Lifestyle views, to the Trash, with one Undo.
    func trashKinds(_ kinds: Set<String>) async {
        await trash(ids: saves.filter { kinds.contains($0.kind) }.map(\.id))
    }

    /// "New collection…" named: makes it and moves the saves there. One save from Review is filed (it learns).
    func putInNew(_ ids: [String], named name: String) async {
        let name = name.trimmingCharacters(in: .whitespaces)
        guard let library, !ids.isEmpty, !name.isEmpty else { return }
        guard let c = try? await library.createCollection(named: name) else { Haptic.refused(); return }
        await loadDestinations()
        collectionsChanged += 1
        if ids.count == 1, let s = saves.first(where: { $0.id == ids[0] }), s.needsCollection { file(s, into: c.id, label: c.name); return }
        if let d = destinations.first(where: { $0.value == c.id }) { await put(ids, in: d) }
    }

    /// Where Move to… can send a save; read again after collections change.
    func loadDestinations() async {
        guard let library else { return }
        if let list = try? await library.destinations() { destinations = list }
    }
}

/// The name prompt for "New collection…" in any Move to menu (`LibraryModel.newCollectionFor`).
struct NewCollectionPrompt: ViewModifier {
    @Environment(LibraryModel.self) private var model
    @State private var name = ""

    func body(content: Content) -> some View {
        // Only Cancel and Create close it, and each clears the request itself.
        content.alert("New collection", isPresented: Binding(get: { model.newCollectionFor != nil }, set: { _ in })) {
            TextField("Name", text: $name)
            Button("Cancel", role: .cancel) { model.newCollectionFor = nil; name = "" }
            Button("Create") {
                let ids = model.newCollectionFor ?? [], named = name
                model.newCollectionFor = nil
                name = ""
                Task { await model.putInNew(ids, named: named) }
            }
            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        } message: {
            let n = model.newCollectionFor?.count ?? 0
            Text(n == 1 ? "The save goes straight in." : "\(n) saves go straight in.")
        }
    }
}
