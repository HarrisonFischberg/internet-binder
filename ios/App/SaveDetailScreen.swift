import SwiftUI
import MapKit
import KeepsakeKit
import KeepsakeUI

/// One save, opened from its card. The kind decides the panel and the one primary action:
/// a place → Directions, a recipe → its checklist and steps, anything else → Open.
struct SaveDetailScreen: View {
    let save: Save
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.dismiss) private var dismiss
    @State private var detail: SaveDetail?
    @State private var checked: Set<Int> = []
    @State private var cooking = false
    @State private var goalSheet = false
    @State private var editing = false
    @State private var destinations: [Destination] = []

    /// The latest copy (a stamp or an edit updates it in place).
    private var current: Save { model.index.byId[save.id] ?? save }
    private var d: JSONValue? { current.details }
    private var isDone: Bool { current.status == "done" }
    private var isPurchased: Bool { current.purchased == true }
    /// Things to buy: products, and anything filed in a collection.
    private var canBuy: Bool { current.kind == "product" || !(current.collectionId ?? "").isEmpty }
    private var isInstagram: Bool { (current.host ?? "").hasSuffix("instagram.com") }
    /// The recipe's steps, without wordless lines (older saves kept Instagram's "." spacers).
    private var steps: [String] { (d?["steps"]?.array?.compactMap(\.string) ?? []).filter { $0.contains(where: { $0.isLetter || $0.isNumber }) } }

    /// Body text: serif in Paper & Ink, SF Pro everywhere else.
    private var reading: Font { t.style == .paper ? .system(.body, design: .serif) : .body }

    var body: some View {
        ZStack(alignment: .bottom) {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    hero
                    titleBlock
                    marks
                    if current.needsCollection && current.purchased != true { FilingPanel(save: current) }
                    panel
                    if let note = current.note, !note.isEmpty {
                        Text("“\(note)”").font(KSFont.note).foregroundStyle(t.inkMuted)
                    }
                    source
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
        // One layer at the bottom: the save's primary action, docked. The tabs step aside on a save (the
        // stack hides them: RootView's Stack).
        .safeAreaInset(edge: .bottom, spacing: 0) { dock }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.aiReady {
                ToolbarItem(placement: .primaryAction) { FixWithAIButton(saves: [current], what: "it") }
            }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Edit", systemImage: "pencil") { editing = true }
                    Menu("Move to…", systemImage: "folder") {
                        Button("New collection…", systemImage: "plus") { model.newCollectionFor = [current.id] }
                        ForEach(destinations) { d in
                            Button(d.label) {
                                Task {
                                    let name = (try? await model.library?.put([current.id], in: d.value, learn: "strong")) ?? d.label
                                    Haptic.dropped()
                                    model.refresh()
                                    model.show("Moved to \(name)")
                                }
                            }
                        }
                    }
                    if canBuy {
                        Button(isPurchased ? "Not purchased" : "Mark purchased", systemImage: "bag.badge.checkmark") { togglePurchased() }
                    }
                    if current.url != nil {
                        Button("Share", systemImage: "square.and.arrow.up") { SaveSharing.present(current) }
                    }
                    Button("Move to Trash", systemImage: "trash", role: .destructive) {
                        Task { await model.trash(current); dismiss() }
                    }
                } label: { Image(systemName: "ellipsis") }
                .accessibilityLabel("More")
            }
        }
        .task {
            try? await model.library?.core.call("store.markOpened", [save.id])
            destinations = (try? await model.library?.destinations()) ?? []
        }
        .sheet(isPresented: $editing) { EditSaveSheet(save: current) }
        .task(id: "\(current.status ?? "")\(current.title)") { await reload() }
        .fullScreenCover(isPresented: $cooking) {
            CookingView(save: current, steps: steps,
                        ingredients: d?["ingredients"]?.array?.compactMap(\.string) ?? []) {
                Task { await model.setDone(current, true) }
                model.celebrate("Cooked!")
            }
        }
        .sheet(isPresented: $goalSheet) {
            GoalSheet { perWeek, weeks in
                Task {
                    _ = try? await model.library?.createGoal(itemId: current.id, perWeek: perWeek, weeks: weeks)
                    Haptic.settled()
                    await reload()
                }
            }
        }
    }

    private func reload() async {
        detail = try? await model.library?.detail(save.id)
        if current.kind == "workout" { model.widgetsChanged() }
    }

    /// Chrome's own link builder (kinds.js mapsLinks): from what's saved, nothing looked up.
    private var mapsLink: URL? { (detail?.maps?.apple).flatMap(URL.init(string:)) }
    private var goal: GoalView? { detail?.goals.first { $0.progress.status == "active" } ?? detail?.goals.last }

    // MARK: hero

    @ViewBuilder private var hero: some View {
        if current.kind == "place", let lat = d?["lat"]?.number, let lng = d?["lng"]?.number {
            let pin = CLLocationCoordinate2D(latitude: lat, longitude: lng)
            VStack(spacing: 0) {
                Map(initialPosition: .region(MKCoordinateRegion(center: pin, latitudinalMeters: 800, longitudinalMeters: 800))) {
                    Marker(current.title, coordinate: pin).tint(KindStyle("place").color)
                }
                .mapStyle(.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll))
                .frame(height: 280)
                .overlay(alignment: .topTrailing) { Stamp(kind: "place", size: 44).padding(12) }
                .accessibilityElement(children: .ignore)   // the map's street names aren't for VoiceOver
                .accessibilityLabel("Map of \(current.title)")
                .accessibilityHint("Use Directions below to go there.")
            }
            .ksSurface()
            .padding(.top, 8)
        } else if current.hasImage && (current.kind == "book" || current.kind == "media") {
            // A cover or poster stands upright, like the thing itself.
            Button {
                if let url = current.url.flatMap(URL.init(string:)) { openURL(url) }
            } label: {
                SaveImage(current, symbolSize: 48)
                    .frame(width: 200, height: 300)
                    .ksSurface()
            }
            .buttonStyle(PressStyle())
            .disabled(current.url == nil)
            .accessibilityLabel(current.kind == "book" ? "Cover of \(current.title)" : "Poster for \(current.title)")
            .accessibilityHint(current.url == nil ? "" : "Opens \(current.host ?? "the page")")
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
        } else if current.hasImage {
            // The picture opens where it came from: an Instagram reel's thumbnail (with its play
            // button) plays the reel.
            Button {
                if let url = current.url.flatMap(URL.init(string:)) { openURL(url) }
            } label: {
                SaveImage(current, symbolSize: 48)
                    .frame(height: 300).frame(maxWidth: .infinity).clipped()
                    .ksSurface()
            }
            .buttonStyle(PressStyle())
            .disabled(current.url == nil)
            .accessibilityLabel(isInstagram ? "Open the post on Instagram" : "Open \(current.host ?? "the page")")
            .padding(.top, 8)
        } else {
            // No picture: the kind chip and title below lead (a card here would say the title twice).
            Color.clear.frame(height: 8)
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            KindLabel(kind: current.kind)
            Text(current.title).font(KSFont.display()).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                .fixedSize(horizontal: false, vertical: true)
            if let fact = current.fact, !fact.isEmpty { Text(fact).font(.subheadline).foregroundStyle(t.inkMuted) }
        }
    }

    // MARK: kind panels

    @ViewBuilder private var panel: some View {
        switch current.kind {
        case "place": VStack(alignment: .leading, spacing: 12) { sourceNote; placePanel }
        case "recipe": VStack(alignment: .leading, spacing: 12) { sourceNote; basedOnNote; recipePanel }
        case "workout": VStack(alignment: .leading, spacing: 12) { sourceNote; workoutPanel }
        case "product": productPanel
        case "book", "media": shelfPanel
        default:
            if let text = [current.description, current.instagram?.caption].compactMap({ $0 }).first(where: { !$0.isEmpty }) {
                Text(text).font(reading).foregroundStyle(t.ink).lineSpacing(4)
            }
        }
    }

    /// Where the card's details came from ("Recipe read by AI"), worked out by Chrome's labels.
    @ViewBuilder private var sourceNote: some View {
        if let label = detail?.sourceLabel, !label.isEmpty {
            Text(label).font(KSFont.note).foregroundStyle(t.inkMuted)
        }
    }

    /// A recipe found online because the post never wrote one down (understand.js readRecipe): where it's
    /// from, with its link, so nobody takes it for the creator's own.
    @ViewBuilder private var basedOnNote: some View {
        if let based = detail?.basedOn, let link = URL(string: based.url) {
            let site = based.site.flatMap { $0.isEmpty ? nil : $0 } ?? link.host() ?? "another site"
            Button { openURL(link) } label: {
                // Accessibility sizes: the icon sits above the words so they get the card's full width.
                (typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(alignment: .top, spacing: 12))) {
                    Image(systemName: "link").font(.subheadline.weight(.semibold)).foregroundStyle(KindStyle("recipe").color)
                        .padding(.top, 2).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        (Text("Based on a recipe from ") + Text(site).fontWeight(.semibold).underline())
                            .font(.subheadline).foregroundStyle(t.ink)
                        Text("The post didn't share its recipe, so AI found a close one. It may differ from the video.")
                            .font(.footnote).foregroundStyle(t.inkMuted)
                    }
                    .multilineTextAlignment(.leading)
                    if !typeSize.isAccessibilitySize {
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.up.right").font(.subheadline.weight(.semibold)).foregroundStyle(t.inkMuted).accessibilityHidden(true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .frame(minHeight: 44)
                .ksSurface()
                .contentShape(Rectangle())
            }
            .buttonStyle(PressStyle())
            .accessibilityLabel("Based on a recipe from \(site). It may differ from the video.")
            .accessibilityHint("Opens \(site)")
            .accessibilityIdentifier("recipe.basedOn")
        }
    }

    /// What your AI provider found the thing to be (understand.js understandProduct): the shop page's own
    /// facts first, then the provider's summary, labelled as its own words, then what the post said.
    @ViewBuilder private var productPanel: some View {
        let brand = [d?["brand"]?.string, d?["category"]?.string].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        let shopText = d?["shopDescription"]?.string ?? ""
        let specs = d?["specs"]?.array ?? []
        let features = d?["features"]?.array?.compactMap(\.string) ?? []
        let summary = d?["summary"]?.string ?? ""
        let shop = d?["shopName"]?.string ?? ""
        let stock = d?["availability"]?.string ?? ""
        let caption = [current.instagram?.caption, current.description].compactMap { $0 }.first(where: { !$0.isEmpty })
        VStack(alignment: .leading, spacing: 18) {
            if !brand.isEmpty || !shopText.isEmpty || !specs.isEmpty || !features.isEmpty || !stock.isEmpty {
                card(shop.isEmpty ? "About it" : "From \(shop)") {
                    VStack(alignment: .leading, spacing: 10) {
                        if !brand.isEmpty { Text(brand).font(.subheadline.weight(.semibold)).foregroundStyle(t.inkMuted) }
                        if !shopText.isEmpty { Text(shopText).font(reading).foregroundStyle(t.ink).lineSpacing(3) }
                        ForEach(Array(specs.enumerated()), id: \.offset) { _, s in
                            if let label = s["label"]?.string, let value = s["value"]?.string {
                                HStack(alignment: .firstTextBaseline, spacing: 12) {
                                    Text(label).font(.subheadline).foregroundStyle(t.inkMuted).frame(minWidth: 90, alignment: .leading)
                                    Text(value).font(reading).foregroundStyle(t.ink)
                                    Spacer(minLength: 0)
                                }
                                .padding(.vertical, 4)
                                .overlay(alignment: .bottom) { rule }
                            }
                        }
                        ForEach(features, id: \.self) { f in
                            Label(f, systemImage: "checkmark").font(reading).foregroundStyle(t.ink)
                        }
                        if !stock.isEmpty {
                            Text(stock == "in_stock" ? "In stock" : "Out of stock").font(.subheadline.weight(.semibold))
                                .foregroundStyle(stock == "in_stock" ? KindStyle("product").color : t.inkMuted)
                        }
                    }
                }
            }
            if !summary.isEmpty { aiSummary(summary) }
            if let caption {
                VStack(alignment: .leading, spacing: 6) {
                    if !summary.isEmpty || !shopText.isEmpty {
                        Text(isInstagram ? "The post said" : "Saved with it").font(.caption.weight(.semibold)).foregroundStyle(t.inkMuted)
                    }
                    Text(caption).font(reading).foregroundStyle(summary.isEmpty && shopText.isEmpty ? t.ink : t.inkMuted).lineSpacing(4)
                }
            }
        }
    }

    /// Your AI provider's own words, labelled as such.
    private func aiSummary(_ summary: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("AI summary").font(.caption.weight(.semibold)).foregroundStyle(t.ink)
                .padding(.horizontal, 8).padding(.vertical, 2)
                .background(Capsule().fill(t.stamp.opacity(0.18)))
            Text(summary).font(reading).foregroundStyle(t.ink).lineSpacing(3)
        }
        .accessibilityElement(children: .combine)
    }

    /// A book, film or show (Chrome's shelfFacts): what it's about, its facts, and for a film or show where
    /// it streams, as your provider's web search found it (understand.js readTitle).
    @ViewBuilder private var shelfPanel: some View {
        let summary = d?["summary"]?.string ?? ""
        let caption = [current.description, current.instagram?.caption].compactMap { $0 }.first(where: { !$0.isEmpty })
        let facts = shelfFacts
        let watch = d?["watch"]?.array ?? []
        VStack(alignment: .leading, spacing: 18) {
            if !summary.isEmpty { aiSummary(summary) }
            else if let caption { Text(caption).font(reading).foregroundStyle(t.ink).lineSpacing(4) }
            if !watch.isEmpty { watchCard(watch) }
            if !facts.isEmpty {
                card("About it") {
                    ForEach(facts, id: \.0) { label, value in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text(label).font(.subheadline).foregroundStyle(t.inkMuted).frame(minWidth: 96, alignment: .leading)
                            Text(value).font(reading).foregroundStyle(t.ink)
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 8)
                        .overlay(alignment: .bottom) { if label != facts.last?.0 { rule } }   // the card's edge closes the last
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }

    private var shelfFacts: [(String, String)] {
        func s(_ k: String) -> String { d?[k]?.string ?? "" }
        func n(_ k: String) -> Int? { d?[k]?.number.map { Int($0) } }
        let genres = d?["genres"]?.array?.compactMap(\.string).joined(separator: ", ") ?? ""
        // What the line under the title already says ("Henry David Thoreau · 1854") isn't repeated here.
        let said = Set((current.fact ?? "").components(separatedBy: " · "))
        var out: [(String, String)] = []
        if current.kind == "book" {
            if !s("author").isEmpty { out.append(("By", s("author"))) }
            if let y = n("year") { out.append(("Published", String(y))) }
            if let p = n("pages") { out.append(("Pages", String(p))) }
            if !genres.isEmpty { out.append(("Genre", genres)) }
            return out.filter { !said.contains($0.1) }
        }
        let series = s("format") == "series"
        if let y = n("year") { out.append((series ? "Aired" : "Year", series && n("endYear") != nil && n("endYear") != y ? "\(y)–\(n("endYear")!)" : String(y))) }
        if !s("director").isEmpty { out.append((series ? "Created by" : "Directed by", s("director"))) }
        if let cast = d?["cast"]?.array?.compactMap(\.string), !cast.isEmpty { out.append(("Starring", cast.joined(separator: ", "))) }
        if series, let seasons = n("seasons") {
            let eps = n("episodes").map { " · \($0) episode\($0 == 1 ? "" : "s")" } ?? ""
            out.append(("Seasons", "\(seasons)\(eps)"))
        }
        if !series, let m = n("runtimeMinutes") { out.append(("Runtime", m >= 60 ? "\(m / 60) h \(m % 60) min" : "\(m) min")) }
        if !genres.isEmpty { out.append(("Genre", genres)) }
        return out.filter { !said.contains($0.1) }
    }

    /// Where to watch: each service opens its page for the title when the search found one.
    private func watchCard(_ watch: [JSONValue]) -> some View {
        let code = d?["watchRegion"]?.string ?? ""
        let region = code.isEmpty ? "" : Locale.current.localizedString(forRegionCode: code) ?? code
        let checked = (d?["watchCheckedOn"]?.string).flatMap { day -> String? in
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
            return f.date(from: day)?.formatted(.dateTime.month(.abbreviated).day().year())
        }
        let how = ["subscription": "Subscription", "free": "Free", "rent": "Rent", "buy": "Buy"]
        return card("Where to watch") {
            ForEach(Array(watch.enumerated()), id: \.offset) { _, w in
                let service = w["service"]?.string ?? ""
                let kind = how[w["how"]?.string ?? ""] ?? ""
                let link = (w["url"]?.string).flatMap(URL.init(string:))
                Button {
                    if let link { openURL(link) }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(service).font(KSFont.name(.body)).foregroundStyle(t.ink)
                        if !kind.isEmpty { Text(kind).font(.subheadline).foregroundStyle(t.inkMuted) }
                        Spacer(minLength: 0)
                        if link != nil { Image(systemName: "arrow.up.right").font(.subheadline.weight(.semibold)).foregroundStyle(KindStyle("media").color).accessibilityHidden(true) }
                    }
                    .frame(minHeight: 44)
                    .overlay(alignment: .bottom) { rule }
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle())
                .disabled(link == nil)
                .accessibilityLabel([service, kind].filter { !$0.isEmpty }.joined(separator: ", "))
                .accessibilityHint(link == nil ? "" : "Opens \(service)")
            }
            Text(["Found by AI", region.isEmpty ? nil : code == "US" || code == "GB" ? "in the \(region)" : "in \(region)", checked.map { "on \($0)" }].compactMap { $0 }.joined(separator: " ") + ". Run AI again to check.")
                .font(.footnote).foregroundStyle(t.inkMuted).padding(.top, 8)
        }
    }

    private func isDrafted(_ field: String) -> Bool { detail?.drafted?.contains(field) ?? false }

    private var placePanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            let address = [d?["address"]?.string, d?["locality"]?.string, d?["region"]?.string].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
            if !address.isEmpty { ruled("mappin", address) }
            if let hours = d?["hours"]?.array?.compactMap(\.string), !hours.isEmpty { ruled("clock", hours.joined(separator: "\n")) }
            if let phone = d?["phone"]?.string, !phone.isEmpty { ruled("phone", phone) }
            let what = [d?["cuisine"]?.string, d?["category"]?.string, d?["priceRange"]?.string].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
            if !what.isEmpty { ruled("fork.knife", what) }
        }
    }

    private var recipePanel: some View {
        VStack(alignment: .leading, spacing: 18) {
            let ingredients = d?["ingredients"]?.array?.compactMap(\.string) ?? []
            if !ingredients.isEmpty {
                card("Ingredients", drafted: isDrafted("ingredients")) {
                    ForEach(Array(ingredients.enumerated()), id: \.offset) { i, line in
                        let on = checked.contains(i)
                        Button {
                            Haptic.checked()
                            if on { checked.remove(i) } else { checked.insert(i) }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                    .font(.title3).foregroundStyle(on ? KindStyle("recipe").color : t.inkMuted)
                                Text(line).font(reading).foregroundStyle(on ? t.inkMuted : t.ink)
                                    .strikethrough(on, color: t.inkMuted)
                                Spacer(minLength: 0)
                            }
                            .frame(minHeight: 44)
                            .overlay(alignment: .bottom) { rule }
                        }
                        .buttonStyle(PressStyle())
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
            }
            if !steps.isEmpty {
                card("Method", drafted: isDrafted("steps")) {
                    ForEach(Array(steps.enumerated()), id: \.offset) { i, step in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text("\(i + 1)").font(KSFont.name(.headline)).foregroundStyle(t.stamp)
                            Text(step).font(reading).foregroundStyle(t.ink).lineSpacing(3)
                        }
                        .padding(.vertical, 6)
                    }
                }
            }
            if ingredients.isEmpty && steps.isEmpty {
                Text("This page didn't include a written recipe.").font(KSFont.note).foregroundStyle(t.inkMuted)
            }
        }
    }

    private var workoutPanel: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let goal { GoalCard(goal: goal) { removeGoal(goal) } }
            let exercises = detail?.exercises ?? []
            if !exercises.isEmpty {
                card("Exercises", drafted: isDrafted("exercises")) {
                    ForEach(Array(exercises.enumerated()), id: \.offset) { _, line in
                        Text(line).font(reading).foregroundStyle(t.ink)
                            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                            .overlay(alignment: .bottom) { rule }
                    }
                }
            } else if detail != nil {
                Text("No exercises were found in this post.").font(KSFont.note).foregroundStyle(t.inkMuted)
            }
        }
    }

    /// One tap checks in for today; another takes today's check-in back off the goal.
    private func toggleCheckIn(today: [String]) {
        if today.isEmpty {
            Task { await checkIn() }
            model.celebrate("Done today!")
        } else {
            Task {
                guard let lib = model.library else { return }
                for id in today { try? await lib.undoCheckIn(id) }
                await reload()
            }
        }
    }

    /// Takes the goal off the workout (made by accident, say), with Undo to bring it back.
    private func removeGoal(_ goal: GoalView) {
        Task {
            guard let lib = model.library else { return }
            let id = goal.goal.id
            try? await lib.removeGoal(id)
            await reload()
            model.show("Goal removed") {
                try? await lib.restoreGoal(id)
                await reload()
            }
        }
    }

    private func checkIn() async {
        guard let goal, let lib = model.library, let id = try? await lib.checkIn(goalId: goal.goal.id) else { return }
        await reload()
        model.show("Checked in for today") {
            try? await lib.undoCheckIn(id)
            await reload()
        }
    }

    private func card<C: View>(_ title: String, drafted: Bool = false, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title).font(KSFont.name(.title3)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                // What your AI provider wrote because the post doesn't say it.
                if drafted {
                    Text("AI draft").font(.caption.weight(.semibold)).foregroundStyle(t.ink)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(Capsule().fill(t.stamp.opacity(0.18)))
                        .accessibilityLabel("Drafted by AI: check it before you use it")
                }
            }
            .padding(.bottom, 8)
            content()
        }
        .padding(16)
        .ksSurface()
    }

    /// A row's hairline.
    private var rule: some View {
        Rectangle().fill(.clear).frame(height: 1)
            .overlay { Line().stroke(t.rule, style: StrokeStyle(lineWidth: 1)) }
    }

    private func ruled(_ symbol: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: symbol).foregroundStyle(KindStyle("place").color).frame(width: 22).accessibilityHidden(true)
            Text(text).font(reading).foregroundStyle(t.ink)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { rule }
    }

    @ViewBuilder private var source: some View {
        if let host = current.host, !host.isEmpty {
            let ig = current.instagram
            let by = [ig?.creator.flatMap { $0.isEmpty ? nil : "@\($0)" }, ig?.postedAt.flatMap { $0.isEmpty ? nil : $0 }].compactMap { $0 }
            Text((["Saved from \(host)"] + by).joined(separator: " · ")).font(.footnote).foregroundStyle(t.inkMuted)
        }
    }

    // MARK: actions

    /// The save's mark (Been, Cooked, Purchased, Done today) and Share, as pills under the title.
    @ViewBuilder private var marks: some View {
        let stamp = stampButton
        if stamp != nil || current.url != nil {
            HStack(spacing: 10) {
                stamp
                if current.url != nil { ShareStamp { SaveSharing.present(current) } }
            }
            .dynamicTypeSize(...DynamicTypeSize.large)
            .accessibilityShowsLargeContentViewer()
        }
    }

    private var stampButton: StampButton? {
        switch current.kind {
        case "place": StampButton("Been", done: isDone) { toggleDone("Cool!") }
        case "recipe": StampButton("Cooked", done: isDone) { toggleDone("Cooked!") }
        case "workout":
            if let goal, goal.progress.status == "active" {
                StampButton("Done today", done: !(goal.today ?? []).isEmpty, symbol: "calendar.badge.checkmark") { toggleCheckIn(today: goal.today ?? []) }
            } else { nil }
        default:
            canBuy ? StampButton("Purchased", done: isPurchased, symbol: "bag") { togglePurchased() } : nil
        }
    }

    /// The one primary action, floating on glass at the bottom edge; the page scrolls under it.
    @ViewBuilder private var dock: some View {
        if let primary = primaryAction {
            primary
                // The action row keeps its usual size at every text size, so it never crowds the page;
                // with big text, a long press shows the label large (the Large Content Viewer).
                .dynamicTypeSize(...DynamicTypeSize.large)
                .accessibilityShowsLargeContentViewer()
                .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 8)
                .frame(maxWidth: .infinity)
        }
    }

    private var primaryAction: PrimarySlab? {
        let url = current.url.flatMap(URL.init(string:))
        switch current.kind {
        case "place":
            if let mapsLink {
                return PrimarySlab("Directions", symbol: "arrow.triangle.turn.up.right.diamond.fill", kind: "place") { openURL(mapsLink) }
            }
            return url.map { u in PrimarySlab("Open", symbol: "safari", kind: "place") { openURL(u) } }
        case "recipe":
            if !steps.isEmpty { return PrimarySlab("Start cooking", symbol: "flame.fill", kind: "recipe") { cooking = true } }
            return url.map { u in PrimarySlab("Open recipe", symbol: "safari", kind: "recipe") { openURL(u) } }
        case "workout":
            if let goal, goal.progress.status == "active" {
                return url.map { u in PrimarySlab("Open workout", symbol: "safari", kind: "workout") { openURL(u) } }
            }
            return PrimarySlab("Make it a goal", symbol: "target", kind: "workout") { goalSheet = true }
        default:
            // A product your AI provider found the shop page for: that's where the dock goes; the picture
            // still opens the post.
            if current.kind == "product", let shop = d?["shopUrl"]?.string.flatMap(URL.init(string:)), shop.scheme?.hasPrefix("http") == true {
                let name = d?["shopName"]?.string ?? ""
                return PrimarySlab(name.isEmpty ? "Visit shop" : "Visit \(name)", symbol: "bag", kind: current.kind) { openURL(shop) }
            }
            return url.map { u in PrimarySlab(openTitle, symbol: "safari", kind: current.kind) { openURL(u) } }
        }
    }

    /// One tap stamps it (and says so in the middle of the screen); another takes the stamp off.
    private func toggleDone(_ cheer: String) {
        let on = !isDone
        Task { await model.setDone(current, on) }
        if on { model.celebrate(cheer) }
    }

    private func togglePurchased() {
        let on = !isPurchased
        Task {
            try? await model.library?.update(current.id, ["purchased": on])
            model.refresh()
        }
        if on { model.celebrate("Purchased!") }
    }

    private var openTitle: String {
        switch current.kind {
        case "video": "Watch"; case "article": "Read"; case "product": "Visit shop"; default: "Open"
        }
    }
}

/// Edit a save's title and note by hand. Edited fields are yours: AI and Lookups leave them alone.
struct EditSaveSheet: View {
    let save: Save
    @Environment(LibraryModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var note = ""
    var body: some View {
        NavigationStack {
            Form {
                Section("Title") { TextField("Title", text: $title, axis: .vertical) }
                Section("Note") { TextField("A note for yourself", text: $note, axis: .vertical).lineLimit(3...8) }
            }
            .navigationTitle("Edit").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            try? await model.library?.update(save.id, ["title": title, "note": note])
                            model.refresh()
                            Haptic.settled()
                            dismiss()
                        }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear { title = save.title; note = save.note ?? "" }
        }
        .presentationDetents([.medium, .large])
    }
}
