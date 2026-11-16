import Foundation
import Observation

/// Куда открыть приложение: виджет «Записать», кнопка действия, ссылки ealzy://.
@MainActor
@Observable
final class AppRouter {
    static let shared = AppRouter()

    enum Tab: Hashable {
        case today, chat, settings
    }

    var tab: Tab = .today
    /// Счётчик запросов «открой запись» — экран «Сегодня» ставит курсор в поле.
    private(set) var captureRequest = 0

    func openCapture() {
        tab = .today
        captureRequest += 1
    }

    /// ealzy://capture, ealzy://chat, ealzy://today. Возвращает true, если ссылка наша.
    func handle(_ url: URL) -> Bool {
        guard url.scheme == "ealzy" else { return false }
        switch url.host {
        case "capture": openCapture()
        case "chat": tab = .chat
        case "today": tab = .today
        default: return false
        }
        return true
    }
}
