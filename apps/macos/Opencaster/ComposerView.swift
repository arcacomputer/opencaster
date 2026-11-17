import SwiftUI
import HypersnapAPI
import HypersnapProtocol

/// New cast / reply / quote sheet. ⌘Return submits.
struct ComposerView: View {
    /// nil = new cast; set to reply under or quote that cast.
    var parent: Cast?
    var quote: Cast?

    @Environment(SessionManager.self) private var session
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?

    private var byteCount: Int { Array(text.utf8).count }
    private var overLimit: Bool { byteCount > castTextLimit }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let parent {
                HStack(spacing: 8) {
                    Image(systemName: "arrowshape.turn.up.left").foregroundStyle(.secondary)
                    Text("Replying to @\(parent.author.username)").font(.callout).foregroundStyle(.secondary)
                }
                Text(parent.text).font(.caption).foregroundStyle(.tertiary).lineLimit(2)
            }
            if let quote {
                HStack(spacing: 8) {
                    Image(systemName: "quote.bubble").foregroundStyle(.secondary)
                    Text("Quoting @\(quote.author.username)").font(.callout).foregroundStyle(.secondary)
                }
                Text(quote.text).font(.caption).foregroundStyle(.tertiary).lineLimit(2)
            }

            TextEditor(text: $text)
                .font(.body)
                .frame(minHeight: 120)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(.quinary, in: RoundedRectangle(cornerRadius: 8))
                .accessibilityIdentifier("composerText")

            HStack {
                Text("\(byteCount)/\(castTextLimit)")
                    .font(.caption)
                    .foregroundStyle(overLimit ? .red : .secondary)
                Spacer()
                Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(parent != nil ? "Reply" : quote != nil ? "Quote" : "Cast") {
                    Task { await send() }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.return, modifiers: .command)
                .accessibilityIdentifier("composerSubmit")
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || overLimit || sending)
            }

            if let error {
                Text(error).font(.caption).foregroundStyle(.red)
            }
        }
        .padding(20)
        .frame(width: 480)
    }

    private func send() async {
        sending = true
        error = nil
        do {
            let message = try await session.publisher.cast(text: text, parent: parent, quote: quote)
            let kind = parent != nil ? "Reply" : quote != nil ? "Quote" : "Cast"
            if session.publisher.dryRun {
                // Validated only — there is no published cast to open.
                toasts.show("Dry run: \(kind.lowercased()) validated, not published")
            } else {
                toasts.show("\(kind) published", viewHash: bytesToHex(message.hash))
            }
            dismiss()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        sending = false
    }
}
