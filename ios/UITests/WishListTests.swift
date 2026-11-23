import XCTest

/// Wish List: everything still to buy in one place, with the deals found for each. The demo library
/// (ios/tools/make-wishlist-demo.mjs) carries deals as Find deals leaves them, so nothing here needs a key
/// or the network.
final class WishListTests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "uitest-\(UUID().uuidString)"
        app.launchArguments += ["-importOnLaunch", URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../demo/keepsake-wishlist-demo.json").standardized.path]
        app.launch()
        return app
    }

    func openWishList(_ app: XCUIApplication) {
        let link = app.buttons["wishList.link"]
        XCTAssertTrue(link.waitForExistence(timeout: 10))
        for _ in 0..<6 where !link.isHittable { app.swipeUp() }
        link.tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label ENDSWITH 'from all your collections.'")).firstMatch.waitForExistence(timeout: 5))
    }

    func shot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { return }
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name).png"))
    }

    /// The biggest saving comes first, with its lowest store; the rest of its stores open on a tap.
    func testListsWhatIsLeftToBuyWithItsLowestPrice() {
        let app = launch()
        openWishList(app)
        XCTAssertTrue(app.staticTexts["4 things to buy, from all your collections."].waitForExistence(timeout: 5))
        let lowest = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Brewhaus, $36.99'")).firstMatch
        XCTAssertTrue(lowest.waitForExistence(timeout: 5))
        XCTAssertTrue(lowest.label.hasSuffix("lowest price"), lowest.label)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH '$12.01 less than you saved it at'")).firstMatch.exists)
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Northfield Goods'")).firstMatch.exists, "only the lowest shows until you ask")
        shot("wishlist")
        app.buttons["All 4 stores"].firstMatch.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Northfield Goods, $44.00'")).firstMatch.waitForExistence(timeout: 3))
        // Bought ones never show: the demo's running shoes are marked purchased.
        XCTAssertFalse(app.buttons["Cushioned road running shoes"].exists)
        shot("wishlist-stores")
    }

    /// With no key the list still gathers everything, and says what finding deals needs instead of offering it.
    func testWithoutAKeyItSaysWhatFindingDealsNeeds() {
        let app = launch()
        openWishList(app)
        XCTAssertTrue(app.staticTexts["Finding deals uses your own AI key"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["wishList.find"].exists)
        XCTAssertFalse(app.buttons["wishList.checkAll"].exists)
    }

    /// Hide takes a save off the list, Undo and Put back return it.
    func testHideAndPutBack() {
        let app = launch()
        openWishList(app)
        let more = app.buttons["More for Stoneware mugs, set of 4"]
        XCTAssertTrue(more.waitForExistence(timeout: 5))
        for _ in 0..<4 where !more.isHittable { app.swipeUp() }
        more.tap()
        app.buttons["Hide from Wish List"].tap()
        XCTAssertTrue(app.staticTexts["3 things to buy, from all your collections."].waitForExistence(timeout: 5))
        app.buttons["Undo"].tap()
        XCTAssertTrue(app.staticTexts["4 things to buy, from all your collections."].waitForExistence(timeout: 5))
    }

    /// A price far under the other stores', at a store nobody knows, carries a warning and is never the lowest.
    func testATooGoodPriceIsFlaggedAndNeverTheLowest() {
        let app = launch()
        openWishList(app)
        let lowest = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Hearth & Clay, $64.00'")).firstMatch
        for _ in 0..<4 where !lowest.exists { app.swipeUp() }
        XCTAssertTrue(lowest.waitForExistence(timeout: 5))
        XCTAssertTrue(lowest.label.hasSuffix("lowest price"), lowest.label)
        let all = app.buttons["All 3 stores"].firstMatch
        for _ in 0..<4 where !all.isHittable { app.swipeUp() }
        all.tap()
        let doubted = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Mega Bargains, $29.00'")).firstMatch
        XCTAssertTrue(doubted.waitForExistence(timeout: 3))
        XCTAssertFalse(doubted.label.hasSuffix("lowest price"), doubted.label)
        XCTAssertTrue((doubted.value as? String ?? "").contains("Unusually low"), String(describing: doubted.value))
        shot("wishlist-too-good")
    }

    /// "Not the same item" takes a store's price away, the next one becomes the lowest, and Undo brings it back.
    func testNotTheSameItemRemovesAStoreAndUndoRestoresIt() {
        let app = launch()
        openWishList(app)
        let brewhaus = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Brewhaus, $36.99'")).firstMatch
        XCTAssertTrue(brewhaus.waitForExistence(timeout: 5))
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'More for Brewhaus'")).firstMatch.tap()
        shot("wishlist-offer-menu")
        app.buttons["Not the same item"].tap()
        let next = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Kitchen & Table, $41.50'")).firstMatch
        XCTAssertTrue(next.waitForExistence(timeout: 5))
        XCTAssertTrue(next.label.hasSuffix("lowest price"), next.label)
        XCTAssertFalse(brewhaus.exists)
        app.buttons["Undo"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Brewhaus, $36.99'")).firstMatch.waitForExistence(timeout: 5))
    }

    /// The row says what was priced; Fix lets you name the exact product, which the next search uses.
    func testNamingTheExactProduct() {
        let app = launch()
        openWishList(app)
        let priced = app.buttons["wishList.pricedAs"].firstMatch
        XCTAssertTrue(priced.waitForExistence(timeout: 5))
        XCTAssertEqual(priced.label, "Priced as Glass pour-over coffee maker, 6 cup")
        priced.tap()
        let field = app.textFields["wishList.nameField"].exists ? app.textFields["wishList.nameField"] : app.textViews["wishList.nameField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        shot("wishlist-name")
        field.typeText(" in smoke grey")
        app.buttons["wishList.nameSave"].tap()
        // Prices found under the old name are cleared, and the row shows the words the next search uses.
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Searching as: Glass pour-over coffee maker, 6 cup in smoke grey'")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Brewhaus'")).firstMatch.exists)
    }

    /// The same prices and controls sit on the product's own page.
    func testASavesOwnPageShowsItsPrices() {
        let app = launch()
        openWishList(app)
        let save = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Glass pour-over coffee maker, 6 cup, Saved at'")).firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        save.tap()
        XCTAssertTrue(app.staticTexts["Prices at other stores"].waitForExistence(timeout: 5))
        let lowest = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Brewhaus, $36.99'")).firstMatch
        for _ in 0..<3 where !lowest.exists { app.swipeUp() }
        XCTAssertTrue(lowest.exists)
        XCTAssertTrue(lowest.label.hasSuffix("lowest price"), lowest.label)
        XCTAssertTrue(app.buttons["All 4 stores"].exists)
        shot("save-prices")
    }

    /// The button at the top right of something to buy: the ways to give it more to go on, with the
    /// sheet where a store link is pasted.
    func testImproveMenuOffersAProductLink() {
        let app = launch()
        openWishList(app)
        let save = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Glass pour-over coffee maker, 6 cup, Saved at'")).firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        save.tap()
        let improve = app.buttons["save.improve"].firstMatch
        XCTAssertTrue(improve.waitForExistence(timeout: 5))
        improve.tap()
        XCTAssertTrue(app.buttons["Name the Exact Product…"].waitForExistence(timeout: 5))
        shot("save-improve-menu")
        app.buttons["Add Product Link…"].tap()
        XCTAssertTrue(app.textFields["productLink.field"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["productLink.add"].isEnabled)
        shot("save-product-link")
    }

    /// Where you say which product it is also takes a link: the button then reads that page.
    func testNamingAProductTakesALink() {
        let app = launch()
        openWishList(app)
        let save = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Glass pour-over coffee maker, 6 cup'")).firstMatch
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        save.tap()
        let improve = app.buttons["save.improve"].firstMatch
        XCTAssertTrue(improve.waitForExistence(timeout: 5))
        improve.tap()
        app.buttons["Name the Exact Product…"].tap()
        let field = app.textFields["wishList.nameField"].exists ? app.textFields["wishList.nameField"] : app.textViews["wishList.nameField"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.press(forDuration: 1.2)
        if app.menuItems["Select All"].waitForExistence(timeout: 2) { app.menuItems["Select All"].tap() }
        field.typeText("https://brewhaus.example.com/pour-over")
        XCTAssertTrue(app.buttons["Read this page"].waitForExistence(timeout: 5))
        shot("name-with-link")
    }
}
