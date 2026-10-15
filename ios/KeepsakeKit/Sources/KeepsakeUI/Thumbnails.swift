#if canImport(UIKit)
import UIKit
import KeepsakeKit

/// Small local copies of save pictures (≤ 640 px JPEG), so a save keeps its picture after the site or
/// post is gone. Made from the same request that shows the picture; nothing extra is fetched.
/// Kept beside the library in the App Group; not part of the record, not exported, not synced.
public final class ThumbnailStore: @unchecked Sendable {
    public static let shared = ThumbnailStore()
    private let dir: URL?
    private let cache = NSCache<NSString, UIImage>()
    private let session: URLSession

    init() {
        dir = (try? RecordDatabase.defaultPath()).map { URL(fileURLWithPath: $0).deletingLastPathComponent().appendingPathComponent("thumbs", isDirectory: true) }
        if let dir { try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 20
        session = URLSession(configuration: config)
        cache.countLimit = 400
    }

    private func file(_ id: String) -> URL? { dir?.appendingPathComponent("\(id).jpg") }

    public func cached(_ id: String) -> UIImage? {
        if let img = cache.object(forKey: id as NSString) { return img }
        guard let url = file(id), let img = UIImage(contentsOfFile: url.path) else { return nil }
        cache.setObject(img, forKey: id as NSString)
        return img
    }

    /// Loads the picture from its site (as a web page would), keeps a small copy, returns it.
    public func load(_ id: String, from remote: URL) async -> UIImage? {
        if let img = cached(id) { return img }
        guard let (data, response) = try? await session.data(from: remote),
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false,
              let full = UIImage(data: data) else { return nil }
        let small = Self.downscale(full, to: 640)
        if let url = file(id), let jpeg = small.jpegData(compressionQuality: 0.8) { try? jpeg.write(to: url, options: .atomic) }
        cache.setObject(small, forKey: id as NSString)
        return small
    }

    /// Erase everything: every local picture goes too.
    public func removeAll() {
        cache.removeAllObjects()
        if let dir { try? FileManager.default.removeItem(at: dir); try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }
    }

    public func remove(_ id: String) {
        cache.removeObject(forKey: id as NSString)
        if let url = file(id) { try? FileManager.default.removeItem(at: url) }
    }

    static func downscale(_ image: UIImage, to side: CGFloat) -> UIImage {
        let scale = min(1, side / max(image.size.width, image.size.height))
        guard scale < 1 else { return image }
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }
}
#endif
