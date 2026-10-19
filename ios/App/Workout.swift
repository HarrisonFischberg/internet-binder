import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// A workout goal: this week's ring, the week strip filling in, and Chrome's own summary
/// ("2 of 3 this week · week 1 of 4"). No streaks, no guilt: a short week reads neutrally.
struct GoalCard: View {
    let goal: GoalView
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
                    Text("Goal").font(KSFont.label).foregroundStyle(workout)
                    Text(goal.progress.summary).font(KSFont.name(.headline)).foregroundStyle(t.ink)
                    if let note = goal.progress.lastWeekNote, !note.isEmpty { Text(note).font(.footnote).foregroundStyle(t.inkMuted) }
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
        .padding(16)
        .ksSurface()
        .accessibilityElement(children: .contain)
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
