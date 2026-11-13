import SwiftUI
import HypersnapAPI

struct NotificationsView: View {
    @Environment(SessionManager.self) private var session
    @Environment(\.navigator) private var navigator
    @State private var list: PagedList<ActivityItem>?

    var body: some View {
        Group {
            if let list {
                List {
                    ForEach(list.items, id: \.id) { item in
                        HStack(spacing: 10) {
                            Image(systemName: icon(item.type)).foregroundStyle(.secondary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(title(item)).font(.callout)
                                if let cast = item.cast {
                                    Text(cast.text).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                                }
                            }
                            Spacer()
                            Text(relativeTime(item.timestamp)).font(.caption).foregroundStyle(.tertiary)
                        }
                        .padding(.vertical, 4)
                        .contentShape(Rectangle())
                        .onTapGesture {
                            if let cast = item.cast { navigator.openCast(cast.hash) }
                            else if let actor = item.actors.first { navigator.openProfile(actor.fid) }
                        }
                    }
                    if !list.exhausted {
                        HStack { Spacer(); Button("Load more") { Task { await list.loadMore() } }; Spacer() }
                    }
                }
                .listStyle(.plain)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Notifications")
        .task {
            guard let fid = session.signer?.fid else { return }
            list = PagedList { cursor in
                let page = try await session.client.getNotifications(fid: fid, cursor: cursor, limit: 25)
                return (page.notifications, page.next.cursor)
            }
            await list?.refresh()
        }
    }

    private func icon(_ type: ActivityItemType) -> String {
        switch type {
        case .reactions: return "heart"
        case .follows: return "person.badge.plus"
        case .replies: return "bubble.left"
        case .mentions: return "at"
        case .unknown: return "bell"
        }
    }

    private func title(_ item: ActivityItem) -> String {
        let actor = item.actors.first.map { $0.displayName ?? $0.username } ?? "Someone"
        switch item.type {
        case .reactions: return "\(actor) reacted to your cast"
        case .follows: return "\(actor) followed you"
        case .replies: return "\(actor) replied to your cast"
        case .mentions: return "\(actor) mentioned you"
        case .unknown: return "\(actor)"
        }
    }
}

struct ChannelsView: View {
    @Environment(SessionManager.self) private var session
    @State private var channels: [Channel] = []
    @State private var error: String?

    var body: some View {
        Group {
            if let error {
                ContentUnavailableView {
                    Label("Couldn't load channels", systemImage: "exclamationmark.triangle")
                } description: { Text(error) }
            } else if channels.isEmpty {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(channels, id: \.id) { channel in
                    NavigationLink(value: channel) {
                        HStack {
                            if let url = channel.imageUrl {
                                AsyncImage(url: URL(string: url)) { $0.resizable().scaledToFill() }
                                    placeholder: { Image(systemName: "number").foregroundStyle(.tertiary) }
                                    .frame(width: 28, height: 28).clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                            VStack(alignment: .leading) {
                                Text("/\(channel.id)").font(.callout.bold())
                                Text(channel.name).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Channels")
        .task {
            do { channels = try await session.client.getChannels(kind: .trending, limit: 50).channels }
            catch { self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription }
        }
    }
}

struct SearchView: View {
    @Environment(SessionManager.self) private var session
    @Environment(\.navigator) private var navigator
    @State private var query = ""
    @State private var users: [User] = []
    @State private var casts: [Cast] = []
    @State private var searching = false
    @State private var error: String?

    var body: some View {
        VStack {
            TextField("Search users and casts", text: $query)
                .textFieldStyle(.roundedBorder)
                .padding()
                .onSubmit { Task { await run() } }
            if searching {
                ProgressView().padding()
            } else {
                List {
                    if !users.isEmpty {
                        Section("People") {
                            ForEach(users, id: \.fid) { user in
                                NavigationLink(value: user.fid) {
                                    HStack {
                                        AvatarView(url: user.pfpUrl, size: 28)
                                        VStack(alignment: .leading) {
                                            Text(user.displayName ?? user.username).font(.callout.bold())
                                            Text("@\(user.username)").font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if !casts.isEmpty {
                        Section("Casts") {
                            ForEach(casts, id: \.hash) { cast in
                                CastRowView(cast: cast,
                                            onReply: { navigator.compose(.reply($0)) },
                                            onQuote: { navigator.compose(.quote($0)) })
                                    .contentShape(Rectangle())
                                    .onTapGesture { navigator.openCast(cast.hash) }
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
            if let error { Text(error).font(.caption).foregroundStyle(.red).padding() }
        }
        .navigationTitle("Search")
    }

    private func run() async {
        searching = true
        error = nil
        do {
            async let foundUsers = session.client.searchUsers(query: query)
            async let foundCasts = session.client.searchCasts(query: query)
            users = try await foundUsers
            casts = try await foundCasts
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        searching = false
    }
}

struct SettingsView: View {
    @Environment(SessionManager.self) private var session

    var body: some View {
        Form {
            if let user = session.user {
                Section("Account") {
                    LabeledContent("Signed in as", value: "@\(user.username)")
                    LabeledContent("FID", value: "\(user.fid)")
                }
            }
            if let signer = session.signer {
                Section("Device signer") {
                    LabeledContent("Public key") {
                        Text(signer.deviceKey.publicKey.map { String(format: "%02x", $0) }.joined().prefix(16) + "…")
                            .font(.system(.caption, design: .monospaced))
                    }
                    LabeledContent("Custody address", value: signer.custodyAddress)
                }
            }
            Section {
                Toggle("Dry run (validate only, don't publish)", isOn: Bindable(session.publisher).dryRun)
            } footer: {
                Text("Casts, replies, likes and follows are signed and checked by the node's validator, but never published to the network.")
                    .font(.caption)
            }
            Section {
                Button("Sign out", role: .destructive) { session.signOut() }
                Button("Revoke signer and sign out", role: .destructive) {
                    Task { await session.revoke() }
                }
            } footer: {
                Text("Revocation removes this device's signer from your account on the node. Sign out only clears this Mac's Keychain — the signer stays registered until it expires.")
                    .font(.caption)
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
    }
}
