import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Cooking: one step fills the screen, in large type, and the screen stays awake. Each step shows the
/// ingredients it uses, with their amounts, right under the instruction (StepIngredients works out
/// which); tap one to check it off. Things made in an earlier step show as "from step N". Swipe or tap
/// Next; the progress bar opens every step and the whole list. The last step offers "Cooked".
/// Quiet music plays along (CookingMusic), unless it is turned off here or in Settings.
struct CookingView: View {
    let save: Save
    let steps: [String]
    let ingredients: [String]
    let cooked: () -> Void
    private let plan: StepIngredients
    @Environment(\.dismiss) private var dismiss
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var step = 0
    @State private var showOverview = false
    @State private var checked: Set<Int> = []
    @State private var music = CookingMusic()
    @AppStorage(CookingMusic.enabledKey) private var musicOn = true
    @Environment(\.scenePhase) private var scenePhase

    init(save: Save, steps: [String], ingredients: [String], cooked: @escaping () -> Void) {
        self.save = save
        self.steps = steps
        self.ingredients = ingredients
        self.cooked = cooked
        plan = StepIngredients(steps: steps, ingredients: ingredients)
    }

    var body: some View {
        ZStack {
            TableBackground()
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Button { dismiss() } label: { GlassIcon("xmark") }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Close")
                    Spacer()
                    CookingProgress(step: step, count: steps.count) { showOverview = true }
                    Spacer()
                    Color.clear.frame(width: 44, height: 44)
                }
                .padding(.horizontal, 12)
                CookingMusicBar(music: music, on: $musicOn)
                    .frame(maxWidth: .infinity).padding(.top, 2)
                TabView(selection: $step) {
                    ForEach(Array(steps.enumerated()), id: \.offset) { i, text in
                        ScrollView {
                            CookingStep(index: i, count: steps.count, text: text, plan: plan, extras: i == 0 ? plan.unmatched : [],
                                        checked: $checked)
                                .padding(24)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .onChange(of: step) { Haptic.pageTurned() }
                HStack(spacing: 12) {
                    if step > 0 {
                        Button { go(to: step - 1) } label: { GlassIcon("chevron.left", size: 52, font: .headline) }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Previous step")
                    }
                    if step < steps.count - 1 {
                        PrimarySlab("Next step", symbol: "arrow.right") { go(to: step + 1) }
                    } else {
                        PrimarySlab("Mark as cooked", symbol: "checkmark.circle.fill", kind: "recipe") {
                            Haptic.stamped()
                            cooked()
                            dismiss()
                        }
                    }
                }
                .padding(.horizontal, 16).padding(.bottom, 8)
            }
        }
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
            if musicOn { music.start() }
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            music.stop()
        }
        .onChange(of: musicOn) { _, on in if on { music.start(audible: true) } else { music.stop() } }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { music.resume() } else if phase == .background { music.suspend() }
        }
        .sheet(isPresented: $showOverview) {
            NavigationStack {
                List {
                    if !plan.items.isEmpty {
                        Section("Ingredients") {
                            ForEach(plan.items, id: \.index) { item in
                                Button { toggle(item.index) } label: {
                                    Label(ingredients[item.index], systemImage: checked.contains(item.index) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(checked.contains(item.index) ? t.inkMuted : t.ink)
                                }
                                .accessibilityAddTraits(checked.contains(item.index) ? .isSelected : [])
                            }
                        }
                    }
                    Section("Steps") {
                        ForEach(Array(steps.enumerated()), id: \.offset) { i, text in
                            Button { showOverview = false; go(to: i) } label: {
                                HStack(alignment: .firstTextBaseline, spacing: 12) {
                                    Text("\(i + 1)").font(.headline.monospacedDigit()).foregroundStyle(t.stamp)
                                    Text(text).foregroundStyle(t.ink).lineLimit(3)
                                }
                            }
                            .accessibilityAddTraits(i == step ? .isSelected : [])
                        }
                    }
                }
                .navigationTitle(save.title).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showOverview = false } } }
            }
            .presentationDetents([.medium, .large])
        }
    }

    private func go(to i: Int) {
        withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) { step = min(max(i, 0), steps.count - 1) }
    }

    private func toggle(_ i: Int) {
        Haptic.checked()
        if checked.contains(i) { checked.remove(i) } else { checked.insert(i) }
    }
}

/// Where you are: a bar of segments and "Step 2 of 4".
/// Tapping it opens every step and the whole ingredient list.
private struct CookingProgress: View {
    let step: Int
    let count: Int
    let open: () -> Void
    @Environment(\.ks) private var t

    var body: some View {
        Button(action: open) {
            let bar = HStack(spacing: 4) {
                ForEach(0..<count, id: \.self) { k in
                    Capsule().fill(k <= step ? t.accent : t.rule).frame(height: 5)
                }
            }
            .frame(width: min(132, CGFloat(count) * 33))
            VStack(spacing: 6) {
                bar
                Text("Step \(step + 1) of \(count)").font(.subheadline.weight(.semibold)).foregroundStyle(t.inkMuted).monospacedDigit()
            }
        }
        .buttonStyle(.plain)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
        .contentTransition(.numericText())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(step + 1) of \(count)")
        .accessibilityHint("Shows every step and ingredient")
        .accessibilityAddTraits(.isButton)
    }
}

/// One step: its number, the instruction and the ingredients it uses, drawn in the current style.
/// Chromatic: coloured ingredient chips that fill when checked. Paper & Ink: the ingredient words
/// highlighted in the instruction, a ruled list with amounts. Nocturne: a lit panel of what to gather
/// above the instruction, amounts in amber.
private struct CookingStep: View {
    let index: Int
    let count: Int
    let text: String
    let plan: StepIngredients
    /// Ingredients no step names, shown on the first step so nothing is missed.
    let extras: [Int]
    @Binding var checked: Set<Int>
    @Environment(\.ks) private var t
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .largeTitle) private var numeral: CGFloat = 64
    /// The amounts column beside the names ("50 g", "1 tbsp").
    @ScaledMetric(relativeTo: .footnote) private var noteAmountWidth: CGFloat = 48

    private var current: StepIngredients.Step { plan.steps.indices.contains(index) ? plan.steps[index] : .init() }
    private var groups: [(label: String, items: [Int])] {
        var g: [(String, [Int])] = []
        if !current.items.isEmpty { g.append(("You'll need", current.items)) }
        if !extras.isEmpty { g.append((g.isEmpty ? "You'll need" : "Also needed", extras)) }
        return g
    }

    var body: some View {
        switch t.style {
        case .chromatic:
            VStack(alignment: .leading, spacing: 20) {
                Text("\(index + 1)").font(.system(size: numeral, weight: .heavy, design: .rounded))
                    .foregroundStyle(t.accent).accessibilityHidden(true)
                instruction(.system(.title2, design: .rounded).weight(.bold))
                ForEach(groups, id: \.label) { g in
                    VStack(alignment: .leading, spacing: 12) {
                        Text(g.label).font(.system(.subheadline, design: .rounded).weight(.bold)).foregroundStyle(t.ink)
                        Flow(spacing: 10) { ForEach(g.items, id: \.self) { jar($0) } }
                    }
                }
                if !current.carried.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Bring together").font(.system(.subheadline, design: .rounded).weight(.bold)).foregroundStyle(t.ink)
                        Flow(spacing: 10) { ForEach(current.carried, id: \.fromStep) { carriedJar($0) } }
                    }
                }
            }
        case .nocturne:
            VStack(alignment: .leading, spacing: 24) {
                Text("Step \(index + 1)").font(.system(.title3, design: .rounded).weight(.bold)).foregroundStyle(t.accent).accessibilityHidden(true)
                if !groups.isEmpty || !current.carried.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(Array(allRows.enumerated()), id: \.offset) { k, row in
                            if k > 0 { Rectangle().fill(t.rule).frame(height: 1) }
                            row
                        }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 4)
                    .ksSurface()
                }
                instruction(.title2.weight(.semibold))
            }
        case .paper:
            VStack(alignment: .leading, spacing: 20) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(index + 1).").font(.system(size: numeral * 0.9, weight: .semibold, design: .serif)).foregroundStyle(t.stamp)
                    Text("of \(count)").font(.subheadline.weight(.medium)).foregroundStyle(t.inkMuted)
                }
                .accessibilityHidden(true)
                instruction(.system(.title2, design: .serif), highlight: true)
                table
            }
        }
    }

    /// The instruction; Paper & Ink runs a highlighter over the words that name an ingredient.
    private func instruction(_ font: Font, highlight: Bool = false) -> some View {
        var s = AttributedString(text)
        if highlight {
            for r in plan.highlights(in: text, step: index) {
                if let a = AttributedString.Index(r.lowerBound, within: s), let b = AttributedString.Index(r.upperBound, within: s) {
                    s[a..<b].backgroundColor = t.highlight
                }
            }
        }
        return Text(s).font(font).foregroundStyle(t.ink).lineSpacing(4)
            .accessibilityLabel("Step \(index + 1). \(text)")
    }

    // MARK: Rows (Paper & Ink, Nocturne)

    @ViewBuilder private var table: some View {
        if !groups.isEmpty || !current.carried.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(groups, id: \.label) { g in
                    VStack(alignment: .leading, spacing: 8) {
                        label(g.label)
                        ruled(g.items.map { AnyView(row($0)) })
                    }
                }
                if !current.carried.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        label("Bring together")
                        ruled(current.carried.map { AnyView(carriedRow($0)) })
                    }
                }
            }
        }
    }

    private var allRows: [AnyView] {
        groups.flatMap(\.items).map { AnyView(row($0)) } + current.carried.map { AnyView(carriedRow($0)) }
    }

    private func label(_ s: String) -> some View {
        Text(s).font(KSFont.label(t)).foregroundStyle(t.inkMuted)
            .accessibilityAddTraits(.isHeader)
    }

    private func ruled(_ rows: [AnyView]) -> some View {
        VStack(spacing: 0) {
            Rectangle().fill(t.rule).frame(height: 1)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                r
                Rectangle().fill(t.rule).frame(height: 1)
            }
        }
    }

    private func row(_ i: Int) -> some View {
        let item = plan.items[i]
        let done = checked.contains(i)
        let name = Text(item.name)
            .font(t.style == .paper ? .system(.title3, design: .serif) : .body)
            .strikethrough(done, color: t.stamp)
            .foregroundStyle(done ? t.inkMuted : t.ink)
        let amount = Text(item.amount)
            .font((t.style == .nocturne ? Font.subheadline : .footnote).weight(.semibold).monospacedDigit())
            .foregroundStyle(t.style == .nocturne ? t.accent : t.inkMuted)
        // Amount over name: when the row is too narrow, and always at accessibility sizes, where a
        // scaled amount column would push the names to the far side.
        let stacked = HStack(alignment: .top, spacing: 12) {
            box(done)
            VStack(alignment: .leading, spacing: 2) { if !item.amount.isEmpty { amount }; name }
            Spacer(minLength: 0)
        }
        return Button { toggle(i) } label: {
            Group {
                if typeSize.isAccessibilitySize {
                    stacked
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 12) {
                            if t.style == .nocturne {
                                box(done); name; Spacer(minLength: 8); amount
                            } else {
                                box(done); amount.frame(width: noteAmountWidth, alignment: .leading); name; Spacer(minLength: 0)
                            }
                        }
                        stacked
                    }
                }
            }
            .frame(minHeight: 50).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([item.amount, item.name].filter { !$0.isEmpty }.joined(separator: " "))
        .accessibilityAddTraits(done ? [.isButton, .isSelected] : .isButton)
    }

    private func carriedRow(_ c: StepIngredients.Carried) -> some View {
        Group {
            HStack(alignment: .center, spacing: 12) {
                Image(systemName: "plus.circle").font(.footnote.weight(.semibold)).foregroundStyle(t.inkMuted).frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(names(c)).font(t.style == .paper ? .system(.title3, design: .serif) : .body).foregroundStyle(t.ink)
                    Text("From step \(c.fromStep + 1)").font(.caption).foregroundStyle(t.inkMuted)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6).frame(minHeight: 50)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(names(c)), from step \(c.fromStep + 1)")
    }

    private func box(_ done: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: 7, style: .continuous)
        return shape.fill(done ? t.primary : .clear)
            .overlay { shape.strokeBorder(done ? t.primary : t.inkMuted, lineWidth: 1.5) }
            .overlay { if done { Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(t.onPrimary) } }
            .frame(width: 24, height: 24)
    }

    // MARK: Chips (Chromatic)

    private func jar(_ i: Int) -> some View {
        let item = plan.items[i]
        let done = checked.contains(i)
        let ink = done ? t.onKind : t.ink
        return Button { toggle(i) } label: {
            HStack(spacing: 8) {
                Circle().fill(done ? t.onKind : t.paper)
                    .overlay { Circle().strokeBorder(done ? t.onKind : t.rule, lineWidth: 1.5) }
                    .overlay { if done { Image(systemName: "checkmark").font(.system(size: 12, weight: .black)).foregroundStyle(t.kindFill("recipe")) } }
                    .frame(width: 26, height: 26)
                if !item.amount.isEmpty { Text(item.amount).font(.system(.body, design: .rounded).weight(.heavy)).foregroundStyle(ink) }
                Text(item.name).font(.system(.body, design: .rounded).weight(.semibold)).foregroundStyle(ink)
                    .strikethrough(done, color: ink).multilineTextAlignment(.leading)
            }
            .padding(.leading, 10).padding(.trailing, 16).padding(.vertical, 9)
            .frame(minHeight: 48)
            .background(done ? t.kindFill("recipe") : t.well, in: Capsule())
            .overlay { Capsule().strokeBorder(done ? .clear : t.rule, lineWidth: 1) }
        }
        .buttonStyle(PressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([item.amount, item.name].filter { !$0.isEmpty }.joined(separator: " "))
        .accessibilityAddTraits(done ? [.isButton, .isSelected] : .isButton)
    }

    private func carriedJar(_ c: StepIngredients.Carried) -> some View {
        Group {
            HStack(spacing: 8) {
                Text("Step \(c.fromStep + 1)").font(.system(.caption, design: .rounded).weight(.bold)).foregroundStyle(t.onAccent)
                    .padding(.horizontal, 8).padding(.vertical, 4).background(t.accent, in: Capsule())
                Text(names(c)).font(.system(.body, design: .rounded).weight(.semibold)).foregroundStyle(t.ink).multilineTextAlignment(.leading)
            }
            .padding(.leading, 8).padding(.trailing, 16).padding(.vertical, 9)
            .frame(minHeight: 48)
            .background(t.well, in: Capsule())
            .overlay { Capsule().strokeBorder(t.rule, style: StrokeStyle(lineWidth: 1.5, dash: [6, 4])) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(names(c)), from step \(c.fromStep + 1)")
    }

    private func names(_ c: StepIngredients.Carried) -> String {
        let s = c.items.map { plan.items[$0].name }.joined(separator: ", ")
        return s.prefix(1).uppercased() + String(s.dropFirst())
    }

    private func toggle(_ i: Int) {
        Haptic.checked()
        if checked.contains(i) { checked.remove(i) } else { checked.insert(i) }
    }
}

/// Lays chips out in rows, wrapping to the next row when one is full.
private struct Flow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(proposal.width ?? .infinity, subviews)
        let width = rows.map { $0.reduce(0) { $0 + $1.width } + spacing * CGFloat(max($0.count - 1, 0)) }.max() ?? 0
        let height = rows.map { $0.map(\.height).max() ?? 0 }.reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: min(width, proposal.width ?? width), height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        var k = 0
        for row in arrange(bounds.width, subviews) {
            var x = bounds.minX
            let h = row.map(\.height).max() ?? 0
            for size in row {
                subviews[k].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: size.width, height: size.height))
                x += size.width + spacing
                k += 1
            }
            y += h + spacing
        }
    }

    private func arrange(_ width: CGFloat, _ subviews: Subviews) -> [[CGSize]] {
        var rows: [[CGSize]] = [[]]
        var x: CGFloat = 0
        for v in subviews {
            var s = v.sizeThatFits(.unspecified)
            if s.width > width { s = v.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
            if x > 0, x + s.width > width { rows.append([]); x = 0 }
            rows[rows.count - 1].append(s)
            x += s.width + spacing
        }
        return rows
    }
}
