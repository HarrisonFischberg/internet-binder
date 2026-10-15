import SwiftUI

// MARK: - Shapes

/// A rectangle with round bites along its edges: a stamp, or a punched strip.
struct Perforated: Shape {
    var bite: CGFloat = 2.6
    var spacing: CGFloat = 8
    var edges: Edge.Set = .all
    func path(in r: CGRect) -> Path {
        var holes = Path()
        func run(from a: CGPoint, to b: CGPoint) {
            let len = hypot(b.x - a.x, b.y - a.y)
            let n = max(1, Int(len / spacing))
            for i in 0...n {
                let f = CGFloat(i) / CGFloat(n)
                let p = CGPoint(x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f)
                holes.addEllipse(in: CGRect(x: p.x - bite, y: p.y - bite, width: bite * 2, height: bite * 2))
            }
        }
        if edges.contains(.top) { run(from: CGPoint(x: r.minX, y: r.minY), to: CGPoint(x: r.maxX, y: r.minY)) }
        if edges.contains(.bottom) { run(from: CGPoint(x: r.minX, y: r.maxY), to: CGPoint(x: r.maxX, y: r.maxY)) }
        if edges.contains(.leading) { run(from: CGPoint(x: r.minX, y: r.minY), to: CGPoint(x: r.minX, y: r.maxY)) }
        if edges.contains(.trailing) { run(from: CGPoint(x: r.maxX, y: r.minY), to: CGPoint(x: r.maxX, y: r.maxY)) }
        return Path(r).subtracting(holes)
    }
}

/// A ticket: two half-moon notches where the stub tears off.
struct TicketShape: Shape {
    var stub: CGFloat = 54
    func path(in r: CGRect) -> Path {
        let x = r.maxX - stub
        var notches = Path()
        notches.addEllipse(in: CGRect(x: x - 7, y: r.minY - 7, width: 14, height: 14))
        notches.addEllipse(in: CGRect(x: x - 7, y: r.maxY - 7, width: 14, height: 14))
        return Path(roundedRect: r, cornerRadius: 5).subtracting(notches)
    }
}

/// Paper torn along the top.
struct Clipping: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        var rng = SplitMix(seed: 11)
        p.move(to: CGPoint(x: r.minX, y: r.minY + 4))
        var x = r.minX
        while x < r.maxX {
            x = min(r.maxX, x + CGFloat(4 + rng.next() % 6))
            p.addLine(to: CGPoint(x: x, y: r.minY + CGFloat(rng.next() % 6)))
        }
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        p.closeSubpath()
        return p
    }
}

/// A swing tag: clipped top corners and a punched hole.
struct TagShape: Shape {
    func path(in r: CGRect) -> Path {
        let c: CGFloat = 12
        var p = Path()
        p.move(to: CGPoint(x: r.minX + c, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX - c, y: r.minY))
        p.addLine(to: CGPoint(x: r.maxX, y: r.minY + c))
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        p.addLine(to: CGPoint(x: r.minX, y: r.minY + c))
        p.closeSubpath()
        let hole = Path(ellipseIn: CGRect(x: r.midX - 4, y: r.minY + 7, width: 8, height: 8))
        return p.subtracting(hole)
    }
}

extension View {
    /// An object resting on the table: a tight contact shadow plus a soft ambient one, lit from the top left.
    func resting(_ t: Theme) -> some View {
        self
            .shadow(color: .black.opacity(t.dark ? 0.55 : 0.14), radius: 0.8, x: 0.4, y: 1)
            .shadow(color: .black.opacity(t.dark ? 0.45 : 0.10), radius: 10, x: 2, y: 7)
    }
}

struct KindLabel: View {
    let kind: Kind
    var number: Int? = nil
    @Environment(\.theme) private var t
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: kind.symbol).imageScale(.small)
            Text(number.map { "\(kind.label) · No. \(String(format: "%03d", $0))" } ?? kind.label)
                .textCase(t.labelCase)
        }
        .font(t.label(11))
        .foregroundStyle(t.kind(kind))
    }
}

// MARK: - Postcard direction: each save is the object of its kind

struct PostcardObject: View {
    let s: Sample
    @Environment(\.theme) private var t

    var body: some View {
        Group {
            switch s.kind {
            case .place: postcard
            case .recipe: recipeCard
            case .film: ticket
            case .book: book
            case .product: tagged
            case .video: frame
            case .article: clipping
            case .workout: training
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var caption: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(s.title).font(t.title(16)).foregroundStyle(t.ink).lineLimit(2)
            Text(s.fact).font(t.label(12)).foregroundStyle(t.inkMuted).lineLimit(1)
        }
    }

    private var postcard: some View {
        VStack(alignment: .leading, spacing: 9) {
            SamplePhoto(colors: s.photo)
                .aspectRatio(1 / s.aspect * 1.3, contentMode: .fit)
                .overlay(alignment: .topTrailing) {
                    Stamp(kind: s.kind).padding(7)
                }
            caption.padding(.horizontal, 2)
        }
        .padding(7)
        .padding(.bottom, 4)
        .background(t.paper)
        .resting(t)
    }

    private var recipeCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            SamplePhoto(colors: s.photo).frame(height: 96).clipped()
            Rectangle().fill(t.stamp.opacity(0.7)).frame(height: 1.5)
            VStack(alignment: .leading, spacing: 0) {
                Text(s.title).font(t.title(16)).foregroundStyle(t.ink).lineLimit(2)
                    .padding(.top, 8).padding(.bottom, 4)
                ForEach(["rigatoni, butter, sage", s.fact], id: \.self) { line in
                    Text(line).font(.system(size: 12, design: .serif).italic()).foregroundStyle(t.inkMuted)
                        .frame(height: 20, alignment: .bottomLeading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(alignment: .bottom) { Rectangle().fill(t.accent.opacity(0.22)).frame(height: 0.75) }
                }
            }
            .padding(.horizontal, 10).padding(.bottom, 10)
        }
        .background(t.paper)
        .overlay(alignment: .topTrailing) {
            Text("25 min").font(t.label(10)).foregroundStyle(t.onAccent)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(t.kind(.recipe), in: UnevenRoundedRectangle(bottomLeadingRadius: 5, bottomTrailingRadius: 5))
                .padding(.trailing, 10)
        }
        .resting(t)
    }

    private var ticket: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text("ADMIT ONE").font(.system(size: 9, weight: .bold, design: .monospaced)).tracking(1.5)
                    .foregroundStyle(t.kind(.film))
                Text(s.title).font(t.title(17)).foregroundStyle(t.ink).lineLimit(2)
                Text("Film").font(t.label(11)).foregroundStyle(t.inkMuted)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            Text("1998").font(.system(size: 13, weight: .semibold, design: .monospaced))
                .foregroundStyle(t.kind(.film))
                .rotationEffect(.degrees(-90))
                .fixedSize()
                .frame(width: 54)
                .frame(maxHeight: .infinity)
                .overlay(alignment: .leading) {
                    Line().stroke(t.inkMuted.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        .frame(width: 1).padding(.vertical, 10)
                }
        }
        .frame(height: 104)
        .background(TicketShape().fill(t.paper))
        .compositingGroup()
        .resting(t)
    }

    private var book: some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .leading) {
                SamplePhoto(colors: s.photo)
                LinearGradient(colors: [.black.opacity(0.35), .white.opacity(0.12), .clear],
                               startPoint: .leading, endPoint: .trailing)
                    .frame(width: 14)
                Text(s.title).font(.system(size: 19, weight: .semibold, design: .serif))
                    .foregroundStyle(.white).multilineTextAlignment(.center)
                    .shadow(color: .black.opacity(0.4), radius: 3)
                    .frame(maxWidth: .infinity).padding(.horizontal, 18)
            }
            .aspectRatio(1 / 1.45, contentMode: .fit)
            .clipShape(UnevenRoundedRectangle(bottomTrailingRadius: 3, topTrailingRadius: 3))
            .resting(t)
            Text(s.fact).font(t.label(12)).foregroundStyle(t.inkMuted)
        }
    }

    private var tagged: some View {
        VStack(alignment: .leading, spacing: 9) {
            SamplePhoto(colors: s.photo).aspectRatio(1, contentMode: .fit)
                .overlay(alignment: .bottomTrailing) {
                    Text("$48").font(.system(size: 14, weight: .semibold, design: .serif)).foregroundStyle(t.ink)
                        .padding(.horizontal, 10).padding(.top, 20).padding(.bottom, 8)
                        .background(TagShape().fill(t.paper).resting(t))
                        .rotationEffect(.degrees(-7))
                        .padding(10)
                }
            caption.padding(.horizontal, 2)
        }
        .padding(7).padding(.bottom, 4)
        .background(t.paper)
        .resting(t)
    }

    private var frame: some View {
        VStack(alignment: .leading, spacing: 9) {
            SamplePhoto(colors: s.photo).aspectRatio(16 / 11, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay {
                    Image(systemName: "play.fill").font(.system(size: 15)).foregroundStyle(t.ink)
                        .frame(width: 38, height: 38).background(t.paper.opacity(0.92), in: Circle())
                }
                .padding(7)
                .background(t.ink.opacity(t.dark ? 0.5 : 0.85), in: RoundedRectangle(cornerRadius: 12))
                .resting(t)
            caption
        }
    }

    private var clipping: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("LONGFORM").font(.system(size: 9, weight: .bold)).tracking(1.6).foregroundStyle(t.kind(.article))
            Text(s.title).font(.system(size: 19, weight: .semibold, design: .serif)).foregroundStyle(t.ink)
            Text("Cities built for walking are quieter, kinder and, it turns out, better for business.")
                .font(.system(size: 12, design: .serif)).foregroundStyle(t.inkMuted).lineLimit(3)
            Text("12 min read").font(t.label(11)).foregroundStyle(t.inkMuted)
        }
        .padding(.horizontal, 12).padding(.top, 18).padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Clipping().fill(t.paper))
        .resting(t)
    }

    private var training: some View {
        HStack(spacing: 0) {
            Perforated(bite: 3.2, spacing: 13, edges: .leading).fill(t.kind(.workout).opacity(0.85))
                .frame(width: 14)
            VStack(alignment: .leading, spacing: 8) {
                KindLabel(kind: .workout)
                caption
                HStack(spacing: 4) {
                    ForEach(0..<7) { d in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(d < 3 ? t.kind(.workout) : t.rule)
                            .frame(width: 14, height: 14)
                    }
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(t.paper)
        .resting(t)
    }
}

struct Line: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path(); p.move(to: CGPoint(x: r.midX, y: r.minY)); p.addLine(to: CGPoint(x: r.midX, y: r.maxY)); return p
    }
}

/// A postage stamp with the kind's mark.
struct Stamp: View {
    let kind: Kind
    var size: CGFloat = 30
    @Environment(\.theme) private var t
    var body: some View {
        Image(systemName: kind.symbol)
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(t.kind(kind))
            .frame(width: size, height: size * 1.18)
            .background(RoundedRectangle(cornerRadius: 1).stroke(t.kind(kind).opacity(0.5), lineWidth: 0.75).padding(3.5))
            .background(Perforated(bite: 1.6, spacing: 5).fill(t.paper))
            .compositingGroup()
            .shadow(color: .black.opacity(0.18), radius: 1, y: 0.5)
            .rotationEffect(.degrees(4))
    }
}

// MARK: - Cabinet direction: specimens in trays

struct CabinetObject: View {
    let s: Sample
    var square = true
    @Environment(\.theme) private var t

    var body: some View {
        VStack(spacing: 0) {
            tray
            label
        }
        .background(t.paper, in: RoundedRectangle(cornerRadius: t.cardRadius))
        .overlay(RoundedRectangle(cornerRadius: t.cardRadius).strokeBorder(t.ink.opacity(t.dark ? 0.14 : 0.10), lineWidth: 0.75))
        .shadow(color: .black.opacity(t.dark ? 0.5 : 0.10), radius: 2, y: 1)
        .accessibilityElement(children: .combine)
    }

    private var tray: some View {
        RoundedRectangle(cornerRadius: 7)
            .fill(t.well.shadow(.inner(color: .black.opacity(t.dark ? 0.7 : 0.32), radius: 5, x: 0, y: 3)))
            .overlay {
                SamplePhoto(colors: s.photo)
                    .clipShape(RoundedRectangle(cornerRadius: 3))
                    .padding(12)
                    .shadow(color: .black.opacity(0.28), radius: 4, x: 1, y: 3)
            }
            .aspectRatio(square ? 1 : 1.3, contentMode: .fit)
            .padding(6)
    }

    private var label: some View {
        VStack(alignment: .leading, spacing: 5) {
            KindLabel(kind: s.kind, number: s.id)
            Text(s.title).font(t.title(16)).foregroundStyle(t.ink).lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(s.fact).font(t.label(11)).foregroundStyle(t.inkMuted).lineLimit(2).textCase(.uppercase)
        }
        .padding(.horizontal, 10).padding(.top, 4).padding(.bottom, 11)
    }
}

// MARK: - Daylight direction: photos under glass

struct DaylightObject: View {
    let s: Sample
    @Environment(\.theme) private var t

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SamplePhoto(colors: s.photo)
                .aspectRatio(1 / s.aspect, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: t.cardRadius, style: .continuous))
                .overlay(alignment: .topLeading) {
                    Image(systemName: s.kind.symbol)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .glassEffect(.regular.tint(t.kind(s.kind).opacity(0.55)), in: .circle)
                        .padding(9)
                }
                .overlay(alignment: .bottomTrailing) {
                    if s.kind == .product {
                        Text("$48").font(t.label(13)).foregroundStyle(.white)
                            .padding(.horizontal, 10).padding(.vertical, 6)
                            .glassEffect(.regular.tint(.black.opacity(0.45)), in: .capsule).padding(9)
                    }
                }
                .shadow(color: t.kind(s.kind).opacity(t.dark ? 0.25 : 0.18), radius: 14, y: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(s.title).font(t.title(15)).foregroundStyle(t.ink).lineLimit(2)
                Text(s.fact).font(.system(size: 12, weight: .medium, design: .rounded)).foregroundStyle(t.inkMuted).lineLimit(1)
            }
            .padding(.horizontal, 4)
        }
        .accessibilityElement(children: .combine)
    }
}

struct SaveObject: View {
    let s: Sample
    @Environment(\.theme) private var t
    var body: some View {
        switch t.direction {
        case .postcard: PostcardObject(s: s)
        case .cabinet: CabinetObject(s: s)
        case .daylight: DaylightObject(s: s)
        }
    }
}

/// Two columns that keep each object's own height.
struct Masonry<Content: View>: View {
    let items: [Sample]
    var spacing: CGFloat = 16
    @ViewBuilder let content: (Sample) -> Content
    var body: some View {
        HStack(alignment: .top, spacing: spacing) {
            ForEach(0..<2, id: \.self) { col in
                LazyVStack(spacing: spacing + 6) {
                    ForEach(items.enumerated().filter { $0.offset % 2 == col }.map(\.element)) { content($0) }
                }
            }
        }
    }
}
