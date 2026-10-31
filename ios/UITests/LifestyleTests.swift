import XCTest

/// M3.3: Places by state with Places review, cooking mode, workout goals and check-ins.
final class LifestyleTests: XCTestCase {
    let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../KeepsakeKit/Tests/KeepsakeKitTests/Fixtures/chrome-export.json").standardized.path

    override func setUp() { continueAfterFailure = false }

    func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "uitest-\(UUID().uuidString)"
        app.launchArguments += ["-importOnLaunch", fixture]
        app.launch()
        return app
    }

    func open(_ app: XCUIApplication, kind chip: String, save title: String) {
        app.tabBars.buttons["Library"].tap()
        let chipButton = app.chip(chip)
        XCTAssertTrue(chipButton.exists)
        chipButton.tap()
        let card = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", title)).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 3))
        card.tap()
    }

    func testLibraryGroupsCollectionsThenLifestyle() {
        let app = launch()
        app.tabBars.buttons["Library"].tap()
        XCTAssertTrue(app.staticTexts["Lifestyle"].waitForExistence(timeout: 5))
        let collections = app.header("Collections"), lifestyle = app.header("Lifestyle")
        XCTAssertLessThan(collections.frame.minY, lifestyle.frame.minY, "Collections sits above Lifestyle")
        app.chip("Collection Clothing").tap()
        XCTAssertTrue(app.buttons["Collection Clothing"].isSelected, "a collection is a chip too")
        app.chip("All").tap()
        // Stacks sort by most saves: Workouts (1 save) sits low in the grid, so scroll to it.
        let workouts = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Workouts,'")).firstMatch
        for _ in 0..<5 where !workouts.isHittable { app.swipeUp() }
        workouts.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Push-up ladder'")).firstMatch.waitForExistence(timeout: 3))
    }

    func testPlacesReviewFixMovesItToItsState() {
        let app = launch()
        app.tabBars.buttons["Places"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Portugal'")).firstMatch.waitForExistence(timeout: 5), "Café Azulejo, by country")
        app.buttons["Review 1"].tap()
        XCTAssertTrue(app.staticTexts["Needs a state or country"].waitForExistence(timeout: 3))
        // Read again answers even when the post has nothing new.
        app.buttons["Read Ramen Kiri again"].tap()
        XCTAssertTrue(app.staticTexts["Nothing new in the post. Tap Fix to add its state or country."].waitForExistence(timeout: 5))
        app.buttons["Fix Ramen Kiri"].tap()
        let region = app.textFields["State or region"]
        XCTAssertTrue(region.waitForExistence(timeout: 3))
        region.tap(); region.typeText("Tokyo")
        let country = app.textFields["Country"]
        country.tap(); country.typeText("Japan")
        app.buttons["Save"].tap()
        app.buttons["List"].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Japan'")).firstMatch.waitForExistence(timeout: 5), "now listed under its country")
        XCTAssertTrue(app.buttons["List"].exists)
    }

    /// Find on the map: the button counts the places with no pin, asks first (turning on OpenStreetMap
    /// when it's off), says what came of it, and doesn't offer the same places again.
    func testFindPlacesOnTheMap() {
        let app = launch()
        app.tabBars.buttons["Places"].tap()
        app.buttons["Map"].tap()
        let find = app.buttons["findOnMap"]
        XCTAssertTrue(find.waitForExistence(timeout: 5))
        XCTAssertEqual(find.label, "Find 1 place on the map", "Ramen Kiri has no pin")
        if let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] {
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("find-on-map-button.png"))
        }
        find.tap()
        let go = app.buttons["Turn on OpenStreetMap and find"]
        XCTAssertTrue(go.waitForExistence(timeout: 3), "Lookups are off in the fixture: the dialog turns them on")
        if let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] {
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("find-on-map-ask.png"))
        }
        go.tap()
        let done = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Pinned' OR label BEGINSWITH 'No new pins'")).firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 90), "the run says what came of it")
        if let folder = ProcessInfo.processInfo.environment["KEEPSAKE_SHOTS"] {
            try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: folder).appendingPathComponent("find-on-map-done.png"))
        }
        XCTAssertFalse(app.buttons["findOnMap"].waitForExistence(timeout: 2), "a place already looked for isn't offered again")
    }

    func testCookingStepByStep() {
        let app = launch()
        open(app, kind: "Recipes", save: "Brown butter pasta")
        app.buttons["Start cooking"].tap()
        XCTAssertTrue(app.buttons["Step 1 of 3"].waitForExistence(timeout: 3))
        // Each step shows the ingredients it uses; sage isn't named by any step, so it waits on step 1.
        XCTAssertTrue(app.buttons["350 g rigatoni"].exists)
        XCTAssertTrue(app.buttons["12 sage leaves"].exists)
        // Music plays along, muted until asked: unmute, pause, next song, off and back on.
        XCTAssertTrue(app.buttons["Unmute music"].waitForExistence(timeout: 3))
        app.buttons["Unmute music"].tap()
        XCTAssertTrue(app.buttons["Next song"].waitForExistence(timeout: 3))
        app.buttons["Pause music"].tap()
        XCTAssertTrue(app.buttons["Play music"].waitForExistence(timeout: 2))
        app.buttons["Next song"].tap()
        // Tapping the song's name lists every song; pick one.
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Now playing'")).firstMatch.tap()
        let lobby = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Lobby Time'")).firstMatch
        XCTAssertTrue(lobby.waitForExistence(timeout: 3))
        lobby.tap()
        XCTAssertTrue(app.buttons["Now playing Lobby Time by Kevin MacLeod"].waitForExistence(timeout: 3))
        app.buttons["Turn music off"].tap()
        XCTAssertTrue(app.buttons["Turn music on"].waitForExistence(timeout: 2))
        app.buttons["Turn music on"].tap()
        XCTAssertTrue(app.buttons["Pause music"].waitForExistence(timeout: 2))
        app.buttons["Next step"].tap()
        // The recipe page behind the cover lists "90 g butter" too; take the one on the step.
        XCTAssertTrue(app.buttons["90 g butter"].waitForExistence(timeout: 3))
        let butter = app.buttons.matching(identifier: "90 g butter").allElementsBoundByIndex.first { $0.isHittable } ?? app.buttons["90 g butter"]
        butter.tap()
        XCTAssertTrue(butter.isSelected, "checked off")
        app.buttons["Next step"].tap()
        XCTAssertTrue(app.buttons["Step 3 of 3"].waitForExistence(timeout: 3))
        app.buttons["Mark as cooked"].tap()
        XCTAssertTrue(app.buttons["Cooked, done"].waitForExistence(timeout: 5))
    }

    func testWebRecipeSaysWhereItsFrom() {
        let app = XCUIApplication()
        app.launchEnvironment["KEEPSAKE_DB"] = "uitest-\(UUID().uuidString)"
        app.launchArguments += ["-importOnLaunch", URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../demo/keepsake-web-recipe-demo.json").standardized.path]
        app.launch()
        open(app, kind: "Recipes", save: "Apple Fritter Coffee Cake")
        // An Instagram post that never wrote its recipe down: the close one found online names its site.
        let note = app.buttons["recipe.basedOn"]
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        XCTAssertTrue(note.label.hasPrefix("Based on a recipe from Sally's Baking Addiction"), note.label)
    }

    func testWorkoutGoalAndCheckIn() {
        let app = launch()
        open(app, kind: "Workouts", save: "Push-up ladder")
        XCTAssertTrue(app.staticTexts["Push-ups 3×12 rest 60s"].waitForExistence(timeout: 5), "Chrome's formatExercise")
        app.buttons["Make it a goal"].tap()
        app.buttons["Start the goal"].tap()
        XCTAssertTrue(app.staticTexts["0 of 3 this week · week 1 of 4"].waitForExistence(timeout: 5))
        app.buttons["Done today"].tap()
        XCTAssertTrue(app.staticTexts["1 of 3 this week · week 1 of 4"].waitForExistence(timeout: 5))
        app.buttons["Undo"].tap()
        XCTAssertTrue(app.staticTexts["0 of 3 this week · week 1 of 4"].waitForExistence(timeout: 5))
        // A second tap on the stamp takes today back off the goal.
        app.buttons["Done today"].tap()
        XCTAssertTrue(app.buttons["Done today, done"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["1 of 3 this week · week 1 of 4"].exists)
        app.buttons["Done today, done"].tap()
        XCTAssertTrue(app.staticTexts["0 of 3 this week · week 1 of 4"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Done today"].exists)
    }

    func testHomeShowsReviewAndLifestyle() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["1 save needs a collection"].waitForExistence(timeout: 5))
        // Collections first, then Lifestyle: each folded into one row that opens its page.
        let collections = app.buttons["Collections"], lifestyle = app.buttons["Lifestyle"]
        XCTAssertTrue(collections.exists && lifestyle.exists)
        XCTAssertLessThan(collections.frame.minY, lifestyle.frame.minY, "Collections sits above Lifestyle")
        lifestyle.tap()
        XCTAssertTrue(app.buttons["Places, 2 saves"].waitForExistence(timeout: 3))
        app.buttons["Recipes, 2 saves"].tap()
        XCTAssertTrue(app.staticTexts["Recipes"].waitForExistence(timeout: 3))
    }

    func testLifestylePlacesMapButton() {
        let app = launch()
        XCTAssertTrue(app.buttons["Lifestyle"].waitForExistence(timeout: 5))
        app.buttons["Lifestyle"].tap()
        app.buttons["Places, 2 saves"].tap()
        // Next to the Places title: one tap swaps the cards for the map, another brings them back.
        let toggle = app.buttons["placesMapToggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 3))
        XCTAssertEqual(toggle.label, "Map")
        XCTAssertFalse(toggle.isSelected)
        toggle.tap()
        XCTAssertTrue(app.maps.firstMatch.waitForExistence(timeout: 3))
        XCTAssertTrue(toggle.isSelected)
        // One of the fixture's two places has no pin yet: the map says so.
        XCTAssertTrue(app.staticTexts["1 of 2 mapped"].exists)
        toggle.tap()
        XCTAssertFalse(app.maps.firstMatch.waitForExistence(timeout: 1))
    }
}
