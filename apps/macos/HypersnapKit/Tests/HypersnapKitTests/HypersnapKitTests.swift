import CryptoKit
import Foundation
import Testing
@testable import HypersnapProtocol

private func h(_ hex: String) -> [UInt8] { try! hexToBytes(hex) }

private struct Golden: Decodable {
    let CUSTODY_ADDR: String
    let CUSTODY_PRIV: String
    let SIGNER_PUB_HEX: String
    let ENVELOPE_HEX: String
    let DATA_BYTES_HEX: String
    let KEY_ADD_DIGEST_HEX: String
}

private func loadGolden() throws -> Golden {
    let url = Bundle.module.url(forResource: "keyadd-golden", withExtension: "json", subdirectory: "Resources")!
    return try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
}

@Suite("Keccak-256")
struct KeccakTests {
    @Test func empty() {
        #expect(bytesToHex(Keccak.keccak256([])) == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")
    }
    @Test func abc() {
        #expect(bytesToHex(Keccak.keccak256("abc")) == "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45")
    }
}

@Suite("BLAKE3")
struct Blake3Tests {
    // Generated with @noble/hashes blake3 (same version the web client uses).
    static let vectors: [(Int, String, String)] = [
        (0, "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262", "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9"),
        (3, "e1be4d7a8ab5560aa4199eea339849ba8e293d55ca0a81006726d184519e647f", "e1be4d7a8ab5560aa4199eea339849ba8e293d55"),
        (64, "4eed7141ea4a5cd4b788606bd23f46e212af9cacebacdc7d1f4c6dc7f2511b98", "4eed7141ea4a5cd4b788606bd23f46e212af9cac"),
        (65, "de1e5fa0be70df6d2be8fffd0e99ceaa8eb6e8c93a63f2d8d1c30ecb6b263dee", "de1e5fa0be70df6d2be8fffd0e99ceaa8eb6e8c9"),
        (1023, "10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11", "10108970eeda3eb932baac1428c7a2163b0e924c"),
        (1024, "42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7", "42214739f095a406f3fc83deb889744ac00df831"),
        (1025, "d00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444", "d00278ae47eb27b34faecf67b4fe263f82d54129"),
        (2049, "5f4d72f40d7a5f82b15ca2b2e44b1de3c2ef86c426c95c1af0b6879522563030", "5f4d72f40d7a5f82b15ca2b2e44b1de3c2ef86c4"),
        (4096, "015094013f57a5277b59d8475c0501042c0b642e531b0a1c8f58d2163229e969", "015094013f57a5277b59d8475c0501042c0b642e"),
    ]

    @Test(arguments: vectors) func matches(_ n: Int, _ expected32: String, _ expected20: String) {
        let input = (0..<n).map { UInt8($0 % 251) }
        #expect(bytesToHex(Blake3.hash(input, outLen: 32)) == expected32)
        #expect(bytesToHex(Blake3.hash(input, outLen: 20)) == expected20)
    }
}

@Suite("BIP-39 / BIP-32 custody derivation")
struct CustodyTests {
    static let mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art"

    @Test func validatesKnownGoodPhrase() throws {
        try Bip39.validate(normalized: Bip39.normalize(Self.mnemonic))
    }

    @Test func rejectsBadChecksum() throws {
        let bad = Self.mnemonic.replacingOccurrences(of: " art", with: " zoo")
        #expect(throws: MnemonicError.invalidChecksum) {
            try Bip39.validate(normalized: Bip39.normalize(bad))
        }
    }

    @Test func seedMatchesReference() throws {
        let normalized = Bip39.normalize(Self.mnemonic)
        let seed = Bip39.seed(normalized: normalized)
        #expect(bytesToHex(seed) == "408b285c123836004f4b8842c89324c1f01382450c0d439af345ba7fc49acf705489c6fc77dbd4e3dc1dd8cc6bc9f043db8ada1e243c4a0eafb290d399480840")
    }

    @Test func custodyPathAndAddress() throws {
        let secp = try Secp256k1()
        let normalized = Bip39.normalize(Self.mnemonic)
        let seed = Bip39.seed(normalized: normalized)
        let node = try HDNode.master(seed: seed, secp: secp).derive(path: "m/44'/60'/0'/0/0", secp: secp)
        #expect(bytesToHex(node.privateKey) == "1053fae1b3ac64f178bcc21026fd06a3f4544ec2f35338b001f02d1d8efa3d5f")
        #expect(try secp.address(privateKey: node.privateKey) == "0xf278cf59f82edcf871d630f28ecc8056f25c1cdb")
    }
}

@Suite("Hypersnap wire compatibility")
struct GoldenTests {
    /// Mirror of packages/protocol/src/protocol.test.ts — the same fixed inputs
    /// must produce the node-approved envelope byte for byte.
    @Test func keyAddEnvelopeMatchesGolden() throws {
        let golden = try loadGolden()
        let secp = try Secp256k1()
        let custody = h(golden.CUSTODY_PRIV)
        let secret = [UInt8](repeating: 0x11, count: 32)
        let signer = try Ed25519Key(seed: secret)
        let key = signer.publicKey
        #expect(bytesToHex(key) == golden.SIGNER_PUB_HEX)

        let fid: UInt64 = 1234
        let deadline: UInt64 = 1_893_456_000
        let nonce: UInt32 = 1_700_000_000
        let ttl: UInt64 = 86400
        let scopes: [Int32] = [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15]

        let digest = SignedKeyRequest.keyAddDigest(
            fid: fid, key: key, keyType: 1,
            scopes: scopes.map { UInt32(bitPattern: $0) },
            ttl: UInt32(ttl), nonce: nonce, deadline: deadline
        )
        #expect(bytesToHex(digest) == golden.KEY_ADD_DIGEST_HEX)

        let custodySignature = try SignedKeyRequest.signDigest(digest, custodyPrivateKey: custody, secp: secp)
        let requestDigest = SignedKeyRequest.signedKeyRequestDigest(requestFid: fid, key: key, deadline: deadline)
        let requestSignature = try SignedKeyRequest.signDigest(requestDigest, custodyPrivateKey: custody, secp: secp)
        let requestSigner = try secp.address(privateKey: custody)
        #expect(requestSigner == golden.CUSTODY_ADDR)

        let metadata = try SignedKeyRequest.abiEncodeMetadata(
            requestFid: fid, requestSigner: requestSigner,
            signature: requestSignature, deadline: deadline
        )
        let dataBytes = try encodeMessageData(
            type: .keyAdd, fid: fid, timestamp: 100_000_000, network: .mainnet,
            body: .keyAdd(KeyAddInput(
                key: key, custodySignature: custodySignature, deadline: deadline,
                nonce: nonce, metadata: metadata, scopes: scopes, ttl: ttl
            ))
        )
        #expect(bytesToHex(dataBytes) == golden.DATA_BYTES_HEX)

        let signed = try buildSignedMessage(
            type: .keyAdd, fid: fid, timestamp: 100_000_000, network: .mainnet,
            body: .keyAdd(KeyAddInput(
                key: key, custodySignature: custodySignature, deadline: deadline,
                nonce: nonce, metadata: metadata, scopes: scopes, ttl: ttl
            )),
            signer: signer
        )
        #expect(bytesToHex(signed.envelope) == golden.ENVELOPE_HEX)
    }
}
