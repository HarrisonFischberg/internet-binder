import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// One Lifestyle view (Recipes, Workouts, Films & shows…). Films, shows and books are lists to work
/// through: what's still to watch or read comes first, then what you've done (Chrome's rule).
struct KindScreen: View {
    let kind: String
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    /// Places only: the Map button next to the title swaps the cards for a map (kept on this iPhone).
    @AppStorage("placesShowMap") private var showMap = false
    /// The Map button grows with the text size, so its glyph stays inside the circle.
    @ScaledMetric(relativeTo: .title3) private var mapButton: CGFloat = 44

    private var saves: [Save] { model.saves.filter { $0.kind == kind } }
    private var onMap: Bool { kind == "place" && showMap && !saves.isEmpty }
    private var todo: [Save] { saves.filter { $0.status != "done" } }
    private var done: [Save] { saves.filter { $0.status == "done" } }

    var body: some View {
        let k = KindStyle(kind)
        ZStack {
            TableBackground()
            if onMap {
                VStack(spacing: 0) {
                    header(k).padding(.horizontal, 18).padding(.bottom, 12)
                    PlacesMap(places: saves)
                        .overlay(alignment: .top) { Rectangle().fill(t.line).frame(height: 1) }
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        header(k)
                        if saves.isEmpty {
                            EmptyNote(symbol: k.symbol, text: "No \(k.plural.lowercased()) yet. Share one to Keepsake and it lands here.")
                        } else {
                            SaveGrid(saves: todo, zoom: zoom)
                            if !done.isEmpty {
                                Text(k.doneVerb).font(KSFont.name(.title2)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                                SaveGrid(saves: done, zoom: zoom)
                            }
                        }
                    }
                    .padding(.horizontal, 18).padding(.bottom, 40)
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.aiReady && !saves.isEmpty {
                ToolbarItem(placement: .primaryAction) { FixWithAIButton(saves: saves, what: "all \(saves.count) \(k.plural.lowercased())") }
            }
        }
    }

    /// The title, and for Places a Map button beside it that switches between the cards and the map.
    private func header(_ k: KindStyle) -> some View {
        HStack(alignment: .center, spacing: 12) {
            ScreenHeader(title: k.plural, subtitle: saves.count == 1 ? "1 save" : "\(saves.count) saves")
            if kind == "place" && !saves.isEmpty {
                Button {
                    Haptic.detent()
                    withAnimation(.easeOut(duration: 0.2)) { showMap.toggle() }
                } label: {
                    // Always the map glyph; filled in while the map is showing (Chrome's pressed look).
                    Image(systemName: "map")
                        .font(.title3.weight(.semibold)).foregroundStyle(showMap ? t.onAccent : t.ink)
                        .frame(width: mapButton, height: mapButton)
                        .ksSurface(showMap ? t.accent : nil, radius: mapButton / 2, scale: 0.5)
                }
                .buttonStyle(PressStyle())
                .padding(.top, 8)
                .accessibilityLabel("Map")
                .accessibilityAddTraits(showMap ? .isSelected : [])
                .accessibilityIdentifier("placesMapToggle")
            }
        }
    }
}

/// Review: saves Keepsake wasn't sure where to put. Each shows why, and three places it most likely
/// goes (Chrome's topSuggestions); one tap files it and teaches the categorizer.
struct ReviewScreen: View {
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var suggestions: [String: ReviewSuggestions] = [:]
    @State private var destinations: [Destination] = []
    private var saves: [Save] { model.saves.filter { $0.needsCollection && $0.purchased != true } }

    var body: some View {
        ZStack {
            TableBackground()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    ScreenHeader(title: "Review", subtitle: "Keepsake wasn't sure where these go")
                    if model.aiReady && !saves.isEmpty {
                        let asking = model.aiRun != nil
                        Button {
                            Task { await model.fixWithAI(saves) }
                        } label: {
                            HStack(spacing: 8) {
                                if asking { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles") }
                                Text(asking ? "Asking your AI…" : "Fix all \(saves.count) with AI")
                            }
                            .font(.subheadline.weight(.semibold)).foregroundStyle(t.onAccent)
                            .padding(.horizontal, 16).frame(minHeight: 44)
                            .background(t.accent, in: Capsule())
                        }
                        .disabled(asking)
                        .accessibilityHint("Sends each save's title and caption to your AI provider, which files the ones it's sure about.")
                    }
                    if saves.isEmpty {
                        EmptyNote(symbol: "checkmark.circle", text: "Nothing waiting. Everything has a home.")
                    }
                    ForEach(saves) { save in
                        row(save).transition(reduce ? .opacity : .move(edge: .trailing).combined(with: .opacity))
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, 40)
                .animation(KSMotion.or(KSMotion.settle, reduce: reduce), value: saves.map(\.id))
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .task(id: saves.map(\.id)) {
            guard let lib = model.library else { return }
            destinations = (try? await lib.destinations()) ?? []
            for s in saves where suggestions[s.id] == nil { suggestions[s.id] = try? await lib.suggestions(for: s.id) }
        }
    }

    private func row(_ save: Save) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            NavigationLink(value: save) {
                HStack(spacing: 12) {
                    SaveImage(save, symbolSize: 18).frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 4))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(save.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(2)
                        if let why = suggestions[save.id]?.reason, !why.isEmpty {
                            Text(why).font(.footnote).foregroundStyle(t.inkMuted).lineLimit(2)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }
            .buttonStyle(PressStyle())
            // The best guess filled (one tap files it), the others outlined, then any other home.
            Flow(spacing: 8) {
                ForEach(Array((suggestions[save.id]?.picks ?? []).prefix(3).enumerated()), id: \.element.id) { i, pick in
                    Chip(pick.label, symbol: pick.isNew ? "plus" : "bag", selected: false, prominent: i == 0) { file(save, pick.value, pick.label) }
                        .accessibilityLabel("File in \(pick.label)")
                }
                Menu {
                    ForEach(destinations) { d in Button(d.label) { file(save, d.value, d.label) } }
                } label: {
                    Text("Another collection…").font(.subheadline.weight(.semibold)).foregroundStyle(t.inkMuted)
                        .underline(t.style != .pantry).padding(.horizontal, 6).frame(minHeight: 44)
                }
                .accessibilityLabel("More")
            }
        }
        .padding(14).ksSurface()
    }

    private func file(_ save: Save, _ target: String, _ label: String) { model.file(save, into: target, label: label) }
}

extension LibraryModel {
    /// Files a save from Review (Chrome's Review filing: learns strongly), with Undo back to Review.
    func file(_ save: Save, into target: String, label: String) {
        guard let lib = library else { return }
        Task {
            _ = try? await lib.file(save.id, into: target)
            Haptic.dropped()
            refresh()
            show("Filed in \(label)") {
                try? await lib.update(save.id, ["collectionId": NSNull(), "needsReview": true, "kind": save.kind, "details": [:]])
                self.refresh()
            }
        }
    }

    /// Fix with AI for any saves (one, a collection, a Lifestyle view, everything): your provider reads each
    /// again, a product from its picture and its shop page, and a save in Review is filed when it's sure.
    /// A few at a time, so the bar at the bottom can count and Stop works. One Undo takes back the whole run.
    func fixWithAI(_ saves: [Save]) async {
        guard let lib = library, !saves.isEmpty, aiRun == nil else { return }
        aiRun = AIRun(done: 0, total: saves.count)
        defer { aiRun = nil }
        var changed = 0, products = 0
        var filed: [AIFixReport.Filed] = []
        var logIds: [String] = []
        var error = ""
        let ids = saves.map(\.id)
        for start in stride(from: 0, to: ids.count, by: 3) {
            if aiRun?.stopping == true { break }
            let chunk = Array(ids[start..<min(start + 3, ids.count)])
            do {
                let r = try await lib.fixWithAI(chunk)
                changed += r.changed
                products += r.products ?? 0
                filed += r.filed
                logIds += r.logIds ?? []
                if !r.error.isEmpty { error = r.error }
            } catch let e {
                error = e.localizedDescription
            }
            aiRun?.done = min(ids.count, start + chunk.count)
            refresh()
            // A bad key or no credit: every other save would fail the same way.
            if error.range(of: #"\((401|403|429)\)|API key|base URL"#, options: .regularExpression) != nil { break }
        }
        refresh()
        var undo: (@MainActor () async -> Void)?
        if !logIds.isEmpty {
            let all = logIds
            undo = { @MainActor in
                _ = try? await lib.undoAI(all)
                self.refresh()
            }
        }
        if changed == 0 && !error.isEmpty { show("AI couldn't check: \(error)"); Haptic.refused(); return }
        if saves.count == 1 {
            if let f = filed.first { Haptic.dropped(); show("AI filed it in \(f.collection)", undo: undo) }
            else if changed > 0 { Haptic.settled(); show("AI updated it", undo: undo) }
            else if saves[0].needsCollection { show("AI wasn't sure either, so it stays in Review.") }
            else { show("AI found nothing to change") }
        } else {
            Haptic.settled()
            show(changed == 0 ? "AI found nothing to change" : "AI updated \(changed) of \(saves.count)", undo: undo)
        }
    }
}

extension LibraryModel {
    /// Run AI on imported saves: imports (a Chrome export AirDropped here) don't go to your provider by
    /// themselves; this reads them when you ask, one at a time. When your provider says to slow down (429,
    /// overloaded, a timeout) it waits, doubling each time, and tries again; a bad key or no credit stops it.
    /// Pause stops after the save it's on; what's left stays waiting, so running it again resumes.
    func runAIOnImported(_ saves: [Save]) async {
        guard let lib = library, !saves.isEmpty, aiRun == nil else { return }
        aiRun = AIRun(done: 0, total: saves.count, imported: true)
        defer { aiRun = nil }
        var changed = 0, failed = 0, busy = 0, readCount = 0
        var error = ""
        for save in saves {
            if aiRun?.stopping == true { break }
            var tries = 0
            var read = false
            while !read {
                do {
                    if try await lib.readImported(save.id) { changed += 1 }
                    readCount += 1
                    busy = 0
                    read = true
                } catch let e {
                    error = e.localizedDescription
                    // A bad key or no credit: every other save would fail the same way.
                    if error.range(of: #"\((401|403)\)|API key|base URL|credit balance|billing"#, options: .regularExpression) != nil { aiRun?.stopping = true; break }
                    let slow = error.range(of: #"\((408|409|429|5\d\d)\)|overloaded|timed out|network|offline"#, options: [.regularExpression, .caseInsensitive]) != nil
                    tries += 1
                    if !slow || tries >= 4 { failed += 1; read = true; break }
                    busy += 1
                    if busy >= 8 { aiRun?.stopping = true; error = "Your AI provider is busy right now. Try again later."; break }
                    let wait = min(120.0, 4.0 * pow(2.0, Double(busy - 1))) + Double.random(in: 0...1)
                    aiRun?.waitingUntil = Date().addingTimeInterval(wait)
                    try? await Task.sleep(for: .seconds(wait))
                    aiRun?.waitingUntil = nil
                    if aiRun?.stopping == true { break }
                }
            }
            if !read { break }
            aiRun?.done += 1
            if (aiRun?.done ?? 0) % 5 == 0 { refresh() }
        }
        refresh()
        let left = aiBacklog.count
        if readCount == 0 && !error.isEmpty { show("AI couldn't read them: \(error)"); Haptic.refused(); return }
        Haptic.settled()
        let leftText = left > 0 ? ". \(left) still waiting: run it again to carry on" : ""
        show("AI read \(readCount) \(readCount == 1 ? "save" : "saves")\(changed > 0 ? ", \(changed) updated" : "")\(failed > 0 ? ", \(failed) couldn't be read" : "")\(leftText)")
    }
}

/// "Run AI on N imported saves": on Home and in Settings while Optional AI is on and imports are waiting.
/// Asks first, with how many and about how long, since each one is a request to your provider.
struct RunAIOnImportedButton: View {
    var label: String? = nil
    @Environment(LibraryModel.self) private var model
    @State private var confirming = false

    var body: some View {
        let waiting = model.aiBacklog
        if model.aiReady && !waiting.isEmpty {
            Button(label ?? "Run AI on \(waiting.count) imported \(waiting.count == 1 ? "save" : "saves")", systemImage: "sparkles") { confirming = true }
                .disabled(model.aiRun != nil)
                .accessibilityHint("Your AI provider reads the saves you imported, which it hasn't seen yet.")
                .confirmationDialog("Run AI on \(waiting.count) imported \(waiting.count == 1 ? "save" : "saves")?", isPresented: $confirming, titleVisibility: .visible) {
                    if waiting.count > 100 { Button("Newest 100") { Task { await model.runAIOnImported(Array(waiting.prefix(100))) } } }
                    Button(waiting.count > 100 ? "All \(waiting.count)" : "Run AI") { Task { await model.runAIOnImported(waiting) } }
                } message: {
                    let minutes = max(1, Int((Double(waiting.count) * 7 / 60).rounded()))
                    Text("Your AI provider reads each one: what it is, then its details or collection. About \(minutes) \(minutes == 1 ? "minute" : "minutes") with the app open. Pause any time; the rest stay waiting. Every change can be undone.")
                }
        }
    }
}

/// "Fix with AI" for a set of saves, in a screen's toolbar: shows while Optional AI is on. More than one
/// save asks first, since each one is a request to your provider.
struct FixWithAIButton: View {
    let saves: [Save]
    let what: String
    @Environment(LibraryModel.self) private var model
    @State private var confirming = false

    var body: some View {
        if model.aiReady && !saves.isEmpty {
            Button("Fix with AI", systemImage: "sparkles") {
                if saves.count == 1 { Task { await model.fixWithAI(saves) } } else { confirming = true }
            }
            .disabled(model.aiRun != nil)
            .accessibilityHint("Your AI provider reads \(saves.count == 1 ? "this save" : "these saves") again and fills in what's missing.")
            .confirmationDialog("Fix \(saves.count) saves with AI?", isPresented: $confirming, titleVisibility: .visible) {
                Button("Fix \(what)") { Task { await model.fixWithAI(saves) } }
            } message: {
                Text("Your AI provider reads each one again: what it is from its picture, a product's shop page, and where it goes. Every change can be undone.")
            }
        }
    }
}

/// The bar at the bottom while Fix with AI works through saves: how far it got, and Stop.
struct AIRunBar: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        ZStack {
            if let run = model.aiRun {
                HStack(spacing: 12) {
                    ProgressView(value: Double(run.done), total: Double(max(run.total, 1)))
                        .progressViewStyle(.circular).controlSize(.small).tint(t.ink)
                    Text(run.stopping ? "Stopping…" : run.waitingUntil != nil ? "Your AI asked to slow down. Waiting…" : run.total == 1 ? "Asking your AI…"
                         : "\(run.imported ? "Reading" : "Fixing") \(min(run.done + 1, run.total)) of \(run.total) with AI")
                        .font(.subheadline.weight(.medium)).foregroundStyle(t.ink).monospacedDigit()
                    if run.total > 1 && !run.stopping {
                        Button(run.imported ? "Pause" : "Stop") { model.aiRun?.stopping = true }
                            .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                    }
                }
                .padding(.horizontal, 18).frame(minHeight: 48)
                .ksSurface(radius: 24)
                .transition(reduce ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                .accessibilityElement(children: .contain)
            }
        }
        .animation(KSMotion.or(KSMotion.sheet, reduce: reduce), value: model.aiRun == nil)
    }
}

/// Where a save in Review goes, on its own screen: Keepsake's best guesses, every Lifestyle view and
/// collection, and Fix with AI when Optional AI is on. One tap files it (with Undo).
struct FilingPanel: View {
    let save: Save
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @State private var suggestions: ReviewSuggestions?
    @State private var destinations: [Destination] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Where does it go?").font(KSFont.name(.title3)).foregroundStyle(t.ink).accessibilityAddTraits(.isHeader)
                if let why = suggestions?.reason, !why.isEmpty {
                    Text(why).font(.footnote).foregroundStyle(t.inkMuted)
                } else {
                    Text("It's waiting in Review. Pick a place and Keepsake learns from it.").font(.footnote).foregroundStyle(t.inkMuted)
                }
            }
            if model.aiReady {
                let asking = model.aiRun != nil
                Button {
                    Task { await model.fixWithAI([save]) }
                } label: {
                    HStack(spacing: 8) {
                        if asking { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles") }
                        Text(asking ? "Asking your AI…" : "Fix with AI")
                    }
                    .font(.subheadline.weight(.semibold)).foregroundStyle(t.onAccent)
                    .padding(.horizontal, 16).frame(minHeight: 44)
                    .background(t.accent, in: Capsule())
                }
                .disabled(asking)
                .accessibilityHint("Sends its title and caption to your AI provider, which picks a collection.")
            }
            if let picks = suggestions?.picks, !picks.isEmpty {
                group("Suggested") {
                    ForEach(picks) { p in
                        Chip(p.label, symbol: p.isNew ? "plus" : "sparkle", selected: false) { model.file(save, into: p.value, label: p.label) }
                            .accessibilityLabel("File in \(p.label)")
                    }
                }
            }
            let lifestyle = destinations.filter { $0.group == "lifestyle" }
            if !lifestyle.isEmpty {
                group("Lifestyle") {
                    ForEach(lifestyle) { d in
                        let k = KindStyle(d.kind ?? "")
                        Chip(d.label, symbol: k.symbol, tint: k.color, selected: false) { model.file(save, into: d.value, label: d.label) }
                            .accessibilityLabel("File in \(d.label)")
                    }
                }
            }
            let collections = destinations.filter { $0.group == "collection" }
            if !collections.isEmpty {
                group("Collections") {
                    ForEach(collections) { d in
                        Chip(d.label, symbol: "folder", selected: false) { model.file(save, into: d.value, label: d.label) }
                            .accessibilityLabel("File in \(d.label)")
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .ksSurface()
        .task(id: save.id) {
            guard let lib = model.library else { return }
            async let s = try? lib.suggestions(for: save.id)
            async let d = try? lib.destinations()
            (suggestions, destinations) = (await s, await d ?? [])
        }
    }

    private func group<C: View>(_ title: String, @ViewBuilder _ chips: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(.caption.weight(.semibold)).tracking(0.8).foregroundStyle(t.inkMuted)
            Flow(spacing: 8) { chips() }
        }
    }
}
