// Codable models mirroring the Hypersnap wire format used by
// packages/client-core/src/api.ts. Field names follow the node's
// JSON (snake_case v2 payloads; camelCase v1 receipt payloads).
import Foundation

public struct User: Codable, Sendable, Equatable {
    public struct Bio: Codable, Sendable, Equatable { public var text: String }
    public struct Banner: Codable, Sendable, Equatable { public var url: String? }
    public struct Profile: Codable, Sendable, Equatable {
        public var bio: Bio
        public var banner: Banner?
    }
    public struct VerifiedAddresses: Codable, Sendable, Equatable {
        public var ethAddresses: [String]?
        public var solAddresses: [String]?
    }
    public struct ViewerContext: Codable, Sendable, Equatable {
        public var following: Bool
        public var followedBy: Bool
    }

    public var fid: UInt64
    public var username: String
    public var displayName: String?
    public var pfpUrl: String?
    public var custodyAddress: String?
    public var registeredAt: String?
    public var profile: Profile?
    public var followerCount: Int
    public var followingCount: Int
    public var verifiedAddresses: VerifiedAddresses?
    public var viewerContext: ViewerContext?
}

public struct Channel: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var url: String
    public var parentUrl: String?
    public var imageUrl: String?
    public var description: String?
    public var followerCount: Int?
    /// Unique accounts that have posted here; this is not a subscription count.
    public var memberCount: Int?
}

public enum CastEmbed: Sendable, Equatable {
    case url(String)
    case castId(fid: UInt64, hash: String)
}

extension CastEmbed: Codable {
    private struct UrlWire: Codable { var url: String }
    private struct CastIdWire: Codable {
        struct CastId: Codable { var fid: UInt64; var hash: String }
        var castId: CastId
    }
    public init(from decoder: Decoder) throws {
        let single = try decoder.singleValueContainer()
        if let wire = try? single.decode(UrlWire.self) {
            self = .url(wire.url)
        } else if let wire = try? single.decode(CastIdWire.self) {
            self = .castId(fid: wire.castId.fid, hash: wire.castId.hash)
        } else {
            throw DecodingError.dataCorruptedError(in: single, debugDescription: "Unknown embed shape")
        }
    }
    public func encode(to encoder: Encoder) throws {
        var single = encoder.singleValueContainer()
        switch self {
        case .url(let url): try single.encode(UrlWire(url: url))
        case .castId(let fid, let hash): try single.encode(CastIdWire(castId: .init(fid: fid, hash: hash)))
        }
    }
}

public struct Cast: Codable, Sendable, Equatable {
    public struct ParentAuthor: Codable, Sendable, Equatable { public var fid: UInt64? }
    public struct Reactions: Codable, Sendable, Equatable {
        public var likesCount: Int
        public var recastsCount: Int
    }
    public struct Replies: Codable, Sendable, Equatable { public var count: Int }
    public struct MentionRange: Codable, Sendable, Equatable { public var start: Int; public var end: Int }
    public struct ViewerContext: Codable, Sendable, Equatable {
        public var liked: Bool
        public var recasted: Bool
    }
    /// Original publication time stays in timestamp; this identifies profile activity.
    public struct ReactionContext: Codable, Sendable, Equatable {
        public enum Kind: String, Codable, Sendable { case like, recast }
        public var fid: UInt64
        public var type: Kind
        public var timestamp: String
    }

    public var hash: String
    public var author: User
    public var text: String
    public var timestamp: String
    public var parentHash: String?
    public var parentUrl: String?
    public var rootParentUrl: String?
    public var parentAuthor: ParentAuthor?
    public var embeds: [CastEmbed]
    public var reactions: Reactions
    public var replies: Replies
    public var mentionedProfiles: [User]?
    public var mentionedProfilesRanges: [MentionRange]?
    public var channel: Channel?
    public var viewerContext: ViewerContext?
    public var reactionContext: ReactionContext?

    /// Nested replies arrive under `direct_replies` in conversation payloads.
    var directReplies: [Cast]?

    enum CodingKeys: String, CodingKey {
        case hash, author, text, timestamp, embeds, reactions, replies, channel
        case parentHash, parentUrl, rootParentUrl, parentAuthor
        case mentionedProfiles, mentionedProfilesRanges
        case viewerContext, reactionContext, directReplies
    }
}

extension Cast: Identifiable {
    public var id: String { hash }
}

public struct PageNext: Codable, Sendable, Equatable {
    public var cursor: String?
}

public struct FeedResponse: Sendable {
    public var casts: [Cast]
    public var next: PageNext
}

public struct FollowsResponse: Sendable {
    public var users: [User]
    public var next: PageNext
}

public struct ChannelsResponse: Sendable {
    public var channels: [Channel]
    public var next: PageNext
}

public enum ActivityItemType: String, Sendable {
    case reactions, follows, replies, mentions, unknown
}

/// The node currently omits the like/recast subtype from notification receipts.
public struct ActivityItem: Sendable {
    public var id: String
    public var type: ActivityItemType
    public var timestamp: String
    public var actors: [User]
    public var cast: Cast?
    public var targetHash: String?
}

public struct NotificationsResponse: Sendable {
    public var notifications: [ActivityItem]
    public var next: PageNext
}

public struct ConversationNode: Sendable {
    public var cast: Cast
    public var replies: [ConversationNode]
}

public struct Signer: Codable, Sendable, Equatable {
    public var key: String
    public var fid: UInt64?
    public var source: String?
    /// KEY_ADD timestamp expressed as Unix epoch seconds by the node.
    public var addedAt: UInt64?
    public var expiresAt: UInt64?
    public var scopes: [String]?
    public var requestFid: UInt64?
    public var nonce: UInt64?
}

public struct SignersResponse: Sendable {
    public var signers: [Signer]
    public var currentUserNonce: UInt64
    public var gaslessSignerCount: UInt64?
    public var gaslessSignerLimit: UInt64?
    public var nextPageToken: String?
}

public struct NodeInfo: Sendable {
    public var raw: [String: AnyCodableValue]
}

/// Loose JSON value for endpoint payloads we surface verbatim (node info, submit receipts).
public enum AnyCodableValue: Codable, Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: AnyCodableValue])
    case array([AnyCodableValue])
    case null

    public init(from decoder: Decoder) throws {
        let single = try decoder.singleValueContainer()
        if single.decodeNil() { self = .null }
        else if let v = try? single.decode(Bool.self) { self = .bool(v) }
        else if let v = try? single.decode(Double.self) { self = .number(v) }
        else if let v = try? single.decode(String.self) { self = .string(v) }
        else if let v = try? single.decode([String: AnyCodableValue].self) { self = .object(v) }
        else if let v = try? single.decode([AnyCodableValue].self) { self = .array(v) }
        else { throw DecodingError.dataCorruptedError(in: single, debugDescription: "Unsupported JSON value") }
    }

    public func encode(to encoder: Encoder) throws {
        var single = encoder.singleValueContainer()
        switch self {
        case .string(let v): try single.encode(v)
        case .number(let v): try single.encode(v)
        case .bool(let v): try single.encode(v)
        case .object(let v): try single.encode(v)
        case .array(let v): try single.encode(v)
        case .null: try single.encodeNil()
        }
    }
}

public struct SubmitMessageResponse: Sendable {
    public var hash: String?
    public var raw: [String: AnyCodableValue]
}

public enum TrendingTimeWindow: String, Sendable, CaseIterable {
    case h1 = "1h", h6 = "6h", h12 = "12h", h24 = "24h", d7 = "7d"
}

public enum FeedKind: Sendable, Equatable {
    case trending
    case following(fid: UInt64)
    case channel(id: String)
    case user(fid: UInt64)
}

public enum ProfileTab: String, Sendable, CaseIterable {
    case casts, replies, media, likes, recasts
}

public enum ReactionKind: String, Sendable {
    case like, recast
    /// Wire value used by the v1 reaction reads.
    var wireName: String { self == .like ? "Like" : "Recast" }
}

public struct ReactionTarget: Sendable, Hashable {
    public var fid: UInt64
    public var hash: String
    public init(fid: UInt64, hash: String) { self.fid = fid; self.hash = hash }
}
