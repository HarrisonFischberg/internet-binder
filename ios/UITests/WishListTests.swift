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
}
