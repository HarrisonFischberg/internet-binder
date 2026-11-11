#if DEBUG
import SwiftUI
import KeepsakeKit
import KeepsakeUI

// Design exploration (branch design/explore): what the three directions share. Every colour is a
// token of the appearance in use, so each direction can be seen in Nocturne, Paper & Ink and Chromatic.

extension Save {
    var ingredientLines: [String] { details?["ingredients"]?.array?.compactMap(\.string) ?? [] }
    var stepLines: [String] { (details?["steps"]?.array?.compactMap(\.string) ?? []).filter { $0.contains(where: { $0.isLetter || $0.isNumber }) } }
    /// "35 min", "4 servings", "North African": what the page said about the recipe.
    var recipeFacts: [(label: String, value: String)] {
        var out: [(String, String)] = []
        if let m = details?["totalMinutes"]?.number, m > 0 { out.append(("Time", "\(Int(m)) min")) }
        if let y = details?["yield"]?.string, !y.isEmpty { out.append(("Makes", y)) }
        if let c = details?["cuisine"]?.string, !c.isEmpty { out.append(("Cuisine", c)) }
        return out
    }
    var isDone: Bool { status == "done" || purchased == true }
    var needsFiling: Bool { needsCollection && purchased != true }
}

/// A save's picture at a fixed size.
struct DesignThumb: View {
    let save: Save
    let width: CGFloat?
    let height: CGFloat
    var radius: CGFloat = 8
    var body: some View {
        SaveImage(save, symbolSize: min(height * 0.4, 30))
            .frame(width: width, height: height).frame(maxWidth: width == nil ? .infinity : nil)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// Appearance and Settings, as Home's header has them; `glass` floats them, otherwise they are plain marks.
struct DesignHeaderButtons: View {
    var glass = true
    @Environment(\.ks) private var t
    @State private var settings = false
    @State private var appearance = false
    var body: some View {
        HStack(spacing: glass ? 10 : 0) {
            button("paintpalette", "Appearance") { appearance = true }
            button("gearshape", "Settings") { settings = true }
        }
        .sheet(isPresented: $settings) { SettingsScreen() }
        .sheet(isPresented: $appearance) { AppearanceSheet() }
    }
    private func button(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            if glass { GlassIcon(symbol) } else {
                Image(systemName: symbol).font(.body.weight(.semibold)).foregroundStyle(t.ink).frame(width: 44, height: 44).contentShape(Rectangle())
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// "File them": the one filled control on Home while saves wait for a collection.
struct DesignFileButton: View {
    @Environment(\.ks) private var t
    var body: some View {
        Text("File them").font(.subheadline.weight(.semibold))
            .foregroundStyle(t.onHighlight)
            .padding(.horizontal, 14).frame(minHeight: 36)
            .background(t.highlight, in: Capsule())
    }
}

/// The recipe page's docked action, as the shipping page docks it.
struct DesignDock: View {
    let save: Save
    @State private var cooking = false
    @Environment(LibraryModel.self) private var model
    var body: some View {
        PrimarySlab("Start cooking", symbol: "flame.fill", kind: "recipe") { cooking = true }
            .dynamicTypeSize(...DynamicTypeSize.large)
            .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 8)
            .fullScreenCover(isPresented: $cooking) {
                CookingView(save: save, steps: save.stepLines, ingredients: save.ingredientLines) {
                    Task { await model.setDone(save, true) }
                    model.celebrate("Cooked!")
                }
            }
    }
}

/// The recipe page's More menu (the actions that need no sheet of their own).
struct DesignMoreMenu: View {
    let save: Save
    @Environment(LibraryModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        if save.url != nil { Button("Share", systemImage: "square.and.arrow.up") { SaveSharing.present(save) } }
        Button(save.isDone ? "Mark not cooked" : "Mark cooked", systemImage: "checkmark") { Task { await model.setDone(save, !save.isDone) } }
        Button("Move to Trash", systemImage: "trash", role: .destructive) { Task { await model.trash(save); dismiss() } }
    }
}
#endif
