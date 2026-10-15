import SwiftUI
import MapKit

struct PlaceMap: View {
    var muted = false
    @Environment(\.theme) private var t
    var body: some View {
        let s = Samples.place
        Map(initialPosition: .region(MKCoordinateRegion(center: Samples.placeCoordinate,
                                                        latitudinalMeters: 700, longitudinalMeters: 700))) {
            Annotation(s.title, coordinate: Samples.placeCoordinate) {
                PinMark()
            }
        }
        .mapStyle(.standard(elevation: .flat, emphasis: muted ? .muted : .automatic, pointsOfInterest: .excludingAll))
        .mapControlVisibility(.hidden)
        .allowsHitTesting(false)
    }
}

struct PinMark: View {
    @Environment(\.theme) private var t
    var body: some View {
        Image(systemName: "mappin")
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: 36, height: 36)
            .background(t.kind(.place), in: Circle())
            .overlay(Circle().strokeBorder(.white, lineWidth: 2.5))
            .shadow(color: .black.opacity(0.3), radius: 4, y: 3)
    }
}

/// The one primary action of a Place: go there.
struct PrimarySlab: View {
    let title: String
    let symbol: String
    @Environment(\.theme) private var t
    var body: some View {
        Button {} label: {
            HStack(spacing: 10) {
                Image(systemName: symbol).font(.system(size: 18, weight: .semibold))
                Text(title).font(t.direction == .cabinet ? t.title(19).weight(.bold) : t.direction == .daylight ? .system(size: 18, weight: .bold, design: .rounded) : .system(size: 18, weight: .semibold))
                    .textCase(t.labelCase)
            }
            .foregroundStyle(t.onAccent)
            .frame(maxWidth: .infinity).frame(height: 58)
            .background(t.accent, in: RoundedRectangle(cornerRadius: t.direction == .daylight ? 29 : t.direction == .cabinet ? 12 : 6, style: .continuous))
            .shadow(color: t.accent.opacity(0.35), radius: 10, y: 5)
        }
        .buttonStyle(PressStyle())
    }
}

/// Press and hold to stamp "Been here".
struct HoldStamp: View {
    let label: String
    @Environment(\.theme) private var t
    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: "seal").font(.system(size: 20, weight: .semibold))
            Text(label).font(.system(size: 10, weight: .semibold)).textCase(t.labelCase)
        }
        .foregroundStyle(t.stamp)
        .frame(width: 58, height: 58)
        .background(Circle().fill(t.paper))
        .overlay(Circle().strokeBorder(t.stamp.opacity(0.5), style: StrokeStyle(lineWidth: 1.5, dash: [3, 3])))
        .shadow(color: .black.opacity(t.dark ? 0.5 : 0.12), radius: 6, y: 3)
        .accessibilityLabel("Been here. Press and hold.")
    }
}

struct PlaceScreen: View {
    @Environment(\.theme) private var t
    var body: some View {
        switch t.direction {
        case .postcard: postcard
        case .cabinet: cabinet
        case .daylight: daylight
        }
    }

    private var s: Sample { Samples.place }

    private var topBar: some View {
        HStack {
            Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold))
                .frame(width: 44, height: 44)
                .modifier(DockSurface(shape: .capsule))
                .clipShape(Circle())
            Spacer()
            Image(systemName: "ellipsis").font(.system(size: 17, weight: .semibold))
                .frame(width: 44, height: 44)
                .modifier(DockSurface(shape: .capsule))
                .clipShape(Circle())
        }
        .foregroundStyle(t.ink)
        .padding(.horizontal, 16)
    }

    private var postcard: some View {
        ZStack(alignment: .bottom) {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    // The postcard: map face, pinned, stamped.
                    VStack(spacing: 0) {
                        PlaceMap(muted: true).frame(height: 300)
                            .overlay(alignment: .topTrailing) { Stamp(kind: .place, size: 44).padding(12) }
                            .overlay(alignment: .bottomTrailing) {
                                SamplePhoto(colors: s.photo).frame(width: 96, height: 120)
                                    .padding(5).background(t.paper).resting(t)
                                    .rotationEffect(.degrees(5)).offset(x: -14, y: 34)
                            }
                    }
                    .padding(8).background(t.paper).resting(t)
                    .rotationEffect(.degrees(-0.8))
                    .padding(.top, 56)

                    VStack(alignment: .leading, spacing: 6) {
                        Text("Alfama, Lisbon").font(.system(size: 14, design: .serif).italic()).foregroundStyle(t.inkMuted)
                        Text(s.title).font(t.display(36)).foregroundStyle(t.ink).padding(.top, 14)
                        KindLabel(kind: .place)
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        ruled("mappin", Samples.placeAddress)
                        ruled("clock", Samples.placeHours)
                        ruled("cup.and.saucer", "Café · coffee and pastries")
                        ruled("arrow.up.forward.square", "Saved from Instagram")
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 120)
            }
            .scrollIndicators(.hidden)
            topBar.frame(maxHeight: .infinity, alignment: .top)
            HStack(spacing: 12) { HoldStamp(label: "Been"); PrimarySlab(title: "Directions", symbol: "arrow.triangle.turn.up.right.diamond.fill") }
                .padding(.horizontal, 16).padding(.bottom, 6)
                .background(alignment: .bottom) { BottomScrim() }
        }
    }

    private func ruled(_ symbol: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).foregroundStyle(t.kind(.place)).frame(width: 22)
            Text(text).font(.system(size: 16, design: .serif)).foregroundStyle(t.ink)
            Spacer()
        }
        .frame(minHeight: 46)
        .overlay(alignment: .bottom) { Rectangle().fill(t.accent.opacity(0.2)).frame(height: 0.75) }
    }

    private var cabinet: some View {
        ZStack(alignment: .bottom) {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(t.well.shadow(.inner(color: .black.opacity(t.dark ? 0.7 : 0.3), radius: 7, y: 3)))
                        .overlay {
                            PlaceMap(muted: true).clipShape(RoundedRectangle(cornerRadius: 6)).padding(12)
                                .shadow(color: .black.opacity(0.25), radius: 5, y: 3)
                        }
                        .frame(height: 330)
                        .padding(.top, 56)
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            KindLabel(kind: .place, number: 1)
                            Spacer()
                            Text("LISBON").font(t.label(11)).foregroundStyle(t.inkMuted)
                        }
                        Text(s.title.uppercased()).font(t.display(38)).foregroundStyle(t.ink)
                        Divider().overlay(t.ink.opacity(0.2))
                        field("Address", Samples.placeAddress)
                        field("Hours", Samples.placeHours)
                        field("Kind", "Café · coffee and pastries")
                        field("Source", "Instagram")
                    }
                    .padding(16)
                    .background(t.paper, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(t.ink.opacity(0.12), lineWidth: 0.75))
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 120)
            }
            .scrollIndicators(.hidden)
            topBar.frame(maxHeight: .infinity, alignment: .top)
            HStack(spacing: 12) { HoldStamp(label: "Been"); PrimarySlab(title: "Directions", symbol: "arrow.triangle.turn.up.right.diamond.fill") }
                .padding(.horizontal, 16).padding(.bottom, 6)
                .background(alignment: .bottom) { BottomScrim() }
        }
    }

    private func field(_ k: String, _ v: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(k).textCase(.uppercase).font(t.label(11)).foregroundStyle(t.inkMuted).frame(width: 74, alignment: .leading)
            Text(v).font(.system(size: 16)).foregroundStyle(t.ink)
            Spacer(minLength: 0)
        }
        .frame(minHeight: 30)
    }

    private var daylight: some View {
        ZStack(alignment: .bottom) {
            PlaceMap().ignoresSafeArea()
            topBar.frame(maxHeight: .infinity, alignment: .top)
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 14) {
                    SamplePhoto(colors: s.photo).frame(width: 84, height: 84)
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    VStack(alignment: .leading, spacing: 4) {
                        KindLabel(kind: .place)
                        Text(s.title).font(t.display(28)).foregroundStyle(t.ink)
                        Text("Alfama, Lisbon · Café").font(.system(size: 15, weight: .medium, design: .rounded)).foregroundStyle(t.inkMuted)
                    }
                }
                VStack(alignment: .leading, spacing: 8) {
                    Label(Samples.placeAddress, systemImage: "mappin")
                    Label(Samples.placeHours, systemImage: "clock")
                }
                .font(.system(size: 15, design: .rounded)).foregroundStyle(t.ink)
                HStack(spacing: 12) { HoldStamp(label: "Been"); PrimarySlab(title: "Directions", symbol: "arrow.triangle.turn.up.right.diamond.fill") }
            }
            .padding(20)
            .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 34, style: .continuous))
            .padding(.horizontal, 10).padding(.bottom, 2)
        }
    }
}
