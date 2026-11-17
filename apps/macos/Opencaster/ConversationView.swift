import SwiftUI
import HypersnapAPI

/// Thread view for a cast + nested replies.
struct ConversationView: View {
    let rootHash: String
    @Environment(SessionManager.self) private var session
    @Environment(\.navigator) private var navigator
    @State private var root: ConversationNode?
    @State private var error: String?

    var body: some View {
        Group {
            if let error {
                ContentUnavailableView {
                    Label("Couldn't load the conversation", systemImage: "exclamationmark.triangle")
                } description: { Text(error) }
                .accessibilityIdentifier("conversationError")
            } else if let root {
                List {
                    NodeView(node: root, depth: 0)
                }
                .listStyle(.plain)
                .accessibilityIdentifier("conversationView")
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Conversation")
        .task {
            // A just-published cast can take a moment to reach the node's
            // read index; retry not-found briefly before giving up.
            for attempt in 0..<6 {
                do {
                    root = try await session.client.getConversation(hash: rootHash)
                    return
                } catch let apiError as ApiError where apiError.status == 404 && attempt < 5 {
                    try? await Task.sleep(for: .seconds(1.5))
                } catch {
                    self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                    return
                }
            }
        }
    }

    private struct NodeView: View {
        let node: ConversationNode
        let depth: Int
        @Environment(\.navigator) private var navigator
        var body: some View {
            CastRowView(cast: node.cast,
                        onReply: { navigator.compose(.reply($0)) },
                        onQuote: { navigator.compose(.quote($0)) })
                .padding(.leading, CGFloat(depth) * 20)
                .contentShape(Rectangle())
                .onTapGesture { if depth > 0 { navigator.openCast(node.cast.hash) } }
            ForEach(node.replies.indices, id: \.self) { index in
                NodeView(node: node.replies[index], depth: depth + 1)
            }
        }
    }
}
