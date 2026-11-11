import XCTest

/// Screenshots of the page search bars into KEEPSAKE_SHOTS: the Lifestyle and Collections pages, a Lifestyle
/// view (Recipes) empty and searched, a collection, and Places searched. Skipped without KEEPSAKE_SHOTS.
final class PageSearchShotsTests: XCTestCase {
    let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path

    func testPageSearchShots() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let mode = ProcessInfo.processInfo.environment["KEEPSAKE_SHOT_MODES"] == "dark" ? "dark" : "light"
        XCUIDevice.shared.appearance = mode == "dark" ? .dark : .light
        func shoot(_ name: String) throws {
            sleep(1)
            try XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name)-\(mode).png"))
        }
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
        app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", "nocturne"]
        app.launch()
        let search = app.textFields["pageSearch"]
        func back() { app.navigationBars.buttons.element(boundBy: 0).tap() }

        XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 10))
        app.buttons["Lifestyle"].tap()
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        try shoot("1-lifestyle-hub")

        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Recipes,'")).firstMatch.tap()
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        try shoot("2-recipes")
        search.tap(); search.typeText("lemon")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Lemon olive oil cake'")).firstMatch.waitForExistence(timeout: 3))
        try shoot("3-recipes-search")
        app.buttons["Clear search"].tap()
        search.typeText("bagels")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Nothing in Recipes'")).firstMatch.waitForExistence(timeout: 3))
        try shoot("4-recipes-no-match")
        back(); back()

        XCTAssertTrue(app.buttons["Collections"].waitForExistence(timeout: 5))
        app.buttons["Collections"].tap()
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        try shoot("5-collections-hub")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Kitchen'")).firstMatch.tap()
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        try shoot("6-collection-kitchen")

        app.tabBars.buttons["Places"].tap()
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        try shoot("7-places")
        search.tap(); search.typeText("cafe")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'Flore'")).firstMatch.waitForExistence(timeout: 3)
                      || app.buttons.matching(NSPredicate(format: "label CONTAINS 'Flore'")).firstMatch.exists)
        try shoot("8-places-search")
    }
}
