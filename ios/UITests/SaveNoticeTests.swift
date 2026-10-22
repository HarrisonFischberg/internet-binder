import XCTest

/// The version at the bottom of Settings, and the "Saved to …" notification: it drops in from the top and
/// tapping it opens that save. Screenshots go to KEEPSAKE_SHOTS when it's set.
final class SaveNoticeTests: XCTestCase {
    let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    func shoot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { return }
        try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name).png"))
    }

    func testVersionInSettings() throws {
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "uitest-\(UUID().uuidString)"
        app.launchArguments += ["-importOnLaunch", demo]
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.switches["Optional AI"].waitForExistence(timeout: 5))
        // Settings is a lazy list: scroll down to the toggle and the version.
        let toggle = app.switches["Notify after saving"], version = app.staticTexts["appVersion"]
        for _ in 0..<8 where !toggle.exists { app.swipeUp() }
        XCTAssertTrue(toggle.exists)
        for _ in 0..<8 where !version.exists { app.swipeUp() }
        XCTAssertTrue(version.waitForExistence(timeout: 3))
        XCTAssertTrue(version.label.hasPrefix("Keepsake "), version.label)
        XCTAssertFalse(version.label.contains("0.1 "), "MARKETING_VERSION is still 0.1")
        shoot("settings-version")
    }

    func testTappingTheNoticeOpensTheSave() throws {
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "uitest-\(UUID().uuidString)"
        app.launchArguments += ["-importOnLaunch", demo, "-noticeFirstSave", "YES"]
        app.launch()
        // iOS asks once (the app posts 5 s later); allow it.
        let allow = springboard.buttons["Allow"]
        if allow.waitForExistence(timeout: 2) { allow.tap() }
        XCUIDevice.shared.press(.home)
        if allow.exists { allow.tap() }
        let banner = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Saved to'")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 15), "no notification")
        shoot("notice-banner")
        banner.tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        // The save's page is open: the tab bar steps aside and Back shows.
        XCTAssertTrue(app.navigationBars.buttons.element(boundBy: 0).waitForExistence(timeout: 10))
        sleep(1)
        XCTAssertFalse(app.tabBars.buttons["Home"].isHittable, "the save didn't open")
        shoot("notice-opened-save")
    }
}
