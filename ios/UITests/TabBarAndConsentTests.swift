import XCTest

/// Two fixes checked on screen, with screenshots into KEEPSAKE_SHOTS: the tab bar is back the moment you leave
/// a save, and the Optional AI consent sheet's buttons sit on their own bar below its text.
final class TabBarAndConsentTests: XCTestCase {
    let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path

    func shoot(_ folder: String, _ name: String) throws {
        try XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name).png"))
    }

    func testTabBarAndConsent() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        XCUIDevice.shared.appearance = ProcessInfo.processInfo.environment["KEEPSAKE_SHOT_MODES"] == "dark" ? .dark : .light
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
        app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", "nocturne"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Recent"].waitForExistence(timeout: 10))
        sleep(2)

        // A save from Recent: the tabs hide while it's open, and are back right after Back.
        let recent = app.staticTexts["Recent"].frame
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: recent.minX + 60, dy: recent.maxY + 80)).tap()
        XCTAssertTrue(app.navigationBars.buttons.element(boundBy: 0).waitForExistence(timeout: 5))
        sleep(1)
        try shoot(folder, "tabbar-1-save-open")
        XCTAssertFalse(app.tabBars.buttons["Home"].isHittable, "tab bar shows over an open save")
        print("KS-MARK back-tap \(Date().timeIntervalSince1970)")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        try shoot(folder, "tabbar-2-home-after-back")
        print("KS-MARK after-back-shot \(Date().timeIntervalSince1970)")
        XCTAssertTrue(app.tabBars.buttons["Home"].isHittable, "tab bar missing right after Back")
        sleep(1)
        try shoot(folder, "tabbar-3-home-settled")

        // Your own AI key: the consent sheet.
        app.buttons["Settings"].tap()
        let toggle = app.switches["Use your own key"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        toggle.switches.firstMatch.tap()
        XCTAssertTrue(app.buttons["Turn on"].waitForExistence(timeout: 5))
        sleep(1)
        try shoot(folder, "consent-1-sheet")
        let turnOn = app.buttons["Turn on"].frame, notNow = app.buttons["Not now"].frame
        print("KS-MARK buttons notNow=\(notNow) turnOn=\(turnOn)")
        app.buttons["Turn on"].tap()

        // A dummy key: the Fix with AI buttons show.
        let key = app.secureTextFields["Your API key"]
        XCTAssertTrue(key.waitForExistence(timeout: 5))
        key.tap()
        key.typeText("sk-dummy-for-screenshots\n")
        sleep(1)
        try shoot(folder, "ai-1-settings-on")
        app.buttons["Done"].firstMatch.tap()
        if app.buttons["Settings"].waitForExistence(timeout: 3) == false { app.swipeDown(velocity: .fast) }
        XCTAssertTrue(app.buttons["Fix everything with AI"].waitForExistence(timeout: 5))
        sleep(1)
        try shoot(folder, "ai-2-home-sparkles")
        app.buttons["Collections"].firstMatch.tap()
        sleep(2)
        try shoot(folder, "ai-3-collections")
        app.buttons.matching(NSPredicate(format: "label CONTAINS ','")).element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["Fix with AI"].waitForExistence(timeout: 5))
        sleep(1)
        try shoot(folder, "ai-4-collection-fix-with-ai")
    }
}
