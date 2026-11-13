import SwiftUI
import HypersnapAPI
import HypersnapProtocol

/// Profile page: header, follow/unfollow, paged casts per tab, own-profile edit.
struct ProfileView: View {
    let fid: UInt64

    @Environment(SessionManager.self) private var session
    @Environment(\.navigator) private var navigator
    @State private var user: User?
    @State private var error: String?
    @State private var tab: ProfileTab = .casts
    @State private var list: PagedList<Cast>?
    @State private var following: Bool?
    @State private var busy = false
    @State private var editing = false

    private var isOwn: Bool { session.signer?.fid == fid }

    var body: some View {
        List {
            if let user {
                header(user)
                    .listRowSeparator(.hidden)
                tabs
                    .listRowSeparator(.hidden)
                feed
            } else if let error {
                ContentUnavailableView {
                    Label("Couldn't load the profile", systemImage: "exclamationmark.triangle")
                } description: { Text(error) }
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
            }
        }
        .listStyle(.plain)
        .navigationTitle(user?.displayName ?? user?.username ?? "Profile")
        .sheet(isPresented: $editing) { if let user { EditProfileView(user: user) } }
        .task(id: fid) { await load() }
    }

    private func load() async {
        do {
            let loaded = try await session.client.getUser(fid: fid)
            user = loaded
            list = PagedList { cursor in
                let page = try await session.client.getProfileFeed(fid: fid, tab: tab, cursor: cursor, limit: 20)
                return (page.casts, page.next.cursor)
            }
            await list?.refresh()
            if let viewerFid = session.signer?.fid, viewerFid != fid {
                following = try? await session.client.getFollowStatus(viewerFid: viewerFid, targetFid: fid)
            }
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    @ViewBuilder
    private func header(_ user: User) -> some View {
        if let banner = user.profile?.banner?.url, let url = URL(string: banner) {
            AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Color.gray.opacity(0.2) }
                .frame(height: 120).clipped()
        }
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .bottom) {
                AvatarView(url: user.pfpUrl, size: 64)
                Spacer()
                if isOwn {
                    Button("Edit profile") { editing = true }
                } else if let following {
                    Button {
                        Task { await toggleFollow() }
                    } label: {
                        Text(following ? "Following" : "Follow")
                            .frame(minWidth: 72)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(following ? .gray : .accentColor)
                    .disabled(busy)
                }
            }
            Text(user.displayName ?? user.username).font(.title3.bold())
            Text("@\(user.username)").font(.callout).foregroundStyle(.secondary)
            if let bio = user.profile?.bio.text, !bio.isEmpty {
                Text(bio).font(.callout)
            }
            HStack(spacing: 16) {
                Text("\(user.followingCount) following").font(.caption)
                Text("\(user.followerCount) followers").font(.caption)
            }
            .foregroundStyle(.secondary)
        }
        .padding()
    }

    private var tabs: some View {
        Picker("Tab", selection: $tab) {
            ForEach(ProfileTab.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .padding(.horizontal)
        .padding(.bottom, 8)
        .onChange(of: tab) {
            list = PagedList { cursor in
                let page = try await session.client.getProfileFeed(fid: fid, tab: tab, cursor: cursor, limit: 20)
                return (page.casts, page.next.cursor)
            }
            Task { await list?.refresh() }
        }
    }

    @ViewBuilder
    private var feed: some View {
        if let list {
            if list.items.isEmpty && !list.loading {
                Text("Nothing here yet.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding()
            }
            ForEach(list.items, id: \.hash) { cast in
                CastRowView(cast: cast,
                            onReply: { navigator.compose(.reply($0)) },
                            onQuote: { navigator.compose(.quote($0)) })
                    .contentShape(Rectangle())
                    .onTapGesture { navigator.openCast(cast.hash) }
            }
            if !list.exhausted {
                HStack {
                    Spacer()
                    if list.loading { ProgressView() } else {
                        Button("Load more") { Task { await list.loadMore() } }
                    }
                    Spacer()
                }
                .listRowSeparator(.hidden)
            }
        }
    }

    private func toggleFollow() async {
        guard let current = following, !busy else { return }
        busy = true
        following = !current
        do {
            _ = try await session.publisher.follow(fid: fid, add: !current)
        } catch {
            following = current
            self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        busy = false
    }
}

enum ComposerTarget: Identifiable {
    case new
    case reply(Cast)
    case quote(Cast)
    var id: String {
        switch self {
        case .new: return "new"
        case .reply(let cast): return "reply-\(cast.hash)"
        case .quote(let cast): return "quote-\(cast.hash)"
        }
    }
}

/// Profile editing → UserData messages (display name, bio, pfp URL, banner URL).
struct EditProfileView: View {
    let user: User

    @Environment(SessionManager.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var displayName: String
    @State private var bio: String
    @State private var pfpUrl: String
    @State private var bannerUrl: String
    @State private var saving = false
    @State private var error: String?

    init(user: User) {
        self.user = user
        _displayName = State(initialValue: user.displayName ?? "")
        _bio = State(initialValue: user.profile?.bio.text ?? "")
        _pfpUrl = State(initialValue: user.pfpUrl ?? "")
        _bannerUrl = State(initialValue: user.profile?.banner?.url ?? "")
    }

    var body: some View {
        Form {
            TextField("Display name", text: $displayName)
            TextField("Avatar URL", text: $pfpUrl)
            TextField("Banner URL", text: $bannerUrl)
            TextField("Bio", text: $bio, axis: .vertical).lineLimit(3...6)
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }
                Button("Save") { Task { await save() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(saving)
            }
        }
        .formStyle(.grouped)
        .frame(width: 460, height: 320)
        .padding()
    }

    private func save() async {
        saving = true
        error = nil
        do {
            // Only write fields that changed — each is a separate UserData message.
            if displayName != (user.displayName ?? "") {
                _ = try await session.publisher.setProfileField(.display, value: displayName)
            }
            if bio != (user.profile?.bio.text ?? "") {
                _ = try await session.publisher.setProfileField(.bio, value: bio)
            }
            if pfpUrl != (user.pfpUrl ?? "") {
                _ = try await session.publisher.setProfileField(.pfp, value: pfpUrl)
            }
            if bannerUrl != (user.profile?.banner?.url ?? "") {
                _ = try await session.publisher.setProfileField(.banner, value: bannerUrl)
            }
            dismiss()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        saving = false
    }
}
