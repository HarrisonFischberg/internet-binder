#if canImport(UIKit)
import SwiftUI

/// Pressing sinks a thing a little on touch-down (answers within a frame), then springs back.
public struct PressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduce
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduce ? 0.97 : 1)
            .opacity(configuration.isPressed && reduce ? 0.8 : 1)
            .animation(KSMotion.or(KSMotion.press, reduce: reduce), value: configuration.isPressed)
    }
}

/// The screen's one primary action: full width, at the bottom, under the thumb.
public struct PrimarySlab: View {
    let title: String
    let symbol: String
    let action: () -> Void
    @Environment(\.ks) private var t
    public init(_ title: String, symbol: String, action: @escaping () -> Void) { self.title = title; self.symbol = symbol; self.action = action }
    public var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.headline)
                .foregroundStyle(t.onAccent)
                .frame(maxWidth: .infinity, minHeight: 56)
                .background(t.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .shadow(color: t.accent.opacity(0.3), radius: 10, y: 5)
        }
        .buttonStyle(PressStyle())
    }
}

/// A quiet, native-feeling chip for filters and choices.
public struct Chip: View {
    let title: String
    let symbol: String?
    let tint: Color?
    let selected: Bool
    let action: () -> Void
    @Environment(\.ks) private var t
    public init(_ title: String, symbol: String? = nil, tint: Color? = nil, selected: Bool, action: @escaping () -> Void) {
        self.title = title; self.symbol = symbol; self.tint = tint; self.selected = selected; self.action = action
    }
    public var body: some View {
        Button {
            Haptic.detent()
            action()
        } label: {
            HStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).imageScale(.small).foregroundStyle(selected ? t.onAccent : (tint ?? t.ink)) }
                Text(title)
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(selected ? t.onAccent : t.ink)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(selected ? AnyShapeStyle(t.ink) : AnyShapeStyle(t.paper), in: Capsule())
            .overlay(Capsule().strokeBorder(t.rule, lineWidth: selected ? 0 : 0.75))
        }
        .buttonStyle(PressStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// One tap to stamp ("Been", "Cooked", "Purchased", "Done today"): the stamp lands with a thud and the
/// screen says so (the caller's celebration). Tapping a stamped one takes the stamp off again.
/// `.seal` is a dashed round stamp; `.scallop` a round price sticker with a wavy edge.
public struct StampButton: View {
    public enum Edge: Sendable { case seal, scallop }
    let label: String
    let done: Bool
    let edge: Edge
    let symbol: String
    let doneSymbol: String
    let tint: Color?
    let action: () -> Void
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    /// Grows with Dynamic Type, so its label never clips.
    @ScaledMetric(relativeTo: .caption2) private var size: CGFloat = 60
    public init(_ label: String, done: Bool, edge: Edge = .seal, symbol: String = "seal", doneSymbol: String = "checkmark.seal.fill",
                tint: Color? = nil, action: @escaping () -> Void) {
        self.label = label; self.done = done; self.edge = edge; self.symbol = symbol; self.doneSymbol = doneSymbol; self.tint = tint; self.action = action
    }

    public var body: some View {
        let ink = tint ?? t.stamp
        Button {
            Haptic.stamped()
            action()
        } label: {
            VStack(spacing: 2) {
                Image(systemName: done ? doneSymbol : symbol).font(.title3.weight(.semibold))
                    .contentTransition(.symbolEffect(.replace))
                    .symbolEffect(.bounce, value: done)
                Text(label).font(.caption2.weight(.semibold)).lineLimit(2).minimumScaleFactor(0.8).multilineTextAlignment(.center)
            }
            .foregroundStyle(done ? t.onAccent : ink)
            .padding(6)
            .frame(width: max(60, size), height: max(60, size))
            .background { outline(ink) }
            .rotationEffect(.degrees(done && !reduce ? -6 : 0))
            .shadow(color: .black.opacity(0.12), radius: 6, y: 3)
            .contentShape(Circle())
            .animation(KSMotion.or(KSMotion.stamp, reduce: reduce), value: done)
        }
        .buttonStyle(PressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(done ? "\(label), stamped" : label)
        .accessibilityHint(done ? "Double-tap to take the stamp off." : "Double-tap to stamp.")
        .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder private func outline(_ ink: Color) -> some View {
        switch edge {
        case .seal:
            Circle().fill(done ? ink : t.paper)
                .overlay(Circle().strokeBorder(ink.opacity(done ? 1 : 0.45), style: StrokeStyle(lineWidth: 1.5, dash: done ? [] : [3, 3])))
                .overlay(Circle().strokeBorder(t.paper.opacity(done ? 0.7 : 0), lineWidth: 1).padding(4))
        case .scallop:
            Scallop().fill(done ? ink : t.paper)
                .overlay(Scallop().stroke(ink.opacity(done ? 1 : 0.6), lineWidth: 1.5))
                .overlay(Circle().strokeBorder(done ? t.paper.opacity(0.7) : ink.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [2, 2.5])).padding(7))
        }
    }
}

/// Share: a postage stamp with a perforated edge, tilted like one just stuck on an envelope.
public struct ShareStamp: View {
    let action: () -> Void
    @Environment(\.ks) private var t
    @ScaledMetric(relativeTo: .caption2) private var size: CGFloat = 60
    public init(action: @escaping () -> Void) { self.action = action }

    public var body: some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: "paperplane.fill").font(.title3.weight(.semibold))
                Text("Share").font(.caption2.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(t.accent)
            .frame(width: max(56, size - 4), height: max(60, size))
            .background(RoundedRectangle(cornerRadius: 1.5).strokeBorder(t.accent.opacity(0.55), lineWidth: 1.25).padding(5))
            .background(Perforated(bite: 2.4, spacing: 7.5).fill(t.paper))
            .compositingGroup()
            .shadow(color: .black.opacity(0.16), radius: 6, y: 3)
            .rotationEffect(.degrees(3))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel("Share")
        .accessibilityHint("Send this save in Messages, Mail or another app.")
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
