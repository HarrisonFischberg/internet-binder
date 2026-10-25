import XCTest

/// What sorting learned from your moves: Settings → What it learned, and a collection's Edit sheet with
/// the words that already file saves there (tap one and it joins Keywords). Seeded with
/// demo/keepsake-learned-demo.json (ios/tools/make-learned-demo.mjs: the demo library after three moves).
/// Screenshots go to KEEPSAKE_SHOTS when it's set.
final class LearnedWordsTests: XCTestCase {
    let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-learned-demo.json").standardized.path

    func shoot(_ name: String) {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { return }
        sleep(1)
        try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(name).png"))
    }

    func launch(_ mode: String) -> XCUIApplication {
        XCUIDevice.shared.appearance = mode == "dark" ? .dark : .light
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "uitest-\(UUID().uuidString)"
        app.launchArguments += ["-importOnLaunch", fixture, "-ksMode", mode]
        app.launch()
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10))
        return app
    }

    override func tearDown() { XCUIDevice.shared.appearance = .light }

    func testWhatItLearned() throws {
        for mode in ["light", "dark"] {
            let app = launch(mode)
            app.buttons["Settings"].tap()
            let link = app.buttons["What it learned"]
            for _ in 0..<8 where !link.isHittable { app.swipeUp() }
            link.tap()
            XCTAssertTrue(app.staticTexts["desk lamp goes to Home Decor"].waitForExistence(timeout: 5))
            shoot("\(mode)-settings-what-it-learned")
            let shop = app.descendants(matching: .any)["design.example.com goes to Home Decor"]
            for _ in 0..<6 where !shop.exists { app.swipeUp() }
            XCTAssertTrue(shop.exists, "shops aren't listed")
            XCTAssertTrue(app.buttons["Clear what it learned"].exists)
            shoot("\(mode)-settings-what-it-learned-shops")
            if mode == "light" {
                // Swipe a word away, then Undo brings it back.
                let mug = app.staticTexts["mug goes to Coffee corner"]
                for _ in 0..<6 where !mug.isHittable { app.swipeDown() }
                mug.swipeLeft()
                app.buttons["Forget"].tap()
                XCTAssertTrue(app.buttons["Undo"].waitForExistence(timeout: 3))
                XCTAssertFalse(mug.exists, "still listed after Forget")
                shoot("light-settings-forgot-word")
                app.buttons.matching(identifier: "Undo").allElementsBoundByIndex.first { $0.isHittable }?.tap()
                XCTAssertTrue(mug.waitForExistence(timeout: 3), "Undo didn't bring it back")
            }
            app.terminate()
        }
    }

    func testAlreadyFilesSavesHere() throws {
        for mode in ["light", "dark"] {
            let app = launch(mode)
            app.buttons["Collections"].tap()
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Home Decor'")).firstMatch.tap()
            app.buttons["Edit"].tap()
            let chip = app.buttons["Add desk lamp to keywords"]
            XCTAssertTrue(chip.waitForExistence(timeout: 5))
            XCTAssertTrue(app.staticTexts["Already files saves here"].exists || app.staticTexts["ALREADY FILES SAVES HERE"].exists)
            let keywords = app.textViews.firstMatch.exists ? app.textViews.firstMatch : app.textFields.element(boundBy: 1)
            XCTAssertFalse((keywords.value as? String ?? "").contains("desk lamp"))
            shoot("\(mode)-edit-collection-before")
            chip.tap()
            XCTAssertTrue((keywords.value as? String ?? "").contains("desk lamp"), "chip didn't add to Keywords")
            XCTAssertFalse(app.buttons["Add desk lamp to keywords"].exists, "added word still offered")
            shoot("\(mode)-edit-collection-after")
            app.terminate()
        }
    }
}
