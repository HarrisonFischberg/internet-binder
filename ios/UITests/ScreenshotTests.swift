import XCTest

/// Release-candidate screenshots: every main screen, in every theme, light and dark.
/// Runs only with KEEPSAKE_SHOTS set to a folder; files are named <theme>-<mode>-<screen>.png.
final class ScreenshotTests: XCTestCase {
    let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../KeepsakeKit/Tests/KeepsakeKitTests/Fixtures/chrome-export.json").standardized.path

    func shoot(_ app: XCUIApplication, _ folder: String, _ name: String) throws {
        sleep(1)
        let url = URL(fileURLWithPath: folder).appendingPathComponent("\(name).png")
        try XCUIScreen.main.screenshot().pngRepresentation.write(to: url)
    }

    func card(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
    }

    func testEveryScreenEveryTheme() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let env = ProcessInfo.processInfo.environment
        let themes = env["KEEPSAKE_SHOT_THEMES"]?.split(separator: ",").map(String.init) ?? ["postcard", "linen", "ink"]
        let modes: [XCUIDevice.Appearance] = (env["KEEPSAKE_SHOT_MODES"] ?? "light,dark").split(separator: ",").map { $0 == "dark" ? .dark : .light }
        let regular = UIDevice.current.userInterfaceIdiom == .pad   // iPad: sidebar, not tabs
        for theme in themes {
            for mode in modes {
                XCUIDevice.shared.appearance = mode
                let tag = "\(theme)-\(mode == .dark ? "dark" : "light")"
                let app = XCUIApplication()
                app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
                app.launchArguments += ["-importOnLaunch", fixture, "-ksTheme", theme]
                app.launch()
                XCTAssertTrue(app.staticTexts["1 save needs a collection"].waitForExistence(timeout: 10))
                try shoot(app, folder, "\(tag)-home")
                app.buttons.matching(NSPredicate(format: "label BEGINSWITH '1 save needs a collection'")).firstMatch.tap()
                _ = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'File in'")).firstMatch.waitForExistence(timeout: 5)
                try shoot(app, folder, "\(tag)-review")
                if regular { app.cells.containing(.staticText, identifier: "Library").firstMatch.tap() } else { app.tabBars.buttons["Library"].tap() }
                try shoot(app, folder, "\(tag)-library")
                app.buttons["Recipes"].tap()
                card(app, "Brown butter pasta").tap()
                _ = app.buttons["Start cooking"].waitForExistence(timeout: 5)
                try shoot(app, folder, "\(tag)-recipe")
                app.buttons["Start cooking"].tap()
                _ = app.staticTexts["Step 1 of 3"].waitForExistence(timeout: 5)
                try shoot(app, folder, "\(tag)-cooking")
                app.buttons["Close"].tap()
                if !regular { app.navigationBars.buttons.element(boundBy: 0).tap() }   // the save's screen hides the tabs
                if regular { app.cells.containing(.staticText, identifier: "Places").firstMatch.tap() } else { app.tabBars.buttons["Places"].tap() }
                _ = app.staticTexts["Portugal"].waitForExistence(timeout: 5)
                try shoot(app, folder, "\(tag)-places")
                card(app, "Café Azulejo").tap()
                _ = app.buttons["Directions"].waitForExistence(timeout: 5)
                sleep(2) // map tiles
                try shoot(app, folder, "\(tag)-place")
                app.terminate()
            }
        }
        XCUIDevice.shared.appearance = .light
    }

    /// Home, Lifestyle, Collections and the Library's stacks, seeded with the demo library's photos, light and dark.
    func testGroupsScreens() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path
        for mode in [XCUIDevice.Appearance.light, .dark] {
            XCUIDevice.shared.appearance = mode
            let tag = "postcard-\(mode == .dark ? "dark" : "light")"
            let app = XCUIApplication()
            app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
            app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", "postcard"]
            app.launch()
            XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 10))
            sleep(2)   // pictures load
            try shoot(app, folder, "\(tag)-home")
            app.buttons["Lifestyle"].tap()
            _ = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Places,'")).firstMatch.waitForExistence(timeout: 5)
            sleep(1)
            try shoot(app, folder, "\(tag)-lifestyle")
            app.navigationBars.buttons.element(boundBy: 0).tap()
            app.buttons["Collections"].tap()
            sleep(2)
            try shoot(app, folder, "\(tag)-collections")
            app.navigationBars.buttons.element(boundBy: 0).tap()
            app.tabBars.buttons["Library"].tap()
            sleep(2)
            try shoot(app, folder, "\(tag)-library-all")
            app.buttons["Collections"].firstMatch.tap()
            sleep(2)
            try shoot(app, folder, "\(tag)-library-collections")
            app.terminate()
        }
        XCUIDevice.shared.appearance = .light
    }

    /// The Share Extension's card from Safari: the two libraries, then one library's groups. The extension
    /// writes to the real (App Group) library, so the app first fills it from the demo if it's empty.
    func testShareCard() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path
        let app = XCUIApplication()
        app.launchArguments += ["-importOnLaunch", demo]
        app.launch()
        XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 10))
        sleep(3)
        app.terminate()
        for mode in [XCUIDevice.Appearance.light, .dark] {
            XCUIDevice.shared.appearance = mode
            let tag = "postcard-\(mode == .dark ? "dark" : "light")"
            let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
            safari.launch()
            safari.open(URL(string: "https://example.com/?shot=\(UUID().uuidString.prefix(6))")!)
            sleep(4)
            safari.buttons["MoreMenuButton"].tap()   // Safari's Page Menu holds Share
            let shareItem = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Share'")).firstMatch
            XCTAssertTrue(shareItem.waitForExistence(timeout: 5))
            shareItem.tap()
            sleep(2)
            let keepsake = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Keepsake'")).firstMatch
            XCTAssertTrue(keepsake.waitForExistence(timeout: 5), "Keepsake in the share sheet")
            keepsake.tap()
            let collections = safari.buttons["Collections"].firstMatch
            XCTAssertTrue(collections.waitForExistence(timeout: 10))
            sleep(2)
            try shoot(safari, folder, "\(tag)-share-libraries")
            collections.tap()
            sleep(2)
            try shoot(safari, folder, "\(tag)-share-collections")
            safari.buttons.matching(NSPredicate(format: "label == 'Back' AND identifier != 'BackButton'")).firstMatch.tap()   // the card's, not Safari's
            safari.buttons["Lifestyle"].firstMatch.tap()
            sleep(2)
            try shoot(safari, folder, "\(tag)-share-lifestyle")
            safari.buttons["Undo"].firstMatch.tap()
            safari.terminate()
        }
        XCUIDevice.shared.appearance = .light
    }
}
