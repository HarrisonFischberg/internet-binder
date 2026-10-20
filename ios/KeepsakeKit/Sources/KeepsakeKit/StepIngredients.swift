import Foundation

/// Which ingredients each step of a recipe uses, worked out from the words: "Whisk the yolks, egg and
/// pecorino" takes "3 egg yolks", "1 whole egg" and "50 g pecorino romano, grated". An ingredient
/// belongs to the first step that names it; a later step that names it again gets it as "from step N"
/// (the egg mix, the cooked pasta). A few cooking words stand for a group ("pasta", "spices", "herbs").
/// Ingredients no step names are kept aside so cooking can still show them.
public struct StepIngredients: Sendable, Equatable {
    /// One ingredient line split into its amount ("50 g", "Pinch", or "") and what it is.
    public struct Item: Sendable, Equatable {
        public let index: Int
        public let amount: String
        public let name: String
    }
    /// Ingredients first used in an earlier step (0-based), in the order of the list.
    public struct Carried: Sendable, Equatable {
        public let fromStep: Int
        public let items: [Int]
    }
    public struct Step: Sendable, Equatable {
        public var items: [Int] = []
        public var carried: [Carried] = []
        public var isEmpty: Bool { items.isEmpty && carried.isEmpty }
    }

    public let items: [Item]
    public let steps: [Step]
    /// Ingredients no step names.
    public let unmatched: [Int]
    private let keys: [Set<String>]

    public init(steps: [String], ingredients: [String]) {
        items = ingredients.enumerated().map { i, line in
            let (amount, name) = Self.split(line)
            return Item(index: i, amount: amount, name: name)
        }
        let keys = items.map { Set(Self.words($0.name).filter { !Self.drop.contains($0) && !Self.units.contains($0) && $0.count > 1 }) }
        self.keys = keys
        var first: [Int: Int] = [:]
        self.steps = steps.enumerated().map { s, text in
            var step = Step()
            var carried: [(Int, [Int])] = []
            let said = Self.said(text)
            for (i, k) in keys.enumerated() where !k.isDisjoint(with: said) {
                if let from = first[i] {
                    if let at = carried.firstIndex(where: { $0.0 == from }) { carried[at].1.append(i) } else { carried.append((from, [i])) }
                } else {
                    first[i] = s
                    step.items.append(i)
                }
            }
            step.carried = carried.map { Carried(fromStep: $0.0, items: $0.1) }
            return step
        }
        unmatched = items.indices.filter { first[$0] == nil }
    }

    /// The words of a step's text that name one of its ingredients, for marking them in the text.
    public func highlights(in text: String, step: Int) -> [Range<String.Index>] {
        guard steps.indices.contains(step) else { return [] }
        let s = steps[step]
        let used = (s.items + s.carried.flatMap(\.items)).reduce(into: Set<String>()) { $0.formUnion(keys[$1]) }
        guard !used.isEmpty else { return [] }
        return Self.tokens(text).filter { range in
            let w = Self.stem(String(text[range]))
            return used.contains(w) || (Self.groups[w].map { !used.isDisjoint(with: $0) } ?? false)
        }
    }

    /// "200 g spaghetti" → ("200 g", "spaghetti"); "Pinch of salt" → ("Pinch", "salt"); "Black pepper" → ("", "Black pepper").
    public static func split(_ line: String) -> (amount: String, name: String) {
        let parts = line.split(whereSeparator: \.isWhitespace).map(String.init)
        if parts.count > 2, pinches.contains(parts[0].lowercased()), parts[1].lowercased() == "of" {
            return (parts[0].prefix(1).uppercased() + parts[0].dropFirst().lowercased(), parts.dropFirst(2).joined(separator: " "))
        }
        var taken = 0
        var number = false
        for p in parts {
            let t = p.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ".,"))
            if isNumber(t) { number = true; taken += 1; continue }
            if number, ["-", "–", "to"].contains(t) { taken += 1; continue }
            // "250g"
            if let n = t.firstIndex(where: \.isLetter), isNumber(String(t[..<n])), units.contains(String(t[n...])) { number = true; taken += 1; continue }
            if number, units.contains(t) || units.contains(stem(t)) { taken += 1; continue }
            break
        }
        guard number, taken < parts.count else { return ("", line.trimmingCharacters(in: .whitespaces)) }
        var rest = Array(parts[taken...])
        if rest.first?.lowercased() == "of", rest.count > 1 { rest.removeFirst() }
        return (parts[..<taken].joined(separator: " "), rest.joined(separator: " "))
    }

    static func isNumber(_ t: String) -> Bool {
        !t.isEmpty && t.allSatisfy { "0123456789.,/-–¼½¾⅓⅔⅛".contains($0) } && t.contains { $0.isNumber }
    }

    /// Lowercased, with a plural made singular: "tomatoes" → "tomato", "yolks" → "yolk".
    static func stem(_ word: String) -> String {
        let w = word.lowercased()
        if w.hasSuffix("oes") || w.hasSuffix("ches") || w.hasSuffix("shes") { return String(w.dropLast(2)) }
        if w.hasSuffix("ies"), w.count > 4 { return String(w.dropLast(3)) + "y" }
        if w.hasSuffix("s"), !w.hasSuffix("ss"), w.count > 3 { return String(w.dropLast()) }
        return w
    }

    static func tokens(_ text: String) -> [Range<String.Index>] {
        var out: [Range<String.Index>] = []
        var start: String.Index?
        for i in text.indices {
            let c = text[i]
            if c.isLetter || c == "-" || c == "'" { if start == nil { start = i } } else if let s = start { out.append(s..<i); start = nil }
        }
        if let s = start { out.append(s..<text.endIndex) }
        return out
    }

    static func words(_ text: String) -> [String] { tokens(text).map { stem(String(text[$0])) } }

    /// A step's words, plus what its group words stand for ("pasta" → spaghetti, rigatoni…).
    static func said(_ text: String) -> Set<String> {
        var said = Set(words(text))
        for (word, members) in groups where said.contains(word) { said.formUnion(members) }
        return said
    }

    static let pinches: Set<String> = ["pinch", "dash", "handful", "splash", "knob"]
    static let units: Set<String> = Set("""
        g kg mg ml l cl dl tsp tbsp teaspoon tablespoon cup oz lb pound pinch dash handful can tin slice portion \
        bunch sprig piece stick pack package jar clove knob splash
        """.split(whereSeparator: \.isWhitespace).map(String.init))
    static let drop: Set<String> = Set("""
        of and or a an the to for fresh dried ground whole large small medium big red green yellow white black extra virgin \
        finely roughly thinly sliced chopped diced minced grated peeled crushed softened melted beaten divided taste plus more \
        about optional cold warm hot room temperature canned soft-boiled boiled cooked raw ripe juiced zested halved quartered \
        torn leave leaf
        """.split(whereSeparator: \.isWhitespace).map(String.init))
    static let groups: [String: Set<String>] = [
        "pasta": ["spaghetti", "penne", "rigatoni", "linguine", "fettuccine", "tagliatelle", "macaroni", "orzo", "noodle"],
        "noodle": ["ramen", "udon", "soba"],
        "spice": ["cumin", "paprika", "cinnamon", "coriander", "turmeric", "chili", "chilli", "nutmeg", "cardamom", "allspice", "cayenne"],
        "herb": ["parsley", "basil", "cilantro", "mint", "dill", "thyme", "rosemary", "chive", "oregano", "sage", "tarragon"],
        "cheese": ["pecorino", "parmesan", "parmigiano", "feta", "mozzarella", "cheddar", "ricotta", "gruyere"],
    ]
}
