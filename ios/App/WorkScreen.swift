import SwiftUI
import UIKit
import BackgroundTasks
import KeepsakeKit
import KeepsakeUI

/// One line in the progress screen's "just did" list.
struct WorkLine: Equatable, Identifiable {
    let id = UUID()
    let saveId: String
    let text: String
    let symbol: String
    init(id saveId: String, text: String, symbol: String) { self.saveId = saveId; self.text = text; self.symbol = symbol }
}

extension LibraryModel.AIRun {
    mutating func note(_ line: WorkLine) {
        recent.insert(line, at: 0)
        if recent.count > 3 { recent.removeLast(recent.count - 3) }
    }
}

/// Saves a Fix with AI run didn't reach because iOS ended its time in the background (or the app was
/// closed): Home offers "Finish fixing" with them.
enum AIFixLeft {
    private static let key = "ks.aiFixLeft"
    static var ids: [String] {
        get { UserDefaults.standard.stringArray(forKey: key) ?? [] }
        set { if newValue.isEmpty { UserDefaults.standard.removeObject(forKey: key) } else { UserDefaults.standard.set(newValue, forKey: key) } }
    }
}

/// Keeps a long run going after you leave the app. A run you start asks iOS for a continued-processing
/// task: iOS shows its progress (Lock Screen, Dynamic Island) and lets you stop it there, and keeps the
/// app running while the run reports progress. iOS can still end it (low battery, heat, a Stop there):
/// then `onExpire` runs and the run stops where it is. When iOS won't start one, the app asks for the
/// usual few extra seconds instead. Closing the app from the app switcher ends any of them.
@MainActor
final class BackgroundWork {
    static let shared = BackgroundWork()

    private struct Job {
        var title: String
        var subtitle: String
        var done = 0
        var total: Int
        var task: BGContinuedProcessingTask?
        var grace: UIBackgroundTaskIdentifier = .invalid
        let onExpire: @MainActor () -> Void
    }
    private var jobs: [String: Job] = [:]
    private var registered: Set<String> = []

    private func identifier(_ job: String) -> String { (Bundle.main.bundleIdentifier ?? "com.harrisonfischberg.keepsake") + ".work." + job }

    func begin(_ job: String, title: String, subtitle: String, total: Int, onExpire: @escaping @MainActor () -> Void) {
        end(job, success: false)
        jobs[job] = Job(title: title, subtitle: subtitle, total: total, onExpire: onExpire)
        let id = identifier(job)
        // Continued-processing handlers are registered when the work starts, once per identifier.
        if !registered.contains(id) {
            registered.insert(id)
            _ = BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: .main) { [weak self] task in
                MainActor.assumeIsolated { self?.started(job, task) }
            }
        }
        let request = BGContinuedProcessingTaskRequest(identifier: id, title: title, subtitle: subtitle)
        request.strategy = .fail
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            jobs[job]?.grace = UIApplication.shared.beginBackgroundTask(withName: title) { [weak self] in
                DispatchQueue.main.async { self?.expired(job) }
            }
        }
    }

    private func started(_ job: String, _ task: BGTask) {
        guard let task = task as? BGContinuedProcessingTask, let j = jobs[job] else {
            // The run finished before iOS started its task.
            task.setTaskCompleted(success: true)
            return
        }
        jobs[job]?.task = task
        task.progress.totalUnitCount = Int64(j.total)
        task.progress.completedUnitCount = Int64(j.done)
        task.updateTitle(j.title, subtitle: j.subtitle)
        task.expirationHandler = { [weak self] in DispatchQueue.main.async { self?.expired(job) } }
    }

    func update(_ job: String, done: Int, total: Int, subtitle: String) {
        guard jobs[job] != nil else { return }
        jobs[job]?.done = done
        jobs[job]?.total = total
        jobs[job]?.subtitle = subtitle
        if let task = jobs[job]?.task {
            task.progress.totalUnitCount = Int64(total)
            task.progress.completedUnitCount = Int64(done)
            task.updateTitle(jobs[job]!.title, subtitle: subtitle)
        }
    }

    func end(_ job: String, success: Bool) {
        guard let j = jobs.removeValue(forKey: job) else { return }
        j.task?.setTaskCompleted(success: success)
        if j.grace != .invalid { UIApplication.shared.endBackgroundTask(j.grace) }
    }

    private func expired(_ job: String) {
        guard let j = jobs[job] else { return }
        j.onExpire()
        end(job, success: false)
    }
}

extension LibraryModel {
    /// The progress screen's last page for an AI run: All done, Stopped (you, or a bad key), or Paused (iOS).
    func endWork(_ run: AIRun, summary: String, rest: String) {
        let title = run.cutOff ? "Paused" : run.stopping ? "Stopped" : "All done"
        var text = summary
        if run.stopping || run.cutOff { text += " " + rest }
        if let shown = toast?.text, shown.hasPrefix("AI couldn't") || shown.contains("busy right now") { text = shown }
        workEnd = WorkEnd(title: title, text: text, lines: run.recent, undo: toast?.undo)
    }
}

// MARK: iCloud's first copy

extension LibraryModel {
    /// Turning sync on sends the whole library: counts it down for the progress screen, and keeps it
    /// going in the background. Whatever isn't sent when iOS stops it goes the next time the app opens.
    func beginSyncRun() {
        guard let library, syncRun == nil, let n = try? library.database.pendingCount(), n > 0 else { return }
        syncRun = SyncRun(total: n, left: n)
        workEnd = nil
        // A small library is in iCloud before the screen would finish opening.
        if n >= 20 { workShowing = true }
        BackgroundWork.shared.begin("sync", title: "Copying your library to iCloud", subtitle: "0 of \(n)", total: n) { [weak self] in
            self?.syncRun = nil
        }
        Task { await watchSyncRun() }
    }

    func endSyncRun() {
        syncRun = nil
        BackgroundWork.shared.end("sync", success: true)
    }

    private func watchSyncRun() async {
        while let run = syncRun {
            try? await Task.sleep(for: .seconds(1))
            guard syncRun != nil, let library else { return }
            let left = (try? library.database.pendingCount()) ?? run.left
            syncRun?.left = left
            syncRun?.total = max(run.total, left)
            let done = syncRun?.done ?? 0, total = syncRun?.total ?? run.total
            BackgroundWork.shared.update("sync", done: done, total: total, subtitle: "\(done) of \(total)")
            if left == 0 {
                endSyncRun()
                Haptic.settled()
                show("Your library is in iCloud")
                workEnd = WorkEnd(title: "All done", text: "Your library is in iCloud. Changes from now on go up by themselves.")
                return
            }
            switch syncStatus {
            case .failed(let message)?:
                endSyncRun()
                Haptic.refused()
                show("iCloud stopped: \(message)")
                workEnd = WorkEnd(title: "Stopped", text: "iCloud stopped: \(message). What's left goes up when it can.")
                return
            case .signedOut?:
                endSyncRun()
                show("Sign in to iCloud in the Settings app to sync")
                workEnd = WorkEnd(title: "Stopped", text: "Sign in to iCloud in the Settings app, and the rest goes up then.")
                return
            default:
                break
            }
        }
    }
}

// MARK: The screen

/// Presents the progress screen from the view it's attached to while `host` is the one in front.
struct WorkCover: ViewModifier {
    let host: LibraryModel.WorkHost
    @Environment(LibraryModel.self) private var model
    func body(content: Content) -> some View {
        content.fullScreenCover(isPresented: Binding(get: { model.workShowing && model.workHost == host }, set: { model.workShowing = $0 })) {
            // A page of its own size: the app window's frame stops short of the cover's bottom edge.
            WorkScreen().environment(\.ksTableFrame, nil)
        }
    }
}

/// The progress screen for a long run: Fix everything with AI, reading imported saves, or iCloud's first
/// copy of the library. What it's on, a bar, about how long is left, the last few things it did, and
/// "Work in background", which closes the screen and leaves the bar at the bottom (tap it to come back).
struct WorkScreen: View {
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @Environment(\.dynamicTypeSize) private var typeSize

    private enum Phase: Equatable { case ai, sync, finished }
    private var phase: Phase { model.aiRun != nil ? .ai : model.syncRun != nil ? .sync : .finished }

    var body: some View {
        ZStack {
            TableBackground().ignoresSafeArea()
            ScrollView {
                VStack(spacing: 28) {
                    // An ending with nothing listed under it sits lower, nearer the middle of the screen.
                    art.padding(.top, typeSize.isAccessibilitySize ? 12 : phase == .finished && (model.workEnd?.lines.isEmpty ?? true) ? 120 : 48)
                    heading
                    if phase != .finished {
                        VStack(spacing: 14) {
                            progress
                            Text(note).font(.footnote).foregroundStyle(t.inkMuted).multilineTextAlignment(.center)
                                .frame(maxWidth: .infinity)
                        }
                    }
                    if let run = model.aiRun, !run.recent.isEmpty { recent(run.recent, heading: "Just now") }
                    if phase == .finished, let lines = model.workEnd?.lines, !lines.isEmpty { recent(lines, heading: "Last ones") }
                }
                .padding(.horizontal, 24).padding(.bottom, 24)
                .frame(maxWidth: 560).frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        // A bar, so the list scrolling under the buttons softens into the page (the scroll edge effect).
        .safeAreaBar(edge: .bottom, spacing: 0) { actions }
        .scrollEdgeEffectStyle(.soft, for: .bottom)
        .animation(KSMotion.or(KSMotion.settle, reduce: reduce), value: phase)
        .onChange(of: phase) { _, now in
            if now == .finished { UIAccessibility.post(notification: .announcement, argument: "\(title). \(subtitle)") }
        }
    }

    // MARK: Parts

    private var title: String {
        switch phase {
        case .ai: model.aiRun?.imported == true ? "Reading your imports" : model.aiRun?.total == model.saves.count ? "Fixing your library" : "Fixing with AI"
        case .sync: "Copying to iCloud"
        case .finished: model.workEnd?.title ?? "All done"
        }
    }

    private var subtitle: String {
        switch phase {
        case .ai:
            guard let run = model.aiRun else { return "" }
            if run.stopping { return run.cutOff ? "iOS paused it. Open the app to carry on." : "Stopping after this one…" }
            if run.waitingUntil != nil { return "Your AI asked to slow down. Waiting a moment…" }
            let names = run.current.compactMap { id in model.saves.first { $0.id == id }?.title }
            return names.isEmpty ? "Your AI is reading…" : "Reading " + names.map { "“\($0)”" }.formatted(.list(type: .and))
        case .sync:
            return "Encrypted on this iPhone first, so Apple stores it but can't read it."
        case .finished:
            return model.workEnd?.text ?? "Everything it was doing is finished."
        }
    }

    private var heading: some View {
        VStack(spacing: 8) {
            Text(title).font(KSFont.display()).foregroundStyle(t.ink).multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            Text(subtitle).font(.body).foregroundStyle(t.inkMuted).multilineTextAlignment(.center)
                .lineLimit(typeSize.isAccessibilitySize ? nil : 3)
                .contentTransition(.opacity)
                .animation(KSMotion.quiet, value: subtitle)
                .accessibilityIdentifier("workSubtitle")
        }
        .frame(maxWidth: .infinity)
    }

    /// The saves being read as a deck flipping through, with sparkles; a spinning cloud for iCloud; how it ended when done.
    @ViewBuilder private var art: some View {
        switch phase {
        case .ai:
            // The deck: what it's reading now, then what it just read, so it has something to flip through.
            let ids = (model.aiRun?.current ?? []) + (model.aiRun?.recent.map(\.saveId) ?? [])
            let unique = ids.reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
            let saves = unique.compactMap { id in model.saves.first { $0.id == id } }
            CardFan(saves: saves).accessibilityHidden(true)
        case .sync:
            CloudSpin().accessibilityHidden(true)
        case .finished:
            Badge(symbol: model.workEnd?.title == "Paused" ? "pause" : model.workEnd?.title == "Stopped" ? "stop" : "checkmark")
                .accessibilityHidden(true)
        }
    }

    private var progress: some View {
        let (done, total, started): (Int, Int, Date) = if let run = model.aiRun { (run.done, run.total, run.startedAt) }
            else if let run = model.syncRun { (run.done, run.total, run.startedAt) } else { (0, 1, .now) }
        return VStack(spacing: 10) {
            WorkBar(fraction: Double(done) / Double(max(total, 1)))
            HStack(alignment: .firstTextBaseline) {
                Text("\(done) of \(total)").monospacedDigit()
                Spacer(minLength: 12)
                TimelineView(.periodic(from: .now, by: 5)) { _ in
                    Text(Self.timeLeft(done: done, total: total, since: started))
                }
            }
            .font(.subheadline.weight(.medium)).foregroundStyle(t.inkMuted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(done) of \(total) done. \(Self.timeLeft(done: done, total: total, since: started))")
        .accessibilityIdentifier("workProgress")
    }

    /// "About 12 min left", once there's enough to go on.
    static func timeLeft(done: Int, total: Int, since: Date) -> String {
        let elapsed = Date.now.timeIntervalSince(since)
        guard done >= 2, elapsed > 8, total > done else { return "" }
        let left = elapsed / Double(done) * Double(total - done)
        if left < 60 { return "Less than a minute left" }
        let minutes = Int((left / 60).rounded())
        if minutes < 90 { return "About \(minutes) min left" }
        let hours = (left / 3600 * 2).rounded() / 2
        return "About \(hours.formatted(.number.precision(.fractionLength(0...1)))) hr left"
    }

    private func recent(_ lines: [WorkLine], heading: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(heading).font(KSFont.label).foregroundStyle(t.inkMuted).padding(.bottom, 8)
            ForEach(Array(lines.enumerated()), id: \.element.id) { i, line in
                HStack(spacing: 10) {
                    Image(systemName: line.symbol).font(.footnote.weight(.bold)).foregroundStyle(t.accent).frame(width: 20)
                    Text(line.text).font(.subheadline).foregroundStyle(t.ink).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .frame(minHeight: 36)
                .opacity(max(0.65, 1 - Double(i) * 0.175))
                .transition(reduce ? .opacity : .move(edge: .top).combined(with: .opacity))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .ksSurface(radius: 18)
        .animation(KSMotion.or(KSMotion.settle, reduce: reduce), value: lines)
        .accessibilityElement(children: .combine)
    }

    private var actions: some View {
        VStack(spacing: 6) {
            switch phase {
            case .finished:
                if let undo = model.workEnd?.undo {
                    Button("Undo all") {
                        Haptic.undo()
                        model.toast = nil
                        model.workEnd = nil
                        model.workShowing = false
                        Task { await undo() }
                    }
                    .font(.headline).frame(maxWidth: .infinity, minHeight: 44)
                }
                PrimarySlab("Done", symbol: "checkmark") {
                    // The same ending was also the toast underneath: it's been read here.
                    model.toast = nil
                    model.workShowing = false
                }
                    .accessibilityIdentifier("workDone")
            case .ai, .sync:
                PrimarySlab("Work in background", symbol: "arrow.down.right.and.arrow.up.left") { model.workShowing = false }
                    .accessibilityIdentifier("workInBackground")
                    .accessibilityHint("Closes this screen. It keeps going, even if you leave the app.")
                if let run = model.aiRun, run.total > 1, !run.stopping {
                    Button(run.imported ? "Pause" : "Stop") { model.aiRun?.stopping = true }
                        .font(.headline).foregroundStyle(t.ink).frame(maxWidth: .infinity, minHeight: 44)
                        .accessibilityIdentifier("workStop")
                }
            }
        }
        .padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 8)
        .frame(maxWidth: 560).frame(maxWidth: .infinity)
    }

    private var note: String {
        switch phase {
        case .sync: "Keeps going if you leave the app. If iOS pauses it, the rest goes up next time you open Internet Binder."
        default: model.aiRun?.imported == true
            ? "Keeps going if you leave the app. If iOS pauses it, the rest stay waiting: run it again to carry on."
            : "Keeps going if you leave the app. If iOS pauses it, Home offers to finish the rest."
        }
    }
}

/// The progress bar: the theme's accent on a well, with a soft sheen moving along while it works.
private struct WorkBar: View {
    let fraction: Double
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    @State private var sweep = false

    var body: some View {
        GeometryReader { g in
            let w = g.size.width * min(max(fraction, 0), 1)
            ZStack(alignment: .leading) {
                Capsule().fill(t.well)
                Capsule().fill(t.accent).frame(width: w)
                    .overlay {
                        if !reduce {
                            LinearGradient(colors: [.clear, .white.opacity(0.35), .clear], startPoint: .leading, endPoint: .trailing)
                                .frame(width: 80)
                                .offset(x: sweep ? w : -80)
                                .frame(width: w, alignment: .leading)
                                .clipShape(Capsule())
                        }
                    }
                    .animation(KSMotion.or(KSMotion.settle, reduce: reduce), value: fraction)
            }
            .overlay { if t.outline > 0 { Capsule().strokeBorder(t.line, lineWidth: t.outline) } }
        }
        .frame(height: 14)
        .onAppear {
            guard !reduce else { return }
            withAnimation(.linear(duration: 1.6).repeatForever(autoreverses: false)) { sweep = true }
        }
    }
}

/// A deck of the saves being read, flipping through: every beat the top card turns over and flies off,
/// and the next one comes forward. Reduce Motion keeps the deck still.
private struct CardFan: View {
    let saves: [Save]
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce
    /// The deck, top card first (up to eight; past the third they wait unseen). A flip hands the top card
    /// to `flying`, drawn in front of everything while it turns away, and puts a fresh copy at the back.
    /// Saves that arrive go in right behind the top, so the top never jumps.
    @State private var deck: [Entry] = []
    @State private var flying: Entry?
    @State private var flight = 0.0
    @State private var next = 0
    private struct Entry: Identifiable { let id: Int; let save: Save }

    var body: some View {
        ZStack {
            if deck.isEmpty {
                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(t.well).frame(width: 128, height: 160)
            }
            ForEach(Array(deck.enumerated()).reversed(), id: \.element.id) { d, entry in
                card(entry.save)
                    .scaleEffect(1 - Double(min(d, 3)) * 0.07)
                    .rotationEffect(.degrees(d == 0 ? 0 : (entry.id % 2 == 0 ? 5 : -5) * Double(min(d, 3))))
                    .offset(y: -Double(min(d, 3)) * 16)
                    .opacity(d >= 3 ? 0 : 1)
                    .zIndex(Double(10 - d))
                    // The flying copy covers the top card as it leaves, so it can just go.
                    .transition(.asymmetric(insertion: .opacity, removal: .identity))
            }
            if let flying {
                card(flying.save)
                    .modifier(FlipAway(progress: flight))
                    .zIndex(20)
            }
            Image(systemName: "sparkles")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(t.onAccent)
                .frame(width: 60, height: 60)
                .background(t.accent, in: Circle())
                .overlay { Circle().strokeBorder(t.paper, lineWidth: 3) }
                .symbolEffect(.bounce, options: .repeating.speed(0.6), isActive: !reduce)
                .offset(x: 78, y: 78)
                .zIndex(30)
        }
        .frame(height: 210)
        .onChange(of: saves.map(\.id), initial: true) { _, _ in withAnimation(KSMotion.quiet) { take(saves) } }
        .task(id: reduce) {
            guard !reduce else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(1100))
                guard deck.count > 1 else { continue }
                flip()
            }
        }
    }

    private func flip() {
        let top = deck[0]
        var still = Transaction()
        still.disablesAnimations = true
        withTransaction(still) {
            flying = Entry(id: -1, save: top.save)
            flight = 0
        }
        withAnimation(.spring(response: 0.55, dampingFraction: 0.8)) {
            deck.removeFirst()
            deck.append(Entry(id: next, save: top.save))
            next += 1
        }
        withAnimation(.easeIn(duration: 0.45)) {
            flight = 1
        } completion: {
            flying = nil
        }
    }

    private func take(_ saves: [Save]) {
        let have = Set(deck.map(\.save.id))
        for save in saves.reversed() where !have.contains(save.id) {
            deck.insert(Entry(id: next, save: save), at: min(1, deck.count))
            next += 1
        }
        if deck.count > 8 { deck.removeLast(deck.count - 8) }
    }

    private func card(_ save: Save) -> some View {
        SaveImage(save, symbolSize: 36)
            .frame(width: 128, height: 160)
            .background(t.paper)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(t.paper, lineWidth: 4) }
            .shadow(color: t.shadow.opacity(0.3), radius: 10, y: 6)
    }
}

/// The top card turning over on its edge as it leaves to the left.
private struct FlipAway: ViewModifier, Animatable {
    var progress: Double
    var animatableData: Double { get { progress } set { progress = newValue } }
    func body(content: Content) -> some View {
        content
            .rotation3DEffect(.degrees(-progress * 170), axis: (x: 0.15, y: 1, z: 0), anchor: .leading, perspective: 0.6)
            .offset(x: -progress * 150, y: -progress * 24)
            .opacity(progress < 0.6 ? 1 : max(0, (1 - progress) / 0.4))
    }
}

/// iCloud while it sends: the cloud spins round on its axis every few seconds, two arcs circle it, and
/// little pages rise into it. Reduce Motion keeps it still.
private struct CloudSpin: View {
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        TimelineView(.animation(paused: reduce)) { context in
            let time = reduce ? 0 : context.date.timeIntervalSinceReferenceDate
            // One turn in the first second of every three, eased, then a rest.
            let beat = time.truncatingRemainder(dividingBy: 3)
            let turn = beat < 1 ? (1 - cos(beat * .pi)) / 2 : 0
            ZStack {
                ZStack {
                    Circle().fill(t.accent).frame(width: 150, height: 150)
                        .overlay { Circle().strokeBorder(t.line, lineWidth: t.outline) }
                    Image(systemName: "icloud.and.arrow.up")
                        .font(.system(size: 56, weight: .semibold))
                        .foregroundStyle(t.onAccent)
                }
                .rotation3DEffect(.degrees(turn * 360), axis: (x: 0, y: 1, z: 0), perspective: 0.4)
                Circle().trim(from: 0, to: 0.22)
                    .stroke(t.accent, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .frame(width: 178, height: 178)
                    .rotationEffect(.degrees(time * 140))
                Circle().trim(from: 0, to: 0.12)
                    .stroke(t.accent.opacity(0.55), style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    .frame(width: 198, height: 198)
                    .rotationEffect(.degrees(-time * 90 + 180))
                // Pages lifting off below and shrinking into the cloud.
                ForEach(0..<3, id: \.self) { i in
                    let p = (time / 2.1 + Double(i) / 3).truncatingRemainder(dividingBy: 1)
                    let x = Double(i - 1) * 46 * (1 - p)
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(t.paper)
                        .overlay { RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(t.line, lineWidth: 2) }
                        .overlay(alignment: .top) {
                            VStack(spacing: 3) { ForEach(0..<3, id: \.self) { _ in Capsule().fill(t.inkMuted.opacity(0.5)).frame(height: 2) } }
                                .padding(.horizontal, 5).padding(.top, 6)
                        }
                        .frame(width: 26, height: 32)
                        .shadow(color: t.shadow.opacity(0.25), radius: 3, y: 2)
                        .rotationEffect(.degrees(Double(i - 1) * 16 * (1 - p)))
                        .scaleEffect(1 - p * 0.6)
                        .offset(x: x, y: 118 - p * 118)
                        .opacity(reduce ? 0 : p < 0.15 ? p / 0.15 : p > 0.75 ? (1 - p) / 0.25 : 1)
                }
            }
        }
        .frame(height: 210)
    }
}

/// A big symbol on the accent: how a run ended (a tick, stop or pause).
private struct Badge: View {
    let symbol: String
    @Environment(\.ks) private var t

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 56, weight: .semibold))
            .foregroundStyle(t.onAccent)
            .contentTransition(.symbolEffect(.replace))
            .frame(width: 150, height: 150)
            .background(t.accent, in: Circle())
            .overlay { Circle().strokeBorder(t.line, lineWidth: t.outline) }
            .frame(height: 210)
    }
}

#if DEBUG
extension LibraryModel {
    /// Screenshots and UI tests: -demoWork ai|sync plays a pretend run on the library (nothing is sent
    /// anywhere), so the progress screen can be seen in every theme without an AI key or iCloud.
    func demoWork(_ kind: String) async {
        while saves.isEmpty { try? await Task.sleep(for: .milliseconds(200)) }
        let picks = Array(saves.filter { $0.image != nil }.prefix(30))
        if kind == "sync" {
            syncRun = SyncRun(total: 412, left: 412)
            workShowing = true
            for left in stride(from: 412, through: 0, by: -3) {
                try? await Task.sleep(for: .milliseconds(400))
                guard syncRun != nil else { return }
                syncRun?.left = left
            }
            syncRun = nil
            show("Your library is in iCloud")
            workEnd = WorkEnd(title: "All done", text: "Your library is in iCloud. Changes from now on go up by themselves.")
            return
        }
        aiRun = AIRun(done: 0, total: 240)
        workShowing = true
        for (i, chunk) in stride(from: 0, to: picks.count, by: 3).map({ Array(picks[$0..<min($0 + 3, picks.count)]) }).enumerated() {
            aiRun?.current = chunk.map(\.id)
            try? await Task.sleep(for: .seconds(2))
            guard aiRun != nil, aiRun?.stopping != true else { break }
            for (j, s) in chunk.enumerated() {
                aiRun?.note(WorkLine(id: s.id, text: (i + j) % 3 == 0 ? "\(s.title) → Kitchen" : s.title, symbol: (i + j) % 3 == 0 ? "tray.and.arrow.down" : "checkmark"))
            }
            aiRun?.done += chunk.count
        }
        show("AI updated 18 of 240")
        if let run = aiRun { endWork(run, summary: "Checked \(run.done) of \(run.total), updated 4, filed 2 into collections.", rest: "The rest are as they were.") }
        aiRun = nil
    }
}
#endif
