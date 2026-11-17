#if canImport(ActivityKit)
import ActivityKit
import Foundation

/// Живая активность фокуса: Dynamic Island и экран блокировки.
/// Описание общее для приложения (запускает) и виджета (рисует).
struct FocusActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// Когда выйдет время, если таймер идёт.
        var endsAt: Date?
        /// Сколько осталось, если на паузе.
        var pausedRemaining: TimeInterval?
    }

    var taskId: String
    var title: String
    var plannedMinutes: Int
}
#endif
