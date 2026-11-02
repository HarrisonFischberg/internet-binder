import Foundation

/// Reads a post on X (Twitter) you shared, the way `InstagramPage` reads an Instagram post. X's own post
/// pages need a script and an account, so this asks X's public embed data for the post (what an
/// embedded post on any web page shows), with no cookies and no account: the requests and the parsing
/// are the shared code's (src/shared/xPost.js xPostRequests, parseXPost), so Chrome, iOS and the tests
/// read a post alike. Off when Settings → X → Read posts you share is off (`x.readPostDetails`).
/// The only requests go to cdn.syndication.twimg.com and publish.twitter.com, for the post you shared.
public enum XPost {
    /// x.com or twitter.com /<user>/status/<id>, /i/status/<id>, /i/web/status/<id>.
    public static func isPost(_ url: String?) -> Bool {
        guard let url, let u = URL(string: url), let h = u.host()?.lowercased() else { return false }
        let host = h.replacingOccurrences(of: #"^(www|mobile|m)\."#, with: "", options: .regularExpression)
        guard host == "x.com" || host == "twitter.com" else { return false }
        return u.path.range(of: #"^/(?:[A-Za-z0-9_]{1,15}|i(?:/web)?)/status(?:es)?/\d{5,25}(?:/|$)"#, options: .regularExpression) != nil
    }

    /// Fetches the post's embed data and returns { tweet, oembed } (either may be missing), or nil when
    /// neither answered.
    static func read(_ url: String, core: KeepsakeCore, transport: NetworkTransport) async -> [String: Any]? {
        guard let requests = (try? await core.call("KeepsakeCore.xPost.xPostRequests", [url])) as? [[String: Any]] else { return nil }
        var bundle: [String: Any] = [:]
        for r in requests {
            guard let key = r["key"] as? String, let s = r["url"] as? String, let u = URL(string: s) else { continue }
            var request = URLRequest(url: u, timeoutInterval: 10)
            request.httpShouldHandleCookies = false
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            guard let (status, body) = try? await transport.send(request), (200..<300).contains(status),
                  let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any], !json.isEmpty else { continue }
            bundle[key] = json
            // The embed data has everything the oEmbed answer has, and more.
            if key == "tweet", json["__typename"] as? String != "TweetTombstone", json["text"] != nil { break }
        }
        return bundle.isEmpty ? nil : bundle
    }
}

extension Library {
    /// A shared post on X with its embed data attached (`xBundle`, read in capture.js), unless Read
    /// posts you share is off or X didn't answer: then the product is returned as it was.
    public func withXPost(_ product: [String: Any], transport: NetworkTransport = URLSessionTransport()) async -> [String: Any] {
        guard let url = (product["canonicalUrl"] as? String) ?? (product["url"] as? String), XPost.isPost(url) else { return product }
        var p = product
        p["isXPost"] = true
        let settings = (try? await settings()) ?? [:]
        if (settings["x"] as? [String: Any])?["readPostDetails"] as? Bool == false { return p }
        try? await prepare()
        guard let bundle = await XPost.read(url, core: core, transport: transport) else { return p }
        p["xBundle"] = bundle
        p["sparse"] = false
        return p
    }
}
