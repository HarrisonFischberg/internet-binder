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
    @Environment(\.dismiss) private var dismiss
    @State private var detail: SaveDetail?
    @State private var checked: Set<Int> = []
    @State private var cooking = false
    @State private var goalSheet = false
    @State private var editing = false
    @State private var destinations: [Destination] = []

    /// The latest copy (a stamp or an edit updates it in place).
    private var current: Save { model.saves.first { $0.id == save.id } ?? save }
    private var d: JSONValue? { current.details }
    private var isDone: Bool { current.status == "done" }
    private var isInstagram: Bool { (current.host ?? "").hasSuffix("instagram.com") }
    /// The recipe's steps, without wordless lines (older saves kept Instagram's "." spacers).
    private var steps: [String] { (d?["steps"]?.array?.compactMap(\.string) ?? []).filter { $0.contains(where: { $0.isLetter || $0.isNumber }) } }

    var body: some View {
        ZStack(alignment: .bottom) {
            TableBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    hero
                    titleBlock
                    if current.needsCollection && current.purchased != true { FilingPanel(save: current) }
                    panel
                    if let note = current.note, !note.isEmpty {
                        Text("“\(note)”").font(KSFont.note).foregroundStyle(t.inkMuted)
                    }
                    source
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 140)
            }
            actions
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Edit", systemImage: "pencil") { editing = true }
                    Menu("Move to…", systemImage: "folder") {
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
                    if current.kind == "product" {
                        Button(current.purchased == true ? "Not purchased" : "Mark purchased", systemImage: "bag.badge.checkmark") {
                            Task {
                                try? await model.library?.update(current.id, ["purchased": !(current.purchased ?? false)])
                                Haptic.stamped()
                                model.refresh()
                            }
                        }
                    }
                    if let url = current.url.flatMap(URL.init(string:)) { ShareLink(item: url) }
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
            .padding(8).background(t.paper).resting()
            .rotationEffect(.degrees(-0.6))
            .padding(.top, 8)
        } else if current.hasImage {
            // The picture opens where it came from: an Instagram reel's thumbnail (with its play
            // button) plays the reel.
            Button {
                if let url = current.url.flatMap(URL.init(string:)) { openURL(url) }
            } label: {
                SaveImage(current, symbolSize: 48)
                    .frame(height: 300).frame(maxWidth: .infinity).clipped()
                    .padding(current.kind == "recipe" ? 0 : 8)
                    .background(t.paper).resting()
            }
            .buttonStyle(PressStyle())
            .disabled(current.url == nil)
            .accessibilityLabel(isInstagram ? "Open the post on Instagram" : "Open \(current.host ?? "the page")")
            .padding(.top, 8)
        } else {
            SaveObject(current).frame(maxWidth: 260).frame(maxWidth: .infinity).padding(.top, 16)
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            KindLabel(kind: current.kind)
            Text(current.title).font(KSFont.display()).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
            if let fact = current.fact, !fact.isEmpty { Text(fact).font(.subheadline).foregroundStyle(t.inkMuted) }
        }
    }

    // MARK: kind panels

    @ViewBuilder private var panel: some View {
        switch current.kind {
        case "place": placePanel
        case "recipe": recipePanel
        case "workout": workoutPanel
        default:
            if let text = [current.description, current.instagram?.caption].compactMap({ $0 }).first(where: { !$0.isEmpty }) {
                Text(text).font(.system(.body, design: .serif)).foregroundStyle(t.ink).lineSpacing(4)
            }
        }
    }

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
                card("Ingredients") {
                    ForEach(Array(ingredients.enumerated()), id: \.offset) { i, line in
                        let on = checked.contains(i)
                        Button {
                            Haptic.checked()
                            if on { checked.remove(i) } else { checked.insert(i) }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                    .font(.title3).foregroundStyle(on ? KindStyle("recipe").color : t.inkMuted)
                                Text(line).font(.system(.body, design: .serif)).foregroundStyle(on ? t.inkMuted : t.ink)
                                    .strikethrough(on, color: t.inkMuted)
                                Spacer(minLength: 0)
                            }
                            .frame(minHeight: 44)
                            .overlay(alignment: .bottom) { Rectangle().fill(t.accent.opacity(0.18)).frame(height: 0.75) }
                        }
                        .buttonStyle(PressStyle())
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
            }
            if !steps.isEmpty {
                card("Method") {
                    ForEach(Array(steps.enumerated()), id: \.offset) { i, step in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            Text("\(i + 1)").font(.system(.headline, design: .serif)).foregroundStyle(t.stamp)
                            Text(step).font(.system(.body, design: .serif)).foregroundStyle(t.ink).lineSpacing(3)
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
            if let goal { GoalCard(goal: goal) }
            let exercises = detail?.exercises ?? []
            if !exercises.isEmpty {
                card("Exercises") {
                    ForEach(Array(exercises.enumerated()), id: \.offset) { _, line in
                        Text(line).font(.system(.body, design: .serif)).foregroundStyle(t.ink)
                            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
                            .overlay(alignment: .bottom) { Rectangle().fill(t.accent.opacity(0.18)).frame(height: 0.75) }
                    }
                }
            } else if detail != nil {
                Text("No exercises were found in this post.").font(KSFont.note).foregroundStyle(t.inkMuted)
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

    private func card<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(KSFont.name(.title3)).foregroundStyle(t.ink).padding(.bottom, 8).accessibilityAddTraits(.isHeader)
            content()
        }
        .padding(16)
        .background(t.paper)
        .overlay(alignment: .top) { Rectangle().fill(t.stamp.opacity(0.6)).frame(height: 1.5) }
        .resting()
    }

    private func ruled(_ symbol: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: symbol).foregroundStyle(KindStyle("place").color).frame(width: 22).accessibilityHidden(true)
            Text(text).font(.system(.body, design: .serif)).foregroundStyle(t.ink)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(t.accent.opacity(0.2)).frame(height: 0.75) }
    }

    @ViewBuilder private var source: some View {
        if let host = current.host, !host.isEmpty {
            let ig = current.instagram
            let by = [ig?.creator.flatMap { $0.isEmpty ? nil : "@\($0)" }, ig?.postedAt.flatMap { $0.isEmpty ? nil : $0 }].compactMap { $0 }
            Text((["Saved from \(host)"] + by).joined(separator: " · ")).font(.footnote).foregroundStyle(t.inkMuted)
        }
    }

    // MARK: the primary action

    private var actions: some View {
        HStack(spacing: 12) {
            switch current.kind {
            case "place":
                HoldToStamp("Been", done: isDone) { Task { await model.setDone(current, !isDone) } }
                PrimarySlab("Directions", symbol: "arrow.triangle.turn.up.right.diamond.fill") {
                    if let mapsLink { openURL(mapsLink) }
                }
                .disabled(mapsLink == nil)
            case "recipe":
                HoldToStamp("Cooked", done: isDone) { Task { await model.setDone(current, !isDone) } }
                if !steps.isEmpty {
                    PrimarySlab("Start cooking", symbol: "flame.fill") { cooking = true }
                } else if let url = current.url.flatMap(URL.init(string:)) {
                    PrimarySlab("Open recipe", symbol: "safari") { openURL(url) }
                }
            case "workout":
                if let goal, goal.progress.status == "active" {
                    HoldToStamp("Done today", done: false) { Task { await checkIn() } }
                    if let url = current.url.flatMap(URL.init(string:)) {
                        PrimarySlab("Open workout", symbol: "safari") { openURL(url) }
                    }
                } else {
                    PrimarySlab("Make it a goal", symbol: "target") { goalSheet = true }
                }
            default:
                if let url = current.url.flatMap(URL.init(string:)) {
                    PrimarySlab(openTitle, symbol: "safari") { openURL(url) }
                }
            }
        }
        .padding(.horizontal, 16).padding(.bottom, 6)
        .background(alignment: .bottom) { BottomScrim() }
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
