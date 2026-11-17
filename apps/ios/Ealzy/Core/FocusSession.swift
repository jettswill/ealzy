import Foundation
import Observation

/// Идущий фокус: какое дело, когда начато, сколько запланировано, пауза.
/// Хранится на устройстве, чтобы пережить закрытие приложения.
@MainActor
@Observable
final class FocusSession {
    private static let key = "focusSession"

    struct State: Codable, Equatable {
        var taskId: String
        var title: String
        var plannedMinutes: Int
        var startedAt: Date
        /// Сколько секунд уже отработано до последней паузы.
        var banked: TimeInterval = 0
        var pausedAt: Date?
        /// Если включён помодоро — работа/перерыв по кругу; отсчёт идёт по фазе.
        var pomodoro: Pomodoro?
    }

    private(set) var state: State? {
        didSet {
            if let state, let data = try? JSONEncoder().encode(state) {
                UserDefaults.standard.set(data, forKey: Self.key)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.key)
            }
            refreshExternal()
            schedulePomodoroAlerts()
        }
    }

    init() {
        // Снимки экранов в демо-режиме каждый раз начинают с чистого листа.
        if DemoData.isOn { UserDefaults.standard.removeObject(forKey: Self.key) }
        if let data = UserDefaults.standard.data(forKey: Self.key) {
            state = try? JSONDecoder().decode(State.self, from: data)
        }
        // Приложение перезапустили: активность в Dynamic Island должна совпадать с тем, что идёт.
        refreshExternal()
    }

    /// Виджет и Dynamic Island показывают то же, что приложение (вызывать и при смене фазы помодоро).
    func refreshExternal() {
        WidgetSnapshot.setFocusRun(widgetRun)
        FocusLiveActivity.sync(state, remaining: remaining(), phase: phase())
    }

    private func schedulePomodoroAlerts() {
        if let state, let pomodoro = state.pomodoro, state.pausedAt == nil {
            PomodoroAlerts.schedule(pomodoro, title: state.title, elapsed: elapsed())
        } else {
            PomodoroAlerts.cancel()
        }
    }

    /// Текущая фаза помодоро (nil — обычный фокус).
    func phase(at now: Date = Date()) -> Pomodoro.Phase? {
        state?.pomodoro?.phase(elapsed: elapsed(at: now))
    }

    /// Перерыв можно пропустить — сразу следующий помидор.
    func skipBreak() {
        guard var current = state, let phase = phase(), phase.isBreak else { return }
        current.banked += phase.remaining
        state = current
    }

    var isRunning: Bool { state != nil }

    /// Что показать в виджете: дело и когда выйдет время (или сколько осталось на паузе).
    private var widgetRun: WidgetSnapshot.FocusRun? {
        guard let state else { return nil }
        let remaining = remaining()
        return WidgetSnapshot.FocusRun(
            taskId: state.taskId,
            title: phase()?.isBreak == true ? "Перерыв · \(state.title)" : state.title,
            endsAt: state.pausedAt == nil ? Date().addingTimeInterval(remaining) : nil,
            pausedRemaining: state.pausedAt == nil ? nil : remaining
        )
    }
    /// Экран фокуса открыт. Свернуть его — не значит остановить: таймер идёт дальше.
    var isPresented = false
    var isPaused: Bool { state?.pausedAt != nil }

    func start(_ task: EalzyTask, minutes: Int) {
        state = State(taskId: task.id, title: task.title, plannedMinutes: minutes, startedAt: Date(),
                      pomodoro: Pomodoro.current)
        isPresented = true
    }

    func elapsed(at now: Date = Date()) -> TimeInterval {
        guard let state else { return 0 }
        if state.pausedAt != nil { return state.banked }
        return state.banked + now.timeIntervalSince(state.startedAt)
    }

    func remaining(at now: Date = Date()) -> TimeInterval {
        guard let state else { return 0 }
        if let phase = phase(at: now) { return phase.remaining }
        return TimeInterval(state.plannedMinutes * 60) - elapsed(at: now)
    }

    func togglePause() {
        guard var current = state else { return }
        if current.pausedAt != nil {
            current.pausedAt = nil
            current.startedAt = Date()
        } else {
            current.banked += Date().timeIntervalSince(current.startedAt)
            current.pausedAt = Date()
        }
        state = current
    }

    func finish() {
        isPresented = false
        state = nil
    }
}
