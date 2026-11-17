import SwiftUI
import HypersnapAPI
import HypersnapProtocol

/// One cast row: author line, text, embeds, reaction counts, action buttons.
struct CastRowView: View {
    let cast: Cast
    var onReply: ((Cast) -> Void)? = nil
    var onQuote: ((Cast) -> Void)? = nil
    /// Called after a successful delete so the list can drop the row.
    var onDeleted: ((Cast) -> Void)? = nil

    @Environment(SessionManager.self) private var session
    @Environment(\.navigator) private var navigator
    @State private var liked: Bool?
    @State private var recasted: Bool?
    @State private var likeCount: Int
    @State private var recastCount: Int
    @State private var busy = false
    @State private var confirmDelete = false
    @State private var actionError: String?

    init(cast: Cast, onReply: ((Cast) -> Void)? = nil, onQuote: ((Cast) -> Void)? = nil, onDeleted: ((Cast) -> Void)? = nil) {
        self.cast = cast
        self.onReply = onReply
        self.onQuote = onQuote
        self.onDeleted = onDeleted
        _likeCount = State(initialValue: cast.reactions.likesCount)
        _recastCount = State(initialValue: cast.reactions.recastsCount)
    }

    private var isOwn: Bool { cast.author.fid == session.signer?.fid }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button { navigator.openProfile(cast.author.fid) } label: {
                    AvatarView(url: cast.author.pfpUrl, size: 36)
                }
                .buttonStyle(.plain)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Button { navigator.openProfile(cast.author.fid) } label: {
                            HStack(spacing: 4) {
                                Text(cast.author.displayName ?? cast.author.username).font(.callout.bold())
                                Text("@\(cast.author.username)").font(.callout).foregroundStyle(.secondary)
                            }
                        }
                        .buttonStyle(.plain)
                        if let context = cast.reactionContext {
                            Label(context.type == .like ? "liked" : "recasted", systemImage: "arrow.2.squarepath")
                                .font(.caption2).foregroundStyle(.tertiary)
                        }
                        Spacer()
                        Text(relativeTime(cast.timestamp)).font(.caption).foregroundStyle(.tertiary)
                    }
                }
            }
            Text(cast.text).font(.body)
                .accessibilityIdentifier("castText")
            ForEach(Array(cast.embeds.enumerated()), id: \.offset) { _, embed in
                EmbedView(embed: embed)
            }
            HStack(spacing: 20) {
                actionButton("\(cast.replies.count)", icon: "bubble.left") { onReply?(cast) }
                    .disabled(onReply == nil)
                    .accessibilityLabel("Reply")
                    .accessibilityValue("\(cast.replies.count)")
                actionButton("\(recastCount)", icon: "arrow.2.squarepath",
                             active: recasted == true, activeColor: .green) {
                    Task { await react(.recast) }
                }
                .accessibilityLabel(recasted == true ? "Undo recast" : "Recast")
                .accessibilityValue("\(recastCount)")
                actionButton("\(likeCount)", icon: liked == true ? "heart.fill" : "heart",
                             active: liked == true, activeColor: .red) {
                    Task { await react(.like) }
                }
                .accessibilityLabel(liked == true ? "Unlike" : "Like")
                .accessibilityValue("\(likeCount)")
                Spacer()
                Menu {
                    if let onQuote { Button("Quote") { onQuote(cast) } }
                    Button("Copy text") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(cast.text, forType: .string)
                    }
                    if isOwn {
                        Divider()
                        Button("Delete cast", role: .destructive) { confirmDelete = true }
                    }
                } label: {
                    Image(systemName: "ellipsis").foregroundStyle(.secondary)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .frame(width: 24)
                .accessibilityLabel("More actions")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if let actionError {
                Text(actionError).font(.caption2).foregroundStyle(.red)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("castRow")
        .task { await loadReactionState() }
        .confirmationDialog("Delete this cast?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await remove() } }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func actionButton(_ label: String, icon: String, active: Bool = false,
                              activeColor: Color = .accentColor, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(label, systemImage: icon)
                .foregroundStyle(active ? activeColor : .secondary)
                .padding(.vertical, 4)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy || session.signer == nil)
    }

    private func loadReactionState() async {
        guard let fid = session.signer?.fid, !isOwn else { return }
        let target = HypersnapAPI.ReactionTarget(fid: cast.author.fid, hash: cast.hash)
        async let likeStatus = session.client.getReactionStatus(viewerFid: fid, target: target, kind: .like)
        async let recastStatus = session.client.getReactionStatus(viewerFid: fid, target: target, kind: .recast)
        let remoteLiked = try? await likeStatus
        let remoteRecasted = try? await recastStatus
        // Don't clobber an optimistic toggle the user made while this loaded.
        if liked == nil { liked = remoteLiked }
        if recasted == nil { recasted = remoteRecasted }
    }

    private func react(_ type: ReactionType) async {
        guard !busy else { return }
        busy = true
        let current = type == .like ? liked : recasted
        let adding = current != true
        // Optimistic update; revert on failure.
        if type == .like { liked = adding; likeCount += adding ? 1 : -1 }
        else { recasted = adding; recastCount += adding ? 1 : -1 }
        do {
            _ = try await session.publisher.react(type,
                target: .init(fid: cast.author.fid, hash: cast.hash), add: adding)
        } catch {
            if type == .like { liked = current; likeCount -= adding ? 1 : -1 }
            else { recasted = current; recastCount -= adding ? 1 : -1 }
            actionError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        busy = false
    }

    private func remove() async {
        do {
            _ = try await session.publisher.deleteCast(hash: cast.hash)
            onDeleted?(cast)
        } catch {
            actionError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}

struct AvatarView: View {
    let url: String?
    var size: CGFloat = 36

    var body: some View {
        Group {
            if let url = safeRemoteImageURL(url) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFill()
                    default: Image(systemName: "person.circle.fill").resizable().foregroundStyle(.tertiary)
                    }
                }
            } else {
                Image(systemName: "person.circle.fill").resizable().foregroundStyle(.tertiary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

struct EmbedView: View {
    let embed: HypersnapAPI.CastEmbed

    var body: some View {
        switch embed {
        case .url(let raw):
            if let url = URL(string: raw), isImageUrl(url) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFit()
                    case .failure: Link(raw, destination: url).font(.caption)
                    default: ProgressView().frame(maxWidth: .infinity, minHeight: 80)
                    }
                }
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            } else if let url = URL(string: raw), url.scheme == "http" || url.scheme == "https" {
                Link(raw, destination: url)
                    .font(.caption)
                    .lineLimit(2)
            } else {
                Text(raw)
                    .font(.caption)
                    .lineLimit(2)
            }
        case .castId(let fid, let hash):
            QuotedCastView(fid: fid, hash: hash)
        }
    }
}

/// Compact card for a quoted cast embed; falls back to a plain label on failure.
struct QuotedCastView: View {
    let fid: UInt64
    let hash: String

    @Environment(SessionManager.self) private var session
    @Environment(\.navigator) private var navigator
    @State private var cast: Cast?
    @State private var failed = false

    var body: some View {
        Group {
            if let cast {
                HStack(alignment: .top, spacing: 8) {
                    AvatarView(url: cast.author.pfpUrl, size: 20)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 4) {
                            Text(cast.author.displayName ?? cast.author.username).font(.callout.bold())
                            Text("@\(cast.author.username)").font(.caption).foregroundStyle(.secondary)
                        }
                        Text(cast.text).font(.callout).lineLimit(4)
                    }
                    Spacer(minLength: 0)
                }
                .padding(8)
                .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(.separator))
                .contentShape(Rectangle())
                .onTapGesture { navigator.openCast(hash) }
            } else if failed {
                Label("Quoted cast \(hash.prefix(10))… (fid \(fid))", systemImage: "quote.bubble")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                RoundedRectangle(cornerRadius: 8).fill(.quaternary.opacity(0.5))
                    .frame(maxWidth: .infinity).frame(height: 56)
            }
        }
        .task(id: hash) {
            do { cast = try await session.client.getCast(hash: hash) }
            catch { failed = true }
        }
    }
}

private func isImageUrl(_ url: URL) -> Bool {
    guard safeRemoteImageURL(url.absoluteString) != nil else { return false }
    let path = url.path.lowercased()
    return path.hasSuffix(".png") || path.hasSuffix(".jpg") || path.hasSuffix(".jpeg")
        || path.hasSuffix(".webp") || path.hasSuffix(".gif")
        || url.host == "imagedelivery.net" || url.host == "imagedelivery.cloud"
}

func relativeTime(_ iso: String) -> String {
    guard let date = parseISODate(iso) else { return "" }
    let seconds = -date.timeIntervalSinceNow
    if seconds < 60 { return "now" }
    if seconds < 3600 { return "\(Int(seconds / 60))m" }
    if seconds < 86400 { return "\(Int(seconds / 3600))h" }
    if seconds < 604800 { return "\(Int(seconds / 86400))d" }
    return date.formatted(date: .abbreviated, time: .omitted)
}
