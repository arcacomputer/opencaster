import SwiftUI
import HypersnapAPI

/// A paged cast feed (trending / following / user / channel).
struct FeedView: View {
    let kind: FeedKind
    var channelId: String? = nil
    var showTimeWindowPicker = true

    @Environment(SessionManager.self) private var session
    @Environment(\.navigator) private var navigator
    @State private var timeWindow: TrendingTimeWindow = .h24
    @State private var list: PagedList<Cast>?

    var body: some View {
        VStack(spacing: 0) {
            if case .trending = kind, showTimeWindowPicker {
                Picker("Window", selection: $timeWindow) {
                    ForEach(TrendingTimeWindow.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 320)
                .padding(.vertical, 8)
            }
            content
        }
        .navigationTitle(title)
        .toolbar {
            ToolbarItem {
                Button { Task { await list?.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Refresh")
            }
            ToolbarItem {
                Button { navigator.compose(.new) } label: { Image(systemName: "square.and.pencil") }
                    .help("New cast (⌘N)")
                    .accessibilityLabel("New cast")
            }
        }
        .task(id: FeedKey(kind: kind, window: timeWindow)) {
            let window = timeWindow
            list = PagedList<Cast> { cursor in
                let page = try await session.client.getFeed(kind: kind,
                                                            timeWindow: isTrending ? window : nil,
                                                            cursor: cursor, limit: 25)
                return (page.casts, page.next.cursor)
            }
            await list?.refresh()
        }
    }

    private struct FeedKey: Equatable {
        let kind: FeedKind
        let window: TrendingTimeWindow
    }

    private var isTrending: Bool { if case .trending = kind { return true }; return false }

    private var title: String {
        switch kind {
        case .trending: return "Discover"
        case .following: return "Following"
        case .channel: return "#\(channelId ?? "channel")"
        case .user: return "Casts"
        }
    }

    @ViewBuilder
    private var content: some View {
        if let list {
            if let error = list.error, list.items.isEmpty {
                ContentUnavailableView {
                    Label("Couldn't load the feed", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { Task { await list.refresh() } }
                }
            } else if list.items.isEmpty && !list.loading {
                ContentUnavailableView("No casts", systemImage: "tray")
            } else {
                List {
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
                    if list.items.isEmpty && list.loading {
                        HStack { Spacer(); ProgressView(); Spacer() }
                    }
                }
                .listStyle(.plain)
            }
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
