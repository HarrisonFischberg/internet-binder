import Foundation
import CryptoKit

/// Seals Bowerbird bundles so only the person's own devices can read them (replica/m3/sync-bridge.md).
///
/// Pairing: Chrome shows `keepsake-pair:v1:<mailboxId>:<chromePublicKey>` (base64url, no padding).
/// The iPhone agrees a key with X25519, then HKDF-SHA256 (salt = the mailbox id, info =
/// "keepsake-pair-v1", 32 bytes). Bundles are AES-256-GCM: `nonce (12) ‖ ciphertext ‖ tag (16)`,
/// with the record name as associated data so a bundle can't be swapped for another.
/// Chrome does the same with WebCrypto; the test vectors in Tests/Fixtures/sealer-vectors.json are
/// produced by ios/tools/sealer-vectors.mjs with WebCrypto and checked here.
public struct Sealer: Sendable {
    public static let info = Data("keepsake-pair-v1".utf8)
    public let key: SymmetricKey

    public init(key: SymmetricKey) { self.key = key }

    /// The key both sides agree on when pairing.
    public init(privateKey: Curve25519.KeyAgreement.PrivateKey, peerPublicKey: Curve25519.KeyAgreement.PublicKey, mailboxId: Data) throws {
        let secret = try privateKey.sharedSecretFromKeyAgreement(with: peerPublicKey)
        key = secret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: mailboxId, sharedInfo: Self.info, outputByteCount: 32)
    }

    public func seal(_ plaintext: Data, recordName: String, nonce: AES.GCM.Nonce = AES.GCM.Nonce()) throws -> Data {
        let box = try AES.GCM.seal(plaintext, using: key, nonce: nonce, authenticating: Data(recordName.utf8))
        return box.combined!
    }

    public func open(_ sealed: Data, recordName: String) throws -> Data {
        try AES.GCM.open(AES.GCM.SealedBox(combined: sealed), using: key, authenticating: Data(recordName.utf8))
    }

    // MARK: pairing codes

    public struct PairingCode: Equatable, Sendable {
        public let mailboxId: Data
        public let publicKey: Curve25519.KeyAgreement.PublicKey

        public init(mailboxId: Data, publicKey: Curve25519.KeyAgreement.PublicKey) {
            self.mailboxId = mailboxId
            self.publicKey = publicKey
        }

        public init?(_ text: String) {
            let parts = text.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
            guard parts.count == 4, parts[0] == "keepsake-pair", parts[1] == "v1",
                  let mailbox = Data(base64URL: parts[2]), mailbox.count == 16,
                  let raw = Data(base64URL: parts[3]),
                  let pub = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: raw)
            else { return nil }
            mailboxId = mailbox
            publicKey = pub
        }

        public var text: String { "keepsake-pair:v1:\(mailboxId.base64URL):\(publicKey.rawRepresentation.base64URL)" }

        public static func == (a: Self, b: Self) -> Bool {
            a.mailboxId == b.mailboxId && a.publicKey.rawRepresentation == b.publicKey.rawRepresentation
        }
    }
}

extension Data {
    public init?(base64URL s: String) {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        self.init(base64Encoded: b)
    }

    public var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    public init?(hex: String) {
        guard hex.count % 2 == 0 else { return nil }
        var d = Data(capacity: hex.count / 2)
        var i = hex.startIndex
        while i < hex.endIndex {
            let j = hex.index(i, offsetBy: 2)
            guard let b = UInt8(hex[i..<j], radix: 16) else { return nil }
            d.append(b)
            i = j
        }
        self = d
    }

    public var hex: String { map { String(format: "%02x", $0) }.joined() }
}
