import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Collections are for shopping: products sorted into collections, with Purchased.
struct CollectionsScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @State private var collections: [SaveCollection] = []
    @State private var naming = false
    @State private var newName = ""

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ScreenHeader(title: "Collections", subtitle: "For things to buy")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                        ForEach(collections) { c in
                            let items = model.saves.filter { $0.collectionId == c.id }
                            NavigationLink(value: Route.collection(c.id, c.name)) {
                                VStack(alignment: .leading, spacing: 8) {
                                    ZStack {
                                        t.well
                                        if let cover = items.first(where: \.hasImage) { SaveImage(cover) }
                                        else { Image(systemName: "bag").font(.title).foregroundStyle(KindStyle("product").color) }
                                    }
                                    .frame(height: 110).clipped()
                                    Text(c.name).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(2)
                                    Text(items.count == 1 ? "1 save" : "\(items.count) saves").font(.footnote).foregroundStyle(t.inkMuted)
                                }
                                .padding(8).background(t.paper).resting()
                            }
                            .buttonStyle(PressStyle())
                            .accessibilityLabel("\(c.name), \(items.count) saves")
                        }
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, 40)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .primaryAction) { Button("New collection", systemImage: "plus") { naming = true } } }
        .alert("New collection", isPresented: $naming) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) { newName = "" }
            Button("Create") { Task { _ = try? await model.library?.createCollection(named: newName); newName = ""; await load() } }
        }
        .task(id: model.saves.count) { await load() }
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
    private var saves: [Save] { model.saves.filter { $0.collectionId == id } }

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ScreenHeader(title: name, subtitle: saves.count == 1 ? "1 save" : "\(saves.count) saves")
                    if saves.isEmpty { EmptyNote(symbol: "bag", text: "Nothing here yet. Move a save here from Review or its own screen.") }
                    SaveGrid(saves: saves.filter { $0.purchased != true }, zoom: zoom)
                    let bought = saves.filter { $0.purchased == true }
                    if !bought.isEmpty {
                        Text("Purchased").font(KSFont.name(.title2)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                        SaveGrid(saves: bought, zoom: zoom)
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, 40)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}
