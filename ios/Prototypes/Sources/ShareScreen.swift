import SwiftUI

/// A generic host app (a photo post in some other app) dimmed behind the share card.
struct HostApp: View {
    var body: some View {
        ZStack {
            Color(hex: 0x111111).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Circle().fill(Color(hex: 0x3A3A3A)).frame(width: 34, height: 34)
                    RoundedRectangle(cornerRadius: 4).fill(Color(hex: 0x3A3A3A)).frame(width: 120, height: 10)
                    Spacer()
                }
                .padding(.horizontal, 14)
                SamplePhoto(colors: Samples.place.photo).frame(height: 420)
                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: 4).fill(Color(hex: 0x3A3A3A)).frame(width: 240, height: 10)
                    RoundedRectangle(cornerRadius: 4).fill(Color(hex: 0x2C2C2C)).frame(width: 300, height: 10)
                    RoundedRectangle(cornerRadius: 4).fill(Color(hex: 0x2C2C2C)).frame(width: 180, height: 10)
                }
                .padding(.horizontal, 14)
                Spacer()
            }
            .padding(.top, 60)
            Color.black.opacity(0.35).ignoresSafeArea()
        }
    }
}

/// The share card. One tap saved it already; the card shows where it went and lets you flick it elsewhere.
struct ShareScreen: View {
    @Environment(\.theme) private var t
    private var s: Sample { Samples.place }
    private let destinations = ["Recipes", "Places", "Films & shows", "Kitchen", "Review"]

    var body: some View {
        ZStack(alignment: .bottom) {
            HostApp()
            card
                .padding(.horizontal, 10)
                .padding(.bottom, 4)
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Status: already saved.
            HStack(spacing: 8) {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(t.kind(.recipe))
                Text("Saved").font(.system(size: 15, weight: .semibold, design: t.direction == .daylight ? .rounded : .default))
                    .foregroundStyle(t.ink)
                Text("· finishing details").font(.system(size: 15)).foregroundStyle(t.inkMuted)
                Spacer()
                Text("Undo").font(.system(size: 15, weight: .semibold)).foregroundStyle(t.accent)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .frame(height: 30)

            HStack(spacing: 14) {
                thumb
                VStack(alignment: .leading, spacing: 4) {
                    Text(s.title).font(t.title(19)).foregroundStyle(t.ink)
                    Text("Alfama, Lisbon").font(.system(size: 14)).foregroundStyle(t.inkMuted)
                }
                Spacer()
            }

            slip

            HStack(spacing: 10) {
                secondary("Add a note", "square.and.pencil")
                secondary("Open in Keepsake", "arrow.up.forward.app")
            }
        }
        .padding(18)
        .background { cardSurface }
    }

    @ViewBuilder private var thumb: some View {
        switch t.direction {
        case .postcard:
            SamplePhoto(colors: s.photo).frame(width: 64, height: 76).padding(4).background(t.paper).resting(t).rotationEffect(.degrees(-3))
        case .cabinet:
            RoundedRectangle(cornerRadius: 8).fill(t.well.shadow(.inner(color: .black.opacity(0.35), radius: 3, y: 2)))
                .overlay { SamplePhoto(colors: s.photo).clipShape(RoundedRectangle(cornerRadius: 3)).padding(6) }
                .frame(width: 72, height: 72)
        case .daylight:
            SamplePhoto(colors: s.photo).frame(width: 68, height: 68).clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
    }

    /// The destination slip: flick sideways through Lifestyle views and collections.
    private var slip: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: "chevron.left").font(.system(size: 14, weight: .bold)).foregroundStyle(t.inkMuted.opacity(0.7))
                Spacer()
                VStack(spacing: 2) {
                    Text("Going to").font(t.label(11)).foregroundStyle(t.inkMuted).textCase(t.labelCase)
                    HStack(spacing: 8) {
                        Image(systemName: Kind.place.symbol).foregroundStyle(t.kind(.place))
                        Text("Places").font(t.display(26)).foregroundStyle(t.ink).textCase(t.labelCase)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .bold)).foregroundStyle(t.inkMuted.opacity(0.7))
            }
            HStack(spacing: 6) {
                ForEach(destinations, id: \.self) { d in
                    Capsule().fill(d == "Places" ? t.kind(.place) : t.ink.opacity(0.18))
                        .frame(width: d == "Places" ? 18 : 6, height: 6)
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .background { slipSurface }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Going to Places")
        .accessibilityHint("Swipe up or down to choose another place to keep it.")
        .accessibilityAdjustableAction { _ in }
    }

    @ViewBuilder private var slipSurface: some View {
        switch t.direction {
        case .postcard:
            // A luggage label: punched end, kind-coloured edge.
            ZStack {
                Rectangle().fill(t.paper)
                Rectangle().strokeBorder(t.kind(.place).opacity(0.45), style: StrokeStyle(lineWidth: 1, dash: [4, 3])).padding(5)
            }
            .resting(t)
        case .cabinet:
            RoundedRectangle(cornerRadius: 10).fill(t.well.shadow(.inner(color: .black.opacity(t.dark ? 0.6 : 0.25), radius: 4, y: 2)))
        case .daylight:
            RoundedRectangle(cornerRadius: 24, style: .continuous).fill(t.kind(.place).opacity(t.dark ? 0.16 : 0.09))
        }
    }

    @ViewBuilder private var cardSurface: some View {
        switch t.direction {
        case .postcard:
            RoundedRectangle(cornerRadius: 6).fill(t.table)
                .overlay(Grain().opacity(0.06).blendMode(.multiply).clipShape(RoundedRectangle(cornerRadius: 6)))
                .shadow(color: .black.opacity(0.35), radius: 24, y: 10)
        case .cabinet:
            RoundedRectangle(cornerRadius: 16).fill(t.paper)
                .overlay(alignment: .top) { Capsule().fill(t.accent).frame(width: 44, height: 5).offset(y: -2.5) }
                .shadow(color: .black.opacity(0.4), radius: 24, y: 10)
        case .daylight:
            RoundedRectangle(cornerRadius: 38, style: .continuous).fill(.clear)
                .glassEffect(.regular.tint(t.paper.opacity(0.82)), in: RoundedRectangle(cornerRadius: 38, style: .continuous))
        }
    }

    private func secondary(_ title: String, _ symbol: String) -> some View {
        Label(title, systemImage: symbol)
            .font(.system(size: 15, weight: .medium, design: t.direction == .daylight ? .rounded : .default))
            .foregroundStyle(t.ink)
            .frame(maxWidth: .infinity).frame(height: 48)
            .background {
                switch t.direction {
                case .postcard: RoundedRectangle(cornerRadius: 4).fill(t.paper).resting(t)
                case .cabinet: RoundedRectangle(cornerRadius: 10).strokeBorder(t.ink.opacity(0.2), lineWidth: 1)
                case .daylight: Capsule().fill(t.ink.opacity(0.07))
                }
            }
    }
}
