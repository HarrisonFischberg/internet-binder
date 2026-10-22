import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Appearance, opened from the palette button on Home (and the iPad sidebar): light or dark, the
/// style, the app icon, then feel. The sheet itself wears the chosen style, so a change
/// shows at once.
struct AppearanceSheet: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            AppearanceScreen()
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}

struct AppearanceScreen: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        @Bindable var model = model
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    section("Mode") {
                        Picker("Mode", selection: $model.appearance.mode) {
                            Text("System").tag("system")
                            Text("Light").tag("light")
                            Text("Dark").tag("dark")
                        }
                        .pickerStyle(.segmented)
                        .onChange(of: model.appearance.mode) { Haptic.detent() }
                    }
                    section("Style") {
                        VStack(spacing: 16) {
                            ForEach(KSTheme.all, id: \.id) { style in
                                StyleCard(theme: style.theme, saves: samples, chosen: model.appearance.theme == style.id) {
                                    Haptic.detent()
                                    withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { model.appearance.theme = style.id }
                                }
                            }
                        }
                    }
                    section("App icon") { IconPicker() }
                    section("Feel") {
                        VStack(spacing: 0) {
                            Toggle("Haptics", isOn: $model.appearance.haptics).frame(minHeight: 44)
                            Toggle("Sound", isOn: $model.appearance.sound).frame(minHeight: 44)
                                .onChange(of: model.appearance.sound) { _, on in
                                    // A sample, so turning it on is heard at once.
                                    if on { Haptic.sound = true; Haptic.tick() }
                                }
                            Text("Sound is a soft tick when a save lands or you mark one done. Silent mode mutes it.")
                                .font(.footnote).foregroundStyle(t.inkMuted).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .foregroundStyle(t.ink)
                        .padding(14)
                        .ksSurface(lifted: false)
                    }
                }
                .padding(.horizontal, 18).padding(.top, 8).padding(.bottom, 32)
            }
        }
        .navigationTitle("Appearance")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(t.table, for: .navigationBar)
        .toolbarBackgroundVisibility(.visible, for: .navigationBar)
    }

    /// Two of your own saves for the previews: one with a picture and, if there is one, one without,
    /// so each style shows how it draws both.
    /// The same two sample saves in every preview (a recipe with its photo, a book as a jar label), so
    /// each style is shown with the same things whatever is in the library, and never empty.
    private var samples: [Save] { Self.sampleSaves }

    static let sampleSaves: [Save] = {
        guard let url = Bundle.main.url(forResource: "StyleSamples", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([Save].self, from: data)) ?? []
    }()

    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(KSFont.name(.title3)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
            content()
        }
    }
}

/// One style, large: two sample saves drawn in it, its name in its own title face, a line on what
/// it's like, and an unmistakable mark when it's the one in use.
struct StyleCard: View {
    let theme: KSTheme
    let saves: [Save]
    let chosen: Bool
    let action: () -> Void
    @Environment(\.ks) private var t

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                preview
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(theme.name).font(KSFont.name(.title3, theme)).foregroundStyle(theme.ink)
                        Text(Self.blurb(theme.style)).font(.footnote).foregroundStyle(theme.inkMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: chosen ? "checkmark.circle.fill" : "circle")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(chosen ? theme.primary : theme.inkMuted.opacity(0.6))
                }
                .padding(14)
                .background(theme.paper)
            }
            .fontDesign(theme.bodyDesign)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(chosen ? t.ink : t.rule, lineWidth: chosen ? 4 : 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(PressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(theme.name). \(Self.blurb(theme.style))")
        .accessibilityValue(chosen ? "Selected" : "")
        .accessibilityAddTraits(chosen ? [.isButton, .isSelected] : .isButton)
    }

    /// The sample saves on the style's own page, in its own colours, type and depth.
    private var preview: some View {
        HStack(alignment: .top, spacing: 12) {
            if saves.isEmpty {
                Text("Your saves will show here.").font(.footnote).foregroundStyle(theme.inkMuted)
            }
            ForEach(saves) { save in
                SaveObject(save, compact: true).frame(width: 132).allowsHitTesting(false)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 200, maxHeight: 230, alignment: .topLeading)
        .clipped()
        .background { TableBackground() }
        .environment(\.ks, theme)
        .accessibilityHidden(true)
    }

    static func blurb(_ style: KSTheme.Style) -> String {
        switch style {
        case .pantry: "Bold colours, thick outlines, buttons that press in."
        case .notebook: "Graph paper, serif names and a highlighter for what matters."
        case .gallery: "White walls, big photos, black as the only accent."
        case .atlas: "Dark and cinematic, with one amber action per screen."
        case .swiss: "Hairlines, strict type and one signal red."
        }
    }
}

/// App icon: Keepsake (the app's own four-scraps icon) or one per style, each following light, dark and tinted
/// home screens.
struct IconPicker: View {
    @State private var current = UIApplication.shared.alternateIconName
    @Environment(\.ks) private var t
    static let icons: [(name: String?, label: String)] = [
        (nil, "Keepsake"), ("AppIconNotebook", "Field Notebook"),
        ("AppIconAtlas", "Night Atlas"), ("AppIconSwiss", "Swiss Index"),
    ]
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 12)], spacing: 14) {
            ForEach(Self.icons, id: \.label) { icon in
                let on = current == icon.name
                Button {
                    Haptic.detent()
                    UIApplication.shared.setAlternateIconName(icon.name) { _ in current = UIApplication.shared.alternateIconName }
                } label: {
                    VStack(spacing: 8) {
                        Image(icon.name.map { "\($0)Preview" } ?? "AppIconPreview").resizable()
                            .frame(width: 68, height: 68)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .padding(4)
                            .overlay(RoundedRectangle(cornerRadius: 19, style: .continuous).strokeBorder(on ? t.ink : .clear, lineWidth: 3))
                            .overlay(alignment: .topTrailing) {
                                if on {
                                    Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(t.onPrimary, t.primary)
                                        .offset(x: 6, y: -6)
                                }
                            }
                        Text(icon.label).font(.footnote.weight(on ? .bold : .regular)).foregroundStyle(t.ink)
                            .multilineTextAlignment(.center).lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(PressStyle())
                .accessibilityLabel(icon.label)
                .accessibilityValue(on ? "Selected" : "")
                .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
            }
        }
    }

    /// The felt pocket and Gallery icons are gone: anyone still on one goes back to the app's own icon.
    @MainActor static func retireOldIcons() {
        guard let name = UIApplication.shared.alternateIconName, !icons.contains(where: { $0.name == name }) else { return }
        UIApplication.shared.setAlternateIconName(nil)
    }
}
