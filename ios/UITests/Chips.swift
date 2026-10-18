import XCTest

extension XCUIApplication {
    /// A Library filter chip, scrolled into reach: the row holds the libraries, every collection, then
    /// the kinds, so later chips start off-screen.
    func chip(_ label: String) -> XCUIElement {
        let chip = scrollViews.buttons[label].firstMatch
        _ = chip.waitForExistence(timeout: 5)
        let screen = windows.firstMatch.frame
        let origin = coordinate(withNormalizedOffset: .zero)
        for _ in 0..<12 where chip.exists && !screen.insetBy(dx: 8, dy: 0).contains(chip.frame) {
            // Drag along the chip row itself (a swipe on the query lands on the page's own scroll view).
            let y = chip.frame.midY, left = chip.frame.minX < screen.minX
            let from = origin.withOffset(CGVector(dx: screen.width * (left ? 0.25 : 0.75), dy: y))
            from.press(forDuration: 0.05, thenDragTo: origin.withOffset(CGVector(dx: screen.width * (left ? 0.75 : 0.25), dy: y)))
        }
        return chip
    }

    /// The Library's section header (the chip of the same name comes first, in the row above).
    func header(_ title: String) -> XCUIElement {
        let all = staticTexts.matching(identifier: title).allElementsBoundByIndex
        return all.max { $0.frame.minY < $1.frame.minY } ?? staticTexts[title]
    }
}
