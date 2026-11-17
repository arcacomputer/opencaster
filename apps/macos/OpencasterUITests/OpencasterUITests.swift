// UI smoke tests. OPENCASTER_UITEST=1 signs in a stub session (live public
// reads; writes are signed locally but never sent — see Session/Publisher).
// OPENCASTER_UITEST_SIGNED_OUT=1 forces the signed-out screen without reading
// the developer's Keychain session. Sign-in is a no-op in both modes.
import XCTest

final class OpencasterUITests: XCTestCase {
    private static let liveTimeout: TimeInterval = 30

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(extraEnv: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-publisher.dryRun", "YES"]
        var env = ["OPENCASTER_UITEST": "1"]
        env.merge(extraEnv) { _, new in new }
        app.launchEnvironment = env
        app.launch()
        return app
    }

    private func any(_ app: XCUIApplication, identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    /// First matching element across queries; waits up to `timeout`.
    private func firstExisting(_ queries: [XCUIElement], timeout: TimeInterval) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if let hit = queries.first(where: { $0.exists }) { return hit }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        } while Date() < deadline
        return nil
    }

    private func waitForAny(_ app: XCUIApplication, _ identifiers: [String],
                            timeout: TimeInterval = liveTimeout) -> XCUIElement? {
        firstExisting(identifiers.map { any(app, identifier: $0) }, timeout: timeout)
    }

    private func waitForFeed(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(any(app, identifier: "castRow").waitForExistence(timeout: Self.liveTimeout),
                      "Discover feed did not load", file: file, line: line)
    }

    private func selectSidebar(_ item: String, in app: XCUIApplication,
                               file: StaticString = #filePath, line: UInt = #line) {
        // The identifier lands on the row's text or cell depending on the
        // macOS version; fall back to the sidebar text itself.
        let sidebar = app.outlines["Sidebar"]
        guard let hit = firstExisting([
            any(app, identifier: "sidebar.\(item)"),
            sidebar.staticTexts.matching(NSPredicate(format: "value == %@", item)).firstMatch,
        ], timeout: 10) else {
            return XCTFail("sidebar item \(item) not found", file: file, line: line)
        }
        hit.click()
    }

    func testSignedOutShowsSignIn() {
        let app = XCUIApplication()
        app.launchEnvironment = ["OPENCASTER_UITEST_SIGNED_OUT": "1"]
        app.launch()
        XCTAssertTrue(any(app, identifier: "signInView").waitForExistence(timeout: 15))
    }

    func testDiscoverFeedLoads() {
        let app = launch()
        waitForFeed(app)
        XCTAssertTrue(any(app, identifier: "castText").exists)
    }

    func testSidebarNavigation() {
        let app = launch()
        waitForFeed(app)

        selectSidebar("Following", in: app)
        XCTAssertNotNil(waitForAny(app, ["castRow", "feedEmpty", "feedError"]), "Following feed did not render")

        selectSidebar("Notifications", in: app)
        XCTAssertNotNil(waitForAny(app, ["notificationRow", "notificationsEmpty", "notificationsError"]),
                        "Notifications did not render")

        selectSidebar("Channels", in: app)
        XCTAssertNotNil(waitForAny(app, ["channelRow", "channelsError"]), "Channels did not render")

        selectSidebar("Search", in: app)
        XCTAssertTrue(any(app, identifier: "searchField").waitForExistence(timeout: 10))

        selectSidebar("Profile", in: app)
        XCTAssertNotNil(waitForAny(app, ["profileUsername", "profileError"]), "Profile did not render")

        selectSidebar("Settings", in: app)
        XCTAssertTrue(any(app, identifier: "dryRunToggle").waitForExistence(timeout: 10), "Settings did not render")
    }

    func testSearchFindsPeople() {
        let app = launch()
        selectSidebar("Search", in: app)
        let field = any(app, identifier: "searchField")
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.click()
        field.typeText("dwr\n")
        XCTAssertNotNil(firstExisting([
            app.staticTexts["People"],
            app.staticTexts.matching(NSPredicate(format: "value == %@", "People")).firstMatch,
        ], timeout: Self.liveTimeout), "No people results")
    }

    func testOpenConversation() {
        let app = launch()
        waitForFeed(app)
        // Click the body text (not the avatar/name buttons, links or actions).
        let text = app.staticTexts.matching(NSPredicate(format: "identifier == %@ AND value != %@", "castText", ""))
            .firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 10))
        text.click()
        XCTAssertTrue(any(app, identifier: "conversationView").waitForExistence(timeout: Self.liveTimeout),
                      "Conversation did not open")
    }

    func testComposeDryRunToast() {
        let app = launch()
        waitForFeed(app)
        app.typeKey("n", modifierFlags: .command)
        let editor = any(app, identifier: "composerText")
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        editor.click()
        editor.typeText("ui test dry run cast")
        let submit = any(app, identifier: "composerSubmit")
        XCTAssertTrue(submit.waitForExistence(timeout: 10))
        XCTAssertTrue(submit.isEnabled)
        submit.click()
        let toast = any(app, identifier: "toast")
        XCTAssertTrue(toast.waitForExistence(timeout: 15))
        let title = any(app, identifier: "toastTitle")
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertTrue((title.value as? String ?? "").localizedCaseInsensitiveContains("Dry run"),
                      "Unexpected toast: \(String(describing: title.value))")
        XCTAssertFalse(any(app, identifier: "toastView").exists)
        any(app, identifier: "toastDismiss").click()
        XCTAssertTrue(toast.waitForNonExistence(timeout: 5))
    }

    func testToastViewOpensCast() {
        let app = launch(extraEnv: ["OPENCASTER_DEBUG_TOAST": "0x854c9bf8d865cb9d25c5855149addc498e82084e"])
        let toastView = any(app, identifier: "toastView")
        XCTAssertTrue(toastView.waitForExistence(timeout: Self.liveTimeout))
        toastView.click()
        XCTAssertTrue(any(app, identifier: "conversationView").waitForExistence(timeout: Self.liveTimeout),
                      "Conversation did not open from toast")
        XCTAssertFalse(any(app, identifier: "toast").exists)
    }

    func testLikeTogglesLocally() {
        let app = launch()
        waitForFeed(app)
        let rows = app.descendants(matching: .any).matching(identifier: "castRow")
        var target: XCUIElement?
        for index in 0..<min(rows.count, 8) {
            let row = rows.element(boundBy: index)
            if row.buttons["Like"].exists, row.buttons["Like"].isEnabled { target = row; break }
        }
        guard let row = target else { return XCTFail("No likeable cast row") }
        let likes = Int(row.buttons["Like"].value as? String ?? "") ?? -1
        row.buttons["Like"].click()
        let unlike = row.buttons["Unlike"]
        XCTAssertTrue(unlike.waitForExistence(timeout: 15))
        if likes >= 0 { XCTAssertEqual(unlike.value as? String, "\(likes + 1)") }
    }
}
