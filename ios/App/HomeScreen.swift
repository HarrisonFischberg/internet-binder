import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Home: what needs you, what's new, your Lifestyle views, and one save to come back to. Nothing else.
struct HomeScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @State private var settings = false
    @Environment(\.horizontalSizeClass) private var size

    private var lifestyle: [(kind: String, count: Int)] {
        KindStyle.lifestyle.map { k in (k, model.saves.filter { $0.kind == k }.count) }.filter { $0.count > 0 }
    }

    /// Saved over six weeks ago and not opened since (Home's "Come back to" in Chrome).
    private var comeBackTo: Save? {
        let cutoff = Date().addingTimeInterval(-42 * 86_400)
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func old(_ s: String?) -> Bool { s.flatMap { iso.date(from: $0) }.map { $0 < cutoff } ?? true }
        return model.saves.first { $0.status != "done" && $0.purchased != true && old($0.createdAt) && old($0.openedAt) }
    }

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    HStack(alignment: .top) {
                        ScreenHeader(title: "Keepsake", subtitle: model.saves.isEmpty ? nil : "Things you kept, on this iPhone")
                        if size != .regular { Button { settings = true } label: {
                            Image(systemName: "gearshape").font(.body.weight(.semibold)).foregroundStyle(t.ink)
                                .padding(12).frame(minWidth: 44, minHeight: 44)
                                .background(t.paper, in: Circle()).overlay(Circle().strokeBorder(t.rule, lineWidth: 0.75))
                        }
                        .accessibilityLabel("Settings")
                        .padding(.top, 8) }
                    }
                    if model.reviewCount > 0 { reviewBanner }
                    if model.saves.isEmpty && model.loaded {
                        EmptyNote(symbol: "bookmark", text: "Nothing saved yet. Share a page, a post or a place to Keepsake from any app.")
                    }
                    if !model.saves.isEmpty { recent }
                    if !lifestyle.isEmpty { lifestyleTiles }
                    NavigationLink(value: Route.collections) {
                        Label("Collections", systemImage: "bag").font(KSFont.name(.headline)).foregroundStyle(t.ink)
                            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading).padding(.horizontal, 14)
                            .background(t.paper).resting()
                    }
                    .buttonStyle(PressStyle())
                    if let save = comeBackTo { comeBack(save) }
                }
                .padding(.horizontal, 18).padding(.bottom, 40)
            }
            .safeAreaInset(edge: .top, spacing: 0) { TopScrim() }
        }
        .toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $settings) { SettingsScreen() }
    }

    private var reviewBanner: some View {
        NavigationLink(value: Route.review) {
            HStack(spacing: 14) {
                Image(systemName: "tray.full").font(.title3).foregroundStyle(t.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.reviewCount == 1 ? "1 save needs a collection" : "\(model.reviewCount) saves need a collection")
                        .font(.headline).foregroundStyle(t.ink)
                    Text("Keepsake wasn't sure where these go.").font(.subheadline).foregroundStyle(t.inkMuted)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(t.inkMuted)
            }
            .padding(16)
            .background(t.paper)
            .overlay(alignment: .leading) { Rectangle().fill(t.accent).frame(width: 3) }
            .resting()
        }
        .buttonStyle(PressStyle())
    }

    private var recent: some View {
        VStack(alignment: .leading, spacing: 12) {
            section("Recent")
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 16) {
                    ForEach(model.saves.prefix(8)) { save in
                        NavigationLink(value: save) {
                            SaveObject(save).frame(width: 170).matchedTransitionSource(id: save.id, in: zoom)
                        }
                        .buttonStyle(PressStyle())
                    }
                }
                .padding(.horizontal, 18).padding(.vertical, 12)
            }
            .scrollIndicators(.hidden)
            .padding(.horizontal, -18)
        }
    }

    private var lifestyleTiles: some View {
        VStack(alignment: .leading, spacing: 12) {
            section("Lifestyle")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 12)], spacing: 12) {
                ForEach(lifestyle, id: \.kind) { entry in
                    let k = KindStyle(entry.kind)
                    NavigationLink(value: Route.kind(entry.kind)) {
                        HStack(spacing: 12) {
                            Stamp(kind: entry.kind, size: 34)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(k.plural).font(KSFont.name(.headline)).foregroundStyle(t.ink)
                                    .lineLimit(2).minimumScaleFactor(0.85)
                                Text("\(entry.count)").font(.subheadline).foregroundStyle(t.inkMuted)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(14).frame(minHeight: 64)
                        .background(t.paper).resting()
                    }
                    .buttonStyle(PressStyle())
                    .accessibilityLabel("\(k.plural), \(entry.count)")
                }
            }
        }
    }

    private func comeBack(_ save: Save) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            section("Come back to")
            NavigationLink(value: save) {
                SaveObject(save).frame(maxWidth: 260).matchedTransitionSource(id: save.id, in: zoom)
            }
            .buttonStyle(PressStyle())
        }
    }

    private func section(_ title: String) -> some View {
        Text(title).font(KSFont.name(.title2)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
    }
}
