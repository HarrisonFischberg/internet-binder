import SwiftUI
import UniformTypeIdentifiers
import KeepsakeKit
import KeepsakeUI

/// Library: Home's shape with everything in it. Your Collections, then your Lifestyle views, each a
/// stack you open to see its saves; chips narrow it to one group, and filtering, searching or
/// selecting lays the saves out as cards. Search sits at the top with paste-a-link beside it, so
/// nothing floats over the saves.
struct LibraryScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var filter: Filter = .all
    @State private var query = ""
    @State private var results: SearchResult?
    @State private var importing = false
    @State private var status: String?          // "todo", "done", "purchased"
    @State private var source: String?          // a site (host)
    @State private var selecting = false
    @State private var selected: Set<String> = []
    @State private var collections: [SaveCollection] = []
    @State private var naming = false
    @State private var newName = ""
    @FocusState private var searching: Bool
    /// Home's section order, so a drag there reorders the Library's sections too.
    @AppStorage(SavedOrder.key(HomeSections.key)) private var sectionOrder = ""

    enum Filter: Hashable { case all, collections, lifestyle, review, kind(String), collection(String) }

    /// Stacks (Collections and Lifestyle) rather than saves: nothing is narrowing the saves themselves.
    private var grouped: Bool {
        guard query.trimmingCharacters(in: .whitespaces).isEmpty, status == nil, source == nil, !selecting else { return false }
        return filter == .all || filter == .collections || filter == .lifestyle
    }

    private var shown: [Save] {
        if let results, !query.trimmingCharacters(in: .whitespaces).isEmpty { return results.items }
        var list: [Save]
        switch filter {
        case .all: list = model.saves
        case .collections: list = model.saves.filter { !($0.collectionId ?? "").isEmpty }
        case .lifestyle: list = model.saves.filter(\.hasOwnView)
        case .review: list = model.saves.filter { $0.needsCollection && $0.purchased != true }
        case .kind(let k): list = model.saves.filter { $0.kind == k }
        case .collection(let id): list = model.saves.filter { $0.collectionId == id }
        }
        switch status {
        case "todo": list = list.filter { $0.status != "done" && $0.purchased != true }
        case "done": list = list.filter { $0.status == "done" }
        case "purchased": list = list.filter { $0.purchased == true }
        default: break
        }
        if let source { list = list.filter { $0.host == source } }
        return list
    }

    /// The sites you save from most, for the Source filter.
    private var topSources: [String] {
        var counts: [String: Int] = [:]
        for s in model.saves { if let h = s.host, !h.isEmpty { counts[h, default: 0] += 1 } }
        return counts.sorted { $0.value > $1.value || ($0.value == $1.value && $0.key < $1.key) }.prefix(12).map(\.key)
    }

    private let statusNames = ["todo": "To do", "done": "Done", "purchased": "Purchased"]

    /// Kinds the library has, in Chrome's menu order.
    private var kinds: [String] {
        let present = Set(model.saves.map(\.kind))
        return ["place", "recipe", "product", "media", "book", "workout", "video", "article", "link"].filter(present.contains)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    if model.loaded { searchField }
                    if !model.saves.isEmpty && query.isEmpty { filters }
                    content
                }
                .padding(.horizontal, 18)
                .padding(.bottom, selecting ? 140 : 32)
            }
            .scrollDismissesKeyboard(.immediately)
            .safeAreaInset(edge: .top, spacing: 0) { TopScrim() }
            if selecting {
                SaveSelectionBar(all: shown.map(\.id), selected: $selected, selecting: $selecting)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { DispatchQueue.main.async { Perf.done("Library on screen") } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            if case .success(let url) = result { Task { await model.importFile(url) } }
        }
        .alert("New collection", isPresented: $naming) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) { newName = "" }
            Button("Create") { Task { _ = try? await model.library?.createCollection(named: newName); newName = ""; loadCollections() } }
        }
        .animation(KSMotion.or(KSMotion.settle, reduce: reduce), value: selecting)
        .task(id: "\(model.saves.count)|\(model.collectionsChanged)") { loadCollections() }
        .onChange(of: model.focusSearch, initial: true) { _, want in
            if want { searching = true; model.focusSearch = false }
        }
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard !q.isEmpty, let library = model.library else { results = nil; return }
            try? await Task.sleep(for: .milliseconds(120))
            results = try? await library.search(q)
        }
    }

    private func loadCollections() { collections = (try? model.library?.collections()) ?? [] }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Library").font(KSFont.display()).foregroundStyle(t.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(model.saves.count == 1 ? "1 save" : "\(model.saves.count) saves")
                    .font(KSFont.note).foregroundStyle(t.inkMuted)
            }
            Spacer()
            if !model.saves.isEmpty { HeaderSelectButton(selecting: $selecting, selected: $selected) }
            Menu {
                Button("Import from Chrome", systemImage: "square.and.arrow.down") { importing = true }
            } label: {
                Image(systemName: "ellipsis").font(.body.weight(.bold)).foregroundStyle(t.ink)
                    .frame(width: 44, height: 44)
                    .ksSurface(radius: 22, scale: 0.75)
            }
            .accessibilityLabel("More")
        }
        .padding(.top, 8)
    }

    private var filters: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                Menu {
                    Picker("Status", selection: $status) {
                        Text("Any status").tag(String?.none)
                        ForEach(["todo", "done", "purchased"], id: \.self) { Text(statusNames[$0]!).tag(String?.some($0)) }
                    }
                    Picker("Source", selection: $source) {
                        Text("Any site").tag(String?.none)
                        ForEach(topSources, id: \.self) { Text($0).tag(String?.some($0)) }
                    }
                } label: {
                    Image(systemName: "line.3.horizontal.decrease").font(.subheadline.weight(.bold))
                        .foregroundStyle(status != nil || source != nil ? t.table : t.ink)
                        .frame(width: 44, height: 44)
                        .background(status != nil || source != nil ? t.ink : t.paper, in: Circle())
                        .overlay(Circle().strokeBorder(t.style == .pantry ? t.line : t.rule, lineWidth: t.style == .pantry ? 2.5 : 1))
                }
                .accessibilityLabel("Filter")
                Chip("All", selected: filter == .all) { set(.all) }
                Chip("Collections", symbol: "bag", tint: KindStyle("product").color, selected: filter == .collections) { set(.collections) }
                Chip("Lifestyle", symbol: "sparkles", tint: KindStyle("recipe").color, selected: filter == .lifestyle) { set(.lifestyle) }
                if model.reviewCount > 0 {
                    Chip("Review \(model.reviewCount)", symbol: "tray", selected: filter == .review) { set(.review) }
                }
                if let status {
                    Chip(statusNames[status] ?? status, trailing: "xmark", selected: true) { self.status = nil }
                        .accessibilityLabel("Remove filter \(statusNames[status] ?? status)")
                }
                if let source {
                    Chip(source, trailing: "xmark", selected: true) { self.source = nil }
                        .accessibilityLabel("Remove filter \(source)")
                }
                divider
                ForEach(collections) { c in
                    Chip(c.name, symbol: "bag", tint: KindStyle("product").color, selected: filter == .collection(c.id)) { set(.collection(c.id)) }
                        .accessibilityLabel("Collection \(c.name)")
                }
                if !collections.isEmpty && !kinds.isEmpty { divider }
                ForEach(kinds, id: \.self) { k in
                    let s = KindStyle(k)
                    Chip(plural(k), symbol: s.symbol, tint: s.color, kind: k, selected: filter == .kind(k)) { set(.kind(k)) }
                }
            }
            .padding(.horizontal, 18)
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, -18)
    }

    /// A hairline between the chip groups: the two libraries, your collections, then the kinds.
    private var divider: some View {
        Rectangle().fill(t.rule).frame(width: 1, height: 22).padding(.horizontal, 2).accessibilityHidden(true)
    }

    private func set(_ f: Filter) {
        withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { filter = f }
    }

    private func plural(_ k: String) -> String {
        switch k {
        case "media": "Films & shows"; case "link": "Links"
        default: KindStyle(k).label + "s"
        }
    }

    @ViewBuilder private var content: some View {
        if let problem = model.problem {
            EmptyNote(symbol: "exclamationmark.triangle", text: problem)
        } else if !model.loaded {
            ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
        } else if model.saves.isEmpty {
            EmptyNote(symbol: "bookmark", text: "Nothing saved yet. Share a page, a post or a place to Patchwork from any app, or import your Chrome library.") {
                importing = true
            }
        } else if grouped {
            overview
        } else if shown.isEmpty {
            EmptyNote(symbol: "magnifyingglass", text: query.isEmpty ? "Nothing here yet." : "No saves match “\(query)”.")
        } else {
            if let results, results.corrected {
                Text("Showing results for “\(results.query)”").font(KSFont.note).foregroundStyle(t.inkMuted)
            }
            Masonry(shown, columns: typeSize.isAccessibilitySize ? 1 : nil, minColumnWidth: 170) { save in
                if selecting {
                    let on = selected.contains(save.id)
                    Button {
                        Haptic.checked()
                        if on { selected.remove(save.id) } else { selected.insert(save.id) }
                    } label: {
                        SaveObject(save).selectionCheck(on)
                    }
                    .buttonStyle(PressStyle())
                    .accessibilityLabel(save.title)
                } else {
                NavigationLink(value: save) {
                    SaveObject(save).matchedTransitionSource(id: save.id, in: zoom)
                }
                .buttonStyle(PressStyle())
                .draggable(save.id) { SaveObject(save).frame(width: 160) }
                // VoiceOver rotor: the card's own actions without opening it.
                .accessibilityAction(named: save.status == "done" ? "Mark not \(KindStyle(save.kind).doneVerb.lowercased())" : "Mark \(KindStyle(save.kind).doneVerb.lowercased())") {
                    Task { await model.setDone(save, save.status != "done") }
                }
                .accessibilityAction(named: "Move to Trash") { Task { await model.trash(save) } }
                .contextMenu {
                    SaveMenu(save: save) {
                        Haptic.detent()
                        selected = [save.id]
                        selecting = true
                    }
                }
                }
            }
        }
    }

    /// Collections first, then Lifestyle: each group a stack with one of its pictures, opening to its saves.
    @ViewBuilder private var overview: some View {
        VStack(alignment: .leading, spacing: 30) {
            if filter == .all, model.reviewCount > 0 { reviewRow }
            // In Home's order: drag the sections there, and the stacks within them here.
            ForEach(HomeSections.order(sectionOrder), id: \.self) { section in
                if section == "collections", filter != .lifestyle {
                    let filed = model.saves.filter { !($0.collectionId ?? "").isEmpty }.count
                    GroupSection(title: "Collections", detail: "\(count(collections.count, "collection")) · \(count(filed, "save"))") {
                        CollectionTiles(collections: collections) { naming = true }
                    }
                }
                if section == "lifestyle", filter != .collections {
                    let lifestyle = model.saves.filter(\.hasOwnView)
                    GroupSection(title: "Lifestyle", detail: "\(count(Set(lifestyle.map(\.kind)).count, "kind")) · \(count(lifestyle.count, "save"))") {
                        if lifestyle.isEmpty {
                            Text("Recipes, places, workouts, films and books land here.").font(KSFont.note).foregroundStyle(t.inkMuted)
                        } else {
                            LifestyleTiles()
                        }
                    }
                }
            }
        }
        .padding(.top, 4)
    }

    /// Saves waiting for a home, as one quiet row above the stacks.
    private var reviewRow: some View {
        Button { set(.review) } label: {
            HStack(spacing: 12) {
                Image(systemName: "tray.full").font(.title3)
                Text(model.reviewCount == 1 ? "1 save needs a collection" : "\(model.reviewCount) saves need a collection")
                    .font(.subheadline.weight(.bold))
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.bold))
            }
            .foregroundStyle(t.style == .gallery ? t.ink : t.onHighlight)
            .padding(.horizontal, 14).frame(minHeight: 52)
            .ksSurface(t.style == .gallery ? t.well : t.highlight)
        }
        .buttonStyle(PressStyle())
    }

    private func count(_ n: Int, _ noun: String) -> String { n == 1 ? "1 \(noun)" : "\(n) \(noun)s" }

    /// Search, at the top, with paste-a-link beside it.
    @ViewBuilder private var searchField: some View {
        if model.saves.isEmpty {
            // Nothing to search yet: paste is the way in, so it says what it does.
            PasteButton(payloadType: URL.self) { urls in
                Task { await model.pasteLink(urls.first?.absoluteString) }
            }
            .labelStyle(.titleAndIcon)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .tint(t.accentForWhiteGlyph)
            .accessibilityLabel("Save the link you copied")
        } else {
            searchRow
        }
    }

    private var searchRow: some View {
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.body.weight(.semibold)).foregroundStyle(t.inkMuted)
                TextField(model.saves.count == 1 ? "Search 1 save" : "Search \(model.saves.count) saves", text: $query)
                    .focused($searching)
                    .submitLabel(.search)
                    .foregroundStyle(t.ink)
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(t.inkMuted) }
                        .accessibilityLabel("Clear search")
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 50)
            .ksSurface(radius: t.style == .pantry ? 16 : t.controlRadius.isInfinite ? 25 : t.controlRadius, lifted: false)
            // The system Paste button reads the clipboard only when tapped, so iOS never asks to allow it.
            PasteButton(payloadType: URL.self) { urls in
                Task { await model.pasteLink(urls.first?.absoluteString) }
            }
            .labelStyle(.iconOnly)
            .buttonBorderShape(.circle)
            .controlSize(.large)
            .tint(t.accentForWhiteGlyph)
            .accessibilityLabel("Save the link you copied")
        }
    }
}

/// A filled button's shape in the current style.
enum ControlShapeView {
    static func shape(_ t: KSTheme) -> RoundedRectangle {
        RoundedRectangle(cornerRadius: t.controlRadius.isInfinite ? 27 : t.controlRadius, style: .continuous)
    }
}

/// An empty or problem state: one sentence, at most one action.
struct EmptyNote: View {
    let symbol: String
    let text: String
    var action: (() -> Void)?
    @Environment(\.ks) private var t
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: symbol).font(.largeTitle.weight(.light)).foregroundStyle(t.inkMuted).accessibilityHidden(true)
            Text(text).font(.body).foregroundStyle(t.ink).multilineTextAlignment(.center)
            if let action {
                Button("Import from Chrome", action: action).buttonStyle(.bordered).frame(minHeight: 44)
            }
        }
        .padding(.horizontal, 24).padding(.top, 60)
        .frame(maxWidth: .infinity)
    }
}
