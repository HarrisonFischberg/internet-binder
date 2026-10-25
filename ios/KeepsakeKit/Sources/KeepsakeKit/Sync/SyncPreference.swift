import Foundation

/// Whether iCloud sync is on for this device, shared by the app and its extensions (the App Group's
/// defaults). Nil until decided: a new install turns it on by itself, a device that already has a library
/// asks once first (the plan's "First sync" section).
public enum SyncPreference {
    static let key = "ks.icloudSync"
    nonisolated(unsafe) static var defaults = UserDefaults(suiteName: "group.com.harrisonfischberg.keepsake") ?? .standard

    public static var choice: Bool? {
        get { defaults.object(forKey: key) as? Bool }
        set { if let newValue { defaults.set(newValue, forKey: key) } else { defaults.removeObject(forKey: key) } }
    }

    public static var isOn: Bool { choice == true }
}
