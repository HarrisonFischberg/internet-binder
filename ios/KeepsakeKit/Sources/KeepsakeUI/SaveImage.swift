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
        if let local = Self.dataImage(save.image) {
            Image(uiImage: local).resizable().scaledToFill()
        } else if let s = save.image, let url = URL(string: s), url.scheme == "https" || url.scheme == "http" {
            // The local copy if there is one (so the picture outlives its site), else the site's, kept as it loads.
            ZStack {
                if let kept { Image(uiImage: kept).resizable().scaledToFill().transition(.opacity) } else { tile(kind) }
            }
            .task(id: save.id) {
                if let img = ThumbnailStore.shared.cached(save.id) { kept = img; return }
                let img = await ThumbnailStore.shared.load(save.id, from: url)
                withAnimation(KSMotion.quiet) { kept = img }
            }
        } else {
            tile(kind)
        }
    }

    private func tile(_ kind: KindStyle) -> some View {
        ZStack {
            kind.color.opacity(0.12)
            t.paper.opacity(0.4)
            if showsSymbol { Image(systemName: kind.symbol).font(.system(size: symbolSize, weight: .light)).foregroundStyle(kind.color.opacity(0.8)) }
        }
        .accessibilityHidden(true)
    }

    static func dataImage(_ s: String?) -> UIImage? {
        guard let s, s.hasPrefix("data:image/"), let comma = s.firstIndex(of: ","), s[..<comma].hasSuffix(";base64"),
              let data = Data(base64Encoded: String(s[s.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }
}
#endif
