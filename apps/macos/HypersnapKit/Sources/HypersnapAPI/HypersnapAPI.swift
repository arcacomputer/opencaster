// Async client for the public Hypersnap node API, ported from
// packages/client-core/src/api.ts. Reads hit the node directly
// (default https://haatz.quilibrium.com); writes are signed message
// envelopes POSTed to /v1/submitMessage as application/octet-stream.
import Foundation

public struct ApiError: Error, Sendable, Equatable {
    public let message: String
    public let status: Int
    public let code: String
    public init(_ message: String, status: Int, code: String = "api_error") {
        self.message = message
        self.status = status
        self.code = code
    }
}

extension ApiError: LocalizedError {
    public var errorDescription: String? { message }
}

public enum ApiInputError: Error, Equatable, LocalizedError {
    case invalidFid, invalidCastHash, invalidAddress, invalidLimit, invalidCursor
    case invalidChannel, invalidUsername, invalidSearchQuery, invalidLookup
    public var errorDescription: String? {
        switch self {
        case .invalidFid: return "Enter a valid Farcaster ID."
        case .invalidCastHash: return "Invalid cast hash."
        case .invalidAddress: return "Invalid wallet address."
        case .invalidLimit: return "Feed limit must be between 1 and 100."
        case .invalidCursor: return "Invalid pagination cursor."
        case .invalidChannel: return "Invalid channel."
        case .invalidUsername: return "Enter a valid Farcaster username."
        case .invalidSearchQuery: return "Enter a search query of 1 to 256 bytes."
        case .invalidLookup: return "Use one profile identifier."
        }
    }
}

// MARK: - Input validation (mirrors apiRules.ts)

private let hexChars = Set("0123456789abcdefABCDEF")
private let channelChars = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
private let pageCursorChars = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_+/=:-")
private let base64Chars = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/")
private let usernameChars = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-")

/// `/^(?:0x)?[a-fA-F0-9]{40}$/`
func isCastHash(_ value: String) -> Bool {
    let digits = value.hasPrefix("0x") || value.hasPrefix("0X") ? value.dropFirst(2) : value[...]
    return digits.count == 40 && digits.allSatisfy(hexChars.contains)
}

private func isWalletAddress(_ value: String) -> Bool {
    value.hasPrefix("0x") && value.dropFirst(2).count == 40 && value.dropFirst(2).allSatisfy(hexChars.contains)
}

private func isChannelId(_ value: String) -> Bool {
    (1...64).contains(value.count) && value.allSatisfy(channelChars.contains)
}

private func isPageCursor(_ value: String) -> Bool {
    (1...2048).contains(value.count) && value.allSatisfy(pageCursorChars.contains)
}

/// `^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$` — strict
/// base64 group structure used by native v1 page tokens.
func validPageToken(_ value: String) -> Bool {
    guard !value.isEmpty, value.count <= 2048 else { return false }
    let fullGroups = value.count / 4
    let remainder = value.count % 4
    guard remainder == 0 else { return false }
    var index = value.startIndex
    for group in 0..<fullGroups {
        let end = value.index(index, offsetBy: 4)
        let chunk = value[index..<end]
        let isLast = group == fullGroups - 1
        if isLast {
            // Final group: four data chars, or `XX==`, or `XXX=`.
            let padding = chunk.reversed().prefix(while: { $0 == "=" }).count
            guard padding <= 2, chunk.prefix(4 - padding).allSatisfy(base64Chars.contains) else { return false }
        } else {
            guard chunk.allSatisfy(base64Chars.contains) else { return false }
        }
        index = end
    }
    return true
}

func validDecimalCursor(_ value: String) -> Bool {
    (1...20).contains(value.count) && value.allSatisfy({ $0.isASCII && $0.isNumber }) && UInt64(value) != nil
}

private func isUsername(_ value: String) -> Bool {
    (1...128).contains(value.count) && value.allSatisfy(usernameChars.contains)
}

private func isHexString(_ value: String) -> Bool {
    !value.isEmpty && value.count % 2 == 0 && value.allSatisfy(hexChars.contains)
}

func fidValue(_ fid: UInt64?) throws -> String {
    guard let fid, fid >= 1, fid <= 0xffff_ffff else { throw ApiInputError.invalidFid }
    return String(fid)
}

func hashValue(_ hash: String) throws -> String {
    guard isCastHash(hash) else { throw ApiInputError.invalidCastHash }
    return normalizeHash(hash)
}

private func addressValue(_ address: String) throws -> String {
    guard isWalletAddress(address) else { throw ApiInputError.invalidAddress }
    return address
}

private func channelIdValue(_ id: String) throws -> String {
    guard isChannelId(id) else { throw ApiInputError.invalidChannel }
    return id
}

private func searchQuery(_ value: String) throws -> String {
    let query = value.trimmingCharacters(in: .whitespaces)
    let bytes = Array(query.utf8)
    let hasControl = query.unicodeScalars.contains { $0.value < 0x20 || $0.value == 0x7f }
    guard !query.isEmpty, bytes.count <= 256, !hasControl else { throw ApiInputError.invalidSearchQuery }
    return query
}

/// Maximum page sizes accepted per endpoint family (API_LIMITS).
public enum APILimits {
    public static let page = 100
    public static let bulkUsers = 100
    public static let castReactions = 25
    public static let channelMembers = 25
    public static let castQuotes = 25
    public static let suggestedUsers = 20
}

// MARK: - Wire envelopes

private struct ErrorBody: Decodable { let code: String?; let message: String? }
private struct FeedWire: Decodable { let casts: [Cast]?; let next: PageNext? }
private struct UsersWire: Decodable { let users: [User]? }
private struct ChannelsWire: Decodable { let channels: [Channel]?; let next: PageNext? }
private struct UserWrap: Decodable { let user: User? }
private struct CastWrap: Decodable { let cast: Cast? }
private struct ChannelWrap: Decodable { let channel: Channel? }
private struct FollowsWire: Decodable { let users: [User]?; let next: PageNext? }
private struct MembersWire: Decodable {
    struct Member: Decodable { let user: User? }
    let members: [Member]?; let next: PageNext?
}
private struct NotificationsWire: Decodable {
    struct Item: Decodable { let type: String?; let user: User?; let cast: Cast?; let timestamp: String? }
    let notifications: [Item]?; let next: PageNext?
}
private struct MessagesWire: Decodable {
    let messages: [ReactionMessageWire]?
    let nextPageToken: String?
}
struct ReactionMessageWire: Decodable {
    struct Data: Decodable {
        struct ReactionBody: Decodable {
            struct TargetCastId: Decodable { let fid: UInt64?; let hash: String? }
            let type: String?
            let targetCastId: TargetCastId?
            let targetUrl: String?
        }
        let type: String?
        let fid: UInt64?
        let timestamp: UInt64?
        let network: String?
        let reactionBody: ReactionBody?
    }
    let hash: String?
    let data: Data?
}
private struct SignersWire: Decodable {
    let signers: [Signer]?
    let currentUserNonce: UInt64?
    let gaslessSignerCount: UInt64?
    let gaslessSignerLimit: UInt64?
    let nextPageToken: String?
}
private struct FidProof: Decodable { let fid: UInt64? }
private struct SearchCastsWire: Decodable { let result: FeedWire? }
private struct ConversationWire: Decodable {
    struct Nested: Decodable {
        let cast: Cast?
    }
    let conversation: Nested?
    let cast: Cast?
    let replies: [NestedReply]?
    struct NestedReply: Decodable {
        let cast: Cast?
        let replies: [NestedReply]?
    }
}
private struct LinkMessageWire: Decodable {
    struct Data: Decodable {
        struct LinkBody: Decodable { let type: String?; let targetFid: UInt64? }
        let type: String?
        let fid: UInt64?
        let linkBody: LinkBody?
    }
    let data: Data?
}

// MARK: - Client

public struct HypersnapClient: Sendable {
    public static let defaultBaseURL = URL(string: "https://haatz.quilibrium.com")!

    public let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder

    public init(baseURL: URL = HypersnapClient.defaultBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
    }

    // MARK: Transport

    /// The submission timeout case is special: a timed-out POST may still have
    /// reached the node, so transport failures surface as `submission_unknown`.
    private func request(path: String, query: [URLQueryItem] = [], body: [UInt8]? = nil) async throws -> Data {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw ApiError("Invalid request path.", status: 0) }
        var request = URLRequest(url: url, timeoutInterval: 25)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data(body)
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            if body != nil { throw ApiError(Self.submissionUnknown, status: 502, code: "submission_unknown") }
            if (error as NSError).code == NSURLErrorTimedOut {
                throw ApiError("The node took too long to respond. Try again.", status: 504, code: "timeout")
            }
            throw error
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let errorBody = try? decoder.decode(ErrorBody.self, from: data)
            let code = errorBody?.code ?? "api_error"
            let message = errorBody?.message.map { String($0.prefix(240)) } ?? "The node returned HTTP \(status)."
            let wrapped = ApiError(message, status: status, code: code)
            if body != nil && status >= 500 {
                throw ApiError(Self.submissionUnknown, status: status, code: "submission_unknown")
            }
            throw wrapped
        }
        return data
    }

    private static let submissionUnknown = "Submission status is unknown. Check your profile or signer state before trying again."

    private func json<T: Decodable>(_ type: T.Type, path: String, query: [URLQueryItem] = []) async throws -> T {
        let data = try await request(path: path, query: query)
        guard let value = try? decoder.decode(type, from: data) else {
            throw ApiError("The node returned an invalid response.", status: 502, code: "invalid_response")
        }
        return value
    }

    /// Normalize a v2 `next.cursor`: repeats, the `[null,null]` hex token, and
    /// malformed values all terminate or fail the same way the web client treats them.
    private func nextCursor(_ value: String?, previous: String?) throws -> String? {
        guard let value, !value.isEmpty, value != previous, value != "5b6e756c6c2c6e756c6c5d" else { return nil }
        guard isPageCursor(value) else {
            throw ApiError("The node returned invalid pagination.", status: 502, code: "invalid_response")
        }
        if isHexString(value), let raw = bytesFromHex(value),
           let decoded = try? JSONSerialization.jsonObject(with: raw) as? [Any?],
           !decoded.isEmpty, decoded.allSatisfy({ $0 == nil }) {
            return nil
        }
        return value
    }

    private func reactionCursor(_ value: String?, previous: String? = nil) throws -> String? {
        guard let value, !value.isEmpty else { return nil }
        guard validPageToken(value), value != previous else {
            throw ApiError("The node returned invalid reaction pagination.", status: 502, code: "invalid_response")
        }
        return value
    }

    private func pageQuery(cursor: String?, limit: Int) throws -> [URLQueryItem] {
        guard limit >= 1, limit <= APILimits.page else { throw ApiInputError.invalidLimit }
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor {
            guard isPageCursor(cursor) else { throw ApiInputError.invalidCursor }
            query.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return query
    }

    private func isValidUser(_ user: User) -> Bool {
        user.fid > 0 && !user.username.isEmpty
    }

    // MARK: Feeds

    public func getFeed(kind: FeedKind, timeWindow: TrendingTimeWindow? = nil, cursor: String? = nil, limit: Int = 20) async throws -> FeedResponse {
        var query = try pageQuery(cursor: cursor, limit: limit)
        if let timeWindow {
            guard case .trending = kind else { throw ApiInputError.invalidLimit }
            query.append(URLQueryItem(name: "time_window", value: timeWindow.rawValue))
        }
        let path: String
        switch kind {
        case .trending:
            path = "/v2/farcaster/feed/trending"
        case .following(let fid):
            path = "/v2/farcaster/feed/following"
            query.append(URLQueryItem(name: "fid", value: try fidValue(fid)))
        case .user(let fid):
            path = "/v2/farcaster/feed/user/casts"
            query.append(URLQueryItem(name: "fid", value: try fidValue(fid)))
        case .channel(let id):
            path = "/v2/farcaster/feed/channels"
            query.append(URLQueryItem(name: "channel_ids", value: try channelIdValue(id)))
        }
        let wire = try await json(FeedWire.self, path: path, query: query)
        guard var casts = wire.casts else {
            throw ApiError("The node returned an invalid feed.", status: 502, code: "invalid_response")
        }
        if case .channel = kind {
            // The node applies the requested limit per shard and concatenates.
            // Keep the full batch but merge its order and duplicate hashes.
            var seen = Set<String>()
            casts = casts.filter { seen.insert(normalizeHash($0.hash)).inserted }
                .sorted { lhs, rhs in
                    let l = parseISODate(lhs.timestamp) ?? .distantPast
                    let r = parseISODate(rhs.timestamp) ?? .distantPast
                    return l != r ? l > r : lhs.hash < rhs.hash
                }
        }
        return FeedResponse(casts: casts, next: PageNext(cursor: try nextCursor(wire.next?.cursor, previous: cursor)))
    }

    /// One real user-feed page filtered client-side; a sparse tab can return an
    /// empty page with a cursor — callers keep More available to continue.
    public func getProfileFeed(fid: UInt64, tab: ProfileTab, cursor: String? = nil, limit: Int = 20) async throws -> FeedResponse {
        if tab == .likes || tab == .recasts {
            return try await getProfileReactions(fid: fid, kind: tab == .likes ? .like : .recast, cursor: cursor, limit: limit)
        }
        let response = try await getFeed(kind: .user(fid: fid), cursor: cursor, limit: limit)
        let casts = response.casts.filter { cast in
            let isReply = cast.parentHash != nil
            switch tab {
            case .media: return hasImageEmbed(cast)
            case .replies: return isReply
            default: return !isReply
            }
        }
        guard casts.count <= limit else {
            throw ApiError("The node exceeded the requested profile page size.", status: 502, code: "invalid_response")
        }
        return FeedResponse(casts: casts, next: response.next)
    }

    /// Profile likes/recasts: page /v1/reactionsByFid, hydrate target casts.
    /// Bounded to 5 pages per call, matching the web client's bounded scan.
    private func getProfileReactions(fid: UInt64, kind: ReactionKind, cursor: String?, limit: Int) async throws -> FeedResponse {
        let fidString = try fidValue(fid)
        var casts: [Cast] = []
        var seen = Set<String>()
        var next = cursor
        if let next { seen.insert(try reactionCursor(next).map { $0 } ?? next) }
        for _ in 0..<5 {
            let remaining = limit - casts.count
            guard remaining > 0 else { break }
            var query = [
                URLQueryItem(name: "fid", value: fidString),
                URLQueryItem(name: "reaction_type", value: kind.wireName),
                URLQueryItem(name: "pageSize", value: String(remaining)),
                URLQueryItem(name: "reverse", value: "true"),
            ]
            if let next { query.append(URLQueryItem(name: "pageToken", value: next)) }
            let page = try await json(MessagesWire.self, path: "/v1/reactionsByFid", query: query)
            guard let messages = page.messages, messages.count <= remaining else {
                throw ApiError("The node returned invalid reaction history.", status: 502, code: "invalid_response")
            }
            let reactions = try messages.map { try validateReaction($0, fid: fid, kind: kind) }
            let hydrated = await withTaskGroup(of: (Int, Cast?).self) { group in
                for (index, reaction) in reactions.enumerated()
                        where reaction.targetFid != nil && reaction.targetHash != nil {
                    group.addTask {
                        guard let cast = try? await self.getCast(hash: reaction.targetHash!),
                              cast.author.fid == reaction.targetFid! else { return (index, nil) }
                        return (index, cast)
                    }
                }
                var byIndex: [Int: Cast] = [:]
                for await (index, cast) in group {
                    if let cast { byIndex[index] = cast }
                }
                return byIndex
            }
            for (index, reaction) in reactions.enumerated() {
                guard var stamped = hydrated[index] else { continue }
                let timestampMs = (Double(reaction.timestamp) + Self.farcasterEpochSeconds) * 1000
                stamped.reactionContext = .init(fid: fid, type: kind == .like ? .like : .recast,
                                              timestamp: isoDateString(ms: timestampMs))
                casts.append(stamped)
            }
            guard let continued = try reactionCursor(page.nextPageToken, previous: next) else { next = nil; break }
            guard seen.insert(continued).inserted else {
                throw ApiError("The node returned invalid reaction pagination.", status: 502, code: "invalid_response")
            }
            next = continued
        }
        return FeedResponse(casts: casts, next: PageNext(cursor: next))
    }

    private struct ValidatedReaction {
        var targetFid: UInt64?
        var targetHash: String?
        var targetUrl: String?
        var timestamp: UInt64
    }

    private func validateReaction(_ value: ReactionMessageWire, fid: UInt64, kind: ReactionKind) throws -> ValidatedReaction {
        guard let hash = value.hash, isCastHash(hash), let data = value.data,
              data.type == "MESSAGE_TYPE_REACTION_ADD", data.fid == fid, data.network == "FARCASTER_NETWORK_MAINNET",
              let timestamp = data.timestamp, timestamp <= 0xffff_ffff,
              let body = data.reactionBody, body.type == (kind == .like ? "REACTION_TYPE_LIKE" : "REACTION_TYPE_RECAST")
        else { throw ApiError("The node returned an invalid reaction.", status: 502, code: "invalid_response") }
        if let target = body.targetCastId {
            guard let targetFid = target.fid, targetFid >= 1, let targetHash = target.hash,
                  isCastHash(targetHash), body.targetUrl == nil
            else { throw ApiError("The node returned an invalid reaction target.", status: 502, code: "invalid_response") }
            return ValidatedReaction(targetFid: targetFid, targetHash: targetHash, timestamp: timestamp)
        }
        guard let targetUrl = body.targetUrl, !targetUrl.isEmpty else {
            throw ApiError("The node returned an invalid reaction target.", status: 502, code: "invalid_response")
        }
        return ValidatedReaction(targetUrl: targetUrl, timestamp: timestamp)
    }

    // MARK: Casts & conversations

    public func getCast(hash: String) async throws -> Cast {
        let normalized = try hashValue(hash)
        let wire = try await json(CastWrap.self, path: "/v2/farcaster/cast",
                                  query: [URLQueryItem(name: "identifier", value: normalized), URLQueryItem(name: "type", value: "hash")])
        guard let cast = wire.cast else {
            throw ApiError("The cast could not be loaded.", status: 502, code: "invalid_response")
        }
        return cast
    }

    /// The node embeds replies as nested `direct_replies` (up to depth 2 by request).
    public func getConversation(hash: String) async throws -> ConversationNode {
        let normalized = try hashValue(hash)
        let wire = try await json(ConversationWire.self, path: "/v2/farcaster/cast/conversation",
                                  query: [URLQueryItem(name: "identifier", value: normalized),
                                          URLQueryItem(name: "type", value: "hash"),
                                          URLQueryItem(name: "reply_depth", value: "2")])
        if let root = wire.conversation?.cast ?? wire.cast, normalizeHash(root.hash) != normalized {
            throw ApiError("The node returned a different conversation.", status: 502, code: "invalid_response")
        }
        func normalize(_ cast: Cast, depth: Int = 0) -> ConversationNode {
            var plain = cast
            let children = cast.directReplies ?? []
            plain.directReplies = nil
            return ConversationNode(cast: plain,
                                    replies: depth < 5 ? children.map { normalize($0, depth: depth + 1) } : [])
        }
        if let root = wire.conversation?.cast { return normalize(root) }
        if let cast = wire.cast {
            func node(_ reply: ConversationWire.NestedReply, depth: Int) -> ConversationNode? {
                guard let replyCast = reply.cast else { return nil }
                return ConversationNode(cast: replyCast,
                                        replies: depth < 5 ? (reply.replies ?? []).compactMap { node($0, depth: depth + 1) } : [])
            }
            return ConversationNode(cast: cast, replies: (wire.replies ?? []).compactMap { node($0, depth: 0) })
        }
        throw ApiError("The node returned an invalid conversation.", status: 502, code: "invalid_response")
    }

    /// Bounded quote-index sample; absence can also mean the node has no quote
    /// index, so callers must not claim this is exhaustive.
    public func getCastQuotes(hash: String, limit: Int = 25) async throws -> [Cast] {
        let targetHash = try hashValue(hash)
        guard limit >= 1, limit <= APILimits.castQuotes else { throw ApiInputError.invalidLimit }
        let wire = try await json(FeedWire.self, path: "/v2/farcaster/cast/quotes",
                                  query: [URLQueryItem(name: "identifier", value: targetHash),
                                          URLQueryItem(name: "type", value: "hash"),
                                          URLQueryItem(name: "limit", value: String(limit))])
        guard let casts = wire.casts, casts.count <= limit else {
            throw ApiError("The node returned invalid quote casts.", status: 502, code: "invalid_response")
        }
        var unique = [String: Cast]()
        for cast in casts {
            let quotesTarget = cast.embeds.contains {
                if case .castId(let fid, let hash) = $0 { return fid >= 1 && normalizeHash(hash) == targetHash }
                return false
            }
            guard quotesTarget else {
                throw ApiError("The node returned invalid quote casts.", status: 502, code: "invalid_response")
            }
            unique[normalizeHash(cast.hash)] = cast
        }
        return Array(unique.values)
    }

    /// People who reacted to a cast. One bounded node page per call.
    public func getCastReactionPeople(target: ReactionTarget, kind: ReactionKind, cursor: String? = nil, limit: Int = 25) async throws -> FollowsResponse {
        let targetFid = try fidValue(target.fid)
        let targetHash = try hashValue(target.hash)
        guard limit >= 1, limit <= APILimits.castReactions else { throw ApiInputError.invalidLimit }
        if let cursor { _ = try reactionCursor(cursor) }
        var query = [
            URLQueryItem(name: "target_fid", value: targetFid),
            URLQueryItem(name: "target_hash", value: targetHash),
            URLQueryItem(name: "reaction_type", value: kind.wireName),
            URLQueryItem(name: "pageSize", value: String(limit)),
            URLQueryItem(name: "reverse", value: "true"),
        ]
        if let cursor { query.append(URLQueryItem(name: "pageToken", value: cursor)) }
        let page = try await json(MessagesWire.self, path: "/v1/reactionsByCast", query: query)
        guard let messages = page.messages, messages.count <= 1000 else {
            throw ApiError("The node returned an invalid cast reaction list.", status: 502, code: "invalid_response")
        }
        var actorFids = Set<UInt64>()
        for message in messages {
            guard let data = message.data, let fid = data.fid, fid >= 1 else {
                throw ApiError("The node returned an invalid reaction actor.", status: 502, code: "invalid_response")
            }
            let reaction = try validateReaction(message, fid: fid, kind: kind)
            guard reaction.targetFid == target.fid, normalizeHash(reaction.targetHash ?? "") == targetHash else {
                throw ApiError("The node returned a different reaction target.", status: 502, code: "invalid_response")
            }
            actorFids.insert(fid)
        }
        let cursor = try reactionCursor(page.nextPageToken, previous: cursor)
        return FollowsResponse(users: try await getPublicUsers(fids: Array(actorFids)), next: PageNext(cursor: cursor))
    }

    /// Viewer-scoped reaction receipt: Hypersnap does not populate
    /// cast.viewer_context, so resolve the add receipt directly.
    public func getReactionStatus(viewerFid: UInt64, target: ReactionTarget, kind: ReactionKind) async throws -> Bool {
        let query = [
            URLQueryItem(name: "fid", value: try fidValue(viewerFid)),
            URLQueryItem(name: "reaction_type", value: kind.wireName),
            URLQueryItem(name: "target_fid", value: try fidValue(target.fid)),
            URLQueryItem(name: "target_hash", value: try hashValue(target.hash)),
        ]
        do {
            let message = try await json(ReactionMessageWire.self, path: "/v1/reactionById", query: query)
            let reaction = try validateReaction(message, fid: viewerFid, kind: kind)
            guard reaction.targetFid == target.fid, normalizeHash(reaction.targetHash ?? "") == normalizeHash(target.hash) else {
                throw ApiError("The node returned a different reaction target.", status: 502, code: "invalid_response")
            }
            return true
        } catch let error as ApiError where error.status == 404 && error.code == "reaction_not_found" {
            return false
        }
    }

    // MARK: Users & social graph

    public func getUser(fid: UInt64) async throws -> User {
        try await fetchUser(path: "/v2/farcaster/user", query: [URLQueryItem(name: "fid", value: fidValue(fid))])
    }

    public func getUser(username: String) async throws -> User {
        let name = username.hasPrefix("@") ? String(username.dropFirst()) : username
        if name.lowercased().hasSuffix(".eth") { return try await getUserByEnsName(name) }
        guard isUsername(name) else { throw ApiInputError.invalidUsername }
        return try await fetchUser(path: "/v2/farcaster/user/by-username",
                                   query: [URLQueryItem(name: "username", value: name)])
    }

    public func getUser(custodyAddress: String) async throws -> User {
        try await fetchUser(path: "/v2/farcaster/user/custody-address",
                            query: [URLQueryItem(name: "custody_address", value: addressValue(custodyAddress))])
    }

    /// Resolve only Hypersnap's stored name proof, then hydrate its stable FID.
    private func getUserByEnsName(_ input: String) async throws -> User {
        let (name, type) = try normalizeEnsName(input)
        let proof = try await json(FidProof.self, path: "/v1/fidByName",
                                   query: [URLQueryItem(name: "name", value: name), URLQueryItem(name: "type", value: type)])
        guard let fid = proof.fid, fid >= 1, fid <= 0xffff_ffff else {
            throw ApiError("The node returned an invalid account name proof.", status: 502, code: "invalid_response")
        }
        let user = try await getUser(fid: fid)
        guard user.fid == fid else {
            throw ApiError("The node returned a different account for this name proof.", status: 502, code: "invalid_response")
        }
        return user
    }

    private func fetchUser(path: String, query: [URLQueryItem]) async throws -> User {
        let wire = try await json(UserWrap.self, path: path, query: query)
        guard let user = wire.user else {
            throw ApiError("The node returned an invalid profile.", status: 502, code: "invalid_response")
        }
        return user
    }

    /// One /v2/farcaster/user/bulk request per 100 FIDs; every requested profile
    /// must be returned — absence is an error, never a gap.
    public func getPublicUsers(fids: [UInt64]) async throws -> [User] {
        var unique: [UInt64] = []
        var seen = Set<UInt64>()
        for fid in fids where seen.insert(fid).inserted { unique.append(fid) }
        var byFid = [UInt64: User]()
        for start in stride(from: 0, to: unique.count, by: APILimits.bulkUsers) {
            let chunk = Array(unique[start..<min(start + APILimits.bulkUsers, unique.count)])
            let wire = try await json(UsersWire.self, path: "/v2/farcaster/user/bulk",
                                      query: [URLQueryItem(name: "fids", value: try chunk.map(fidValue).joined(separator: ","))])
            guard let users = wire.users, users.count <= chunk.count else {
                throw ApiError("The node returned an invalid reaction profile.", status: 502, code: "invalid_response")
            }
            for user in users {
                guard isValidUser(user), chunk.contains(user.fid), byFid[user.fid] == nil else {
                    throw ApiError("The node returned an invalid reaction profile.", status: 502, code: "invalid_response")
                }
                byFid[user.fid] = user
            }
        }
        return try unique.map { fid in
            guard let user = byFid[fid] else {
                throw ApiError("The node returned an invalid reaction profile.", status: 502, code: "invalid_response")
            }
            return user
        }
    }

    public func getFollows(fid: UInt64, kind: FollowKind, cursor: String? = nil, limit: Int = 20) async throws -> FollowsResponse {
        if let cursor { guard validDecimalCursor(cursor) else { throw ApiInputError.invalidCursor } }
        var query = try pageQuery(cursor: cursor, limit: limit)
        query.append(URLQueryItem(name: "fid", value: try fidValue(fid)))
        let wire = try await json(FollowsWire.self, path: "/v2/farcaster/user/\(kind.rawValue)", query: query)
        guard let users = wire.users, users.allSatisfy({ $0.fid >= 1 }) else {
            throw ApiError("The node returned an invalid follow list.", status: 502, code: "invalid_response")
        }
        let next = wire.next?.cursor
        if let next, (!validDecimalCursor(next)) {
            throw ApiError("The node returned an invalid follow cursor.", status: 502, code: "invalid_response")
        }
        return FollowsResponse(users: users, next: PageNext(cursor: next == cursor ? nil : next))
    }

    public enum FollowKind: String, Sendable { case followers, following }

    /// Effective follow state: the receipt read plus the node's social-index
    /// fallback for accounts stored as compact link state.
    public func getFollowStatus(viewerFid: UInt64, targetFid: UInt64) async throws -> Bool {
        let viewer = try fidValue(viewerFid)
        let target = try fidValue(targetFid)
        let query = [
            URLQueryItem(name: "fid", value: viewer),
            URLQueryItem(name: "link_type", value: "follow"),
            URLQueryItem(name: "target_fid", value: target),
        ]
        do {
            let result = try await json(LinkMessageWire.self, path: "/v1/linkById", query: query)
            guard result.data?.type == "MESSAGE_TYPE_LINK_ADD", result.data?.fid == viewerFid,
                  result.data?.linkBody?.type == "follow", result.data?.linkBody?.targetFid == targetFid else {
                throw ApiError("The node returned an invalid follow relationship.", status: 502, code: "invalid_response")
            }
            return true
        } catch let error as ApiError where error.status == 404 && error.code == "follow_not_found" {
            // Compact-state accounts: probe the following index at an exclusive
            // target-FID bound instead of scanning the whole graph.
            let page = try await getFollows(fid: viewerFid, kind: .following,
                                            cursor: String(targetFid - 1), limit: 1)
            guard page.users.count <= 1, page.users.allSatisfy({ $0.fid >= targetFid }) else {
                throw ApiError("The node returned an invalid follow relationship.", status: 502, code: "invalid_response")
            }
            return page.users.first?.fid == targetFid
        }
    }

    /// Bounded friends-of-friends sample, not a complete ranking.
    public func getSuggestedUsers(fid: UInt64, limit: Int = 8) async throws -> [User] {
        guard limit >= 1, limit <= APILimits.suggestedUsers else { throw ApiInputError.invalidLimit }
        let wire = try await json(UsersWire.self, path: "/v2/farcaster/following/suggested",
                                  query: [URLQueryItem(name: "fid", value: try fidValue(fid)),
                                          URLQueryItem(name: "limit", value: String(limit))])
        guard let users = wire.users, users.count <= limit, users.allSatisfy(isValidUser) else {
            throw ApiError("The node returned invalid suggested profiles.", status: 502, code: "invalid_response")
        }
        var seen = Set<UInt64>()
        return users.filter { $0.fid != fid && seen.insert($0.fid).inserted }
    }

    // MARK: Channels

    public enum ChannelListKind: Sendable { case all, trending, search }

    /// Named channels only — the index also contains arbitrary parent-URL
    /// namespaces this directory cannot represent.
    public func getChannels(kind: ChannelListKind, query searchQueryText: String? = nil, cursor: String? = nil, limit: Int = 20) async throws -> ChannelsResponse {
        if cursor != nil && kind != .all { throw ApiInputError.invalidCursor }
        var query = try pageQuery(cursor: cursor, limit: limit)
        if case .search = kind {
            query.append(URLQueryItem(name: "q", value: try searchQuery(searchQueryText ?? "")))
        }
        let name = switch kind {
        case .all: "all"
        case .trending: "trending"
        case .search: "search"
        }
        let wire = try await json(ChannelsWire.self, path: "/v2/farcaster/channel/\(name)", query: query)
        guard let channels = wire.channels else {
            throw ApiError("The node returned invalid channels.", status: 502, code: "invalid_response")
        }
        let valid = channels.filter { isChannelId($0.id) && !$0.url.isEmpty && !$0.name.isEmpty }
        let next = kind == .all ? try nextCursor(wire.next?.cursor, previous: cursor) : nil
        return ChannelsResponse(channels: valid, next: PageNext(cursor: next))
    }

    public func getChannel(id: String) async throws -> Channel {
        let channelId = try channelIdValue(id)
        let wire = try await json(ChannelWrap.self, path: "/v2/farcaster/channel",
                                  query: [URLQueryItem(name: "id", value: channelId), URLQueryItem(name: "type", value: "id")])
        guard let channel = wire.channel, channel.id == channelId, !channel.url.isEmpty, !channel.name.isEmpty else {
            throw ApiError("The node returned an invalid channel.", status: 502, code: "invalid_response")
        }
        return channel
    }

    /// The node's member index tracks accounts that posted here — it is not a
    /// subscription, permission, or membership list.
    public func getChannelMembers(channelId: String, cursor: String? = nil, limit: Int = 25) async throws -> FollowsResponse {
        let id = try channelIdValue(channelId)
        guard limit >= 1, limit <= APILimits.channelMembers else { throw ApiInputError.invalidLimit }
        if let cursor { guard validDecimalCursor(cursor) else { throw ApiInputError.invalidCursor } }
        var query = [URLQueryItem(name: "channel_id", value: id), URLQueryItem(name: "limit", value: String(limit))]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        let wire = try await json(MembersWire.self, path: "/v2/farcaster/channel/members", query: query)
        guard let members = wire.members, members.count <= limit,
              members.allSatisfy({ $0.user.map(isValidUser) ?? false }) else {
            throw ApiError("The node returned invalid channel participants.", status: 502, code: "invalid_response")
        }
        let next = wire.next?.cursor
        if let next, (!validDecimalCursor(next) || next == cursor) {
            throw ApiError("The node returned invalid channel participants pagination.", status: 502, code: "invalid_response")
        }
        var seen = Set<UInt64>()
        let users = members.compactMap(\.user).filter { seen.insert($0.fid).inserted }
        return FollowsResponse(users: users, next: PageNext(cursor: next))
    }

    // MARK: Notifications

    /// Public recent activity; the node's bounded scan is not a complete
    /// historical inbox. Read state is local to this client.
    public func getNotifications(fid: UInt64, cursor: String? = nil, limit: Int = 20) async throws -> NotificationsResponse {
        var query = try pageQuery(cursor: cursor, limit: limit)
        query.append(URLQueryItem(name: "fid", value: try fidValue(fid)))
        let wire = try await json(NotificationsWire.self, path: "/v2/farcaster/notifications", query: query)
        guard let items = wire.notifications else {
            throw ApiError("The node returned invalid activity.", status: 502, code: "invalid_response")
        }
        var notifications: [ActivityItem] = []
        var seen = Set<String>()
        for item in items {
            guard let user = item.user, isValidUser(user), let rawType = item.type,
                  let timestamp = item.timestamp, parseISODate(timestamp) != nil else {
                throw ApiError("The node returned invalid activity.", status: 502, code: "invalid_response")
            }
            let cast = item.cast.flatMap { isCastHash($0.hash) ? $0 : nil }
            let type: ActivityItemType = rawType == "likes" ? .reactions
                : rawType == "follows" ? .follows
                : cast?.parentAuthor?.fid == fid ? .replies
                : (cast?.mentionedProfiles?.contains { $0.fid == fid } ?? false) ? .mentions
                : .unknown
            // The v2 adapter omits the original message hash; this stable
            // public-field key feeds local seen state, not a signed receipt.
            let id = "\(timestamp):\(user.fid):\(type.rawValue):\(cast?.hash ?? "")"
            if seen.insert(id).inserted {
                notifications.append(ActivityItem(id: id, type: type, timestamp: timestamp,
                                                  actors: [user], cast: cast, targetHash: cast?.hash))
            }
        }
        return NotificationsResponse(notifications: notifications,
                                     next: PageNext(cursor: try nextCursor(wire.next?.cursor, previous: cursor)))
    }

    // MARK: Search

    /// Prefix search bounded to the node's ranked top results; it has no cursor.
    public func searchUsers(query: String, limit: Int = 20) async throws -> [User] {
        var params = try pageQuery(cursor: nil, limit: limit)
        params.append(URLQueryItem(name: "q", value: try searchQuery(query)))
        let wire = try await json(UsersWire.self, path: "/v2/farcaster/user/search", query: params)
        guard let users = wire.users else {
            throw ApiError("The node returned invalid search results.", status: 502, code: "invalid_response")
        }
        // Imported index entries can hydrate to fid:0 placeholders — not accounts.
        return users.filter(isValidUser)
    }

    /// The index can retain deleted casts; hydrate at most 25 ranked hits and
    /// drop only verifiably-missing ones. The current index returns its ranked
    /// top N and ignores cursors.
    public func searchCasts(query: String, limit: Int = 20) async throws -> [Cast] {
        let bounded = min(limit, 25)
        var params = try pageQuery(cursor: nil, limit: bounded)
        params.append(URLQueryItem(name: "q", value: try searchQuery(query)))
        let wire = try await json(SearchCastsWire.self, path: "/v2/farcaster/cast/search", query: params)
        guard let resultCasts = wire.result?.casts else {
            throw ApiError("The node returned invalid search results.", status: 502, code: "invalid_response")
        }
        var seen = Set<String>()
        var hits: [(hash: String, fid: UInt64)] = []
        for cast in resultCasts.prefix(bounded) {
            guard isCastHash(cast.hash), isValidUser(cast.author) else { continue }
            let hash = try hashValue(cast.hash)
            if seen.insert(hash).inserted { hits.append((hash, cast.author.fid)) }
        }
        return await withTaskGroup(of: Cast?.self) { group in
            for hit in hits {
                group.addTask {
                    guard let cast = try? await self.getCast(hash: hit.hash),
                          normalizeHash(cast.hash) == hit.hash, cast.author.fid == hit.fid else { return nil }
                    return cast
                }
            }
            var hydrated: [Cast] = []
            for await cast in group { if let cast { hydrated.append(cast) } }
            return hydrated
        }
    }

    // MARK: Signers & writes

    /// All signer pages (bounded) — never mistake a truncated list for a
    /// missing signer. `requesterFids[0]` matches the node's indexed-sequence decoder.
    public func getSigners(fid: UInt64) async throws -> SignersResponse {
        var query = [
            URLQueryItem(name: "fid", value: try fidValue(fid)),
            URLQueryItem(name: "pageSize", value: "1000"),
            URLQueryItem(name: "requesterFids[0]", value: String(fid)),
        ]
        var result = try await json(SignersWire.self, path: "/v1/signersByFid", query: query)
        guard let signers = result.signers, let nonce = result.currentUserNonce else {
            throw ApiError("The node returned invalid signer state.", status: 502, code: "invalid_response")
        }
        var allSigners = signers
        var seenTokens = Set<String>()
        while let token = result.nextPageToken {
            if allSigners.count >= 10_000 || seenTokens.count >= 10 {
                throw ApiError("This account has too many signers to inspect safely.", status: 502, code: "signer_limit")
            }
            guard seenTokens.insert(token).inserted else {
                throw ApiError("The node returned invalid signer pagination.", status: 502, code: "invalid_response")
            }
            query.removeAll { $0.name == "pageToken" }
            query.append(URLQueryItem(name: "pageToken", value: token))
            let page = try await json(SignersWire.self, path: "/v1/signersByFid", query: query)
            guard let pageSigners = page.signers, page.nextPageToken != token else {
                throw ApiError("The node returned invalid signer pagination.", status: 502, code: "invalid_response")
            }
            allSigners.append(contentsOf: pageSigners)
            result = page
        }
        return SignersResponse(signers: allSigners, currentUserNonce: nonce,
                               gaslessSignerCount: result.gaslessSignerCount,
                               gaslessSignerLimit: result.gaslessSignerLimit,
                               nextPageToken: nil)
    }

    /// Signed message envelope (1 byte–64 KiB) → POST /v1/submitMessage.
    public func submitMessage(_ bytes: [UInt8]) async throws -> SubmitMessageResponse {
        try await postMessage(bytes, path: "/v1/submitMessage")
    }

    /// Runs the node's full message validation without merging — nothing is
    /// published. Used for dry-run publishing and live encoding checks.
    public func validateMessage(_ bytes: [UInt8]) async throws -> SubmitMessageResponse {
        try await postMessage(bytes, path: "/v1/validateMessage")
    }

    private func postMessage(_ bytes: [UInt8], path: String) async throws -> SubmitMessageResponse {
        guard !bytes.isEmpty, bytes.count <= 65_536 else {
            throw ApiInputError.invalidLimit
        }
        let data = try await request(path: path, body: bytes)
        guard let object = try? decoder.decode([String: AnyCodableValue].self, from: data) else {
            throw ApiError("The node returned an invalid response.", status: 502, code: "invalid_response")
        }
        let hash = object["hash"].flatMap { value -> String? in
            if case .string(let string) = value { return string }
            return nil
        }
        return SubmitMessageResponse(hash: hash, raw: object)
    }

    public func getInfo() async throws -> NodeInfo {
        let data = try await request(path: "/v1/info")
        guard let object = try? decoder.decode([String: AnyCodableValue].self, from: data) else {
            throw ApiError("The node returned an invalid response.", status: 502, code: "invalid_response")
        }
        return NodeInfo(raw: object)
    }
}

// MARK: - Shared helpers

public func normalizeHash(_ hash: String) -> String {
    hash.hasPrefix("0x") || hash.hasPrefix("0X") ? String(hash.dropFirst(2)).lowercased() : hash.lowercased()
}

private func bytesFromHex(_ hex: String) -> Data? {
    guard hex.count % 2 == 0 else { return nil }
    var bytes = Data(capacity: hex.count / 2)
    var index = hex.startIndex
    while index < hex.endIndex {
        let next = hex.index(index, offsetBy: 2)
        guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
        bytes.append(byte)
        index = next
    }
    return bytes
}

public func parseISODate(_ string: String) -> Date? {
    if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(string) { return date }
    return try? Date.ISO8601FormatStyle().parse(string)
}

public func isoDateString(ms: Double) -> String {
    Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        .format(Date(timeIntervalSince1970: ms / 1000))
}

private let imageHostAllowlist: Set<String> = ["imagedelivery.net", "imagedelivery.cloud"]

/// Image formats rendered by this client (same allowlist as the web client).
public func hasImageEmbed(_ cast: Cast) -> Bool {
    cast.embeds.contains { embed in
        guard case .url(let raw) = embed, let url = URL(string: raw), url.scheme == "https" else { return false }
        let path = url.path.lowercased()
        return path.hasSuffix(".png") || path.hasSuffix(".jpg") || path.hasSuffix(".jpeg")
            || path.hasSuffix(".webp") || path.hasSuffix(".gif")
            || imageHostAllowlist.contains(url.host ?? "")
    }
}

extension HypersnapClient {
    static let farcasterEpochSeconds: Double = 1_609_459_200
}

/// Hypersnap's indexed name-proof limits (port of normalizeHypersnapEnsName):
/// `name.eth` or `name.base.eth`, 1–16 ASCII chars `[a-z0-9-]` starting with
/// a letter or number. Unicode and other subdomains are rejected.
private let ensNameError = "Use a Hypersnap-linked name.eth or name.base.eth with a 1–16 character ASCII name: letters, numbers, or hyphens, starting with a letter or number. Unicode names and other subdomains are not supported."
private func normalizeEnsName(_ input: String) throws -> (name: String, type: String) {
    var term = input.trimmingCharacters(in: .whitespaces)
    if term.hasPrefix("@") { term = String(term.dropFirst()) }
    guard term.unicodeScalars.allSatisfy({ $0.isASCII }) else { throw ApiError(ensNameError, status: 0, code: "invalid_input") }
    let name = term.lowercased()
    // `^[a-z0-9][a-z0-9-]{0,15}\.(base\.)?eth$`: 1–16 char ASCII label.
    var label = name
    let basename = name.hasSuffix(".base.eth")
    if name.hasSuffix(".eth") { label = String(name.dropLast(4)) }
    if basename { label = String(label.dropLast(5)) }
    let labelChars = Set("abcdefghijklmnopqrstuvwxyz0123456789-")
    guard (1...16).contains(label.count), let first = label.first,
          first.isLetter || first.isNumber, label.allSatisfy(labelChars.contains),
          name.hasSuffix(".eth"), name.dropLast(4).allSatisfy({ $0 != "." || basename }) else {
        throw ApiError(ensNameError, status: 0, code: "invalid_input")
    }
    return (name, type: basename ? "basename" : "ens")
}
