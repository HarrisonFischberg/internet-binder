#if canImport(UIKit)
import SwiftUI
import KeepsakeKit

/// A group of saves (a collection, or a Lifestyle view): one picture from the group in a square crop,
/// its name and how many it holds under it. Chromatic files it in a coloured folder (lilac,
/// pistachio, coral, violet in turn) with its number on the tab; Lifestyle groups wear their kind.
public struct GroupTile: View {
    let title: String
    let subtitle: String
    let cover: Save?
    let symbol: String
    let tint: Color
    let kind: String?
    let selected: Bool
    /// Three across (the Share card): a smaller name that shrinks before it breaks a word.
    let compact: Bool
    /// Its place in the grid (from 1): Chromatic's folder colour and tab number.
    let number: Int?
    /// Room kept at the bottom right for an overflow button laid over the tile.
    let menuRoom: Bool
    @Environment(\.ks) private var t

    public init(_ title: String, subtitle: String, cover: Save?, symbol: String, tint: Color, kind: String? = nil, selected: Bool = false, compact: Bool = false,
                number: Int? = nil, menuRoom: Bool = false) {
        self.title = title; self.subtitle = subtitle; self.cover = cover; self.symbol = symbol; self.tint = tint; self.kind = kind; self.selected = selected
        self.compact = compact; self.number = number; self.menuRoom = menuRoom
    }

    public var body: some View {
        Group {
            if t.style == .chromatic { folder } else { card }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(subtitle)")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }

    /// The square picture (or the group's symbol on a quiet tile), cropped the same in every tile.
    private func picture(_ radius: CGFloat) -> some View {
        Color.clear
            .aspectRatio(compact ? 1 : 1.1, contentMode: .fit)
            .overlay {
                ZStack {
                    t.well
                    if let cover, cover.hasImage { SaveImage(cover, showsSymbol: false) }
                    else {
                        Image(systemName: symbol).font(.system(size: compact ? 22 : 30, weight: .regular))
                            .foregroundStyle(tint)
                    }
                    // Nothing in it yet: a dashed place where its pictures will go.
                    if cover == nil {
                        RoundedRectangle(cornerRadius: max(radius - 4, 4)).strokeBorder(t.inkMuted.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3])).padding(compact ? 6 : 10)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(alignment: .topTrailing) {
                if let kind { Stamp(kind: kind, size: compact ? 22 : 28).padding(compact ? 5 : 8) }
            }
    }

    private var words: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title).font(KSFont.name(compact ? .subheadline : .headline)).foregroundStyle(t.ink)
                .lineLimit(2).minimumScaleFactor(0.75).allowsTightening(true)
            Text(subtitle).font(.subheadline).foregroundStyle(t.inkMuted).lineLimit(1).monospacedDigit()
        }
        .padding(.trailing, menuRoom ? 40 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Nocturne and Paper & Ink: a card with the picture on top and the words under it.
    private var card: some View {
        VStack(alignment: .leading, spacing: compact ? 6 : 10) {
            picture(max(t.radius - 6, 8))
            words.padding(.horizontal, 4).padding(.bottom, 4)
        }
        .padding(compact ? 5 : 6)
        .ksSurface(nil, stroke: selected ? t.accent : nil)
        .overlay {
            if selected { RoundedRectangle(cornerRadius: t.radius, style: .continuous).strokeBorder(t.accent, lineWidth: 2.5) }
        }
    }

    /// Chromatic's folder colours, in turn.
    static let folderColors: [UInt32] = [0xB7ADFF, 0xC0DB98, 0xFFAAA0, 0xD9B2FF]

    /// Chromatic: a coloured folder with a tab (its number), the picture tucked inside, the words in ink.
    private var folder: some View {
        let n = number ?? (title.unicodeScalars.reduce(0) { $0 + Int($1.value) } % 4 + 1)
        let fill = Color(uiColor: UIColor(hex: Self.folderColors[(n - 1) % Self.folderColors.count]))
        let ink = t.onAccent
        let tab: CGFloat = compact ? 14 : 20
        return VStack(alignment: .leading, spacing: compact ? 6 : 10) {
            picture(compact ? 8 : 12)
                .padding(.top, tab - 4)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(KSFont.name(compact ? .subheadline : .headline)).foregroundStyle(ink)
                    .lineLimit(2).minimumScaleFactor(0.75).allowsTightening(true)
                Text(subtitle).font(.subheadline.weight(.medium)).foregroundStyle(ink.opacity(0.78)).lineLimit(1).monospacedDigit()
            }
            .padding(.trailing, menuRoom ? 40 : 0)
            .padding(.horizontal, 4).padding(.bottom, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(compact ? 6 : 8)
        .background {
            FolderShape(tab: tab, radius: compact ? 12 : t.radius).fill(fill)
                .background { FolderShape(tab: tab, radius: compact ? 12 : t.radius).fill(fill.opacity(0.55)).offset(x: 0, y: -3).scaleEffect(x: 0.96) }
        }
        .overlay(alignment: .topTrailing) {
            if !compact {
                Text(String(format: "%02d", n)).font(.caption2.weight(.bold)).monospacedDigit().foregroundStyle(ink.opacity(0.7))
                    .padding(.trailing, 22).padding(.top, 3).accessibilityHidden(true)
            }
        }
        .overlay {
            if selected { FolderShape(tab: tab, radius: compact ? 12 : t.radius).stroke(t.ink, lineWidth: 2.5) }
        }
        .contentShape(FolderShape(tab: tab, radius: compact ? 12 : t.radius))
    }
}

/// A folder: a body with rounded corners and a tab raised along the top right.
public struct FolderShape: Shape {
    var tab: CGFloat
    var radius: CGFloat
    public init(tab: CGFloat, radius: CGFloat) { self.tab = tab; self.radius = radius }
    public func path(in r: CGRect) -> Path {
        let rad = min(radius, r.height / 4), tabW = min(r.width * 0.42, 110), top = r.minY + tab
        let tabStart = r.maxX - tabW
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: top + rad))
        p.addQuadCurve(to: CGPoint(x: r.minX + rad, y: top), control: CGPoint(x: r.minX, y: top))
        p.addLine(to: CGPoint(x: tabStart - tab * 0.6, y: top))
        p.addCurve(to: CGPoint(x: tabStart + tab * 0.4, y: r.minY), control1: CGPoint(x: tabStart - tab * 0.1, y: top), control2: CGPoint(x: tabStart - tab * 0.1, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX - rad * 0.8, y: r.minY))
        p.addQuadCurve(to: CGPoint(x: r.maxX, y: r.minY + rad * 0.8), control: CGPoint(x: r.maxX, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - rad))
        p.addQuadCurve(to: CGPoint(x: r.maxX - rad, y: r.maxY), control: CGPoint(x: r.maxX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX + rad, y: r.maxY))
        p.addQuadCurve(to: CGPoint(x: r.minX, y: r.maxY - rad), control: CGPoint(x: r.minX, y: r.maxY))
        p.closeSubpath()
        return p
    }
}

/// A tile that makes something new (a collection): a dashed outline where the next stack will sit.
public struct NewGroupTile: View {
    let title: String
    @Environment(\.ks) private var t
    public init(_ title: String) { self.title = title }
    public var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "plus").font(.title2.weight(.medium)).foregroundStyle(t.accent)
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(t.ink).multilineTextAlignment(.center).lineLimit(3)
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .frame(minHeight: 120)
        .background(RoundedRectangle(cornerRadius: t.radius, style: .continuous).strokeBorder(t.ink.opacity(0.4), style: StrokeStyle(lineWidth: 1.25, dash: [5, 4])))
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isButton)
    }
}

/// A few pictures from a group, fanned like cards in a hand: the face of a collapsed section.
public struct CoverFan: View {
    let saves: [Save]
    let symbol: String
    let tint: Color
    var size: CGFloat = 44
    /// On a calm shelf: hairlines and no shadow, so the pictures don't outweigh what needs you.
    var calm = false
    @Environment(\.ks) private var t
    public init(_ saves: [Save], symbol: String, tint: Color, size: CGFloat = 44, calm: Bool = false) {
        self.saves = saves; self.symbol = symbol; self.tint = tint; self.size = size; self.calm = calm
    }
    public var body: some View {
        let shown = Array(saves.filter(\.hasImage).prefix(3))
        ZStack {
            if shown.isEmpty {
                Image(systemName: symbol).font(.system(size: size * 0.42, weight: .medium)).foregroundStyle(tint)
                    .frame(width: size, height: size)
                    .ksSurface(t.well, radius: 8, stroke: calm ? t.rule : nil, scale: 0.5, lifted: !calm)
            }
            ForEach(Array(shown.enumerated()), id: \.element.id) { i, save in
                let angle = shown.count == 1 ? 0 : (Double(i) - Double(shown.count - 1) / 2) * 9
                SaveImage(save, symbolSize: size * 0.3)
                    .frame(width: size, height: size)
                    .ksSurface(radius: min(t.radius, 8), stroke: calm ? t.rule : nil, scale: 0.5, lifted: !calm)
                    .rotationEffect(.degrees(angle), anchor: .bottom)
                    .offset(x: CGFloat(i) * size * 0.32 - CGFloat(shown.count - 1) * size * 0.16)
                    .zIndex(Double(i))
            }
        }
        .frame(width: size * 1.7, height: size + 10)
        .accessibilityHidden(true)
    }
}
#endif
