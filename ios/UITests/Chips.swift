import XCTest

extension XCUIApplication {
    /// A Library filter chip, scrolled into reach: the row holds the libraries, every collection, then
    /// the kinds, so later chips start off-screen.
    func chip(_ label: String) -> XCUIElement {
        let chip = scrollViews.buttons[label].firstMatch
        _ = chip.waitForExistence(timeout: 5)
        let row = scrollViews.containing(.button, identifier: "All").firstMatch
        let screen = windows.firstMatch.frame
        for _ in 0..<8 where chip.exists && !screen.insetBy(dx: 8, dy: 0).contains(chip.frame) {
            if chip.frame.minX < screen.minX { row.swipeRight(velocity: .slow) } else { row.swipeLeft(velocity: .slow) }
        }
        return chip
    }

    /// The Library's section header (the chip of the same name comes first, in the row above).
    func header(_ title: String) -> XCUIElement {
        let all = staticTexts.matching(identifier: title).allElementsBoundByIndex
        return all.max { $0.frame.minY < $1.frame.minY } ?? staticTexts[title]
    }
}
