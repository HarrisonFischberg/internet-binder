#if canImport(UIKit)
import SwiftUI

/// Pressing answers within a frame: Pantry Pop's cards and buttons move into their hard shadow,
/// everything else sinks a little. Springs back on release.
public struct PressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduce
    @Environment(\.ks) private var t
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        let hard = if case .hard = t.depth { true } else { false }
        configuration.label
            .environment(\.ksPressed, configuration.isPressed && !reduce)
            .scaleEffect(configuration.isPressed && !reduce && !hard ? 0.97 : 1)
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

/// The screen's one primary action: full width, docked at the bottom, under the thumb. In Pantry Pop
/// a kind's action wears the kind's colour (a tomato Start cooking).
public struct PrimarySlab: View {
    let title: String
    let symbol: String
    let kind: String?
    let action: () -> Void
    @Environment(\.ks) private var t
    @Environment(\.isEnabled) private var enabled
    public init(_ title: String, symbol: String, kind: String? = nil, action: @escaping () -> Void) {
        self.title = title; self.symbol = symbol; self.kind = kind; self.action = action
    }
    public var body: some View {
        let useKind = t.style == .pantry && kind != nil
        let fill = useKind ? t.kindFill(kind!) : t.primary
        let ink = useKind ? t.onKind : t.onPrimary
        let shape = ControlShape(radius: t.style == .pantry ? 22 : t.controlRadius.isInfinite ? 16 : t.controlRadius)
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(t.style == .pantry ? KSFont.name(.headline) : .headline)
                .foregroundStyle(ink)
                .frame(maxWidth: .infinity, minHeight: 56)
                .background(fill, in: shape)
                .overlay { if t.outline > 0 && t.style == .pantry { shape.strokeBorder(t.line, lineWidth: t.outline) } }
                .resting(1.25)
                .opacity(enabled ? 1 : 0.45)
        }
        .buttonStyle(PressStyle())
    }
}

/// A chip for filters and choices. In Pantry Pop a kind's chip is filled with its colour.
public struct Chip: View {
    let title: String
    let symbol: String?
    let tint: Color?
    let kind: String?
    let trailing: String?
    let selected: Bool
    /// The best guess among choices: filled like the screen's primary, without being "selected".
    let prominent: Bool
    let action: () -> Void
    @Environment(\.ks) private var t
    public init(_ title: String, symbol: String? = nil, tint: Color? = nil, kind: String? = nil, trailing: String? = nil, selected: Bool,
                prominent: Bool = false, action: @escaping () -> Void) {
        self.title = title; self.symbol = symbol; self.tint = tint; self.kind = kind; self.trailing = trailing; self.selected = selected
        self.prominent = prominent; self.action = action
    }
    public var body: some View {
        let filled = t.style == .pantry && kind != nil && !selected
        // Gallery marks the chosen chip with an underline, not a fill.
        let gallerySelected = selected && t.style == .gallery
        let bg: Color = prominent ? t.primary : gallerySelected ? .clear : selected ? (t.style == .atlas ? t.highlight : t.ink) : filled ? t.kindFill(kind!) : (t.style == .gallery ? .clear : t.paper)
        let fg: Color = prominent ? t.onPrimary : gallerySelected ? t.ink : selected ? (t.style == .atlas ? t.onHighlight : t.table) : filled ? t.onKind : t.ink
        let icon: Color = selected || filled || prominent ? fg : (tint ?? t.ink)
        let shape = ControlShape(radius: t.style == .notebook ? 16 : t.controlRadius)
        Button {
            Haptic.detent()
            action()
        } label: {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).imageScale(.small).foregroundStyle(icon) }
                Text(title)
                if let trailing { Image(systemName: trailing).imageScale(.small).accessibilityHidden(true) }
            }
            .font(t.style == .pantry ? .subheadline.weight(.heavy) : .subheadline.weight(.medium))
            .foregroundStyle(fg)
            .padding(.horizontal, t.style == .gallery ? 4 : 14)
            .frame(minHeight: 44)
            .background(bg, in: shape)
            .overlay {
                if t.style == .gallery && !prominent {
                    if selected { Rectangle().fill(t.ink).frame(height: 2).frame(maxHeight: .infinity, alignment: .bottom).padding(.bottom, 6) }
                } else if t.outline > 0 || t.style == .notebook {
                    shape.strokeBorder(t.style == .pantry ? t.line : t.rule, lineWidth: t.style == .pantry ? 2.5 : 1)
                }
            }
            .background(.clear)
        }
        .buttonStyle(PressStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
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

/// A secondary action in the current style.
public struct Pill: View {
    let title: String
    let symbol: String
    let filled: Bool
    @Environment(\.ks) private var t
    public init(title: String, symbol: String, filled: Bool) { self.title = title; self.symbol = symbol; self.filled = filled }
    public var body: some View {
        let shape = ControlShape(radius: t.controlRadius)
        Label(title, systemImage: symbol)
            .font(t.style == .pantry ? .subheadline.weight(.heavy) : .subheadline.weight(.semibold))
            .foregroundStyle(filled ? t.onPrimary : t.ink)
            .padding(.horizontal, 16)
            .frame(minHeight: 44)
            .background(filled ? t.primary : (t.style == .gallery ? .clear : t.paper), in: shape)
            .overlay { shape.strokeBorder(t.style == .pantry ? t.line : t.style == .gallery ? t.ink : t.rule, lineWidth: t.style == .pantry ? 2.5 : 1) }
            .resting(0.75)
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
