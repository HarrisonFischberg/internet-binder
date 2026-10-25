//
//  SafariWebExtensionHandler.swift
//  Keepsake Extension
//
//  Created by Harrison Fischberg on 10/16/26.
//

import SafariServices
import CloudKit
import KeepsakeKit
import os.log

/// iCloud sync for Safari on the Mac. The extension's background (keepsake/src/shared/syncBridge.js)
/// sends `push`, `hold`, `sync`, `pull` and `off` here over native messaging; this side keeps a copy of
/// the library (`ExtensionMirror`) that the same sync code as the iPhone's keeps in step with iCloud.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]
        nonisolated(unsafe) let box = (context, message)
        Task {
            let answer = await MirrorHost.shared.handle(box.1)
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: answer]
            box.0.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }
}

/// One copy of the library and one sync engine for as long as Safari keeps this extension's process.
actor MirrorHost {
    static let shared = MirrorHost()
    private let log = Logger(subsystem: "com.harrisonfischberg.keepsake.safari-extension", category: "sync")
    private var db: RecordDatabase?
    private var sync: CloudSync?

    private func database() throws -> RecordDatabase {
        if let db { return db }
        let dir = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("Internet Binder", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let made = try RecordDatabase(path: dir.appendingPathComponent("icloud-copy.sqlite").path, secrets: MemorySecrets())
        made.recordsOutbound = true
        db = made
        return made
    }

    private func engine() throws -> CloudSync {
        if let sync { return sync }
        let made = CloudSync(database: try database(), keys: LibraryKeys(store: KeychainLibraryKeys(accessGroup: CloudSync.keychainGroup)))
        made.start()
        sync = made
        return made
    }

    func handle(_ message: [String: Any]) async -> [String: Any] {
        let type = message["type"] as? String ?? ""
        do {
            switch type {
            case "push":
                let changes = message["changes"] as? [[String: Any]] ?? []
                let cursor = (message["cursor"] as? NSNumber)?.int64Value ?? 0
                let acked = try ExtensionMirror.receive(changes, cursor: cursor, into: try database())
                return ["ok": true, "acked": acked]
            case "hold":
                try ExtensionMirror.hold(message["changes"] as? [[String: Any]] ?? [], in: try database())
                return ["ok": true]
            case "sync":
                switch try await CKContainer(identifier: CloudSync.containerID).accountStatus() {
                case .available: break
                default: return ["ok": true, "status": "signedOut", "message": "Sign in to iCloud in System Settings to sync."]
                }
                let sync = try engine()
                sync.noteLocalChanges()
                try await sync.syncNow()
                return ["ok": true, "status": "upToDate"]
            case "pull":
                let cursor = (message["cursor"] as? NSNumber)?.int64Value ?? 0
                let page = try ExtensionMirror.outbound(after: cursor, from: try database())
                return ["ok": true, "changes": page.changes, "cursor": page.cursor, "more": page.more]
            case "off":
                sync?.stop()
                sync = nil
                try ExtensionMirror.forget(try database())
                return ["ok": true]
            default:
                return ["ok": false, "message": "Unknown request \(type)"]
            }
        } catch {
            log.error("\(type, privacy: .public) failed: \(String(describing: error), privacy: .public)")
            return ["ok": false, "message": error.localizedDescription]
        }
    }
}
