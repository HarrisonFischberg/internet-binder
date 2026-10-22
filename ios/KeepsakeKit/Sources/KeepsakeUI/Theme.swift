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

    /// The styles someone can pick (Settings → Appearance), Pantry Pop first. Gallery is retired on
    /// iOS: it is no longer offered, and a saved "gallery" falls back to Pantry Pop like other old ids.
    public static let all: [(id: String, name: String, theme: KSTheme)] = [pantry, notebook, atlas, swiss].map { ($0.style.rawValue, $0.name, $0) }
    /// A saved id, including the retired Gallery, Postcard, Linen and Ink (all now Pantry Pop).
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
    /// The screen's big title (in `theme`, or the style in use).
    public static func display(_ theme: KSTheme? = nil) -> Font {
        switch (theme ?? KSTheme.current).style {
        case .pantry: bricolage(.largeTitle, display: true)
        case .notebook: .system(.largeTitle, design: .serif).weight(.semibold)
        case .gallery: .system(size: 40, weight: .regular, design: .serif)
        case .atlas: .system(.largeTitle).weight(.bold)
        case .swiss: .system(.largeTitle).weight(.bold).width(.condensed)
        }
    }
    /// A save's or a group's name.
    public static func name(_ style: Font.TextStyle = .title3, _ theme: KSTheme? = nil) -> Font {
        switch (theme ?? KSTheme.current).style {
        case .pantry: bricolage(style, display: style == .title || style == .title2 || style == .largeTitle)
        case .notebook: .system(style, design: .serif).weight(.semibold)
        case .gallery: .system(style, design: .serif)
        case .atlas: .system(style).weight(.semibold)
        case .swiss: .system(style).weight(.bold)
        }
    }
    public static var fact: Font { fact(nil) }
    public static func fact(_ theme: KSTheme?) -> Font { .system(.footnote, design: (theme ?? KSTheme.current).bodyDesign) }
    /// Kind labels and small captions.
    public static var label: Font { label(nil) }
    public static func label(_ theme: KSTheme?) -> Font {
        switch (theme ?? KSTheme.current).style {
        case .pantry: .system(.caption, design: .rounded).weight(.heavy)
        case .notebook, .atlas: .system(.caption2, design: .monospaced).weight(.medium)
        case .gallery: .caption
        case .swiss: .caption.weight(.semibold)
        }
    }
    /// A quiet line: a note, a subtitle.
    public static var note: Font {
        switch KSTheme.current.style {
        case .notebook, .gallery: .system(.subheadline, design: .serif).italic()
        default: .system(.subheadline, design: KSTheme.current.bodyDesign)
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

/// The page everything rests on, drawn in each style's own material. It stays put while the tiles
/// scroll over it. The top of every page is the plain table colour, so the status-bar scrim and the
/// solid navigation bars meet it without a seam; the style shows lower down, behind the tiles.
/// With Increase Contrast on, the page is plain.
public struct TableBackground: View {
    public init() {}
    public var body: some View {
        TablePatch().ignoresSafeArea()
    }
}

/// A piece of the page for a bar or pinned header to stand on: the same material as the page behind
/// it, lined up with it, so a docked bar hides the tiles under it without leaving a flat plate.
/// Every page and patch is a window onto one surface the size of the app's window (`ksTableFrame`).
public struct TablePatch: View {
    @Environment(\.ks) private var t
    @Environment(\.colorScheme) private var scheme
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.ksTableFrame) private var table
    public init() {}
    public var body: some View {
        ZStack {
            t.table
            if contrast != .increased && t.style != .gallery {
                GeometryReader { g in
                    let f = g.frame(in: .global), page = table ?? f
                    TableSurface(style: t.style, dark: scheme == .dark, t: t)
                        .frame(width: page.width, height: page.height)
                        .offset(x: page.minX - f.minX, y: page.minY - f.minY)
                }
                .clipped()
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The whole page's material. Plain for the first 100 points, under the status bar and its scrim
/// (TopScrim, about 86 points), then fading in over the next 180.
private struct TableSurface: View {
    let style: KSTheme.Style, dark: Bool, t: KSTheme
    var body: some View {
        Group {
            switch style {
            case .pantry: PantryShelf(dark: dark)
            case .notebook: GraphPaper(dark: dark, color: t.accent)
            case .atlas: AtlasChart(dark: dark, line: t.rule)
            case .swiss: SwissGrid(dark: dark, ink: t.ink, red: t.accent)
            case .gallery: EmptyView()
            }
        }
        .mask {
            GeometryReader { g in
                let h = max(g.size.height, 1)
                LinearGradient(stops: [.init(color: .clear, location: min(1, 100 / h)), .init(color: .black, location: min(1, 280 / h))],
                               startPoint: .top, endPoint: .bottom)
            }
        }
    }
}

private struct TableFrameKey: EnvironmentKey { static let defaultValue: CGRect? = nil }
extension EnvironmentValues {
    /// Where the app's whole window sits (global coordinates), so every page and bar draws its part
    /// of one table. Set by `keepsakeAppearance`; without it a patch draws a page of its own size.
    public var ksTableFrame: CGRect? {
        get { self[TableFrameKey.self] }
        set { self[TableFrameKey.self] = newValue }
    }
}

/// Measures the root view, safe areas included, for `ksTableFrame`.
private struct TableFrameReader: ViewModifier {
    @State private var frame: CGRect?
    func body(content: Content) -> some View {
        content
            .environment(\.ksTableFrame, frame)
            .background {
                Color.clear.ignoresSafeArea()
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { frame = $0 }
            }
    }
}

/// A soft glow, `radius` a fraction of the page's longer side, placed by unit point on the page.
private struct Glow: View {
    let color: Color, at: UnitPoint, radius: CGFloat
    var body: some View {
        GeometryReader { g in
            let r = radius * max(g.size.width, g.size.height)
            RadialGradient(colors: [color, color.opacity(0)], center: at, startRadius: 0, endRadius: r)
        }
    }
}

/// Pantry Pop: a sunny shelf. Warm light pooling up from the bottom in the jar colours (mustard,
/// tomato, teal) and a halftone that grows as it nears the shelf, like a printed label.
struct PantryShelf: View {
    let dark: Bool
    var body: some View {
        let mustard = Color(uiColor: UIColor(hex: 0xFFC23D)), tomato = Color(uiColor: UIColor(hex: 0xFF5A36)), teal = Color(uiColor: UIColor(hex: 0x12A08F))
        ZStack {
            Glow(color: mustard.opacity(dark ? 0.09 : 0.34), at: UnitPoint(x: 1.05, y: 0.62), radius: 0.62)
            Glow(color: tomato.opacity(dark ? 0.10 : 0.16), at: UnitPoint(x: -0.1, y: 1.0), radius: 0.6)
            Glow(color: teal.opacity(dark ? 0.08 : 0.08), at: UnitPoint(x: 0.85, y: 1.12), radius: 0.4)
            Canvas { ctx, size in
                let step: CGFloat = 14
                let ink = dark ? Color(uiColor: UIColor(hex: 0xFFF7E8)).opacity(0.07) : Color(uiColor: UIColor(hex: 0x16130F)).opacity(0.075)
                var dots = Path()
                var row = 0
                for y in stride(from: size.height * 0.3, through: size.height + step, by: step) {
                    // 0 at a third of the way down, full by the bottom.
                    let k = min(1, max(0, (y - size.height * 0.3) / (size.height * 0.7)))
                    let r = 0.3 + 1.7 * k
                    let shift = row.isMultiple(of: 2) ? 0 : step / 2
                    for x in stride(from: shift, through: size.width + step, by: step) {
                        dots.addEllipse(in: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
                    }
                    row += 1
                }
                ctx.fill(dots, with: .color(ink))
            }
        }
    }
}

/// Field Notebook: graph paper with a heavier line every fifth square, the paper slightly warmer
/// and darker towards its edges, like a page that has been carried around.
struct GraphPaper: View {
    let dark: Bool
    let color: Color
    var body: some View {
        ZStack {
            Canvas { ctx, size in
                let cell: CGFloat = 24
                var minor = Path(), major = Path()
                for (i, x) in stride(from: CGFloat(0), through: size.width, by: cell).enumerated() {
                    var p = i % 5 == 0 ? major : minor
                    p.move(to: CGPoint(x: x, y: 0)); p.addLine(to: CGPoint(x: x, y: size.height))
                    if i % 5 == 0 { major = p } else { minor = p }
                }
                for (i, y) in stride(from: CGFloat(0), through: size.height, by: cell).enumerated() {
                    var p = i % 5 == 0 ? major : minor
                    p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: size.width, y: y))
                    if i % 5 == 0 { major = p } else { minor = p }
                }
                ctx.stroke(minor, with: .color(color.opacity(0.06)), lineWidth: 1)
                ctx.stroke(major, with: .color(color.opacity(dark ? 0.10 : 0.11)), lineWidth: 1)
            }
            // A warm vignette: the middle of the page stays clean.
            EllipticalGradient(colors: [.clear, Color(uiColor: UIColor(hex: dark ? 0x000000 : 0x8A6A3A)).opacity(dark ? 0.32 : 0.07)],
                               center: UnitPoint(x: 0.5, y: 0.42), startRadiusFraction: 0.35, endRadiusFraction: 0.8)
            // Late afternoon light on the lower page.
            LinearGradient(colors: [.clear, Color(uiColor: UIColor(hex: dark ? 0xE9CF52 : 0xF2D57A)).opacity(dark ? 0.05 : 0.16)],
                           startPoint: UnitPoint(x: 0.5, y: 0.35), endPoint: .bottom)
        }
    }
}

/// Night Atlas: a chart of the night sky. An amber lamp low on the page, deep water below, the
/// graticule of a globe rising from the corner and, after dark, a scatter of stars. Its light
/// mode, Dawn, warms the lower page instead and keeps only the globe.
struct AtlasChart: View {
    let dark: Bool
    let line: Color
    var body: some View {
        let amber = Color(uiColor: UIColor(hex: dark ? 0xFFB547 : 0xFF9A3D)), sea = Color(uiColor: UIColor(hex: dark ? 0x2E6B7A : 0x7FA7B5))
        ZStack {
            LinearGradient(colors: [.clear, Color(uiColor: UIColor(hex: dark ? 0x05070C : 0xE6ECEF)).opacity(dark ? 0.7 : 0.9)],
                           startPoint: UnitPoint(x: 0.5, y: 0.25), endPoint: .bottom)
            Glow(color: amber.opacity(dark ? 0.15 : 0.22), at: UnitPoint(x: 0.0, y: 0.55), radius: 0.55)
            Glow(color: sea.opacity(dark ? 0.22 : 0.2), at: UnitPoint(x: 1.0, y: 1.05), radius: 0.6)
            Canvas { ctx, size in
                // Stars: a fixed scatter, so they don't move between screens.
                if dark {
                    var seed: UInt64 = 0x5EED
                    func next() -> CGFloat { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return CGFloat(seed >> 33) / CGFloat(1 << 31) }
                    for _ in 0..<Int(size.width * size.height / 5200) {
                        let x = next() * size.width, y = next() * size.height, r = 0.4 + next() * 0.8, a = 0.12 + next() * 0.3
                        ctx.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)), with: .color(.white.opacity(a)))
                    }
                }
                // A globe in the lower corner: parallels and meridians.
                let c = CGPoint(x: size.width * 0.92, y: size.height * 1.02), R = max(size.width, size.height * 0.5) * 0.95
                var g = Path()
                g.addEllipse(in: CGRect(x: c.x - R, y: c.y - R, width: R * 2, height: R * 2))
                for f in stride(from: 0.2, through: 0.8, by: 0.2) {
                    g.addEllipse(in: CGRect(x: c.x - R * f, y: c.y - R, width: R * 2 * f, height: R * 2))
                }
                for f in stride(from: -0.75, through: 0.75, by: 0.25) where f != 0 {
                    let y = c.y + R * f, half = R * (1 - f * f).squareRoot()
                    g.move(to: CGPoint(x: c.x - half, y: y)); g.addLine(to: CGPoint(x: c.x + half, y: y))
                }
                g.move(to: CGPoint(x: c.x - R, y: c.y)); g.addLine(to: CGPoint(x: c.x + R, y: c.y))
                ctx.stroke(g, with: .color(line.opacity(dark ? 0.9 : 0.75)), lineWidth: 1)
            }
        }
    }
}

/// Swiss Index: the grid the tiles are set on, shown as column hairlines, and one red disc, the
/// poster's single colour, low in the corner.
struct SwissGrid: View {
    let dark: Bool
    let ink: Color, red: Color
    var body: some View {
        Canvas { ctx, size in
            let margin: CGFloat = 18, cols = size.width > 700 ? 8 : 4
            var p = Path()
            for i in 0...cols {
                let x = (margin + CGFloat(i) * (size.width - margin * 2) / CGFloat(cols)).rounded() + 0.5
                p.move(to: CGPoint(x: x, y: 0)); p.addLine(to: CGPoint(x: x, y: size.height))
            }
            ctx.stroke(p, with: .color(ink.opacity(dark ? 0.08 : 0.07)), lineWidth: 1)
            // Small and pale, tucked into the corner: red is the colour for actions, so the disc
            // stays a mark rather than a second red block behind them.
            let r = min(size.width, size.height) * 0.34
            let c = CGPoint(x: size.width - r * 0.45, y: size.height - r * 0.75)
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(red.opacity(dark ? 0.1 : 0.07)))
        }
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
    /// "system", "light" or "dark": the app's appearance, whatever the device is set to.
    public var mode = "system"
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
        a.mode = d.string(forKey: "ks.mode") ?? a.mode
        a.cardStyle = d.string(forKey: "ks.cardStyle") ?? a.cardStyle
        a.haptics = d.object(forKey: "ks.haptics") as? Bool ?? true
        a.sound = d.object(forKey: "ks.sound") as? Bool ?? false
        return a
    }
    /// nil follows the device.
    public var colorScheme: ColorScheme? { mode == "light" ? .light : mode == "dark" ? .dark : nil }

    public func save() {
        let d = Self.defaults
        d.set(theme, forKey: "ks.theme"); d.set(mode, forKey: "ks.mode"); d.set(cardStyle, forKey: "ks.cardStyle")
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
            .preferredColorScheme(a.colorScheme)
            .modifier(TableFrameReader())
    }
}
#endif
