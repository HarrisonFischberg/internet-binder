import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// What a page's search bar found: the matching saves, best first, and the query that found them
/// (yours, or its correction when you made a typo).
struct PageMatches: Equatable {
    var ids: [String]
    var query: String
    var corrected: Bool

    /// The matching saves among `saves`, best first. Reads the page's current saves, so a save
    /// changed or deleted while you search shows as it is now.
    func pick(_ saves: [Save]) -> [Save] {
        let byId = Dictionary(saves.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return ids.compactMap { byId[$0] }
    }
}

/// The search bar at the top of a collection, a Lifestyle view, Places, and the Collections and
/// Lifestyle pages. It looks through that page's saves only, ranked like the Library's search.
struct PageSearchField: View {
    let placeholder: String
    @Binding var query: String
    @Environment(\.ks) private var t
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").font(.body.weight(.semibold)).foregroundStyle(t.inkMuted)
                .accessibilityHidden(true)
            TextField(placeholder, text: $query)
                .focused($focused)
                .submitLabel(.search)
                .foregroundStyle(t.ink)
                .accessibilityIdentifier("pageSearch")
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(t.inkMuted) }
                    .accessibilityLabel("Clear search")
                    .frame(minWidth: 44, minHeight: 44)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        .background(t.well, in: Capsule())
        .overlay(Capsule().strokeBorder(focused ? t.accent : t.rule, lineWidth: focused ? 1.5 : 1))
    }
}

extension View {
    /// Runs a page's search as you type (after a short pause), over `saves` only. `matches` is nil
    /// while the box is empty.
    func pageSearch(_ query: String, in saves: [Save], matches: Binding<PageMatches?>) -> some View {
        modifier(PageSearchRunner(query: query, ids: saves.map(\.id), matches: matches))
    }
}

private struct PageSearchRunner: ViewModifier {
    struct Key: Equatable { let query: String; let ids: [String] }
    let query: String
    let ids: [String]
    @Binding var matches: PageMatches?
    @Environment(LibraryModel.self) private var model

    func body(content: Content) -> some View {
        content.task(id: Key(query: query.trimmingCharacters(in: .whitespaces), ids: ids)) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard !q.isEmpty, let library = model.library else { matches = nil; return }
            try? await Task.sleep(for: .milliseconds(120))
            guard !Task.isCancelled else { return }
            let r = try? await library.search(q, within: ids)
            guard !Task.isCancelled else { return }
            // A failed search shows no matches rather than the last query's.
            matches = r.map { PageMatches(ids: $0.items.map(\.id), query: $0.query, corrected: $0.corrected) } ?? PageMatches(ids: [], query: q, corrected: false)
        }
    }
}

/// A page's search results: the matching saves as cards, best first, or a line saying nothing matched.
struct PageSearchResults: View {
    let query: String
    let matches: PageMatches?
    let saves: [Save]
    /// The page's name, for "Nothing in Recipes matches …".
    let place: String
    let zoom: Namespace.ID
    var selecting = false
    var selected: Binding<Set<String>>?
    var onSelect: ((String) -> Void)?
    @Environment(\.ks) private var t

    var body: some View {
        if let matches {
            let found = matches.pick(saves)
            if found.isEmpty {
                EmptyNote(symbol: "magnifyingglass", text: "Nothing in \(place) matches “\(query.trimmingCharacters(in: .whitespaces))”.")
            } else {
                Text(matches.corrected ? "Showing results for “\(matches.query)”" : (found.count == 1 ? "1 match" : "\(found.count.formatted()) matches"))
                    .font(KSFont.note).foregroundStyle(t.inkMuted)
                    .accessibilityAddTraits(.updatesFrequently)
                SaveGrid(saves: found, zoom: zoom, selecting: selecting, selected: selected, onSelect: onSelect)
            }
        }
    }
}
