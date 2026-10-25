import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// A workout goal: this week's ring, the week strip filling in, and Chrome's own summary
/// ("2 of 3 this week · week 1 of 4"). No streaks, no guilt: a short week reads neutrally.
struct GoalCard: View {
    let goal: GoalView
    /// The workout's name, where the card stands for it (Workouts' Goals view).
    var title: String? = nil
    /// "Remove goal", for a goal made by mistake (the screen offers Undo).
    var onRemove: (() -> Void)? = nil
    /// Off where the card sits inside a bigger card (the Goals view adds Done today under it).
    var surface = true
    @Environment(\.ks) private var t
    @Environment(\.accessibilityReduceMotion) private var reduce

    var body: some View {
        let workout = KindStyle("workout").color
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 16) {
                ZStack {
                    Circle().stroke(t.rule, lineWidth: 7)
                    Circle().trim(from: 0, to: goal.progress.ring).stroke(workout, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(KSMotion.or(.interpolatingSpring(mass: 1.6, stiffness: 180, damping: 18), reduce: reduce), value: goal.progress.ring)
                    if goal.progress.status == "finished" { Image(systemName: "checkmark").font(.title3.weight(.bold)).foregroundStyle(workout) }
                }
                .frame(width: 58, height: 58)
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(goal.progress.status == "finished" ? "Goal met" : "Goal").font(KSFont.label).foregroundStyle(workout)
                    if let title { Text(title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(2) }
                    Text(goal.progress.summary).font(title == nil ? KSFont.name(.headline) : .subheadline).foregroundStyle(title == nil ? t.ink : t.inkMuted)
                    if let note = goal.progress.lastWeekNote, !note.isEmpty { Text(note).font(.footnote).foregroundStyle(t.inkMuted) }
                }
                Spacer(minLength: 0)
                if let onRemove {
                    Menu {
                        Button("Remove goal", systemImage: "trash", role: .destructive, action: onRemove)
                    } label: {
                        Image(systemName: "ellipsis.circle").font(.title3).foregroundStyle(t.inkMuted)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Goal options")
                    .accessibilityIdentifier("goal-options")
                }
            }
            if let strip = goal.progress.strip {
                HStack(spacing: 6) {
                    ForEach(strip, id: \.week) { w in
                        VStack(spacing: 4) {
                            RoundedRectangle(cornerRadius: 3)
                                .fill(w.met ? workout : w.count > 0 ? workout.opacity(0.35) : t.well)
                                .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(w.met || w.count > 0 ? .clear : t.inkMuted.opacity(0.6), lineWidth: 1))
                                .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(w.current ? t.ink : .clear, lineWidth: 1.5))
                                .frame(height: 22)
                            Text("\(w.week)").font(.caption2).foregroundStyle(t.inkMuted)
                        }
                        .accessibilityElement()
                        .accessibilityLabel("Week \(w.week): \(w.count) of \(w.target)\(w.current ? ", this week" : "")")
                    }
                }
            }
        }
        .modifier(CardSurface(on: surface))
        .accessibilityElement(children: .contain)
    }
}

/// A card's padding and surface, or neither where an outer card already has them.
private struct CardSurface: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on { content.padding(16).ksSurface() } else { content }
    }
}

/// Workouts' Goals view: every goal, the ones still going first. A card opens its workout; Done today
/// checks in right there (another tap takes today back off), with Undo, as on the workout's page.
struct WorkoutGoalsList: View {
    let goals: [GoalView]
    let zoom: Namespace.ID
    @Environment(LibraryModel.self) private var model
    @Environment(\.ks) private var t

    var body: some View {
        let going = goals.filter { $0.progress.status == "active" }
        let finished = goals.filter { $0.progress.status != "active" }
        VStack(alignment: .leading, spacing: 14) {
            if goals.isEmpty {
                EmptyNote(symbol: "target", text: "No goals yet. Open a workout and tap Make it a goal, then check in here each time you do it.")
            }
            ForEach(going, id: \.goal.id) { row($0) }
            if !finished.isEmpty {
                Text("Finished").font(KSFont.name(.title2)).foregroundStyle(t.ink).padding(.top, 8).accessibilityAddTraits(.isHeader)
                ForEach(finished, id: \.goal.id) { row($0) }
            }
        }
    }

    @ViewBuilder private func row(_ goal: GoalView) -> some View {
        if let save = model.index.byId[goal.goal.itemId] {
            VStack(alignment: .leading, spacing: 14) {
                NavigationLink(value: save) {
                    HStack(alignment: .top, spacing: 12) {
                        GoalCard(goal: goal, title: save.title, surface: false)
                        Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(t.inkMuted)
                            .padding(.top, 20).accessibilityHidden(true)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle())
                .accessibilityHint("Opens the workout.")
                if goal.progress.status == "active" {
                    StampButton("Done today", done: !(goal.today ?? []).isEmpty, symbol: "calendar.badge.checkmark") { toggleCheckIn(goal) }
                }
            }
            .padding(16)
            .ksSurface()
            .matchedTransitionSource(id: save.id, in: zoom)
        }
    }

    /// The workout page's Done today: one tap checks in, another takes today's check-in back off.
    private func toggleCheckIn(_ goal: GoalView) {
        guard let lib = model.library else { return }
        let today = goal.today ?? []
        Task {
            if today.isEmpty {
                guard let id = try? await lib.checkIn(goalId: goal.goal.id) else { return }
                model.celebrate("Done today!")
                model.widgetsChanged()
                model.show("Checked in for today") {
                    try? await lib.undoCheckIn(id)
                    model.widgetsChanged()
                }
            } else {
                for id in today { try? await lib.undoCheckIn(id) }
                model.widgetsChanged()
            }
        }
    }
}

/// "3× a week for 4 weeks": two dials, one decision.
struct GoalSheet: View {
    let create: (Int, Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.ks) private var t
    @State private var perWeek = 3
    @State private var weeks = 4

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Text("\(perWeek)× a week for \(weeks) week\(weeks == 1 ? "" : "s")")
                    .font(KSFont.name(.title)).foregroundStyle(t.ink)
                    .contentTransition(.numericText())
                    .animation(KSMotion.settle, value: perWeek * 100 + weeks)
                Stepper("Times a week: \(perWeek)", value: $perWeek, in: 1...14)
                    .onChange(of: perWeek) { Haptic.detent() }
                Stepper("Weeks: \(weeks)", value: $weeks, in: 1...52)
                    .onChange(of: weeks) { Haptic.detent() }
                Spacer()
                PrimarySlab("Start the goal", symbol: "target") {
                    create(perWeek, weeks)
                    dismiss()
                }
            }
            .padding(20)
            .background(TableBackground())
            .navigationTitle("Make it a goal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}
