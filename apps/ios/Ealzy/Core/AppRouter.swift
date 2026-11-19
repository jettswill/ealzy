import Foundation
import Observation

/// Навигация: три вкладки («Сегодня», «Все дела», «Удиви меня»), шторка Илзи и «Ещё».
/// Сюда же ведут виджет «Записать», кнопка действия, push и ссылки ealzy://.
@MainActor
@Observable
final class AppRouter {
    static let shared = AppRouter()

    enum Tab: Hashable {
        case today, reserve, surprise
    }

    var tab: Tab = .today
    /// Шторка Илзи (полэкрана, во весь — когда печатаешь).
    var isIlziOpen = false
    var showSettings = false
    /// Счётчик «сразу печатать/говорить» — шторка ставит курсор в поле.
    private(set) var captureRequest = 0
    /// Текст, который надо сразу отправить Илзи (например, «Разобрать» из запаса).
    var pendingMessage: String?
    /// Разговор голосом (виджет «Илзи — голосом»): шторка сразу слушает.
    var voicePending = false

    func openVoice() {
        voicePending = true
        openIlzi()
    }

    /// Открыть идущий фокус (из Dynamic Island, экрана блокировки, виджета).
    private(set) var focusRequest = 0

    func openIlzi() {
        showSettings = false
        isIlziOpen = true
    }

    /// Открыть колесо «Удиви меня» — третья вкладка, рядом с Илзи.
    func openSurprise() {
        showSettings = false
        isIlziOpen = false
        tab = .surprise
    }

    func openCapture() {
        openIlzi()
        captureRequest += 1
    }

    func ask(_ text: String) {
        pendingMessage = text
        openIlzi()
    }

    /// ealzy://capture, ealzy://chat[?text=…], ealzy://today, ealzy://reserve, ealzy://focus, ealzy://surprise.
    /// true — если ссылка наша.
    func handle(_ url: URL) -> Bool {
        guard url.scheme == "ealzy" else { return false }
        switch url.host {
        case "capture": openCapture()
        case "voice": openVoice()
        case "chat":
            let text = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "text" })?.value
            if let text, !text.isEmpty { ask(text) } else { openIlzi() }
        case "focus":
            tab = .today
            focusRequest += 1
        case "today": tab = .today
        case "reserve": tab = .reserve
        case "surprise": openSurprise()
        default: return false
        }
        return true
    }
}
