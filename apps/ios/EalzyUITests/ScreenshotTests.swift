import XCTest

/// Снимки главных экранов на демо-данных: CI выкладывает их, чтобы дизайн
/// можно было проверить глазами без телефона.
final class ScreenshotTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    private func launch(_ appearance: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-EalzyDemo", "-appearance", appearance, "-AppleLanguages", "(ru)", "-AppleLocale", "ru_RU"] + extra
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
            XCTAssertTrue(app.buttons["Сменить"].waitForExistence(timeout: 15))
            sleep(1)
            snap("1-today-\(appearance)")

            app.buttons["Все дела"].tap()
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

            app.buttons["Ещё"].firstMatch.tap()
            sleep(1)
            snap("4-settings-\(appearance)")
            app.buttons["Готово"].firstMatch.tap()
            sleep(1)

            if appearance == "dark" {
                let title = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Северного'")).firstMatch
                if title.waitForExistence(timeout: 5) {
                    title.tap(); sleep(1); snap("6-task-detail-dark")
                    app.buttons["Закрыть"].firstMatch.tap(); sleep(1)
                }
                let call = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Созвон'")).firstMatch
                if call.waitForExistence(timeout: 5) {
                    call.tap(); sleep(1); snap("7-event-dark")
                    app.buttons["Закрыть"].firstMatch.tap(); sleep(1)
                }
                app.buttons["Сменить"].tap(); sleep(1); snap("8-change-focus-dark")
                app.buttons["Отмена"].firstMatch.tap(); sleep(1)
            }
            let start = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Начать'")).firstMatch
            if start.waitForExistence(timeout: 5) {
                start.tap()
                sleep(2)
                snap("5-focus-\(appearance)")
                app.buttons["Свернуть фокус"].tap()
                sleep(1)
                snap("9-focus-minimized-\(appearance)")
            }
            app.terminate()
        }
    }

    func testDayDoneScreen() {
        let app = launch("light", extra: ["-EalzyDemoDone"])
        if app.buttons["Взять ещё"].waitForExistence(timeout: 15) {
            sleep(1)
            snap("10-day-done-light")
        }
        app.terminate()
    }

    func testLoginScreen() {
        for appearance in ["light", "dark"] {
            let app = XCUIApplication()
            app.launchArguments = ["-appearance", appearance, "-AppleLanguages", "(ru)", "-AppleLocale", "ru_RU"]
            app.launch()
            if app.buttons["Войти через Telegram"].waitForExistence(timeout: 15) {
                sleep(1)
                snap("0-login-\(appearance)")
            }
            app.terminate()
        }
    }
}
