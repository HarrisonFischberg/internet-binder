import Testing
import Foundation
@testable import KeepsakeKit

/// Not a unit test: the evaluation harness for Apple Intelligence (tools/qa). It runs each case through
/// the app's own engine on this Mac, as the iPhone runs it: the Share Extension's capture, then the
/// after-save work the app does when it opens (views.finishSaves: Apple Intelligence reads the save on
/// the device), then the save read back from a reopened library. The outcomes go to a JSON file that
/// tools/qa/score.mjs scores with the same rules as every other provider.
///
/// Skipped unless KS_EVAL_CASES (from tools/qa/export-cases.mjs) and KS_EVAL_OUT are set. No key is
/// given, so no cloud provider can be used; every network request is refused and recorded, so the run
/// also shows what the on-device path tried to reach.
@Suite struct AppleEvalTests {
    final class Refusing: NetworkTransport, @unchecked Sendable {
        private let lock = NSLock()
        private var hosts: [String: Int] = [:]
        func send(_ request: URLRequest) async throws -> (status: Int, body: Data) {
            lock.withLock { hosts[request.url?.host() ?? "?", default: 0] += 1 }
            throw URLError(.notConnectedToInternet)
        }
        func send(_ request: URLRequest, limit: Int) async throws -> (status: Int, body: Data)? { try await send(request) }
        var attempts: [String: Int] { lock.withLock { hosts } }
    }

    @Test func appleIntelligenceEvaluation() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let casesPath = env["KS_EVAL_CASES"], let outPath = env["KS_EVAL_OUT"] else { return }
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: casesPath))) as? [String: Any] ?? [:]
        let cases = file["cases"] as? [[String: Any]] ?? []
        let status = OnDeviceAI.status
        let net = Refusing()
        var results: [[String: Any]] = []
        for c in cases {
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("ib-eval-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: dir) }
            let path = dir.appendingPathComponent("library.sqlite").path
            let lib = try Library(path: path, secrets: MemorySecrets(), transport: net, tidy: false)
            try await lib.prepare()
            // The case's collections, with their ids, in place of the starter ones.
            for existing in try lib.collections() { try await lib.core.call("store.deleteCollection", [existing.id]) }
            for col in c["collections"] as? [[String: Any]] ?? [] { _ = try await lib.core.call("store.createCollection", [col]) }
            let product = c["product"] as? [String: Any] ?? [:]
            var row: [String: Any] = ["case": c.filter { $0.key != "product" && $0.key != "collections" }]
            let t0 = Date()
            do {
                let r = try await lib.capture(product: product)
                guard let id = r.save?.id else { row["error"] = "not saved"; results.append(row); continue }
                row["id"] = id
                row["immediate"] = try await outcome(lib, id)
                let t1 = Date()
                // What the app does when it opens: the pending AI tidy and Apple Intelligence's read.
                do { try await lib.finishSaves() } catch { row["error"] = "\(error)" }
                let reopened = try Library(path: path, secrets: MemorySecrets(), transport: net, tidy: false)
                try await reopened.prepare()
                row["settled"] = try await outcome(reopened, id)
                row["ms"] = ["save": Int(t1.timeIntervalSince(t0) * 1000), "settle": Int(Date().timeIntervalSince(t1) * 1000)]
            } catch {
                row["error"] = "\(error)"
                row["immediate"] = ["lost": true]
                row["settled"] = ["lost": true]
            }
            results.append(row)
        }
        let info = ProcessInfo.processInfo
        let meta: [String: Any] = [
            "at": ISO8601DateFormatter().string(from: Date()),
            "provider": "apple-on-device",
            "model": "SystemLanguageModel.default (FoundationModels)",
            "appleStatus": status.rawValue,
            "platform": "macOS \(info.operatingSystemVersionString) (KeepsakeKit, JavaScriptCore engine)",
            "capture": file["capture"] as? String ?? "page",
            "cases": cases.count,
            "network": net.attempts,
        ]
        let data = try JSONSerialization.data(withJSONObject: ["meta": meta, "results": results], options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: outPath))
    }

    /// What the person sees: the save's kind, its collection (or Review), whether work is still pending.
    private func outcome(_ lib: Library, _ id: String) async throws -> [String: Any] {
        guard let item = try await lib.core.call("store.getItem", [id]) as? [String: Any], item["deletedAt"] == nil || item["deletedAt"] is NSNull else { return ["lost": true] }
        let kind = item["kind"] as? String ?? "link"
        let own = kind != "product" && kind != "link"
        var name: Any = NSNull()
        if !own, let cid = item["collectionId"] as? String, let col = try lib.collections().first(where: { $0.id == cid }) { name = col.name }
        return [
            "lost": false, "kind": kind, "collection": name,
            "review": !own && (name is NSNull || item["needsReview"] as? Bool == true),
            "pending": item["captureState"] as? String == "pending",
            "title": item["title"] as? String ?? "", "source": item["categorizationSource"] as? String ?? "",
            "reason": item["categorizationReason"] as? String ?? "",
        ]
    }
}
