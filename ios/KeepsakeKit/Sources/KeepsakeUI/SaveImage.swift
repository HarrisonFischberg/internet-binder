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
    /// The picture this card loaded, and which one it is (a save's picture can change under the card).
    @State private var kept: (key: String, image: UIImage)?
    public init(_ save: Save, symbolSize: CGFloat = 30, showsSymbol: Bool = true) { self.save = save; self.symbolSize = symbolSize; self.showsSymbol = showsSymbol }

    public var body: some View {
        let kind = KindStyle(save.kind)
        if let s = save.image, s.hasPrefix("data:image/") {
            // A picture saved on this device: decoded off the main thread (a list's save carries only a
            // marker, so the picture is read from the library first), then kept in memory.
            let key = ThumbnailStore.storedKey(save.id, s)
            picture(kind: kind, key: key) {
                await ThumbnailStore.shared.stored(save.id, key: key, picture: s)
            }
        } else if let s = save.image, let url = URL(string: s), url.scheme == "https" || url.scheme == "http" {
            // The local copy if there is one (so the picture outlives its site), else the site's, kept as it loads.
            picture(kind: kind, key: save.id) {
                await ThumbnailStore.shared.load(save.id, from: url)
            }
        } else {
            tile(kind)
        }
    }

    /// A picture already in memory shows on the first frame, so a card scrolled back into view never
    /// flashes its tile; anything else is read and decoded off the main thread.
    private func picture(kind: KindStyle, key: String, load: @escaping @Sendable () async -> UIImage?) -> some View {
        let ready = kept?.key == key ? kept?.image : ThumbnailStore.shared.memory(key)
        return ZStack {
            if let ready { filled(ready).transition(.opacity) } else { tile(kind) }
        }
        .task(id: key) {
            guard ready == nil else { return }
            let img = await load()
            withAnimation(KSMotion.quiet) { kept = img.map { (key, $0) } }
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
}
#endif
