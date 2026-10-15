#if canImport(UIKit)
import SwiftUI
import UIKit

/// Keepsake's look: saves are drawn as the objects of their kind on a warm table; controls stay quiet
/// and native so the objects are the only ornament (D14). Colours come from
/// replica/m3/tokens/postcard.*.json and pass WCAG AA in light and dark (make_tokens.py).
public struct KSTheme: Sendable {
    public let table: Color, paper: Color, well: Color, ink: Color, inkMuted: Color
    public let accent: Color, onAccent: Color, stamp: Color, rule: Color

    private static func dyn(_ l: UInt32, _ d: UInt32) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: d) : UIColor(hex: l) })
    }

    public static let postcard = KSTheme(
        table: dyn(0xEDE6DA, 0x15130F), paper: dyn(0xFBF8F2, 0x24211C), well: dyn(0xE4DCCD, 0x1D1A16),
        ink: dyn(0x1E1C19, 0xF1ECE3), inkMuted: dyn(0x5C554B, 0xAEA698), accent: dyn(0x24439A, 0x9AB0F2),
        onAccent: dyn(0xFFFFFF, 0x0E1630), stamp: dyn(0xA8342A, 0xF08E7E),
        rule: Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: 0.16) : UIColor(white: 0, alpha: 0.12) }))

    public static let linen = KSTheme(
        table: dyn(0xE6E9E3, 0x121513), paper: dyn(0xF8F9F6, 0x1D211E), well: dyn(0xDCE0D9, 0x181B19),
        ink: dyn(0x1A1F1B, 0xE9EDE8), inkMuted: dyn(0x4F5750, 0xA3ACA4), accent: dyn(0x3F5B45, 0xA9C4AE),
        onAccent: dyn(0xFFFFFF, 0x102014), stamp: dyn(0xA8342A, 0xF08E7E),
        rule: Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: 0.16) : UIColor(white: 0, alpha: 0.12) }))

    public static let ink = KSTheme(
        table: dyn(0xF4F4F2, 0x0B0B0B), paper: dyn(0xFFFFFF, 0x171717), well: dyn(0xEAEAE7, 0x121212),
        ink: dyn(0x111111, 0xF2F2F2), inkMuted: dyn(0x5A5A5A, 0xA3A3A3), accent: dyn(0x111111, 0xF2F2F2),
        onAccent: dyn(0xFFFFFF, 0x0B0B0B), stamp: dyn(0xA8342A, 0xF08E7E),
        rule: Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: 0.18) : UIColor(white: 0, alpha: 0.14) }))

    /// The themes someone can pick (Settings → Appearance), with their names.
    public static let all: [(id: String, name: String, theme: KSTheme)] = [("postcard", "Postcard", .postcard), ("linen", "Linen", .linen), ("ink", "Ink", .ink)]
    public static func named(_ id: String) -> KSTheme { all.first { $0.id == id }?.theme ?? .postcard }

    public func kind(_ k: String) -> Color { KindStyle(k).color }

    /// For system controls that always draw a white glyph (PasteButton): the light-mode accent in both
    /// modes, so the glyph keeps its contrast in dark mode too.
    public var accentForWhiteGlyph: Color { Color(uiColor: accentUI.resolvedColor(with: UITraitCollection(userInterfaceStyle: .light))) }
    private var accentUI: UIColor { UIColor(accent) }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

private struct ThemeKey: EnvironmentKey { static let defaultValue = KSTheme.postcard }
extension EnvironmentValues {
    public var ks: KSTheme {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}

/// Type: names in New York (the system serif), everything you read or tap in SF. All text styles scale
/// with Dynamic Type.
public enum KSFont {
    public static func name(_ style: Font.TextStyle = .title3) -> Font { .system(style, design: .serif).weight(.semibold) }
    public static func display() -> Font { .system(.largeTitle, design: .serif).weight(.semibold) }
    public static let fact = Font.footnote
    public static let label = Font.caption.weight(.medium)
    public static let note = Font.system(.subheadline, design: .serif).italic()
}

/// The kinds of save (kinds.js), with their Postcard colour and symbol.
public struct KindStyle: Sendable {
    public let kind: String
    public init(_ kind: String) { self.kind = kind }

    public var label: String {
        switch kind {
        case "place": "Place"; case "recipe": "Recipe"; case "media": "Film or show"; case "book": "Book"
        case "product": "Product"; case "video": "Video"; case "article": "Article"; case "workout": "Workout"
        default: "Link"
        }
    }
    /// kinds.js KINDS: the view's name and the verb for done.
    public var plural: String {
        switch kind {
        case "place": "Places"; case "recipe": "Recipes"; case "media": "Films & shows"; case "book": "Books"
        case "product": "Products"; case "video": "Videos"; case "article": "Articles"; case "workout": "Workouts"
        default: "Links"
        }
    }
    public var doneVerb: String {
        switch kind {
        case "product": "Bought"; case "place": "Been"; case "recipe": "Cooked"; case "video", "media": "Watched"
        case "article", "book": "Read"; case "workout": "Finished"; default: "Done"
        }
    }
    public static let lifestyle = ["place", "recipe", "workout", "video", "article", "media", "book"]

    public var symbol: String {
        switch kind {
        case "place": "mappin.and.ellipse"; case "recipe": "fork.knife"; case "media": "film"; case "book": "book"
        case "product": "bag"; case "video": "play.rectangle"; case "article": "doc.text"
        case "workout": "figure.strengthtraining.traditional"; default: "link"
        }
    }
    public var color: Color {
        func dyn(_ l: UInt32, _ d: UInt32) -> Color { Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: d) : UIColor(hex: l) }) }
        return switch kind {
        case "place": dyn(0xA8342A, 0xF08E7E); case "recipe": dyn(0x4A6E12, 0xA9D46A); case "media": dyn(0x4F3DBF, 0xADA2FF)
        case "book": dyn(0x7E4519, 0xE3A878); case "product": dyn(0x8C5300, 0xF0B45A); case "video": dyn(0x8E1D9C, 0xE59CF0)
        case "article": dyn(0x1D5AA8, 0x8DB8FF); case "workout": dyn(0x0C6E69, 0x5FD3CB); default: dyn(0x5C554B, 0xAEA698)
        }
    }
}

/// The table everything rests on: warm paper with a faint grain (gone with Reduce Transparency).
public struct TableBackground: View {
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceTransparency) private var reduce
    public init() {}
    public var body: some View {
        ZStack {
            t.table
            if !reduce { Grain().opacity(0.06).blendMode(.multiply) }
        }
        .ignoresSafeArea()
    }
}

struct Grain: View {
    var body: some View {
        Canvas { ctx, size in
            var state: UInt64 = 7
            func next() -> UInt64 { state &+= 0x9E3779B97F4A7C15; var z = state; z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9; z = (z ^ (z >> 27)) &* 0x94D049BB133111EB; return z ^ (z >> 31) }
            for _ in 0..<Int(size.width * size.height / 18) {
                let x = Double(next() % 10_000) / 10_000 * size.width
                let y = Double(next() % 10_000) / 10_000 * size.height
                ctx.fill(Path(CGRect(x: x, y: y, width: 1, height: 1)), with: .color(white: Double(next() % 100) / 100))
            }
        }
        .allowsHitTesting(false)
        .drawingGroup()
    }
}

extension View {
    /// An object resting on the table: a tight contact shadow and a soft ambient one, lit from the top left.
    public func resting() -> some View {
        self
            .shadow(color: .black.opacity(0.14), radius: 0.8, x: 0.4, y: 1)
            .shadow(color: .black.opacity(0.10), radius: 10, x: 2, y: 7)
    }
}
#endif

#if canImport(UIKit)
/// How someone likes Keepsake to look and feel. Kept in the App Group, so the Share Extension and the
/// widgets match the app. Device settings: never synced, never exported.
public struct Appearance: Sendable, Equatable {
    public var theme = "postcard"
    /// "comfortable" (objects in masonry) or "compact" (an even grid, more on screen).
    public var density = "comfortable"
    /// "objects" (each kind its object) or "plain" (simple cards).
    public var cardStyle = "objects"
    public var haptics = true
    public var sound = false
    public init() {}

    nonisolated(unsafe) public static let defaults = UserDefaults(suiteName: "group.com.harrisonfischberg.keepsake") ?? .standard
    public static func load() -> Appearance {
        let d = defaults
        var a = Appearance()
        a.theme = d.string(forKey: "ks.theme") ?? a.theme
        a.density = d.string(forKey: "ks.density") ?? a.density
        a.cardStyle = d.string(forKey: "ks.cardStyle") ?? a.cardStyle
        a.haptics = d.object(forKey: "ks.haptics") as? Bool ?? true
        a.sound = d.object(forKey: "ks.sound") as? Bool ?? false
        return a
    }
    public func save() {
        let d = Self.defaults
        d.set(theme, forKey: "ks.theme"); d.set(density, forKey: "ks.density"); d.set(cardStyle, forKey: "ks.cardStyle")
        d.set(haptics, forKey: "ks.haptics"); d.set(sound, forKey: "ks.sound")
    }
}

private struct AppearanceKey: EnvironmentKey { static let defaultValue = Appearance() }
extension EnvironmentValues {
    public var appearance: Appearance {
        get { self[AppearanceKey.self] }
        set { self[AppearanceKey.self] = newValue }
    }
}

extension View {
    /// Applies a whole appearance: theme, and the haptics and sound switches.
    public func keepsakeAppearance(_ a: Appearance) -> some View {
        Haptic.enabled = a.haptics
        Haptic.sound = a.sound
        return self.environment(\.ks, KSTheme.named(a.theme)).environment(\.appearance, a).tint(KSTheme.named(a.theme).accent)
    }
}
#endif
