import Foundation
import Observation

/// Навигация: две вкладки («Сегодня», «Запас»), шторка Илзи и «Ещё».
/// Сюда же ведут виджет «Записать», кнопка действия, push и ссылки ealzy://.
@MainActor
@Observable
final class AppRouter {
    static let shared = AppRouter()

    enum Tab: Hashable {
        case today, reserve
    }

    var tab: Tab = .today
    /// Шторка Илзи (полэкрана, во весь — когда печатаешь).
    var isIlziOpen = false
    var showSettings = false
    /// Счётчик «сразу печатать/говорить» — шторка ставит курсор в поле.
    private(set) var captureRequest = 0
    /// Текст, который надо сразу отправить Илзи (например, «Разобрать» из запаса).
    var pendingMessage: String?

    func openIlzi() {
        showSettings = false
        isIlziOpen = true
    }

    func openCapture() {
        openIlzi()
        captureRequest += 1
    }

    func ask(_ text: String) {
        pendingMessage = text
        openIlzi()
    }

    /// ealzy://capture, ealzy://chat, ealzy://today, ealzy://reserve. true — если ссылка наша.
    func handle(_ url: URL) -> Bool {
        guard url.scheme == "ealzy" else { return false }
        switch url.host {
        case "capture": openCapture()
        case "chat": openIlzi()
        case "today": tab = .today
        case "reserve": tab = .reserve
        default: return false
        }
        return true
    }
}
