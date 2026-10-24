import Foundation

/// The only network Internet Binder's shared code can reach on Apple devices (replica/m3/decisions.md D22).
/// Every request is checked against an allowlist built from the person's settings at that moment:
/// their AI provider's host while Optional AI is on and a key is set, and each Lookup they turned on.
/// Nothing else is reachable: no Internet Binder server, no analytics. Requests carry no cookies and nothing is cached.
public enum NetworkPolicy {
    /// Lookups (lookups.js LOOKUP_SOURCES) and the hosts their requests go to.
    public static let lookupHosts: [String: String] = [
        "places": "nominatim.openstreetmap.org",
        "media": "www.wikidata.org",
        "books": "openlibrary.org",
    ]
    static let providerHosts = ["openai": "api.openai.com", "anthropic": "api.anthropic.com"]

    public static func allowedHosts(settings: [String: Any], hasAIKey: Bool) -> Set<String> {
        var hosts = Set<String>()
        let ai = settings["ai"] as? [String: Any] ?? [:]
        if ai["on"] as? Bool == true, hasAIKey {
            let base = (ai["baseUrl"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            if let base, let url = URL(string: base), url.scheme == "https", let host = url.host() { hosts.insert(host) }
            else if base == nil, let host = providerHosts[ai["provider"] as? String ?? "openai"] { hosts.insert(host) }
        }
        let lookups = settings["lookups"] as? [String: Any] ?? [:]
        for (key, host) in lookupHosts where lookups[key] as? Bool == true { hosts.insert(host) }
        return hosts
    }
}

/// How a request leaves the device. Tests swap in a fake.
public protocol NetworkTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (status: Int, body: Data)
    /// Like `send`, but nil once the body passes `limit` bytes, without reading the rest.
    func send(_ request: URLRequest, limit: Int) async throws -> (status: Int, body: Data)?
}

extension NetworkTransport {
    public func send(_ request: URLRequest, limit: Int) async throws -> (status: Int, body: Data)? {
        let r = try await send(request)
        return r.body.count <= limit ? r : nil
    }
}

public struct URLSessionTransport: NetworkTransport {
    let session: URLSession
    public init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCache = nil
        config.timeoutIntervalForRequest = 45
        session = URLSession(configuration: config)
    }
    public func send(_ request: URLRequest) async throws -> (status: Int, body: Data) {
        let (data, response) = try await session.data(for: request)
        return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
    }
    public func send(_ request: URLRequest, limit: Int) async throws -> (status: Int, body: Data)? {
        let (bytes, response) = try await session.bytes(for: request)
        // A big file (a video the AI's search found) is never downloaded just to be thrown away.
        if response.expectedContentLength > Int64(limit) { bytes.task.cancel(); return nil }
        var data = Data()
        for try await byte in bytes {
            data.append(byte)
            if data.count > limit { bytes.task.cancel(); return nil }
        }
        return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
    }
}
