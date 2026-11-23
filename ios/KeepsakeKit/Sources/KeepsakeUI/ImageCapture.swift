#if canImport(UIKit)
import UIKit
import Vision
import ImageIO

/// A screenshot or photo shared to Internet Binder: a small copy of the picture (Chrome keeps thumbnails as
/// `data:` images up to 400 KB) and its text, read on this device by Vision. Nothing is sent anywhere.
/// Each line of text goes to the shared rules with where it sits and how tall it is (`ocr`), and they work
/// out what the picture is: which lines are the clock and the app's buttons, the name, who posted it, the
/// shop and price on a product page (src/shared/screenshot.js).
public enum ImageCapture {
    /// One line of text in the picture. `x`, `y`, `w`, `h` are fractions of the picture, `y` from the top.
    public struct Line: Sendable, Equatable {
        public let text: String
        public let x: Double, y: Double, w: Double, h: Double
    }

    /// The longest side a shared picture is read at. A screenshot is about this size already; a 48 MP photo
    /// decoded whole would take most of the memory the share sheet is allowed.
    public static let maxSide: CGFloat = 2400

    /// The product to save. The title and description are the plain reading (first line, all of it); the
    /// shared rules replace them with what `ocr` says once they've set the furniture aside.
    public static func product(from image: UIImage) async -> [String: Any] {
        let lines = await recognizeLines(in: image)
        var p: [String: Any] = ["sparse": true, "title": lines.first.map { String($0.text.prefix(120)) } ?? "Picture"]
        if !lines.isEmpty {
            p["description"] = String(lines.map(\.text).joined(separator: "\n").prefix(2200))
            p["ocr"] = ["lines": lines.map { ["text": $0.text, "x": $0.x, "y": $0.y, "w": $0.w, "h": $0.h] as [String: Any] }]
        }
        if let thumb = dataURL(image) { p["image"] = thumb; p["images"] = [thumb] }
        return p
    }

    /// A shared picture file, decoded no bigger than `maxSide` (ImageIO reads it at that size; the whole
    /// picture is never in memory) and turned upright.
    public static func load(_ url: URL, maxSide: CGFloat = maxSide) -> UIImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        return downsampled(source, maxSide: maxSide)
    }

    /// The same for picture data an app handed over directly.
    public static func load(_ data: Data, maxSide: CGFloat = maxSide) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        return downsampled(source, maxSide: maxSide)
    }

    private static func downsampled(_ source: CGImageSource, maxSide: CGFloat) -> UIImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxSide,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }

    /// JPEG `data:` URL, at most 640 px and under Chrome's 400 KB limit.
    public static func dataURL(_ image: UIImage) -> String? {
        var side: CGFloat = 640
        while side >= 160 {
            let scale = min(1, side / max(image.size.width, image.size.height))
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            let small = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
            if let jpeg = small.jpegData(compressionQuality: 0.75), jpeg.count < 380_000 {
                return "data:image/jpeg;base64," + jpeg.base64EncodedString()
            }
            side /= 2
        }
        return nil
    }

    /// Text in reading order, on device.
    public static func recognizeText(in image: UIImage) async -> String {
        await recognizeLines(in: image).map(\.text).joined(separator: "\n")
    }

    /// Each line of text with where it sits, top to bottom, on device. At most 400 lines.
    public static func recognizeLines(in image: UIImage) async -> [Line] {
        guard let cg = image.cgImage else { return [] }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)
        return await withCheckedContinuation { cont in
            let request = VNRecognizeTextRequest { req, _ in
                let lines = (req.results as? [VNRecognizedTextObservation] ?? [])
                    .sorted { $0.boundingBox.maxY > $1.boundingBox.maxY }
                    .prefix(400)
                    .compactMap { o -> Line? in
                        guard let text = o.topCandidates(1).first?.string, !text.isEmpty else { return nil }
                        let b = o.boundingBox // fractions of the picture, measured from the bottom left
                        return Line(text: text, x: b.minX, y: 1 - b.maxY, w: b.width, h: b.height)
                    }
                cont.resume(returning: Array(lines))
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            do { try VNImageRequestHandler(cgImage: cg, orientation: orientation).perform([request]) } catch { cont.resume(returning: []) }
        }
    }
}

private extension CGImagePropertyOrientation {
    /// A photo straight from the camera is stored on its side with a note saying which way is up.
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
#endif
