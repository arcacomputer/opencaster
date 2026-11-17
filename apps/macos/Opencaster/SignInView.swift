import SwiftUI

/// Seed-phrase sign-in. Unlike the browser client — which never asks for a
/// recovery phrase — the native app derives the custody key locally, registers
/// a device signer with the node, then discards the phrase. Only derived key
/// material is persisted, in the login Keychain marked ThisDeviceOnly.
struct SignInView: View {
    @Environment(SessionManager.self) private var session
    @State private var phrase = ""
    @State private var showPhrase = false

    private var wordCount: Int {
        phrase.split(whereSeparator: \.isWhitespace).count
    }

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "bolt.circle")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            Text("Opencaster").font(.title.bold())
            Text("Sign in with your 24-word Farcaster recovery phrase.\nThe phrase is used once to derive your custody key on this Mac and is never stored.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Recovery phrase").font(.headline)
                    Spacer()
                    Text("\(wordCount)/24 words")
                        .font(.caption)
                        .foregroundStyle(wordCount == 24 ? .green : .secondary)
                }
                TextEditor(text: $phrase)
                    .font(.system(.body, design: .monospaced))
                    .frame(width: 420, height: 110)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .background(.quinary, in: RoundedRectangle(cornerRadius: 8))
                    .textContentType(.none)
                    .autocorrectionDisabled()
            }

            if let error = session.lastError {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .frame(width: 440)
            }

            Button("Sign in") {
                let entered = phrase
                phrase = ""
                Task { await session.signIn(phrase: entered) }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(wordCount != 24)

            if session.hasPendingSigner {
                Button("Check again") { Task { await session.restore() } }
            }

            Text("This registers an Ed25519 device signer (casts, deletes, reactions, follows, profile updates) with a 7-day sliding window, kept only on this Mac.")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .frame(width: 460)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
