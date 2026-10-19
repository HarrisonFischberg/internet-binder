//
//  ViewController.swift
//  Keepsake
//
//  The Mac app's one window: whether Keepsake is on in Safari, how to turn it on, and the app icon.
//  Drawn in Pantry Pop (cream shelf, ink outlines, hard shadows), natively, with Safari's own settings
//  one button away.
//

import Cocoa
import SafariServices
import SwiftUI
import CoreText

let extensionBundleIdentifier = "com.harrisonfischberg.keepsake.Extension"

class ViewController: NSViewController {
    override func loadView() {
        let host = NSHostingView(rootView: ContainerView())
        host.frame.size = host.fittingSize   // the window fits its content
        view = host
    }

    #if DEBUG
    /// Screenshots: -snapshot <path.png> draws the window's content to a file (a bare name goes in the
    /// app's temporary folder) and quits.
    override func viewDidAppear() {
        super.viewDidAppear()
        guard let path = UserDefaults.standard.string(forKey: "snapshot") else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            guard let content = self.view.window?.contentView, let rep = content.bitmapImageRepForCachingDisplay(in: content.bounds) else { return }
            content.cacheDisplay(in: content.bounds, to: rep)
            let url = path.hasPrefix("/") ? URL(fileURLWithPath: path) : FileManager.default.temporaryDirectory.appendingPathComponent(path)
            try? rep.representation(using: .png, properties: [:])?.write(to: url)
            NSApplication.shared.terminate(nil)
        }
    }
    #endif
}

// MARK: - The window

@MainActor @Observable
final class ExtensionStatus {
    enum State { case checking, on, off, unknown }
    var state: State = .checking

    func refresh() {
        #if DEBUG
        // Screenshots: -extensionState on|off|unknown shows that state without asking Safari.
        if let forced = UserDefaults.standard.string(forKey: "extensionState") {
            state = forced == "on" ? .on : forced == "off" ? .off : .unknown
            return
        }
        #endif
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            Task { @MainActor in
                if let state, error == nil { self.state = state.isEnabled ? .on : .off } else { self.state = .unknown }
            }
        }
    }

    func openSafariSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in }
    }
}

struct ContainerView: View {
    @State private var status = ExtensionStatus()
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .center, spacing: 16) {
                Image(AppIcon.current.asset).resizable().frame(width: 76, height: 76)
                    .rotationEffect(.degrees(-4))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Keepsake").font(Pantry.title(38)).foregroundStyle(Pantry.ink)
                        .accessibilityAddTraits(.isHeader)
                    statusSticker
                }
            }
            Text(message).font(.system(.body, design: .rounded)).foregroundStyle(Pantry.ink)
                .fixedSize(horizontal: false, vertical: true)
            if status.state != .on { steps }
            Button { status.openSafariSettings() } label: {
                Label("Open Safari Settings", systemImage: "safari")
                    .font(.system(.headline, design: .rounded).weight(.heavy))
                    .foregroundStyle(Pantry.onPrimary)
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(ChunkyStyle(fill: Pantry.primary))
            .keyboardShortcut(.defaultAction)
            IconChooser()
        }
        .padding(28)
        .frame(width: 460)
        .background(Pantry.bg)
        .onAppear { status.refresh() }
        // Turning it on happens in Safari: check again when the window comes back to the front.
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in status.refresh() }
    }

    private var message: String {
        switch status.state {
        case .checking: "Checking Safari…"
        case .on: "Keepsake is ready. Click its button in Safari's toolbar, or press ⌥⇧K, to save the page you're on. Everything stays on this Mac."
        case .off: "Keepsake is installed but turned off in Safari."
        case .unknown: "Keepsake couldn't tell whether Safari has it turned on. Open Safari Settings and look under Extensions."
        }
    }

    private var statusSticker: some View {
        let (text, fill, symbol): (String, Color, String) = switch status.state {
        case .on: ("On in Safari", Pantry.lime, "checkmark")
        case .off: ("Off in Safari", Pantry.tomato, "xmark")
        case .checking: ("Checking", Pantry.mustard, "ellipsis")
        case .unknown: ("Not sure", Pantry.mustard, "questionmark")
        }
        return Label(text, systemImage: symbol)
            .font(.system(.callout, design: .rounded).weight(.heavy))
            .foregroundStyle(Pantry.onKind)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(fill, in: Capsule())
            .overlay(Capsule().strokeBorder(Pantry.onKind, lineWidth: 2))
            .compositingGroup()
            .shadow(color: Pantry.onKind, radius: 0, x: 2, y: 2)
            .accessibilityLabel("Keepsake is \(text.lowercased())")
    }

    private var steps: some View {
        VStack(alignment: .leading, spacing: 10) {
            step(1, "Open Safari Settings")
            step(2, "Choose Extensions, then turn on Keepsake")
            step(3, "Save from Keepsake's button in the toolbar")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .chunkySurface(Pantry.card)
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(spacing: 12) {
            Text("\(n)").font(.system(.callout, design: .rounded).weight(.heavy)).foregroundStyle(Pantry.onKind)
                .frame(width: 26, height: 26).background(Pantry.mustard, in: Circle())
                .overlay(Circle().strokeBorder(Pantry.onKind, lineWidth: 1.5))
                .accessibilityHidden(true)
            Text(text).font(.system(.body, design: .rounded).weight(.semibold)).foregroundStyle(Pantry.ink)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Step \(n): \(text)")
    }
}

/// App icon: one per style. macOS keeps an app's icon in its bundle, so this changes the Dock icon
/// while Keepsake is open; Finder and Launchpad keep Pantry Pop.
struct IconChooser: View {
    @State private var chosen = AppIcon.current
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("App icon").font(.system(.headline, design: .rounded).weight(.heavy)).foregroundStyle(Pantry.ink)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 8) {
                ForEach(AppIcon.allCases) { icon in
                    Button {
                        chosen = icon
                        icon.apply()
                    } label: {
                        Image(icon.asset).resizable().frame(width: 52, height: 52)
                            .padding(3)
                            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(chosen == icon ? Pantry.line : .clear, lineWidth: 2.5))
                    }
                    .buttonStyle(.plain)
                    .help(icon.label)
                    .accessibilityLabel(icon.label)
                    .accessibilityAddTraits(chosen == icon ? .isSelected : [])
                }
            }
            Text("Shows in the Dock while Keepsake is open.").font(.system(.footnote, design: .rounded)).foregroundStyle(Pantry.muted)
        }
    }
}

enum AppIcon: String, CaseIterable, Identifiable {
    case pantry, notebook, gallery, atlas, swiss
    var id: String { rawValue }
    var asset: String { "Icon-\(rawValue)" }
    var label: String {
        switch self {
        case .pantry: "Pantry Pop"; case .notebook: "Field Notebook"
        case .gallery: "Gallery"; case .atlas: "Night Atlas"; case .swiss: "Swiss Index"
        }
    }
    /// Pantry Pop is the bundle's own icon; a saved "pocket" (now gone) lands on it too.
    static var current: AppIcon { AppIcon(rawValue: UserDefaults.standard.string(forKey: "appIcon") ?? "") ?? .pantry }

    @MainActor func apply() {
        UserDefaults.standard.set(rawValue, forKey: "appIcon")
        // nil puts back the bundle's own icon (Pantry Pop).
        NSApplication.shared.applicationIconImage = self == .pantry ? nil : NSImage(named: asset)
    }
}

// MARK: - Pantry Pop on the Mac (replica/design/tokens/pantry.*.json)

enum Pantry {
    static func dyn(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .hex(dark) : .hex(light) })
    }
    static let bg = dyn(0xFFF7E8, 0x1B1A17)
    static let card = dyn(0xFFFFFF, 0x26241F)
    static let ink = dyn(0x16130F, 0xFFF7E8)
    static let muted = dyn(0x5B5348, 0xCFC6B4)
    static let line = dyn(0x16130F, 0xFFF7E8)
    static let shadow = dyn(0x16130F, 0x000000)
    static let primary = dyn(0x16130F, 0xFFC23D)
    static let onPrimary = dyn(0xFFF7E8, 0x16130F)
    static let onKind = Color(nsColor: .hex(0x16130F))
    static let mustard = Color(nsColor: .hex(0xFFC23D))
    static let tomato = Color(nsColor: .hex(0xFF5A36))
    static let lime = Color(nsColor: .hex(0x9BD13B))

    /// Bricolage Grotesque ExtraBold, from the Safari extension's own fonts (OFL); SF Pro Rounded
    /// Heavy if it can't be loaded.
    static func title(_ size: CGFloat) -> Font {
        registered ? .custom("BricolageGrotesque96ptExtraBold-Regular_ExtraBold", size: size) : .system(size: size, weight: .heavy, design: .rounded)
    }
    static let registered: Bool = {
        guard let url = Bundle.main.builtInPlugInsURL?
            .appendingPathComponent("Keepsake Extension.appex/Contents/Resources/fonts/BricolageGrotesque-400-800.woff2"),
              FileManager.default.fileExists(atPath: url.path) else { return false }
        return CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }()
}

extension NSColor {
    static func hex(_ v: UInt32) -> NSColor {
        NSColor(srgbRed: CGFloat((v >> 16) & 0xFF) / 255, green: CGFloat((v >> 8) & 0xFF) / 255, blue: CGFloat(v & 0xFF) / 255, alpha: 1)
    }
}

/// A chunky button: ink outline, hard shadow that collapses when pressed.
struct ChunkyStyle: ButtonStyle {
    let fill: Color
    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        configuration.label
            .background(fill, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Pantry.line, lineWidth: 2.5))
            .offset(x: pressed ? 4 : 0, y: pressed ? 4 : 0)
            .compositingGroup()
            .shadow(color: Pantry.shadow, radius: 0, x: pressed ? 0 : 4, y: pressed ? 0 : 4)
            .animation(.spring(response: 0.2, dampingFraction: 0.7), value: pressed)
    }
}

extension View {
    func chunkySurface(_ fill: Color) -> some View {
        background(fill, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Pantry.line, lineWidth: 2.5))
            .compositingGroup()
            .shadow(color: Pantry.shadow, radius: 0, x: 4, y: 4)
    }
}
