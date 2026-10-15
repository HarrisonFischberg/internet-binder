#if canImport(UIKit)
import SwiftUI
import KeepsakeKit

/// A save drawn as the object of its kind (replica/m3/design-principles.md §3): a place is a postcard
/// with a stamp, a recipe a ruled card, a film a ticket stub, a book a cover, a product a photo with a
/// swing tag, an article a clipping, a workout a punched training card, a link a plain label.
/// One accessibility element: "{title}, {kind}, {fact}" plus its state.
public struct SaveObject: View {
    let save: Save
    @Environment(\.ks) private var t
    @Environment(\.appearance) private var look
    public init(_ save: Save) { self.save = save }

    private var kind: KindStyle { KindStyle(save.kind) }
    private var fact: String { save.fact ?? "" }
    private var done: Bool { save.status == "done" || save.purchased == true }

    public var body: some View {
        object
            // Objects keep their own height in rows (strips and stubs are shapes that would stretch).
            .fixedSize(horizontal: false, vertical: true)
            .saturation(done ? 0.4 : 1)
            .overlay(alignment: .topLeading) { badge }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel([save.title, kind.label, fact, stateText].filter { !$0.isEmpty }.joined(separator: ", "))
            .accessibilityAddTraits(.isButton)
    }

    private var stateText: String {
        if save.isFinishing { return "Finishing details" }
        if save.needsCollection && save.purchased != true { return "Needs a collection" }
        if save.purchased == true { return "Bought" }
        if save.status == "done" { return "Done" }
        return ""
    }

    @ViewBuilder private var badge: some View {
        let text = stateText
        if !text.isEmpty {
            Label(text, systemImage: save.isFinishing ? "hourglass" : done ? "checkmark" : "tray")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(t.ink)
                .padding(.horizontal, 7).padding(.vertical, 4)
                .background(t.paper.opacity(0.94), in: Capsule())
                .overlay(Capsule().strokeBorder(t.rule, lineWidth: 0.5))
                .padding(10)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder private var object: some View {
        if look.density == "compact" { compact }
        else if look.cardStyle == "plain" { plain }
        else { kindObject }
    }

    /// Compact: an even grid of small tiles (Cabinet's tray grid, D14): picture and name only.
    private var compact: some View {
        VStack(alignment: .leading, spacing: 6) {
            SaveImage(save, symbolSize: 20).aspectRatio(1, contentMode: .fill).frame(minHeight: 0).clipped()
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .overlay(alignment: .topTrailing) { Stamp(kind: save.kind, size: 20).padding(4) }
            Text(save.title).font(KSFont.name(.footnote)).foregroundStyle(t.ink).lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(5).background(t.paper).resting()
    }

    /// Plain: one simple card for every kind (Settings → Appearance → Cards).
    private var plain: some View {
        VStack(alignment: .leading, spacing: 8) {
            if save.hasImage { SaveImage(save).frame(height: 130).clipped().clipShape(RoundedRectangle(cornerRadius: 8)) }
            KindLabel(kind: save.kind)
            caption()
        }
        .padding(10)
        .background(t.paper, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.rule, lineWidth: 0.5))
    }

    @ViewBuilder private var kindObject: some View {
        switch save.kind {
        case "place": postcard
        case "recipe": recipeCard
        case "media": ticket
        case "book": book
        case "product": tagged
        case "video": frame
        case "article": clipping
        case "workout": training
        default: label
        }
    }

    private func caption(lines: Int = 3) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(save.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(lines)
            if !fact.isEmpty { Text(fact).font(KSFont.fact).foregroundStyle(t.inkMuted).lineLimit(3) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var postcard: some View {
        VStack(alignment: .leading, spacing: 9) {
            SaveImage(save).frame(height: 150).clipped()
                .overlay(alignment: .topTrailing) { Stamp(kind: save.kind).padding(7) }
            caption().padding(.horizontal, 2)
        }
        .padding(7).padding(.bottom, 4)
        .background(t.paper)
        .resting()
    }

    private var recipeCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            if save.hasImage { SaveImage(save).frame(height: 96).clipped() }
            Rectangle().fill(t.stamp.opacity(0.7)).frame(height: 1.5)
            VStack(alignment: .leading, spacing: 0) {
                Text(save.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(3).padding(.top, 8).padding(.bottom, 4)
                ForEach(Array([fact, save.note ?? ""].filter { !$0.isEmpty }.enumerated()), id: \.offset) { _, line in
                    Text(line).font(KSFont.note).foregroundStyle(t.inkMuted).lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: 20, alignment: .bottomLeading)
                        .overlay(alignment: .bottom) { Rectangle().fill(t.accent.opacity(0.22)).frame(height: 0.75) }
                }
            }
            .padding(.horizontal, 10).padding(.bottom, 10)
        }
        .background(t.paper)
        .resting()
    }

    private var ticket: some View {
        let year = save.details?["year"]?.number.map { String(Int($0)) } ?? ""
        return HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text("ADMIT ONE").font(.caption2.monospaced().weight(.bold)).tracking(1.5).foregroundStyle(kind.color)
                Text(save.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(3)
                Text(save.details?["format"]?.string == "series" ? "Series" : "Film").font(KSFont.fact).foregroundStyle(t.inkMuted)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(year).font(.footnote.monospaced().weight(.semibold)).foregroundStyle(kind.color)
                .rotationEffect(.degrees(-90)).fixedSize()
                .frame(width: 54).frame(maxHeight: .infinity)
                .overlay(alignment: .leading) {
                    VLine().stroke(t.inkMuted.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [3, 3])).frame(width: 1).padding(.vertical, 10)
                }
        }
        .frame(minHeight: 104)
        .background(TicketShape().fill(t.paper))
        .compositingGroup()
        .resting()
    }

    private var book: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .leading) {
                if save.hasImage { SaveImage(save) } else { kind.color.opacity(0.85) }
                LinearGradient(colors: [.black.opacity(0.35), .white.opacity(0.12), .clear], startPoint: .leading, endPoint: .trailing).frame(width: 14)
                if !save.hasImage {
                    Text(save.title).font(KSFont.name(.headline)).foregroundStyle(.white).multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity).padding(.horizontal, 18)
                }
            }
            .aspectRatio(1 / 1.45, contentMode: .fit)
            .clipShape(UnevenRoundedRectangle(bottomTrailingRadius: 3, topTrailingRadius: 3))
            .resting()
            if save.hasImage { Text(save.title).font(KSFont.name(.subheadline)).foregroundStyle(t.ink).lineLimit(2) }
            if !fact.isEmpty { Text(fact).font(KSFont.fact).foregroundStyle(t.inkMuted) }
        }
    }

    private var tagged: some View {
        VStack(alignment: .leading, spacing: 9) {
            SaveImage(save).frame(height: 170).clipped()
                .overlay(alignment: .bottomTrailing) {
                    if !fact.isEmpty {
                        Text(fact).font(.system(.subheadline, design: .serif).weight(.semibold)).foregroundStyle(t.ink)
                            .padding(.horizontal, 10).padding(.top, 20).padding(.bottom, 8)
                            .background(TagShape().fill(t.paper).resting())
                            .rotationEffect(.degrees(-7)).padding(10)
                    }
                }
            VStack(alignment: .leading, spacing: 3) {
                Text(save.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(3)
                if let shop = save.retailer, !shop.isEmpty { Text(shop).font(KSFont.fact).foregroundStyle(t.inkMuted) }
            }
            .padding(.horizontal, 2)
        }
        .padding(7).padding(.bottom, 4)
        .background(t.paper)
        .resting()
    }

    private var frame: some View {
        VStack(alignment: .leading, spacing: 9) {
            SaveImage(save, showsSymbol: false).frame(height: 110).clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay {
                    Image(systemName: "play.fill").font(.system(size: 15)).foregroundStyle(t.ink)
                        .frame(width: 38, height: 38).background(t.paper.opacity(0.92), in: Circle())
                }
                .padding(7)
                .background(Color(white: 0.13), in: RoundedRectangle(cornerRadius: 12)) // a screen's bezel: dark in both modes
                .resting()
            caption()
        }
    }

    private var clipping: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let site = save.details?["siteName"]?.string ?? save.host, !site.isEmpty {
                Text(site.uppercased()).font(.caption2.weight(.bold)).tracking(1.6).foregroundStyle(kind.color).lineLimit(2)
            }
            Text(save.title).font(KSFont.name(.title3)).foregroundStyle(t.ink).lineLimit(4)
            if let d = save.description, !d.isEmpty { Text(d).font(.system(.footnote, design: .serif)).foregroundStyle(t.inkMuted).lineLimit(3) }
            if !fact.isEmpty { Text(fact).font(KSFont.fact).foregroundStyle(t.inkMuted) }
        }
        .padding(.horizontal, 12).padding(.top, 18).padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ClippingShape().fill(t.paper))
        .resting()
    }

    private var training: some View {
        HStack(spacing: 0) {
            Perforated(bite: 3.2, spacing: 13, edges: .leading).fill(kind.color.opacity(0.85)).frame(width: 14)
            VStack(alignment: .leading, spacing: 8) {
                KindLabel(kind: save.kind)
                caption()
            }
            .padding(10)
        }
        .background(t.paper)
        .resting()
    }

    private var label: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().strokeBorder(t.inkMuted, lineWidth: 1).frame(width: 9, height: 9)
                Text(save.host ?? "").font(KSFont.label).foregroundStyle(t.inkMuted).lineLimit(1)
            }
            Text(save.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(4)
            if let note = save.note, !note.isEmpty { Text(note).font(KSFont.note).foregroundStyle(t.inkMuted).lineLimit(2) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(t.paper)
        .resting()
    }
}

/// The kind as a small coloured label: icon and word (colour is never the only signal).
public struct KindLabel: View {
    let kind: String
    public init(kind: String) { self.kind = kind }
    public var body: some View {
        let k = KindStyle(kind)
        Label(k.label, systemImage: k.symbol).font(KSFont.label).foregroundStyle(k.color).labelStyle(.titleAndIcon)
    }
}

/// A postage stamp with the kind's mark.
public struct Stamp: View {
    let kind: String
    var size: CGFloat = 30
    @Environment(\.ks) private var t
    public init(kind: String, size: CGFloat = 30) { self.kind = kind; self.size = size }
    public var body: some View {
        let k = KindStyle(kind)
        Image(systemName: k.symbol)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(k.color)
            .frame(width: size, height: size * 1.18)
            .background(RoundedRectangle(cornerRadius: 1).stroke(k.color.opacity(0.5), lineWidth: 0.75).padding(3.5))
            .background(Perforated(bite: 1.6, spacing: 5).fill(t.paper))
            .compositingGroup()
            .shadow(color: .black.opacity(0.18), radius: 1, y: 0.5)
            .rotationEffect(.degrees(4))
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
                            ForEach(chunk.indices.filter { ($0 - start) % n == col }.map { saves[$0] }) { content($0) }
                        }
                        .frame(maxWidth: .infinity, alignment: .top)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }
}
#endif
