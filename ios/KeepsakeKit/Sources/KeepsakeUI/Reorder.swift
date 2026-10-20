#if canImport(UIKit)
import SwiftUI
import UniformTypeIdentifiers

/// Press and hold a card to lift it, then slide it among its neighbours: they make room as it passes,
/// and the order is kept as it changes (so letting go anywhere keeps it). A tap still opens the card.
public struct ReorderDrop: DropDelegate {
    let id: String
    @Binding var order: [String]
    @Binding var dragging: String?
    let reduce: Bool
    let moved: ([String]) -> Void

    public func dropEntered(info: DropInfo) {
        guard let dragging, dragging != id, let from = order.firstIndex(of: dragging), let to = order.firstIndex(of: id) else { return }
        Haptic.detent()
        withAnimation(KSMotion.or(KSMotion.settle, reduce: reduce)) {
            order.move(fromOffsets: IndexSet(integer: from), toOffset: to > from ? to + 1 : to)
        }
        moved(order)
    }

    public func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }

    public func performDrop(info: DropInfo) -> Bool {
        dragging = nil
        Haptic.dropped()
        return true
    }
}

extension View {
    /// Makes this card one of a row or grid you can put in your own order (see `ReorderDrop`).
    public func reorderable(_ id: String, in order: Binding<[String]>, dragging: Binding<String?>, reduce: Bool,
                            moved: @escaping ([String]) -> Void) -> some View {
        self
            .onDrag {
                dragging.wrappedValue = id
                Haptic.lift()
                return NSItemProvider(object: id as NSString)
            }
            .onDrop(of: [.text], delegate: ReorderDrop(id: id, order: order, dragging: dragging, reduce: reduce, moved: moved))
            // VoiceOver and Switch Control: the same moves, one step at a time.
            .accessibilityAction(named: "Move earlier") { step(id, -1, order, moved) }
            .accessibilityAction(named: "Move later") { step(id, 1, order, moved) }
    }
}

private func step(_ id: String, _ by: Int, _ order: Binding<[String]>, _ moved: ([String]) -> Void) {
    guard let i = order.wrappedValue.firstIndex(of: id), order.wrappedValue.indices.contains(i + by) else { return }
    order.wrappedValue.swapAt(i, i + by)
    moved(order.wrappedValue)
}

extension Array {
    /// These items in a saved order (ids). Items the order doesn't know yet go first (`newFirst`, for
    /// the newest saves) or last (a new collection or view joins the end).
    public func arranged(by saved: [String], newFirst: Bool = false, id: (Element) -> String) -> [Element] {
        let pos = Dictionary(saved.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
        let known = filter { pos[id($0)] != nil }.sorted { pos[id($0)]! < pos[id($1)]! }
        let new = filter { pos[id($0)] == nil }
        return newFirst ? new + known : known + new
    }
}

extension Array {
    /// Groups (collections, Lifestyle views) with the most saves first; a tie goes A–Z by name, the
    /// way Chrome sorts them (`mostFirst` in util.js).
    public func mostFirst(count: (Element) -> Int, name: (Element) -> String) -> [Element] {
        let keyed: [(item: Element, count: Int, name: String)] = map { ($0, count($0), name($0)) }
        return keyed.sorted { a, b in
            if a.count != b.count { return a.count > b.count }
            return a.name.localizedStandardCompare(b.name) == .orderedAscending
        }.map { $0.item }
    }
}

/// A saved order of ids in the app's settings (Recent, the Lifestyle views, Home's sections).
/// UI tests (a fresh library in KEEPSAKE_DB) each get their own orders.
public enum SavedOrder {
    public static func key(_ name: String) -> String { (ProcessInfo.processInfo.environment["KEEPSAKE_DB"].map { "\($0)." } ?? "") + name }
    public static func get(_ name: String) -> [String] { (UserDefaults.standard.string(forKey: key(name)) ?? "").split(separator: "\n").map(String.init) }
    public static func set(_ name: String, _ ids: [String]) { UserDefaults.standard.set(ids.joined(separator: "\n"), forKey: key(name)) }
}
#endif
