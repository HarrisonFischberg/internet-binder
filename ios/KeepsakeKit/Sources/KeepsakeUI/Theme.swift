#if canImport(UIKit)
import SwiftUI
import UIKit

/// Internet Binder's look: the brand kit's three appearances (Nocturne, Paper & Ink, Chromatic). Each
/// one is complete on its own: its palette (dark for Nocturne and Chromatic, light for Paper & Ink),
/// its type voice, its card shape and the material of the page under the cards. Nocturne is the
/// default. Every text pair passes WCAG AA (replica/design/tokens, tests/design-tokens.test.mjs).
public struct KSTheme: Sendable {
    public enum Style: String, Sendable, CaseIterable { case nocturne, paper, chromatic }
    /// How cards sit on the page: a soft contact shadow, a lifted panel, or nothing (hairlines do the work).
    public enum Depth: Sendable { case soft, lifted, flat }

    public let style: Style
    public let name: String
    /// One line on what the appearance is like (Appearance), and the line under Home's name (or nil).
    public let blurb: String
    public let tagline: String?
    /// Light or dark: each appearance is one or the other.
    public let scheme: ColorScheme
    /// The page, cards, a recessed well (chips, fields, buttons), text, quiet text.
    public let table: Color, paper: Color, well: Color, ink: Color, inkMuted: Color
    /// The interactive colour (selection, links, toggles) and the colour that reads on it.
    public let accent: Color, onAccent: Color
    /// Marks of done-ness (Cooked, Been) and numbers in steps.
    public let stamp: Color
    /// Hairlines between rows.
    public let rule: Color
    /// Outlines of cards and controls, and the colour of their shadow.
    public let line: Color, shadow: Color
    /// The one filled button on a screen.
    public let primary: Color, onPrimary: Color
    /// What needs you (the Review banner, the selected chip).
    public let highlight: Color, onHighlight: Color
    /// The two decorative colours that sort content (cyan and pink, sage and rose, pistachio and coral)
    /// and the ink that reads on them.
    public let detail: Color, onDetail: Color, alt: Color, onAlt: Color
    public let radius: CGFloat
    /// Buttons and chips; `.infinity` is a capsule.
    public let controlRadius: CGFloat
    public let outline: CGFloat
    public let depth: Depth
    let kindText: [String: Color]
    let kindFills: [String: Color]
    let kindSofts: [String: Color]
    public let onKind: Color

    static func hex(_ c: UInt32) -> Color { Color(uiColor: UIColor(hex: c)) }

    /// A style's colour token from replica/design/tokens (StyleTokens.swift).
    private static func tok(_ style: Style, _ key: String) -> Color {
        guard let v = StyleTokens.values[style.rawValue]?[key] else { return .pink }
        return hex(v)
    }
    private static let kindKeys = ["product": "product", "place": "place", "recipe": "recipe", "video": "video", "article": "article",
                                   "workout": "workout", "media": "film", "book": "book", "link": "link"]

    private static func make(_ style: Style, _ name: String, blurb: String, tagline: String?, scheme: ColorScheme, card: String, well: String,
                             stamp: String, shadow: Color, radius: CGFloat, depth: Depth) -> KSTheme {
        let c = { (k: String) in tok(style, k) }
        return KSTheme(
            style: style, name: name, blurb: blurb, tagline: tagline, scheme: scheme,
            table: c("bg"), paper: c(card), well: c(well), ink: c("text"), inkMuted: c("text-muted"),
            accent: c("accent"), onAccent: c("on-accent"), stamp: c(stamp), rule: c("border"), line: c("line"), shadow: shadow,
            primary: c("accent"), onPrimary: c("on-accent"), highlight: c("highlight"), onHighlight: c("on-accent"),
            detail: c("detail"), onDetail: c("on-detail"), alt: c("alt"), onAlt: c("on-alt"),
            radius: radius, controlRadius: .infinity, outline: 1, depth: depth,
            kindText: kindKeys.mapValues { c("kind-\($0)") }, kindFills: kindKeys.mapValues { c("kind-\($0)-fill") },
            kindSofts: kindKeys.mapValues { c("kind-\($0)-soft") }, onKind: c("on-kind-fill"))
    }

    /// Nocturne: a luminous private archive. Deep night blue, photographs carry the energy, amber for
    /// what you can touch, cyan for collection details, faint orbits drifting behind.
    public static let nocturne = make(.nocturne, "Nocturne", blurb: "A luminous private archive. Deep night blue, amber for every touch.",
                                      tagline: "Save the internet. Organize your mind.", scheme: .dark, card: "surface", well: "surface-2", stamp: "detail",
                                      shadow: .black.opacity(0.45), radius: 20, depth: .lifted)

    /// Paper & Ink: a personal internet, beautifully kept. Espresso serif headings on cream, clean sans
    /// controls, sage and rose shelves, warm light moving slowly over the page.
    public static let paper = make(.paper, "Paper & Ink", blurb: "Warm and editorial. Serif headings, espresso ink on cream paper.",
                                   tagline: nil, scheme: .light, card: "raised", well: "surface-2", stamp: "accent",
                                   shadow: Color(uiColor: UIColor(hex: 0x3C2814)).opacity(0.10), radius: 16, depth: .soft)

    /// Chromatic: good finds, kept close. Saved things in coloured folders on a dark desk, lilac for
    /// what you can touch, a slow aurora behind.
    public static let chromatic = make(.chromatic, "Chromatic", blurb: "Curious and colourful. Saves in coral, pistachio and lilac folders.",
                                       tagline: "Good finds, kept close.", scheme: .dark, card: "surface", well: "surface-2", stamp: "detail",
                                       shadow: .black.opacity(0.4), radius: 22, depth: .flat)

    /// The appearances someone can pick (Appearance), Nocturne first.
    public static let all: [(id: String, name: String, theme: KSTheme)] = [nocturne, paper, chromatic].map { ($0.style.rawValue, $0.name, $0) }
    /// A saved id. The retired styles move to the nearest new one: Night Atlas to Nocturne; Field
    /// Notebook, Gallery and Swiss Index (light and editorial) to Paper & Ink; Pantry Pop and anything
    /// older to the default, Nocturne.
    public static func named(_ id: String) -> KSTheme { all.first { $0.id == canonical(id) }?.theme ?? .nocturne }
    public static func canonical(_ id: String) -> String {
        if all.contains(where: { $0.id == id }) { return id }
        switch id {
        case "notebook", "gallery", "swiss", "paper-ink": return "paper"
        default: return "nocturne"
        }
    }

    /// The style in use, for the few things drawn outside a view's environment (fonts, kind colours).
    /// Set by `keepsakeAppearance`.
    nonisolated(unsafe) public static var current: KSTheme = .nocturne

    /// A kind's colour for text and marks on the page (passes AA on `paper` and `table`).
    public func kind(_ k: String) -> Color { kindText[k] ?? inkMuted }
    /// A kind's colour as a filled block (a badge, a folder, a map pin); `onKind` reads on it.
    public func kindFill(_ k: String) -> Color { kindFills[k] ?? kindFills["link"] ?? ink }
    /// A kind's colour as a quiet tint behind kind-coloured text.
    public func kindSoft(_ k: String) -> Color { kindSofts[k] ?? kindSofts["link"] ?? well }

    /// Headings: rounded for Nocturne and Chromatic, New York for Paper & Ink.
    public var displayDesign: Font.Design { style == .paper ? .serif : .rounded }
    /// The body voice: SF Pro in every appearance.
    public var bodyDesign: Font.Design { .default }

    /// For system controls that always draw a white glyph (PasteButton): a colour white reads on.
    public var accentForWhiteGlyph: Color {
        switch style {
        case .nocturne: Self.hex(0x8A5200)
        case .paper: accent
        case .chromatic: Self.hex(0x5B4FC4)
        }
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

private struct ThemeKey: EnvironmentKey { static let defaultValue = KSTheme.nocturne }
extension EnvironmentValues {
    public var ks: KSTheme {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}

/// Type, all native system faces scaling with Dynamic Type: rounded display for Nocturne and
/// Chromatic, New York display for Paper & Ink, SF Pro for body text everywhere.
public enum KSFont {
    /// The screen's big title (in `theme`, or the style in use).
    public static func display(_ theme: KSTheme? = nil) -> Font {
        switch (theme ?? KSTheme.current).style {
        case .nocturne: .system(.largeTitle, design: .rounded).weight(.bold)
        case .paper: .system(.largeTitle, design: .serif).weight(.semibold)
        case .chromatic: .system(.largeTitle, design: .rounded).weight(.heavy)
        }
    }
    /// A section heading ("Recent", "Collections", a region in Places).
    public static func section(_ theme: KSTheme? = nil) -> Font {
        switch (theme ?? KSTheme.current).style {
        case .nocturne: .system(.title2, design: .rounded).weight(.semibold)
        case .paper: .system(.title2, design: .serif).weight(.medium)
        case .chromatic: .system(.title2, design: .rounded).weight(.bold)
        }
    }
    /// A save's or a group's name.
    public static func name(_ style: Font.TextStyle = .title3, _ theme: KSTheme? = nil) -> Font {
        let t = theme ?? KSTheme.current
        if style == .largeTitle || style == .title || style == .title2 { return .system(style, design: t.displayDesign).weight(t.style == .paper ? .medium : .bold) }
        switch t.style {
        case .nocturne: return .system(style).weight(.semibold)
        case .paper: return .system(style, design: .serif).weight(.medium)
        case .chromatic: return .system(style, design: .rounded).weight(.bold)
        }
    }
    public static var fact: Font { fact(nil) }
    public static func fact(_ theme: KSTheme?) -> Font { .footnote }
    /// Kind labels and small captions.
    public static var label: Font { label(nil) }
    public static func label(_ theme: KSTheme?) -> Font { .caption.weight(.semibold) }
    /// A quiet line: a note, a subtitle.
    public static var note: Font { .subheadline }
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
        case "place": "mappin.and.ellipse"; case "recipe": "fork.knife"; case "media": "film"; case "book": "books.vertical"
        case "product": "bag"; case "video": "play.rectangle"; case "article": "doc.text"
        case "workout": "figure.strengthtraining.traditional"; default: "link"
        }
    }
    /// For text and marks on the page.
    public var color: Color { KSTheme.current.kind(kind) }
    /// As a filled block; `KSTheme.onKind` reads on it.
    public var fill: Color { KSTheme.current.kindFill(kind) }
}

/// The page everything rests on, in each appearance's own material, moving slowly: Nocturne's faint
/// orbits and a drifting amber glow, Paper & Ink's warm light over paper grain, Chromatic's aurora.
/// It stays put while the cards scroll over it. The top of every page is the plain table colour, so
/// the status bar and the solid navigation bars meet it without a seam. Reduce Motion holds it still;
/// Increase Contrast makes the page plain.
public struct TableBackground: View {
    public init() {}
    public var body: some View {
        TablePatch().ignoresSafeArea()
    }
}

/// A piece of the page for a bar or pinned header to stand on: the same material as the page behind
/// it, lined up with it and moving with it. Every page and patch is a window onto one surface the
/// size of the app's window (`ksTableFrame`).
public struct TablePatch: View {
    @Environment(\.ks) private var t
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduce
    @Environment(\.ksTableFrame) private var table
    public init() {}
    public var body: some View {
        ZStack {
            t.table
            if contrast != .increased {
                GeometryReader { g in
                    let f = g.frame(in: .global), page = table ?? f
                    // 24 frames a second is plenty for something this slow, and Reduce Motion pauses it.
                    TimelineView(.animation(minimumInterval: 1.0 / 24, paused: reduce)) { tl in
                        TableSurface(style: t.style, t: t, time: reduce ? 0 : tl.date.timeIntervalSinceReferenceDate)
                    }
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

/// The whole page's material. Plain for the first 90 points, under the status bar and its scrim, then
/// fading in over the next 160.
private struct TableSurface: View {
    let style: KSTheme.Style, t: KSTheme, time: Double
    var body: some View {
        Canvas(rendersAsynchronously: true) { ctx, size in
            switch style {
            case .nocturne: Nocturne.draw(&ctx, size, t, time)
            case .paper: PaperLight.draw(&ctx, size, t, time)
            case .chromatic: Aurora.draw(&ctx, size, t, time)
            }
        }
        .mask {
            GeometryReader { g in
                let h = max(g.size.height, 1)
                LinearGradient(stops: [.init(color: .black.opacity(0.35), location: 0), .init(color: .black.opacity(0.35), location: min(1, 90 / h)),
                                       .init(color: .black, location: min(1, 250 / h))],
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

/// A soft glow at `c`, `r` points across, `color` at its centre.
private func glow(_ ctx: inout GraphicsContext, _ c: CGPoint, _ r: CGFloat, _ color: Color) {
    let rect = CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)
    ctx.fill(Path(ellipseIn: rect), with: .radialGradient(Gradient(colors: [color, color.opacity(0)]), center: c, startRadius: 0, endRadius: r))
}

/// A fixed scatter of points (the same on every screen and every frame).
private struct Scatter {
    var seed: UInt64
    mutating func next() -> CGFloat { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return CGFloat(seed >> 33) / CGFloat(1 << 31) }
}

/// Nocturne: night sky over the archive. An amber glow and a cyan one drifting very slowly, three
/// faint orbits turning (a full turn takes minutes), and a few stars that breathe.
enum Nocturne {
    static func draw(_ ctx: inout GraphicsContext, _ size: CGSize, _ t: KSTheme, _ time: Double) {
        let w = size.width, h = size.height, long = max(w, h)
        let amber = KSTheme.hex(0xFFC268), cyan = KSTheme.hex(0x80DFE8)
        glow(&ctx, CGPoint(x: w * (0.92 + 0.06 * sin(time / 23)), y: h * (0.30 + 0.05 * cos(time / 29))), long * 0.42, amber.opacity(0.10))
        glow(&ctx, CGPoint(x: w * (0.05 + 0.05 * cos(time / 31)), y: h * (0.88 + 0.04 * sin(time / 19))), long * 0.5, cyan.opacity(0.07))
        // Orbits: tilted ellipses around a point off the right edge.
        let centre = CGPoint(x: w * 1.05, y: h * 0.36)
        for (i, f) in [0.55, 0.85, 1.2].enumerated() {
            var o = ctx
            o.translateBy(x: centre.x, y: centre.y)
            o.rotate(by: .radians(-0.42 + Double(i) * 0.18 + time / (180 + Double(i) * 70)))
            let rx = long * f * 0.62, ry = rx * 0.32
            o.stroke(Path(ellipseIn: CGRect(x: -rx, y: -ry, width: rx * 2, height: ry * 2)),
                     with: .linearGradient(Gradient(colors: [amber.opacity(0.0), amber.opacity(0.16), cyan.opacity(0.06), cyan.opacity(0)]),
                                           startPoint: CGPoint(x: -rx, y: 0), endPoint: CGPoint(x: rx, y: 0)),
                     lineWidth: 0.8)
        }
        var s = Scatter(seed: 0x5EED)
        for i in 0..<Int(w * h / 9000) {
            let x = s.next() * w, y = s.next() * h, r = 0.5 + s.next() * 0.8, base = 0.10 + s.next() * 0.22
            let a = base * (0.65 + 0.35 * sin(time * (0.4 + Double(i % 5) * 0.15) + Double(i)))
            ctx.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2)), with: .color(.white.opacity(a)))
        }
    }
}

/// Paper & Ink: cream paper with a fine grain, and two pools of warm light (sage and rose) moving
/// across it as slowly as afternoon sun.
enum PaperLight {
    static func draw(_ ctx: inout GraphicsContext, _ size: CGSize, _ t: KSTheme, _ time: Double) {
        let w = size.width, h = size.height, long = max(w, h)
        glow(&ctx, CGPoint(x: w * (0.85 + 0.08 * sin(time / 27)), y: h * (0.45 + 0.06 * cos(time / 33))), long * 0.45, t.detail.opacity(0.55))
        glow(&ctx, CGPoint(x: w * (0.1 + 0.07 * cos(time / 25)), y: h * (0.85 + 0.05 * sin(time / 21))), long * 0.42, t.alt.opacity(0.45))
        glow(&ctx, CGPoint(x: w * (0.45 + 0.1 * sin(time / 41)), y: h * 1.05), long * 0.35, KSTheme.hex(0xF1D9B5).opacity(0.5))
        // Grain: specks of ink, still.
        var s = Scatter(seed: 0xC0FFEE)
        var specks = Path()
        for _ in 0..<Int(w * h / 900) {
            let x = s.next() * w, y = s.next() * h, r = 0.35 + s.next() * 0.45
            specks.addEllipse(in: CGRect(x: x - r, y: y - r, width: r * 2, height: r * 2))
        }
        ctx.fill(specks, with: .color(t.ink.opacity(0.05)))
    }
}

/// Chromatic: an aurora of the folder colours (lilac, coral, pistachio) drifting under a dark desk.
enum Aurora {
    static func draw(_ ctx: inout GraphicsContext, _ size: CGSize, _ t: KSTheme, _ time: Double) {
        let w = size.width, h = size.height, long = max(w, h)
        glow(&ctx, CGPoint(x: w * (0.8 + 0.12 * sin(time / 17)), y: h * (0.35 + 0.08 * cos(time / 23))), long * 0.42, t.accent.opacity(0.16))
        glow(&ctx, CGPoint(x: w * (0.15 + 0.1 * cos(time / 19)), y: h * (0.65 + 0.07 * sin(time / 27))), long * 0.38, t.alt.opacity(0.10))
        glow(&ctx, CGPoint(x: w * (0.6 + 0.14 * sin(time / 29)), y: h * (0.98 + 0.04 * cos(time / 13))), long * 0.4, t.detail.opacity(0.10))
        // A fine dot grid, like a cutting mat on the desk.
        var dots = Path()
        let step: CGFloat = 22
        for y in stride(from: step / 2, through: h, by: step) {
            for x in stride(from: step / 2, through: w, by: step) { dots.addEllipse(in: CGRect(x: x - 0.6, y: y - 0.6, width: 1.2, height: 1.2)) }
        }
        ctx.fill(dots, with: .color(.white.opacity(0.045)))
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

/// Depth in the current style.
struct Resting: ViewModifier {
    var scale: CGFloat = 1
    @Environment(\.ks) private var t
    func body(content: Content) -> some View {
        if scale == 0 { content } else {
            switch t.depth {
            case .soft:
                content.compositingGroup().shadow(color: t.shadow, radius: 1.5, x: 0, y: 1).shadow(color: t.shadow, radius: 10 * scale, y: 5 * scale)
            case .lifted:
                content.compositingGroup().shadow(color: t.shadow, radius: 14 * scale, y: 8 * scale)
            case .flat:
                content
            }
        }
    }
}

/// A surface in the current style: its fill, corners, hairline and depth.
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
            .overlay { if t.outline > 0 { shape.strokeBorder(stroke ?? t.rule, lineWidth: t.outline) } }
            .modifier(Resting(scale: lifted ? scale : 0))
    }
}

extension View {
    /// Depth in the current style (a soft shadow, a lifted panel, or none).
    public func resting(_ scale: CGFloat = 1) -> some View { modifier(Resting(scale: scale)) }
    /// A card or panel in the current style: fill (paper by default), corners, hairline and depth.
    public func ksSurface(_ fill: Color? = nil, radius: CGFloat? = nil, stroke: Color? = nil, scale: CGFloat = 1, lifted: Bool = true) -> some View {
        modifier(Surface(fill: fill, radius: radius, stroke: stroke, scale: scale, lifted: lifted))
    }
}
#endif

#if canImport(UIKit)
/// How someone likes Internet Binder to look and feel. Kept in the App Group, so the Share Extension and the
/// widgets match the app. Device settings: never synced, never exported.
public struct Appearance: Sendable, Equatable {
    public var theme = "nocturne"
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
        a.cardStyle = d.string(forKey: "ks.cardStyle") ?? a.cardStyle
        a.haptics = d.object(forKey: "ks.haptics") as? Bool ?? true
        a.sound = d.object(forKey: "ks.sound") as? Bool ?? false
        return a
    }
    /// Each appearance is light or dark on its own (Paper & Ink light; Nocturne and Chromatic dark).
    public var colorScheme: ColorScheme { KSTheme.named(theme).scheme }

    public func save() {
        let d = Self.defaults
        d.set(theme, forKey: "ks.theme"); d.set(cardStyle, forKey: "ks.cardStyle")
        d.set(haptics, forKey: "ks.haptics"); d.set(sound, forKey: "ks.sound")
        // The old System / Light / Dark choice: each appearance now carries its own.
        d.removeObject(forKey: "ks.mode")
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
    /// Applies a whole appearance: style, light or dark, tint, and the haptics and sound switches.
    public func keepsakeAppearance(_ a: Appearance) -> some View {
        let theme = KSTheme.named(a.theme)
        KSTheme.current = theme
        Haptic.enabled = a.haptics
        Haptic.sound = a.sound
        return self.environment(\.ks, theme).environment(\.appearance, a).tint(theme.accent)
            .preferredColorScheme(theme.scheme)
            .modifier(TableFrameReader())
    }
}
#endif
