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

    /// A main section: a tab on iPhone, a sidebar row on iPad.
    func go(_ app: XCUIApplication, _ section: String) {
        if UIDevice.current.userInterfaceIdiom == .pad {
            app.cells.containing(.staticText, identifier: section).firstMatch.tap()
        } else {
            app.tabBars.buttons[section].tap()
        }
    }

    func openRecipes(_ app: XCUIApplication) {
        go(app, "Library")
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
        go(app, "Places")
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

    func testHalfSwipeShowsDeleteWithoutOpeningTheRow() {
        let app = launch()
        go(app, "Places")
        var row = app.staticTexts["Café Azulejo"]
        if !row.waitForExistence(timeout: 3) {
            app.segmentedControls.buttons.element(boundBy: 2).tap()
            row = app.staticTexts["Café Azulejo"]
        }
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        let from = row.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).withOffset(CGVector(dx: 120, dy: 0))
        from.press(forDuration: 0.01, thenDragTo: from.withOffset(CGVector(dx: -130, dy: 0)), withVelocity: 400, thenHoldForDuration: 0.2)
        let delete = app.buttons["Move to Trash"]
        XCTAssertTrue(delete.waitForExistence(timeout: 3), "Delete stays open behind the row")
        XCTAssertFalse(app.buttons["Directions"].exists, "letting go over the row doesn't open it")
        delete.tap()
        XCTAssertTrue(app.staticTexts["Moved to Trash"].waitForExistence(timeout: 5))
        app.buttons["Undo"].tap()
        XCTAssertTrue(app.staticTexts["Café Azulejo"].waitForExistence(timeout: 5))
    }
}
