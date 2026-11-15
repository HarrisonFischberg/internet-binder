#if canImport(UIKit)
import Foundation
import UserNotifications

/// "Saved to Recipes": a notification that drops in from the top after you save from the Share Sheet.
/// Tapping it opens that save in Internet Binder (keepsake://save/<id>, the widgets' link). On unless turned
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

    // MARK: while the share sheet is open

    /// How far ahead the standby notice is kept, and how often the open sheet pushes it back.
    public static let standbyDelay: TimeInterval = 4
    public static let standbyBeat: Duration = .milliseconds(1500)

    /// Notices are on in Settings and iOS allows them.
    public static func allowed() async -> Bool {
        guard enabled else { return false }
        let status = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        return status == .authorized || status == .provisional || status == .ephemeral
    }

    /// What the standby notice says: the save and where it went, or that nothing was saved yet.
    public enum Standby: Equatable, Sendable {
        case notSavedYet
        case saved(id: String, title: String, destination: String)
    }

    /// The share sheet's safety net. iOS can close a share sheet without a word (it stops an extension
    /// that uses too much memory, and the app you shared from can take the sheet down with its own),
    /// and then nothing told you whether the save went through. So while the sheet is open, one notice
    /// is always waiting a few seconds ahead, and the sheet keeps pushing it back (`standbyBeat`). If the
    /// sheet goes without Done or Undo, the pushing stops and the notice arrives: "Saved to …", or that
    /// it didn't save and to share it again. Done and Undo take it away (`endStandby`).
    /// `session` names one opening of the sheet; a later call with the same one replaces the notice.
    public static func standby(_ session: String, _ what: Standby) async {
        let c = UNMutableNotificationContent()
        switch what {
        case .notSavedYet:
            c.title = "Not saved yet"
            c.body = "Internet Binder closed before it could finish. Share it again to save it."
        case .saved(let id, let title, let destination):
            c.title = destination.isEmpty ? "Saved to Internet Binder" : "Saved to \(destination)"
            c.body = title
            c.userInfo = ["link": link(id).absoluteString]
        }
        c.threadIdentifier = "saves"
        let request = UNNotificationRequest(identifier: standbyID(session), content: c,
                                            trigger: UNTimeIntervalNotificationTrigger(timeInterval: standbyDelay, repeats: false))
        try? await UNUserNotificationCenter.current().add(request)
    }

    /// Done or Undo: the standby notice isn't needed (and one that already arrived, because the sheet sat
    /// behind another app for a while, makes way for the real one).
    public static func endStandby(_ session: String) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [standbyID(session)])
        center.removeDeliveredNotifications(withIdentifiers: [standbyID(session)])
    }

    static func standbyID(_ session: String) -> String { "share-\(session)" }

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

    /// Whether iOS has turned Internet Binder's notifications off (Settings shows how to turn them back on).
    public static func blocked() async -> Bool {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .denied
    }
}
#endif
