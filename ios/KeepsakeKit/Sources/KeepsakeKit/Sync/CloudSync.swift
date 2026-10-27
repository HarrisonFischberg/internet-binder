import Foundation
import CloudKit

/// iCloud sync through CloudKit's `CKSyncEngine`, in the person's private database: one zone, `Library`,
/// one record per synced record (`SyncID`). The record's JSON goes in the end-to-end encrypted field
/// `body`; pictures stored in a save go in the asset `pictures`, sealed with the library key first.
///
/// The engine decides when to fetch and send; this class only translates. Local changes come from the
/// record store's pending marks (`SyncStore`): call `noteLocalChanges()` after the shared code writes,
/// and the engine picks them up. Changes from iCloud are merged into the store, then `onChange` runs so
/// the app can reload.
///
/// On the iPhone the app runs it (`SyncPreference`); the Share Extension only sends its own save
/// straight away (`push`), so two engines never share one saved state.
public final class CloudSync: CKSyncEngineDelegate, @unchecked Sendable {
    public static let containerID = "iCloud.com.rarecreatures.keepsake"
    public static let zoneID = CKRecordZone.ID(zoneName: "Library", ownerName: CKCurrentUserDefaultName)
    static let stateKey = "engine"
    /// The keychain group the app, its extensions and the Mac app share, for the library key.
    public static let keychainGroup = "KTV2G3Z883.com.harrisonfischberg.keepsake.shared"

    public enum Status: Equatable, Sendable {
        case syncing
        case upToDate(Date)
        case signedOut
        case failed(String)
    }

    let db: RecordDatabase
    let keys: LibraryKeys
    let database: CKDatabase
    private let lock = NSLock()
    private var engine: CKSyncEngine?
    /// The revision of each record handed to the engine, so `markSent` keeps later changes pending.
    private var inFlight: [SyncID: (rev: Int64, record: SyncRecord?, file: URL?)] = [:]

    /// Runs after records from iCloud were written locally (on the engine's queue).
    public var onChange: (@Sendable () -> Void)?
    /// Runs with any error the engine reports that isn't retried on its own.
    public var onError: (@Sendable (Error) -> Void)?
    /// Runs when the sync status changes, for Settings.
    public var onStatus: (@Sendable (Status) -> Void)?
    /// Runs when the person deleted the library's iCloud data; the app turns sync off. Without it, the
    /// library is uploaded again.
    public var onPurged: (@Sendable () -> Void)?
    private var queued: Task<Void, Never>?

    public init(database: RecordDatabase, keys: LibraryKeys, container: CKContainer = CKContainer(identifier: CloudSync.containerID)) {
        db = database
        self.keys = keys
        self.database = container.privateCloudDatabase
    }

    /// Starts the engine (it fetches and sends on its own schedule and on pushes) and queues what's pending.
    public func start() {
        let saved = (try? db.syncState(Self.stateKey)).flatMap { try? JSONDecoder().decode(CKSyncEngine.State.Serialization.self, from: $0) }
        let config = CKSyncEngine.Configuration(database: database, stateSerialization: saved, delegate: self)
        let engine = CKSyncEngine(config)
        lock.withLock { self.engine = engine }
        if saved == nil { engine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: Self.zoneID))]) }
        // A burst of writes (an import, Fix with AI on a collection) is queued once it settles.
        db.onLocalWrite = { [weak self] in self?.noteLocalChangesSoon() }
        retrySealedPictures()
        noteLocalChanges()
    }

    /// Stops syncing; the library and what's pending stay, so turning it on again carries on.
    public func stop() {
        db.onLocalWrite = nil
        lock.withLock {
            queued?.cancel()
            engine = nil
        }
    }

    private func noteLocalChangesSoon() {
        lock.withLock {
            queued?.cancel()
            queued = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(500))
                guard !Task.isCancelled else { return }
                self?.noteLocalChanges()
            }
        }
    }

    /// Hands every pending local change to the engine. Cheap: call it after each write.
    public func noteLocalChanges() {
        guard let engine = lock.withLock({ self.engine }), let pending = try? db.pendingChanges() else { return }
        engine.state.add(pendingRecordZoneChanges: pending.map { $0.deleted ? .deleteRecord(Self.recordID($0.id)) : .saveRecord(Self.recordID($0.id)) })
    }

    /// Fetches, then sends, now (pull to refresh, the Safari extension opening its popup).
    public func syncNow() async throws {
        guard let engine = lock.withLock({ self.engine }) else { return }
        try await engine.fetchChanges()
        try await engine.sendChanges()
    }

    /// Sends a few records now, without the engine (the Share Extension's save, before the sheet closes).
    /// Whatever doesn't make it stays pending for the app.
    public static func push(_ ids: [SyncID], database db: RecordDatabase, keys: LibraryKeys,
                            container: CKContainer = CKContainer(identifier: CloudSync.containerID)) async {
        var saves: [CKRecord] = [], deletes: [CKRecord.ID] = [], files: [URL] = []
        var sending: [SyncID: (rev: Int64, record: SyncRecord?)] = [:]
        for id in ids {
            switch (try? db.outgoing(id)) ?? nil {
            case .save(let rec, let rev):
                guard let made = try? makeRecord(rec, system: (try? db.systemFields(id)) ?? nil, keys: keys) else { continue }
                saves.append(made.0)
                if let file = made.1 { files.append(file) }
                sending[id] = (rev, rec)
            case .delete(_, let rev):
                // Never reached iCloud (saved and undone in the same sheet): nothing to delete there.
                if ((try? db.systemFields(id)) ?? nil) == nil { try? db.markSent(id, rev: rev, record: nil, system: nil); continue }
                deletes.append(recordID(id))
                sending[id] = (rev, nil)
            case nil:
                continue
            }
        }
        defer { for f in files { try? FileManager.default.removeItem(at: f) } }
        guard !saves.isEmpty || !deletes.isEmpty else { return }
        guard let results = try? await container.privateCloudDatabase.modifyRecords(saving: saves, deleting: deletes, savePolicy: .ifServerRecordUnchanged, atomically: false) else { return }
        for (rid, result) in results.saveResults {
            guard case .success(let record) = result, let id = SyncID(recordName: rid.recordName), let s = sending[id] else { continue }
            try? db.markSent(id, rev: s.rev, record: s.record, system: systemFields(record))
        }
        for (rid, result) in results.deleteResults {
            guard case .success = result, let id = SyncID(recordName: rid.recordName), let s = sending[id] else { continue }
            try? db.markSent(id, rev: s.rev, record: nil, system: nil)
        }
    }

    static func recordID(_ id: SyncID) -> CKRecord.ID { CKRecord.ID(recordName: id.recordName, zoneID: zoneID) }

    // MARK: CKSyncEngineDelegate

    public func handleEvent(_ event: CKSyncEngine.Event, syncEngine: CKSyncEngine) async {
        switch event {
        case .stateUpdate(let update):
            try? db.setSyncState(Self.stateKey, try? JSONEncoder().encode(update.stateSerialization))

        case .accountChange(let change):
            switch change.changeType {
            case .signIn:
                try? db.markAllPending()
                noteLocalChanges()
            case .signOut:
                // The library stays on the device; what iCloud had is forgotten.
                try? db.resetSyncBase()
                try? db.setSyncState(Self.stateKey, nil)
                onStatus?(.signedOut)
            case .switchAccounts:
                // Another account's iCloud: the whole library goes up there, not only what changes next.
                try? db.resetSyncBase()
                try? db.setSyncState(Self.stateKey, nil)
                try? db.markAllPending()
                noteLocalChanges()
            @unknown default:
                break
            }

        case .fetchedDatabaseChanges(let changes):
            guard let gone = changes.deletions.first(where: { $0.zoneID == Self.zoneID }) else { break }
            try? db.resetSyncBase()
            if gone.reason == .purged, let onPurged {
                // The person deleted this app's iCloud data (Settings, Manage Storage): sync goes off rather
                // than uploading it all again behind their back.
                onPurged()
            } else {
                // iCloud lost the zone: the whole library goes up again, so a new device gets all of it.
                syncEngine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: Self.zoneID))])
                try? db.markAllPending()
                noteLocalChanges()
            }

        case .fetchedRecordZoneChanges(let changes):
            var changed = false
            for mod in changes.modifications {
                do { changed = try apply(mod.record) || changed } catch { onError?(error) }
            }
            for deletion in changes.deletions {
                guard let id = SyncID(recordName: deletion.recordID.recordName) else { continue }
                try? db.applyRemoteDeletion(id)
                changed = true
            }
            // Two libraries meeting for the first time: one Roadtrips, one save per link.
            if changed { do { try db.mergeDuplicates() } catch { onError?(error) } }
            // The picture key may have reached this device since the last fetch.
            retrySealedPictures()
            noteLocalChanges()
            if changed { onChange?() }

        case .sentRecordZoneChanges(let sent):
            for record in sent.savedRecords {
                guard let id = SyncID(recordName: record.recordID.recordName), let flight = takeInFlight(id) else { continue }
                try? db.markSent(id, rev: flight.rev, record: flight.record, system: Self.systemFields(record))
            }
            for rid in sent.deletedRecordIDs {
                guard let id = SyncID(recordName: rid.recordName), let flight = takeInFlight(id) else { continue }
                try? db.markSent(id, rev: flight.rev, record: nil, system: nil)
            }
            var retry: [CKSyncEngine.PendingRecordZoneChange] = []
            for failure in sent.failedRecordSaves {
                let rid = failure.record.recordID
                guard let id = SyncID(recordName: rid.recordName) else { continue }
                _ = takeInFlight(id)
                switch failure.error.code {
                case .serverRecordChanged:
                    // Someone else saved first: merge with theirs; anything left over goes out again.
                    if let server = failure.error.serverRecord { _ = try? apply(server) }
                    onChange?()
                case .zoneNotFound:
                    syncEngine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: Self.zoneID))])
                    retry.append(.saveRecord(rid))
                case .unknownItem:
                    try? db.setSystemFields(id, nil)
                    retry.append(.saveRecord(rid))
                case .networkFailure, .networkUnavailable, .zoneBusy, .serviceUnavailable, .requestRateLimited, .notAuthenticated, .operationCancelled:
                    break // the engine retries these itself
                default:
                    onError?(failure.error)
                }
            }
            syncEngine.state.add(pendingRecordZoneChanges: retry)
            noteLocalChanges()

        case .willFetchChanges, .willSendChanges:
            onStatus?(.syncing)

        case .didFetchChanges, .didSendChanges:
            onStatus?(.upToDate(Date()))

        default:
            break
        }
    }

    public func nextRecordZoneChangeBatch(_ context: CKSyncEngine.SendChangesContext, syncEngine: CKSyncEngine) async -> CKSyncEngine.RecordZoneChangeBatch? {
        let changes = syncEngine.state.pendingRecordZoneChanges.filter { context.options.scope.contains($0) }
        for change in changes {
            if case .deleteRecord(let rid) = change, let id = SyncID(recordName: rid.recordName), case .delete(_, let rev) = (try? db.outgoing(id)) ?? nil {
                setInFlight(id, (rev, nil, nil))
            }
        }
        return await CKSyncEngine.RecordZoneChangeBatch(pendingChanges: changes) { rid in
            self.recordToSend(rid, engine: syncEngine)
        }
    }

    // MARK: translating

    private func recordToSend(_ rid: CKRecord.ID, engine: CKSyncEngine) -> CKRecord? {
        guard let id = SyncID(recordName: rid.recordName) else {
            engine.state.remove(pendingRecordZoneChanges: [.saveRecord(rid)])
            return nil
        }
        do {
            switch try db.outgoing(id) {
            case .save(let rec, let rev):
                let (record, file) = try Self.makeRecord(rec, system: try db.systemFields(id), keys: keys)
                setInFlight(id, (rev, rec, file))
                return record
            case .delete:
                // Deleted after it was queued as a save.
                engine.state.remove(pendingRecordZoneChanges: [.saveRecord(rid)])
                engine.state.add(pendingRecordZoneChanges: [.deleteRecord(rid)])
                return nil
            case nil:
                engine.state.remove(pendingRecordZoneChanges: [.saveRecord(rid)])
                return nil
            }
        } catch {
            onError?(error)
            return nil
        }
    }

    /// Returns whether the local library changed.
    private func apply(_ record: CKRecord) throws -> Bool {
        guard SyncID(recordName: record.recordID.recordName) != nil else { return false }
        let (rec, sealed) = try Self.decode(record, keys: keys)
        let applied = try db.applyRemote(rec, system: Self.systemFields(record))
        if let sealed { try db.keepSealed(rec.id, sealed) }
        return applied != .unchanged
    }

    /// Pictures that arrived before their key: try again now that iCloud Keychain may have it.
    func retrySealedPictures() {
        guard let waiting = try? db.sealedPictures(), !waiting.isEmpty else { return }
        var changed = false
        for (id, data) in waiting {
            guard let opened = try? keys.open(data, recordName: id.recordName), let pictures = try? SyncRecord.pictures(from: opened) else { continue }
            try? db.restorePictures(id, pictures)
            changed = true
        }
        if changed { onChange?() }
    }

    private func setInFlight(_ id: SyncID, _ value: (rev: Int64, record: SyncRecord?, file: URL?)) {
        lock.withLock { inFlight[id] = value }
    }

    private func takeInFlight(_ id: SyncID) -> (rev: Int64, record: SyncRecord?, file: URL?)? {
        let flight = lock.withLock { inFlight.removeValue(forKey: id) }
        if let file = flight?.file { try? FileManager.default.removeItem(at: file) }
        return flight
    }

    /// The CloudKit record for a local record. `system` makes it an update of the version iCloud has.
    /// Returns the temporary file holding the sealed pictures, to delete once sent.
    static func makeRecord(_ rec: SyncRecord, system: Data?, keys: LibraryKeys) throws -> (CKRecord, URL?) {
        let record = system.flatMap(record(fromSystemFields:)) ?? CKRecord(recordType: rec.id.recordType, recordID: recordID(rec.id))
        record.encryptedValues["body"] = rec.body
        var file: URL?
        if let sealed = try rec.picturesData().map({ try keys.seal($0, recordName: rec.id.recordName) }) ?? rec.sealed {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("ks-sync-\(UUID().uuidString)")
            try sealed.write(to: url)
            record["pictures"] = CKAsset(fileURL: url)
            file = url
        } else {
            record["pictures"] = nil
        }
        return (record, file)
    }

    /// The local record for a CloudKit record. When its pictures were sealed with a key this device
    /// doesn't have yet, they come back empty and the sealed bytes are returned to keep for later.
    static func decode(_ record: CKRecord, keys: LibraryKeys) throws -> (SyncRecord, sealed: Data?) {
        guard let id = SyncID(recordName: record.recordID.recordName), let body = record.encryptedValues["body"] as? String else {
            throw SyncError.badRecord(record.recordID.recordName)
        }
        guard let asset = record["pictures"] as? CKAsset, let url = asset.fileURL else { return (SyncRecord(id: id, body: body), nil) }
        let sealed = try Data(contentsOf: url)
        do {
            return (SyncRecord(id: id, body: body, pictures: try SyncRecord.pictures(from: try keys.open(sealed, recordName: id.recordName))), nil)
        } catch SyncError.missingKey {
            return (SyncRecord(id: id, body: body), sealed)
        }
    }

    static func systemFields(_ record: CKRecord) -> Data {
        let coder = NSKeyedArchiver(requiringSecureCoding: true)
        record.encodeSystemFields(with: coder)
        coder.finishEncoding()
        return coder.encodedData
    }

    static func record(fromSystemFields data: Data) -> CKRecord? {
        guard let coder = try? NSKeyedUnarchiver(forReadingFrom: data) else { return nil }
        coder.requiresSecureCoding = true
        defer { coder.finishDecoding() }
        return CKRecord(coder: coder)
    }
}
