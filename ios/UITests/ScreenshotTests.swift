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
        let themes = env["KEEPSAKE_SHOT_THEMES"]?.split(separator: ",").map(String.init) ?? ["nocturne", "paper", "chromatic"]
        let modes: [XCUIDevice.Appearance] = (env["KEEPSAKE_SHOT_MODES"] ?? "light,dark").split(separator: ",").map { $0 == "dark" ? .dark : .light }
        let regular = UIDevice.current.userInterfaceIdiom == .pad   // iPad: sidebar, not tabs
        for theme in themes {
            for mode in modes {
                XCUIDevice.shared.appearance = mode
                let tag = "\(theme)-\(mode == .dark ? "dark" : "light")"
                let app = XCUIApplication()
                app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
                // The simulator doesn't always take XCUIDevice's appearance, so the app is told too.
                app.launchArguments += ["-importOnLaunch", fixture, "-ksTheme", theme, "-ksMode", mode == .dark ? "dark" : "light"]
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
                _ = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Portugal'")).firstMatch.waitForExistence(timeout: 5)
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
            let tag = "nocturne-\(mode == .dark ? "dark" : "light")"
            let app = XCUIApplication()
            app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
            app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", "nocturne"]
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
            let tag = "nocturne-\(mode == .dark ? "dark" : "light")"
            let app = XCUIApplication()
            app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
            app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", "nocturne"]
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

    /// A book and a show after AI read them: the cover, the AI summary, the facts and Where to watch.
    /// Nocturne, seeded with the demo library plus Walden and Severance.
    func testShelfScreens() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-shelf-demo.json").standardized.path
        let themes = ProcessInfo.processInfo.environment["KEEPSAKE_SHOT_THEMES"]?.split(separator: ",").map(String.init) ?? ["nocturne"]
        for theme in themes {
            for mode in [XCUIDevice.Appearance.light, .dark] {
                XCUIDevice.shared.appearance = mode
                let tag = "\(theme)-\(mode == .dark ? "dark" : "light")"
                let app = XCUIApplication()
                app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
                app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", theme, "-ksMode", mode == .dark ? "dark" : "light"]
                // Each save from a fresh launch: Library, then its search (the kind stacks scroll sideways).
                for (title, name) in [("Walden", "book"), ("Severance", "show")] {
                    app.launch()
                    XCTAssertTrue(app.tabBars.buttons["Library"].waitForExistence(timeout: 10))
                    app.tabBars.buttons["Library"].tap()
                    let search = app.textFields.firstMatch
                    XCTAssertTrue(search.waitForExistence(timeout: 5))
                    search.tap()
                    search.typeText(title)
                    let save = card(app, title)
                    XCTAssertTrue(save.waitForExistence(timeout: 5))
                    save.tap()
                    XCTAssertTrue(app.staticTexts["AI summary"].waitForExistence(timeout: 5))
                    sleep(2)   // the cover loads
                    try shoot(app, folder, "\(tag)-\(name)")
                    app.swipeUp()
                    try shoot(app, folder, "\(tag)-\(name)-scrolled")
                    app.terminate()
                }
            }
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
        // The app asks once whether "Saved to …" notifications may show; allow it for the end of this test.
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Allow"]
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 10))
        sleep(3)
        app.terminate()
        for mode in [XCUIDevice.Appearance.light, .dark] {
            XCUIDevice.shared.appearance = mode
            let tag = "nocturne-\(mode == .dark ? "dark" : "light")"
            let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
            safari.launch()
            safari.open(URL(string: "https://example.com/?shot=\(UUID().uuidString.prefix(6))")!)
            sleep(4)
            safari.buttons["MoreMenuButton"].tap()   // Safari's Page Menu holds Share
            let shareItem = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Share'")).firstMatch
            XCTAssertTrue(shareItem.waitForExistence(timeout: 5))
            shareItem.tap()
            sleep(2)
            let keepsake = safari.descendants(matching: .any).matching(NSPredicate(format: "label == 'Binder'")).firstMatch
            XCTAssertTrue(keepsake.waitForExistence(timeout: 5), "Binder in the share sheet")
            keepsake.tap()
            let collections = safari.buttons["Collections"].firstMatch
            XCTAssertTrue(collections.waitForExistence(timeout: 10))
            // It stays open until Done or Undo (it used to drop a moment after it appeared).
            sleep(5)
            XCTAssertTrue(collections.exists, "the share sheet closed by itself")
            try shoot(safari, folder, "\(tag)-share-libraries")
            // A swipe down doesn't close it either.
            safari.buttons["Done"].firstMatch.swipeDown()
            sleep(1)
            XCTAssertTrue(collections.exists, "a swipe down closed the share sheet")
            collections.tap()
            sleep(2)
            try shoot(safari, folder, "\(tag)-share-collections")
            safari.buttons.matching(NSPredicate(format: "label == 'Back' AND identifier != 'BackButton'")).firstMatch.tap()   // the card's, not Safari's
            safari.buttons["Lifestyle"].firstMatch.tap()
            sleep(2)
            try shoot(safari, folder, "\(tag)-share-lifestyle")
            guard mode == .dark else {
                // Not sure: the Review card files it in one tap and wears the check. A new save starts in
                // Review, so it goes into the first collection first, or the tap would change nothing.
                safari.buttons.matching(NSPredicate(format: "label == 'Back' AND identifier != 'BackButton'")).firstMatch.tap()
                collections.tap()
                sleep(2)
                safari.scrollViews.buttons.element(boundBy: 1).tap()   // the first collection (after New collection)
                sleep(2)
                let review = safari.buttons["Review"].firstMatch
                XCTAssertTrue(review.waitForExistence(timeout: 5))
                XCTAssertFalse(review.isSelected, "Review still picked after filing it in a collection")
                try shoot(safari, folder, "\(tag)-share-review-unpicked")
                review.tap()
                sleep(1)
                XCTAssertTrue(review.isSelected, "Review card didn't take the save")
                try shoot(safari, folder, "\(tag)-share-review")
                safari.buttons["Undo"].firstMatch.tap()
                safari.terminate()
                continue
            }
            // Put it in the first Lifestyle view, then Done: "Saved to …" drops in from the top, and
            // tapping it opens that save in Internet Binder.
            let firstView = safari.scrollViews.buttons.firstMatch
            XCTAssertTrue(firstView.waitForExistence(timeout: 5))
            firstView.tap()
            sleep(1)
            safari.buttons["Done"].firstMatch.tap()
            XCTAssertTrue(collections.waitForNonExistence(timeout: 5), "Done didn't close the share sheet")
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let banner = springboard.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Saved to'")).firstMatch
            XCTAssertTrue(banner.waitForExistence(timeout: 10), "no Saved to notification")
            try shoot(springboard, folder, "\(tag)-share-notice")
            banner.tap()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
            XCTAssertTrue(app.navigationBars.buttons.element(boundBy: 0).waitForExistence(timeout: 10))
            sleep(1)
            XCTAssertFalse(app.tabBars.buttons["Home"].isHittable, "the save didn't open")
            try shoot(app, folder, "\(tag)-share-notice-opened")
            app.terminate()
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
        let themes = env["KEEPSAKE_SHOT_THEMES"]?.split(separator: ",").map(String.init) ?? ["nocturne", "paper", "chromatic"]
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
    /// in every appearance, plus Paper & Ink at an accessibility text size.
    func testCookingSteps() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let env = ProcessInfo.processInfo.environment
        let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path
        let themes = env["KEEPSAKE_SHOT_THEMES"]?.split(separator: ",").map(String.init) ?? ["nocturne", "paper", "chromatic"]
        var runs: [(String, XCUIDevice.Appearance, String?)] = themes.flatMap { [($0, .light, nil), ($0, .dark, nil)] }
        if themes.contains("paper") { runs.append(("paper", .light, "UICTContentSizeCategoryAccessibilityL")) }
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

    /// The Appearance sheet (Nocturne and Paper & Ink) and the Search tab.
    func testAppearanceAndSearch() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path
        for mode in [XCUIDevice.Appearance.light, .dark] {
            XCUIDevice.shared.appearance = mode
            let tag = "iphone-\(mode == .dark ? "dark" : "light")"
            let app = XCUIApplication()
            app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
            app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", "nocturne"]
            app.launch()
            XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 10))
            sleep(2)
            try shoot(app, folder, "\(tag)-home")
            app.buttons["Appearance"].tap()
            sleep(2)
            try shoot(app, folder, "\(tag)-pantry-appearance")
            app.swipeUp()
            try shoot(app, folder, "\(tag)-pantry-appearance-styles")
            let notebook = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Paper & Ink.'")).firstMatch
            notebook.tap()
            sleep(1)
            try shoot(app, folder, "\(tag)-notebook-appearance-styles")
            for _ in 0..<3 { app.swipeUp() }
            sleep(1)
            try shoot(app, folder, "\(tag)-notebook-appearance-icons")
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Nocturne.'")).firstMatch.tap()
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

    /// Select mode, the long-press menu and swipe to delete (replica/m3/screens/selection): Nocturne,
    /// light and dark, on the demo library. On iPad: a collection in Select mode.
    func testSelectionScreens() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path
        let regular = UIDevice.current.userInterfaceIdiom == .pad
        let modes = (ProcessInfo.processInfo.environment["KEEPSAKE_SHOT_MODES"] ?? (regular ? "light" : "light,dark")).split(separator: ",").map(String.init)
        for mode in modes {
            let tag = "nocturne-\(mode)"
            let app = XCUIApplication()
            app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
            app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", "nocturne", "-ksMode", mode]
            app.launch()
            XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 10))
            sleep(2)   // pictures load
            if regular {
                app.cells.containing(.staticText, identifier: "Kitchen").firstMatch.tap()
                XCTAssertTrue(card(app, "Stoneware mugs").waitForExistence(timeout: 5))
                app.buttons["Select"].tap()
                card(app, "Stoneware mugs").tap()
                XCTAssertTrue(app.staticTexts["1 save selected"].waitForExistence(timeout: 3))
                try shoot(app, folder, "ipad-\(tag)-collection-select")
                app.terminate()
                continue
            }
            // A Lifestyle view in Select mode, one ticked.
            app.tabBars.buttons["Library"].tap()
            openRecipes(app)
            XCTAssertTrue(card(app, "Spaghetti alla carbonara").waitForExistence(timeout: 5))
            app.buttons["Select"].tap()
            card(app, "Spaghetti alla carbonara").tap()
            XCTAssertTrue(app.staticTexts["1 save selected"].waitForExistence(timeout: 3))
            try shoot(app, folder, "\(tag)-recipes-select")
            // Everything ticked, to the Trash: the toast, then Undo.
            app.buttons["Select all"].tap()
            app.buttons["Move 4 to Trash"].tap()
            XCTAssertTrue(app.staticTexts["Moved 4 saves to Trash"].waitForExistence(timeout: 5))
            try shoot(app, folder, "\(tag)-bulk-delete-toast")
            app.buttons["Undo"].tap()
            // The long-press menu on a card.
            let shakshuka = card(app, "Shakshuka")
            XCTAssertTrue(shakshuka.waitForExistence(timeout: 5))
            shakshuka.press(forDuration: 1.0)
            XCTAssertTrue(app.buttons["Move to Trash"].waitForExistence(timeout: 3))
            try shoot(app, folder, "\(tag)-card-menu")
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.06)).tap()
            app.navigationBars.buttons.element(boundBy: 0).tap()
            // Collections, two ticked.
            app.tabBars.buttons["Home"].tap()
            app.buttons["Collections"].tap()
            XCTAssertTrue(app.staticTexts["For things to buy"].waitForExistence(timeout: 5))
            sleep(1)
            app.buttons["Select"].tap()
            app.buttons["Collection Kitchen"].tap()
            app.buttons["Collection Home Decor"].tap()
            XCTAssertTrue(app.staticTexts["2 collections selected"].waitForExistence(timeout: 3))
            try shoot(app, folder, "\(tag)-collections-select")
            app.terminate()
        }
    }

    /// Places for the selection screens: the header's Select, then a row half-swiped to show Delete.
    func testSelectionPlacesScreens() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/keepsake-demo.json").standardized.path
        for mode in (ProcessInfo.processInfo.environment["KEEPSAKE_SHOT_MODES"] ?? "light,dark").split(separator: ",").map(String.init) {
            let tag = "nocturne-\(mode)"
            let app = XCUIApplication()
            app.launchEnvironment["KEEPSAKE_DB"] = "shots-\(UUID().uuidString)"
            app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", "nocturne", "-ksMode", mode]
            app.launch()
            XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 10))
            app.tabBars.buttons["Places"].tap()
            var row = app.staticTexts["Tartine Bakery"]
            if !row.waitForExistence(timeout: 3) {
                app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Review'")).firstMatch.tap()
                row = app.staticTexts["Tartine Bakery"]
            }
            XCTAssertTrue(row.waitForExistence(timeout: 5))
            sleep(1)
            try shoot(app, folder, "\(tag)-places-header")
            // A sideways drag from the row's right side, released short of a full swipe: Delete stays open.
            let y = row.frame.midY, w = app.windows.firstMatch.frame.width
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let from = origin.withOffset(CGVector(dx: w * 0.8, dy: y))
            from.press(forDuration: 0.01, thenDragTo: from.withOffset(CGVector(dx: -130, dy: 0)), withVelocity: 400, thenHoldForDuration: 0.2)
            XCTAssertTrue(app.buttons["Move to Trash"].waitForExistence(timeout: 3), "Delete shows behind the row")
            try shoot(app, folder, "\(tag)-places-swipe")
            app.terminate()
        }
    }

    /// App Store screens from ios/demo/store-demo.json (made-up shops, places and titles; original art):
    /// Home, Lifestyle, Library, a recipe, cooking, Places on the map, a workout goal and Review in Pantry
    /// Pop light, then Home in every style, light and dark. Files are store-<screen>.png.
    func testStoreScreens() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/store-demo.json").standardized.path
        let regular = UIDevice.current.userInterfaceIdiom == .pad   // iPad: sidebar, not tabs
        func launch(_ theme: String = "nocturne", _ mode: String = "light") -> XCUIApplication {
            XCUIDevice.shared.appearance = mode == "dark" ? .dark : .light
            let app = XCUIApplication()
            app.launchEnvironment["KEEPSAKE_DB"] = "store-\(UUID().uuidString)"
            app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", theme, "-ksMode", mode]
            app.launch()
            XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 10))
            sleep(2)   // pictures load
            return app
        }
        func go(_ app: XCUIApplication, _ tab: String) {
            if regular { app.cells.containing(.staticText, identifier: tab).firstMatch.tap() } else { app.tabBars.buttons[tab].tap() }
            sleep(1)
        }
        func find(_ app: XCUIApplication, _ title: String) {
            go(app, "Search")
            let field = app.searchFields.firstMatch.exists ? app.searchFields.firstMatch : app.textFields.firstMatch
            XCTAssertTrue(field.waitForExistence(timeout: 5))
            field.tap()
            field.typeText(title)
            let save = card(app, title)
            XCTAssertTrue(save.waitForExistence(timeout: 5))
            save.tap()
        }

        var app = launch()
        try shoot(app, folder, "store-home")
        app.buttons["Lifestyle"].tap()
        sleep(1)
        try shoot(app, folder, "store-lifestyle")
        go(app, "Library")
        try shoot(app, folder, "store-library")
        go(app, "Places")
        try shoot(app, folder, "store-places")
        app.buttons["Map"].firstMatch.tap()
        sleep(4)   // map tiles
        try shoot(app, folder, "store-places-map")
        app.terminate()

        app = launch()
        find(app, "Smoky shakshuka")
        XCTAssertTrue(app.buttons["Start cooking"].waitForExistence(timeout: 5))
        sleep(1)
        try shoot(app, folder, "store-recipe")
        app.buttons["Start cooking"].tap()
        XCTAssertTrue(app.buttons["Next step"].waitForExistence(timeout: 5))
        app.buttons["Next step"].tap()
        sleep(1)
        try shoot(app, folder, "store-cooking")
        app.terminate()

        app = launch()
        find(app, "Kettlebell full body")
        XCTAssertTrue(app.buttons["Done today"].waitForExistence(timeout: 5))
        sleep(1)
        try shoot(app, folder, "store-workout")
        app.terminate()

        app = launch()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH '2 saves need a collection'")).firstMatch.tap()
        sleep(1)
        try shoot(app, folder, "store-review")
        app.terminate()

        for theme in ["nocturne", "paper", "chromatic"] {
            for mode in ["light", "dark"] {
                app = launch(theme, mode)
                try shoot(app, folder, "store-home-\(theme)-\(mode)")
                app.terminate()
            }
        }
        XCUIDevice.shared.appearance = .light
    }

    /// The brand kit's five surfaces in each appearance, from ios/demo/store-demo.json: Home, Library,
    /// Places list, Places map (and a selected place), Search (empty, a query, a kind filter), plus the
    /// Appearance sheet. KEEPSAKE_SHOT_SIZE (a content size category) shoots them at that text size.
    /// Files are brand-<theme>-<screen>.png.
    func testBrandSurfaces() throws {
        guard let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] else { throw XCTSkip("set KEEPSAKE_SHOTS to a folder") }
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        let env = ProcessInfo.processInfo.environment
        let demo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../demo/store-demo.json").standardized.path
        let themes = env["KEEPSAKE_SHOT_THEMES"]?.split(separator: ",").map(String.init) ?? ["nocturne", "paper", "chromatic"]
        let size = env["KEEPSAKE_SHOT_SIZE"]
        for theme in themes {
            let tag = "brand-\(theme)" + (size.map { "-\($0.replacingOccurrences(of: "UICTContentSizeCategory", with: ""))" } ?? "")
            let app = XCUIApplication()
            app.launchEnvironment["KEEPSAKE_DB"] = "brand-\(UUID().uuidString)"
            app.launchArguments += ["-importOnLaunch", demo, "-ksTheme", theme]
            if let size { app.launchArguments += ["-UIPreferredContentSizeCategoryName", size] }
            app.launch()
            XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 10))
            sleep(2)   // pictures load
            try shoot(app, folder, "\(tag)-home")
            app.swipeUp()
            try shoot(app, folder, "\(tag)-home-lower")
            app.tabBars.buttons["Library"].tap()
            sleep(1)
            try shoot(app, folder, "\(tag)-library")
            app.swipeUp()
            try shoot(app, folder, "\(tag)-library-lower")
            app.tabBars.buttons["Places"].tap()
            sleep(1)
            try shoot(app, folder, "\(tag)-places-list")
            app.buttons["Map"].firstMatch.tap()
            sleep(4)   // map tiles
            try shoot(app, folder, "\(tag)-places-map")
            let pin = app.buttons["Lantern Coffee"].firstMatch
            if !pin.exists || !pin.isHittable {
                let cluster = app.buttons.matching(NSPredicate(format: "label ENDSWITH ' places'")).firstMatch
                if cluster.exists { cluster.tap(); sleep(3) }
            }
            if pin.exists && pin.isHittable {
                pin.tap()
                sleep(1)
                try shoot(app, folder, "\(tag)-places-map-selected")
            }
            app.buttons["List"].firstMatch.tap()
            app.tabBars.buttons["Search"].tap()
            sleep(1)
            try shoot(app, folder, "\(tag)-search")
            let field = app.textFields["Search your saves"]
            if field.waitForExistence(timeout: 3) {
                field.tap()
                field.typeText("coffee")
                sleep(2)
                try shoot(app, folder, "\(tag)-search-query")
                field.typeText("zqx")
                sleep(1)
                try shoot(app, folder, "\(tag)-search-empty")
                app.buttons["Cancel"].tap()
            }
            let recipes = app.buttons["Recipes"].firstMatch
            if recipes.waitForExistence(timeout: 3) {
                recipes.tap()
                sleep(1)
                try shoot(app, folder, "\(tag)-search-filter")
            }
            app.tabBars.buttons["Home"].tap()
            app.buttons["Appearance"].tap()
            sleep(1)
            try shoot(app, folder, "\(tag)-appearance")
            app.terminate()
        }
    }
}
