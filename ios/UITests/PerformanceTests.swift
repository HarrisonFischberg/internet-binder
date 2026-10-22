import XCTest

/// Scrolling 5,000 saves. Runs only when KEEPSAKE_PERF_FILE points at a Chrome export with that many.
final class ScrollPerformanceTests: XCTestCase {
    /// With KEEPSAKE_PERF_FILE (Simulator) the file is imported; with KEEPSAKE_PERF (a device) 5,000 are generated.
    func perfApp() throws -> XCUIApplication {
        let env = ProcessInfo.processInfo.environment
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "perf"
        if let file = env["KEEPSAKE_PERF_FILE"] { app.launchArguments += ["-importOnLaunch", file] }
        else if env["KEEPSAKE_PERF"] != nil { app.launchArguments += ["-seedPerf", "5000"] }
        else { throw XCTSkip("set KEEPSAKE_PERF_FILE or KEEPSAKE_PERF to run") }
        return app
    }

    func testLaunchToUsableLibrary() throws {
        let app = try perfApp()
        app.launch()   // first launch fills the library
        XCTAssertTrue(app.staticTexts["Keepsake"].waitForExistence(timeout: 60))
        app.terminate()
        measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)]) { app.launch() }
    }

    func testScrollingFiveThousandSaves() throws {
        let app = try perfApp()
        app.launch()
        XCTAssertTrue(app.staticTexts["Keepsake"].waitForExistence(timeout: 60))
        let start = Date()
        app.tabBars.buttons["Library"].tap()
        XCTAssertTrue(app.staticTexts["5,000 saves"].waitForExistence(timeout: 60))
        print("PERF Library tab shown in \(Date().timeIntervalSince(start)) s")
        let scroll = app.scrollViews.firstMatch
        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric]) {
            scroll.swipeUp(velocity: .fast)
            scroll.swipeUp(velocity: .fast)
            scroll.swipeDown(velocity: .fast)
        }
    }
}
