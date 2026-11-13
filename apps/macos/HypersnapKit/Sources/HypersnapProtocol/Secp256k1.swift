// secp256k1 custody-key operations via libsecp256k1 (bitcoin-core bindings).
// Used for EIP-712 signing (recoverable ECDSA, low-S) and BIP-32 derivation.
import Foundation
import libsecp256k1

public enum Secp256k1Error: Error {
    case contextCreate
    case invalidPrivateKey
    case publicKeyCreate
    case signFailed
    case tweakFailed
    case serializeFailed
}

/// Thin RAII wrapper over a libsecp256k1 sign+verify context.
public final class Secp256k1 {
    private let context: OpaquePointer

    public init() throws {
        guard let ctx = secp256k1_context_create(UInt32(SECP256K1_CONTEXT_SIGN | SECP256K1_CONTEXT_VERIFY)) else {
            throw Secp256k1Error.contextCreate
        }
        context = ctx
    }

    deinit {
        secp256k1_context_destroy(context)
    }

    /// Throws unless `key` is a valid 32-byte secp256k1 secret.
    public func verifyPrivateKey(_ key: [UInt8]) -> Bool {
        guard key.count == 32 else { return false }
        return key.withUnsafeBytes { ptr in
            secp256k1_ec_seckey_verify(context, ptr.baseAddress!.assumingMemoryBound(to: UInt8.self)) == 1
        }
    }

    /// Uncompressed public key (65 bytes, leading 0x04).
    public func publicKeyUncompressed(privateKey: [UInt8]) throws -> [UInt8] {
        try publicKey(privateKey: privateKey, compressed: false)
    }

    /// Compressed public key (33 bytes).
    public func publicKeyCompressed(privateKey: [UInt8]) throws -> [UInt8] {
        try publicKey(privateKey: privateKey, compressed: true)
    }

    private func publicKey(privateKey: [UInt8], compressed: Bool) throws -> [UInt8] {
        guard privateKey.count == 32 else { throw Secp256k1Error.invalidPrivateKey }
        var pubkey = secp256k1_pubkey()
        let created = privateKey.withUnsafeBytes { ptr in
            secp256k1_ec_pubkey_create(context, &pubkey, ptr.baseAddress!.assumingMemoryBound(to: UInt8.self))
        }
        guard created == 1 else { throw Secp256k1Error.publicKeyCreate }
        let size = compressed ? 33 : 65
        var out = [UInt8](repeating: 0, count: size)
        var outLen = size
        let flag = compressed ? UInt32(SECP256K1_EC_COMPRESSED) : UInt32(SECP256K1_EC_UNCOMPRESSED)
        let serialized = withUnsafePointer(to: &pubkey) { pubPtr in
            out.withUnsafeMutableBytes { outPtr in
                secp256k1_ec_pubkey_serialize(context, outPtr.baseAddress!.assumingMemoryBound(to: UInt8.self), &outLen, pubPtr, flag)
            }
        }
        guard serialized == 1, outLen == size else { throw Secp256k1Error.serializeFailed }
        return out
    }

    /// BIP-32 private-key tweak: returns (key + tweak) mod n, or nil if invalid.
    public func privateKeyTweakAdd(privateKey: [UInt8], tweak: [UInt8]) -> [UInt8]? {
        guard privateKey.count == 32, tweak.count == 32 else { return nil }
        var key = privateKey
        let ok = key.withUnsafeMutableBytes { keyPtr in
            tweak.withUnsafeBytes { tweakPtr in
                secp256k1_ec_seckey_tweak_add(
                    context,
                    keyPtr.baseAddress!.assumingMemoryBound(to: UInt8.self),
                    tweakPtr.baseAddress!.assumingMemoryBound(to: UInt8.self)
                )
            }
        }
        return ok == 1 ? key : nil
    }

    /// Ethereum-style 65-byte signature (r || s || v) over a 32-byte digest,
    /// v ∈ {27, 28}. libsecp256k1 produces RFC6979 + low-S signatures,
    /// byte-identical to noble's default sign.
    public func signRecoverable(digest: [UInt8], privateKey: [UInt8]) throws -> [UInt8] {
        guard digest.count == 32, privateKey.count == 32 else { throw Secp256k1Error.invalidPrivateKey }
        var sig = secp256k1_ecdsa_recoverable_signature()
        let signed = digest.withUnsafeBytes { digestPtr in
            privateKey.withUnsafeBytes { keyPtr in
                secp256k1_ecdsa_sign_recoverable(
                    context, &sig,
                    digestPtr.baseAddress!.assumingMemoryBound(to: UInt8.self),
                    keyPtr.baseAddress!.assumingMemoryBound(to: UInt8.self),
                    nil, nil
                )
            }
        }
        guard signed == 1 else { throw Secp256k1Error.signFailed }
        var compact = [UInt8](repeating: 0, count: 64)
        var recid: Int32 = 0
        _ = withUnsafePointer(to: &sig) { sigPtr in
            compact.withUnsafeMutableBytes { outPtr in
                secp256k1_ecdsa_recoverable_signature_serialize_compact(
                    context,
                    outPtr.baseAddress!.assumingMemoryBound(to: UInt8.self),
                    &recid,
                    sigPtr
                )
            }
        }
        var out = compact
        out.append(UInt8(recid) + 27)
        return out
    }

    /// Ethereum-style address: last 20 bytes of keccak256(uncompressed pubkey minus 0x04).
    public func address(privateKey: [UInt8]) throws -> String {
        let pub = try publicKeyUncompressed(privateKey: privateKey)
        let hash = Keccak.keccak256(Array(pub[1...]))
        return "0x" + bytesToHex(Array(hash[12...]))
    }
}
