import XCTest

/// Raw App Store screenshots from ios/demo/store-demo.json (made-up shops, places and titles; original art).
/// Runs only while store/ios/raw/.capture exists (scripts/store-screenshots.sh creates it), so it never slows
/// down the normal test run. Writes store/ios/raw/<iphone|ipad>/NN-name.png; the order, captions and colours
/// of the framed store images come from store/ios/screenshots.json.
@MainActor
final class AppStoreScreenshotsUITests: XCTestCase {
    private let raw = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().appendingPathComponent("store/ios/raw")
    private let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../demo/store-demo.json").standardized.path
    private let regular = UIDevice.current.userInterfaceIdiom == .pad   // iPad: sidebar, not tabs
    private var folder: URL { raw.appendingPathComponent(regular ? "ipad" : "iphone") }

    private func shoot(_ app: XCUIApplication, _ name: String) throws {
        sleep(1)
        try XCUIScreen.main.screenshot().pngRepresentation.write(to: folder.appendingPathComponent("\(name).png"))
    }

    private func launch(_ theme: String = "nocturne", _ mode: String = "light") -> XCUIApplication {
        XCUIDevice.shared.appearance = mode == "dark" ? .dark : .light
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "appstore-\(UUID().uuidString)"   // a fresh library, no onboarding
        app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", theme, "-ksMode", mode,
                                "-ks.appleAIStatus", "unsupported"]   // no Apple Intelligence notes on the store images
        app.launch()
        XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 15))
        sleep(2)   // pictures load
        return app
    }

    private func card(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    }

    private func go(_ app: XCUIApplication, _ tab: String) {
        if regular { app.cells.containing(.staticText, identifier: tab).firstMatch.tap() } else { app.tabBars.buttons[tab].tap() }
        sleep(1)
    }

    private func find(_ app: XCUIApplication, _ title: String) {
        go(app, "Search")
        let field = app.searchFields.firstMatch.exists ? app.searchFields.firstMatch : app.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(title)
        let save = card(app, title)
        XCTAssertTrue(save.waitForExistence(timeout: 5))
        save.tap()
    }

    override func tearDown() {
        XCUIDevice.shared.appearance = .light
        super.tearDown()
    }

    func testStoreScreenshots() throws {
        try XCTSkipUnless(FileManager.default.fileExists(atPath: raw.appendingPathComponent(".capture").path),
                          "screenshot capture is off")
        continueAfterFailure = false
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        var app = launch()
        try shoot(app, "01-home")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH '2 saves need a collection'")).firstMatch.tap()
        sleep(1)
        try shoot(app, "02-review")
        app.terminate()

        app = launch()
        find(app, "Smoky shakshuka")
        XCTAssertTrue(app.buttons["Start cooking"].waitForExistence(timeout: 5))
        try shoot(app, "03-recipe")
        app.buttons["Start cooking"].tap()
        XCTAssertTrue(app.buttons["Next step"].waitForExistence(timeout: 5))
        app.buttons["Next step"].tap()
        try shoot(app, "04-cooking")
        app.terminate()

        app = launch()
        go(app, "Places")
        app.buttons["Map"].firstMatch.tap()
        sleep(4)   // map tiles
        try shoot(app, "05-places")
        app.terminate()

        app = launch()
        find(app, "Kettlebell full body")
        XCTAssertTrue(app.buttons["Done today"].waitForExistence(timeout: 5))
        try shoot(app, "06-workout")
        app.terminate()

        app = launch("paper", "light")
        try shoot(app, "07-styles")
        app.terminate()
    }
}
