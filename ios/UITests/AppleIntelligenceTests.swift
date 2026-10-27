import XCTest

/// Apple Intelligence's note on Home (once per state) and its status in Settings, with the state forced by
/// -ks.appleAIStatus (OnDeviceAI, DEBUG only). Screenshots go to KEEPSAKE_SHOTS when it's set.
final class AppleIntelligenceTests: XCTestCase {
    let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path

    func shoot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { return }
        sleep(1)
        try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name).png"))
    }

    func launch(_ status: String, db: String = "uitest-\(UUID().uuidString)", reset: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = db
        app.launchArguments += ["-importOnLaunch", demo, "-ks.appleAIStatus", status]
        if reset { app.launchArguments += ["-ks.freshAppleNote", "YES"] }
        app.launch()
        return app
    }

    func testOnNoteThenSettings() throws {
        let app = launch("ready")
        XCTAssertTrue(app.staticTexts["Apple Intelligence is on"].waitForExistence(timeout: 10))
        shoot("apple-1-home-on")
        app.buttons["Dismiss"].tap()
        XCTAssertFalse(app.staticTexts["Apple Intelligence is on"].waitForExistence(timeout: 2))
        // Fix with AI shows with no key at all.
        XCTAssertTrue(app.buttons["Fix everything with AI"].waitForExistence(timeout: 5))
        app.buttons["Settings"].tap()
        let status = app.staticTexts["appleAIStatus"]
        XCTAssertTrue(status.waitForExistence(timeout: 5))
        XCTAssertEqual(status.label, "Apple Intelligence, On")
        XCTAssertTrue(app.switches["Use your own key"].exists)
        shoot("apple-2-settings-on")
    }

    func testOffNoteSaysHowToTurnItOn() throws {
        let app = launch("off")
        XCTAssertTrue(app.staticTexts["Turn on Apple Intelligence"].waitForExistence(timeout: 10))
        shoot("apple-3-home-off")
        XCTAssertFalse(app.buttons["Fix everything with AI"].exists, "no key and no Apple Intelligence: nothing reads saves")
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.staticTexts["appleAIStatus"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["appleAIStatus"].label, "Apple Intelligence, Off")
        shoot("apple-4-settings-off")
    }

    func testUnsupportedShowsNoNote() throws {
        let app = launch("unsupported")
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Apple Intelligence is on"].exists)
        XCTAssertFalse(app.staticTexts["Turn on Apple Intelligence"].exists)
    }
}
