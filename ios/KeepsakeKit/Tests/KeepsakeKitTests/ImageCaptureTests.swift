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
}
#endif
