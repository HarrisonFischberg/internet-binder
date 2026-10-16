import Foundation

/// Reads an Instagram post or reel you shared, the way Chrome reads one (src/instagram/enrich.js
/// readPost): its public page, fetched once, with no cookies and no account, so what you get is what
/// anyone logged out sees. The page becomes the same { meta, scripts } bundle Chrome's extract.js makes,
/// and Chrome's own parser (src/instagram/post.js, through capture.js) reads the caption, creator,
/// date, hashtags and picture from it. Off when Settings → Instagram → Read post details is off
/// (Chrome's `instagram.readPostDetails`). The only request goes to www.instagram.com, for the post
/// you shared.
public enum InstagramPage {
    static let host = "www.instagram.com"

    /// A post, reel or IGTV address (instagram.com/p/…, /reel/…, /reels/…, /tv/…, also /<user>/reel/…).
    public static func isPost(_ url: String?) -> Bool {
        guard let url, let u = URL(string: url), let h = u.host()?.lowercased(),
              h == "instagram.com" || h.hasSuffix(".instagram.com") else { return false }
        return u.path.range(of: #"/(?:p|reel|reels|tv)/[A-Za-z0-9_-]{5,}"#, options: .regularExpression) != nil
    }

    /// The page for a post: always https://www.instagram.com/p|reel/<code>/ (no tracking parameters).
    static func pageURL(_ url: String) -> URL? {
        guard let u = URL(string: url),
              let r = u.path.range(of: #"/(p|reel|reels|tv)/([A-Za-z0-9_-]{5,})"#, options: .regularExpression) else { return nil }
        let parts = u.path[r].split(separator: "/")
        let kind = parts[0] == "p" || parts[0] == "tv" ? String(parts[0]) : "reel"
        return URL(string: "https://\(host)/\(kind)/\(parts[1])/")
    }

    /// Fetches the post's page and returns Chrome's bundle, or nil when it can't be read.
    public static func read(_ url: String, transport: NetworkTransport = URLSessionTransport()) async -> [String: Any]? {
        guard let page = pageURL(url) else { return nil }
        var request = URLRequest(url: page, timeoutInterval: 15)
        request.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
        // Instagram serves its full public page to a browser; this is Safari on iPhone.
        request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", forHTTPHeaderField: "User-Agent")
        guard let (status, body) = try? await transport.send(request), (200..<300).contains(status) else { return nil }
        let bundle = Self.bundle(fromHTML: String(decoding: body, as: UTF8.self))
        return bundle["loginWall"] as? Bool == true ? nil : bundle
    }

    /// Chrome's bundleFromDocument (src/instagram/post.js) without a DOM: meta tags by property or
    /// name (first wins), inline scripts that carry the post's data, the page title, and whether it's
    /// a login wall.
    public static func bundle(fromHTML html: String) -> [String: Any] {
        var meta: [String: String] = [:]
        for tag in matches(#"<meta\b[^>]*>"#, in: html) {
            guard let key = attribute("property", in: tag) ?? attribute("name", in: tag),
                  let value = attribute("content", in: tag), !key.isEmpty, !value.isEmpty, meta[key] == nil else { continue }
            meta[key] = decodeEntities(value)
        }
        var scripts: [[String: String]] = []
        let scriptRE = try! NSRegularExpression(pattern: #"<script\b([^>]*)>([\s\S]*?)</script>"#, options: [.caseInsensitive])
        let ns = html as NSString
        let keys = try! NSRegularExpression(pattern: #""caption"|"product_tags"|"edge_media_to_caption"|"@type"|"owner"|"shortcode""#)
        for m in scriptRE.matches(in: html, range: NSRange(location: 0, length: ns.length)) {
            let attrs = ns.substring(with: m.range(at: 1))
            if attribute("src", in: "<x \(attrs)>") != nil { continue }
            let type = attribute("type", in: "<x \(attrs)>") ?? ""
            let text = ns.substring(with: m.range(at: 2))
            guard text.count >= 20, text.utf16.count <= 3_000_000,
                  keys.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil else { continue }
            scripts.append(["type": type, "text": text])
        }
        let title = matches(#"<title\b[^>]*>[\s\S]*?</title>"#, in: html).first
            .map { $0.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression) }.map(decodeEntities) ?? ""
        let loginWall = meta["og:description"] == nil
            && html.range(of: #"name="username"|/accounts/login"#, options: .regularExpression) != nil
        return ["meta": meta, "scripts": scripts, "title": title, "loginWall": loginWall]
    }

    private static func matches(_ pattern: String, in s: String) -> [String] {
        let re = try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
        let ns = s as NSString
        return re.matches(in: s, range: NSRange(location: 0, length: ns.length)).map { ns.substring(with: $0.range) }
    }

    private static func attribute(_ name: String, in tag: String) -> String? {
        let re = try! NSRegularExpression(pattern: #"\s\#(name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))"#, options: [.caseInsensitive])
        let ns = tag as NSString
        guard let m = re.firstMatch(in: tag, range: NSRange(location: 0, length: ns.length)) else { return nil }
        for i in 1...3 where m.range(at: i).location != NSNotFound { return ns.substring(with: m.range(at: i)) }
        return nil
    }

    static func decodeEntities(_ s: String) -> String {
        guard s.contains("&") else { return s }
        var out = s
        let re = try! NSRegularExpression(pattern: #"&#(x?)([0-9a-fA-F]+);"#)
        for m in re.matches(in: s, range: NSRange(location: 0, length: (s as NSString).length)).reversed() {
            let ns = out as NSString
            let hex = ns.substring(with: m.range(at: 1)) == "x"
            let num = ns.substring(with: m.range(at: 2))
            if let code = UInt32(num, radix: hex ? 16 : 10), let scalar = Unicode.Scalar(code) {
                out = ns.replacingCharacters(in: m.range, with: String(Character(scalar)))
            }
        }
        for (entity, char) in [("&quot;", "\""), ("&#39;", "'"), ("&apos;", "'"), ("&lt;", "<"), ("&gt;", ">"), ("&nbsp;", " "), ("&amp;", "&")] {
            out = out.replacingOccurrences(of: entity, with: char)
        }
        return out
    }
}

extension Library {
    /// What a share from another app becomes: a link, and for an Instagram post its public page read
    /// as Chrome reads it (unless Read post details is off), so a recipe reel arrives as a Recipe.
    public func sharedProduct(url: String?, title: String?, text: String?, transport: NetworkTransport = URLSessionTransport()) async -> [String: Any] {
        var p = Self.sharedProduct(url: url, title: title, text: text)
        guard let url, InstagramPage.isPost(url) else { return p }
        let settings = (try? await settings()) ?? [:]
        if (settings["instagram"] as? [String: Any])?["readPostDetails"] as? Bool == false { return p }
        guard let bundle = await InstagramPage.read(url, transport: transport) else { return p }
        let meta = bundle["meta"] as? [String: String] ?? [:]
        p["igBundle"] = bundle
        p["sparse"] = false
        // The title Chrome's import gives a post (post.js titleFromCaption), not Instagram's
        // "Name on Instagram: …" line.
        let post = (try? await core.call("KeepsakeCore.post.parsePostBundle", [bundle, url])) as? [String: Any]
        if title == nil || title?.isEmpty == true {
            if let t = post?["title"] as? String, !t.isEmpty { p["title"] = t }
            else if let t = meta["og:title"], !t.isEmpty { p["title"] = t }
        }
        if let d = meta["og:description"], p["description"] == nil { p["description"] = d }
        if let img = meta["og:image"], !img.isEmpty { p["image"] = img }
        return p
    }
}
