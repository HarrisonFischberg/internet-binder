import UIKit
import KeepsakeKit

/// Sharing a save from its screen: the system Share Sheet with the save's link. Messages also gets a
/// line saying where it came from and a pointer to Keepsake on the App Store.
enum SaveSharing {
    /// Keepsake's App Store page. Not listed yet: fill this in once it is, and Messages links to it.
    static let appStoreURL: URL? = nil

    static func messageText(for save: Save) -> String {
        let callout = appStoreURL.map { "Get Keepsake on the App Store: \($0.absoluteString)" } ?? "Keepsake for iPhone is coming soon to the App Store."
        return "Shared from Keepsake! \(save.title)\n\n\(callout)"
    }

    @MainActor static func present(_ save: Save) {
        guard let link = save.url.flatMap(URL.init(string:)) else { return }
        let sheet = UIActivityViewController(activityItems: [MessageText(save: save), link], applicationActivities: nil)
        guard let top = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first?.rootViewController else { return }
        var shown = top
        while let next = shown.presentedViewController { shown = next }
        // iPad: the sheet points at the middle of the screen's bottom edge, where the Share stamp sits.
        sheet.popoverPresentationController?.sourceView = shown.view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: shown.view.bounds.midX, y: shown.view.bounds.maxY - 80, width: 1, height: 1)
        shown.present(sheet, animated: true)
    }

    /// The words that go with the link: only in Messages (Mail gets the title as its subject; everything
    /// else, just the link).
    final class MessageText: NSObject, UIActivityItemSource {
        let text: String
        let title: String
        init(save: Save) { text = SaveSharing.messageText(for: save); title = save.title }
        func activityViewControllerPlaceholderItem(_ controller: UIActivityViewController) -> Any { "" }
        func activityViewController(_ controller: UIActivityViewController, itemForActivityType type: UIActivity.ActivityType?) -> Any? {
            type == .message ? text : nil
        }
        func activityViewController(_ controller: UIActivityViewController, subjectForActivityType type: UIActivity.ActivityType?) -> String { title }
    }
}
