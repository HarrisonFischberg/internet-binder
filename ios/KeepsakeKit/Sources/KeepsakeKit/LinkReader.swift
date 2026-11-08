import Foundation

/// Reads a link shared from another app (TikTok, YouTube, Reddit, Bluesky, Pinterest, Threads, Facebook,
/// Vimeo, Spotify, SoundCloud, or any web page) the way `XPost` reads a post on X: from the public data
/// the site publishes for embeds and link previews, with no cookies and no account. Which addresses to
/// ask and how to read the answers are the shared code's (src/shared/linkReader.js linkRequests,
/// linkFollowUp, parseLink), so Chrome, iOS and the tests read a link alike. Off when Settings → Links →
/// Read links you share is off (`links.readShared`). Short links take two rounds: the page, which says
/// where the link points, then that post's own data.
public enum LinkReader {
    /// Some sites only serve their full page to a browser; this is Safari on iPhone (as `InstagramPage`).
    static let browserUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    /// Each request's own deadline; they run side by side, so a round takes at most this long.
    static let timeout: TimeInterval = 8
    /// A page bigger than this is trimmed to what's read from it (see `slim`) before the shared code sees it.
    static let slimAbove = 400_000

    /// A web address this reader is for: not Instagram or X, which have their own readers.
    public static func canRead(_ url: String?) -> Bool {
        guard let url, let u = URL(string: url), let scheme = u.scheme?.lowercased(), scheme == "https" || scheme == "http",
              let host = u.host()?.lowercased(), host.contains(".") else { return false }
        if host == "instagram.com" || host.hasSuffix(".instagram.com") { return false }
        return !XPost.isPost(url)
    }

    /// Fetches what the shared code asks for and returns the answers by key ({ page, oembed, post, … },
    /// plus resolvedUrl for a short link), or nil when nothing answered.
    static func read(_ url: String, core: KeepsakeCore, transport: NetworkTransport) async -> [String: Any]? {
        guard let first = (try? await core.call("KeepsakeCore.linkReader.linkRequests", [url])) as? [[String: Any]], !first.isEmpty else { return nil }
        var bundle = await fetch(first, transport: transport)
        if let next = (try? await core.call("KeepsakeCore.linkReader.linkFollowUp", [url, bundle])) as? [String: Any] {
            if let real = next["url"] as? String, !real.isEmpty { bundle["resolvedUrl"] = real }
            if let more = next["requests"] as? [[String: Any]], !more.isEmpty {
                bundle.merge(await fetch(more, transport: transport)) { have, _ in have }
            }
        }
        return bundle.keys.contains(where: { $0 != "resolvedUrl" }) ? bundle : nil
    }

    /// Every request at once; an answer that fails, isn't 2xx or doesn't parse is left out.
    static func fetch(_ requests: [[String: Any]], transport: NetworkTransport) async -> [String: Any] {
        struct Ask: Sendable { let key: String; let url: URL; let html: Bool; let browser: Bool; let keep: [String] }
        struct Answer: Sendable { let key: String; let html: String?; let json: Data? }
        let asks: [Ask] = requests.compactMap { r in
            guard let key = r["key"] as? String, let s = r["url"] as? String, let u = URL(string: s), u.scheme == "https" else { return nil }
            return Ask(key: key, url: u, html: (r["as"] as? String) == "html", browser: r["browser"] as? Bool ?? false, keep: r["keep"] as? [String] ?? [])
        }
        let answers = await withTaskGroup(of: Answer?.self) { group in
            for a in asks {
                group.addTask {
                    var request = URLRequest(url: a.url, timeoutInterval: LinkReader.timeout)
                    request.httpShouldHandleCookies = false
                    request.setValue(a.html ? "text/html,application/xhtml+xml" : "application/json", forHTTPHeaderField: "Accept")
                    request.setValue("en-US,en;q=0.8", forHTTPHeaderField: "Accept-Language")
                    if a.browser { request.setValue(LinkReader.browserUA, forHTTPHeaderField: "User-Agent") }
                    guard let answer = try? await transport.send(request, limit: 8_000_000), (200..<300).contains(answer.status), !answer.body.isEmpty else { return nil }
                    if a.html { return Answer(key: a.key, html: LinkReader.slim(String(decoding: answer.body, as: UTF8.self), keep: a.keep), json: nil) }
                    return Answer(key: a.key, html: nil, json: answer.body)
                }
            }
            var out: [Answer] = []
            for await a in group { if let a { out.append(a) } }
            return out
        }
        var out: [String: Any] = [:]
        for a in answers {
            if let html = a.html { out[a.key] = html; continue }
            guard let data = a.json, let json = try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed),
                  json is [String: Any] || json is [Any] else { continue }
            out[a.key] = json
        }
        return out
    }

    /// A big page trimmed to what linkReader.js reads from it: its <head> (tags, title, links), its
    /// schema.org scripts, the inline scripts carrying the post's data (`keep` markers, e.g.
    /// "ytInitialPlayerResponse"), and Reddit's <shreddit-post> tag. Keeps the share sheet light.
    static func slim(_ html: String, keep: [String]) -> String {
        guard html.utf8.count > slimAbove else { return html }
        let ns = html as NSString
        var parts: [String] = []
        let headEnd = ns.range(of: "</head>", options: .caseInsensitive)
        let head = headEnd.location != NSNotFound ? ns.substring(to: min(headEnd.location, 600_000)) : ns.substring(to: min(ns.length, 200_000))
        parts.append(head)
        let scriptRE = try! NSRegularExpression(pattern: #"<script\b([^>]*)>([\s\S]*?)</script>"#, options: [.caseInsensitive])
        let start = headEnd.location != NSNotFound ? headEnd.location : 0
        for m in scriptRE.matches(in: html, range: NSRange(location: start, length: ns.length - start)) {
            let attrs = ns.substring(with: m.range(at: 1))
            let body = ns.substring(with: m.range(at: 2))
            let wanted = attrs.range(of: "ld+json", options: .caseInsensitive) != nil
                || keep.contains(where: { attrs.contains($0) || body.prefix(400).contains($0) || body.contains($0) })
            if wanted, body.utf16.count <= 4_000_000 { parts.append(ns.substring(with: m.range)) }
        }
        if let r = html.range(of: #"<shreddit-post\b[^>]*>"#, options: .regularExpression) { parts.append(String(html[r])) }
        return parts.joined(separator: "\n")
    }
}

extension Library {
    /// A shared link with what its site publishes attached (`linkBundle`, read in capture.js), unless
    /// Read links you share is off or nothing answered: then the product is returned as it was, saying why.
    public func withLinkRead(_ product: [String: Any], transport: NetworkTransport = URLSessionTransport()) async -> [String: Any] {
        guard let url = (product["canonicalUrl"] as? String) ?? (product["url"] as? String), LinkReader.canRead(url) else { return product }
        var p = product
        let settings = (try? await settings()) ?? [:]
        if (settings["links"] as? [String: Any])?["readShared"] as? Bool == false { p["linkRead"] = "off"; return p }
        try? await prepare()
        guard let bundle = await LinkReader.read(url, core: core, transport: transport) else { p["linkRead"] = "none"; return p }
        p["linkBundle"] = bundle
        p["linkUrl"] = url
        return p
    }
}
