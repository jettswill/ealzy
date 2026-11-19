import Foundation
import Observation
import UIKit

/// Режим фокуса iPhone во время фокуса в Ealzy. Включить его напрямую стороннему
/// приложению iOS не даёт, поэтому — через две Команды человека: «Ealzy фокус вкл»
/// и «Ealzy фокус выкл» (в каждой одно действие «Включить/выключить фокусирование»).
/// Запуск по x-callback: «Команды» мелькают на секунду и возвращают в Ealzy.
@MainActor
@Observable
final class SystemFocus {
    static let shared = SystemFocus()

    static let enabledKey = "systemFocusEnabled"
    private static let activeKey = "systemFocusActive"
    static let onShortcut = "Ealzy фокус вкл"
    static let offShortcut = "Ealzy фокус выкл"

    /// Последний ответ «Команд»: nil — ещё не запускали.
    private(set) var lastResult: Result?

    enum Result: Equatable {
        case ok
        case missing(String)
    }

    var isEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: Self.enabledKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.enabledKey) }
    }

    /// Мы включили режим фокуса и ещё не выключили.
    private var isActive: Bool {
        get { UserDefaults.standard.bool(forKey: Self.activeKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.activeKey) }
    }

    /// Начался фокус на деле.
    func focusStarted() {
        guard isEnabled, !DemoData.isOn else { return }
        isActive = true
        run(Self.onShortcut)
    }

    /// Фокус закончили (или он закончился, пока приложение было закрыто).
    func focusEnded() {
        guard isActive else { return }
        isActive = false
        run(Self.offShortcut)
    }

    /// Проверка из настроек: только включить (выключить — в Пункте управления).
    func test() {
        run(Self.onShortcut)
    }

    private func run(_ name: String) {
        var back = URLComponents()
        back.scheme = "ealzy"
        back.host = "system-focus"
        back.queryItems = [URLQueryItem(name: "shortcut", value: name)]
        var failed = back
        failed.queryItems?.append(URLQueryItem(name: "error", value: "1"))

        var components = URLComponents()
        components.scheme = "shortcuts"
        components.host = "x-callback-url"
        components.path = "/run-shortcut"
        components.queryItems = [
            URLQueryItem(name: "name", value: name),
            URLQueryItem(name: "x-success", value: back.url?.absoluteString),
            URLQueryItem(name: "x-cancel", value: back.url?.absoluteString),
            URLQueryItem(name: "x-error", value: failed.url?.absoluteString),
        ]
        guard let url = components.url else { return }
        UIApplication.shared.open(url)
    }

    /// `ealzy://system-focus?...` — «Команды» вернули нас обратно.
    func handleCallback(_ url: URL) {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let name = items.first(where: { $0.name == "shortcut" })?.value ?? ""
        if items.contains(where: { $0.name == "error" }) {
            lastResult = .missing(name)
            if name == Self.onShortcut { isActive = false }
        } else {
            lastResult = .ok
        }
    }
}
