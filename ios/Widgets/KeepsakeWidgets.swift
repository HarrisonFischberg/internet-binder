import WidgetKit
import SwiftUI
import KeepsakeKit
import KeepsakeUI

/// Widgets read the snapshot the app writes to the App Group (WidgetSnapshot); they never open the
/// library or run the shared code, so they stay small and fast.
struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry { SnapshotEntry(date: .now, snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) { completion(SnapshotEntry(date: .now, snapshot: WidgetSnapshot.read())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        // The app reloads timelines when anything changes; a refresh at midnight starts the new day.
        let midnight = Calendar.current.startOfDay(for: .now.addingTimeInterval(86_400))
        completion(Timeline(entries: [SnapshotEntry(date: .now, snapshot: WidgetSnapshot.read())], policy: .after(midnight)))
    }
}

// MARK: Workout goal

struct GoalWidgetView: View {
    let entry: SnapshotEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.ks) private var t

    var body: some View {
        Group {
            if let goal = entry.snapshot?.goals.first {
                switch family {
                case .accessoryCircular:
                    Gauge(value: goal.ring) { Image(systemName: "figure.strengthtraining.traditional") }
                        .gaugeStyle(.accessoryCircularCapacity)
                case .systemMedium: medium(goal)
                default: small(goal)
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Image(systemName: "figure.strengthtraining.traditional").foregroundStyle(KindStyle("workout").color)
                    Text("No goal yet").font(KSFont.name(.headline)).foregroundStyle(t.ink)
                    Text("Open a workout and make it a goal.").font(.caption).foregroundStyle(t.inkMuted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .containerBackground(for: .widget) { family == .accessoryCircular ? AnyView(Color.clear) : AnyView(t.paper) }
        .widgetURL(entry.snapshot?.goals.first.map { URL(string: "keepsake://save/\($0.itemId)")! })
    }

    private func ring(_ goal: WidgetSnapshot.Goal, size: CGFloat) -> some View {
        ZStack {
            Circle().stroke(t.rule, lineWidth: 6)
            Circle().trim(from: 0, to: goal.ring).stroke(KindStyle("workout").color, style: StrokeStyle(lineWidth: 6, lineCap: .round)).rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
    }

    private func strip(_ goal: WidgetSnapshot.Goal) -> some View {
        HStack(spacing: 4) {
            ForEach(goal.weeks.prefix(12), id: \.week) { w in
                RoundedRectangle(cornerRadius: 2)
                    .fill(w.met ? KindStyle("workout").color : w.count > 0 ? KindStyle("workout").color.opacity(0.35) : t.rule)
                    .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(w.current ? t.ink : .clear, lineWidth: 1))
                    .frame(height: 12)
            }
        }
    }

    private func small(_ goal: WidgetSnapshot.Goal) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ring(goal, size: 40)
            Text(goal.title).font(KSFont.name(.subheadline)).foregroundStyle(t.ink).lineLimit(2)
            Text(goal.summary).font(.caption2).foregroundStyle(t.inkMuted).lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func medium(_ goal: WidgetSnapshot.Goal) -> some View {
        HStack(spacing: 16) {
            ring(goal, size: 64)
            VStack(alignment: .leading, spacing: 6) {
                Text(goal.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(1)
                Text(goal.summary).font(.caption).foregroundStyle(t.inkMuted).lineLimit(2)
                strip(goal)
            }
        }
    }
}

struct GoalWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "goal", provider: SnapshotProvider()) { GoalWidgetView(entry: $0).environment(\.ks, KSTheme.named(Appearance.load().theme)) }
            .configurationDisplayName("Workout goal")
            .description("This week's check-ins for your goal.")
            .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular])
    }
}

// MARK: Latest save

struct LatestWidgetView: View {
    let entry: SnapshotEntry
    @Environment(\.ks) private var t
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let latest = entry.snapshot?.latest {
                Stamp(kind: latest.kind, size: 26)
                Spacer(minLength: 0)
                Text(latest.title).font(KSFont.name(.headline)).foregroundStyle(t.ink).lineLimit(3)
                if !latest.fact.isEmpty { Text(latest.fact).font(.caption2).foregroundStyle(t.inkMuted).lineLimit(1) }
            } else {
                Text("Keepsake").font(KSFont.name(.headline)).foregroundStyle(t.ink)
                Text("Share something to Keepsake and it shows up here.").font(.caption).foregroundStyle(t.inkMuted)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(t.paper, for: .widget)
        .widgetURL(entry.snapshot?.latest.map { URL(string: "keepsake://save/\($0.id)")! })
    }
}

struct LatestWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "latest", provider: SnapshotProvider()) { LatestWidgetView(entry: $0).environment(\.ks, KSTheme.named(Appearance.load().theme)) }
            .configurationDisplayName("Latest save")
            .description("The last thing you kept.")
            .supportedFamilies([.systemSmall])
    }
}

@main
struct KeepsakeWidgets: WidgetBundle {
    var body: some Widget {
        GoalWidget()
        LatestWidget()
    }
}
