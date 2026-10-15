import SwiftUI

struct TableBackground: View {
    @Environment(\.theme) private var t
    var body: some View {
        ZStack {
            t.table
            switch t.direction {
            case .postcard:
                Grain().opacity(t.dark ? 0.05 : 0.07).blendMode(.multiply)
            case .cabinet:
                // Fine linen weave.
                Canvas { ctx, size in
                    var y: CGFloat = 0
                    while y < size.height {
                        ctx.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 0.5)), with: .color(.black.opacity(t.dark ? 0.18 : 0.05)))
                        y += 3
                    }
                }
            case .daylight:
                LinearGradient(colors: [t.accent.opacity(t.dark ? 0.16 : 0.10), .clear, t.kind(.place).opacity(t.dark ? 0.08 : 0.06)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
            }
        }
        .ignoresSafeArea()
    }
}

struct LibraryScreen: View {
    @Environment(\.theme) private var t
    @State private var selected: Kind? = nil

    var body: some View {
        ZStack(alignment: .bottom) {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    filters
                    grid
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 120)
            }
            .scrollIndicators(.hidden)
            SearchDock()
        }
    }

    @ViewBuilder private var header: some View {
        switch t.direction {
        case .postcard:
            VStack(alignment: .leading, spacing: 2) {
                Text("Library").font(t.display(40)).foregroundStyle(t.ink)
                Text("214 saves, kept on this iPhone").font(.system(size: 14, design: .serif).italic()).foregroundStyle(t.inkMuted)
            }
            .padding(.top, 8)
        case .cabinet:
            HStack(alignment: .lastTextBaseline) {
                Text("LIBRARY").font(t.display(44)).foregroundStyle(t.ink)
                Spacer()
                Text("214 ITEMS").font(t.label(12)).foregroundStyle(t.inkMuted)
            }
            .padding(.top, 8)
        case .daylight:
            HStack(alignment: .firstTextBaseline) {
                Text("Library").font(t.display(36)).foregroundStyle(t.ink)
                Spacer()
                Image(systemName: "square.grid.2x2").font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(t.ink).frame(width: 44, height: 44)
                    .glassEffect(.regular.interactive(), in: .circle)
                    .accessibilityLabel("Layout")
            }
            .padding(.top, 8)
        }
    }

    private var filters: some View {
        ScrollView(.horizontal) {
            HStack(spacing: t.direction == .cabinet ? 0 : 8) {
                chip(nil, "All")
                ForEach([Kind.place, .recipe, .product, .film, .book, .workout, .video, .article], id: \.self) { k in
                    chip(k, k.label + "s")
                }
            }
            .padding(.horizontal, 18)
        }
        .scrollIndicators(.hidden)
        .padding(.horizontal, -18)
    }

    @ViewBuilder private func chip(_ k: Kind?, _ text: String) -> some View {
        let on = selected == k
        Button { selected = k } label: {
            switch t.direction {
            case .postcard:
                HStack(spacing: 5) {
                    if let k { Image(systemName: k.symbol).imageScale(.small).foregroundStyle(on ? t.onAccent : t.kind(k)) }
                    Text(text)
                }
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(on ? t.onAccent : t.ink)
                .padding(.horizontal, 12).frame(height: 36)
                .background(on ? AnyShapeStyle(t.ink) : AnyShapeStyle(t.paper), in: RoundedRectangle(cornerRadius: 3))
                .shadow(color: .black.opacity(on ? 0 : 0.10), radius: 1, y: 1)
                .frame(minHeight: 44)
            case .cabinet:
                // Index tabs along the top of the drawer.
                Text(text).textCase(.uppercase)
                    .font(t.label(12))
                    .foregroundStyle(on ? t.ink : t.inkMuted)
                    .padding(.horizontal, 12).frame(height: 34)
                    .background(on ? t.paper : t.well.opacity(0.6),
                                in: UnevenRoundedRectangle(topLeadingRadius: 7, topTrailingRadius: 7))
                    .overlay(alignment: .bottom) { if !on { Rectangle().fill(t.ink.opacity(0.12)).frame(height: 0.75) } }
                    .frame(minHeight: 44, alignment: .bottom)
            case .daylight:
                HStack(spacing: 5) {
                    if let k { Image(systemName: k.symbol).imageScale(.small) }
                    Text(text)
                }
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(on ? t.onAccent : t.ink)
                .padding(.horizontal, 14).frame(height: 38)
                .background { if on { Capsule().fill(t.accent) } }
                .glassEffect(on ? .identity : .regular.interactive(), in: .capsule)
                .frame(minHeight: 44)
            }
        }
        .buttonStyle(PressStyle())
    }

    @ViewBuilder private var grid: some View {
        let items = Samples.library
        switch t.direction {
        case .postcard:
            Masonry(items: items, spacing: 16) { PostcardObject(s: $0) }
        case .cabinet:
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(items) { CabinetObject(s: $0) }
            }
            .padding(10)
            .background(RoundedRectangle(cornerRadius: 12).fill(t.well.opacity(0.55)
                .shadow(.inner(color: .black.opacity(t.dark ? 0.6 : 0.18), radius: 6, y: 2))))
        case .daylight:
            Masonry(items: items, spacing: 14) { DaylightObject(s: $0) }
        }
    }
}

/// Search sits at the bottom, under the thumb. Library's one primary action.
struct SearchDock: View {
    @Environment(\.theme) private var t
    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 17, weight: .semibold))
                Text("Search 214 saves").font(t.direction == .daylight ? .system(size: 17, weight: .medium, design: .rounded) : .system(size: 17))
                Spacer()
            }
            .foregroundStyle(t.direction == .daylight ? t.ink : t.inkMuted)
            .padding(.horizontal, 18)
            .frame(height: 54)
            .modifier(DockSurface(shape: .capsule, pull: true))
            Image(systemName: "plus").font(.system(size: 20, weight: .semibold))
                .foregroundStyle(t.onAccent)
                .frame(width: 54, height: 54)
                .background(t.accent, in: Circle())
                .shadow(color: t.accent.opacity(0.35), radius: 8, y: 4)
                .accessibilityLabel("Paste a link")
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 6)
        .background(alignment: .bottom) { BottomScrim() }
    }
}

/// Content fades into the table under floating bottom controls, so text never collides with them.
struct BottomScrim: View {
    @Environment(\.theme) private var t
    var body: some View {
        LinearGradient(stops: [.init(color: t.table.opacity(0), location: 0),
                               .init(color: t.table.opacity(0.94), location: 0.35),
                               .init(color: t.table, location: 1)],
                       startPoint: .top, endPoint: .bottom)
            .frame(height: 170)
            .offset(y: 30)
            .allowsHitTesting(false)
    }
}

enum DockShape { case capsule, rect }

struct DockSurface: ViewModifier {
    let shape: DockShape
    var pull = false
    @Environment(\.theme) private var t
    func body(content: Content) -> some View {
        switch t.direction {
        case .postcard:
            content.background(t.paper, in: RoundedRectangle(cornerRadius: shape == .capsule ? 27 : 6))
                .overlay(RoundedRectangle(cornerRadius: shape == .capsule ? 27 : 6).strokeBorder(t.ink.opacity(0.12), lineWidth: 0.75))
                .shadow(color: .black.opacity(t.dark ? 0.5 : 0.14), radius: 12, y: 6)
        case .cabinet:
            content.background(t.paper, in: RoundedRectangle(cornerRadius: 12))
                .overlay(alignment: .top) {
                    // The drawer pull.
                    if pull { Capsule().fill(t.accent.opacity(0.85)).frame(width: 40, height: 4).offset(y: -2) }
                }
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(t.ink.opacity(0.14), lineWidth: 0.75))
                .shadow(color: .black.opacity(t.dark ? 0.6 : 0.16), radius: 10, y: 5)
        case .daylight:
            content.glassEffect(.regular.interactive(), in: shape == .capsule ? AnyShape(Capsule()) : AnyShape(RoundedRectangle(cornerRadius: 30, style: .continuous)))
        }
    }
}
