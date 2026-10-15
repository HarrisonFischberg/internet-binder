import XCTest

/// Scrolling 5,000 saves. Runs only when KEEPSAKE_PERF_FILE points at a Chrome export with that many.
final class ScrollPerformanceTests: XCTestCase {
    func testScrollingFiveThousandSaves() throws {
        guard let file = ProcessInfo.processInfo.environment["KEEPSAKE_PERF_FILE"] else { throw XCTSkip("set KEEPSAKE_PERF_FILE to run") }
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "perf-\(UUID().uuidString)"
        app.launchArguments += ["-importOnLaunch", file]
        app.launch()
        XCTAssertTrue(app.staticTexts["188 saves need a collection"].waitForExistence(timeout: 60), "imported")
        let start = Date()
        app.tabBars.buttons["Library"].tap()
        XCTAssertTrue(app.staticTexts["5,000 saves, kept on this iPhone"].waitForExistence(timeout: 30))
        print("PERF Library tab shown in \(Date().timeIntervalSince(start)) s")
        let scroll = app.scrollViews.firstMatch
        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric]) {
            scroll.swipeUp(velocity: .fast)
            scroll.swipeUp(velocity: .fast)
            scroll.swipeDown(velocity: .fast)
        }
    }
}
