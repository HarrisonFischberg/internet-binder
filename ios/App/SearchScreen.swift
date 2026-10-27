import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Search, as its own tab: every save, the same search as the Library's (typos forgiven), narrowed by
/// kind with the chips. With nothing typed or picked it offers the kinds you have and your newest
/// saves. The field opens with the keyboard up; the query stays when a filter changes.
struct SearchScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var query = ""
    @State private var results: SearchResult?
    @State private var kindsOn: Set<String> = []
    @FocusState private var focused: Bool

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }
    private var kinds: [String] {
        let present = Set(model.index.byKind.keys)
        return ["place", "recipe", "product", "media", "book", "workout", "video", "article", "link"].filter(present.contains)
    }
    /// What the query and the chips leave, best match first (the search's own order).
    private var shown: [Save]? {
        let base: [Save]
        if trimmed.isEmpty { base = model.saves } else if let results { base = results.items } else { return nil }
        return kindsOn.isEmpty ? base : base.filter { kindsOn.contains($0.kind) }
    }
    private var browsing: Bool { trimmed.isEmpty && kindsOn.isEmpty }

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ScreenHeader(title: "Search")
                    field
                    if model.saves.isEmpty {
                        EmptyNote(symbol: "magnifyingglass", text: "Your saves will be searchable here.")
                    } else {
                        filters
                        if browsing { recent } else { found }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 32)
            }
            .scrollDismissesKeyboard(.immediately)
            .safeAreaInset(edge: .top, spacing: 0) { TopScrim() }
        }
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { focused = true }
        .task(id: query) {
            guard !trimmed.isEmpty, let library = model.library else { results = nil; return }
            try? await Task.sleep(for: .milliseconds(120))
            results = try? await library.search(trimmed)
        }
    }

    /// The query field: 52 pt, a clear button while there's text, Cancel while typing.
    private var field: some View {
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.body.weight(.semibold)).foregroundStyle(t.inkMuted).accessibilityHidden(true)
                TextField(model.saves.count == 1 ? "Search 1 save" : "Search \(model.saves.count.formatted()) saves", text: $query)
                    .focused($focused)
                    .submitLabel(.search)
                    .autocorrectionDisabled()
                    .foregroundStyle(t.ink)
                    .accessibilityLabel("Search your saves")
                if !query.isEmpty {
                    Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(t.inkMuted) }
                        .frame(minWidth: 44, minHeight: 44)
                        .accessibilityLabel("Clear search")
                }
            }
            .padding(.leading, 16).padding(.trailing, query.isEmpty ? 16 : 4)
            .frame(minHeight: 52)
            .background(t.well, in: Capsule())
            .overlay(Capsule().strokeBorder(focused ? t.accent : t.rule, lineWidth: focused ? 1.5 : 1))
            if focused {
                Button("Cancel") {
                    query = ""
                    focused = false
                }
                .font(.body.weight(.medium)).foregroundStyle(t.accent)
                .frame(minHeight: 44)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
        .animation(KSMotion.or(KSMotion.settle, reduce: reduce), value: focused)
    }

    /// Kinds: tap to narrow to one or more; ticked chips are filled with a checkmark.
    private var filters: some View {
        VStack(alignment: .leading, spacing: 10) {
            heading("Kinds")
            Flow(spacing: 8) {
                ForEach(kinds, id: \.self) { k in
                    let s = KindStyle(k)
                    let on = kindsOn.contains(k)
                    Chip(s.plural, symbol: t.style == .nocturne ? s.symbol : nil, tint: t.kind(k), selected: on, checks: true) {
                        withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) {
                            if on { kindsOn.remove(k) } else { kindsOn.insert(k) }
                        }
                    }
                    .accessibilityHint(on ? "Shows every kind again" : "Shows only \(s.plural.lowercased())")
                }
            }
        }
    }

    @ViewBuilder private var recent: some View {
        heading("Recent")
        SaveGrid(saves: Array(model.saves.prefix(8)), zoom: zoom)
    }

    @ViewBuilder private var found: some View {
        if let shown {
            if let results, results.corrected, !trimmed.isEmpty {
                Text("Showing results for “\(results.query)”").font(KSFont.note).foregroundStyle(t.inkMuted)
            }
            HStack(alignment: .firstTextBaseline) {
                Text(shown.count == 1 ? "1 save" : "\(shown.count.formatted()) saves").font(.subheadline.weight(.semibold)).foregroundStyle(t.inkMuted)
                    .monospacedDigit()
                    .accessibilityAddTraits(.updatesFrequently)
                Spacer()
                if kindsOn.count == 1, let k = kindsOn.first, trimmed.isEmpty {
                    NavigationLink(value: Route.kind(k)) {
                        Label("Open \(KindStyle(k).plural)", systemImage: "arrow.up.right").font(.subheadline.weight(.semibold)).foregroundStyle(t.accent)
                            .frame(minHeight: 44)
                    }
                }
                if !kindsOn.isEmpty {
                    Button("Clear filters") { withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { kindsOn = [] } }
                        .font(.subheadline.weight(.semibold)).foregroundStyle(t.accent)
                        .frame(minHeight: 44)
                }
            }
            if shown.isEmpty {
                VStack(spacing: 14) {
                    Image(systemName: "magnifyingglass").font(.largeTitle.weight(.light)).foregroundStyle(t.inkMuted).accessibilityHidden(true)
                    Text(trimmed.isEmpty ? "No saves found. Try another kind." : "No saves found for “\(trimmed)”. Try another word or remove a filter.")
                        .font(.body).foregroundStyle(t.ink).multilineTextAlignment(.center)
                    Button(kindsOn.isEmpty ? "Clear search" : "Clear filters") {
                        if kindsOn.isEmpty { query = "" } else { kindsOn = [] }
                    }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(t.onAccent)
                    .padding(.horizontal, 18).frame(minHeight: 44)
                    .background(t.accent, in: Capsule())
                }
                .padding(.horizontal, 24).padding(.top, 40)
                .frame(maxWidth: .infinity)
            } else {
                SaveGrid(saves: shown, zoom: zoom)
            }
        } else {
            // Searching: the grid's place, kept, with a quiet spinner.
            ProgressView("Searching…").tint(t.accent).foregroundStyle(t.inkMuted).frame(maxWidth: .infinity).padding(.top, 60)
        }
    }

    private func heading(_ title: String) -> some View {
        Text(title).font(KSFont.section()).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
    }
}
