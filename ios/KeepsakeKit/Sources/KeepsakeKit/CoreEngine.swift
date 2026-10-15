import Foundation
import JavaScriptCore

public enum CoreError: Error, LocalizedError, Equatable {
    /// The shared code threw; the message is written for people (storage.js copy).
    case failed(String)
    case storageFull(String)
    case loading(String)

    public var errorDescription: String? {
        switch self {
        case .failed(let m), .storageFull(let m), .loading(let m): m
        }
    }
}

/// Runs Keepsake's shared rules and store (keepsake/src/shared, bundled by ios/tools/bundle-core.mjs)
/// in JavaScriptCore, on top of `RecordDatabase`. One context and one serial queue: every call into
/// JavaScript happens on `queue`, and the native backends answer synchronously, so the shared store
/// behaves exactly as it does in Chrome.
public final class KeepsakeCore: @unchecked Sendable {
    public let database: RecordDatabase
    public let transport: NetworkTransport
    private let queue = DispatchQueue(label: "com.harrisonfischberg.keepsake.core", qos: .userInitiated)
    private var context: JSContext!
    private var timers: [Int: DispatchWorkItem] = [:]
    private var nextTimer = 1
    private var loadError: String?

    public init(database: RecordDatabase, transport: NetworkTransport = URLSessionTransport()) throws {
        self.database = database
        self.transport = transport
        try queue.sync { try load() }
    }

    private func load() throws {
        guard let ctx = JSContext() else { throw CoreError.loading("JavaScriptCore is unavailable.") }
        ctx.name = "Keepsake core"
        ctx.exceptionHandler = { [weak self] _, ex in self?.loadError = ex?.toString() }
        let native = JSValue(newObjectIn: ctx)!
        let uuid: @convention(block) () -> String = { UUID().uuidString.lowercased() }
        native.setObject(uuid, forKeyedSubscript: "uuid" as NSString)
        let log: @convention(block) (String) -> Void = { print("[core] \($0)") }
        native.setObject(log, forKeyedSubscript: "log" as NSString)
        let setTimeout: @convention(block) (JSValue, Double) -> Int = { [unowned self] fn, ms in
            let id = self.nextTimer
            self.nextTimer += 1
            let work = DispatchWorkItem { [unowned self] in
                self.timers[id] = nil
                fn.call(withArguments: [])
            }
            self.timers[id] = work
            self.queue.asyncAfter(deadline: .now() + max(0, ms) / 1000, execute: work)
            return id
        }
        native.setObject(setTimeout, forKeyedSubscript: "setTimeout" as NSString)
        let clearTimeout: @convention(block) (Int) -> Void = { [unowned self] id in self.timers.removeValue(forKey: id)?.cancel() }
        native.setObject(clearTimeout, forKeyedSubscript: "clearTimeout" as NSString)
        native.setObject(networkBridge(), forKeyedSubscript: "fetch" as NSString)
        native.setObject(recordBridge(in: ctx), forKeyedSubscript: "db" as NSString)
        native.setObject(settingsBridge(in: ctx), forKeyedSubscript: "kv" as NSString)
        ctx.setObject(native, forKeyedSubscript: "__native" as NSString)

        for name in ["keepsake-core", "ios-bridge"] {
            guard let url = Bundle.module.url(forResource: name, withExtension: "js"),
                  let src = try? String(contentsOf: url, encoding: .utf8)
            else { throw CoreError.loading("\(name).js is missing from the app.") }
            ctx.evaluateScript(src, withSourceURL: url)
            if let e = loadError { throw CoreError.loading("\(name).js: \(e)") }
        }
        context = ctx
    }

    /// fetch for the shared code, behind the allowlist (NetworkPolicy). Answers on the core's queue.
    private func networkBridge() -> @convention(block) (String, String, String, String, JSValue) -> Void {
        let db = database
        let transport = transport
        return { [unowned self] urlString, method, headersJSON, body, done in
            let callback = JSBox(done)
            let finish: @Sendable (Int, String, String?) -> Void = { status, text, error in
                self.queue.async { callback.value.call(withArguments: [status, text, error ?? NSNull()]) }
            }
            let settings = ((try? db.settings(["keepsake_settings"]))?["keepsake_settings"] as? [String: Any]) ?? [:]
            let secrets = ((try? db.settings([RecordDatabase.secretsKey]))?[RecordDatabase.secretsKey] as? [String: Any]) ?? [:]
            let allowed = NetworkPolicy.allowedHosts(settings: settings, hasAIKey: !((secrets["aiApiKey"] as? String) ?? "").isEmpty)
            guard let url = URL(string: urlString), url.scheme == "https", let host = url.host(), allowed.contains(host) else {
                finish(0, "", "Keepsake isn't allowed to contact \(URL(string: urlString)?.host() ?? "that address"). Turn it on in Settings first.")
                return
            }
            var request = URLRequest(url: url)
            request.httpMethod = method
            request.httpShouldHandleCookies = false
            for (k, v) in (try? JSONSerialization.jsonObject(with: Data(headersJSON.utf8)) as? [String: String]) ?? [:] { request.setValue(v, forHTTPHeaderField: k) }
            if !body.isEmpty { request.httpBody = Data(body.utf8) }
            Task {
                do {
                    let (status, data) = try await transport.send(request)
                    finish(status, String(decoding: data, as: UTF8.self), nil)
                } catch {
                    finish(0, "", "Couldn't reach \(host). \(error.localizedDescription)")
                }
            }
        }
    }

    private func recordBridge(in ctx: JSContext) -> JSValue {
        let db = database
        let o = JSValue(newObjectIn: ctx)!
        func err(_ e: Error) -> String {
            let s = "\(e)"
            return s.contains("SQLITE_FULL") || s.contains("disk is full") ? "full: \(s)" : s
        }
        let strings: (String) -> [String] = { (try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String]) ?? [] }
        let all: @convention(block) (String) -> String = { (try? db.all($0)) ?? "[]" }
        let get: @convention(block) (String, String) -> String? = { try? db.get($0, $1) }
        let byIndex: @convention(block) (String, String, String) -> String = { (try? db.byIndex($0, $1, $2)) ?? "[]" }
        let count: @convention(block) (String) -> Int = { (try? db.count($0)) ?? 0 }
        // Items arrive as [body, fact] pairs; other stores as bodies.
        let put: @convention(block) (String, String) -> String = { store, json in
            do {
                let raw = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [Any] ?? []
                let bodies = raw.map { ($0 as? [Any])?.first as? String ?? $0 as? String ?? "" }
                let facts = raw.map { ($0 as? [Any]).flatMap { $0.count > 1 ? $0[1] as? String : nil } }
                try db.put(store, bodies: bodies, facts: facts)
                return ""
            } catch { return err(error) }
        }
        let missingFacts: @convention(block) () -> String = { (try? db.itemsMissingFacts()) ?? "[]" }
        let setFacts: @convention(block) (String) -> String = { json in
            do { try db.setFacts((try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: String]) ?? [:]); return "" } catch { return err(error) }
        }
        let remove: @convention(block) (String, String) -> String = { store, json in
            do { try db.remove(store, keys: strings(json)); return "" } catch { return err(error) }
        }
        let swap: @convention(block) (String, String) -> String = { store, json in
            do {
                let raw = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[Any]] ?? []
                let ops = raw.map { (key: $0[0] as? String ?? "", expected: $0[1] as? String, next: $0[2] as? String, fact: $0.count > 3 ? $0[3] as? String : nil) }
                return try db.swap(store, ops: ops) ? "" : "conflict"
            } catch { return err(error) }
        }
        let clear: @convention(block) (String) -> String = { json in
            do { try db.clear(strings(json)); return "" } catch { return err(error) }
        }
        for (k, v) in [("all", all as Any), ("get", get), ("byIndex", byIndex), ("count", count), ("put", put),
                       ("remove", remove), ("swap", swap), ("clear", clear), ("missingFacts", missingFacts), ("setFacts", setFacts)] {
            o.setObject(v, forKeyedSubscript: k as NSString)
        }
        return o
    }

    private func settingsBridge(in ctx: JSContext) -> JSValue {
        let db = database
        let o = JSValue(newObjectIn: ctx)!
        let get: @convention(block) (String) -> String = { json in
            let keys = (try? JSONSerialization.jsonObject(with: Data(json.utf8), options: .fragmentsAllowed)) as? [String]
            let out = (try? db.settings(keys)) ?? [:]
            return String(decoding: (try? JSONSerialization.data(withJSONObject: out)) ?? Data("{}".utf8), as: UTF8.self)
        }
        let set: @convention(block) (String) -> String = { json in
            do {
                let obj = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] ?? [:]
                try db.setSettings(obj)
                return ""
            } catch { return "\(error)" }
        }
        let remove: @convention(block) (String) -> String = { json in
            do { try db.removeSettings((try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String]) ?? []); return "" } catch { return "\(error)" }
        }
        let clear: @convention(block) () -> String = {
            do { try db.clearSettings(); return "" } catch { return "\(error)" }
        }
        for (k, v) in [("get", get as Any), ("set", set), ("remove", remove), ("clear", clear)] {
            o.setObject(v, forKeyedSubscript: k as NSString)
        }
        return o
    }

    /// Calls a shared function by path ("store.init", "KeepsakeCore.kinds.kindOf") with JSON-encodable
    /// arguments, and returns its result as JSON text.
    public func callJSON(_ path: String, argsJSON: String = "[]") async throws -> String {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<String, Error>) in
            queue.async { [self] in
                var finished = false
                let ok: @convention(block) (String) -> Void = { v in
                    guard !finished else { return }
                    finished = true
                    cont.resume(returning: v)
                }
                let fail: @convention(block) (String) -> Void = { m in
                    guard !finished else { return }
                    finished = true
                    let parts = m.components(separatedBy: "|")
                    let message = parts.dropLast(parts.count > 1 ? 1 : 0).joined(separator: "|")
                    cont.resume(throwing: parts.last == "StorageFullError" ? CoreError.storageFull(message) : CoreError.failed(message))
                }
                context.objectForKeyedSubscript("__call").call(withArguments: [path, argsJSON, unsafeBitCast(ok, to: AnyObject.self), unsafeBitCast(fail, to: AnyObject.self)])
            }
        }
    }

    /// `callJSON` with Foundation values in and out.
    @discardableResult
    public func call(_ path: String, _ args: [Any] = []) async throws -> Any {
        let json = String(decoding: try JSONSerialization.data(withJSONObject: args, options: .fragmentsAllowed), as: UTF8.self)
        let out = try await callJSON(path, argsJSON: json)
        return try JSONSerialization.jsonObject(with: Data(out.utf8), options: .fragmentsAllowed)
    }

    /// `callJSON` decoding the result.
    public func call<T: Decodable>(_ path: String, _ args: [Any] = [], as: T.Type) async throws -> T {
        let json = String(decoding: try JSONSerialization.data(withJSONObject: args, options: .fragmentsAllowed), as: UTF8.self)
        return try JSONDecoder().decode(T.self, from: Data(try await callJSON(path, argsJSON: json).utf8))
    }
}

/// A JS value carried across a concurrency boundary; only touched again on the core's serial queue.
final class JSBox: @unchecked Sendable {
    let value: JSValue
    init(_ value: JSValue) { self.value = value }
}
