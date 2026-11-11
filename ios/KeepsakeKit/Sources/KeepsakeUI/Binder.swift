#if canImport(UIKit)
import SwiftUI
import KeepsakeKit

// Divider Tabs: the app is one binder. Every page is a punched sheet with a margin rule, filed behind
// an index tab; saves and groups are ruled index lines. The appearance (Nocturne, Paper & Ink,
// Chromatic) still supplies every colour, the display face and the page under the sheet.

/// The binder's measurements, in points. Shapes: tabs round their top corners only, the sheet is the
/// one container, pictures are small and nearly square, controls stay capsules.
public enum KSBinder {
    /// The page's margin outside the sheet.
    public static let outer: CGFloat = 16
    /// The punched margin, from the sheet's edge to the margin rule.
    public static let gutter: CGFloat = 40
    /// From the margin rule to the writing, and from the writing to the sheet's right edge.
    public static let lead: CGFloat = 12
    public static let trail: CGFloat = 16
    /// Ring holes: their size, where the first sits and how far apart they are.
    public static let hole: CGFloat = 16
    public static let firstHole: CGFloat = 52
    public static let holeEvery: CGFloat = 208
    /// Corners: index tabs (top only), the sheet, a picture on a line, a note set into the sheet.
    public static let tabRadius: CGFloat = 10
    public static let sheetRadius: CGFloat = 14
    public static let pictureRadius: CGFloat = 6
    public static let noteRadius: CGFloat = 10
    /// An index line: its least height and its picture.
    public static let line: CGFloat = 68
    public static let picture: CGFloat = 52
    /// Index tabs: the front one stands a little taller than the ones behind it.
    public static let tabHeight: CGFloat = 38
    public static let frontTabHeight: CGFloat = 44
}

/// How far the writing sits from the sheet's edges, for rules and rows that run edge to edge.
public struct SheetInsets: Equatable, Sendable {
    public var leading: CGFloat
    public var trailing: CGFloat
}

private struct SheetInsetsKey: EnvironmentKey { static let defaultValue: SheetInsets? = nil }
extension EnvironmentValues {
    /// Set inside a `BinderSheet`; nil anywhere else.
    public var ksSheet: SheetInsets? {
        get { self[SheetInsetsKey.self] }
        set { self[SheetInsetsKey.self] = newValue }
    }
}

/// The punched sheet: three-ring holes down a ruled margin. At accessibility text sizes the margin
/// folds away, so the words get the sheet's full width.
public struct BinderSheet<Content: View>: View {
    /// Square at the top left, where the front tab joins the sheet.
    var joinsLeading: Bool
    let content: Content
    @Environment(\.ks) private var t
    @Environment(\.dynamicTypeSize) private var typeSize

    public init(joinsLeading: Bool = true, @ViewBuilder content: () -> Content) {
        self.joinsLeading = joinsLeading; self.content = content()
    }

    public var body: some View {
        let punched = !typeSize.isAccessibilitySize
        let insets = SheetInsets(leading: punched ? KSBinder.lead : KSBinder.trail, trailing: KSBinder.trail)
        let shape = UnevenRoundedRectangle(topLeadingRadius: joinsLeading ? 0 : KSBinder.sheetRadius, bottomLeadingRadius: KSBinder.sheetRadius,
                                           bottomTrailingRadius: KSBinder.sheetRadius, topTrailingRadius: KSBinder.sheetRadius, style: .continuous)
        VStack(alignment: .leading, spacing: 0) { content }
            .environment(\.ksSheet, insets)
            .padding(.leading, insets.leading).padding(.trailing, insets.trailing).padding(.bottom, KSBinder.trail)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, punched ? KSBinder.gutter : 0)
            .background(alignment: .topLeading) {
                if punched {
                    GeometryReader { g in
                        Rectangle().fill(t.accent.opacity(0.4)).frame(width: 1).offset(x: KSBinder.gutter)
                        ForEach(Array(stride(from: KSBinder.firstHole, to: max(KSBinder.firstHole + 1, g.size.height - 20), by: KSBinder.holeEvery)), id: \.self) { y in
                            Circle().fill(t.table)
                                .overlay(Circle().strokeBorder(t.line, lineWidth: 1))
                                .frame(width: KSBinder.hole, height: KSBinder.hole)
                                .offset(x: (KSBinder.gutter - KSBinder.hole) / 2, y: y)
                        }
                    }
                    .accessibilityHidden(true)
                }
            }
            .background(t.paper, in: shape)
            .clipShape(shape)
            .overlay(shape.strokeBorder(t.rule, lineWidth: 1))
    }
}

/// A rule across the sheet, from the margin to its right edge (a plain hairline outside a sheet).
public struct SheetRule: View {
    @Environment(\.ks) private var t
    @Environment(\.ksSheet) private var sheet
    public init() {}
    public var body: some View {
        Rectangle().fill(t.rule).frame(height: 1)
            .padding(.leading, -(sheet?.leading ?? 0)).padding(.trailing, -(sheet?.trailing ?? 0))
            .accessibilityHidden(true)
    }
}

/// One index tab. The front tab is the sheet's own colour and joins it; the ones behind sit a step
/// back in their kind's tint; a filled tab is the divider a kind's pages are filed behind.
public struct IndexTab: View {
    let title: String
    var symbol: String?
    var count: Int?
    var kind: String?
    var front: Bool
    var filled: Bool
    @Environment(\.ks) private var t

    public init(_ title: String, symbol: String? = nil, count: Int? = nil, kind: String? = nil, front: Bool = false, filled: Bool = false) {
        self.title = title; self.symbol = symbol; self.count = count; self.kind = kind; self.front = front; self.filled = filled
    }

    public var body: some View {
        let ink: Color = filled ? t.onKind : front ? t.ink : kind.map { t.kind($0) } ?? t.ink
        let fill: Color = filled ? t.kindFill(kind ?? "link") : front ? t.paper : kind.map { t.kindSoft($0) } ?? t.well
        let shape = UnevenRoundedRectangle(topLeadingRadius: KSBinder.tabRadius, topTrailingRadius: KSBinder.tabRadius, style: .continuous)
        HStack(spacing: 6) {
            if let symbol { Image(systemName: symbol).font(.footnote.weight(.semibold)).accessibilityHidden(true) }
            Text(title).font(.subheadline.weight(.semibold)).lineLimit(2).multilineTextAlignment(.leading)
            if let count, count > 0 {
                Text("\(count)").font(.caption.weight(.bold)).monospacedDigit().foregroundStyle(front ? t.inkMuted : ink.opacity(0.85))
            }
        }
        .foregroundStyle(ink)
        .padding(.horizontal, 14).padding(.vertical, 6)
        .frame(minHeight: front || filled ? KSBinder.frontTabHeight : KSBinder.tabHeight)
        .background(fill, in: shape)
        .overlay { if !filled { shape.stroke(t.rule, lineWidth: 1) } }
        // The front tab covers the sheet's top hairline, so the two read as one piece.
        .overlay(alignment: .bottom) { if front { Rectangle().fill(t.paper).frame(height: 2).padding(.horizontal, 1).offset(y: 1) } }
        // A tab behind stands lower, but takes a tap over the same 44 points as the front one.
        .padding(.top, front || filled ? 0 : KSBinder.frontTabHeight - KSBinder.tabHeight)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(count.map { $0 > 0 ? "\($0)" : "" } ?? "")
    }
}

/// A page of the binder: its tab, a quiet note and any controls beside the tab, then the sheet.
public struct BinderPage<Accessory: View, Content: View>: View {
    let tab: IndexTab
    var note: String?
    let accessory: Accessory
    let content: Content
    @Environment(\.ks) private var t
    @Environment(\.dynamicTypeSize) private var typeSize

    public init(_ tab: IndexTab, note: String? = nil, @ViewBuilder accessory: () -> Accessory, @ViewBuilder content: () -> Content) {
        self.tab = tab; self.note = note; self.accessory = accessory(); self.content = content()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: -1) {
            HStack(alignment: .bottom, spacing: 8) {
                tab.accessibilityAddTraits(.isHeader).layoutPriority(1)
                Spacer(minLength: 0)
                // The note is the first to give way: the tab and the controls keep their words whole.
                if let note, !note.isEmpty, !typeSize.isAccessibilitySize {
                    Text(note).font(.footnote).foregroundStyle(t.inkMuted).monospacedDigit().lineLimit(1).padding(.bottom, 10).padding(.trailing, 4)
                        .layoutPriority(-1)
                }
                accessory.fixedSize().padding(.bottom, 6)
            }
            .zIndex(1)
            BinderSheet {
                if let note, !note.isEmpty, typeSize.isAccessibilitySize {
                    Text(note).font(.footnote).foregroundStyle(t.inkMuted).monospacedDigit().padding(.top, 12)
                }
                content
            }
        }
    }
}

extension BinderPage where Accessory == EmptyView {
    public init(_ tab: IndexTab, note: String? = nil, @ViewBuilder content: () -> Content) {
        self.init(tab, note: note, accessory: { EmptyView() }, content: content)
    }
}

extension View {
    /// A note set into the sheet (what needs you, a hint, a goal): a quiet tint, no outline, so the
    /// sheet stays the only container. `tint` marks the ones that ask for something.
    public func sheetNote(_ tint: Color? = nil) -> some View { modifier(SheetNote(tint: tint)) }
}

private struct SheetNote: ViewModifier {
    let tint: Color?
    @Environment(\.ks) private var t
    func body(content: Content) -> some View {
        content.background((tint ?? t.ink).opacity(tint == nil ? 0.06 : 0.12), in: RoundedRectangle(cornerRadius: KSBinder.noteRadius, style: .continuous))
    }
}

/// A section's heading on the sheet: its name, and a quiet count or note at the right.
public struct SheetHeading: View {
    let title: String
    var note: String?
    @Environment(\.ks) private var t
    @Environment(\.dynamicTypeSize) private var typeSize
    public init(_ title: String, note: String? = nil) { self.title = title; self.note = note }
    public var body: some View {
        // At accessibility sizes the note goes under the name, so the name never breaks mid-word.
        (typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(alignment: .firstTextBaseline))) {
            Text(title).font(KSFont.section()).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
            if let note, !note.isEmpty { Text(note).font(.footnote).foregroundStyle(t.inkMuted).monospacedDigit() }
        }
    }
}

/// Pressing an index line tints it from the margin to the sheet's edge (lines are met many times a
/// day, so nothing moves); it fades back on release.
public struct RowPressStyle: ButtonStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View { Pressed(configuration: configuration) }

    private struct Pressed: View {
        let configuration: Configuration
        @Environment(\.ks) private var t
        @Environment(\.ksSheet) private var sheet
        var body: some View {
            configuration.label
                .background {
                    t.ink.opacity(configuration.isPressed ? 0.07 : 0)
                        .padding(.leading, -(sheet?.leading ?? 0)).padding(.trailing, -(sheet?.trailing ?? 0))
                }
                .animation(.easeOut(duration: configuration.isPressed ? 0.05 : 0.2), value: configuration.isPressed)
        }
    }
}

/// A save as an index line: a small picture, its whole name, then its kind and the one fact that
/// matters (or its state, which is always a word as well as a colour). One accessibility element.
public struct SaveRow: View {
    let save: Save
    /// Select mode: nil outside it, else whether this line is ticked.
    var ticked: Bool?
    @Environment(\.ks) private var t
    @Environment(\.dynamicTypeSize) private var typeSize

    public init(_ save: Save, ticked: Bool? = nil) { self.save = save; self.ticked = ticked }

    private var done: Bool { save.status == "done" || save.purchased == true }

    public var body: some View {
        let k = KindStyle(save.kind)
        HStack(alignment: .center, spacing: 12) {
            SaveImage(save, symbolSize: 20)
                .frame(width: KSBinder.picture, height: KSBinder.picture)
                .clipShape(RoundedRectangle(cornerRadius: KSBinder.pictureRadius, style: .continuous))
                .saturation(done ? 0.4 : 1)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(save.title).font(.body.weight(.semibold)).foregroundStyle(t.ink)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : ticked == nil ? 2 : 3).multilineTextAlignment(.leading)
                // The kind's word steps aside (its symbol stays) before a long fact would be cut short.
                ViewThatFits(in: .horizontal) {
                    facts(k, word: true)
                    facts(k, word: false)
                }
            }
            Spacer(minLength: 0)
            if let ticked {
                Image(systemName: ticked ? "checkmark.circle.fill" : "circle")
                    .font(.title2).foregroundStyle(ticked ? t.accent : t.inkMuted)
            }
        }
        .padding(.vertical, 8)
        .frame(minHeight: KSBinder.line)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(SaveCard.spoken(save))
        .accessibilityAddTraits(ticked == true ? .isSelected : [])
    }

    private func facts(_ k: KindStyle, word: Bool) -> some View {
        let state = SaveCard.state(save)
        return HStack(spacing: 5) {
            Image(systemName: k.symbol).font(.caption.weight(.semibold)).foregroundStyle(t.kind(save.kind))
            if word { Text(k.label).fontWeight(.semibold).foregroundStyle(t.kind(save.kind)) }
            if !state.isEmpty {
                if word { Text("·").foregroundStyle(t.inkMuted) }
                // Done says its own verb ("Cooked", "Been"); the rest say what they wait for.
                // One text, mark and word together, so it measures as one piece.
                (Text(Image(systemName: save.isFinishing ? "hourglass" : done ? "checkmark" : "tray")).font(.caption2.weight(.bold))
                 + Text(" " + (done && save.purchased != true ? k.doneVerb : state)).fontWeight(.semibold))
                    .foregroundStyle(save.isFinishing ? t.inkMuted : done ? t.stamp : t.accent)
            } else if let fact = save.fact, !fact.isEmpty {
                Text(word ? "· \(fact)" : fact).foregroundStyle(t.inkMuted)
            }
        }
        .font(.footnote).lineLimit(1)
        // Its natural width, so ViewThatFits can tell when the kind's word has to step aside.
        .fixedSize(horizontal: word, vertical: false)
    }
}

/// A group of saves (a collection, or a Lifestyle view) as an index line: one of its pictures, its
/// name and how many it holds.
public struct GroupRow: View {
    let title: String
    let subtitle: String
    let cover: Save?
    let symbol: String
    let tint: Color
    let kind: String?
    /// Select mode: nil outside it, else whether this line is ticked.
    var ticked: Bool?
    /// Room kept at the right for an overflow button laid over the line.
    var menuRoom: Bool
    @Environment(\.ks) private var t
    @Environment(\.dynamicTypeSize) private var typeSize

    public init(_ title: String, subtitle: String, cover: Save?, symbol: String, tint: Color, kind: String? = nil, ticked: Bool? = nil, menuRoom: Bool = false) {
        self.title = title; self.subtitle = subtitle; self.cover = cover; self.symbol = symbol; self.tint = tint; self.kind = kind
        self.ticked = ticked; self.menuRoom = menuRoom
    }

    public var body: some View {
        let shape = RoundedRectangle(cornerRadius: KSBinder.pictureRadius, style: .continuous)
        HStack(spacing: 12) {
            ZStack {
                (kind.map { t.kindSoft($0) } ?? t.well)
                if let cover, cover.hasImage { SaveImage(cover, showsSymbol: false) }
                else { Image(systemName: symbol).font(.system(size: 20, weight: .regular)).foregroundStyle(kind.map { t.kind($0) } ?? tint) }
            }
            .frame(width: KSBinder.picture, height: KSBinder.picture)
            .clipShape(shape)
            // Nothing in it yet: a dashed place where its pictures will go.
            .overlay { if cover == nil { shape.strokeBorder(t.inkMuted.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3])) } }
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.body.weight(.semibold)).foregroundStyle(t.ink)
                    .lineLimit(typeSize.isAccessibilitySize ? nil : 2).multilineTextAlignment(.leading)
                HStack(spacing: 5) {
                    Image(systemName: symbol).font(.caption.weight(.semibold)).foregroundStyle(kind.map { t.kind($0) } ?? t.inkMuted)
                    Text(subtitle).foregroundStyle(t.inkMuted).monospacedDigit()
                }
                .font(.footnote).lineLimit(1)
            }
            Spacer(minLength: 0)
            if let ticked {
                Image(systemName: ticked ? "checkmark.circle.fill" : "circle").font(.title2).foregroundStyle(ticked ? t.accent : t.inkMuted)
            } else if !menuRoom {
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(t.inkMuted)
            }
        }
        .padding(.vertical, 8).padding(.trailing, menuRoom ? 44 : 0)
        .frame(minHeight: KSBinder.line)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(subtitle)")
        .accessibilityAddTraits(ticked == true ? [.isButton, .isSelected] : .isButton)
    }
}

/// The line that makes something new (a collection).
public struct NewGroupRow: View {
    let title: String
    @Environment(\.ks) private var t
    public init(_ title: String) { self.title = title }
    public var body: some View {
        let shape = RoundedRectangle(cornerRadius: KSBinder.pictureRadius, style: .continuous)
        HStack(spacing: 12) {
            Image(systemName: "plus").font(.title3.weight(.medium)).foregroundStyle(t.accent)
                .frame(width: KSBinder.picture, height: KSBinder.picture)
                .overlay(shape.strokeBorder(t.ink.opacity(0.4), style: StrokeStyle(lineWidth: 1.25, dash: [5, 4])))
            Text(title).font(.body.weight(.semibold)).foregroundStyle(t.ink).multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .frame(minHeight: KSBinder.line)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isButton)
    }
}

/// "2 saves need a collection" and "File them", the page's one filled control: what needs you, set into the sheet.
public struct NeedsCollectionStrip: View {
    let count: Int
    @Environment(\.ks) private var t
    @Environment(\.dynamicTypeSize) private var typeSize
    public init(count: Int) { self.count = count }
    public var body: some View {
        (typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 10))) {
            HStack(spacing: 10) {
                Image(systemName: "tray.full").font(.body.weight(.semibold)).foregroundStyle(t.accent).accessibilityHidden(true)
                Text(count == 1 ? "1 save needs a collection" : "\(count) saves need a collection")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(t.ink).fixedSize(horizontal: false, vertical: true)
            }
            if !typeSize.isAccessibilitySize { Spacer(minLength: 4) }
            Text(count == 1 ? "File it" : "File them").font(.subheadline.weight(.semibold)).foregroundStyle(t.onHighlight)
                .padding(.horizontal, 14).frame(minHeight: 36)
                .background(t.highlight, in: Capsule())
                .accessibilityHidden(true)
        }
        .padding(.leading, 12).padding(.trailing, 8).padding(.vertical, 8)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .sheetNote(t.accent)
        .accessibilityElement(children: .combine)
    }
}
#endif
