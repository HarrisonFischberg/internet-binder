import Foundation
import CloudKit
import KeepsakeKit

/// iCloud sync for the app (Settings → iCloud): whether it's on, what it last reported, and the engine
/// while it runs. Owned by `LibraryModel` (`model.cloud`), which tells it what to do when records from
/// another device land and when the first copy starts or stops.
@MainActor @Observable
final class SyncModel {
    /// The engine, running while sync is on.
    private(set) var engine: CloudSync?
    private(set) var on = SyncPreference.isOn
    private(set) var status: CloudSync.Status?
    /// The one-time question for a device that already has a library when sync arrives.
    var askToSync = false

    @ObservationIgnored private let database: RecordDatabase?
    /// Records from another device landed.
    @ObservationIgnored var onRemoteChange: () -> Void = {}
    /// Sync was turned on (the whole library goes up: the progress screen counts it) or off.
    @ObservationIgnored var onTurned: (Bool) -> Void = { _ in }
    /// Whether this device has an iCloud account sync can use (checkAccount).
    @ObservationIgnored private var iCloudReady = false

    init(database: RecordDatabase?) {
        self.database = database
    }

    /// Starts sync if it's on. The first time: on by itself for a new library, asked once for one
    /// that already has saves. UI tests (a library of their own) never sync.
    func decide(libraryIsEmpty: () -> Bool) {
        guard database != nil, ProcessInfo.processInfo.environment["KEEPSAKE_DB"] == nil else { return }
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "noSync") { return }
        #endif
        switch SyncPreference.choice {
        case nil:
            if libraryIsEmpty() { set(true) } else { askToSync = true }
        case true?:
            start()
        case false?:
            break
        }
    }

    func set(_ on: Bool) {
        guard let database else { return }
        SyncPreference.choice = on
        self.on = on
        if on {
            // Everything goes up (or merges with what iCloud already has) on the first sync. Changes made
            // while sync was off are dropped first, so a library erased then would not erase iCloud.
            try? database.resetSync()
            try? database.markAllPending()
            start()
            onTurned(true)
        } else {
            onTurned(false)
            engine?.stop()
            engine = nil
            status = nil
            try? database.resetSync()
        }
    }

    private func start() {
        guard let database, engine == nil else { return }
        let s = CloudSync(database: database, keys: LibraryKeys(store: KeychainLibraryKeys(accessGroup: CloudSync.keychainGroup)))
        s.onChange = { [weak self] in Task { @MainActor in self?.onRemoteChange() } }
        s.onStatus = { [weak self] status in Task { @MainActor in self?.statusChanged(status) } }
        s.onError = { [weak self] error in Task { @MainActor in self?.status = .failed(error.localizedDescription) } }
        s.onPurged = { [weak self] in Task { @MainActor in self?.set(false) } }
        engine = s
        s.start()
        Task { await checkAccount() }
    }

    /// Fetches and sends now (the app coming to the front).
    func syncNow() {
        guard let engine else { return }
        engine.noteLocalChanges()
        Task.detached { try? await engine.syncNow() }
        // Back from the Settings app, maybe signed in now.
        Task { await checkAccount() }
    }

    private func checkAccount() async {
        // It throws when there's no account to ask about (a Simulator with no Apple Account does).
        let account = (try? await CKContainer(identifier: CloudSync.containerID).accountStatus()) ?? .couldNotDetermine
        iCloudReady = account == .available
        if !iCloudReady { status = .signedOut }
        else if status == nil || status == .signedOut, let engine {
            // Up-to-date reports dropped before the account was known: sync once more to show one.
            status = nil
            Task.detached { try? await engine.syncNow() }
        }
    }

    private func statusChanged(_ new: CloudSync.Status) {
        // CKSyncEngine reports fetches and sends even when it can't reach iCloud, and a finished send
        // after one that failed: none of those is syncing or up to date.
        switch new {
        case .syncing:
            if status == .signedOut { return }
        case .upToDate:
            guard iCloudReady else { return }
            if case .failed? = status { return }
        default:
            break
        }
        status = new
    }
}
