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
            snap("1-today-\(appearance)")

            app.buttons["Запас"].tap()
            sleep(1)
            snap("2-reserve-\(appearance)")
            app.buttons["Сегодня"].tap()
            sleep(1)

            app.buttons["Илзи"].tap()
            sleep(2)
            snap("3-ilzi-half-\(appearance)")
            // Закрыть шторку — свайпом вниз, без крестика.
            app.otherElements.firstMatch.swipeDown(velocity: .fast)
            sleep(1)

            app.buttons["Ещё"].tap()
            sleep(1)
            snap("4-settings-\(appearance)")
            app.buttons["Готово"].firstMatch.tap()
            sleep(1)

            let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Начать'")).firstMatch
            if start.waitForExistence(timeout: 5) {
                start.tap()
                sleep(2)
                snap("5-focus-\(appearance)")
                app.buttons["Выйти из фокуса"].tap()
            }
            app.terminate()
        }
    }
}
