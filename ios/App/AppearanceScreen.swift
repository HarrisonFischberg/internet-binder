import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Appearance: choose on a live stage of your own recent saves, restyled as you turn the dial.
struct AppearanceScreen: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        @Bindable var model = model
        let a = model.appearance
        Form {
            Section {
                stage(a).listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
            Section("Style") {
                ForEach(KSTheme.all, id: \.id) { style in
                    Button {
                        Haptic.detent()
                        model.appearance.theme = style.id
                    } label: { StyleRow(theme: style.theme, chosen: a.theme == style.id) }
                    .accessibilityAddTraits(a.theme == style.id ? .isSelected : [])
                }
            }
            Section("Density") {
                Picker("Density", selection: $model.appearance.density) {
                    Text("Comfortable").tag("comfortable")
                    Text("Compact").tag("compact")
                }
                .pickerStyle(.segmented)
            }
            Section {
                Toggle("Haptics", isOn: $model.appearance.haptics)
                Toggle("Sound", isOn: $model.appearance.sound)
            } footer: { Text("Sound is a soft tick when a save lands or a stamp comes down.") }
            Section("App icon") { IconPicker() }
        }
        .navigationTitle("Appearance")
    }

    /// Two of your own saves, drawn the way you've chosen.
    private func stage(_ a: Appearance) -> some View {
        let samples = Array(model.saves.prefix(2))
        return ZStack {
            TableBackground()
            if samples.isEmpty {
                Text("Your saves will show here.").font(KSFont.note).foregroundStyle(KSTheme.named(a.theme).inkMuted)
            } else {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(samples) { SaveObject($0).frame(maxWidth: 170) }
                }
                .padding(16)
            }
        }
        .frame(height: 280)
        .clipped()
        .keepsakeAppearance(a)
        .animation(KSMotion.or(KSMotion.settle, reduce: reduce), value: a)
        .accessibilityLabel("Preview of your saves")
    }
}

/// One style in the list: its name in its own title face, a swatch of its page, card and accent.
struct StyleRow: View {
    let theme: KSTheme
    let chosen: Bool
    var body: some View {
        HStack(spacing: 14) {
            HStack(spacing: -6) {
                Circle().fill(theme.table)
                Circle().fill(theme.paper)
                Circle().fill(theme.style == .pantry ? theme.kindFill("recipe") : theme.primary)
            }
            .frame(width: 66, height: 26)
            .overlay { Capsule().strokeBorder(.secondary.opacity(0.4), lineWidth: 0.5).padding(-3) }
            .accessibilityHidden(true)
            Text(theme.name).foregroundStyle(.primary)
            Spacer()
            if chosen { Image(systemName: "checkmark").font(.body.weight(.semibold)).foregroundStyle(.tint).accessibilityHidden(true) }
        }
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

/// App icon: the felt pocket (the default; follows light, dark and tinted home screens, or always
/// light or dark), or one icon per style.
struct IconPicker: View {
    @State private var current = UIApplication.shared.alternateIconName
    private let icons: [(name: String?, label: String)] = [
        (nil, "Felt pocket"), ("AppIconLight", "Felt pocket, always light"), ("AppIconDark", "Felt pocket, always dark"),
        ("AppIconPantry", "Pantry Pop"), ("AppIconNotebook", "Field Notebook"), ("AppIconGallery", "Gallery"),
        ("AppIconAtlas", "Night Atlas"), ("AppIconSwiss", "Swiss Index"),
    ]
    var body: some View {
        ForEach(icons, id: \.label) { icon in
            Button {
                UIApplication.shared.setAlternateIconName(icon.name) { _ in current = UIApplication.shared.alternateIconName }
            } label: {
                HStack(spacing: 14) {
                    Image(icon.name.map { "\($0)Preview" } ?? "AppIconPreview").resizable().frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(.secondary.opacity(0.3), lineWidth: 0.5))
                        .accessibilityHidden(true)
                    Text(icon.label)
                    Spacer()
                    if current == icon.name { Image(systemName: "checkmark").font(.body.weight(.semibold)).accessibilityHidden(true) }
                }
            }
            .foregroundStyle(.primary)
            .accessibilityAddTraits(current == icon.name ? .isSelected : [])
        }
    }
}
