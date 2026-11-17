import XCTest

/// Снимки главных экранов на демо-данных: CI выкладывает их, чтобы дизайн
/// можно было проверить глазами без телефона.
final class ScreenshotTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    private func launch(_ appearance: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-EalzyDemo", "-appearance", appearance, "-AppleLanguages", "(ru)", "-AppleLocale", "ru_RU"]
        app.launch()
        return app
    }

    private func snap(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testScreens() {
        for appearance in ["light", "dark"] {
            let app = launch(appearance)
            XCTAssertTrue(app.buttons["Не сегодня"].waitForExistence(timeout: 15))
            sleep(1)
            snap("today-\(appearance)")

            app.tabBars.buttons["Илзи"].tap()
            sleep(1)
            snap("chat-\(appearance)")

            app.tabBars.buttons["Ещё"].tap()
            sleep(1)
            snap("settings-\(appearance)")

            app.tabBars.buttons["Сегодня"].tap()
            let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Начать'")).firstMatch
            if start.waitForExistence(timeout: 5) {
                start.tap()
                sleep(2)
                snap("focus-\(appearance)")
                app.buttons["Выйти из фокуса"].tap()
            }
            app.terminate()
        }
    }
}
