import Foundation

/// How two versions of one record become one (docs: the iCloud sync plan, "Conflicts and deletions").
///
/// With a base (the last version both sides agreed on), each field is merged on its own: a field only
/// one side changed takes that side's value, so editing the title on the Mac and moving the same save on
/// the iPhone keeps both. A field both sides changed goes to the hand edit over AI (`userFields`), else to
/// the newer `updatedAt`. Without a base (the first time a record meets its other copy) the newer record
/// wins whole, again keeping the other side's hand edits.
///
/// Learned words and retailer counts merge as counters (each side's change since the base is added), and
/// the Instagram import history as a map, so learning on one device never erases the other's.
///
/// Every rule is deterministic given the same three inputs, so both devices reach the same record.
enum SyncMerge {
    /// Fields a person can type over; kept in step with storage.js `USER_FIELDS`.
    static let userEditable: Set<String> = ["title", "price", "currency", "note", "image", "images", "url", "description", "topics", "kind", "collectionId"]
    static let learnedWeightCap = 6.0

    /// `base` and the pictures inside it are compared by hash (`SyncJSON.hashedPictures`).
    static func merge(_ id: SyncID, base: [String: Any]?, local: [String: Any], remote: [String: Any]) -> [String: Any] {
        if id.store == "kv" {
            var out = remote
            let b = base?["value"] as? [String: Any] ?? [:]
            let l = local["value"] as? [String: Any] ?? [:]
            let r = remote["value"] as? [String: Any] ?? [:]
            out["value"] = id.key == "prefs" ? mergePrefs(base: b, local: l, remote: r) : mergeMaps(base: b, local: l, remote: r)
            return out
        }
        return mergeRecord(base: base, local: local, remote: remote)
    }

    // MARK: records (saves, collections, goals, check-ins)

    static func mergeRecord(base: [String: Any]?, local: [String: Any], remote: [String: Any]) -> [String: Any] {
        let localWins = newer(local, than: remote)
        let lUser = Set(local["userFields"] as? [String] ?? [])
        let rUser = Set(remote["userFields"] as? [String] ?? [])
        let lh = hashed(local), rh = hashed(remote)

        func pick(_ field: String) -> Bool { // true = local's value
            if lUser.contains(field) != rUser.contains(field), userEditable.contains(field) { return lUser.contains(field) }
            return localWins
        }

        var out: [String: Any] = [:]
        for field in Set(local.keys).union(remote.keys) where field != "updatedAt" && field != "userFields" {
            let takeLocal: Bool
            if SyncJSON.same(lh[field], rh[field]) {
                takeLocal = true
            } else if let base {
                if SyncJSON.same(lh[field], base[field]) { takeLocal = false }
                else if SyncJSON.same(rh[field], base[field]) { takeLocal = true }
                else { takeLocal = pick(field) }
            } else {
                takeLocal = pick(field)
            }
            if let v = takeLocal ? local[field] : remote[field] { out[field] = v }
        }
        let stamps = [local["updatedAt"] as? String, remote["updatedAt"] as? String].compactMap { $0 }
        if let latest = stamps.max() { out["updatedAt"] = latest }
        if local["userFields"] != nil || remote["userFields"] != nil { out["userFields"] = lUser.union(rUser).sorted() }
        return out
    }

    /// Newer `updatedAt` first; a tie goes to the larger body so both devices pick the same side.
    static func newer(_ a: [String: Any], than b: [String: Any]) -> Bool {
        let at = a["updatedAt"] as? String ?? "", bt = b["updatedAt"] as? String ?? ""
        if at != bt { return at > bt }
        return ((try? SyncJSON.text(a)) ?? "") >= ((try? SyncJSON.text(b)) ?? "")
    }

    static func hashed(_ obj: [String: Any]) -> [String: Any] {
        guard let text = try? SyncJSON.text(obj), let h = try? SyncJSON.hashedPictures(text, store: "items"), let out = try? SyncJSON.object(h) else { return obj }
        return out
    }

    // MARK: learned words

    static func mergePrefs(base: [String: Any], local: [String: Any], remote: [String: Any]) -> [String: Any] {
        var out = mergeMaps(base: base, local: local, remote: remote, skipping: ["learnedKeywords", "retailerPrefs", "corrections"])
        out["learnedKeywords"] = mergeCounters(base: base["learnedKeywords"], local: local["learnedKeywords"], remote: remote["learnedKeywords"], cap: learnedWeightCap)
        out["retailerPrefs"] = mergeCounters(base: base["retailerPrefs"], local: local["retailerPrefs"], remote: remote["retailerPrefs"], cap: nil)
        // Corrections: the remote list plus the ones this device added since the base, newest 200.
        let b = base["corrections"] as? [Any] ?? [], l = local["corrections"] as? [Any] ?? [], r = remote["corrections"] as? [Any] ?? []
        let added = l.filter { c in !b.contains { SyncJSON.same($0, c) } && !r.contains { SyncJSON.same($0, c) } }
        out["corrections"] = Array((r + added).suffix(200))
        return out
    }

    /// `{ term: { collectionId: weight } }`: remote plus this device's change since the base. A weight
    /// that lands on 0 is dropped, so Forget on one device removes the word everywhere. Two sides that
    /// reached the same weight made the same change (both moved a merged collection's words, both forgot
    /// a word): it counts once, and a weight never goes below 0.
    static func mergeCounters(base: Any?, local: Any?, remote: Any?, cap: Double?) -> [String: Any] {
        let b = base as? [String: [String: Any]] ?? [:], l = local as? [String: [String: Any]] ?? [:], r = remote as? [String: [String: Any]] ?? [:]
        func n(_ v: Any?) -> Double { (v as? NSNumber)?.doubleValue ?? 0 }
        var out: [String: Any] = [:]
        for term in Set(b.keys).union(l.keys).union(r.keys) {
            var entry: [String: Any] = [:]
            let bt = b[term] ?? [:], lt = l[term] ?? [:], rt = r[term] ?? [:]
            for cid in Set(bt.keys).union(lt.keys).union(rt.keys) {
                let l = n(lt[cid]), r = n(rt[cid])
                var w = l == r ? l : max(0, r + l - n(bt[cid]))
                if let cap { w = min(cap, w) }
                if w != 0 { entry[cid] = w }
            }
            if !entry.isEmpty { out[term] = entry }
        }
        return out
    }

    // MARK: maps (import history, the rest of prefs)

    /// Key by key, three-way, nested maps merged the same way. A key both sides changed goes to remote.
    static func mergeMaps(base: [String: Any], local: [String: Any], remote: [String: Any], skipping: Set<String> = []) -> [String: Any] {
        var out: [String: Any] = [:]
        for k in Set(local.keys).union(remote.keys).union(base.keys) where !skipping.contains(k) {
            let l = local[k], r = remote[k], b = base[k]
            let v: Any?
            if let lm = l as? [String: Any], let rm = r as? [String: Any] {
                v = mergeMaps(base: b as? [String: Any] ?? [:], local: lm, remote: rm)
            } else if SyncJSON.same(l, r) || SyncJSON.same(l, b) {
                v = r
            } else if SyncJSON.same(r, b) {
                v = l
            } else {
                v = r
            }
            if let v, !(v is NSNull) { out[k] = v }
        }
        return out
    }
}
