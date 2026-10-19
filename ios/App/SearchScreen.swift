import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Search, as its own tab: every save, the same search as the Library's (typos forgiven). With
/// nothing typed it offers the kinds you have and your newest saves.
struct SearchScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @State private var query = ""
    @State private var results: SearchResult?
    /// The field is open (and the keyboard up) as soon as the tab opens.
    @State private var searching = true

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }
    private var kinds: [String] {
        let present = Set(model.saves.map(\.kind))
        return ["place", "recipe", "product", "media", "book", "workout", "video", "article", "link"].filter(present.contains)
    }

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if trimmed.isEmpty { suggestions } else { found }
                }
                .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 32)
            }
            .scrollDismissesKeyboard(.immediately)
        }
        .navigationTitle("Search")
        .searchable(text: $query, isPresented: $searching, prompt: model.saves.count == 1 ? "Search 1 save" : "Search \(model.saves.count) saves")
        .task(id: query) {
            guard !trimmed.isEmpty, let library = model.library else { results = nil; return }
            try? await Task.sleep(for: .milliseconds(120))
            results = try? await library.search(trimmed)
        }
    }

    @ViewBuilder private var suggestions: some View {
        if model.saves.isEmpty {
            EmptyNote(symbol: "magnifyingglass", text: "Your saves will be searchable here.")
        } else {
            heading("Kinds")
            Flow(spacing: 8) {
                ForEach(kinds, id: \.self) { k in
                    let s = KindStyle(k)
                    NavigationLink(value: Route.kind(k)) {
                        Text(s.plural).font(t.style == .pantry ? .subheadline.weight(.heavy) : .subheadline.weight(.medium))
                            .foregroundStyle(t.style == .pantry ? t.onKind : t.ink)
                            .padding(.horizontal, 14).frame(minHeight: 44)
                            .ksSurface(t.style == .pantry ? t.kindFill(k) : nil, radius: t.controlRadius.isInfinite ? 22 : t.controlRadius, scale: 0.6)
                    }
                    .buttonStyle(PressStyle())
                }
            }
            heading("Recent")
            SaveGrid(saves: Array(model.saves.prefix(8)), zoom: zoom)
        }
    }

    @ViewBuilder private var found: some View {
        if let results {
            if results.corrected {
                Text("Showing results for “\(results.query)”").font(KSFont.note).foregroundStyle(t.inkMuted)
            }
            if results.items.isEmpty {
                EmptyNote(symbol: "magnifyingglass", text: "No saves match “\(trimmed)”.")
            } else {
                SaveGrid(saves: results.items, zoom: zoom)
            }
        } else {
            ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
        }
    }

    private func heading(_ title: String) -> some View {
        Text(title).font(KSFont.name(.title2)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
    }
}
