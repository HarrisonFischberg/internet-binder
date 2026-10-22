#if canImport(UIKit)
import UIKit
import Vision

/// A screenshot or photo shared to Patchwork: a small copy of the picture (Chrome keeps thumbnails as
/// `data:` images up to 400 KB) and its text, read on this device by Vision. Nothing is sent anywhere.
public enum ImageCapture {
    /// The product to save: the first line of text as the title, all of it as the description.
    public static func product(from image: UIImage) async -> [String: Any] {
        let text = await recognizeText(in: image)
        let lines = text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        var p: [String: Any] = ["sparse": true, "title": lines.first.map { String($0.prefix(120)) } ?? "Picture"]
        if !text.isEmpty { p["description"] = String(text.prefix(2200)) }
        if let thumb = dataURL(image) { p["image"] = thumb; p["images"] = [thumb] }
        return p
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
        guard let cg = image.cgImage else { return "" }
        return await withCheckedContinuation { cont in
            let request = VNRecognizeTextRequest { req, _ in
                let lines = (req.results as? [VNRecognizedTextObservation] ?? [])
                    .sorted { $0.boundingBox.maxY > $1.boundingBox.maxY }
                    .compactMap { $0.topCandidates(1).first?.string }
                cont.resume(returning: lines.joined(separator: "\n"))
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            do { try VNImageRequestHandler(cgImage: cg, orientation: .up).perform([request]) } catch { cont.resume(returning: "") }
        }
    }
}
#endif
