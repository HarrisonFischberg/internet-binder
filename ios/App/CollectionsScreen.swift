import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Collections are for shopping: products sorted into collections, with Purchased. Select mode ticks
/// collections to delete several at once (with Undo).
struct CollectionsScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @State private var collections: [SaveCollection] = []
    @State private var naming = false
    @State private var newName = ""
    @State private var selecting = false
    @State private var selected: Set<String> = []
    private var collected: [Save] { model.saves.filter { !($0.collectionId ?? "").isEmpty } }

    var body: some View {
        ZStack(alignment: .bottom) {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ScreenHeader(title: "Collections", subtitle: "For things to buy")
                    CollectionTiles(collections: collections, onNew: { naming = true }, selection: selecting ? $selected : nil) { id in
                        selected = [id]
                        selecting = true
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, selecting ? 140 : 40)
            }
            if selecting { selectionBar.transition(.move(edge: .bottom).combined(with: .opacity)) }
        }
        .animation(KSMotion.settle, value: selecting)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !selecting {
                ToolbarItem(placement: .primaryAction) { Button("New collection", systemImage: "plus") { naming = true } }
            }
            if model.aiReady && !collected.isEmpty && !selecting {
                ToolbarItem(placement: .primaryAction) { FixWithAIButton(saves: collected, what: "all \(collected.count) saves in Collections") }
            }
            if !collections.isEmpty {
                ToolbarItem(placement: .primaryAction) { SelectButton(selecting: $selecting, selected: $selected) }
            }
        }
        .alert("New collection", isPresented: $naming) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) { newName = "" }
            Button("Create") { Task { _ = try? await model.library?.createCollection(named: newName); newName = ""; await load() } }
        }
        .task(id: "\(model.saves.count)|\(model.collectionsChanged)") { await load() }
    }

    /// Delete the ticked collections. With saves inside, it asks whether they wait in Review or go too.
    private var selectionBar: some View {
        let chosen = collections.filter { selected.contains($0.id) }
        let inside = model.saves.filter { selected.contains($0.collectionId ?? "") }.count
        return SelectionBar(noun: { $0 == 1 ? "collection" : "collections" }, all: collections.map(\.id), selected: $selected) {
            if inside == 0 {
                Button { delete(chosen, saves: false) } label: { BarTrashLabel(title: "Delete") }
                    .disabled(chosen.isEmpty)
                    .keyboardShortcut(.delete, modifiers: [])
            } else {
                Menu {
                    Button("Delete, keep the \(inside) \(inside == 1 ? "save" : "saves")", systemImage: "folder.badge.minus") { delete(chosen, saves: false) }
                    Button("Delete them and their \(inside) \(inside == 1 ? "save" : "saves")", systemImage: "trash", role: .destructive) { delete(chosen, saves: true) }
                } label: {
                    BarTrashLabel(title: "Delete \(chosen.count)")
                }
                .disabled(chosen.isEmpty)
            }
        }
    }

    private func delete(_ chosen: [SaveCollection], saves: Bool) {
        Task {
            await model.deleteCollections(chosen, deleteSaves: saves)
            selected = []
            selecting = false
            await load()
        }
    }

    private func load() async { collections = (try? model.library?.collections()) ?? [] }
}

/// One collection: what's still to buy, then Purchased.
struct CollectionScreen: View {
    let id: String
    let name: String
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var selecting = false
    @State private var selected: Set<String> = []
    private var saves: [Save] { model.saves.filter { $0.collectionId == id } }

    var body: some View {
        let toBuy = saves.filter { $0.purchased != true }
        let bought = saves.filter { $0.purchased == true }
        ZStack(alignment: .bottom) {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ScreenHeader(title: name, subtitle: saves.count == 1 ? "1 save" : "\(saves.count) saves")
                    if saves.isEmpty { EmptyNote(symbol: "bag", text: "Nothing here yet. Move a save here from Review or its own screen.") }
                    SaveGrid(saves: toBuy, zoom: zoom, selecting: selecting, selected: $selected, onSelect: startSelecting)
                    if !bought.isEmpty {
                        Text("Purchased").font(KSFont.name(.title2)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                        SaveGrid(saves: bought, zoom: zoom, selecting: selecting, selected: $selected, onSelect: startSelecting)
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, selecting ? 140 : 40)
            }
            if selecting {
                SaveSelectionBar(all: (toBuy + bought).map(\.id), selected: $selected, selecting: $selecting)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(KSMotion.settle, value: selecting)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !selecting {
                ToolbarItem(placement: .primaryAction) { Button("Edit") { editing = true } }
            }
            if model.aiReady && !saves.isEmpty && !selecting {
                ToolbarItem(placement: .primaryAction) { FixWithAIButton(saves: saves, what: "all \(saves.count) in \(name)") }
            }
            if !saves.isEmpty {
                ToolbarItem(placement: .primaryAction) { SelectButton(selecting: $selecting, selected: $selected) }
            }
        }
        .onChange(of: saves.isEmpty) { _, empty in if empty { selecting = false } }
        .sheet(isPresented: $editing) {
            if let c = try? model.library?.collections().first(where: { $0.id == id }) {
                CollectionEditor(collection: c) { deleted in if deleted { dismiss() } }
            }
        }
    }

    private func startSelecting(_ id: String) {
        Haptic.detent()
        selected = [id]
        selecting = true
    }
}

/// A collection's name, the words that file saves into it, and whether it's pinned. Deleting it
/// sends its saves back to Review (nothing is lost).
struct CollectionEditor: View {
    let collection: SaveCollection
    let done: (Bool) -> Void
    @Environment(LibraryModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var keywords = ""
    @State private var pinned = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") { TextField("Name", text: $name) }
                Section {
                    TextField("e.g. dutch oven, skillet, knife", text: $keywords, axis: .vertical)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: { Text("Keywords") } footer: { Text("Saves with these words in them are filed here. Separate them with commas.") }
                Section { Toggle("Pinned", isOn: $pinned) }
                Section {
                    Button("Delete collection", role: .destructive) { delete() }
                } footer: { Text("Its saves go back to Review. You can undo it.") }
            }
            .navigationTitle("Edit collection").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            let words = keywords.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                            try? await model.library?.updateCollection(collection.id, ["name": name, "keywords": words, "pinned": pinned])
                            model.refresh()
                            Haptic.settled()
                            dismiss()
                            done(false)
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                name = collection.name
                keywords = (collection.keywords ?? []).joined(separator: ", ")
                pinned = collection.pinned ?? false
            }
        }
    }

    /// No "Are you sure?": the toast's Undo brings it back with its saves filed in it.
    private func delete() {
        Task {
            await model.deleteCollections([collection])
            dismiss()
            done(true)
        }
    }
}
