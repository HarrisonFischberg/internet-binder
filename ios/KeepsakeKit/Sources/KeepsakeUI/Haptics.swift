#if canImport(UIKit)
import SwiftUI
import UIKit
import AudioToolbox

/// Every haptic in Keepsake, named by what happened (replica/m3/haptics.md). Nothing else buzzes.
@MainActor
public enum Haptic {
    public static var enabled = true
    /// The optional sound layer (off by default): a soft tick when a save lands or a stamp comes down.
    public static var sound = false

    public static func saved() { notify(.success); tick() }
    public static func detent() { selection() }
    public static func settled() { impact(.soft, 0.6) }
    public static func undo() { impact(.rigid, 0.5) }
    public static func lift() { impact(.medium, 1) }
    public static func dropped() { notify(.success); tick() }
    public static func refused() { notify(.error) }
    public static func checked() { selection() }
    public static func pageTurned() { impact(.light, 1) }
    public static func trashed() { impact(.rigid, 1) }
    public static func warning() { notify(.warning) }
    /// Hold-to-stamp: a tick rising with progress (0…1), then `stamped()`.
    public static func holdTick(_ progress: Double) { impact(.light, 0.2 + 0.5 * progress) }
    public static func stamped() { impact(.heavy, 1); tick() }
    public static func tick() { if sound { AudioServicesPlaySystemSound(1104) } }

    private static func selection() { guard enabled else { return }; UISelectionFeedbackGenerator().selectionChanged() }
    private static func notify(_ t: UINotificationFeedbackGenerator.FeedbackType) { guard enabled else { return }; UINotificationFeedbackGenerator().notificationOccurred(t) }
    private static func impact(_ s: UIImpactFeedbackGenerator.FeedbackStyle, _ i: CGFloat) { guard enabled else { return }; UIImpactFeedbackGenerator(style: s).impactOccurred(intensity: i) }
}

/// The named springs (replica/m3/motion.md). Under Reduce Motion, callers use `KSMotion.quiet`.
public enum KSMotion {
    public static let press = Animation.spring(response: 0.22, dampingFraction: 0.7)
    public static let settle = Animation.spring(response: 0.38, dampingFraction: 0.82)
    public static let lift = Animation.spring(response: 0.3, dampingFraction: 0.65)
    public static let sheet = Animation.spring(response: 0.42, dampingFraction: 0.88)
    public static let stamp = Animation.spring(response: 0.18, dampingFraction: 0.5)
    public static let quiet = Animation.easeOut(duration: 0.18)
    public static func or(_ a: Animation, reduce: Bool) -> Animation { reduce ? quiet : a }
}
#endif
