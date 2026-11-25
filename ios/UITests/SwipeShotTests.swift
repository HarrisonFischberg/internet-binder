import XCTest

/// Screenshot of a card mid-swipe (only when KEEPSAKE_SHOTS is set).
final class SwipeShotTests: XCTestCase {
    func testMidSwipe() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("no shots folder") }
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "uitest-\(UUID().uuidString)"
        app.launchArguments += ["-importOnLaunch", URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../demo/keepsake-wishlist-demo.json").standardized.path]
        app.launch()
        let link = app.buttons["wishList.link"]
        XCTAssertTrue(link.waitForExistence(timeout: 10))
        for _ in 0..<6 where !link.isHittable { app.swipeUp() }
        link.tap()
        app.buttons["swipe.play"].tap()
        XCTAssertTrue(app.navigationBars["1 of 4"].waitForExistence(timeout: 5))
        for (name, dx) in [("keep", 0.45), ("trash", -0.45)] {
            let from = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
            let to = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5 + dx, dy: 0.4))
            let shot = expectation(description: name)
            DispatchQueue.global().asyncAfter(deadline: .now() + 1.6) {
                try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("swipe-mid-\(name).png"))
                shot.fulfill()
            }
            from.press(forDuration: 0.1, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 2.5)
            wait(for: [shot], timeout: 10)
        }
    }
}
