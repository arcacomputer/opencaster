// Write path: sign Farcaster message bodies with the device signer and submit
// to the node. Mirrors the message bodies the web client publishes via the
// gateway; here we sign locally and POST the envelope directly.
import Foundation
import HypersnapAPI
import HypersnapProtocol

/// Farcaster's cast body limit is 320 bytes of UTF-8.
let castTextLimit = 320

enum PublishError: Error, LocalizedError {
    case notSignedIn
    case textTooLong
    case invalidTarget

    var errorDescription: String? {
        switch self {
        case .notSignedIn: return "Sign in to publish."
        case .textTooLong: return "Casts are limited to \(castTextLimit) bytes."
        case .invalidTarget: return "Invalid target."
        }
    }
}

@MainActor
@Observable
final class Publisher {
    private unowned let session: SessionManager
    var lastError: String?

    static let dryRunKey = "publisher.dryRun"
    /// When on, messages are signed and run through the node's validator
    /// (/v1/validateMessage) but never merged — nothing is published.
    var dryRun: Bool = UserDefaults.standard.bool(forKey: Publisher.dryRunKey) {
        didSet { UserDefaults.standard.set(dryRun, forKey: Self.dryRunKey) }
    }

    init(session: SessionManager) { self.session = session }

    private func submit(_ body: MessageBody, type: MessageType) async throws -> SignedMessage {
        guard let signer = session.signer else { throw PublishError.notSignedIn }
        let message = try signer.sign(body, type: type)
        if dryRun {
            _ = try await session.client.validateMessage(message.envelope)
        } else {
            _ = try await session.client.submitMessage(message.envelope)
        }
        return message
    }

    /// New cast / reply. `parent` replies to a cast; `quote` adds a quote embed.
    @discardableResult
    func cast(text: String, parent: Cast? = nil, quote: Cast? = nil) async throws -> SignedMessage {
        let bytes = Array(text.utf8)
        guard bytes.count <= castTextLimit else { throw PublishError.textTooLong }
        var embeds: [HypersnapProtocol.CastEmbed] = []
        if let quote {
            embeds.append(.castId(fid: quote.author.fid, hash: try hexToBytes(normalizeHash(quote.hash))))
        }
        let parentInput: CastParent? = parent.map {
            .castId(fid: $0.author.fid, hash: (try? hexToBytes(normalizeHash($0.hash))) ?? [])
        }
        return try await submit(.castAdd(CastAddInput(text: text, embeds: embeds, parent: parentInput)),
                              type: .castAdd)
    }

    @discardableResult
    func deleteCast(hash: String) async throws -> SignedMessage {
        try await submit(.castRemove(targetHash: hexToBytes(normalizeHash(hash))), type: .castRemove)
    }

    /// Like (1) or recast (2), add or remove. targetHash may be `0x`-prefixed.
    @discardableResult
    func react(_ kind: ReactionType, target: HypersnapAPI.ReactionTarget, add: Bool) async throws -> SignedMessage {
        let wireTarget = HypersnapProtocol.ReactionTarget.castId(
            fid: target.fid, hash: try hexToBytes(normalizeHash(target.hash)))
        return try await submit(.reaction(type: kind, target: wireTarget),
                              type: add ? .reactionAdd : .reactionRemove)
    }

    @discardableResult
    func follow(fid: UInt64, add: Bool) async throws -> SignedMessage {
        try await submit(.link(LinkInput(type: "follow", targetFid: fid)),
                       type: add ? .linkAdd : .linkRemove)
    }

    /// Single profile field (display name, bio, pfp URL, banner URL, …).
    @discardableResult
    func setProfileField(_ type: UserDataType, value: String) async throws -> SignedMessage {
        try await submit(.userData(type: type, value: value), type: .userDataAdd)
    }
}
