#if canImport(UIKit)
import SwiftUI

/// Pressing answers within a frame (120 ms): the card sinks a little and springs back on release.
/// Under Reduce Motion it dims instead.
public struct PressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduce
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .environment(\.ksPressed, configuration.isPressed && !reduce)
            .scaleEffect(configuration.isPressed && !reduce ? 0.97 : 1)
            .opacity(configuration.isPressed && reduce ? 0.8 : 1)
            .animation(KSMotion.or(KSMotion.press, reduce: reduce), value: configuration.isPressed)
    }
}

/// A control's shape in the current style: a capsule, or the style's corner.
struct ControlShape: InsettableShape {
    var radius: CGFloat
    var inset: CGFloat = 0
    func path(in r: CGRect) -> Path {
        let r = r.insetBy(dx: inset, dy: inset)
        return RoundedRectangle(cornerRadius: radius.isInfinite ? r.height / 2 : radius, style: .continuous).path(in: r)
    }
    func inset(by amount: CGFloat) -> ControlShape { var s = self; s.inset += amount; return s }
}

/// The screen's one primary action: full width, docked at the bottom, under the thumb, on tinted
/// Liquid Glass in the accent so the page shows through as it scrolls under (solid with Reduce
/// Transparency).
public struct PrimarySlab: View {
    let title: String
    let symbol: String
    let kind: String?
    let action: () -> Void
    @Environment(\.ks) private var t
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceTransparency) private var solid
    public init(_ title: String, symbol: String, kind: String? = nil, action: @escaping () -> Void) {
        self.title = title; self.symbol = symbol; self.kind = kind; self.action = action
    }
    public var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.headline)
                .foregroundStyle(t.onPrimary)
                .frame(maxWidth: .infinity, minHeight: 36)
        }
        .buttonStyle(.glassProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .tint(solid ? t.primary : t.primary.opacity(0.88))
        .opacity(enabled ? 1 : 0.45)
    }
}

/// Liquid Glass on a control that floats over the page; a solid raised fill with a hairline when
/// Reduce Transparency is on.
struct KSGlass<S: Shape>: ViewModifier {
    let shape: S
    let tint: Color?
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceTransparency) private var solid
    func body(content: Content) -> some View {
        if solid {
            content.background(tint ?? t.well, in: shape).overlay(shape.stroke(t.rule, lineWidth: 1))
        } else {
            content.glassEffect(tint.map { Glass.regular.tint($0).interactive() } ?? Glass.regular.interactive(), in: shape)
        }
    }
}

extension View {
    /// Liquid Glass for a control that floats over the page (header buttons, Select, back, the map
    /// controls). The style stays on the content; controls float on glass. A tint marks a control
    /// that's on.
    public func ksGlass<S: Shape>(_ shape: S, tint: Color? = nil) -> some View {
        modifier(KSGlass(shape: shape, tint: tint))
    }
}

/// A round control on glass: a symbol in the style's ink (or `ink` on a tinted, switched-on control).
/// Put neighbours in one `GlassEffectContainer` so they read as one piece of glass.
public struct GlassIcon: View {
    let symbol: String
    let tint: Color?
    let ink: Color?
    let size: CGFloat
    let font: Font
    @Environment(\.ks) private var t
    public init(_ symbol: String, tint: Color? = nil, ink: Color? = nil, size: CGFloat = 44, font: Font = .body.weight(.bold)) {
        self.symbol = symbol; self.tint = tint; self.ink = ink; self.size = size; self.font = font
    }
    public var body: some View {
        Image(systemName: symbol).font(font).foregroundStyle(ink ?? t.ink)
            .frame(width: size, height: size)
            .contentShape(Circle())
            .ksGlass(Circle(), tint: tint)
    }
}

/// A chip for filters and choices: a capsule on the well, filled with the accent (and a checkmark
/// for a filter) when selected, so selection never rests on colour alone.
public struct Chip: View {
    let title: String
    let symbol: String?
    let tint: Color?
    let kind: String?
    let trailing: String?
    let selected: Bool
    /// The best guess among choices: filled like the screen's primary, without being "selected".
    let prominent: Bool
    /// Show a checkmark when selected (filters that toggle).
    let checks: Bool
    let action: () -> Void
    @Environment(\.ks) private var t
    @Environment(\.isEnabled) private var enabled
    public init(_ title: String, symbol: String? = nil, tint: Color? = nil, kind: String? = nil, trailing: String? = nil, selected: Bool,
                prominent: Bool = false, checks: Bool = false, action: @escaping () -> Void) {
        self.title = title; self.symbol = symbol; self.tint = tint; self.kind = kind; self.trailing = trailing; self.selected = selected
        self.prominent = prominent; self.checks = checks; self.action = action
    }
    public var body: some View {
        let on = selected || prominent
        let bg: Color = on ? t.accent : t.well
        let fg: Color = on ? t.onAccent : t.ink
        let icon: Color = on ? fg : (tint ?? t.ink)
        let shape = Capsule()
        Button {
            Haptic.detent()
            action()
        } label: {
            HStack(spacing: 6) {
                if checks && selected {
                    Image(systemName: "checkmark").imageScale(.small).fontWeight(.bold).accessibilityHidden(true)
                } else if let symbol {
                    Image(systemName: symbol).imageScale(.small).foregroundStyle(icon).accessibilityHidden(true)
                }
                Text(title).lineLimit(1)
                if let trailing { Image(systemName: trailing).imageScale(.small).accessibilityHidden(true) }
            }
            .font(.subheadline.weight(on ? .semibold : .medium))
            .foregroundStyle(fg)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(bg, in: shape)
            .overlay { if !on { shape.strokeBorder(t.rule, lineWidth: 1) } }
            .opacity(enabled ? 1 : 0.45)
            .contentShape(shape)
        }
        .buttonStyle(PressStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// List / Map / Review: a capsule track on the well with the chosen segment filled in the accent.
/// A real picker for VoiceOver (each segment a button with its selected state).
public struct SegmentedTabs<Value: Hashable>: View {
    let options: [(value: Value, title: String)]
    @Binding var selection: Value
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @Namespace private var pill
    public init(_ options: [(value: Value, title: String)], selection: Binding<Value>) { self.options = options; self._selection = selection }
    public var body: some View {
        HStack(spacing: 4) {
            ForEach(options.indices, id: \.self) { i in
                let o = options[i]
                let on = o.value == selection
                Button {
                    guard !on else { return }
                    Haptic.detent()
                    withAnimation(KSMotion.or(.spring(response: 0.18, dampingFraction: 0.86), reduce: reduce)) { selection = o.value }
                } label: {
                    Text(o.title).font(.subheadline.weight(on ? .semibold : .medium)).lineLimit(1).minimumScaleFactor(0.85)
                        .foregroundStyle(on ? t.onAccent : t.ink)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background {
                            if on { Capsule().fill(t.accent).matchedGeometryEffect(id: "pill", in: pill) }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? [.isSelected] : [])
            }
        }
        .padding(4)
        .background(t.well, in: Capsule())
        .overlay(Capsule().strokeBorder(t.rule, lineWidth: 1))
    }
}

/// One tap to mark a save done ("Been", "Cooked", "Purchased", "Done today"); the screen says so (the
/// caller's celebration). Tapping it again takes the mark off. A pill under the save's title.
public struct StampButton: View {
    public enum Edge: Sendable { case seal, scallop }
    let label: String
    let done: Bool
    let symbol: String
    let doneSymbol: String
    let action: () -> Void
    @Environment(\.ks) private var t
    public init(_ label: String, done: Bool, edge: Edge = .seal, symbol: String = "checkmark", doneSymbol: String = "checkmark",
                tint: Color? = nil, action: @escaping () -> Void) {
        self.label = label; self.done = done; self.symbol = symbol; self.doneSymbol = doneSymbol; self.action = action
    }

    public var body: some View {
        Button {
            Haptic.stamped()
            action()
        } label: {
            Pill(title: done ? label : (["Cooked": "Cooked it", "Been": "Been here", "Purchased": "Bought it"][label] ?? label), symbol: done ? "checkmark.circle.fill" : symbol, filled: done)
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(done ? "\(label), done" : label)
        .accessibilityAddTraits(done ? .isSelected : [])
        .accessibilityHint(done ? "Double-tap to take the mark off." : "Double-tap to mark it.")
    }
}

/// Share, as a pill beside the save's mark.
public struct ShareStamp: View {
    let action: () -> Void
    public init(action: @escaping () -> Void) { self.action = action }
    public var body: some View {
        Button(action: action) { Pill(title: "Share", symbol: "square.and.arrow.up", filled: false) }
            .buttonStyle(PressStyle())
            .accessibilityHint("Send this save in Messages, Mail or another app.")
    }
}

/// A secondary action in the current style: a capsule on the well, or filled in the accent.
public struct Pill: View {
    let title: String
    let symbol: String
    let filled: Bool
    @Environment(\.ks) private var t
    public init(title: String, symbol: String, filled: Bool) { self.title = title; self.symbol = symbol; self.filled = filled }
    public var body: some View {
        let shape = Capsule()
        Label(title, systemImage: symbol)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(filled ? t.onPrimary : t.ink)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(filled ? t.primary : t.well, in: shape)
            .overlay { if !filled { shape.strokeBorder(t.rule, lineWidth: 1) } }
    }
}

/// Content fades out under the status bar, so scrolled text never collides with it.
public struct TopScrim: View {
    @Environment(\.ks) private var t
    public init() {}
    public var body: some View {
        LinearGradient(colors: [t.table, t.table.opacity(0)], startPoint: .top, endPoint: .bottom)
            .frame(height: 24)
            .background(t.table.ignoresSafeArea(edges: .top))
            .allowsHitTesting(false)
    }
}

/// Content fades into the table under floating bottom controls, so text never runs behind them.
public struct BottomScrim: View {
    @Environment(\.ks) private var t
    public init() {}
    public var body: some View {
        LinearGradient(stops: [.init(color: t.table.opacity(0), location: 0), .init(color: t.table.opacity(0.94), location: 0.35), .init(color: t.table, location: 1)],
                       startPoint: .top, endPoint: .bottom)
            .frame(height: 170).offset(y: 30)
            .allowsHitTesting(false)
    }
}

/// Chips that wrap onto as many lines as they need (a destination picker, tags).
public struct Flow: Layout {
    var spacing: CGFloat
    public init(spacing: CGFloat = 8) { self.spacing = spacing }

    public func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(width: proposal.width ?? .infinity, subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    public func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(width: bounds.width, subviews) {
            var x = bounds.minX
            for i in row.items {
                let size = subviews[i].sizeThatFits(.unspecified)
                subviews[i].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var items: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func rows(width: CGFloat, _ subviews: Subviews) -> [Row] {
        var rows: [Row] = [Row()]
        for i in subviews.indices {
            let size = subviews[i].sizeThatFits(.unspecified)
            if !rows[rows.count - 1].items.isEmpty, rows[rows.count - 1].width + spacing + size.width > width { rows.append(Row()) }
            var row = rows[rows.count - 1]
            row.width += (row.items.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.items.append(i)
            rows[rows.count - 1] = row
        }
        return rows.filter { !$0.items.isEmpty }
    }
}
#endif
