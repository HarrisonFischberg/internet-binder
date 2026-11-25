import XCTest

/// Play: a list's saves as one big card at a time. Keep or Trash each, Undo the last, add a product's URL
/// on the card, and open what you kept at the end. Uses the Wish List demo library, so nothing needs a key.
final class SwipeModeTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    let db = "uitest-\(UUID().uuidString)"

    func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = db
        app.launchArguments += ["-importOnLaunch", URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../demo/keepsake-wishlist-demo.json").standardized.path]
        app.launch()
        return app
    }

    func play(_ app: XCUIApplication) {
        let link = app.buttons["wishList.link"]
        XCTAssertTrue(link.waitForExistence(timeout: 10))
        for _ in 0..<6 where !link.isHittable { app.swipeUp() }
        link.tap()
        let play = app.buttons["swipe.play"]
        XCTAssertTrue(play.waitForExistence(timeout: 5))
        play.tap()
        XCTAssertTrue(app.navigationBars["1 of 4"].waitForExistence(timeout: 5))
    }

    func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name).png"))
    }

    /// Keep, Trash and Undo by button and by swipe; the end lists what was kept, and each opens its page.
    func testKeepTrashUndoAndOpenWhatWasKept() {
        let app = launch()
        play(app)
        shot("swipe-card")
        app.buttons["swipe.keep"].tap()
        XCTAssertTrue(app.navigationBars["2 of 4"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Kept 1"].waitForExistence(timeout: 3))
        app.buttons["swipe.trash"].tap()
        XCTAssertTrue(app.navigationBars["3 of 4"].waitForExistence(timeout: 3))
        // Undo brings the trashed card back on top.
        app.buttons["swipe.undo"].tap()
        XCTAssertTrue(app.navigationBars["2 of 4"].waitForExistence(timeout: 5))
        // A swipe left is Trash, a swipe right is Keep.
        let card = app.descendants(matching: .any)["swipe.card"].firstMatch
        card.swipeLeft()
        XCTAssertTrue(app.navigationBars["3 of 4"].waitForExistence(timeout: 3))
        app.descendants(matching: .any)["swipe.card"].firstMatch.swipeRight()
        XCTAssertTrue(app.navigationBars["4 of 4"].waitForExistence(timeout: 3))
        app.buttons["swipe.keep"].tap()
        XCTAssertTrue(app.staticTexts["All done"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Kept 3. Moved 1 to the Trash."].exists)
        XCTAssertEqual(app.buttons.matching(identifier: "swipe.keptRow").count, 3)
        shot("swipe-kept")
        // Each kept save opens its own page.
        app.buttons.matching(identifier: "swipe.keptRow").firstMatch.tap()
        XCTAssertTrue(app.buttons["save.improve"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["swipe.done"].tap()
        XCTAssertTrue(app.staticTexts["3 things to buy, from all your collections."].waitForExistence(timeout: 5))
    }

    /// Play is on the Library too, for every kind of save; a recipe's card offers its own link field.
    func testPlayTheWholeLibraryAndFixARecipe() {
        let app = launch()
        XCTAssertTrue(app.buttons["wishList.link"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Library"].tap()
        let play = app.buttons["swipe.play"]
        XCTAssertTrue(play.waitForExistence(timeout: 5))
        play.tap()
        XCTAssertTrue(app.navigationBars.matching(NSPredicate(format: "identifier BEGINSWITH '1 of '")).firstMatch.waitForExistence(timeout: 5))
        let recipe = app.buttons["Add recipe URL"]
        for _ in 0..<40 where !recipe.exists { app.buttons["swipe.keep"].tap() }
        XCTAssertTrue(recipe.exists, "a recipe card offers its own link")
        shot("swipe-recipe")
        app.buttons["swipe.more"].tap()
        XCTAssertTrue(app.buttons["Edit title or note"].waitForExistence(timeout: 3))
        app.buttons["Edit title or note"].tap()
        XCTAssertTrue(app.buttons["Cancel"].waitForExistence(timeout: 3))
        app.buttons["Cancel"].tap()
        recipe.tap()
        XCTAssertTrue(app.textFields["recipeLink.field"].waitForExistence(timeout: 5))
    }

    /// Add URL stays open, on the same card and with what was typed, after leaving the app for the browser,
    /// and even when iOS closed the app meanwhile.
    func testAddURLIsStillOpenAfterLeavingTheApp() {
        let app = launch()
        play(app)
        app.buttons["swipe.keep"].tap()
        XCTAssertTrue(app.navigationBars["2 of 4"].waitForExistence(timeout: 3))
        let title = app.staticTexts["swipe.title"].firstMatch.label
        app.buttons["swipe.addURL"].tap()
        let field = app.textFields["productLink.field"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.typeText("shop.example.com/p/1")
        shot("swipe-add-url")

        XCUIDevice.shared.press(.home)
        XCUIApplication(bundleIdentifier: "com.apple.mobilesafari").launch()
        app.activate()
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertEqual(field.value as? String, "shop.example.com/p/1")

        app.terminate()
        app.launch()
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        XCTAssertEqual(field.value as? String, "shop.example.com/p/1")
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.navigationBars["2 of 4"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts[title].exists, "the same card is on top")
        XCTAssertTrue(app.buttons["Kept 1"].exists)
        // Closing with something kept lists it first, with the way back to the cards.
        app.buttons["swipe.close"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Kept 1' AND label ENDSWITH '3 left.'")).firstMatch.waitForExistence(timeout: 5))
        shot("swipe-stopped")
        app.buttons["swipe.resume"].tap()
        XCTAssertTrue(app.navigationBars["2 of 4"].waitForExistence(timeout: 5))
        app.buttons["swipe.close"].tap()
        app.buttons["swipe.done"].tap()
        // The relaunch put Play back over Home, where the app starts.
        XCTAssertTrue(app.buttons["wishList.link"].waitForExistence(timeout: 5))
    }
}
