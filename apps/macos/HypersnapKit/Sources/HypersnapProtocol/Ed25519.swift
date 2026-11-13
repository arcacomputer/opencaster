// Deterministic Ed25519 (RFC 8032) via libsodium.
// CryptoKit's Curve25519.Signing uses hedged/randomized nonces — valid but not
// the canonical bytes every other Farcaster/Hypersnap implementation produces.
import Foundation
import Sodium

public enum Ed25519Error: Error {
    case keyPairFailed
    case signFailed
    case invalidSeed
}

/// An Ed25519 device signing key generated from (or imported as) a 32-byte seed.
public struct Ed25519Key: Sendable {
    /// 32-byte public key.
    public let publicKey: [UInt8]
    /// 32-byte seed — the portable form persisted in the Keychain.
    public let seed: [UInt8]
    /// libsodium's 64-byte secret key (seed || pubkey).
    private let secretKey: [UInt8]

    /// Fresh random device key.
    public init() throws {
        let sodium = Sodium()
        guard let pair = sodium.sign.keyPair() else { throw Ed25519Error.keyPairFailed }
        secretKey = pair.secretKey
        publicKey = pair.publicKey
        seed = Array(secretKey.prefix(32))
    }

    /// Import an existing 32-byte seed.
    public init(seed: [UInt8]) throws {
        guard seed.count == 32 else { throw Ed25519Error.invalidSeed }
        let sodium = Sodium()
        guard let pair = sodium.sign.keyPair(seed: seed) else { throw Ed25519Error.keyPairFailed }
        secretKey = pair.secretKey
        publicKey = pair.publicKey
        self.seed = seed
    }

    /// RFC 8032 detached signature over `message` (64 bytes, deterministic).
    public func sign(_ message: [UInt8]) throws -> [UInt8] {
        guard let sig = Sodium().sign.signature(message: message, secretKey: secretKey) else {
            throw Ed25519Error.signFailed
        }
        return sig
    }

    /// Detached verify, for tests and future receipt checks.
    public static func verify(signature: [UInt8], message: [UInt8], publicKey: [UInt8]) -> Bool {
        Sodium().sign.verify(message: message, publicKey: publicKey, signature: signature)
    }
}
