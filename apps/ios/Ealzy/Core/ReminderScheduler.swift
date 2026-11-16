import Foundation
import UIKit
import UserNotifications

/// Точные напоминания: звенят ровно во время дела, даже без интернета.
/// Ставятся на устройстве по списку дел; кнопки сразу правят дело на сервере.
final class ReminderScheduler: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ReminderScheduler()

    static let category = "TASK_REMINDER"
    private enum Action {
        static let done = "TASK_DONE"
        static let snooze = "TASK_SNOOZE_15"
        static let evening = "TASK_EVENING"
        static let tomorrow = "TASK_TOMORROW"
    }
    private static let idPrefix = "task-"
    /// iOS хранит не больше 64 запланированных уведомлений на приложение.
    private static let limit = 60

    private let center = UNUserNotificationCenter.current()

    func configure() {
        center.delegate = self
        let actions = [
            UNNotificationAction(identifier: Action.done, title: "Готово"),
            UNNotificationAction(identifier: Action.snooze, title: "Через 15 минут"),
            UNNotificationAction(identifier: Action.evening, title: "Вечером"),
            UNNotificationAction(identifier: Action.tomorrow, title: "Завтра"),
        ]
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.category, actions: actions, intentIdentifiers: []),
        ])
    }

    @discardableResult
    func requestPermission() async -> Bool {
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        if granted {
            await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
        }
        return granted
    }

    func isAuthorized() async -> Bool {
        let settings = await center.notificationSettings()
        return settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    }

    /// Дела, которым нужен звонок: открытые, мои, со временем (не «только день»), в будущем.
    static func reminderTasks(_ tasks: [EalzyTask], now: Date = Date()) -> [EalzyTask] {
        tasks
            .filter { task in
                guard task.isOpen, !task.isForIlzi, let due = task.dueAt else { return false }
                return due > now && !DueClock.isDateOnly(due)
            }
            .sorted { ($0.dueAt ?? .distantFuture) < ($1.dueAt ?? .distantFuture) }
            .prefix(limit)
            .map { $0 }
    }

    func reschedule(for tasks: [EalzyTask]) async {
        let pending = await center.pendingNotificationRequests()
        let stale = pending.map(\.identifier).filter { $0.hasPrefix(Self.idPrefix) }
        center.removePendingNotificationRequests(withIdentifiers: stale)
        for task in Self.reminderTasks(tasks) {
            guard let due = task.dueAt else { continue }
            schedule(taskId: task.id, title: task.title, at: due)
        }
    }

    private func schedule(taskId: String, title: String, at date: Date) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = "Илзи напоминает"
        content.sound = .default
        content.categoryIdentifier = Self.category
        content.userInfo = ["task_id": taskId, "title": title]
        let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
        center.add(UNNotificationRequest(identifier: Self.idPrefix + taskId, content: content, trigger: trigger))
    }

    // MARK: UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        guard let taskId = info["task_id"] as? String else { return }
        let title = info["title"] as? String ?? "Дело"
        let calendar = Calendar.current
        let now = Date()
        // Ровно 12:00 сервер читает как «только день» — сдвигаем на минуту, чтобы звонок не пропал.
        func exact(_ date: Date) -> Date {
            DueClock.isDateOnly(date) ? date.addingTimeInterval(60) : date
        }
        switch response.actionIdentifier {
        case Action.done:
            await TaskActions.complete(id: taskId)
        case Action.snooze:
            let next = exact(now.addingTimeInterval(15 * 60))
            schedule(taskId: taskId, title: title, at: next)
            await TaskActions.snooze(id: taskId, until: next)
        case Action.evening:
            var next = calendar.date(bySettingHour: 19, minute: 0, second: 0, of: now) ?? now
            if next <= now { next = calendar.date(byAdding: .day, value: 1, to: next) ?? next }
            schedule(taskId: taskId, title: title, at: next)
            await TaskActions.snooze(id: taskId, until: next)
        case Action.tomorrow:
            let original = response.notification.date
            let next = exact(calendar.date(byAdding: .day, value: 1, to: original) ?? original)
            schedule(taskId: taskId, title: title, at: next)
            await TaskActions.snooze(id: taskId, until: next)
        default:
            break
        }
        await MainActor.run {
            NotificationCenter.default.post(name: .ealzyTasksChanged, object: nil)
        }
    }
}

extension Notification.Name {
    static let ealzyTasksChanged = Notification.Name("ealzyTasksChanged")
}
