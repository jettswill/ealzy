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
    }

    private(set) var state: State? {
        didSet {
            if let state, let data = try? JSONEncoder().encode(state) {
                UserDefaults.standard.set(data, forKey: Self.key)
            } else {
                UserDefaults.standard.removeObject(forKey: Self.key)
            }
        }
    }

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.key) {
            state = try? JSONDecoder().decode(State.self, from: data)
        }
    }

    var isRunning: Bool { state != nil }
    /// Экран фокуса открыт. Свернуть его — не значит остановить: таймер идёт дальше.
    var isPresented = false
    var isPaused: Bool { state?.pausedAt != nil }

    func start(_ task: EalzyTask, minutes: Int) {
        state = State(taskId: task.id, title: task.title, plannedMinutes: minutes, startedAt: Date())
        isPresented = true
    }

    func elapsed(at now: Date = Date()) -> TimeInterval {
        guard let state else { return 0 }
        if state.pausedAt != nil { return state.banked }
        return state.banked + now.timeIntervalSince(state.startedAt)
    }

    func remaining(at now: Date = Date()) -> TimeInterval {
        guard let state else { return 0 }
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
