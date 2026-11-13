import SwiftUI

@main
struct OpencasterApp: App {
    @State private var session = SessionManager()
    @State private var toasts = ToastCenter()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(session)
                .environment(toasts)
                .frame(minWidth: 860, minHeight: 560)
                .task { await session.restore() }
        }
        .windowStyle(.titleBar)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Cast") { NotificationCenter.default.post(name: .composeRequested, object: nil) }
                    .keyboardShortcut("n", modifiers: .command)
            }
        }
    }
}

extension Notification.Name {
    static let composeRequested = Notification.Name("opencaster.composeRequested")
}
