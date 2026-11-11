#if DEBUG
import SwiftUI
import KeepsakeKit
import KeepsakeUI

// Direction C, "To Do With It": saves are filed by what you will do with them. Home is a short page
// of verbs (Buy, Cook, Go, Read) in large type, each with its next two saves and a stamp ring to
// mark them done. No cards: type, hairlines and one accent.
// Shape rule: pictures 10, rings and controls round, nothing else has a surface.

private struct Verb: Identifiable {
    let word: String
    let kinds: [String]
    let noun: (Int) -> String
    var id: String { word }
    static let all = [
        Verb(word: "Buy", kinds: ["product"]) { $0 == 1 ? "1 thing" : "\($0) things" },
        Verb(word: "Cook", kinds: ["recipe"]) { $0 == 1 ? "1 recipe" : "\($0) recipes" },
        Verb(word: "Go", kinds: ["place"]) { $0 == 1 ? "1 place" : "\($0) places" },
        Verb(word: "Train", kinds: ["workout"]) { $0 == 1 ? "1 workout" : "\($0) workouts" },
        Verb(word: "Read", kinds: ["book", "article"]) { "\($0) to read" },
        Verb(word: "Watch", kinds: ["video", "media"]) { "\($0) to watch" },
        Verb(word: "Open", kinds: ["link"]) { $0 == 1 ? "1 link" : "\($0) links" },
    ]
    var route: Route { kinds == ["product"] ? .collections : kinds.count == 1 ? .kind(kinds[0]) : .lifestyle }
}

/// The done mark, here and on the recipe: a ring in the kind's colour, pressed solid once done.
private struct StampRing: View {
    let kind: String
    let done: Bool
    var size: CGFloat = 28
    @Environment(\.ks) private var t
    var body: some View {
        ZStack {
            if done {
                Circle().fill(t.stamp)
                Image(systemName: "checkmark").font(.system(size: size * 0.46, weight: .heavy)).foregroundStyle(t.style == .paper ? t.onAccent : t.onDetail)
            } else {
                Circle().strokeBorder(t.kind(kind), lineWidth: 2)
            }
        }
        .frame(width: size, height: size)
        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
    }
}

struct DesignCHome: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @ScaledMetric(relativeTo: .largeTitle) private var verbSize: CGFloat = 46

    /// Verbs with something under them, the one saved to most recently first.
    private var sections: [(verb: Verb, saves: [Save])] {
        let order = Dictionary(model.saves.enumerated().map { ($0.element.id, $0.offset) }, uniquingKeysWith: { a, _ in a })
        return Verb.all.map { v in (v, v.kinds.flatMap { model.index.kind($0) }.sorted { (order[$0.id] ?? 0) < (order[$1.id] ?? 0) }) }
            .filter { !$0.1.isEmpty }
            .sorted { (order[$0.1[0].id] ?? 0) < (order[$1.1[0].id] ?? 0) }
    }

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        BinderMark().stroke(t.accent, style: StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round)).frame(width: 28, height: 28)
                            .accessibilityHidden(true)
                        Text("Internet Binder").font(KSFont.name(.headline)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                        Spacer()
                        DesignHeaderButtons(glass: false)
                    }
                    .padding(.trailing, -12)
                    if model.reviewCount > 0 { review }
                    ForEach(sections, id: \.verb.id) { s in section(s.verb, s.saves) }
                }
                .padding(.horizontal, 20).padding(.bottom, 40)
            }
            .clearsTabBar()
            .safeAreaInset(edge: .top, spacing: 0) { TopScrim() }
        }
        .toolbar(.hidden, for: .navigationBar)
    }

    private var rule: some View { Rectangle().fill(t.rule).frame(height: 1) }

    private var review: some View {
        NavigationLink(value: Route.review) {
            HStack(spacing: 12) {
                Image(systemName: "tray.full").font(.body.weight(.semibold)).foregroundStyle(t.accent).frame(width: 28)
                Text(model.reviewCount == 1 ? "1 save needs a collection" : "\(model.reviewCount) saves need a collection")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(t.ink).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                DesignFileButton()
            }
            .frame(minHeight: 60)
            .overlay(alignment: .top) { rule }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
        .padding(.top, 8)
    }

    private func section(_ verb: Verb, _ saves: [Save]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            rule
            NavigationLink(value: verb.route) {
                HStack(alignment: .firstTextBaseline) {
                    Text(verb.word).font(.system(size: verbSize, weight: t.style == .paper ? .semibold : .bold, design: t.displayDesign))
                        .tracking(-0.8).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                    Spacer()
                    HStack(spacing: 4) {
                        Text(verb.noun(saves.count)).monospacedDigit()
                        Image(systemName: "chevron.right").font(.caption.weight(.bold))
                    }
                    .font(.subheadline).foregroundStyle(t.inkMuted)
                }
                .frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .padding(.top, 20)
            ForEach(saves.prefix(2)) { save in row(save) }
        }
        .padding(.bottom, 16)
    }

    private func row(_ save: Save) -> some View {
        let k = KindStyle(save.kind)
        return HStack(alignment: .center, spacing: 4) {
            Button {
                Haptic.stamped()
                Task { await model.setDone(save, !save.isDone) }
            } label: { StampRing(kind: save.kind, done: save.isDone) }
                .buttonStyle(PressStyle())
                .accessibilityLabel(save.isDone ? "\(k.doneVerb), done" : "Mark \(k.doneVerb.lowercased())")
                .padding(.leading, -8)
            NavigationLink(value: save) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(save.title).font(.body.weight(.semibold)).foregroundStyle(save.isDone ? t.inkMuted : t.ink)
                            .strikethrough(save.isDone, color: t.inkMuted).lineLimit(2).multilineTextAlignment(.leading)
                        if save.isDone {
                            Text(k.doneVerb).font(.footnote.weight(.semibold)).foregroundStyle(t.stamp)
                        } else if save.needsFiling {
                            Text("Needs a collection").font(.footnote.weight(.semibold)).foregroundStyle(t.accent)
                        } else if let fact = save.fact, !fact.isEmpty {
                            Text(fact).font(.footnote).foregroundStyle(t.inkMuted).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    DesignThumb(save: save, width: 56, height: 56, radius: 10).saturation(save.isDone ? 0.3 : 1)
                }
                .frame(minHeight: 68).contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .contextMenu { SaveMenu(save: save) }
        }
    }
}

struct DesignCRecipe: View {
    let save: Save
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @State private var checked = DesignSwitch.checked
    @ScaledMetric(relativeTo: .largeTitle) private var titleSize: CGFloat = 40

    private var current: Save { model.index.byId[save.id] ?? save }
    private var rule: some View { Rectangle().fill(t.rule).frame(height: 1) }

    /// "2 tbsp" and "olive oil": the amount set apart, so the eye runs down one column while shopping.
    static func split(_ line: String) -> (amount: String, name: String) {
        let units: Set<String> = ["tbsp", "tsp", "g", "kg", "ml", "l", "cup", "cups", "can", "cans", "oz", "lb", "clove", "cloves", "pinch"]
        let words = line.split(separator: " ").map(String.init)
        guard let first = words.first, first.first?.isNumber == true else { return ("", line) }
        let n = words.count > 2 && units.contains(words[1].lowercased()) ? 2 : 1
        return (words.prefix(n).joined(separator: " "), words.dropFirst(n).joined(separator: " "))
    }

    var body: some View {
        let ingredients = current.ingredientLines, steps = current.stepLines, done = current.isDone
        ZStack {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(["Cook", current.retailer ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.subheadline.weight(.semibold)).foregroundStyle(t.kind("recipe"))
                    Text(current.title).font(.system(size: titleSize, weight: t.style == .paper ? .semibold : .bold, design: t.displayDesign))
                        .tracking(-0.6).foregroundStyle(t.ink).fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader).padding(.top, 4)

                    // The page's facts as one ruled line.
                    HStack(alignment: .top, spacing: 0) {
                        ForEach(Array(current.recipeFacts.enumerated()), id: \.offset) { i, f in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(f.label).font(.caption).foregroundStyle(t.inkMuted)
                                Text(f.value).font(.subheadline.weight(.semibold)).foregroundStyle(t.ink).monospacedDigit()
                            }
                            .padding(.leading, i == 0 ? 0 : 12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .overlay(alignment: .leading) { if i > 0 { Rectangle().fill(t.rule).frame(width: 1) } }
                        }
                    }
                    .padding(.vertical, 12)
                    .overlay(alignment: .top) { rule }.overlay(alignment: .bottom) { rule }
                    .padding(.top, 16)

                    HStack(spacing: 12) {
                        DesignThumb(save: current, width: 132, height: 100, radius: 10)
                        Button {
                            Haptic.stamped()
                            Task { await model.setDone(current, !done) }
                        } label: {
                            HStack(spacing: 4) {
                                StampRing(kind: "recipe", done: done, size: 32)
                                Text(done ? "Cooked" : "Mark as cooked").font(.subheadline.weight(.semibold)).foregroundStyle(done ? t.stamp : t.ink)
                            }
                        }
                        .buttonStyle(PressStyle())
                        Spacer(minLength: 0)
                    }
                    .padding(.top, 16)

                    if !ingredients.isEmpty {
                        heading("Ingredients", note: checked.isEmpty ? "\(ingredients.count)" : "\(checked.count) of \(ingredients.count) ready").padding(.top, 28)
                        ForEach(Array(ingredients.enumerated()), id: \.offset) { i, line in
                            let on = checked.contains(i), parts = Self.split(line)
                            Button {
                                Haptic.checked()
                                if on { checked.remove(i) } else { checked.insert(i) }
                            } label: {
                                HStack(alignment: .firstTextBaseline, spacing: 12) {
                                    Text(parts.amount).font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(on ? t.inkMuted : t.ink)
                                        .frame(width: 64, alignment: .trailing)
                                    Text(parts.name.prefix(1).uppercased() + parts.name.dropFirst()).font(.body).foregroundStyle(on ? t.inkMuted : t.ink)
                                        .strikethrough(on, color: t.inkMuted).multilineTextAlignment(.leading)
                                    Spacer(minLength: 0)
                                    Image(systemName: on ? "checkmark.circle.fill" : "circle").font(.body)
                                        .foregroundStyle(on ? t.stamp : t.inkMuted)
                                        .accessibilityHidden(true)
                                }
                                .frame(minHeight: 44).contentShape(Rectangle())
                                .overlay(alignment: .bottom) { rule }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(line).accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                    if !steps.isEmpty {
                        heading("Method", note: "\(steps.count) steps").padding(.top, 32)
                        ForEach(Array(steps.enumerated()), id: \.offset) { i, step in
                            HStack(alignment: .firstTextBaseline, spacing: 12) {
                                Text("\(i + 1)").font(.system(.title, design: t.displayDesign).weight(.bold)).foregroundStyle(t.stamp)
                                    .monospacedDigit().frame(width: 64, alignment: .trailing)
                                Text(step).font(.body).foregroundStyle(t.ink).fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(.vertical, 12)
                            .overlay(alignment: .bottom) { rule }
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 24)
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
            Text(title).font(KSFont.name(.title2)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
            Spacer()
            Text(note).font(.footnote).foregroundStyle(t.inkMuted).monospacedDigit()
        }
        .padding(.bottom, 8)
        .overlay(alignment: .bottom) { rule }
    }
}
#endif
