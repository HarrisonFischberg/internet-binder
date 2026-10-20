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

    /// The Library's Recipes, reached through its Lifestyle stack: the kind chips run off the screen's
    /// edge, so a chip far along the row is not on screen to tap.
    func openRecipes(_ app: XCUIApplication) {
        let recipes = card(app, "Recipes,")
        for _ in 0..<5 where !(recipes.exists && recipes.isHittable) { app.swipeUp() }
        recipes.tap()
    }

    func testEveryScreenEveryTheme() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let env = ProcessInfo.processInfo.environment
        let themes = env["KEEPSAKE_SHOT_THEMES"]?.split(separator: ",").map(String.init) ?? ["pantry", "notebook", "atlas", "swiss"]
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
                openRecipes(app)
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
            let tag = "pantry-\(mode == .dark ? "dark" : "light")"
            let app = XCUIApplication()
            app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
            app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", "pantry"]
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

    /// A save's own buttons: Home, the Library, a recipe, a product in a collection (Purchased and Share),
    /// and the 🎉 just after a stamp. Postcard, light and dark, seeded with the demo library.
    func testCardScreens() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path
        for mode in [XCUIDevice.Appearance.light, .dark] {
            XCUIDevice.shared.appearance = mode
            let tag = "pantry-\(mode == .dark ? "dark" : "light")"
            let app = XCUIApplication()
            app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
            app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", "pantry"]
            app.launch()
            XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 10))
            sleep(2)   // pictures load
            try shoot(app, folder, "\(tag)-home")
            app.tabBars.buttons["Library"].tap()
            sleep(1)
            try shoot(app, folder, "\(tag)-library")
            let recipes = card(app, "Recipes,")
            for _ in 0..<4 where !recipes.isHittable { app.swipeUp() }
            recipes.tap()
            card(app, "Spaghetti alla carbonara").tap()
            XCTAssertTrue(app.buttons["Cooked"].waitForExistence(timeout: 5))
            try shoot(app, folder, "\(tag)-recipe")
            app.buttons["Cooked"].tap()
            usleep(450_000)   // the 🎉 has landed; it leaves after 1.3 s
            try XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(tag)-cooked-toast.png"))
            app.buttons["Cooked, done"].tap()   // leave the demo as it was
            app.navigationBars.buttons.element(boundBy: 0).tap()
            app.navigationBars.buttons.element(boundBy: 0).tap()
            let kitchen = card(app, "Kitchen,")
            for _ in 0..<4 where !kitchen.isHittable { app.swipeDown() }
            kitchen.tap()
            card(app, "Stoneware mugs").tap()
            XCTAssertTrue(app.buttons["Purchased"].waitForExistence(timeout: 5))
            sleep(1)
            try shoot(app, folder, "\(tag)-product")
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
            let tag = "pantry-\(mode == .dark ? "dark" : "light")"
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

    /// Every style, light and dark, from the demo library: Home, Review, Library, a recipe, Places and
    /// Appearance. Files are <style>-<mode>-<screen>.png; KEEPSAKE_SHOT_THEMES picks the styles.
    func testStyles() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let env = ProcessInfo.processInfo.environment
        let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path
        let themes = env["KEEPSAKE_SHOT_THEMES"]?.split(separator: ",").map(String.init) ?? ["pantry", "notebook", "atlas", "swiss"]
        let modes: [XCUIDevice.Appearance] = (env["KEEPSAKE_SHOT_MODES"] ?? "light,dark").split(separator: ",").map { $0 == "dark" ? .dark : .light }
        let regular = UIDevice.current.userInterfaceIdiom == .pad
        let device = regular ? "ipad" : "iphone"
        func go(_ app: XCUIApplication, _ section: String) {
            if regular { app.cells.containing(.staticText, identifier: section).firstMatch.tap() } else { app.tabBars.buttons[section].tap() }
        }
        func back(_ app: XCUIApplication) { app.navigationBars.buttons.element(boundBy: 0).tap() }
        for theme in themes {
            for mode in modes {
                XCUIDevice.shared.appearance = mode
                let tag = "\(device)-\(theme)-\(mode == .dark ? "dark" : "light")"
                let app = XCUIApplication()
                app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
                app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", theme]
                app.launch()
                XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 10))
                sleep(2)   // pictures load
                try shoot(app, folder, "\(tag)-home")
                let nudge = app.buttons.matching(NSPredicate(format: "label CONTAINS 'need a collection' OR label CONTAINS 'needs a collection'")).firstMatch
                if nudge.exists && !regular {   // iPad has Review in its sidebar
                    nudge.tap()
                    sleep(1)
                    try shoot(app, folder, "\(tag)-review")
                    back(app)
                }
                go(app, "Library")
                sleep(1)
                try shoot(app, folder, "\(tag)-library")
                if regular { go(app, "Recipes") } else { openRecipes(app) }
                sleep(1)
                try shoot(app, folder, "\(tag)-library-recipes")
                card(app, "Spaghetti alla carbonara").tap()
                XCTAssertTrue(app.buttons["Start cooking"].waitForExistence(timeout: 5))
                sleep(1)
                try shoot(app, folder, "\(tag)-recipe")
                app.swipeUp()
                try shoot(app, folder, "\(tag)-recipe-scrolled")
                if !regular { back(app) }
                go(app, "Places")
                sleep(2)
                try shoot(app, folder, "\(tag)-places")
                app.terminate()
            }
        }
        XCUIDevice.shared.appearance = .light
    }

    /// Cooking with each step's ingredients (carbonara): step 2 with two checked, and the last step,
    /// in every style, light and dark, plus Field Notebook at an accessibility text size.
    func testCookingSteps() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let env = ProcessInfo.processInfo.environment
        let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path
        let themes = env["KEEPSAKE_SHOT_THEMES"]?.split(separator: ",").map(String.init) ?? ["pantry", "notebook", "atlas", "swiss"]
        var runs: [(String, XCUIDevice.Appearance, String?)] = themes.flatMap { [($0, .light, nil), ($0, .dark, nil)] }
        if themes.contains("notebook") { runs.append(("notebook", .light, "UICTContentSizeCategoryAccessibilityL")) }
        for (theme, mode, size) in runs {
            XCUIDevice.shared.appearance = mode
            let tag = "\(theme)-\(mode == .dark ? "dark" : "light")\(size == nil ? "" : "-large-text")"
            let app = XCUIApplication()
            app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
            // The simulator doesn't always take XCUIDevice's appearance, so the app is told too.
            app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", theme, "-ksMode", mode == .dark ? "dark" : "light"]
            if let size { app.launchArguments += ["-UIPreferredContentSizeCategoryName", size] }
            app.launch()
            XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 10))
            app.tabBars.buttons["Library"].tap()
            openRecipes(app)
            card(app, "Spaghetti alla carbonara").tap()
            XCTAssertTrue(app.buttons["Start cooking"].waitForExistence(timeout: 5))
            app.buttons["Start cooking"].tap()
            XCTAssertTrue(app.buttons["Next step"].waitForExistence(timeout: 5))
            app.buttons["Next step"].tap()
            sleep(1)
            // The recipe page behind the cover lists the same lines; tap the ones on the step.
            for line in ["3 egg yolks", "50 g pecorino romano, grated"] {
                (app.buttons.matching(identifier: line).allElementsBoundByIndex.first { $0.isHittable } ?? app.buttons[line]).tap()
            }
            sleep(1)
            try shoot(app, folder, "\(tag)-cooking-step2")
            if size == nil {
                app.buttons["Next step"].tap()
                app.buttons["Next step"].tap()
                sleep(1)
                try shoot(app, folder, "\(tag)-cooking-last")
            }
            app.terminate()
        }
        XCUIDevice.shared.appearance = .light
    }

    /// The Appearance sheet (Pantry Pop and Field Notebook) and the Search tab, light and dark.
    func testAppearanceAndSearch() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path
        for mode in [XCUIDevice.Appearance.light, .dark] {
            XCUIDevice.shared.appearance = mode
            let tag = "iphone-\(mode == .dark ? "dark" : "light")"
            let app = XCUIApplication()
            app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
            app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", "pantry"]
            app.launch()
            XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 10))
            sleep(2)
            try shoot(app, folder, "\(tag)-home")
            app.buttons["Appearance"].tap()
            sleep(2)
            try shoot(app, folder, "\(tag)-pantry-appearance")
            app.swipeUp()
            try shoot(app, folder, "\(tag)-pantry-appearance-styles")
            let notebook = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Field Notebook.'")).firstMatch
            notebook.tap()
            sleep(1)
            try shoot(app, folder, "\(tag)-notebook-appearance-styles")
            for _ in 0..<3 { app.swipeUp() }
            sleep(1)
            try shoot(app, folder, "\(tag)-notebook-appearance-icons")
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Pantry Pop.'")).firstMatch.tap()
            for _ in 0..<2 { app.swipeUp() }
            try shoot(app, folder, "\(tag)-pantry-appearance-icons")
            app.buttons["Done"].tap()
            app.tabBars.buttons["Search"].tap()
            sleep(2)
            try shoot(app, folder, "\(tag)-search")
            let field = app.searchFields.firstMatch
            field.tap()
            field.typeText("pasta")
            sleep(2)
            try shoot(app, folder, "\(tag)-search-results")
            app.terminate()
        }
        XCUIDevice.shared.appearance = .light
    }
}
