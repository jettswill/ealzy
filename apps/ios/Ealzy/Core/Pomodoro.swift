import Foundation
import UserNotifications

/// Помодоро: работа и перерыв по кругу, пока дело не готово.
/// Фаза — чистая функция отработанного времени, поэтому переживает закрытие приложения и паузы.
struct Pomodoro: Codable, Equatable {
    var workMinutes: Int
    var breakMinutes: Int

    struct Phase: Equatable {
        let isBreak: Bool
        /// Номер помидора, с 1.
        let round: Int
        /// Сколько осталось до конца фазы.
        let remaining: TimeInterval
        /// Длина фазы целиком.
        let length: TimeInterval
    }

    func phase(elapsed: TimeInterval) -> Phase {
        let work = TimeInterval(workMinutes * 60)
        let rest = TimeInterval(breakMinutes * 60)
        let cycle = max(work + rest, 1)
        let position = max(elapsed, 0).truncatingRemainder(dividingBy: cycle)
        let round = Int(max(elapsed, 0) / cycle) + 1
        return position < work
            ? Phase(isBreak: false, round: round, remaining: work - position, length: work)
            : Phase(isBreak: true, round: round, remaining: cycle - position, length: rest)
    }

    /// Сколько помидоров на дело с такой оценкой.
    func rounds(forEstimate minutes: Int?) -> Int? {
        guard let minutes, minutes > 0 else { return nil }
        return max(1, Int((Double(minutes) / Double(workMinutes)).rounded(.up)))
    }

    // MARK: Настройки

    static let enabledKey = "pomodoroEnabled"
    static let formatKey = "pomodoroFormat"

    /// Готовые форматы «работа/перерыв» — выбор в «Ещё».
    static let formats: [Pomodoro] = [
        Pomodoro(workMinutes: 25, breakMinutes: 5),
        Pomodoro(workMinutes: 30, breakMinutes: 10),
        Pomodoro(workMinutes: 45, breakMinutes: 15),
        Pomodoro(workMinutes: 50, breakMinutes: 10),
    ]

    var key: String { "\(workMinutes)/\(breakMinutes)" }

    static func from(key: String) -> Pomodoro {
        formats.first { $0.key == key } ?? formats[1]
    }

    /// Помодоро включён в настройках — какой формат; выключен — nil.
    static var current: Pomodoro? {
        let defaults = UserDefaults.standard
        guard defaults.bool(forKey: enabledKey) else { return nil }
        return from(key: defaults.string(forKey: formatKey) ?? formats[1].key)
    }
}

/// Уведомления о смене фазы: «Перерыв 10 минут», «Снова в работу». Приложение может быть закрыто.
enum PomodoroAlerts {
    private static let prefix = "pomodoro-"

    static func schedule(_ pomodoro: Pomodoro, title: String, elapsed: TimeInterval) {
        cancel()
        let center = UNUserNotificationCenter.current()
        var offset: TimeInterval = 0
        var phase = pomodoro.phase(elapsed: elapsed)
        // Ближайшие восемь смен фазы — это 4 помидора, дальше человек всё равно откроет приложение.
        for index in 0..<8 {
            offset += phase.remaining
            let next = pomodoro.phase(elapsed: elapsed + offset + 1)
            let content = UNMutableNotificationContent()
            content.title = next.isBreak ? "Перерыв \(pomodoro.breakMinutes) мин" : "Снова в работу · помидор \(next.round)"
            content.body = next.isBreak ? "Встань, разомнись, отойди от экрана." : title
            content.sound = .default
            content.interruptionLevel = .timeSensitive
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(offset, 1), repeats: false)
            center.add(UNNotificationRequest(identifier: "\(prefix)\(index)", content: content, trigger: trigger))
            phase = Pomodoro.Phase(isBreak: next.isBreak, round: next.round, remaining: next.length, length: next.length)
        }
    }

    static func cancel() {
        UNUserNotificationCenter.current()
            .removePendingNotificationRequests(withIdentifiers: (0..<8).map { "\(prefix)\($0)" })
    }
}
