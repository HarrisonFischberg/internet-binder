import XCTest

/// The progress screen for long runs (Fix everything with AI, iCloud's first copy), played by -demoWork:
/// Work in background closes it and leaves the bar, a tap on the bar brings it back, and it ends on Done.
/// Screenshots of each theme go to KEEPSAKE_SHOTS when it's set.
final class WorkScreenTests: XCTestCase {
    let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path

    private func launch(_ kind: String, theme: String = "nocturne", mode: String = "light") -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "work-\(UUID().uuidString)"
        app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", theme, "-ksMode", mode, "-demoWork", kind]
        app.launch()
        return app
    }

    private func shoot(_ name: String) throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { return }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        try XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name).png"))
    }

    func testFixEverythingScreenGoesToTheBackgroundAndComesBack() throws {
        let app = launch("ai")
        XCTAssertTrue(app.buttons["workInBackground"].waitForExistence(timeout: 15))
        sleep(5)
        try shoot("work-ai-pantry")
        app.buttons["workInBackground"].tap()
        let bar = app.buttons["aiRunBar"]
        XCTAssertTrue(bar.waitForExistence(timeout: 5), "the bar shows after Work in background")
        try shoot("work-ai-bar")
        bar.tap()
        XCTAssertTrue(app.buttons["workStop"].waitForExistence(timeout: 5), "tapping the bar opens the screen again")
        app.buttons["workStop"].tap()
        XCTAssertTrue(app.buttons["workDone"].waitForExistence(timeout: 10), "a stopped run ends on Done")
        XCTAssertTrue(app.staticTexts["Stopped"].waitForExistence(timeout: 3), "a stopped run says so, not All done")
        sleep(1)
        try shoot("work-ai-done")
        app.buttons["workDone"].tap()
        XCTAssertTrue(app.buttons["workDone"].waitForNonExistence(timeout: 3), "Done closes the screen")
    }

    func testICloudCopyScreen() throws {
        let app = launch("sync")
        XCTAssertTrue(app.buttons["workInBackground"].waitForExistence(timeout: 15))
        sleep(3)
        try shoot("work-sync-pantry")
        XCTAssertFalse(app.buttons["workStop"].exists, "iCloud's copy has no Stop: Settings turns sync off")
        XCTAssertTrue(app.buttons["workDone"].waitForExistence(timeout: 90), "ends on Done when everything is sent")
        XCTAssertTrue(app.staticTexts["All done"].waitForExistence(timeout: 3))
        sleep(1)
        try shoot("work-sync-done")
    }

    /// Every theme, light and dark (screenshots only).
    func testThemes() throws {
        guard ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] != nil else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        for theme in ["nocturne", "paper", "chromatic"] {
            for mode in ["light", "dark"] {
                let app = launch("ai", theme: theme, mode: mode)
                XCTAssertTrue(app.buttons["workInBackground"].waitForExistence(timeout: 15))
                sleep(5)
                try shoot("work-ai-\(theme)-\(mode)")
                app.terminate()
            }
        }
    }
}
