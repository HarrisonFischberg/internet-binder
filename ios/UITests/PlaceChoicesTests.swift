import XCTest

/// Fix with AI found two branches it couldn't tell apart: the save shows both with their source, and
/// choosing one applies it (QA 2026-10-30).
final class PlaceChoicesTests: XCTestCase {
    let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../KeepsakeKit/Tests/KeepsakeKitTests/Fixtures/place-choices-export.json").standardized.path

    override func setUp() { continueAfterFailure = false }

    func testPickOneOfTwoBranches() {
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "uitest-\(UUID().uuidString)"
        app.launchArguments += ["-importOnLaunch", fixture]
        app.launch()
        app.tabBars.buttons["Library"].tap()
        app.chip("Places").tap()
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Joe's Pizza")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 5))
        card.tap()
        XCTAssertTrue(app.staticTexts["Which place is it?"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["7 Carmine Street, New York, NY"].exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'OpenStreetMap'")).firstMatch.exists)
        app.buttons["Choose Joe's Pizza, 1435 Broadway, New York, NY"].tap()
        XCTAssertTrue(app.staticTexts["1435 Broadway, New York, NY"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Which place is it?"].exists, "the choices are gone once one is picked")
    }
}
