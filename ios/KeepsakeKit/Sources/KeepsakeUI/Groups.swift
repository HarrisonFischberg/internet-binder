#if canImport(UIKit)
import SwiftUI
import KeepsakeKit

/// A group of saves on the table (a collection, or a Lifestyle view): a small stack of cards with one
/// picture from the group on top, its name and how many it holds. Lifestyle groups wear their stamp.
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
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce

    public init(_ title: String, subtitle: String, cover: Save?, symbol: String, tint: Color, kind: String? = nil, selected: Bool = false, compact: Bool = false) {
        self.title = title; self.subtitle = subtitle; self.cover = cover; self.symbol = symbol; self.tint = tint; self.kind = kind; self.selected = selected; self.compact = compact
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    ZStack {
                        if t.style == .pantry, let kind { t.kindFill(kind) } else { t.well }
                        if let cover, cover.hasImage { SaveImage(cover, showsSymbol: false) }
                        else {
                            Image(systemName: symbol).font(.system(size: compact ? 22 : 30, weight: .semibold))
                                .foregroundStyle(t.style == .pantry && kind != nil ? t.onKind : tint)
                        }
                        // Nothing in it yet: a dashed place where its pictures will go.
                        if cover == nil {
                            RoundedRectangle(cornerRadius: max(t.radius - 8, 2)).strokeBorder(t.inkMuted.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3])).padding(compact ? 6 : 10)
                        }
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: max(t.radius - 6, 0), style: .continuous))
                .overlay(alignment: .topTrailing) {
                    if let kind { Stamp(kind: kind, size: compact ? 22 : 28).padding(compact ? 4 : 6) }
                }
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(KSFont.name(compact ? .subheadline : .headline)).foregroundStyle(t.ink)
                    .lineLimit(2).minimumScaleFactor(0.75).allowsTightening(true)
                Text(subtitle).font(.footnote).foregroundStyle(t.inkMuted).lineLimit(1)
            }
            .padding(.horizontal, 2)
        }
        .padding(8)
        .ksSurface(nil, stroke: selected ? t.ink : nil)
        .overlay {
            if selected && t.outline == 0 { RoundedRectangle(cornerRadius: t.radius, style: .continuous).strokeBorder(t.ink, lineWidth: 2) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(subtitle)")
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
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
        .background(RoundedRectangle(cornerRadius: t.radius, style: .continuous).strokeBorder(t.ink.opacity(0.4), style: StrokeStyle(lineWidth: t.style == .pantry ? 2 : 1.25, dash: [5, 4])))
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
