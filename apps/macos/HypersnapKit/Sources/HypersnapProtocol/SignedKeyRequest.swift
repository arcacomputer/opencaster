// Port of packages/protocol/src/signedKeyRequest.ts (MIT-licensed quorum-shared origin).
// EIP-712 SignedKeyRequest/KeyAdd/KeyRemove digests + ABI metadata encoding,
// mirroring hypersnap/src/core/validations/key.rs:298.
import Foundation

public enum SignedKeyRequest {
    public static let keyDomainName = "Farcaster KeyAdd"
    public static let keyDomainVersion = "1"
    /// Cosmetic chainId — see hypersnap key.rs + gasless_key_merge.rs.
    public static let chainId: UInt64 = 1

    private static let eip712DomainType = "EIP712Domain(string name,string version,uint256 chainId)"
    private static let signedKeyRequestType = "SignedKeyRequest(uint256 requestFid,bytes key,uint256 deadline)"
    private static let keyAddType = "KeyAdd(uint256 fid,bytes key,uint32 keyType,uint32[] scopes,uint32 ttl,uint32 nonce,uint256 deadline)"
    private static let keyRemoveType = "KeyRemove(uint256 fid,bytes key,uint32 nonce,uint256 deadline)"

    private static func utf8(_ s: String) -> [UInt8] { Array(s.utf8) }

    private static func domainSeparator(chainId: UInt64) -> [UInt8] {
        let typeHash = Keccak.keccak256(utf8(eip712DomainType))
        return Keccak.keccak256(concat(
            typeHash,
            Keccak.keccak256(utf8(keyDomainName)),
            Keccak.keccak256(utf8(keyDomainVersion)),
            toUint256(chainId)
        ))
    }

    private static func signedKeyRequestStructHash(requestFid: UInt64, key: [UInt8], deadline: UInt64) -> [UInt8] {
        let typeHash = Keccak.keccak256(utf8(signedKeyRequestType))
        return Keccak.keccak256(concat(
            typeHash,
            toUint256(requestFid),
            Keccak.keccak256(key),
            toUint256(deadline)
        ))
    }

    /// EIP-712 `uint32[]` field hash: keccak256(concat(toUint256(x_i))).
    private static func uint32ArrayHash(_ values: [UInt32]) -> [UInt8] {
        var buf = [UInt8]()
        buf.reserveCapacity(values.count * 32)
        for v in values { buf.append(contentsOf: toUint256(UInt64(v))) }
        return Keccak.keccak256(buf)
    }

    private static func keyAddStructHash(fid: UInt64, key: [UInt8], keyType: UInt32, scopes: [UInt32], ttl: UInt32, nonce: UInt32, deadline: UInt64) -> [UInt8] {
        let typeHash = Keccak.keccak256(utf8(keyAddType))
        return Keccak.keccak256(concat(
            typeHash,
            toUint256(fid),
            Keccak.keccak256(key),
            toUint256(UInt64(keyType)),
            uint32ArrayHash(scopes),
            toUint256(UInt64(ttl)),
            toUint256(UInt64(nonce)),
            toUint256(deadline)
        ))
    }

    private static func keyRemoveStructHash(fid: UInt64, key: [UInt8], nonce: UInt32, deadline: UInt64) -> [UInt8] {
        let typeHash = Keccak.keccak256(utf8(keyRemoveType))
        return Keccak.keccak256(concat(
            typeHash,
            toUint256(fid),
            Keccak.keccak256(key),
            toUint256(UInt64(nonce)),
            toUint256(deadline)
        ))
    }

    private static func eip712Digest(structHash: [UInt8], chainId: UInt64) -> [UInt8] {
        Keccak.keccak256(concat([0x19, 0x01], domainSeparator(chainId: chainId), structHash))
    }

    /// Digest the custody key signs to authorize a SignedKeyRequest.
    public static func signedKeyRequestDigest(requestFid: UInt64, key: [UInt8], deadline: UInt64) -> [UInt8] {
        eip712Digest(structHash: signedKeyRequestStructHash(requestFid: requestFid, key: key, deadline: deadline), chainId: chainId)
    }

    /// Digest for the KeyAdd authorization (KeyAddBody.custody_signature).
    public static func keyAddDigest(fid: UInt64, key: [UInt8], keyType: UInt32, scopes: [UInt32], ttl: UInt32, nonce: UInt32, deadline: UInt64) -> [UInt8] {
        eip712Digest(structHash: keyAddStructHash(fid: fid, key: key, keyType: keyType, scopes: scopes, ttl: ttl, nonce: nonce, deadline: deadline), chainId: chainId)
    }

    /// Companion digest for KeyRemove (custody-signed).
    public static func keyRemoveDigest(fid: UInt64, key: [UInt8], nonce: UInt32, deadline: UInt64) -> [UInt8] {
        eip712Digest(structHash: keyRemoveStructHash(fid: fid, key: key, nonce: nonce, deadline: deadline), chainId: chainId)
    }

    /// Sign an EIP-712 digest with a secp256k1 custody key → 65-byte r||s||v.
    public static func signDigest(_ digest: [UInt8], custodyPrivateKey: [UInt8], secp: Secp256k1) throws -> [UInt8] {
        guard digest.count == 32, custodyPrivateKey.count == 32 else {
            throw Secp256k1Error.invalidPrivateKey
        }
        return try secp.signRecoverable(digest: digest, privateKey: custodyPrivateKey)
    }

    /// ABI-encode SignedKeyRequestMetadata for KeyAddBody.metadata.
    /// Standard Solidity abi.encode((tuple)) — leading 32-byte offset word
    /// pointing at the tuple, then heads, then the signature tail.
    public static func abiEncodeMetadata(requestFid: UInt64, requestSigner: String, signature: [UInt8], deadline: UInt64) throws -> [UInt8] {
        let headSize = 32 * 4
        let paddedLen = ((signature.count + 31) / 32) * 32
        var sigPadded = [UInt8](repeating: 0, count: paddedLen)
        sigPadded.replaceSubrange(0..<signature.count, with: signature)
        var tuple = toUint256(requestFid)
        tuple.append(contentsOf: try addressTo32(requestSigner))
        tuple.append(contentsOf: toUint256(UInt64(headSize)))
        tuple.append(contentsOf: toUint256(deadline))
        tuple.append(contentsOf: toUint256(UInt64(signature.count)))
        tuple.append(contentsOf: sigPadded)
        return toUint256(32) + tuple
    }
}
