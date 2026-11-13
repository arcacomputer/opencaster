import SwiftUI
import HypersnapAPI

struct ContentView: View {
    @Environment(SessionManager.self) private var session

    var body: some View {
        switch session.phase {
        case .signedOut:
            SignInView()
        case .restoring:
            ProgressView("Restoring session…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .signingIn(let step):
            VStack(spacing: 12) {
                ProgressView()
                Text(step).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .signedIn:
            MainView()
        }
    }
}
