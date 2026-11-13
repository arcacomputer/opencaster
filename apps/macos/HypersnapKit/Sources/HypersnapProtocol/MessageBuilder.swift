// Port of packages/protocol/src/messageBuilder.ts (MIT-licensed quorum-shared origin).
// Build, sign, and serialize Farcaster Message protobuf payloads for POST /v1/submitMessage.
// Field numbers mirror hypersnap/proto/definitions/message.proto exactly.
import Foundation

public enum MessageType: Int {
    case none = 0
    case castAdd = 1
    case castRemove = 2
    case reactionAdd = 3
    case reactionRemove = 4
    case linkAdd = 5
    case linkRemove = 6
    case verificationAddEthAddress = 7
    case verificationRemove = 8
    case userDataAdd = 11
    case usernameProof = 12
    case frameAction = 13
    case linkCompactState = 14
    case lendStorage = 15
    case keyAdd = 16
    case keyRemove = 17
}

public enum HashScheme: Int { case none = 0, blake3 = 1 }
public enum SignatureScheme: Int { case none = 0, ed25519 = 1, eip712 = 2 }
public enum FarcasterNetwork: Int { case none = 0, mainnet = 1, testnet = 2, devnet = 3 }
public enum ReactionType: Int { case none = 0, like = 1, recast = 2 }

public enum UserDataType: Int {
    case none = 0, pfp = 1, display = 2, bio = 3, url = 5, username = 6
    case location = 7, twitter = 8, github = 9, banner = 10
    case primaryAddressEthereum = 11, primaryAddressSolana = 12, profileToken = 13
}

public enum CastType: Int { case cast = 0, longCast = 1, tenKCast = 2 }

/// Farcaster epoch: 2021-01-01T00:00:00Z.
public let farcasterEpochSeconds: UInt64 = 1_609_459_200
public let farcasterEpochMs: UInt64 = farcasterEpochSeconds * 1000

public func farcasterTimestamp(nowMs: UInt64 = UInt64(Date().timeIntervalSince1970 * 1000)) -> UInt64 {
    if nowMs < farcasterEpochMs { return 0 }
    return (nowMs - farcasterEpochMs) / 1000
}

// MARK: - Body shapes

public enum CastEmbed {
    case url(String)
    case castId(fid: UInt64, hash: [UInt8])
}

public enum CastParent {
    case castId(fid: UInt64, hash: [UInt8])
    case url(String)
}

public struct CastAddInput {
    public var text: String
    public var embeds: [CastEmbed]
    public var mentions: [UInt64]
    public var mentionsPositions: [UInt64]
    public var parent: CastParent?
    public var type: CastType

    public init(text: String, embeds: [CastEmbed] = [], mentions: [UInt64] = [], mentionsPositions: [UInt64] = [], parent: CastParent? = nil, type: CastType = .cast) {
        self.text = text
        self.embeds = embeds
        self.mentions = mentions
        self.mentionsPositions = mentionsPositions
        self.parent = parent
        self.type = type
    }
}

public enum ReactionTarget {
    case castId(fid: UInt64, hash: [UInt8])
    case url(String)
}

public struct LinkInput {
    public var type: String
    public var targetFid: UInt64
    public var displayTimestamp: UInt64?

    public init(type: String = "follow", targetFid: UInt64, displayTimestamp: UInt64? = nil) {
        self.type = type
        self.targetFid = targetFid
        self.displayTimestamp = displayTimestamp
    }
}

public struct KeyAddInput {
    public var key: [UInt8]              // 32-byte Ed25519 public key
    public var custodySignature: [UInt8] // 65-byte EIP-712 sig
    public var deadline: UInt64          // Farcaster epoch seconds
    public var nonce: UInt32
    public var metadata: [UInt8]         // ABI-encoded SignedKeyRequestMetadata
    public var scopes: [Int32]           // allowed MessageType values
    public var ttl: UInt64               // sliding TTL seconds
    public var registrationTxHash: [UInt8]?
    public var metadataType: UInt64      // always 1 (SIGNED_KEY_REQUEST)
    public var keyType: UInt64           // always 1 (Ed25519)

    public init(key: [UInt8], custodySignature: [UInt8], deadline: UInt64, nonce: UInt32, metadata: [UInt8], scopes: [Int32], ttl: UInt64) {
        self.key = key
        self.custodySignature = custodySignature
        self.deadline = deadline
        self.nonce = nonce
        self.metadata = metadata
        self.scopes = scopes
        self.ttl = ttl
        self.metadataType = 1
        self.keyType = 1
    }
}

public struct KeyRemoveInput {
    public var key: [UInt8]
    public var signature: [UInt8]
    public var signatureType: UInt64 // 1 = custody (EIP-712), 2 = self (Ed25519)
    public var deadline: UInt64
    public var nonce: UInt32

    public init(key: [UInt8], signature: [UInt8], signatureType: UInt64, deadline: UInt64, nonce: UInt32) {
        self.key = key
        self.signature = signature
        self.signatureType = signatureType
        self.deadline = deadline
        self.nonce = nonce
    }
}

public enum MessageBody {
    case castAdd(CastAddInput)
    case castRemove(targetHash: [UInt8])
    case reaction(type: ReactionType, target: ReactionTarget)
    case link(LinkInput)
    case userData(type: UserDataType, value: String)
    case keyAdd(KeyAddInput)
    case keyRemove(KeyRemoveInput)
}

public enum MessageBuildError: Error {
    case invalidKeyLength
    case emptyScopes
    case invalidTtl
}

// MARK: - Body encoders → MessageData bytes

private func encodeCastId(fid: UInt64, hash: [UInt8]) -> [UInt8] {
    var w = ProtoWriter()
    w.writeVarintField(1, fid)
    w.writeBytesField(2, hash)
    return w.bytes()
}

private func encodeEmbed(_ e: CastEmbed) -> [UInt8] {
    var w = ProtoWriter()
    switch e {
    case .url(let url): w.writeStringField(1, url)
    case .castId(let fid, let hash): w.writeSubMessage(2, encodeCastId(fid: fid, hash: hash))
    }
    return w.bytes()
}

func encodeCastAddBody(_ input: CastAddInput) -> [UInt8] {
    var w = ProtoWriter()
    // field 1: embeds_deprecated (skipped — proto3 default empty)
    if !input.mentions.isEmpty { w.writePackedVarint(2, input.mentions) }
    if let parent = input.parent {
        switch parent {
        case .castId(let fid, let hash): w.writeSubMessage(3, encodeCastId(fid: fid, hash: hash))
        case .url(let url): w.writeStringField(7, url)
        }
    }
    w.writeStringField(4, input.text)
    if !input.mentionsPositions.isEmpty { w.writePackedVarint(5, input.mentionsPositions) }
    for embed in input.embeds { w.writeSubMessage(6, encodeEmbed(embed)) }
    if input.type != .cast { w.writeVarintField(8, UInt64(input.type.rawValue)) }
    return w.bytes()
}

func encodeReactionBody(type: ReactionType, target: ReactionTarget) -> [UInt8] {
    var w = ProtoWriter()
    w.writeVarintField(1, UInt64(type.rawValue))
    switch target {
    case .castId(let fid, let hash): w.writeSubMessage(2, encodeCastId(fid: fid, hash: hash))
    case .url(let url): w.writeStringField(3, url)
    }
    return w.bytes()
}

func encodeLinkBody(_ input: LinkInput) -> [UInt8] {
    var w = ProtoWriter()
    w.writeStringField(1, input.type)
    if let ts = input.displayTimestamp { w.writeVarintField(2, ts) }
    w.writeVarintField(3, input.targetFid)
    return w.bytes()
}

func encodeKeyAddBody(_ input: KeyAddInput) throws -> [UInt8] {
    if input.key.count != 32 { throw MessageBuildError.invalidKeyLength }
    if input.scopes.isEmpty { throw MessageBuildError.emptyScopes }
    if input.ttl == 0 { throw MessageBuildError.invalidTtl }
    var w = ProtoWriter()
    w.writeBytesField(1, input.key)
    w.writeVarintField(2, input.keyType)
    w.writeBytesField(3, input.custodySignature)
    w.writeVarintField(4, input.deadline)
    w.writeVarintField(5, UInt64(input.nonce))
    w.writeBytesField(6, input.metadata)
    w.writeVarintField(7, input.metadataType)
    if let tx = input.registrationTxHash, !tx.isEmpty { w.writeBytesField(8, tx) }
    w.writePackedInt32(9, input.scopes)
    w.writeVarintField(10, input.ttl)
    return w.bytes()
}

func encodeKeyRemoveBody(_ input: KeyRemoveInput) throws -> [UInt8] {
    if input.key.count != 32 { throw MessageBuildError.invalidKeyLength }
    var w = ProtoWriter()
    w.writeBytesField(1, input.key)
    w.writeBytesField(2, input.signature)
    w.writeVarintField(3, input.signatureType)
    w.writeVarintField(4, input.deadline)
    w.writeVarintField(5, UInt64(input.nonce))
    return w.bytes()
}

// MARK: - MessageData + envelope

public func encodeMessageData(type: MessageType, fid: UInt64, timestamp: UInt64? = nil, network: FarcasterNetwork = .mainnet, body: MessageBody) throws -> [UInt8] {
    var w = ProtoWriter()
    w.writeVarintField(1, UInt64(type.rawValue))
    w.writeVarintField(2, fid)
    w.writeVarintField(3, timestamp ?? farcasterTimestamp())
    w.writeVarintField(4, UInt64(network.rawValue))
    switch body {
    case .castAdd(let input):
        w.writeSubMessage(5, encodeCastAddBody(input))
    case .castRemove(let targetHash):
        var b = ProtoWriter()
        b.writeBytesField(1, targetHash)
        w.writeSubMessage(6, b.bytes())
    case .reaction(let type, let target):
        w.writeSubMessage(7, encodeReactionBody(type: type, target: target))
    case .userData(let type, let value):
        var b = ProtoWriter()
        b.writeVarintField(1, UInt64(type.rawValue))
        b.writeStringField(2, value)
        w.writeSubMessage(12, b.bytes())
    case .link(let input):
        w.writeSubMessage(14, encodeLinkBody(input))
    case .keyAdd(let input):
        try w.writeSubMessage(19, encodeKeyAddBody(input))
    case .keyRemove(let input):
        try w.writeSubMessage(20, encodeKeyRemoveBody(input))
    }
    return w.bytes()
}

public func blake3_20(_ data: [UInt8]) -> [UInt8] { Blake3.hash20(data) }

/// Envelope: emits BOTH field 1 (data) and field 7 (data_bytes) with identical
/// payload — the validator hashes data_bytes while the merge path reads data.
public func encodeMessageEnvelope(dataBytes: [UInt8], hash: [UInt8], signature: [UInt8], signatureScheme: SignatureScheme, signer: [UInt8]) -> [UInt8] {
    var w = ProtoWriter()
    w.writeSubMessage(1, dataBytes)
    w.writeBytesField(2, hash)
    w.writeVarintField(3, UInt64(HashScheme.blake3.rawValue))
    w.writeBytesField(4, signature)
    w.writeVarintField(5, UInt64(signatureScheme.rawValue))
    w.writeBytesField(6, signer)
    w.writeBytesField(7, dataBytes)
    return w.bytes()
}

public struct SignedMessage {
    public let envelope: [UInt8]
    public let hash: [UInt8]
}

/// End-to-end: encode MessageData → blake3_20 → Ed25519 sign → envelope.
public func buildSignedMessage(type: MessageType, fid: UInt64, timestamp: UInt64? = nil, network: FarcasterNetwork = .mainnet, body: MessageBody, signer: Ed25519Key) throws -> SignedMessage {
    let dataBytes = try encodeMessageData(type: type, fid: fid, timestamp: timestamp, network: network, body: body)
    let hash = blake3_20(dataBytes)
    let signature = try signer.sign(hash)
    let envelope = encodeMessageEnvelope(
        dataBytes: dataBytes,
        hash: hash,
        signature: signature,
        signatureScheme: .ed25519,
        signer: signer.publicKey
    )
    return SignedMessage(envelope: envelope, hash: hash)
}
