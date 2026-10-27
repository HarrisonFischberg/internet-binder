#if canImport(UIKit)
import SwiftUI
import KeepsakeKit

/// A save as a card in the current style: its picture (or, without one, a themed placeholder with
/// the kind's symbol), its kind, its name and the one fact that matters. One accessibility element:
/// "{title}, {kind}, {fact}" plus its state.
public struct SaveObject: View {
    let save: Save
    /// Smaller type and picture, for the style previews in Appearance.
    let compact: Bool
    public init(_ save: Save, compact: Bool = false) { self.save = save; self.compact = compact }

    private var done: Bool { save.status == "done" || save.purchased == true }

    public var body: some View {
        SaveCard(save: save, compact: compact)
            .fixedSize(horizontal: false, vertical: true)
            .saturation(done ? 0.4 : 1)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(SaveCard.spoken(save))
    }
}

/// A save on Home's Recent shelf: every card the same size, so the row reads as one even line.
/// Paper & Ink sets the picture on the page with the name under it, like a photo in a scrapbook
/// page; Nocturne and Chromatic lay the name over the picture's darkened foot.
public struct ShelfCard: View {
    let save: Save
    let width: CGFloat
    /// Grows with Dynamic Type, so the name keeps its two lines.
    @ScaledMetric(relativeTo: .headline) private var textHeight: CGFloat = 54
    public init(_ save: Save, width: CGFloat) { self.save = save; self.width = width }

    private var done: Bool { save.status == "done" || save.purchased == true }

    public var body: some View {
        SaveCard(save: save, compact: false, pictureHeight: width * 1.05, fixedHeight: width * 1.05 + textHeight, shelf: true)
            .frame(width: width)
            .saturation(done ? 0.4 : 1)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(SaveCard.spoken(save))
    }
}

struct SaveCard: View {
    let save: Save
    var compact = false
    var pictureHeight: CGFloat?
    var fixedHeight: CGFloat?
    /// Home's Recent shelf.
    var shelf = false
    @Environment(\.ks) private var t
    /// Room kept under the name for the state badge, so the badge never sits on the words.
    @ScaledMetric(relativeTo: .caption2) private var badgeHeight: CGFloat = 24
    private var badgeRoom: CGFloat { Self.state(save).isEmpty ? 0 : badgeHeight }

    private var kind: KindStyle { KindStyle(save.kind) }
    private var fact: String { save.fact ?? "" }

    static func spoken(_ save: Save) -> String {
        [save.title, KindStyle(save.kind).label, save.fact ?? "", state(save)].filter { !$0.isEmpty }.joined(separator: ", ")
    }
    static func state(_ save: Save) -> String {
        if save.isFinishing { return "Finishing details" }
        if save.needsCollection && save.purchased != true { return "Needs a collection" }
        if save.purchased == true { return "Bought" }
        if save.status == "done" { return "Done" }
        return ""
    }

    var body: some View {
        Group {
            if t.style == .paper { paperCard } else { overlaidCard }
        }
        // Paper's shelf keeps the badge on the picture: its fixed height has room for the name only.
        .overlay(alignment: .bottomTrailing) { if !(t.style == .paper && shelf) { badge } }
    }

    // MARK: Nocturne and Chromatic: the picture fills the card, the name on its darkened foot

    private var overlaidCard: some View {
        let h = pictureHeight ?? (compact ? 120 : 190)
        let total = fixedHeight ?? (h + (compact ? 36 : 56))
        return ZStack(alignment: .bottomLeading) {
            if save.hasImage {
                SaveImage(save).frame(maxWidth: .infinity).frame(height: total).clipped()
                // A scrim only behind the words, so the picture stays clear above them.
                LinearGradient(stops: [.init(color: .black.opacity(0), location: 0), .init(color: .black.opacity(0.55), location: 0.55), .init(color: .black.opacity(0.78), location: 1)],
                               startPoint: .top, endPoint: .bottom)
                    .frame(height: min(total * 0.62, 150)).allowsHitTesting(false)
            } else {
                Placeholder(save: save, compact: compact).frame(maxWidth: .infinity).frame(height: total)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(save.title).font(KSFont.name(compact ? .subheadline : .headline, t)).foregroundStyle(save.hasImage ? .white : t.ink)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    .shadow(color: save.hasImage ? .black.opacity(0.4) : .clear, radius: 2, y: 1)
                if !fact.isEmpty && !compact && !shelf {
                    Text(fact).font(KSFont.fact(t)).foregroundStyle(save.hasImage ? .white.opacity(0.88) : t.inkMuted).lineLimit(1)
                }
            }
            .padding(.horizontal, compact ? 10 : 12).padding(.bottom, (compact ? 10 : 12) + badgeRoom)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: total)
        .overlay(alignment: .topLeading) { KindBadge(kind: save.kind).padding(compact ? 8 : 10) }
        .ksSurface(t.well)
    }

    // MARK: Paper & Ink: a picture with the words under it

    private var paperCard: some View {
        let h = pictureHeight ?? (compact ? 96 : 150)
        return VStack(alignment: .leading, spacing: shelf ? 8 : 0) {
            Group {
                if save.hasImage { SaveImage(save) } else { Placeholder(save: save, compact: compact || shelf) }
            }
            .frame(height: h).frame(maxWidth: .infinity).clipped()
            .clipShape(RoundedRectangle(cornerRadius: shelf ? 12 : 0, style: .continuous))
            .overlay(alignment: .bottomLeading) { if shelf { badge } }
            VStack(alignment: .leading, spacing: 3) {
                if !shelf { KindLabel(kind: save.kind) }
                Text(save.title).font(KSFont.name(compact || shelf ? .subheadline : .headline, t)).foregroundStyle(t.ink)
                    .lineLimit(shelf || compact ? 2 : 3).fixedSize(horizontal: false, vertical: true)
                if !fact.isEmpty && !compact && !shelf {
                    Text(fact).font(KSFont.fact(t)).foregroundStyle(t.inkMuted).lineLimit(2)
                }
            }
            .padding(.horizontal, shelf ? 2 : (compact ? 10 : 12)).padding(.vertical, shelf ? 0 : (compact ? 8 : 10))
            .padding(.bottom, shelf ? 0 : badgeRoom)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: fixedHeight, alignment: .top)
        .modifier(PaperCardSurface(on: !shelf))
    }

    @ViewBuilder private var badge: some View {
        let text = Self.state(save)
        if !text.isEmpty {
            let done = save.status == "done" || save.purchased == true
            Label(text, systemImage: save.isFinishing ? "hourglass" : done ? "checkmark" : "tray")
                .font(.caption2.weight(.bold))
                .foregroundStyle(done ? t.ink : t.onHighlight)
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(done ? t.well : t.highlight, in: Capsule())
                .overlay { if done { Capsule().strokeBorder(t.rule, lineWidth: 1) } }
                .padding(8)
                .accessibilityHidden(true)
        }
    }
}

/// A card's surface in Paper & Ink, or nothing (the shelf sets pictures straight on the page).
private struct PaperCardSurface: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on { content.ksSurface() } else { content }
    }
}

/// What a save without a picture shows: the kind's own tint, its symbol large and quiet, and (for a
/// book, a film, a place or an article) the one detail that names it. Never a made-up picture.
struct Placeholder: View {
    let save: Save
    var compact = false
    @Environment(\.ks) private var t
    var body: some View {
        let k = KindStyle(save.kind)
        ZStack(alignment: .topTrailing) {
            switch t.style {
            case .nocturne:
                // A night panel lit by the kind's colour from one corner.
                t.well
                RadialGradient(colors: [t.kind(save.kind).opacity(0.28), .clear], center: .topTrailing, startRadius: 0, endRadius: compact ? 120 : 200)
            case .paper:
                t.kindFill(save.kind)
            case .chromatic:
                t.kindSoft(save.kind)
                LinearGradient(colors: [t.kindFill(save.kind).opacity(0.35), .clear], startPoint: .topTrailing, endPoint: .bottomLeading)
            }
            Image(systemName: k.symbol)
                .font(.system(size: compact ? 30 : 46, weight: .light))
                .foregroundStyle(t.style == .paper ? t.onKind.opacity(0.55) : t.kind(save.kind).opacity(0.85))
                .padding(compact ? 12 : 16)
                .padding(.top, compact ? 22 : 30)
        }
        .accessibilityHidden(true)
    }
}

/// The kind on a picture: a small dark capsule with its symbol and word (colour is never the only
/// signal). Nocturne and Chromatic only; Paper & Ink names the kind under the picture.
public struct KindBadge: View {
    let kind: String
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceTransparency) private var solid
    public init(kind: String) { self.kind = kind }
    public var body: some View {
        if t.style != .paper {
            let k = KindStyle(kind)
            Label(k.label, systemImage: k.symbol)
                .font(.caption.weight(.semibold)).labelStyle(.titleAndIcon)
                .foregroundStyle(.white)
                .padding(.horizontal, 9).padding(.vertical, 5)
                .background(.black.opacity(solid ? 0.8 : 0.5), in: Capsule())
                .overlay(Capsule().strokeBorder(.white.opacity(0.18), lineWidth: 1))
                .accessibilityHidden(true)
        }
    }
}

/// The kind as a small label: symbol and word in the kind's colour.
public struct KindLabel: View {
    let kind: String
    let fact: String?
    @Environment(\.ks) private var t
    public init(kind: String, fact: String? = nil) { self.kind = kind; self.fact = fact }
    public var body: some View {
        let k = KindStyle(kind)
        let words = ([k.label] + [fact].compactMap { $0 }.filter { !$0.isEmpty }).joined(separator: " · ")
        Label(t.style == .paper ? words.uppercased() : words, systemImage: k.symbol)
            .labelStyle(.titleAndIcon)
            .font(KSFont.label(t)).tracking(t.style == .paper ? 0.8 : 0)
            .foregroundStyle(t.kind(kind)).lineLimit(1)
    }
}

/// A kind's small mark (on a group's cover, a map, a widget).
public struct Stamp: View {
    let kind: String
    var size: CGFloat = 30
    @Environment(\.ks) private var t
    public init(kind: String, size: CGFloat = 30) { self.kind = kind; self.size = size }
    public var body: some View {
        let k = KindStyle(kind)
        Image(systemName: k.symbol)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(t.onKind)
            .frame(width: size, height: size)
            .background(t.kindFill(kind), in: Circle())
            .overlay(Circle().strokeBorder(.black.opacity(0.12), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

/// Columns that keep each object's own height. With `columns` nil, as many as fit (at least
/// `minColumnWidth` wide): two on iPhone, three to five on iPad.
///
/// Laid out in blocks of `block` saves inside a lazy stack, so only the blocks on screen are built:
/// 5,000 saves cost what one screen costs. Columns even out at each block's end.
public struct Masonry<Content: View>: View {
    let saves: [Save]
    var columns: Int?
    var spacing: CGFloat
    var minColumnWidth: CGFloat
    var block: Int
    let content: (Save) -> Content
    @State private var width: CGFloat = 0
    public init(_ saves: [Save], columns: Int? = nil, spacing: CGFloat = 16, minColumnWidth: CGFloat = 170, block: Int = 24,
                @ViewBuilder content: @escaping (Save) -> Content) {
        self.saves = saves; self.columns = columns; self.spacing = spacing; self.minColumnWidth = minColumnWidth; self.block = block; self.content = content
    }
    private var count: Int { columns ?? max(2, Int((width + spacing) / (minColumnWidth + spacing))) }

    public var body: some View {
        let n = count
        let size = max(n, (block / n) * n)
        let starts = Array(stride(from: 0, to: saves.count, by: size))
        LazyVStack(spacing: spacing + 6) {
            ForEach(starts, id: \.self) { start in
                let chunk = saves[start..<min(start + size, saves.count)]
                HStack(alignment: .top, spacing: spacing) {
                    ForEach(0..<n, id: \.self) { col in
                        VStack(spacing: spacing + 6) {
                            ForEach(chunk.indices.filter { ($0 - start) % n == col }.map { (i: $0, save: saves[$0]) }, id: \.save.id) { e in
                                content(e.save).accessibilitySortPriority(Double(start + size - e.i))
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .top)
                    }
                }
                .accessibilityElement(children: .contain)
            }
        }
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}
#endif
