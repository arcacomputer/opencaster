import Foundation
import Observation

/// App-wide transient notifications. Writers (composer, actions) call `show`;
/// MainView renders the toast and presents the target on "View".
@MainActor
@Observable
final class ToastCenter {
    struct Toast: Equatable, Identifiable {
        let id = UUID()
        let title: String
        /// Cast hash to open when the user taps View; nil = no action.
        let viewHash: String?
    }

    private(set) var current: Toast?
    #if DEBUG
    /// UI tests need the toast to outlive slow live reads and clicks.
    private let lifetime: Duration = SessionManager.launchedForUITests ? .seconds(60) : .seconds(7)
    #else
    private let lifetime: Duration = .seconds(7)
    #endif
    @ObservationIgnored private var dismissTask: Task<Void, Never>?

    func show(_ title: String, viewHash: String? = nil) {
        dismissTask?.cancel()
        current = Toast(title: title, viewHash: viewHash)
        dismissTask = Task { [weak self, lifetime] in
            try? await Task.sleep(for: lifetime)
            guard !Task.isCancelled else { return }
            self?.current = nil
        }
    }

    func dismiss() {
        dismissTask?.cancel()
        current = nil
    }
}
