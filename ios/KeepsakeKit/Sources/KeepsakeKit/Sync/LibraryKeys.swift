import Foundation
import CryptoKit
import Security
import os

/// The keys that seal pictures before they go to iCloud. Record text is end-to-end encrypted by CloudKit
/// itself (`encryptedValues`); assets are only end-to-end with Advanced Data Protection on, so pictures
/// are sealed here (AES-GCM, `Sealer`) with a key kept in iCloud Keychain and shared by the person's devices.
///
/// Two devices that start syncing before iCloud Keychain has carried a key across can each make one.
/// So every key has an id, each sealed picture starts with the id of its key, and every device seals
/// with the smallest id it has: once the Keychain has synced, all of them use the same key, and older
/// pictures still open with the key they name.
public protocol LibraryKeyStore: Sendable {
    func all() -> [String: SymmetricKey]
    /// Throws when the key couldn't be kept: pictures sealed with it could never be opened again.
    func add(id: String, key: SymmetricKey) throws
}

public struct LibraryKeys: Sendable {
    public let store: LibraryKeyStore
    static let idLength = 16
    /// The key to seal with is read again after this long, so a smaller id arriving through iCloud Keychain
    /// is picked up, without a Keychain query for every picture sealed (a first sync seals thousands).
    let cacheFor: TimeInterval
    private let cached = OSAllocatedUnfairLock<(id: String, key: SymmetricKey, at: Date)?>(initialState: nil)

    public init(store: LibraryKeyStore, cacheFor: TimeInterval = 60) {
        self.store = store
        self.cacheFor = cacheFor
    }

    /// The key to seal with, made the first time.
    func current() throws -> (id: String, key: SymmetricKey) {
        if let c = cached.withLock({ $0 }), Date().timeIntervalSince(c.at) < cacheFor { return (c.id, c.key) }
        let picked: (id: String, key: SymmetricKey)
        if let first = store.all().min(by: { $0.key < $1.key }) {
            picked = (first.key, first.value)
        } else {
            let id = String(UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(Self.idLength).lowercased())
            let key = SymmetricKey(size: .bits256)
            try store.add(id: id, key: key)
            picked = (id, key)
        }
        cached.withLock { $0 = (picked.id, picked.key, Date()) }
        return picked
    }

    /// `key id (16 ASCII) ‖ nonce ‖ ciphertext ‖ tag`, bound to the record name.
    public func seal(_ data: Data, recordName: String) throws -> Data {
        let (id, key) = try current()
        return Data(id.utf8) + (try Sealer(key: key).seal(data, recordName: recordName))
    }

    /// Throws `SyncError.missingKey` when the key hasn't reached this device yet.
    public func open(_ sealed: Data, recordName: String) throws -> Data {
        guard sealed.count > Self.idLength, let id = String(data: sealed.prefix(Self.idLength), encoding: .utf8) else { throw SyncError.badRecord("sealed pictures") }
        guard let key = store.all()[id] else { throw SyncError.missingKey(id) }
        return try Sealer(key: key).open(sealed.dropFirst(Self.idLength), recordName: recordName)
    }
}

/// Keys in iCloud Keychain (synchronizable), readable by the app, its extensions and the Mac app
/// through the shared keychain access group.
public struct KeychainLibraryKeys: LibraryKeyStore {
    let service = "com.harrisonfischberg.keepsake.library-key"
    let accessGroup: String?

    public init(accessGroup: String? = nil) { self.accessGroup = accessGroup }

    private func base() -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
                                kSecAttrSynchronizable as String: true, kSecUseDataProtectionKeychain as String: true]
        if let accessGroup { q[kSecAttrAccessGroup as String] = accessGroup }
        return q
    }

    public func all() -> [String: SymmetricKey] {
        var q = base()
        q[kSecMatchLimit as String] = kSecMatchLimitAll
        q[kSecReturnAttributes as String] = true
        q[kSecReturnData as String] = true
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let items = out as? [[String: Any]] else { return [:] }
        var keys: [String: SymmetricKey] = [:]
        for item in items {
            if let id = item[kSecAttrAccount as String] as? String, let data = item[kSecValueData as String] as? Data, data.count == 32 {
                keys[id] = SymmetricKey(data: data)
            }
        }
        return keys
    }

    public func add(id: String, key: SymmetricKey) throws {
        var q = base()
        q[kSecAttrAccount as String] = id
        q[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { throw SyncError.keyNotSaved(Int(status)) }
    }
}

public final class MemoryLibraryKeys: LibraryKeyStore, @unchecked Sendable {
    private var keys: [String: SymmetricKey] = [:]
    private let lock = NSLock()
    public init() {}
    public func all() -> [String: SymmetricKey] { lock.withLock { keys } }
    public func add(id: String, key: SymmetricKey) { lock.withLock { keys[id] = key } }
}
