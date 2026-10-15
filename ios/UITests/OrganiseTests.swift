import XCTest

/// M3.4: Review filing, collections, settings consent, export.
final class OrganiseTests: XCTestCase {
    let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../KeepsakeKit/Tests/KeepsakeKitTests/Fixtures/chrome-export.json").standardized.path

    override func setUp() { continueAfterFailure = false }

    func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "uitest-\(UUID().uuidString)"
        app.launchArguments += ["-importOnLaunch", fixture]
        app.launch()
        return app
    }

    func testFileFromReviewIntoACollection() {
        let app = launch()
        let banner = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '1 save needs a collection'")).firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 5))
        banner.tap()
        let suggestion = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'File in'")).firstMatch
        XCTAssertTrue(suggestion.waitForExistence(timeout: 5), "three suggestions from the categorizer")
        let name = suggestion.label.replacingOccurrences(of: "File in ", with: "")
        suggestion.tap()
        XCTAssertTrue(app.staticTexts["Filed in \(name)"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Nothing waiting. Everything has a home."].waitForExistence(timeout: 5))
    }

    func testLookupsAskFirst() {
        let app = launch()
        app.buttons["Settings"].tap()
        let places = app.switches["Places: OpenStreetMap"]
        XCTAssertTrue(places.waitForExistence(timeout: 5))
        XCTAssertEqual(places.value as? String, "0", "off by default")
        places.switches.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Look up places on OpenStreetMap?"].waitForExistence(timeout: 3))
        app.buttons["Not now"].tap()
        XCTAssertEqual(app.switches["Places: OpenStreetMap"].value as? String, "0", "still off after Not now")
    }

    func testCollectionsListShopping() {
        let app = launch()
        app.buttons["Collections"].tap()
        XCTAssertTrue(app.staticTexts["For things to buy"].waitForExistence(timeout: 5))
    }
}
