import XCTest

/// Select mode inside a Lifestyle view and on Collections, the long-press menu's Select, and swipe to
/// delete. Every delete ends with Undo, which must put everything back.
final class SelectionTests: XCTestCase {
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

    func card(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    }

    func openRecipes(_ app: XCUIApplication) {
        app.tabBars.buttons["Library"].tap()
        let recipes = card(app, "Recipes,")
        XCTAssertTrue(recipes.waitForExistence(timeout: 5))
        for _ in 0..<4 where !recipes.isHittable { app.swipeUp() }
        recipes.tap()
        XCTAssertTrue(card(app, "Brown butter pasta").waitForExistence(timeout: 5))
    }

    func testSelectAllInALifestyleViewDeleteAndUndo() {
        let app = launch()
        openRecipes(app)
        app.buttons["Select"].tap()
        app.buttons["Select all"].tap()
        XCTAssertTrue(app.staticTexts["2 saves selected"].waitForExistence(timeout: 2))
        app.buttons["Move 2 to Trash"].tap()
        XCTAssertTrue(app.staticTexts["Moved 2 saves to Trash"].waitForExistence(timeout: 5))
        XCTAssertFalse(card(app, "Brown butter pasta").exists)
        app.buttons["Undo"].tap()
        XCTAssertTrue(card(app, "Brown butter pasta").waitForExistence(timeout: 5), "Undo brings both back")
        XCTAssertTrue(card(app, "Morning mobility").exists)
    }

    func testLongPressMenuStartsSelectMode() {
        let app = launch()
        openRecipes(app)
        card(app, "Brown butter pasta").press(forDuration: 1.0)
        let select = app.buttons["Select"].firstMatch
        XCTAssertTrue(select.waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Move to Trash"].exists, "the menu offers delete too")
        select.tap()
        XCTAssertTrue(app.staticTexts["1 save selected"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Done"].exists)
    }

    func testDeleteCollectionsTogetherAndUndo() {
        let app = launch()
        app.buttons["Collections"].tap()
        XCTAssertTrue(app.staticTexts["For things to buy"].waitForExistence(timeout: 5))
        app.buttons["Select"].tap()
        app.buttons["Collection Clothing"].tap()
        app.buttons["Collection Technology"].tap()
        XCTAssertTrue(app.staticTexts["2 collections selected"].waitForExistence(timeout: 2))
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["Deleted 2 collections"].waitForExistence(timeout: 5))
        XCTAssertFalse(card(app, "Clothing").exists)
        app.buttons["Undo"].tap()
        XCTAssertTrue(card(app, "Clothing").waitForExistence(timeout: 5), "Undo puts the collections back")
        XCTAssertTrue(card(app, "Technology").exists)
    }

    func testSwipeARowToDelete() {
        let app = launch()
        app.tabBars.buttons["Places"].tap()
        var row = app.staticTexts["Café Azulejo"]
        if !row.waitForExistence(timeout: 3) {
            app.segmentedControls.buttons.element(boundBy: 2).tap()
            row = app.staticTexts["Café Azulejo"]
        }
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.swipeLeft(velocity: .fast)
        XCTAssertTrue(app.staticTexts["Moved to Trash"].waitForExistence(timeout: 5))
        app.buttons["Undo"].tap()
        XCTAssertTrue(app.staticTexts["Café Azulejo"].waitForExistence(timeout: 5))
    }
}
