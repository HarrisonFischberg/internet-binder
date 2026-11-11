#if DEBUG
import SwiftUI
import KeepsakeKit
import KeepsakeUI

// Direction A, "Divider Tabs": the app is one binder. Index tabs across the top of a punched sheet
// file every kind one tap from Home; saves are ruled index lines, small pictures, many to a page.
// Shape rule: tabs 10 (top corners only), sheet 14, pictures 6, controls capsules.

/// The punched sheet everything in this direction is written on: three-ring holes down a ruled margin.
private struct BinderSheet<Content: View>: View {
    /// Square where the front tab joins the sheet.
    var joinsLeading = true
    @ViewBuilder let content: Content
    @Environment(\.ks) private var t
    static var gutter: CGFloat { 40 }

    var body: some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: joinsLeading ? 0 : 14, bottomLeadingRadius: 14, bottomTrailingRadius: 14, topTrailingRadius: 14, style: .continuous)
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(.leading, Self.gutter + 12).padding(.trailing, 16).padding(.bottom, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(alignment: .topLeading) {
                GeometryReader { g in
                    // The margin rule, then a hole every 208 points.
                    Rectangle().fill(t.accent.opacity(0.4)).frame(width: 1).offset(x: Self.gutter)
                    ForEach(Array(stride(from: CGFloat(52), to: g.size.height - 20, by: 208)), id: \.self) { y in
                        Circle().fill(t.table)
                            .overlay(Circle().strokeBorder(t.line, lineWidth: 1))
                            .frame(width: 16, height: 16).offset(x: 12, y: y)
                    }
                }
                .accessibilityHidden(true)
            }
            .background(t.paper, in: shape)
            .overlay(shape.strokeBorder(t.rule, lineWidth: 1))
    }
}

/// A rule across the sheet, from the margin to its right edge.
private struct SheetRule: View {
    @Environment(\.ks) private var t
    var body: some View {
        Rectangle().fill(t.rule).frame(height: 1).padding(.leading, -12).padding(.trailing, -16)
    }
}

/// One index tab. The front tab is the sheet's own colour and joins it; the others sit a step back
/// in their kind's tint.
private struct IndexTab: View {
    let title: String
    var symbol: String?
    var count: Int?
    var kind: String?
    var front = false
    /// A filled tab (the divider a recipe's page is filed behind).
    var filled = false
    @Environment(\.ks) private var t

    var body: some View {
        let ink: Color = filled ? t.onKind : front ? t.ink : kind.map { t.kind($0) } ?? t.ink
        let fill: Color = filled ? t.kindFill(kind ?? "link") : front ? t.paper : kind.map { t.kindSoft($0) } ?? t.well
        let shape = UnevenRoundedRectangle(topLeadingRadius: 10, topTrailingRadius: 10, style: .continuous)
        HStack(spacing: 6) {
            if let symbol { Image(systemName: symbol).font(.footnote.weight(.semibold)) }
            Text(title).font(.subheadline.weight(.semibold))
            if let count, count > 0 {
                Text("\(count)").font(.caption.weight(.bold)).monospacedDigit()
                    .foregroundStyle(front ? t.inkMuted : ink.opacity(0.8))
            }
        }
        .foregroundStyle(ink)
        .padding(.horizontal, 14)
        .frame(height: front || filled ? 44 : 38)
        .background(fill, in: shape)
        .overlay { if !filled { shape.stroke(t.rule, lineWidth: 1) } }
        // The front tab covers the sheet's top hairline, so the two read as one piece.
        .overlay(alignment: .bottom) { if front { Rectangle().fill(t.paper).frame(height: 2).padding(.horizontal, 1).offset(y: 1) } }
        .zIndex(front ? 1 : 0)
        .contentShape(Rectangle())
    }
}

struct DesignAHome: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) fileprivate var t
    @State private var collections = 0

    private var recent: [Save] { model.glance?.recent ?? Array(model.saves.prefix(8)) }
    /// Kinds with something in them, most saves first.
    private var kinds: [(kind: String, count: Int)] {
        KindStyle.lifestyle.map { ($0, model.index.kind($0).count) }.filter { $0.1 > 0 }.sorted { $0.1 > $1.1 }
    }

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .top) {
                        Wordmark()
                        GlassEffectContainer(spacing: 10) { DesignHeaderButtons() }.padding(.top, 8)
                    }
                    .padding(.horizontal, 4)
                    VStack(alignment: .leading, spacing: -1) {
                        tabs.zIndex(1)
                        sheet
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

    private var tabs: some View {
        ScrollView(.horizontal) {
            HStack(alignment: .bottom, spacing: 4) {
                IndexTab(title: "Recent", front: true).accessibilityAddTraits(.isSelected)
                if model.reviewCount > 0 {
                    NavigationLink(value: Route.review) { IndexTab(title: "To file", symbol: "tray", count: model.reviewCount) }
                }
                NavigationLink(value: Route.collections) { IndexTab(title: "Collections", symbol: "bag", count: collections) }
                ForEach(kinds, id: \.kind) { k in
                    NavigationLink(value: Route.kind(k.kind)) {
                        IndexTab(title: KindStyle(k.kind).plural, symbol: KindStyle(k.kind).symbol, count: k.count, kind: k.kind)
                    }
                }
            }
            .buttonStyle(PressStyle())
            .padding(.trailing, 16)
        }
        .scrollIndicators(.hidden)
        .padding(.trailing, -16)
    }

    private var sheet: some View {
        BinderSheet {
            HStack(alignment: .firstTextBaseline) {
                Text("Recent").font(KSFont.section()).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                Spacer()
                Text(model.saves.isEmpty ? "" : "\(model.saves.count) saves in the binder")
                    .font(.footnote).foregroundStyle(t.inkMuted).monospacedDigit()
            }
            .padding(.top, 16).padding(.bottom, 12)
            if model.reviewCount > 0 {
                NavigationLink(value: Route.review) {
                    HStack(spacing: 10) {
                        Image(systemName: "tray.full").font(.body.weight(.semibold)).foregroundStyle(t.accent)
                        Text(model.reviewCount == 1 ? "1 save needs a collection" : "\(model.reviewCount) saves need a collection")
                            .font(.subheadline.weight(.semibold)).foregroundStyle(t.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        DesignFileButton()
                    }
                    .padding(.leading, 12).padding(.trailing, 8).frame(minHeight: 52)
                    .background(t.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(PressStyle())
                .padding(.bottom, 12)
            }
            ForEach(recent) { save in
                SheetRule()
                NavigationLink(value: save) { row(save) }
                    .buttonStyle(PressStyle())
                    .contextMenu { SaveMenu(save: save) }
            }
        }
    }

    private func row(_ save: Save) -> some View {
        let k = KindStyle(save.kind)
        return HStack(alignment: .center, spacing: 12) {
            DesignThumb(save: save, width: 52, height: 52, radius: 6)
            VStack(alignment: .leading, spacing: 3) {
                Text(save.title).font(.body.weight(.semibold)).foregroundStyle(t.ink).lineLimit(2).multilineTextAlignment(.leading)
                // The kind's word steps aside (its symbol stays) before a long fact would be cut short.
                ViewThatFits(in: .horizontal) {
                    facts(save, k, word: true)
                    facts(save, k, word: false)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .frame(minHeight: 68)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([save.title, k.label, save.needsFiling ? "Needs a collection" : save.fact ?? ""].filter { !$0.isEmpty }.joined(separator: ", "))
    }
}

private extension DesignAHome {
    func facts(_ save: Save, _ k: KindStyle, word: Bool) -> some View {
        HStack(spacing: 5) {
            Image(systemName: k.symbol).font(.caption.weight(.semibold)).foregroundStyle(t.kind(save.kind))
            if word { Text(k.label).font(.footnote.weight(.semibold)).foregroundStyle(t.kind(save.kind)) }
            if save.needsFiling {
                if word { Text("·").foregroundStyle(t.inkMuted) }
                Text("Needs a collection").foregroundStyle(t.accent).fontWeight(.semibold)
            } else if let fact = save.fact, !fact.isEmpty {
                Text(word ? "· \(fact)" : fact).foregroundStyle(t.inkMuted)
            }
        }
        .font(.footnote).lineLimit(1)
    }
}

struct DesignARecipe: View {
    let save: Save
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @State private var checked = DesignSwitch.checked

    private var current: Save { model.index.byId[save.id] ?? save }

    var body: some View {
        let ingredients = current.ingredientLines, steps = current.stepLines
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: -1) {
                    HStack(alignment: .bottom) {
                        IndexTab(title: "Recipes", symbol: "fork.knife", kind: "recipe", filled: true)
                        Spacer()
                        if let from = current.retailer ?? current.host {
                            Text(from).font(.footnote).foregroundStyle(t.inkMuted).padding(.bottom, 10).padding(.trailing, 4)
                        }
                    }
                    .zIndex(1)
                    BinderSheet {
                        Text(current.title).font(KSFont.name(.title)).foregroundStyle(t.ink)
                            .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
                            .padding(.top, 20)
                        Text(current.recipeFacts.map(\.value).joined(separator: " · "))
                            .font(.subheadline).foregroundStyle(t.inkMuted).monospacedDigit().padding(.top, 4)
                        DesignThumb(save: current, width: nil, height: 168, radius: 6).padding(.top, 16)
                        HStack(spacing: 8) {
                            StampButton("Cooked", done: current.isDone) { Task { await model.setDone(current, !current.isDone) } }
                            ShareStamp { SaveSharing.present(current) }
                        }
                        .padding(.top, 12).padding(.bottom, 20)

                        if !ingredients.isEmpty {
                            heading("Ingredients", note: checked.isEmpty ? "\(ingredients.count)" : "\(checked.count) of \(ingredients.count) ticked")
                            ForEach(Array(ingredients.enumerated()), id: \.offset) { i, line in
                                SheetRule()
                                let on = checked.contains(i)
                                Button {
                                    Haptic.checked()
                                    if on { checked.remove(i) } else { checked.insert(i) }
                                } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: on ? "checkmark.square.fill" : "square")
                                            .font(.title3).foregroundStyle(on ? t.stamp : t.inkMuted)
                                        Text(line).font(.body).foregroundStyle(on ? t.inkMuted : t.ink).strikethrough(on, color: t.inkMuted)
                                            .multilineTextAlignment(.leading)
                                        Spacer(minLength: 0)
                                    }
                                    .frame(minHeight: 46).contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(on ? .isSelected : [])
                            }
                            SheetRule()
                        }
                        if !steps.isEmpty {
                            heading("Method", note: "\(steps.count) steps").padding(.top, 24)
                            ForEach(Array(steps.enumerated()), id: \.offset) { i, step in
                                SheetRule()
                                HStack(alignment: .firstTextBaseline, spacing: 12) {
                                    Text("\(i + 1)").font(KSFont.name(.title3)).foregroundStyle(t.stamp).monospacedDigit().frame(width: 22, alignment: .leading)
                                    Text(step).font(.body).foregroundStyle(t.ink).fixedSize(horizontal: false, vertical: true)
                                }
                                .padding(.vertical, 12)
                            }
                        }
                    }
                }
                .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 24)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { DesignDock(save: current) }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu { DesignMoreMenu(save: current) } label: { Image(systemName: "ellipsis") }.accessibilityLabel("More")
            }
        }
    }

    private func heading(_ title: String, note: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(KSFont.section()).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
            Spacer()
            Text(note).font(.footnote).foregroundStyle(t.inkMuted).monospacedDigit()
        }
        .padding(.bottom, 10)
    }
}
#endif
