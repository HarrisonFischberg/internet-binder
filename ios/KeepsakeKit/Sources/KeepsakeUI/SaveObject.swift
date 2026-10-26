#if canImport(UIKit)
import SwiftUI
import KeepsakeKit

/// A save as a card in the current style: its picture (or, without one, what the style makes of it:
/// a jar label, an index card, a plate, a monogram, a numbered cell), its kind, its name and the one
/// fact that matters. One accessibility element: "{title}, {kind}, {fact}" plus its state.
public struct SaveObject: View {
    let save: Save
    /// Smaller type and picture, for the style previews in Appearance.
    let compact: Bool
    @Environment(\.ks) private var t
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
public struct ShelfCard: View {
    let save: Save
    let width: CGFloat
    /// Grows with Dynamic Type, so the name and fact keep their room.
    @ScaledMetric(relativeTo: .headline) private var textHeight: CGFloat = 78
    /// Pantry Pop on Home: a save without a picture is a soft-tinted jar, so only Review is loud.
    let calm: Bool
    public init(_ save: Save, width: CGFloat, calm: Bool = false) { self.save = save; self.width = width; self.calm = calm }

    private var done: Bool { save.status == "done" || save.purchased == true }

    public var body: some View {
        SaveCard(save: save, compact: false, pictureHeight: width * 0.72, fixedHeight: width * 0.72 + textHeight + 6, calm: calm)
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
    var calm = false
    @Environment(\.ks) private var t
    /// Room kept under the name for the state badge, so the badge never sits on the words.
    @ScaledMetric(relativeTo: .caption2) private var badgeHeight: CGFloat = 20
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
            if save.hasImage { pictured } else { placeholder }
        }
        .overlay(alignment: .bottomTrailing) { badge }
    }

    // MARK: with a picture

    @ViewBuilder private var pictured: some View {
        let h = pictureHeight ?? (compact ? 96 : 150)
        switch t.style {
        case .gallery:
            VStack(alignment: .leading, spacing: 8) {
                SaveImage(save).frame(height: h).frame(maxWidth: .infinity).clipped()
                caption
            }
            .frame(height: fixedHeight, alignment: .top)
        case .notebook:
            VStack(alignment: .leading, spacing: 8) {
                SaveImage(save).frame(height: h).frame(maxWidth: .infinity).clipped()
                    .padding(4).background(t.paper).resting()
                    .overlay(alignment: .topLeading) { Tape().offset(x: -8, y: -4) }
                caption.padding(.horizontal, 2)
            }
            .frame(height: fixedHeight, alignment: .top)
        case .pantry, .atlas:
            glassPictured(h)
        default:
            VStack(alignment: .leading, spacing: 0) {
                SaveImage(save).frame(height: h).frame(maxWidth: .infinity).clipped()
                    .overlay(alignment: .topLeading) { if t.style == .pantry { Sticker(kind: save.kind).padding(10) } }
                if t.outline > 0 { Rectangle().fill(t.style == .pantry ? t.line : t.rule).frame(height: t.outline) }
                caption.padding(compact ? 8 : 12)
            }
            .frame(height: fixedHeight, alignment: .top)
            .clipped()
            .ksSurface()
        }
    }

    /// Pantry Pop and Night Atlas: the picture fills the card and the name sits on a clear glass label
    /// inside it, over a dimmed band so white text keeps its contrast on any picture.
    private func glassPictured(_ h: CGFloat) -> some View {
        let total = fixedHeight ?? (h + (compact ? 48 : 76))
        return SaveImage(save).frame(maxWidth: .infinity).frame(height: total).clipped()
            .overlay(alignment: .bottom) {
                LinearGradient(colors: [.black.opacity(0), .black.opacity(0.5)], startPoint: .top, endPoint: .bottom)
                    .frame(height: total * 0.6).allowsHitTesting(false)
            }
            .overlay(alignment: .topLeading) {
                if t.style == .pantry {
                    Sticker(kind: save.kind).padding(10)
                } else {
                    Label(kind.label, systemImage: kind.symbol).font(.caption.weight(.semibold)).labelStyle(.titleAndIcon)
                        .foregroundStyle(.white).padding(.horizontal, 9).padding(.vertical, 5)
                        .glassEffect(.clear, in: .capsule).padding(10)
                }
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(save.title).font(KSFont.name(compact ? .subheadline : .headline, t)).foregroundStyle(.white)
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    if !fact.isEmpty && !compact {
                        Text(fact).font(KSFont.fact(t)).foregroundStyle(.white.opacity(0.9)).lineLimit(1)
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .glassEffect(.clear, in: .rect(cornerRadius: max(t.radius - 6, 10)))
                .padding(8).padding(.bottom, badgeRoom)
            }
            .ksSurface()
    }

    private var caption: some View {
        VStack(alignment: .leading, spacing: 3) {
            if t.style != .pantry { KindLabel(kind: save.kind, fact: t.monoLabels ? fact : nil) }
            Text(save.title).font(KSFont.name(compact ? .subheadline : .headline, t)).foregroundStyle(t.ink)
                .lineLimit(compact || fixedHeight != nil ? 2 : 3).fixedSize(horizontal: false, vertical: true)
            if !fact.isEmpty && !t.monoLabels && !compact {
                Text(fact).font(KSFont.fact(t)).foregroundStyle(t.inkMuted).lineLimit(2)
            }
        }
        .padding(.bottom, badgeRoom)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: without a picture

    @ViewBuilder private var placeholder: some View {
        let minH: CGFloat = pictureHeight.map { $0 + 40 } ?? (compact ? 130 : 200)
        switch t.style {
        case .pantry: jar(minH)
        case .notebook: indexCard(minH)
        case .gallery: plate(minH)
        case .atlas: monogram(minH)
        case .swiss: cell(minH)
        }
    }

    /// Pantry Pop: a solid jar label in the kind's colour, with a lid and the name set big. Calm (Home):
    /// the kind's soft tint with its name in the kind's colour, a hairline and no shadow.
    private func jar(_ minH: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(kind.label.uppercased(), systemImage: kind.symbol)
                .font(.caption.weight(.black)).tracking(1.2).labelStyle(.titleAndIcon)
                .foregroundStyle(calm ? t.kind(save.kind) : t.onKind)
            Spacer(minLength: 12)
            Text(save.title).font(KSFont.name(compact ? .headline : .title2, t)).lineLimit(4).minimumScaleFactor(0.8)
            if !fact.isEmpty { Text(fact).font(.footnote.weight(.bold)).lineLimit(2).foregroundStyle(calm ? t.inkMuted : t.onKind) }
        }
        .foregroundStyle(calm ? t.ink : t.onKind)
        .padding(.horizontal, 14).padding(.top, 22).padding(.bottom, 14 + badgeRoom)
        .frame(maxWidth: .infinity, minHeight: fixedHeight ?? minH, maxHeight: fixedHeight, alignment: .topLeading).clipped()
        .background(alignment: .top) { Lid().fill((calm ? t.kind(save.kind) : t.onKind).opacity(calm ? 0.12 : 0.18)).frame(height: 12) }
        .ksSurface(calm ? t.kindSoft(save.kind) : t.kindFill(save.kind), stroke: calm ? t.rule : nil, lifted: !calm)
    }

    /// Field Notebook: a ruled index card with the name written on it.
    private func indexCard(_ minH: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            KindLabel(kind: save.kind, fact: nil)
            Text(save.title).font(KSFont.name(compact ? .subheadline : .title3, t)).foregroundStyle(t.ink).lineLimit(4)
            Spacer(minLength: 0)
            if !fact.isEmpty { Text(fact.uppercased()).font(KSFont.label(t)).foregroundStyle(t.inkMuted).lineLimit(2) }
        }
        .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 12 + badgeRoom)
        .frame(maxWidth: .infinity, minHeight: fixedHeight ?? minH, maxHeight: fixedHeight, alignment: .topLeading).clipped()
        .background {
            Canvas { ctx, size in
                var lines = Path()
                for y in stride(from: 46.0, to: size.height, by: 16) { lines.move(to: CGPoint(x: 0, y: y)); lines.addLine(to: CGPoint(x: size.width, y: y)) }
                ctx.stroke(lines, with: .color(t.accent.opacity(0.14)), lineWidth: 1)
                ctx.fill(Path(CGRect(x: 0, y: 30, width: size.width, height: 1)), with: .color(t.stamp.opacity(0.4)))
            }
        }
        .background(t.paper)
        .resting()
    }

    /// Gallery: a softly tinted plate with the one detail that names the save, set like a title page.
    private func plate(_ minH: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading) {
                Text(kind.label).font(.caption).foregroundStyle(t.inkMuted)
                Spacer(minLength: 10)
                Text(mark).font(.system(compact ? .title3 : .title, design: .serif)).foregroundStyle(t.ink).lineLimit(3).minimumScaleFactor(0.7)
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: minH - 50, maxHeight: fixedHeight.map { $0 - 50 }, alignment: .topLeading)
            .background(t.kindFill(save.kind))
            caption
        }
    }

    private var mark: String {
        let d = save.details
        switch save.kind {
        case "book": return d?["author"]?.string ?? save.title
        case "media": return d?["year"]?.number.map { String(Int($0)) } ?? save.title
        case "place": return d?["locality"]?.string ?? save.title
        case "article": return d?["siteName"]?.string ?? save.host ?? save.title
        default: return save.title
        }
    }

    /// Night Atlas: a dark monogram card with a dotted route in the kind's colour.
    private func monogram(_ minH: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(String(save.title.prefix(1)).uppercased()).font(.system(size: compact ? 34 : 52, weight: .bold)).foregroundStyle(t.kind(save.kind))
                .accessibilityHidden(true)
            Path { p in p.move(to: CGPoint(x: 0, y: 6)); p.addCurve(to: CGPoint(x: 120, y: 2), control1: CGPoint(x: 40, y: -6), control2: CGPoint(x: 80, y: 16)) }
                .stroke(t.kind(save.kind).opacity(0.7), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [1, 5]))
                .frame(height: 14)
            Spacer(minLength: 0)
            caption
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: fixedHeight ?? minH, maxHeight: fixedHeight, alignment: .topLeading).clipped()
        .ksSurface(t.well)
    }

    /// Swiss Index: a white cell with the kind as a label and its code set huge.
    private func cell(_ minH: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            KindLabel(kind: save.kind, fact: nil)
            Spacer(minLength: 8)
            Text(kind.code).font(.system(size: compact ? 40 : 64, weight: .bold).width(.condensed)).foregroundStyle(t.ink).accessibilityHidden(true)
            Text(save.title).font(KSFont.name(compact ? .subheadline : .headline, t)).foregroundStyle(t.ink).lineLimit(3)
            if !fact.isEmpty && !compact { Text(fact).font(KSFont.fact(t)).foregroundStyle(t.inkMuted).lineLimit(2) }
        }
        .padding(12).padding(.bottom, badgeRoom)
        .frame(maxWidth: .infinity, minHeight: fixedHeight ?? minH, maxHeight: fixedHeight, alignment: .topLeading).clipped()
        .ksSurface()
    }

    @ViewBuilder private var badge: some View {
        let text = Self.state(save)
        if !text.isEmpty {
            let done = save.status == "done" || save.purchased == true
            Label(text, systemImage: save.isFinishing ? "hourglass" : done ? "checkmark" : "tray")
                .font(.caption2.weight(.bold))
                .foregroundStyle(done ? t.ink : t.onHighlight)
                .padding(.horizontal, 7).padding(.vertical, 4)
                .background(done ? t.paper : t.highlight, in: ControlShape(radius: t.controlRadius))
                .overlay { ControlShape(radius: t.controlRadius).strokeBorder(t.style == .pantry ? t.line : .clear, lineWidth: 1.5) }
                .padding(8)
                .accessibilityHidden(true)
        }
    }
}

/// A strip of tape holding a photo in the notebook.
struct Tape: View {
    @Environment(\.ks) private var t
    var body: some View {
        Rectangle().fill(Color(red: 0.84, green: 0.77, blue: 0.59).opacity(0.7)).frame(width: 34, height: 12).rotationEffect(.degrees(-38))
            .accessibilityHidden(true)
    }
}

/// The ribbed lid on a jar label.
struct Lid: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        for x in stride(from: r.minX, to: r.maxX, by: 8) { p.addRect(CGRect(x: x, y: r.minY, width: 3, height: r.height)) }
        return p
    }
}

/// Pantry Pop's kind sticker: the kind's colour, an ink outline and a small hard shadow.
public struct Sticker: View {
    let kind: String
    @Environment(\.ks) private var t
    public init(kind: String) { self.kind = kind }
    public var body: some View {
        let k = KindStyle(kind)
        Label(k.label, systemImage: k.symbol)
            .font(.caption.weight(.heavy)).labelStyle(.titleAndIcon)
            .foregroundStyle(t.onKind)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(t.kindFill(kind), in: Capsule())
            .overlay(Capsule().strokeBorder(t.onKind, lineWidth: 2))
            .compositingGroup()
            .shadow(color: t.onKind, radius: 0, x: 2, y: 2)
            .accessibilityHidden(true)
    }
}

/// The kind as a small label: icon and word (colour is never the only signal). Pantry Pop shows a
/// sticker; Field Notebook and Night Atlas a mono line ("RECIPE · 6 INGREDIENTS").
public struct KindLabel: View {
    let kind: String
    let fact: String?
    @Environment(\.ks) private var t
    public init(kind: String, fact: String? = nil) { self.kind = kind; self.fact = fact }
    public var body: some View {
        let k = KindStyle(kind)
        switch t.style {
        case .pantry: Sticker(kind: kind)
        case .notebook, .atlas:
            Text(([k.label] + [fact].compactMap { $0 }.filter { !$0.isEmpty }).joined(separator: " · ").uppercased())
                .font(KSFont.label(t)).tracking(0.8).foregroundStyle(t.style == .atlas ? t.kind(kind) : t.inkMuted).lineLimit(1)
        case .gallery: Text(k.label).font(KSFont.label(t)).foregroundStyle(t.inkMuted)
        case .swiss: Text(k.label.uppercased()).font(KSFont.label(t)).tracking(0.9).foregroundStyle(t.inkMuted)
        }
    }
}

/// A kind's small mark (on a group's cover, a map).
public struct Stamp: View {
    let kind: String
    var size: CGFloat = 30
    @Environment(\.ks) private var t
    public init(kind: String, size: CGFloat = 30) { self.kind = kind; self.size = size }
    public var body: some View {
        let k = KindStyle(kind)
        let pantry = t.style == .pantry
        Image(systemName: k.symbol)
            .font(.system(size: size * 0.42, weight: .bold))
            .foregroundStyle(pantry ? t.onKind : t.kind(kind))
            .frame(width: size, height: size)
            .background(pantry ? t.kindFill(kind) : t.paper, in: Circle())
            .overlay(Circle().strokeBorder(pantry ? t.onKind : t.rule, lineWidth: pantry ? 2 : 1))
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
