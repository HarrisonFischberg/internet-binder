#if canImport(UIKit)
import Testing
import UIKit
@testable import KeepsakeUI

@Suite("Saving a screenshot")
struct ImageCaptureTests {
    func screenshot() -> UIImage {
        let size = CGSize(width: 1170, height: 1600)
        return UIGraphicsImageRenderer(size: size).image { ctx in
            UIColor.white.setFill(); ctx.fill(CGRect(origin: .zero, size: size))
            let text = "Brown butter pasta\n\n350 g rigatoni\n90 g butter\n12 sage leaves"
            text.draw(in: CGRect(x: 80, y: 120, width: 1000, height: 1200),
                      withAttributes: [.font: UIFont.systemFont(ofSize: 72, weight: .semibold), .foregroundColor: UIColor.black])
        }
    }

    @Test func readsTextOnDeviceAndKeepsASmallCopy() async throws {
        let p = await ImageCapture.product(from: screenshot())
        #expect((p["title"] as? String) == "Brown butter pasta")
        #expect((p["description"] as? String)?.contains("rigatoni") == true)
        let image = try #require(p["image"] as? String)
        #expect(image.hasPrefix("data:image/jpeg;base64,"))
        #expect(image.count < 400 * 1024 * 14 / 10, "under Chrome's thumbnail limit")
    }

    @Test func everyLineComesWithWhereItSits() async throws {
        let lines = await ImageCapture.recognizeLines(in: screenshot())
        let title = try #require(lines.first)
        #expect(title.text == "Brown butter pasta")
        #expect(title.y < 0.2, "measured from the top")
        #expect(title.h > 0.02 && title.h < 0.2)
        #expect(lines.map(\.y) == lines.map(\.y).sorted(), "top to bottom")
        let p = await ImageCapture.product(from: screenshot())
        let ocr = try #require((p["ocr"] as? [String: Any])?["lines"] as? [[String: Any]])
        #expect(ocr.count == lines.count)
        #expect((ocr.first?["text"] as? String) == "Brown butter pasta")
    }

    @Test func aBigPhotoIsReadSmallAndUpright() throws {
        let big = UIGraphicsImageRenderer(size: CGSize(width: 4000, height: 3000), format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f }()).image { ctx in
            UIColor.gray.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 4000, height: 3000))
        }
        let data = try #require(big.jpegData(compressionQuality: 0.6))
        let small = try #require(ImageCapture.load(data))
        #expect(max(small.size.width * small.scale, small.size.height * small.scale) <= ImageCapture.maxSide)
        #expect(small.size.width > small.size.height)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("ks-big-\(UUID().uuidString).jpg")
        try data.write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        #expect(ImageCapture.load(url) != nil)
        #expect(ImageCapture.load(Data("not a picture".utf8)) == nil)
    }
}
#endif
