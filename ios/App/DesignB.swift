#if DEBUG
import SwiftUI
import KeepsakeKit
import KeepsakeUI

// Direction B, "Cut-outs": every kind is cut to its own silhouette in its own colour (a swing tag to
// buy, a plate to cook, a ticket to visit, a cover to read), pinned up as a two-column board.
// Shape rule: cut-outs keep their silhouette, blocks 24, cells 16, controls capsules.

/// A ticket torn across: half-moon notches on both sides where the picture meets the words.
private struct TornTicket: Shape {
    var tear: CGFloat
    func path(in r: CGRect) -> Path {
        var notches = Path()
        notches.addEllipse(in: CGRect(x: r.minX - 8, y: r.minY + tear - 8, width: 16, height: 16))
        notches.addEllipse(in: CGRect(x: r.maxX - 8, y: r.minY + tear - 8, width: 16, height: 16))
        return Path(roundedRect: r, cornerRadius: 14, style: .continuous).subtracting(notches)
    }
}

/// A block whose top edge is a row of scallops, like the deckled edge of a recipe card.
private struct DeckleTop: Shape {
    var bump: CGFloat = 22
    func path(in r: CGRect) -> Path {
        let n = max(1, Int((r.width / bump).rounded())), w = r.width / CGFloat(n)
        var p = Path()
        p.move(to: CGPoint(x: r.minX, y: r.minY + w / 2))
        for i in 0..<n {
            p.addArc(center: CGPoint(x: r.minX + w * (CGFloat(i) + 0.5), y: r.minY + w / 2), radius: w / 2,
                     startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
        }
        p.addLine(to: CGPoint(x: r.maxX, y: r.maxY)); p.addLine(to: CGPoint(x: r.minX, y: r.maxY)); p.closeSubpath()
        return p
    }
}

private extension KSTheme {
    /// The direction's display voice: the appearance's own face, at its heaviest.
    func loud(_ style: Font.TextStyle) -> Font { .system(style, design: displayDesign).weight(self.style == .paper ? .bold : .heavy) }
}

/// One save, cut to its kind's silhouette and filled with its kind's colour.
private struct CutOut: View {
    let save: Save
    @Environment(\.ks) private var t

    var body: some View {
        let fill = t.kindFill(save.kind), ink = t.onKind
        Group {
            switch save.kind {
            case "recipe":
                // A plate on a card.
                VStack(spacing: 10) {
                    SaveImage(save).aspectRatio(1, contentMode: .fit).clipShape(Circle())
                        .overlay(Circle().strokeBorder(ink.opacity(0.14), lineWidth: 1))
                        .padding(.horizontal, 6)
                    words(ink)
                }
                .padding(12)
                .background(fill, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            case "place":
                VStack(spacing: 0) {
                    picture(104)
                    Line().stroke(ink.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [4, 4])).frame(height: 1).padding(.horizontal, 12)
                    words(ink).padding(12)
                }
                .background(fill)
                .clipShape(TornTicket(tear: 104))
            case "book", "media":
                // A cover with its spine.
                VStack(alignment: .leading, spacing: 0) {
                    picture(196)
                    words(ink).padding(12)
                }
                .background(fill)
                .overlay(alignment: .leading) { Rectangle().fill(.black.opacity(0.22)).frame(width: 5) }
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            case "product":
                VStack(spacing: 0) {
                    Color.clear.frame(height: 24)
                    picture(132).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous)).padding(.horizontal, 8)
                    words(ink).padding(.horizontal, 12).padding(.vertical, 10)
                }
                .background(fill)
                .clipShape(TagShape())
            default:
                VStack(spacing: 0) {
                    picture(112)
                    words(ink).padding(12)
                }
                .background(fill)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            }
        }
        .saturation(save.isDone ? 0.4 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([save.title, KindStyle(save.kind).label, save.needsFiling ? "Needs a collection" : save.fact ?? ""].filter { !$0.isEmpty }.joined(separator: ", "))
    }

    private func picture(_ height: CGFloat) -> some View {
        SaveImage(save).frame(maxWidth: .infinity).frame(height: height).clipped()
    }

    private func words(_ ink: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(save.title).font(.system(.subheadline, design: t.displayDesign).weight(.bold)).foregroundStyle(ink)
                .lineLimit(3).fixedSize(horizontal: false, vertical: true)
            if save.needsFiling {
                Label("Needs a collection", systemImage: "tray.full").font(.caption.weight(.bold)).foregroundStyle(ink)
            } else if let fact = save.fact, !fact.isEmpty {
                Text(fact).font(.caption.weight(.medium)).foregroundStyle(ink.opacity(0.78)).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct DesignBHome: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @State private var collections = 0

    private var recent: [Save] { model.glance?.recent ?? Array(model.saves.prefix(8)) }

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack {
                        Text("Internet Binder").font(t.loud(.title2)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                        Spacer()
                        GlassEffectContainer(spacing: 10) { DesignHeaderButtons() }
                    }
                    if model.reviewCount > 0 { review }
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Recent").font(t.loud(.largeTitle)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                        board
                    }
                    HStack(alignment: .top, spacing: 12) {
                        block("Collections", detail: collections == 1 ? "1 collection" : "\(collections) collections", saves: model.index.collected,
                              symbol: "bag", fill: t.detail, ink: t.onDetail, route: .collections)
                        block("Lifestyle", detail: "\(Set(model.index.lifestyle.map(\.kind)).count) kinds", saves: model.index.lifestyle,
                              symbol: "sparkles", fill: t.alt, ink: t.onAlt, route: .lifestyle)
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 40)
            }
            .clearsTabBar()
            .safeAreaInset(edge: .top, spacing: 0) { TopScrim() }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: model.saves.count) { collections = ((try? model.library?.collections()) ?? []).count }
    }

    /// What needs you: a quiet block, its button the screen's one filled control.
    private var review: some View {
        NavigationLink(value: Route.review) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.reviewCount == 1 ? "1 save needs a collection" : "\(model.reviewCount) saves need a collection")
                        .font(t.loud(.title3)).foregroundStyle(t.ink).fixedSize(horizontal: false, vertical: true)
                    Text("One tap each, and it learns.").font(.subheadline).foregroundStyle(t.inkMuted)
                }
                Spacer(minLength: 0)
                DesignFileButton()
            }
            .padding(.leading, 20).padding(.trailing, 16).padding(.vertical, 16)
            .background(t.paper, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(t.rule, lineWidth: 1))
        }
        .buttonStyle(PressStyle())
    }

    /// Two columns, each cut-out its own height; the columns fill in turn so the newest stay on top.
    private var board: some View {
        HStack(alignment: .top, spacing: 12) {
            ForEach(0..<2, id: \.self) { col in
                VStack(spacing: 12) {
                    ForEach(Array(recent.enumerated()).filter { $0.offset % 2 == col }.map(\.element)) { save in
                        NavigationLink(value: save) { CutOut(save: save) }
                            .buttonStyle(PressStyle())
                            .contextMenu { SaveMenu(save: save) }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .top)
            }
        }
    }

    private func block(_ title: String, detail: String, saves: [Save], symbol: String, fill: Color, ink: Color, route: Route) -> some View {
        NavigationLink(value: route) {
            VStack(alignment: .leading, spacing: 4) {
                CoverFan(saves, symbol: symbol, tint: ink, size: 44, calm: true).padding(.bottom, 8)
                Text(title).font(t.loud(.title3)).foregroundStyle(ink).lineLimit(1).minimumScaleFactor(0.8)
                HStack {
                    Text(detail).font(.footnote.weight(.medium)).foregroundStyle(ink.opacity(0.8)).monospacedDigit()
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.right").font(.footnote.weight(.bold)).foregroundStyle(ink)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(fill, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(PressStyle())
        .accessibilityElement(children: .ignore).accessibilityLabel(title).accessibilityValue(detail).accessibilityAddTraits(.isButton)
    }
}

struct DesignBRecipe: View {
    let save: Save
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.dismiss) private var dismiss
    @State private var checked = DesignSwitch.checked

    private var current: Save { model.index.byId[save.id] ?? save }

    var body: some View {
        let ingredients = current.ingredientLines, steps = current.stepLines
        let fill = t.kindFill("recipe"), ink = t.onKind
        ZStack(alignment: .top) {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    SaveImage(current).frame(maxWidth: .infinity).frame(height: 316).clipped().accessibilityHidden(true)
                    // The recipe's card: its kind's colour, deckled where it laps over the picture.
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 6) {
                            Label(["Recipe", current.retailer ?? ""].filter { !$0.isEmpty }.joined(separator: " · "), systemImage: "fork.knife")
                                .font(.footnote.weight(.bold)).foregroundStyle(ink.opacity(0.8))
                            Text(current.title).font(t.loud(.largeTitle)).foregroundStyle(ink)
                                .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
                        }
                        HStack(alignment: .top, spacing: 0) {
                            ForEach(Array(current.recipeFacts.enumerated()), id: \.offset) { i, f in
                                if i > 0 { Rectangle().fill(ink.opacity(0.25)).frame(width: 1).padding(.horizontal, 12) }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(f.label).font(.caption.weight(.semibold)).foregroundStyle(ink.opacity(0.75))
                                    Text(f.value).font(.system(.subheadline, design: t.displayDesign).weight(.bold)).foregroundStyle(ink).monospacedDigit()
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 20).padding(.top, 32).padding(.bottom, 24)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(fill, in: DeckleTop())
                    .overlay(alignment: .topTrailing) { cookedSeal.offset(x: -20, y: -34) }
                    .padding(.top, -22)

                    VStack(alignment: .leading, spacing: 12) {
                        if !ingredients.isEmpty {
                            heading("Ingredients", note: checked.isEmpty ? "\(ingredients.count)" : "\(checked.count) of \(ingredients.count) ready")
                            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible())], spacing: 8) {
                                ForEach(Array(ingredients.enumerated()), id: \.offset) { i, line in cell(i, line) }
                            }
                        }
                        if !steps.isEmpty {
                            heading("Method", note: "\(steps.count) steps").padding(.top, 20)
                            ForEach(Array(steps.enumerated()), id: \.offset) { i, step in
                                HStack(alignment: .top, spacing: 12) {
                                    Text("\(i + 1)").font(.system(.headline, design: t.displayDesign).weight(.heavy)).foregroundStyle(ink)
                                        .frame(width: 32, height: 32).background(fill, in: Circle())
                                    Text(step).font(.body).foregroundStyle(t.ink).fixedSize(horizontal: false, vertical: true).padding(.top, 5)
                                }
                                .padding(16)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(t.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            }
                        }
                    }
                    .padding(.horizontal, 16).padding(.top, 24).padding(.bottom, 24)
                }
            }
            .ignoresSafeArea(edges: .top)
            HStack {
                Button { dismiss() } label: { GlassIcon("chevron.left") }.accessibilityLabel("Back")
                Spacer()
                Menu { DesignMoreMenu(save: current) } label: { GlassIcon("ellipsis") }.accessibilityLabel("More")
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 16).padding(.top, 4)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { DesignDock(save: current) }
        .toolbar(.hidden, for: .navigationBar)
    }

    /// The brand's scalloped sticker as the done mark: an outline until it is cooked, then pressed in.
    private var cookedSeal: some View {
        let done = current.isDone
        return Button {
            Haptic.stamped()
            Task { await model.setDone(current, !done) }
        } label: {
            VStack(spacing: 0) {
                Image(systemName: "checkmark").font(.subheadline.weight(.heavy))
                Text(done ? "Cooked" : "Cooked it").font(.caption2.weight(.bold))
            }
            .foregroundStyle(done ? t.onPrimary : t.ink)
            .frame(width: 72, height: 72)
            .background(done ? t.primary : t.paper, in: Scallop(bumps: 12))
            .overlay(Scallop(bumps: 12).stroke(done ? .clear : t.line, lineWidth: 1))
            .rotationEffect(.degrees(8))
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(done ? "Cooked, done" : "Cooked")
    }

    private func heading(_ title: String, note: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(t.loud(.title2)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
            Spacer()
            Text(note).font(.footnote.weight(.medium)).foregroundStyle(t.inkMuted).monospacedDigit()
        }
    }

    private func cell(_ i: Int, _ line: String) -> some View {
        let on = checked.contains(i)
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        return Button {
            Haptic.checked()
            if on { checked.remove(i) } else { checked.insert(i) }
        } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.body.weight(.semibold))
                    .foregroundStyle(on ? t.kind("recipe") : t.inkMuted)
                Text(line).font(.subheadline.weight(on ? .regular : .medium)).foregroundStyle(on ? t.inkMuted : t.ink)
                    .strikethrough(on, color: t.inkMuted).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
            .background(on ? t.kindSoft("recipe") : t.paper, in: shape)
            .overlay(shape.strokeBorder(on ? t.kind("recipe").opacity(0.5) : t.rule, lineWidth: 1))
        }
        .buttonStyle(PressStyle())
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
#endif
