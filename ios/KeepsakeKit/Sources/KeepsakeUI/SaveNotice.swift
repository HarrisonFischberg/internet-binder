#if canImport(UIKit)
import Foundation
import UserNotifications

/// "Saved to Recipes": a notification that drops in from the top after you save from the Share Sheet.
/// Tapping it opens that save in Bowerbird (keepsake://save/<id>, the widgets' link). On unless turned
/// off in Settings; the app asks for permission, the Share Extension only posts.
public enum SaveNotice {
    static let enabledKey = "ks.saveNotice"

    public static var enabled: Bool {
        get { Appearance.defaults.object(forKey: enabledKey) as? Bool ?? true }
        set { Appearance.defaults.set(newValue, forKey: enabledKey) }
    }

    public static func link(_ id: String) -> URL { URL(string: "keepsake://save/\(id)")! }

    /// Where a tapped notification goes.
    public static func link(from info: [AnyHashable: Any]) -> URL? { (info["link"] as? String).flatMap(URL.init(string:)) }

    /// Posts it (when on and allowed), a moment from now so it lands after the share sheet has gone.
    /// Returns once iOS has it, so the extension can close straight after.
    public static func post(id: String, title: String, destination: String) async {
        guard enabled else { return }
        let center = UNUserNotificationCenter.current()
        let status = await center.notificationSettings().authorizationStatus
        guard status == .authorized || status == .provisional || status == .ephemeral else { return }
        let c = UNMutableNotificationContent()
        c.title = "Saved to \(destination)"
        c.body = title
        c.userInfo = ["link": link(id).absoluteString]
        c.threadIdentifier = "saves"
        // The save's picture, from its local copy (the notification takes its own copy of the file).
        if let file = ThumbnailStore.shared.localFile(id) {
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("notice-\(id).jpg")
            try? FileManager.default.removeItem(at: copy)
            if (try? FileManager.default.copyItem(at: file, to: copy)) != nil,
               let picture = try? UNNotificationAttachment(identifier: "picture", url: copy) {
                c.attachments = [picture]
            }
        }
        let request = UNNotificationRequest(identifier: "save-\(id)", content: c,
                                            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
        try? await center.add(request)
    }

    /// Asks iOS once (later calls return the answer already given). True when allowed.
    @discardableResult
    public static func ask() async -> Bool {
        let center = UNUserNotificationCenter.current()
        switch await center.notificationSettings().authorizationStatus {
        case .authorized, .provisional, .ephemeral: return true
        case .denied: return false
        default: return (try? await center.requestAuthorization(options: [.alert])) ?? false
        }
    }

    /// Whether iOS has turned Bowerbird's notifications off (Settings shows how to turn them back on).
    public static func blocked() async -> Bool {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .denied
    }
}
#endif
