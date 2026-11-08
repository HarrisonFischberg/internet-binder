import OSLog
import SwiftUI
import UIKit

/// Settings → "Send Debug Logs to support@rarecreatures.app": a draft in the user's own email app with what
/// they typed, the app and device, and the errors logged since the app opened. The app sends nothing itself;
/// the user reads the draft and taps Send.
enum SupportMail {
    nonisolated static let address = "support@rarecreatures.app"
    /// Most log text put in the mailto: link; some email apps refuse or cut much longer links.
    private nonisolated static let logLimit = 6_000

    /// Opens the draft. If no email app opens, copies it instead and returns false.
    @MainActor static func send(problem: String) async -> Bool {
        let text = await Task.detached { body(problem: problem) }.value
        if let url = url(body: text), await UIApplication.shared.open(url) { return true }
        UIPasteboard.general.string = text
        return false
    }

    nonisolated static func body(problem: String) -> String {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return [
            problem.trimmingCharacters(in: .whitespacesAndNewlines),
            "",
            "--- Debug logs (you can edit or delete anything below) ---",
            "App: \(appName) \(info("CFBundleShortVersionString")) (\(info("CFBundleVersion")))",
            "Device: \(model), iOS \(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
            "Language: \(Locale.current.identifier)",
            "Written: \(Date.now.ISO8601Format())",
            "",
            "Errors logged since the app opened:",
            recentErrors(),
        ].joined(separator: "\n")
    }

    nonisolated static func url(body: String) -> URL? {
        let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        func encode(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: unreserved) ?? "" }
        return URL(string: "mailto:\(address)?subject=\(encode("\(appName) debug logs"))&body=\(encode(body))")
    }

    private nonisolated static func info(_ key: String) -> String { Bundle.main.infoDictionary?[key] as? String ?? "?" }
    private nonisolated static var appName: String {
        Bundle.main.infoDictionary?["CFBundleDisplayName"] as? String ?? info("CFBundleName")
    }

    /// Hardware model, e.g. "iPhone17,1".
    private nonisolated static var model: String {
        var sys = utsname()
        uname(&sys)
        return withUnsafeBytes(of: sys.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
    }

    /// This launch's error and fault entries (Apple's frameworks log theirs here too), newest kept.
    private nonisolated static func recentErrors() -> String {
        guard let store = try? OSLogStore(scope: .currentProcessIdentifier),
              let entries = try? store.getEntries() else { return "(the log could not be read)" }
        let errors = entries.compactMap { $0 as? OSLogEntryLog }.filter { $0.level == .error || $0.level == .fault }
        // Newest first, a repeated message once with its count (typing the note alone logs the same keyboard
        // warnings many times), until the limit.
        var kept: [(time: String, text: String, count: Int)] = []
        var index: [String: Int] = [:]
        var size = 0
        for e in errors.reversed() {
            let text = "\(e.subsystem.isEmpty ? e.sender : e.subsystem): \(e.composedMessage.prefix(200))"
            if let i = index[text] { kept[i].count += 1; continue }
            size += text.count + 12
            if size > logLimit { break }
            index[text] = kept.count
            kept.append((e.date.formatted(date: .omitted, time: .standard), text, 1))
        }
        return kept.isEmpty ? "none" : kept.reversed().map { "\($0.time) \($0.text)\($0.count > 1 ? " (×\($0.count))" : "")" }.joined(separator: "\n")
    }
}

/// The Settings section: a "What went wrong?" field and the Send button.
struct SendDebugLogsSection: View {
    /// The note typed so far, kept if Settings closes.
    @AppStorage("supportDraft") private var problem = ""
    @State private var sending = false
    @State private var sendFailed = false

    var body: some View {
        Section {
            TextField("What went wrong?", text: $problem, axis: .vertical)
                .lineLimit(3...8)
                .accessibilityIdentifier("settings.support.problem")
            Button(sending ? "Gathering logs…" : "Send Debug Logs") {
                Task {
                    sending = true
                    sendFailed = !(await SupportMail.send(problem: problem))
                    if !sendFailed { problem = "" }
                    sending = false
                }
            }
            .disabled(sending || problem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("settings.support.send")
        } header: {
            Text("Send Debug Logs to \(SupportMail.address)").textCase(nil)
        } footer: {
            Text(sendFailed
                 ? "No email app opened. The report is copied: paste it into an email to \(SupportMail.address)."
                 : "Opens your email app with what you wrote, the app version, your device and this session's error logs. Nothing is sent until you tap Send.")
        }
    }
}
