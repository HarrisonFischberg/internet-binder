import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// iPad (and wide windows): a sidebar with every section, like Chrome's dashboard. Drag a save onto a
/// collection or a Lifestyle view in the sidebar to put it there. ⌘F searches, ⌘, opens Settings.
struct SplitRootView: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @State private var section: Section? = .home
    @State private var collections: [SaveCollection] = []
    @State private var settings = false
    @State private var appearance = false
    @State private var dropTarget: String?

    enum Section: Hashable { case home, library, search, review, places, kind(String), collections, collection(String, String) }

    var body: some View {
        NavigationSplitView {
            List(selection: $section) {
                SwiftUI.Section {
                    Label("Home", systemImage: "house").tag(Section.home)
                    Label("Library", systemImage: "books.vertical").tag(Section.library)
                    if model.reviewCount > 0 {
                        Label("Review", systemImage: "tray").badge(model.reviewCount).tag(Section.review)
                    }
                    Label("Search", systemImage: "magnifyingglass").tag(Section.search)
                    Label("Places", systemImage: "map").tag(Section.places)
                        .dropDestination(for: String.self) { ids, _ in put(ids, "kind:place", "Places") } isTargeted: { dropTarget = $0 ? "kind:place" : nil }
                }
                SwiftUI.Section("Lifestyle") {
                    ForEach(KindStyle.lifestyle.filter { k in k != "place" && model.saves.contains { $0.kind == k } }, id: \.self) { k in
                        let s = KindStyle(k)
                        Label(s.plural, systemImage: s.symbol).tag(Section.kind(k))
                            .listRowBackground(dropTarget == "kind:\(k)" ? t.accent.opacity(0.15) : nil)
                            .dropDestination(for: String.self) { ids, _ in put(ids, "kind:\(k)", s.plural) } isTargeted: { dropTarget = $0 ? "kind:\(k)" : nil }
                    }
                }
                SwiftUI.Section("Collections") {
                    ForEach(collections) { c in
                        Label(c.name, systemImage: "bag").tag(Section.collection(c.id, c.name))
                            .listRowBackground(dropTarget == c.id ? t.accent.opacity(0.15) : nil)
                            .dropDestination(for: String.self) { ids, _ in put(ids, c.id, c.name) } isTargeted: { dropTarget = $0 ? c.id : nil }
                    }
                    Label("All collections", systemImage: "square.grid.2x2").tag(Section.collections)
                }
            }
            .navigationTitle("Keepsake")
            .toolbar {
                ToolbarItem { Button("Appearance", systemImage: "paintpalette") { appearance = true } }
                ToolbarItem { Button("Settings", systemImage: "gearshape") { settings = true }.keyboardShortcut(",", modifiers: .command) }
            }
        } detail: {
            Stack(name: "split-\(String(describing: section))") { zoom in
                switch section ?? .home {
                case .home: HomeScreen(zoom: zoom)
                case .library: LibraryScreen(zoom: zoom)
                case .search: SearchScreen(zoom: zoom)
                case .review: ReviewScreen(zoom: zoom)
                case .places: PlacesScreen(zoom: zoom)
                case .kind(let k): KindScreen(kind: k, zoom: zoom)
                case .collections: CollectionsScreen(zoom: zoom)
                case .collection(let id, let name): CollectionScreen(id: id, name: name, zoom: zoom)
                }
            }
            .id(section)
        }
        .tint(t.accent)
        .sheet(isPresented: $settings) { SettingsScreen() }
        .sheet(isPresented: $appearance) { AppearanceSheet() }
        .background {
            // ⌘F: the Library, with its search field focused.
            Button("Search") { section = .library; model.focusSearch = true }
                .keyboardShortcut("f", modifiers: .command).hidden()
        }
        .task(id: "\(model.saves.count)|\(model.collectionsChanged)") { collections = (try? model.library?.collections()) ?? [] }
    }

    private func put(_ ids: [String], _ target: String, _ name: String) -> Bool {
        guard let lib = model.library, !ids.isEmpty else { return false }
        Task {
            try? await lib.put(ids, in: target)
            Haptic.dropped()
            model.refresh()
            model.show(ids.count == 1 ? "Moved to \(name)" : "Moved \(ids.count) saves to \(name)")
        }
        return true
    }
}
