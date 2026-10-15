import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// One Lifestyle view (Recipes, Workouts, Films & shows…). Films, shows and books are lists to work
/// through: what's still to watch or read comes first, then what you've done (Chrome's rule).
struct KindScreen: View {
    let kind: String
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t

    private var saves: [Save] { model.saves.filter { $0.kind == kind } }
    private var todo: [Save] { saves.filter { $0.status != "done" } }
    private var done: [Save] { saves.filter { $0.status == "done" } }

    var body: some View {
        let k = KindStyle(kind)
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ScreenHeader(title: k.plural, subtitle: saves.count == 1 ? "1 save" : "\(saves.count) saves")
                    if saves.isEmpty {
                        EmptyNote(symbol: k.symbol, text: "No \(k.plural.lowercased()) yet. Share one to Keepsake and it lands here.")
                    } else {
                        SaveGrid(saves: todo, zoom: zoom)
                        if !done.isEmpty {
                            Text(k.doneVerb).font(KSFont.name(.title2)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                            SaveGrid(saves: done, zoom: zoom)
                        }
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, 40)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Review: saves Keepsake wasn't sure where to put. Each shows why, and three places it most likely
/// goes (Chrome's topSuggestions); one tap files it and teaches the categorizer.
struct ReviewScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var suggestions: [String: ReviewSuggestions] = [:]
    @State private var destinations: [Destination] = []
    private var saves: [Save] { model.saves.filter { $0.needsCollection && $0.purchased != true } }

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(title: "Review", subtitle: "Keepsake wasn't sure where these go")
                    if saves.isEmpty {
                        EmptyNote(symbol: "checkmark.circle", text: "Nothing waiting. Everything has a home.")
                    }
                    ForEach(saves) { save in
                        row(save).transition(reduce ? .opacity : .move(edge: .trailing).combined(with: .opacity))
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, 40)
                .animation(KSMotion.or(KSMotion.settle, reduce: reduce), value: saves.map(\.id))
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task(id: saves.map(\.id)) {
            guard let lib = model.library else { return }
            destinations = (try? await lib.destinations()) ?? []
            for s in saves where suggestions[s.id] == nil { suggestions[s.id] = try? await lib.suggestions(for: s.id) }
        }
    }

    private func row(_ save: Save) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            NavigationLink(value: save) {
                HStack(spacing: 12) {
                    SaveImage(save, symbolSize: 18).frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 4))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(save.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(2)
                        if let why = suggestions[save.id]?.reason, !why.isEmpty {
                            Text(why).font(.footnote).foregroundStyle(t.inkMuted).lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .buttonStyle(PressStyle())
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(suggestions[save.id]?.picks ?? []) { pick in
                        Chip(pick.label, symbol: pick.isNew ? "plus" : "bag", selected: false) { file(save, pick.value, pick.label) }
                            .accessibilityLabel("File in \(pick.label)")
                    }
                    Menu {
                        ForEach(destinations) { d in Button(d.label) { file(save, d.value, d.label) } }
                    } label: {
                        Label("More", systemImage: "ellipsis").font(.subheadline.weight(.medium)).foregroundStyle(t.ink)
                            .padding(.horizontal, 14).frame(minHeight: 44)
                            .overlay(Capsule().strokeBorder(t.rule, lineWidth: 0.75))
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
        .padding(14).background(t.paper).resting()
    }

    private func file(_ save: Save, _ target: String, _ label: String) {
        guard let lib = model.library else { return }
        Task {
            _ = try? await lib.file(save.id, into: target)
            Haptic.dropped()
            model.refresh()
            model.show("Filed in \(label)") {
                try? await lib.update(save.id, ["collectionId": NSNull(), "needsReview": true, "kind": save.kind, "details": [:]])
                model.refresh()
            }
        }
    }
}
