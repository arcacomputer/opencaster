// Session model + sign-in coordinator. The recovery phrase is used only
// transiently to derive the custody key; the phrase itself is never stored,
// logged, or included in diagnostics. Mutable byte buffers holding key
// material are zeroed after use where Swift value semantics allow.
import Foundation
import HypersnapAPI
import HypersnapProtocol

/// What survives in the Keychain between launches.
struct SessionRecord: Codable, Sendable {
    var fid: UInt64
    var username: String
    var custodyAddress: String
    /// 32-byte secp256k1 custody key (hex). Retained so the app can build a
    /// custody-signed KEY_REMOVE without re-prompting for the phrase.
    var custodyPrivateKeyHex: String
    /// 32-byte Ed25519 device signer seed (hex).
    var deviceSeedHex: String
    /// 32-byte Ed25519 device signer public key (hex).
    var signerPublicKeyHex: String
    /// Message-type scopes the signer was registered with.
    var scopes: [Int32]
    var ttl: UInt64
}

enum SessionError: Error, LocalizedError {
    case invalidPhrase
    case accountNotFound
    case custodyMismatch
    case signerNotRegistered
    case gaslessLimitReached
    case revoked
    case timedOutWaitingForSigner

    var errorDescription: String? {
        switch self {
        case .invalidPhrase:
            return "Enter a valid 24-word English recovery phrase."
        case .accountNotFound:
            return "No Farcaster account is registered to this recovery phrase's custody address."
        case .custodyMismatch:
            return "The recovery phrase does not match the account's custody address."
        case .signerNotRegistered:
            return "This device's signer is no longer registered. Sign in again."
        case .gaslessLimitReached:
            return "This account has reached the node's gasless signer limit. Revoke an existing signer first."
        case .revoked:
            return "This signer was revoked. Sign in again."
        case .timedOutWaitingForSigner:
            return "The node accepted the registration but hasn't confirmed it yet. Try 'Check status' in Settings shortly."
        }
    }
}

/// The live signing context for an authenticated session.
struct ActiveSigner: Sendable {
    let fid: UInt64
    let deviceKey: Ed25519Key
    let custodyPrivateKey: [UInt8]
    let custodyAddress: String
    let scopes: [Int32]

    func sign(_ body: MessageBody, type: MessageType, timestamp: UInt64? = nil) throws -> SignedMessage {
        try buildSignedMessage(type: type, fid: fid, timestamp: timestamp, network: .mainnet, body: body, signer: deviceKey)
    }
}

@MainActor
@Observable
final class SessionManager {
    enum Phase: Equatable {
        case signedOut
        case restoring
        case signingIn(step: String)
        case signedIn
    }

    private(set) var phase: Phase = .signedOut
    var lastError: String?

    private(set) var signer: ActiveSigner?
    private(set) var user: User?

    let client = HypersnapClient()
    @ObservationIgnored
    private(set) lazy var publisher = Publisher(session: self)

    /// Standard pairing grants: full client scopes + 7-day sliding TTL, and
    /// the 15-minute authorization window used across Opencaster signers.
    static let scopes: [Int32] = [1, 2, 3, 4, 5, 6, 11]
    static let ttlSeconds: UInt64 = 7 * 24 * 60 * 60
    static let pairingWindowSeconds: UInt64 = 15 * 60
    static let custodyPath = "m/44'/60'/0'/0/0"
    static let phraseMaxLength = 512

    var isSignedIn: Bool { signer != nil }

    /// Best-effort wipe of a mutable key-material buffer.
    private func wipe(_ bytes: inout [UInt8]) {
        bytes.withUnsafeMutableBytes { region in
            region.baseAddress?.assumingMemoryBound(to: UInt8.self).assign(repeating: 0, count: region.count)
        }
    }

    /// Derive the secp256k1 custody key from a recovery phrase.
    /// Throws MnemonicError for invalid phrases; never retains the phrase.
    private func custodyKey(phrase: String) throws -> (privateKey: [UInt8], address: String) {
        guard phrase.count <= Self.phraseMaxLength else { throw SessionError.invalidPhrase }
        var normalized = Bip39.normalize(phrase)
        defer { normalized.removeAll(keepingCapacity: false) }
        try Bip39.validate(normalized: normalized)
        var seed = Bip39.seed(normalized: normalized)
        defer { wipe(&seed) }
        let secp = try Secp256k1()
        let node = try HDNode.master(seed: seed, secp: secp).derive(path: Self.custodyPath, secp: secp)
        let address = try secp.address(privateKey: node.privateKey)
        return (node.privateKey, address)
    }

    /// Full sign-in: phrase → custody key → FID → device KEY_ADD → Keychain.
    func signIn(phrase rawPhrase: String) async {
        guard case .signedOut = phase else { return }
        lastError = nil
        var custody: [UInt8] = []
        do {
            phase = .signingIn(step: "Deriving custody key…")
            let derived = try custodyKey(phrase: rawPhrase)
            custody = derived.privateKey

            phase = .signingIn(step: "Finding your account…")
            let user = try await client.getUser(custodyAddress: derived.address)
            let fid = user.fid

            phase = .signingIn(step: "Reading signer state…")
            let signers = try await client.getSigners(fid: fid)
            if let limit = signers.gaslessSignerLimit, let count = signers.gaslessSignerCount, count >= limit {
                throw SessionError.gaslessLimitReached
            }

            // Authorize a fresh Ed25519 device key with the custody key.
            phase = .signingIn(step: "Authorizing this device…")
            let deviceKey = try Ed25519Key()
            let nowSeconds = UInt64(Date().timeIntervalSince1970)
            let deadline = nowSeconds - farcasterEpochSeconds + Self.pairingWindowSeconds
            let nonce = UInt32(signers.currentUserNonce + 1)
            let secp = try Secp256k1()

            let keyAddSig = try SignedKeyRequest.signDigest(
                SignedKeyRequest.keyAddDigest(fid: fid, key: deviceKey.publicKey, keyType: 1,
                                              scopes: Self.scopes.map(UInt32.init), ttl: UInt32(Self.ttlSeconds),
                                              nonce: nonce, deadline: deadline),
                custodyPrivateKey: custody, secp: secp)
            let requestSig = try SignedKeyRequest.signDigest(
                SignedKeyRequest.signedKeyRequestDigest(requestFid: fid, key: deviceKey.publicKey, deadline: deadline),
                custodyPrivateKey: custody, secp: secp)
            let metadata = try SignedKeyRequest.abiEncodeMetadata(requestFid: fid, requestSigner: derived.address,
                                                                  signature: requestSig, deadline: deadline)

            phase = .signingIn(step: "Registering device signer…")
            let message = try buildSignedMessage(
                type: .keyAdd, fid: fid, network: .mainnet,
                body: .keyAdd(KeyAddInput(key: deviceKey.publicKey, custodySignature: keyAddSig,
                                          deadline: deadline, nonce: nonce, metadata: metadata,
                                          scopes: Self.scopes, ttl: Self.ttlSeconds)),
                signer: deviceKey)
            _ = try await client.submitMessage(message.envelope)

            phase = .signingIn(step: "Confirming registration…")
            try await waitForSigner(fid: fid, publicKeyHex: bytesToHex(deviceKey.publicKey))

            let record = SessionRecord(
                fid: fid, username: user.username, custodyAddress: derived.address,
                custodyPrivateKeyHex: bytesToHex(custody),
                deviceSeedHex: bytesToHex(deviceKey.seed),
                signerPublicKeyHex: bytesToHex(deviceKey.publicKey),
                scopes: Self.scopes, ttl: Self.ttlSeconds)
            try KeychainStore.save(record)
            activate(record: record, user: user)
        } catch {
            wipe(&custody)
            phase = .signedOut
            lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Restore the persisted session; verifies the device signer is still
    /// registered before activating. Never trusts the Keychain alone.
    func restore() async {
        guard phase == .signedOut else { return }
        do {
            phase = .restoring
            guard let record = try KeychainStore.load() else { phase = .signedOut; return }
            let signers = try await client.getSigners(fid: record.fid)
            let active = signers.signers.contains { Self.signerKeyMatches($0.key, publicKeyHex: record.signerPublicKeyHex) }
            guard active else {
                try? KeychainStore.delete()
                phase = .signedOut
                lastError = SessionError.signerNotRegistered.errorDescription
                return
            }
            let user = try await client.getUser(fid: record.fid)
            activate(record: record, user: user)
        } catch {
            phase = .signedOut
            lastError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func activate(record: SessionRecord, user: User) {
        do {
            let deviceKey = try Ed25519Key(seed: try hexToBytes(record.deviceSeedHex))
            let custody = try hexToBytes(record.custodyPrivateKeyHex)
            signer = ActiveSigner(fid: record.fid, deviceKey: deviceKey, custodyPrivateKey: custody,
                                  custodyAddress: record.custodyAddress, scopes: record.scopes)
            self.user = user
            lastError = nil
            phase = .signedIn
        } catch {
            phase = .signedOut
            lastError = "The saved session could not be read. Sign in again."
            try? KeychainStore.delete()
        }
    }

    /// Poll signer state until the KEY_ADD merges (the node applies a short
    /// cooldown) or give up after ~45s.
    private func waitForSigner(fid: UInt64, publicKeyHex: String) async throws {
        for _ in 0..<9 {
            let signers = try await client.getSigners(fid: fid)
            if signers.signers.contains(where: { Self.signerKeyMatches($0.key, publicKeyHex: publicKeyHex) }) { return }
            try await Task.sleep(for: .seconds(5))
        }
        throw SessionError.timedOutWaitingForSigner
    }

    /// The node may report signer keys as `0x…` or bare hex; compare normalized.
    private static func signerKeyMatches(_ nodeKey: String, publicKeyHex: String) -> Bool {
        var key = nodeKey.lowercased()
        if key.hasPrefix("0x") { key = String(key.dropFirst(2)) }
        return key == publicKeyHex.lowercased()
    }

    /// Custody-signed KEY_REMOVE for this device's signer, then local wipe.
    func revoke() async {
        guard let signer else { return signOut() }
        do {
            let signers = try await client.getSigners(fid: signer.fid)
            let nowSeconds = UInt64(Date().timeIntervalSince1970)
            let deadline = nowSeconds - farcasterEpochSeconds + Self.pairingWindowSeconds
            let nonce = UInt32(signers.currentUserNonce + 1)
            let secp = try Secp256k1()
            let signature = try SignedKeyRequest.signDigest(
                SignedKeyRequest.keyRemoveDigest(fid: signer.fid, key: signer.deviceKey.publicKey,
                                                 nonce: nonce, deadline: deadline),
                custodyPrivateKey: signer.custodyPrivateKey, secp: secp)
            let message = try signer.sign(.keyRemove(KeyRemoveInput(
                key: signer.deviceKey.publicKey, signature: signature, signatureType: 1,
                deadline: deadline, nonce: nonce)), type: .keyRemove)
            _ = try await client.submitMessage(message.envelope)
        } catch {
            lastError = "Revocation could not be submitted: \((error as? LocalizedError)?.errorDescription ?? error.localizedDescription). The local session was still cleared."
        }
        signOut()
    }

    func signOut() {
        signer = nil
        user = nil
        try? KeychainStore.delete()
        phase = .signedOut
    }
}
