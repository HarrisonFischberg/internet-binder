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
/// Not used yet: PR 2 (iPhone) and PR 3 (Safari on the Mac) turn it on.
public final class CloudSync: CKSyncEngineDelegate, @unchecked Sendable {
    public static let containerID = "iCloud.com.harrisonfischberg.keepsake"
    public static let zoneID = CKRecordZone.ID(zoneName: "Library", ownerName: CKCurrentUserDefaultName)
    static let stateKey = "engine"

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
        retrySealedPictures()
        noteLocalChanges()
    }

    /// Hands every pending local change to the engine. Cheap: call it after each write.
    public func noteLocalChanges() {
        guard let engine = lock.withLock({ self.engine }), let pending = try? db.pendingChanges() else { return }
        var changes: [CKSyncEngine.PendingRecordZoneChange] = []
        for p in pending {
            let rid = Self.recordID(p.id)
            if case .delete = (try? db.outgoing(p.id)) ?? nil { changes.append(.deleteRecord(rid)) } else { changes.append(.saveRecord(rid)) }
        }
        engine.state.add(pendingRecordZoneChanges: changes)
    }

    /// Fetches, then sends, now (pull to refresh, the Safari extension opening its popup).
    public func syncNow() async throws {
        guard let engine = lock.withLock({ self.engine }) else { return }
        try await engine.fetchChanges()
        try await engine.sendChanges()
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
            case .signOut, .switchAccounts:
                // The library stays on the device; what iCloud had is forgotten.
                try? db.resetSyncBase()
                try? db.setSyncState(Self.stateKey, nil)
            @unknown default:
                break
            }

        case .fetchedDatabaseChanges(let changes):
            if changes.deletions.contains(where: { $0.zoneID == Self.zoneID }) { try? db.resetSyncBase() }

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
        if let data = try rec.picturesData() {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("ks-sync-\(UUID().uuidString)")
            try keys.seal(data, recordName: rec.id.recordName).write(to: url)
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
