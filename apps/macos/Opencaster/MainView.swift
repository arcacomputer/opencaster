import SwiftUI
import HypersnapAPI

enum SidebarItem: String, CaseIterable, Identifiable, Hashable {
    case discover = "Discover"
    case following = "Following"
    case notifications = "Notifications"
    case channels = "Channels"
    case search = "Search"
    case profile = "Profile"
    case settings = "Settings"

    var id: String { rawValue }
    var icon: String {
        switch self {
        case .discover: return "flame"
        case .following: return "person.2"
        case .notifications: return "bell"
        case .channels: return "number"
        case .search: return "magnifyingglass"
        case .profile: return "person.crop.circle"
        case .settings: return "gear"
        }
    }
}

struct CastRoute: Hashable {
    let hash: String
}

struct Navigator {
    var openCast: @MainActor (String) -> Void = { _ in }
    var openProfile: @MainActor (UInt64) -> Void = { _ in }
    var compose: @MainActor (ComposerTarget) -> Void = { _ in }
}

extension EnvironmentValues {
    @Entry var navigator = Navigator()
}

struct MainView: View {
    @Environment(SessionManager.self) private var session
    @Environment(ToastCenter.self) private var toasts
    @State private var selection: SidebarItem? = .discover
    @State private var path = NavigationPath()
    @State private var composerTarget: ComposerTarget?

    private var navigator: Navigator {
        Navigator(openCast: { path.append(CastRoute(hash: $0)) },
                  openProfile: { path.append($0) },
                  compose: { composerTarget = $0 })
    }

    var body: some View {
        NavigationSplitView {
            List(SidebarItem.allCases, selection: $selection) { item in
                Label(item.rawValue, systemImage: item.icon)
                    .accessibilityIdentifier("sidebar.\(item.rawValue)")
                    .tag(item)
            }
            .listStyle(.sidebar)
            .navigationTitle("Opencaster")
            .safeAreaInset(edge: .bottom) {
                if let user = session.user {
                    Button { selection = .profile } label: {
                        HStack(spacing: 10) {
                            AvatarView(url: user.pfpUrl, size: 30)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(user.displayName ?? user.username)
                                    .font(.callout.weight(.medium)).lineLimit(1)
                                Text("@\(user.username)")
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        } detail: {
            NavigationStack(path: $path) {
                Group {
                    switch selection ?? .discover {
                    case .discover:
                        FeedView(kind: .trending)
                    case .following:
                        FeedView(kind: session.signer.map { .following(fid: $0.fid) } ?? .trending)
                    case .notifications:
                        NotificationsView()
                    case .channels:
                        ChannelsView()
                    case .search:
                        SearchView()
                    case .profile:
                        if let fid = session.signer?.fid {
                            ProfileView(fid: fid)
                        } else {
                            ContentUnavailableView("Not signed in", systemImage: "person.crop.circle")
                        }
                    case .settings:
                        SettingsView()
                    }
                }
                .navigationDestination(for: UInt64.self) { fid in
                    ProfileView(fid: fid)
                }
                .navigationDestination(for: CastRoute.self) { route in
                    ConversationView(rootHash: route.hash)
                }
                .navigationDestination(for: Channel.self) { channel in
                    FeedView(kind: .channel(id: channel.id), channelId: channel.id,
                             showTimeWindowPicker: false)
                }
            }
            .environment(\.navigator, navigator)
            .onChange(of: selection) { path = NavigationPath() }
        }
        .sheet(item: $composerTarget) { target in
            switch target {
            case .new: ComposerView()
            case .reply(let cast): ComposerView(parent: cast)
            case .quote(let cast): ComposerView(quote: cast)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .composeRequested)) { _ in
            composerTarget = .new
        }
        .overlay(alignment: .bottom) {
            if let toast = toasts.current {
                HStack(spacing: 12) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    Text(toast.title).font(.callout)
                        .accessibilityIdentifier("toastTitle")
                    if toast.viewHash != nil {
                        Button("View") {
                            if let hash = toast.viewHash { path.append(CastRoute(hash: hash)) }
                            toasts.dismiss()
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .accessibilityIdentifier("toastView")
                    }
                    Button { toasts.dismiss() } label: {
                        Image(systemName: "xmark").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("toastDismiss")
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("toast")
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(.regularMaterial, in: .capsule)
                .shadow(radius: 8, y: 2)
                .padding(.bottom, 16)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: toasts.current != nil)
        #if DEBUG
        .task {
            let env = ProcessInfo.processInfo.environment
            if let hash = env["OPENCASTER_DEBUG_TOAST"] {
                toasts.show("Cast published", viewHash: hash)
                if env["OPENCASTER_DEBUG_OPEN"] == "1" { path.append(CastRoute(hash: hash)) }
            }
        }
        #endif
    }
}

/// Paged list state shared by feed-style screens.
@MainActor
@Observable
final class PagedList<Item> {
    private(set) var items: [Item] = []
    private(set) var cursor: String?
    private(set) var loading = false
    private(set) var exhausted = false
    var error: String?
    private let fetch: @Sendable (String?) async throws -> (items: [Item], cursor: String?)

    init(fetch: @escaping @Sendable (String?) async throws -> (items: [Item], cursor: String?)) {
        self.fetch = fetch
    }

    func refresh() async {
        guard !loading else { return }
        loading = true
        error = nil
        do {
            let page = try await fetch(nil)
            items = page.items
            cursor = page.cursor
            exhausted = page.cursor == nil
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        loading = false
    }

    func loadMore() async {
        guard !loading, !exhausted, let cursor else { return }
        loading = true
        do {
            let page = try await fetch(cursor)
            items.append(contentsOf: page.items)
            self.cursor = page.cursor
            exhausted = page.cursor == nil
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        loading = false
    }
}
