import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Appearance: choose on a live stage of your own recent saves, restyled as you turn the dial.
struct AppearanceScreen: View {
    @Environment(LibraryModel.self) private var model

    var body: some View {
        @Bindable var model = model
        let a = model.appearance
        Form {
            Section {
                stage(a).listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
            }
            Section("Theme") {
                Picker("Theme", selection: $model.appearance.theme) {
                    ForEach(KSTheme.all, id: \.id) { Text($0.name).tag($0.id) }
                }
                .pickerStyle(.segmented)
                .onChange(of: a.theme) { Haptic.detent() }
            }
            Section("Cards") {
                Picker("Cards", selection: $model.appearance.cardStyle) {
                    Text("Objects").tag("objects")
                    Text("Plain").tag("plain")
                }
                .pickerStyle(.segmented)
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

    /// Three of your own saves, drawn the way you've chosen.
    private func stage(_ a: Appearance) -> some View {
        let samples = Array(model.saves.prefix(3))
        return ZStack {
            TableBackground()
            if samples.isEmpty {
                Text("Your saves will show here.").font(KSFont.note).foregroundStyle(KSTheme.named(a.theme).inkMuted)
            } else {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(samples) { SaveObject($0).frame(maxWidth: 140) }
                }
                .padding(16)
            }
        }
        .frame(height: 280)
        .clipped()
        .keepsakeAppearance(a)
        .animation(KSMotion.settle, value: a)
        .accessibilityLabel("Preview of your saves")
    }
}

/// Alternate app icons: Postcard (default), Linen, Ink.
struct IconPicker: View {
    @State private var current = UIApplication.shared.alternateIconName
    private let icons: [(name: String?, label: String)] = [(nil, "Postcard"), ("AppIconLinen", "Linen"), ("AppIconInk", "Ink")]
    var body: some View {
        ForEach(icons, id: \.label) { icon in
            Button {
                UIApplication.shared.setAlternateIconName(icon.name) { _ in current = UIApplication.shared.alternateIconName }
            } label: {
                HStack {
                    Image(icon.name.map { "\($0)Preview" } ?? "AppIconPreview").resizable().frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    Text(icon.label)
                    Spacer()
                    if current == icon.name { Image(systemName: "checkmark") }
                }
            }
            .foregroundStyle(.primary)
        }
    }
}
