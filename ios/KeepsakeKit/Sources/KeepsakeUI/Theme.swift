#if canImport(UIKit)
import SwiftUI
import UIKit
import CoreText

/// Keepsake's look: five styles, each with light and dark (impeccable-review/mockups dir1 to dir5).
/// Pantry Pop is the default. A style is colour roles, a shape (corners, outlines, depth), a type
/// voice and what a save without a picture becomes. Every text pair passes WCAG AA in both modes.
public struct KSTheme: Sendable {
    public enum Style: String, Sendable, CaseIterable { case pantry, notebook, gallery, atlas, swiss }
    /// How things sit on the page: a hard offset shadow that collapses on press (Pantry Pop), a soft
    /// contact shadow, a lifted panel, or nothing at all (hairlines do the work).
    public enum Depth: Sendable { case hard(CGFloat), soft, lifted, flat }

    public let style: Style
    public let name: String
    /// The page, cards, a recessed well, text, quiet text.
    public let table: Color, paper: Color, well: Color, ink: Color, inkMuted: Color
    /// The tint (links, toggles) and the colour that reads on it.
    public let accent: Color, onAccent: Color
    /// Marks of done-ness (Cooked, Been) and numbers in steps.
    public let stamp: Color
    /// Hairlines between rows.
    public let rule: Color
    /// Outlines of cards and controls, and the colour of their shadow.
    public let line: Color, shadow: Color
    /// The one filled button on a screen.
    public let primary: Color, onPrimary: Color
    /// What needs you (the Review nudge, the active chip): mustard, highlighter, amber or signal red.
    public let highlight: Color, onHighlight: Color
    public let radius: CGFloat
    /// Buttons and chips; `.infinity` is a capsule.
    public let controlRadius: CGFloat
    public let outline: CGFloat
    public let depth: Depth
    let kindText: [String: Color]
    let kindFills: [String: Color]
    public let onKind: Color

    static func dyn(_ l: UInt32, _ d: UInt32) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: d) : UIColor(hex: l) })
    }
    static func dynA(_ l: UInt32, _ la: CGFloat, _ d: UInt32, _ da: CGFloat) -> Color {
        Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: d).withAlphaComponent(da) : UIColor(hex: l).withAlphaComponent(la) })
    }
    static func same(_ c: UInt32) -> Color { Color(uiColor: UIColor(hex: c)) }

    /// A style's colour token (light, dark) from replica/design/tokens (StyleTokens.swift).
    private static func tok(_ style: Style, _ key: String) -> Color {
        guard let v = StyleTokens.values[style.rawValue]?[key] else { return .pink }
        return dyn(v.0, v.1)
    }
    private static let kindKeys = ["product": "product", "place": "place", "recipe": "recipe", "video": "video", "article": "article",
                                   "workout": "workout", "media": "film", "book": "book", "link": "link"]

    private static func make(_ style: Style, _ name: String, primary: Color? = nil, onPrimary: Color? = nil, highlight: Color, onHighlight: Color,
                             stamp: Color, line: Color? = nil, shadow: Color, radius: CGFloat, controlRadius: CGFloat, outline: CGFloat, depth: Depth) -> KSTheme {
        let c = { (k: String) in tok(style, k) }
        return KSTheme(
            style: style, name: name,
            table: c("bg"), paper: c("surface"), well: c("surface-2"), ink: c("text"), inkMuted: c("text-muted"),
            accent: c("accent"), onAccent: c("on-accent"), stamp: stamp, rule: c("border"), line: line ?? c("line"), shadow: shadow,
            primary: primary ?? c("accent"), onPrimary: onPrimary ?? c("on-accent"), highlight: highlight, onHighlight: onHighlight,
            radius: radius, controlRadius: controlRadius, outline: outline, depth: depth,
            kindText: kindKeys.mapValues { c("kind-\($0)") }, kindFills: kindKeys.mapValues { c("kind-\($0)-fill") }, onKind: c("on-kind-fill"))
    }

    /// Pantry Pop: labelled jars on a cream shelf. Thick ink outlines, hard shadows that squash when
    /// pressed, one saturated colour per kind, always carrying ink text.
    public static let pantry = make(.pantry, "Pantry Pop", highlight: tok(.pantry, "kind-product-fill"), onHighlight: tok(.pantry, "on-kind-fill"),
                                    stamp: tok(.pantry, "danger"), shadow: dyn(0x16130F, 0x000000),
                                    radius: 18, controlRadius: .infinity, outline: 2.5, depth: .hard(4))

    /// Field Notebook: graph paper, graphite ink, serif names, mono labels, one highlighter swipe for
    /// what matters, red pencil for stamps.
    public static let notebook = make(.notebook, "Field Notebook", highlight: tok(.notebook, "accent-soft"), onHighlight: tok(.notebook, "text"),
                                      stamp: tok(.notebook, "danger"), shadow: dynA(0x2B2A27, 0.16, 0x000000, 0.5),
                                      radius: 3, controlRadius: 10, outline: 0, depth: .soft)

    /// Gallery: white walls, photographs edge to edge, display serif titles, wall-label captions and
    /// black as the only accent.
    public static let gallery = make(.gallery, "Gallery", highlight: tok(.gallery, "accent"), onHighlight: tok(.gallery, "on-accent"),
                                     stamp: tok(.gallery, "text"), shadow: .clear,
                                     radius: 0, controlRadius: 2, outline: 0, depth: .flat)

    /// Night Atlas: a deep ink room lit by your own photos, coordinates in mono, one amber action per
    /// screen. "Dawn" is its light mode.
    public static let atlas = make(.atlas, "Night Atlas", primary: same(0xFFB547), onPrimary: same(0x1A1204), highlight: same(0xFFB547), onHighlight: same(0x1A1204),
                                   stamp: tok(.atlas, "highlight"), line: tok(.atlas, "border"), shadow: dynA(0x28220F, 0.14, 0x000000, 0.45),
                                   radius: 14, controlRadius: 12, outline: 1, depth: .lifted)

    /// Swiss Index: a strict grid, flush-left type, hairlines and one signal red for what needs you.
    public static let swiss = make(.swiss, "Swiss Index", highlight: tok(.swiss, "accent"), onHighlight: tok(.swiss, "on-accent"),
                                   stamp: tok(.swiss, "accent"), shadow: .clear,
                                   radius: 0, controlRadius: 0, outline: 1, depth: .flat)

    /// The styles someone can pick (Settings → Appearance), Pantry Pop first.
    public static let all: [(id: String, name: String, theme: KSTheme)] = [pantry, notebook, gallery, atlas, swiss].map { ($0.style.rawValue, $0.name, $0) }
    /// A saved id, including the retired Postcard, Linen and Ink (all now Pantry Pop).
    public static func named(_ id: String) -> KSTheme { all.first { $0.id == id }?.theme ?? .pantry }
    public static func canonical(_ id: String) -> String { all.contains { $0.id == id } ? id : "pantry" }

    /// The style in use, for the few things drawn outside a view's environment (fonts, kind colours).
    /// Set by `keepsakeAppearance`.
    nonisolated(unsafe) public static var current: KSTheme = .pantry

    /// A kind's colour for text and marks on the page (passes AA on `paper` and `table`).
    public func kind(_ k: String) -> Color { kindText[k] ?? inkMuted }
    /// A kind's colour as a filled block (a jar label, a sticker, a map pin); `onKind` reads on it.
    public func kindFill(_ k: String) -> Color { kindFills[k] ?? kindFills["link"] ?? ink }

    /// Labels in small uppercase mono ("RECIPE · 6 INGREDIENTS"): Field Notebook and Night Atlas.
    public var monoLabels: Bool { style == .notebook || style == .atlas }
    /// The body voice: SF Pro Rounded for Pantry Pop, SF Pro everywhere else.
    public var bodyDesign: Font.Design { style == .pantry ? .rounded : .default }

    /// For system controls that always draw a white glyph (PasteButton): a colour white reads on.
    public var accentForWhiteGlyph: Color {
        switch style {
        case .pantry, .gallery, .notebook: Color(uiColor: UIColor(hex: 0x16130F))
        case .atlas: Color(uiColor: UIColor(hex: 0x8A5200))
        case .swiss: Color(uiColor: UIColor(hex: 0xD92D20))
        }
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

private struct ThemeKey: EnvironmentKey { static let defaultValue = KSTheme.pantry }
extension EnvironmentValues {
    public var ks: KSTheme {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}

/// Type. Every face scales with Dynamic Type through text styles. Pantry Pop sets titles in
/// Bricolage Grotesque (bundled, OFL); Field Notebook and Gallery in New York; Night Atlas in SF Pro
/// Display; Swiss Index in condensed SF Pro.
public enum KSFont {
    private static var t: KSTheme { KSTheme.current }

    /// The screen's big title.
    public static func display() -> Font {
        switch t.style {
        case .pantry: bricolage(.largeTitle, display: true)
        case .notebook: .system(.largeTitle, design: .serif).weight(.semibold)
        case .gallery: .system(size: 40, weight: .regular, design: .serif)
        case .atlas: .system(.largeTitle).weight(.bold)
        case .swiss: .system(.largeTitle).weight(.bold).width(.condensed)
        }
    }
    /// A save's or a group's name.
    public static func name(_ style: Font.TextStyle = .title3) -> Font {
        switch t.style {
        case .pantry: bricolage(style, display: style == .title || style == .title2 || style == .largeTitle)
        case .notebook: .system(style, design: .serif).weight(.semibold)
        case .gallery: .system(style, design: .serif)
        case .atlas: .system(style).weight(.semibold)
        case .swiss: .system(style).weight(.bold)
        }
    }
    public static var fact: Font { .system(.footnote, design: t.bodyDesign) }
    /// Kind labels and small captions.
    public static var label: Font {
        switch t.style {
        case .pantry: .system(.caption, design: .rounded).weight(.heavy)
        case .notebook, .atlas: .system(.caption2, design: .monospaced).weight(.medium)
        case .gallery: .caption
        case .swiss: .caption.weight(.semibold)
        }
    }
    /// A quiet line: a note, a subtitle.
    public static var note: Font {
        switch t.style {
        case .notebook, .gallery: .system(.subheadline, design: .serif).italic()
        default: .system(.subheadline, design: t.bodyDesign)
        }
    }

    private static let sizes: [Font.TextStyle: CGFloat] = [.largeTitle: 36, .title: 30, .title2: 24, .title3: 21, .headline: 17,
                                                           .body: 17, .callout: 16, .subheadline: 15, .footnote: 13, .caption: 12, .caption2: 11]
    private static func bricolage(_ style: Font.TextStyle, display: Bool) -> Font {
        _ = registered
        return .custom(display ? "BricolageGrotesque-Display" : "BricolageGrotesque-Text", size: sizes[style] ?? 17, relativeTo: style)
    }

    /// The bundled faces, registered once for this process (app, Share Extension, widgets).
    public static let registered: Bool = {
        let urls = Bundle.module.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? []
        for url in urls { CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil) }
        return !urls.isEmpty
    }()
}

/// The kinds of save (kinds.js), with their colour and symbol in the current style.
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
    /// For text and marks on the page.
    public var color: Color { KSTheme.current.kind(kind) }
    /// As a filled block; `KSTheme.onKind` reads on it.
    public var fill: Color { KSTheme.current.kindFill(kind) }
    /// A two-letter code (Swiss Index's no-picture cells).
    public var code: String {
        switch kind {
        case "product": "Pr"; case "place": "Pl"; case "recipe": "Rc"; case "video": "Vd"; case "article": "Ar"
        case "workout": "Wk"; case "media": "Fm"; case "book": "Bk"; default: "Ln"
        }
    }
}

/// The page everything rests on. Field Notebook rules it as graph paper; the others are plain.
public struct TableBackground: View {
    @Environment(\.ks) private var t
    public init() {}
    public var body: some View {
        ZStack {
            t.table
            if t.style == .notebook { GraphPaper(color: t.accent.opacity(0.08)) }
        }
        .ignoresSafeArea()
    }
}

struct GraphPaper: View {
    let color: Color
    var body: some View {
        Canvas { ctx, size in
            var p = Path()
            stride(from: 0, through: size.width, by: 24).forEach { x in p.move(to: CGPoint(x: x, y: 0)); p.addLine(to: CGPoint(x: x, y: size.height)) }
            stride(from: 0, through: size.height, by: 24).forEach { y in p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: size.width, y: y)) }
            ctx.stroke(p, with: .color(color), lineWidth: 1)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct PressedKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    /// True while the control this view is inside is held down (PressStyle sets it).
    public var ksPressed: Bool {
        get { self[PressedKey.self] }
        set { self[PressedKey.self] = newValue }
    }
}

/// Depth in the current style. Pantry Pop's hard shadow collapses while pressed: the thing moves
/// into its shadow.
struct Resting: ViewModifier {
    var scale: CGFloat = 1
    @Environment(\.ks) private var t
    @Environment(\.ksPressed) private var pressed
    func body(content: Content) -> some View {
        switch t.depth {
        case .hard(let d):
            let off = pressed ? 0 : d * scale
            content
                .offset(x: pressed ? d * scale : 0, y: pressed ? d * scale : 0)
                .compositingGroup()
                .shadow(color: t.shadow, radius: 0, x: off, y: off)
        case .soft:
            content.compositingGroup().shadow(color: t.shadow, radius: 1.5, x: 0, y: 1).shadow(color: t.shadow.opacity(0.5), radius: 8, y: 4)
        case .lifted:
            content.compositingGroup().shadow(color: t.shadow, radius: 16, y: 10)
        case .flat:
            content
        }
    }
}

/// A surface in the current style: its fill, corners, outline and depth.
struct Surface: ViewModifier {
    var fill: Color?
    var radius: CGFloat?
    var stroke: Color?
    var scale: CGFloat = 1
    var lifted = true
    @Environment(\.ks) private var t
    func body(content: Content) -> some View {
        let r = radius ?? t.radius
        let shape = RoundedRectangle(cornerRadius: r, style: .continuous)
        content
            .background(fill ?? t.paper, in: shape)
            .clipShape(shape)
            .overlay { if t.outline > 0 { shape.strokeBorder(stroke ?? t.line, lineWidth: t.outline * (t.style == .pantry ? max(scale, 0.8) : 1)) } }
            .modifier(Resting(scale: lifted ? scale : 0))
    }
}

extension View {
    /// Depth in the current style (Pantry Pop's hard shadow, a soft shadow, a lifted panel, or none).
    public func resting(_ scale: CGFloat = 1) -> some View { modifier(Resting(scale: scale)) }
    /// A card or panel in the current style: fill (paper by default), corners, outline and depth.
    public func ksSurface(_ fill: Color? = nil, radius: CGFloat? = nil, stroke: Color? = nil, scale: CGFloat = 1, lifted: Bool = true) -> some View {
        modifier(Surface(fill: fill, radius: radius, stroke: stroke, scale: scale, lifted: lifted))
    }
}
#endif

#if canImport(UIKit)
/// How someone likes Keepsake to look and feel. Kept in the App Group, so the Share Extension and the
/// widgets match the app. Device settings: never synced, never exported.
public struct Appearance: Sendable, Equatable {
    public var theme = "pantry"
    /// "comfortable" (cards in masonry) or "compact" (an even grid, more on screen).
    public var density = "comfortable"
    /// Kept for older settings; every style draws its own cards.
    public var cardStyle = "objects"
    public var haptics = true
    public var sound = false
    public init() {}

    nonisolated(unsafe) public static let defaults = UserDefaults(suiteName: "group.com.harrisonfischberg.keepsake") ?? .standard
    public static func load() -> Appearance {
        let d = defaults
        var a = Appearance()
        a.theme = KSTheme.canonical(d.string(forKey: "ks.theme") ?? a.theme)
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
    /// Applies a whole appearance: style, body voice, tint, and the haptics and sound switches.
    public func keepsakeAppearance(_ a: Appearance) -> some View {
        let theme = KSTheme.named(a.theme)
        KSTheme.current = theme
        _ = KSFont.registered
        Haptic.enabled = a.haptics
        Haptic.sound = a.sound
        return self.environment(\.ks, theme).environment(\.appearance, a).tint(theme.accent).fontDesign(theme.bodyDesign)
    }
}
#endif
