import SwiftUI

/// The three identity directions proposed at M3.0. Static prototypes only: no app logic.
enum Direction: String, CaseIterable, Identifiable {
    case postcard, cabinet, daylight
    var id: String { rawValue }
    var title: String {
        switch self {
        case .postcard: "Postcard"
        case .cabinet: "Cabinet"
        case .daylight: "Daylight"
        }
    }
    var pitch: String {
        switch self {
        case .postcard: "Paper things on a warm table. Each save is the object of its kind."
        case .cabinet: "A collector's drawer. Saves rest in trays with specimen labels."
        case .daylight: "Photos first, under glass. Bright, airy, quick."
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255)
    }
}

/// Every colour and font role for one direction in one appearance.
struct Theme {
    let direction: Direction
    let dark: Bool

    private func pick(_ l: UInt32, _ d: UInt32) -> Color { Color(hex: dark ? d : l) }

    /// The surface everything rests on.
    var table: Color {
        switch direction {
        case .postcard: pick(0xEDE6DA, 0x15130F)
        case .cabinet: pick(0xD9D3C7, 0x0F1011)
        case .daylight: pick(0xF3F4F7, 0x08090C)
        }
    }
    /// An object's face: paper, a tray label, a card.
    var paper: Color {
        switch direction {
        case .postcard: pick(0xFBF8F2, 0x24211C)
        case .cabinet: pick(0xF6F2EA, 0x222326)
        case .daylight: pick(0xFFFFFF, 0x16181D)
        }
    }
    /// Recessed surfaces (trays, wells).
    var well: Color {
        switch direction {
        case .postcard: pick(0xE4DCCD, 0x1D1A16)
        case .cabinet: pick(0xCBC4B6, 0x18191B)
        case .daylight: pick(0xE9EBF0, 0x111318)
        }
    }
    var ink: Color {
        switch direction {
        case .postcard: pick(0x1E1C19, 0xF1ECE3)
        case .cabinet: pick(0x191A1B, 0xECE9E3)
        case .daylight: pick(0x0F1115, 0xF0F2F5)
        }
    }
    var inkMuted: Color {
        switch direction {
        case .postcard: pick(0x5C554B, 0xAEA698)
        case .cabinet: pick(0x4E4C48, 0xA39F97)
        case .daylight: pick(0x575D68, 0xA0A6B0)
        }
    }
    var accent: Color {
        switch direction {
        case .postcard: pick(0x24439A, 0x9AB0F2)
        case .cabinet: pick(0x7E5210, 0xE2B366)
        case .daylight: pick(0x2B59D9, 0x7C9BFF)
        }
    }
    var onAccent: Color {
        switch direction {
        case .postcard: pick(0xFFFFFF, 0x0E1630)
        case .cabinet: pick(0xFFFFFF, 0x1A1204)
        case .daylight: pick(0xFFFFFF, 0x0B1020)
        }
    }
    /// Postmarks, stamps, the "been" mark.
    var stamp: Color { pick(0xA8342A, 0xF08E7E) }
    var rule: Color { ink.opacity(dark ? 0.16 : 0.12) }

    func kind(_ k: Kind) -> Color {
        switch k {
        case .place: pick(0xA8342A, 0xF08E7E)
        case .recipe: pick(0x4A6E12, 0xA9D46A)
        case .film: pick(0x4F3DBF, 0xADA2FF)
        case .book: pick(0x7E4519, 0xE3A878)
        case .product: pick(0x8C5300, 0xF0B45A)
        case .video: pick(0x8E1D9C, 0xE59CF0)
        case .article: pick(0x1D5AA8, 0x8DB8FF)
        case .workout: pick(0x0C6E69, 0x5FD3CB)
        }
    }

    // MARK: type

    func display(_ size: CGFloat) -> Font {
        switch direction {
        case .postcard: .system(size: size, weight: .semibold, design: .serif)
        case .cabinet: .system(size: size, weight: .bold).width(.condensed)
        case .daylight: .system(size: size, weight: .bold, design: .rounded)
        }
    }
    func title(_ size: CGFloat = 17) -> Font {
        switch direction {
        case .postcard: .system(size: size, weight: .semibold, design: .serif)
        case .cabinet: .system(size: size, weight: .semibold).width(.condensed)
        case .daylight: .system(size: size, weight: .semibold, design: .rounded)
        }
    }
    /// Small labels: kind, facts, captions.
    func label(_ size: CGFloat = 12) -> Font {
        switch direction {
        case .postcard: .system(size: size, weight: .medium)
        case .cabinet: .system(size: size, weight: .medium, design: .monospaced)
        case .daylight: .system(size: size, weight: .semibold, design: .rounded)
        }
    }
    var labelCase: Text.Case? { direction == .cabinet ? .uppercase : nil }

    var cardRadius: CGFloat {
        switch direction {
        case .postcard: 4
        case .cabinet: 10
        case .daylight: 26
        }
    }
}

private struct ThemeKey: EnvironmentKey {
    static let defaultValue = Theme(direction: .postcard, dark: false)
}
extension EnvironmentValues {
    var theme: Theme {
        get { self[ThemeKey.self] }
        set { self[ThemeKey.self] = newValue }
    }
}

/// Pressing sinks the object a little, on touch-down, with a spring (principle 2: answer within a frame).
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.7), value: configuration.isPressed)
    }
}
