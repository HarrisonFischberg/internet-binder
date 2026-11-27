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
        // Everything left was kept, so Play offers to go through it again.
        let again = app.buttons["swipe.play"]
        XCTAssertEqual(again.label, "Play Wish List again")
        again.tap()
        XCTAssertTrue(app.navigationBars["1 of 3"].waitForExistence(timeout: 5))
        // Keep one and stop: the next Play starts after it, not from the top again.
        let first = app.staticTexts["swipe.title"].firstMatch.label
        app.buttons["swipe.keep"].tap()
        XCTAssertTrue(app.navigationBars["2 of 3"].waitForExistence(timeout: 3))
        app.buttons["swipe.close"].tap()
        app.buttons["swipe.done"].tap()
        XCTAssertEqual(app.buttons["swipe.play"].label, "Play Wish List")
        app.buttons["swipe.play"].tap()
        XCTAssertTrue(app.navigationBars["1 of 2"].waitForExistence(timeout: 5))
        XCTAssertNotEqual(app.staticTexts["swipe.title"].firstMatch.label, first)
    }

    /// Skip leaves a card for later: it goes without being kept or trashed, Undo brings it back, and it is
    /// first again the next time you play.
    func testSkipLeavesACardForNextTime() {
        let app = launch()
        play(app)
        let first = app.staticTexts["swipe.title"].firstMatch.label
        app.buttons["swipe.skip"].tap()
        XCTAssertTrue(app.navigationBars["2 of 4"].waitForExistence(timeout: 3))
        app.buttons["swipe.undo"].tap()
        XCTAssertTrue(app.navigationBars["1 of 4"].waitForExistence(timeout: 3))
        XCTAssertEqual(app.staticTexts["swipe.title"].firstMatch.label, first)
        app.buttons["swipe.skip"].tap()
        XCTAssertTrue(app.navigationBars["2 of 4"].waitForExistence(timeout: 3))
        for _ in 0..<3 { app.buttons["swipe.keep"].tap(); usleep(500_000) }
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Kept 3. Skipped 1 for next time.'")).firstMatch.waitForExistence(timeout: 5))
        shot("swipe-skipped-end")
        app.buttons["swipe.done"].tap()
        // Only the skipped one is left to decide.
        XCTAssertEqual(app.buttons["swipe.play"].label, "Play Wish List")
        app.buttons["swipe.play"].tap()
        XCTAssertTrue(app.navigationBars["1 of 1"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["swipe.title"].firstMatch.label, first)
    }

    /// A card in the wrong place moves to a new collection from Play, leaves the run, and Undo puts it back.
    func testMoveACardToANewCollection() {
        let app = launch()
        play(app)
        let title = app.staticTexts["swipe.title"].firstMatch.label
        app.buttons["swipe.move"].tap()
        let name = app.textFields["swipe.newCollection"]
        XCTAssertTrue(name.waitForExistence(timeout: 3))
        // Every collection is listed, with how many there are, and the one it's in is marked.
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH[c] 'Your collections (6)'")).firstMatch.exists)
        XCTAssertTrue(app.staticTexts["It's here now"].exists)
        shot("swipe-move-menu")
        name.tap()
        name.typeText("Gift ideas")
        app.buttons["Create"].tap()
        XCTAssertTrue(app.navigationBars["2 of 4"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Moved to Gift ideas, and off your Wish List"].waitForExistence(timeout: 3))
        XCTAssertNotEqual(app.staticTexts["swipe.title"].firstMatch.label, title)
        // The new collection is offered for the next card, and Undo brings the moved one back on top.
        app.buttons["swipe.undo"].tap()
        XCTAssertTrue(app.navigationBars["1 of 4"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["swipe.title"].firstMatch.label, title)
        app.buttons["swipe.move"].tap()
        XCTAssertTrue(app.buttons["Gift ideas"].waitForExistence(timeout: 3))
        app.buttons["Gift ideas"].tap()
        XCTAssertTrue(app.navigationBars["2 of 4"].waitForExistence(timeout: 5))
        for _ in 0..<3 { app.buttons["swipe.keep"].tap(); usleep(500_000) }
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Kept 3. Moved 1 somewhere else.'")).firstMatch.waitForExistence(timeout: 5))
        shot("swipe-moved-end")
        // Moved out of the Wish List's run, it left the Wish List too.
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
        // Hittable, not just there: the card waiting underneath is laid out with its buttons too.
        for _ in 0..<40 where !(recipe.exists && recipe.isHittable) { app.buttons["swipe.keep"].tap(); usleep(400_000) }
        XCTAssertTrue(recipe.exists && recipe.isHittable, "a recipe card offers its own link")
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
