#if canImport(UIKit)
import SwiftUI
import UIKit
import KeepsakeKit

/// A save's picture: its local thumbnail (`data:`), else the image on its site (loaded the way a web
/// page loads it, as PRIVACY.md describes), else a tile in the kind's colour with its symbol.
/// Never a made-up picture.
public struct SaveImage: View {
    let save: Save
    var symbolSize: CGFloat = 30
    var showsSymbol = true
    @Environment(\.ks) private var t
    @State private var kept: UIImage?
    public init(_ save: Save, symbolSize: CGFloat = 30, showsSymbol: Bool = true) { self.save = save; self.symbolSize = symbolSize; self.showsSymbol = showsSymbol }

    public var body: some View {
        let kind = KindStyle(save.kind)
        if let local = Self.dataImage(save.image, id: save.id) {
            filled(local)
        } else if let s = save.image, let url = URL(string: s), url.scheme == "https" || url.scheme == "http" {
            // The local copy if there is one (so the picture outlives its site), else the site's, kept as it loads.
            // A picture already in memory shows on the first frame, so a card scrolled back into view
            // never flashes its tile; anything else is read and decoded off the main thread.
            let ready = kept ?? ThumbnailStore.shared.memory(save.id)
            ZStack {
                if let ready { filled(ready).transition(.opacity) } else { tile(kind) }
            }
            .task(id: save.id) {
                guard ready == nil else { return }
                let img = await ThumbnailStore.shared.load(save.id, from: url)
                withAnimation(KSMotion.quiet) { kept = img }
            }
        } else {
            tile(kind)
        }
    }

    /// Fills whatever space the card gives it, cropped: a wide photo never widens its card. Taps are
    /// cropped too (clipping only crops what's drawn), so a tall photo's hidden overflow can't take a
    /// tap meant for the filter chips above its card.
    private func filled(_ image: UIImage) -> some View {
        Color.clear
            .overlay { Image(uiImage: image).resizable().scaledToFill().allowsHitTesting(false) }
            .clipped()
            .contentShape(Rectangle())
    }

    private func tile(_ kind: KindStyle) -> some View {
        ZStack {
            kind.color.opacity(0.12)
            t.paper.opacity(0.4)
            if showsSymbol { Image(systemName: kind.symbol).font(.system(size: symbolSize, weight: .light)).foregroundStyle(kind.color.opacity(0.8)) }
        }
        .accessibilityHidden(true)
    }

    /// Decoded once per picture (not on every redraw while scrolling), ready to draw.
    nonisolated(unsafe) private static let decoded = NSCache<NSString, UIImage>()

    static func dataImage(_ s: String?, id: String) -> UIImage? {
        guard let s, s.hasPrefix("data:image/") else { return nil }
        let key = "\(id):\(s.utf8.count)" as NSString
        if let img = decoded.object(forKey: key) { return img }
        guard let comma = s.firstIndex(of: ","), s[..<comma].hasSuffix(";base64"),
              let data = Data(base64Encoded: String(s[s.index(after: comma)...])), let img = UIImage(data: data) else { return nil }
        let ready = img.preparingForDisplay() ?? img
        decoded.setObject(ready, forKey: key)
        return ready
    }
}
#endif
