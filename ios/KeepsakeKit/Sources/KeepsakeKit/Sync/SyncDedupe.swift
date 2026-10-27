import Foundation
import GRDB

/// When two libraries meet in iCloud for the first time (the iPhone's and Safari's, each with its own
/// Roadtrips and its own save of the same page), they come out as one, the way an imported backup does
/// (storage.js `importJSON`):
///
/// - collections with the same name (give or take case and punctuation) or the same built-in category
///   become one, and their saves move into it;
/// - saves of the same link (`urlKey`), outside the Trash, become one, with any goals moved onto it.
///
/// The one kept is the one with the smallest id, and the two are merged as two copies of one record are
/// (`SyncMerge`, newer wins, hand edits survive), so every device that runs this picks the same one and
/// reaches the same library. The others are deleted, and that deletion syncs. Saving the same link twice
/// isn't possible otherwise (`findByUrl`), so this only ever finds libraries meeting.
extension RecordDatabase {
    /// Returns whether anything was merged.
    @discardableResult
    public func mergeDuplicates() throws -> Bool {
        let merged = try pool.write { db -> Bool in
            let cols = try mergeCollections(db)
            let items = try mergeItems(db)
            return cols || items
        }
        if merged { wroteLocally() }
        return merged
    }

    static func collectionNameKey(_ name: String) -> String {
        name.lowercased()
            .replacingOccurrences(of: "&", with: " and ")
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty && $0 != "and" && $0 != "the" && $0 != "my" }
            .joined(separator: " ")
    }

    private func mergeCollections(_ db: Database) throws -> Bool {
        let all = try String.fetchAll(db, sql: "SELECT body FROM collection ORDER BY key").map { try SyncJSON.object($0) }
        var groups: [String: [[String: Any]]] = [:]
        var order: [String] = []
        for col in all {
            guard col["id"] is String else { continue }
            let group = (col["taxonomyKey"] as? String).map { "tax:" + $0 } ?? "name:" + Self.collectionNameKey(col["name"] as? String ?? "")
            if group == "name:" { continue }
            if groups[group] == nil { order.append(group) }
            groups[group, default: []].append(col)
        }
        // A built-in category and a typed collection of the same name are one too.
        var byName: [String: String] = [:]
        for group in order {
            guard let name = groups[group]?.first?["name"] as? String else { continue }
            let key = "name:" + Self.collectionNameKey(name)
            if let other = byName[key], other != group {
                groups[other]! += groups[group]!
                groups[group] = nil
            } else {
                byName[key] = group
            }
        }
        var changed = false
        var moved: [String: String] = [:]
        for (_, cols) in groups where cols.count > 1 {
            let sorted = cols.sorted { ($0["id"] as! String) < ($1["id"] as! String) }
            var keep = sorted[0]
            let keepId = keep["id"] as! String
            for other in sorted.dropFirst() {
                let otherId = other["id"] as! String
                keep = SyncMerge.mergeRecord(base: nil, local: keep, remote: other)
                keep["id"] = keepId
                let keywords = Array(Set((keep["keywords"] as? [String] ?? []) + (other["keywords"] as? [String] ?? []))).sorted()
                if !keywords.isEmpty { keep["keywords"] = keywords }
                for body in try String.fetchAll(db, sql: "SELECT body FROM item WHERE collectionId = ?", arguments: [otherId]) {
                    var item = try SyncJSON.object(body)
                    item["collectionId"] = keepId
                    try writeMerged(db, "items", item)
                }
                try removeMerged(db, "collections", otherId)
                moved[otherId] = keepId
            }
            try writeMerged(db, "collections", keep)
            changed = true
        }
        try moveLearned(db, moved)
        return changed
    }

    /// What the sorter learned for a collection that merged away now counts for the one kept (categorizer.js
    /// `forgetCollection`): a word left pointing at a gone id would also stop the kept one's built-in words.
    private func moveLearned(_ db: Database, _ moved: [String: String]) throws {
        guard !moved.isEmpty, let text = try String.fetchOne(db, sql: "SELECT body FROM kv WHERE key = 'prefs'") else { return }
        var prefs = try SyncJSON.object(text)
        guard var value = prefs["value"] as? [String: Any] else { return }
        for (field, cap) in [("learnedKeywords", SyncMerge.learnedWeightCap as Double?), ("retailerPrefs", nil)] {
            guard let all = value[field] as? [String: [String: Any]] else { continue }
            var out: [String: Any] = [:]
            for (term, entry) in all {
                var e: [String: Double] = [:]
                for (id, w) in entry { e[moved[id] ?? id, default: 0] += (w as? NSNumber)?.doubleValue ?? 0 }
                if let cap { for (id, w) in e { e[id] = min(cap, w) } }
                out[term] = e
            }
            value[field] = out
        }
        prefs["value"] = value
        try writeMerged(db, "kv", prefs)
    }

    private func mergeItems(_ db: Database) throws -> Bool {
        let rows = try Row.fetchAll(db, sql: """
            SELECT body FROM item WHERE deletedAt IS NULL AND urlKey IS NOT NULL AND urlKey != ''
              AND urlKey IN (SELECT urlKey FROM item WHERE deletedAt IS NULL GROUP BY urlKey HAVING COUNT(*) > 1)
            ORDER BY urlKey, key
            """)
        var groups: [String: [[String: Any]]] = [:]
        for row in rows {
            let item = try SyncJSON.object(row["body"] as String)
            guard let key = item["urlKey"] as? String, item["id"] is String else { continue }
            groups[key, default: []].append(item)
        }
        for (_, items) in groups where items.count > 1 {
            var keep = items[0]
            let keepId = keep["id"] as! String
            let created = items.compactMap { $0["createdAt"] as? String }.min()
            for other in items.dropFirst() {
                let otherId = other["id"] as! String
                keep = SyncMerge.mergeRecord(base: nil, local: keep, remote: other)
                keep["id"] = keepId
                for body in try String.fetchAll(db, sql: "SELECT body FROM goal WHERE itemId = ?", arguments: [otherId]) {
                    var goal = try SyncJSON.object(body)
                    goal["itemId"] = keepId
                    try writeMerged(db, "goals", goal)
                }
                try removeMerged(db, "items", otherId)
            }
            if let created { keep["createdAt"] = created }
            try writeMerged(db, "items", keep)
        }
        return !groups.isEmpty
    }

    /// A write of the merge: pending for iCloud, and logged for Safari when this is its copy.
    private func writeMerged(_ db: Database, _ store: String, _ obj: [String: Any]) throws {
        try upsert(db, try spec(store), store: store, body: try SyncJSON.text(obj))
        if let key = obj[try spec(store).keyField] as? String { try noteOutbound(db, store: store, key: key) }
    }

    private func removeMerged(_ db: Database, _ store: String, _ key: String) throws {
        try delete(db, try spec(store), store: store, key: key)
        try noteOutbound(db, store: store, key: key)
    }
}
