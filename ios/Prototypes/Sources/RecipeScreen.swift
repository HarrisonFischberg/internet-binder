import SwiftUI

struct RecipeScreen: View {
    @Environment(\.theme) private var t
    @State private var checked: Set<Int> = [0, 1, 2]
    @State private var serves = 2

    private var s: Sample { Samples.recipe }

    var body: some View {
        ZStack(alignment: .bottom) {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    hero
                    content.padding(.horizontal, 20).padding(.top, 18)
                }
                .padding(.bottom, 130)
            }
            .scrollIndicators(.hidden)
            .ignoresSafeArea(edges: .top)
            HStack(spacing: 12) {
                ServesDial(serves: $serves)
                PrimarySlab(title: "Start cooking", symbol: "flame.fill")
            }
            .padding(.horizontal, 16).padding(.bottom, 6)
            .background(alignment: .bottom) { BottomScrim() }
        }
    }

    @ViewBuilder private var hero: some View {
        switch t.direction {
        case .postcard:
            SamplePhoto(colors: s.photo).frame(height: 300)
                .overlay(alignment: .bottomLeading) {
                    Text("25 min · Serves 2").font(t.label(12)).foregroundStyle(t.onAccent)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(t.kind(.recipe), in: UnevenRoundedRectangle(topLeadingRadius: 5, topTrailingRadius: 5))
                        .padding(.leading, 20)
                }
        case .cabinet:
            RoundedRectangle(cornerRadius: 12)
                .fill(t.well.shadow(.inner(color: .black.opacity(t.dark ? 0.7 : 0.3), radius: 7, y: 3)))
                .overlay { SamplePhoto(colors: s.photo).clipShape(RoundedRectangle(cornerRadius: 6)).padding(12) }
                .frame(height: 280).padding(.horizontal, 16).padding(.top, 62)
        case .daylight:
            SamplePhoto(colors: s.photo).frame(height: 360)
                .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: 36, bottomTrailingRadius: 36, style: .continuous))
                .overlay(alignment: .bottomLeading) {
                    Text("25 min").font(.system(size: 14, weight: .semibold, design: .rounded)).foregroundStyle(.white)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .glassEffect(.regular, in: .capsule).padding(18)
                }
        }
    }

    @ViewBuilder private var content: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                KindLabel(kind: .recipe, number: t.direction == .cabinet ? 2 : nil)
                Text(t.direction == .cabinet ? s.title.uppercased() : s.title).font(t.display(t.direction == .cabinet ? 34 : 32)).foregroundStyle(t.ink)
                Text("Saved from Safari · 9 ingredients").font(t.label(13)).foregroundStyle(t.inkMuted)
            }
            section("Ingredients") {
                ForEach(Array(Samples.ingredients.enumerated()), id: \.offset) { i, ing in
                    ingredient(i, ing.0, ing.1)
                }
            }
            section("Step 1 of 4") {
                Text(Samples.steps[0])
                    .font(t.direction == .postcard ? .system(size: 18, design: .serif) : t.direction == .daylight ? .system(size: 18, design: .rounded) : .system(size: 17))
                    .foregroundStyle(t.ink)
                    .lineSpacing(4)
            }
        }
    }

    @ViewBuilder private func section<C: View>(_ title: String, @ViewBuilder _ c: () -> C) -> some View {
        let body = VStack(alignment: .leading, spacing: 0) {
            Text(title).textCase(t.labelCase)
                .font(t.direction == .postcard ? t.title(20) : t.direction == .cabinet ? t.label(12) : .system(size: 20, weight: .bold, design: .rounded))
                .foregroundStyle(t.direction == .cabinet ? t.inkMuted : t.ink)
                .padding(.bottom, 8)
            c()
        }
        switch t.direction {
        case .postcard:
            body.padding(16).background(t.paper)
                .overlay(alignment: .top) { Rectangle().fill(t.stamp.opacity(0.6)).frame(height: 1.5) }
                .resting(t)
        case .cabinet:
            body.padding(14).background(t.paper, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(t.ink.opacity(0.12), lineWidth: 0.75))
        case .daylight:
            body.padding(18).background(t.paper, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
                .shadow(color: .black.opacity(t.dark ? 0.3 : 0.06), radius: 12, y: 4)
        }
    }

    private func ingredient(_ i: Int, _ qty: String, _ name: String) -> some View {
        let on = checked.contains(i)
        return Button {
            if on { checked.remove(i) } else { checked.insert(i) }
        } label: {
            HStack(spacing: 12) {
                Group {
                    switch t.direction {
                    case .cabinet:
                        RoundedRectangle(cornerRadius: 3).strokeBorder(t.ink.opacity(0.5), lineWidth: 1.2)
                            .background(on ? RoundedRectangle(cornerRadius: 3).fill(t.kind(.recipe)) : nil)
                            .overlay { if on { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(t.onAccent) } }
                    default:
                        Circle().strokeBorder(on ? t.kind(.recipe) : t.ink.opacity(0.35), lineWidth: 1.5)
                            .background(on ? Circle().fill(t.kind(.recipe)) : nil)
                            .overlay { if on { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(t.onAccent) } }
                    }
                }
                .frame(width: 22, height: 22)
                if t.direction == .cabinet {
                    Text(qty.isEmpty ? "—" : qty).font(t.label(13)).foregroundStyle(t.inkMuted).frame(width: 52, alignment: .leading)
                    Text(name).font(.system(size: 16)).foregroundStyle(on ? t.inkMuted : t.ink).strikethrough(on, color: t.inkMuted)
                } else {
                    (Text(qty.isEmpty ? "" : qty + "  ").fontWeight(.semibold) + Text(name))
                        .font(t.direction == .postcard ? .system(size: 17, design: .serif) : .system(size: 17, design: .rounded))
                        .foregroundStyle(on ? t.inkMuted : t.ink)
                        .strikethrough(on, color: t.inkMuted)
                }
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
            .overlay(alignment: .bottom) {
                if t.direction == .postcard { Rectangle().fill(t.accent.opacity(0.18)).frame(height: 0.75) }
            }
        }
        .buttonStyle(PressStyle())
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// Servings as a small dial: turn it and the quantities scale.
struct ServesDial: View {
    @Binding var serves: Int
    @Environment(\.theme) private var t
    var body: some View {
        ZStack {
            Circle().fill(t.paper)
            ForEach(0..<24) { i in
                Rectangle().fill(t.ink.opacity(i % 6 == 0 ? 0.45 : 0.18))
                    .frame(width: 1.2, height: i % 6 == 0 ? 7 : 4)
                    .offset(y: -23)
                    .rotationEffect(.degrees(Double(i) * 15))
            }
            VStack(spacing: -2) {
                Text("\(serves)").font(.system(size: 19, weight: .bold, design: t.direction == .postcard ? .serif : .rounded)).foregroundStyle(t.ink)
                Text("serves").font(.system(size: 9, weight: .semibold)).foregroundStyle(t.inkMuted).textCase(t.labelCase)
            }
        }
        .frame(width: 58, height: 58)
        .modifier(DockSurface(shape: .capsule))
        .clipShape(Circle())
        .accessibilityElement()
        .accessibilityLabel("Serves \(serves)")
        .accessibilityAdjustableAction { dir in
            serves = max(1, serves + (dir == .increment ? 1 : -1))
        }
    }
}
