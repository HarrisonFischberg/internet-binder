import XCTest

/// A save's own buttons (one-tap stamps with their 🎉, Purchased, Share), the Library's count, and
/// putting stacks in your own order by dragging.
final class CardActionsTests: XCTestCase {
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

    func testOneTapStampSaysSo() {
        let app = launch()
        app.tabBars.buttons["Library"].tap()
        XCTAssertTrue(card(app, "Places,").waitForExistence(timeout: 5))
        card(app, "Places,").tap()
        card(app, "Café Azulejo").tap()
        let been = app.buttons["Been"]
        XCTAssertTrue(been.waitForExistence(timeout: 5))
        been.tap()
        XCTAssertTrue(app.staticTexts["Been!"].waitForExistence(timeout: 2), "the 🎉 in the middle of the screen")
        XCTAssertTrue(app.buttons["Been, stamped"].waitForExistence(timeout: 3))
        app.buttons["Been, stamped"].tap()
        XCTAssertTrue(app.buttons["Been"].waitForExistence(timeout: 3), "a second tap takes the stamp off")
    }

    func testPurchasedOnTheCardAndShare() {
        let app = launch()
        app.tabBars.buttons["Library"].tap()
        let review = app.chip("Review 1")
        XCTAssertTrue(review.exists)
        review.tap()
        card(app, "Dutch oven").tap()
        let purchased = app.buttons["Purchased"]
        XCTAssertTrue(purchased.waitForExistence(timeout: 5), "a thing to buy has Purchased on the card itself")
        purchased.tap()
        XCTAssertTrue(app.staticTexts["Purchased!"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.buttons["Purchased, stamped"].waitForExistence(timeout: 3))
        app.buttons["Share"].firstMatch.tap()
        XCTAssertTrue(app.descendants(matching: .any)["Copy"].firstMatch.waitForExistence(timeout: 5), "the system Share Sheet")
    }

    func testLibraryCountIsJustSaves() {
        let app = launch()
        app.tabBars.buttons["Library"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label MATCHES '^[0-9,]+ saves?$'")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'kept on this'")).firstMatch.exists)
    }

    func testDragLifestyleStacksIntoYourOrder() {
        let app = launch()
        app.tabBars.buttons["Library"].tap()
        let places = card(app, "Places,"), recipes = card(app, "Recipes,")
        XCTAssertTrue(recipes.waitForExistence(timeout: 5))
        for _ in 0..<4 where !recipes.isHittable { app.swipeUp() }
        XCTAssertLessThan(places.frame.minX, recipes.frame.minX, "Chrome's order to start: Places, then Recipes")
        recipes.press(forDuration: 1.2, thenDragTo: places)
        XCTAssertTrue(recipes.waitForExistence(timeout: 2))
        XCTAssertLessThan(recipes.frame.minX, places.frame.minX, "Recipes now comes first")
        // Kept: Home's Lifestyle page shows the same order.
        app.terminate()
        app.launch()
        app.tabBars.buttons["Library"].tap()
        XCTAssertTrue(recipes.waitForExistence(timeout: 5))
        for _ in 0..<4 where !recipes.isHittable { app.swipeUp() }
        XCTAssertLessThan(recipes.frame.minX, places.frame.minX, "the order is kept")
    }
}
