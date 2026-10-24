import AppIntents
import WidgetKit
import KeepsakeKit

/// "Done today" from the Workout goal widget: checks in through the shared store (goals.js rules), then
/// redraws the widgets from a fresh snapshot. Runs without opening the app.
struct CheckInIntent: AppIntent {
    static let title: LocalizedStringResource = "Done today"
    static let description = IntentDescription("Check in to your workout goal for today.")

    @Parameter(title: "Goal") var goalId: String

    init() {}
    init(goalId: String) { self.goalId = goalId }

    func perform() async throws -> some IntentResult {
        let library = try Library(tidy: false)
        _ = try await library.checkIn(goalId: goalId)
        _ = try await library.writeWidgetSnapshot()
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
