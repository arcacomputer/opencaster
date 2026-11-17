// UI smoke tests. OPENCASTER_UITEST=1 signs in a stub session (live public
// reads; writes are signed locally but never sent — see Session/Publisher).
// OPENCASTER_UITEST_SIGNED_OUT=1 forces the signed-out screen without reading
// the developer's Keychain session.
import XCTest

final class OpencasterUITests: XCTestCase {
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

    private func selectSidebar(_ item: String, in app: XCUIApplication,
                               file: StaticString = #filePath, line: UInt = #line) {
        for query in [app.buttons[item], app.cells[item], app.staticTexts[item]] {
            if query.firstMatch.waitForExistence(timeout: 10) {
                query.firstMatch.click()
                return
            }
        }
        XCTFail("sidebar item \(item) not found", file: file, line: line)
    }

    /// First matching element across queries; waits up to `timeout`.
    private func firstExisting(_ queries: [XCUIElement], timeout: TimeInterval) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if let hit = queries.first(where: { $0.exists }) { return hit }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        } while Date() < deadline
        return nil
    }

    private func conversationLoaded(_ app: XCUIApplication) -> XCUIElement? {
        firstExisting([
            app.staticTexts["Conversation"],
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Discover")).firstMatch,
        ], timeout: 30)
    }

    func testSignedOutShowsSignIn() {
        let app = XCUIApplication()
        app.launchEnvironment = ["OPENCASTER_UITEST_SIGNED_OUT": "1"]
        app.launch()
        XCTAssertTrue(any(app, identifier: "signInView").waitForExistence(timeout: 15))
    }

    func testDiscoverFeedLoads() {
        let app = launch()
        XCTAssertTrue(any(app, identifier: "castRow").waitForExistence(timeout: 30))
    }

    func testSidebarNavigation() {
        let app = launch()
        XCTAssertTrue(any(app, identifier: "castRow").waitForExistence(timeout: 30))

        selectSidebar("Following", in: app)
        XCTAssertNotNil(firstExisting([
            any(app, identifier: "castRow"),
            app.staticTexts["No casts"],
            app.staticTexts["Couldn't load the feed"],
        ], timeout: 30), "Following feed did not render")

        selectSidebar("Notifications", in: app)
        XCTAssertNotNil(firstExisting([
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "your cast")).firstMatch,
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "followed you")).firstMatch,
            app.buttons["Load more"],
        ], timeout: 30), "Notifications did not render")

        selectSidebar("Channels", in: app)
        XCTAssertNotNil(firstExisting([
            app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "/")).firstMatch,
            app.staticTexts["Couldn't load channels"],
        ], timeout: 30), "Channels did not render")

        selectSidebar("Search", in: app)
        XCTAssertTrue(any(app, identifier: "searchField").waitForExistence(timeout: 10))

        selectSidebar("Profile", in: app)
        XCTAssertNotNil(firstExisting([
            app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "@")).firstMatch,
            app.staticTexts["Couldn't load the profile"],
        ], timeout: 30), "Profile did not render")

        selectSidebar("Settings", in: app)
        XCTAssertNotNil(firstExisting([
            app.checkBoxes["Dry run (validate only, don't publish)"],
            app.staticTexts["Dry run (validate only, don't publish)"],
        ], timeout: 10), "Settings did not render")
    }

    func testSearchFindsPeople() {
        let app = launch()
        selectSidebar("Search", in: app)
        let field = any(app, identifier: "searchField")
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.click()
        field.typeText("dwr")
        app.typeText("\n")
        XCTAssertTrue(app.staticTexts["People"].waitForExistence(timeout: 30))
    }

    func testOpenConversation() {
        let app = launch()
        let row = any(app, identifier: "castRow")
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        row.click()
        XCTAssertNotNil(conversationLoaded(app), "Conversation did not open")
    }

    func testComposeDryRunToast() {
        let app = launch()
        XCTAssertTrue(any(app, identifier: "castRow").waitForExistence(timeout: 30))
        app.typeKey("n", modifierFlags: .command)
        let editor = any(app, identifier: "composerText")
        XCTAssertTrue(editor.waitForExistence(timeout: 10))
        editor.click()
        editor.typeText("ui test dry run cast")
        let submit = any(app, identifier: "composerSubmit")
        XCTAssertTrue(submit.waitForExistence(timeout: 10))
        submit.click()
        let toast = any(app, identifier: "toast")
        XCTAssertTrue(toast.waitForExistence(timeout: 15))
        XCTAssertTrue(toast.staticTexts
            .matching(NSPredicate(format: "label CONTAINS[c] %@", "Dry run"))
            .firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(any(app, identifier: "toastView").exists)
        any(app, identifier: "toastDismiss").click()
        XCTAssertFalse(toast.waitForExistence(timeout: 5))
    }

    func testToastViewOpensCast() {
        let app = launch(extraEnv: ["OPENCASTER_DEBUG_TOAST": "0x854c9bf8d865cb9d25c5855149addc498e82084e"])
        let toastView = any(app, identifier: "toastView")
        XCTAssertTrue(toastView.waitForExistence(timeout: 15))
        toastView.click()
        XCTAssertNotNil(conversationLoaded(app), "Conversation did not open from toast")
    }

    func testLikeTogglesLocally() {
        let app = launch()
        XCTAssertTrue(any(app, identifier: "castRow").waitForExistence(timeout: 30))
        let like = app.buttons["Like"].firstMatch
        XCTAssertTrue(like.waitForExistence(timeout: 30))
        like.click()
        XCTAssertTrue(app.buttons["Unlike"].firstMatch.waitForExistence(timeout: 15))
    }
}
