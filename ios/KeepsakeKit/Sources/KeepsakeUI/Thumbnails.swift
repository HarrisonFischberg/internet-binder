#if canImport(UIKit)
import UIKit
import ImageIO
import KeepsakeKit

/// Small local copies of save pictures (≤ 640 px JPEG), so a save keeps its picture after the site or
/// post is gone. Made from the same request that shows the picture; nothing extra is fetched.
/// Kept beside the library in the App Group; not part of the record, not exported, not synced.
public final class ThumbnailStore: @unchecked Sendable {
    public static let shared = ThumbnailStore()
    private let dir: URL?
    private let cache = NSCache<NSString, UIImage>()
    private let session: URLSession

    /// Reads the picture stored inside a save (`Library.picture`), for lists that read saves without it.
    /// Set by whoever opens the library (the app, the Share Extension).
    public var storedPicture: (@Sendable (String) -> String?)?

    /// Pictures stored inside saves are read from this library.
    public func use(_ library: Library) { storedPicture = { try? library.picture($0) } }

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

    /// The local copy's file, if there is one (a save notification's picture).
    public func localFile(_ id: String) -> URL? { file(id).flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil } }

    /// Only what's already decoded in memory: cheap enough to ask while drawing.
    public func memory(_ id: String) -> UIImage? { cache.object(forKey: id as NSString) }

    /// From memory, else the local copy on disk (decoded here, so call it off the main thread).
    public func cached(_ id: String) -> UIImage? {
        if let img = cache.object(forKey: id as NSString) { return img }
        guard let url = file(id), let img = UIImage(contentsOfFile: url.path) else { return nil }
        let ready = img.preparingForDisplay() ?? img
        cache.setObject(ready, forKey: id as NSString)
        return ready
    }

    /// The memory key for a picture stored inside a save: its id and the picture's length, so a new picture
    /// (Fix with AI found a better one) is never drawn from the old one's copy.
    public static func storedKey(_ id: String, _ picture: String) -> String {
        let length = picture.hasPrefix(Save.storedPicturePrefix) ? String(picture.dropFirst(Save.storedPicturePrefix.count)) : String(picture.utf8.count)
        return "\(id):\(length)"
    }

    /// A picture stored inside a save (a `data:` URL, or a list's marker for one), decoded here, so call
    /// it off the main thread.
    public func stored(_ id: String, key: String, picture: String) async -> UIImage? {
        if let img = cache.object(forKey: key as NSString) { return img }
        let dataURL = picture.hasPrefix(Save.storedPicturePrefix) ? storedPicture?(id) : picture
        guard let dataURL, let comma = dataURL.firstIndex(of: ","), dataURL[..<comma].hasSuffix(";base64"),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
              let img = Self.downsample(data, to: 640) else { return nil }
        cache.setObject(img, forKey: key as NSString)
        return img
    }

    /// Loads the picture from its site (as a web page would), keeps a small copy, returns it.
    public func load(_ id: String, from remote: URL) async -> UIImage? {
        if let img = cached(id) { return img }
        guard let (data, response) = try? await session.data(from: remote),
              (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false,
              let small = Self.downsample(data, to: 640) else { return nil }
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

    /// Decodes straight to at most `side` pixels, ready to draw (ImageIO never decodes the full-size photo,
    /// which for a big product shot was tens of MB for a 640 px card).
    static func downsample(_ data: Data, to side: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceShouldCacheImmediately: true,
                  kCGImageSourceThumbnailMaxPixelSize: side,
              ] as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }

    static func downscale(_ image: UIImage, to side: CGFloat) -> UIImage {
        let scale = min(1, side / max(image.size.width, image.size.height))
        guard scale < 1 else { return image }
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }
}
#endif
