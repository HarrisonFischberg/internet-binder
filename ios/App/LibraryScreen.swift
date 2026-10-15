import SwiftUI
import UniformTypeIdentifiers
import KeepsakeKit
import KeepsakeUI

/// Library: every save as an object on the table. One primary action, finding a save, lives at the
/// bottom under the thumb (the search dock); paste-a-link sits beside it.
struct LibraryScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.appearance) private var appearance
    @State private var filter: Filter = .all
    @State private var query = ""
    @State private var results: SearchResult?
    @State private var importing = false
    @FocusState private var searching: Bool

    enum Filter: Hashable { case all, review, kind(String) }

    private var shown: [Save] {
        if let results, !query.trimmingCharacters(in: .whitespaces).isEmpty { return results.items }
        switch filter {
        case .all: return model.saves
        case .review: return model.saves.filter { $0.needsCollection && $0.purchased != true }
        case .kind(let k): return model.saves.filter { $0.kind == k }
        }
    }

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
                    if !model.saves.isEmpty && query.isEmpty { filters }
                    content
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 130)
            }
            .scrollDismissesKeyboard(.immediately)
            .safeAreaInset(edge: .top, spacing: 0) { TopScrim() }
            dock
        }
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { DispatchQueue.main.async { Perf.done("Library on screen") } }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            if case .success(let url) = result { Task { await model.importFile(url) } }
        }
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

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Library").font(KSFont.display()).foregroundStyle(t.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(model.saves.count == 1 ? "1 save, kept on this iPhone" : "\(model.saves.count) saves, kept on this iPhone")
                    .font(KSFont.note).foregroundStyle(t.inkMuted)
            }
            Spacer()
            Menu {
                Button("Import from Chrome", systemImage: "square.and.arrow.down") { importing = true }
            } label: {
                Image(systemName: "ellipsis").font(.body.weight(.semibold)).foregroundStyle(t.ink)
                    .padding(12).frame(minWidth: 44, minHeight: 44)
                    .background(t.paper, in: Circle())
                    .overlay(Circle().strokeBorder(t.rule, lineWidth: 0.75))
            }
            .accessibilityLabel("More")
        }
        .padding(.top, 8)
    }

    private var filters: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                Chip("All", selected: filter == .all) { set(.all) }
                if model.reviewCount > 0 {
                    Chip("Review \(model.reviewCount)", symbol: "tray", selected: filter == .review) { set(.review) }
                }
                ForEach(kinds, id: \.self) { k in
                    let s = KindStyle(k)
                    Chip(plural(k), symbol: s.symbol, tint: s.color, selected: filter == .kind(k)) { set(.kind(k)) }
                }
            }
            .padding(.horizontal, 18)
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, -18)
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
            EmptyNote(symbol: "bookmark", text: "Nothing saved yet. Share a page, a post or a place to Keepsake from any app, or import your Chrome library.") {
                importing = true
            }
        } else if shown.isEmpty {
            EmptyNote(symbol: "magnifyingglass", text: query.isEmpty ? "Nothing here yet." : "No saves match “\(query)”.")
        } else {
            if let results, results.corrected {
                Text("Showing results for “\(results.query)”").font(KSFont.note).foregroundStyle(t.inkMuted)
            }
            Masonry(shown, columns: typeSize.isAccessibilitySize ? 1 : nil, minColumnWidth: appearance.density == "compact" ? 105 : 170) { save in
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
                    Button("Move to Trash", systemImage: "trash", role: .destructive) { Task { await model.trash(save) } }
                }
            }
        }
    }

    private var dock: some View {
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.body.weight(.semibold)).foregroundStyle(t.inkMuted)
                TextField("Search \(model.saves.count) saves", text: $query)
                    .focused($searching)
                    .submitLabel(.search)
                    .foregroundStyle(t.ink)
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(t.inkMuted) }
                        .accessibilityLabel("Clear search")
                        .frame(minWidth: 44, minHeight: 44)
                }
            }
            .padding(.horizontal, 18)
            .frame(minHeight: 54)
            .background(t.paper, in: Capsule())
            .overlay(Capsule().strokeBorder(t.rule, lineWidth: 0.75))
            .shadow(color: .black.opacity(0.14), radius: 12, y: 6)
            // The system Paste button reads the clipboard only when tapped, so iOS never asks to allow it.
            PasteButton(payloadType: URL.self) { urls in
                Task { await model.pasteLink(urls.first?.absoluteString) }
            }
            .labelStyle(.iconOnly)
            .buttonBorderShape(.circle)
            .controlSize(.extraLarge)
            .tint(t.accentForWhiteGlyph)
            .accessibilityLabel("Save the link you copied")
        }
        .padding(.horizontal, 16).padding(.bottom, 6)
        .background(alignment: .bottom) { BottomScrim() }
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
            Image(systemName: symbol).font(.system(size: 34, weight: .light)).foregroundStyle(t.inkMuted)
            Text(text).font(.system(.body, design: .serif)).foregroundStyle(t.ink).multilineTextAlignment(.center)
            if let action {
                Button("Import from Chrome", action: action).buttonStyle(.bordered).frame(minHeight: 44)
            }
        }
        .padding(.horizontal, 24).padding(.top, 60)
        .frame(maxWidth: .infinity)
    }
}
