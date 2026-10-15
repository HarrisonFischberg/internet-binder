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

/// Press and hold to stamp ("Been", "Cooked", "Done today"): a ring fills over 450 ms with rising
/// ticks, then the stamp lands. Letting go early springs back and records nothing. With VoiceOver it
/// is a single activation.
public struct HoldToStamp: View {
    let label: String
    let done: Bool
    let action: () -> Void
    @State private var progress: Double = 0
    @State private var holding = false
    @State private var ticks = 0
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    /// Grows with Dynamic Type, so its label never clips.
    @ScaledMetric(relativeTo: .caption2) private var size: CGFloat = 60
    public init(_ label: String, done: Bool, action: @escaping () -> Void) { self.label = label; self.done = done; self.action = action }

    public var body: some View {
        VStack(spacing: 2) {
            Image(systemName: done ? "checkmark.seal.fill" : "seal").font(.title3.weight(.semibold))
            Text(label).font(.caption2.weight(.semibold)).lineLimit(2).multilineTextAlignment(.center)
        }
        .foregroundStyle(t.stamp)
        .padding(6)
        .frame(width: max(60, size), height: max(60, size))
        .background(Circle().fill(t.paper))
        .overlay(Circle().strokeBorder(t.stamp.opacity(0.45), style: StrokeStyle(lineWidth: 1.5, dash: done ? [] : [3, 3])))
        .overlay(Circle().trim(from: 0, to: progress).stroke(t.stamp, style: StrokeStyle(lineWidth: 3, lineCap: .round)).rotationEffect(.degrees(-90)).padding(1.5))
        .scaleEffect(holding && !reduce ? 0.94 : 1)
        .shadow(color: .black.opacity(0.12), radius: 6, y: 3)
        .contentShape(Circle())
        .onLongPressGesture(minimumDuration: 0.45, maximumDistance: 30) {
            Haptic.stamped()
            withAnimation(KSMotion.or(KSMotion.stamp, reduce: reduce)) { progress = 0; holding = false }
            action()
        } onPressingChanged: { pressing in
            holding = pressing
            if pressing {
                ticks = 0
                withAnimation(.linear(duration: 0.45)) { progress = 1 }
                for i in 1...4 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1 * Double(i)) { if holding { Haptic.holdTick(Double(i) / 4) } }
                }
            } else {
                withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { progress = 0 }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(done ? "\(label), stamped" : label)
        .accessibilityHint("Press and hold to stamp.")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { Haptic.stamped(); action() }
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
#endif
