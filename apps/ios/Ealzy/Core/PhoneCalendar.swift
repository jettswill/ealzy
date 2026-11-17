import EventKit
import Foundation
import Observation

private struct CalendarUpload: Encodable {
    struct Event: Encodable {
        let externalId: String
        let title: String
        let startsAt: Date
        let endsAt: Date
        let allDay: Bool
        let location: String?
        let calendarTitle: String?
    }
    let source = "ios"
    let from: Date
    let to: Date
    let events: [Event]
}

private struct CalendarUploadResult: Decodable {
    let stored: Int
}

/// Все календари телефона (iCloud, Google, рабочий) и Напоминания iPhone через EventKit.
@MainActor
@Observable
final class PhoneCalendar {
    static let syncEnabledKey = "calendarSyncEnabled"
    private static let importedRemindersKey = "importedReminderIds"

    private let store = EKEventStore()
    private(set) var todayEvents: [EKEvent] = []
    private(set) var tomorrowEvents: [EKEvent] = []
    private(set) var lastSync: Date?
    var errorMessage: String?

    var isSyncEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: Self.syncEnabledKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.syncEnabledKey) }
    }

    var hasCalendarAccess: Bool { EKEventStore.authorizationStatus(for: .event) == .fullAccess }
    var hasRemindersAccess: Bool { EKEventStore.authorizationStatus(for: .reminder) == .fullAccess }

    // MARK: Календарь

    func enableSync() async {
        do {
            guard try await store.requestFullAccessToEvents() else {
                errorMessage = "Нет доступа к календарю. Разреши его в Настройках → Ealzy."
                isSyncEnabled = false
                return
            }
            isSyncEnabled = true
            errorMessage = nil
            await sync()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func disableSync() async {
        isSyncEnabled = false
        todayEvents = []
        // Чистим копию на сервере: пустое окно заменяет всё.
        let now = Date()
        let upload = CalendarUpload(from: now.addingTimeInterval(-86_400), to: now.addingTimeInterval(8 * 86_400), events: [])
        let _: CalendarUploadResult? = try? await APIClient.shared.put("/calendar/events", body: upload)
    }

    /// Сегодня + 7 дней: на экран «Сегодня» и Илзи на сервер.
    func sync() async {
        if DemoData.isOn {
            todayEvents = DemoData.events(store: store)
            tomorrowEvents = DemoData.tomorrowEvents(store: store)
            return
        }
        guard isSyncEnabled, hasCalendarAccess else { return }
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        guard let end = calendar.date(byAdding: .day, value: 8, to: start),
              let endOfToday = calendar.date(byAdding: .day, value: 1, to: start) else { return }
        store.refreshSourcesIfNecessary()
        let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil))
            .filter { $0.status != .canceled }
            .sorted { $0.startDate < $1.startDate }
        todayEvents = events.filter { $0.startDate < endOfToday && $0.endDate > start }
        let endOfTomorrow = calendar.date(byAdding: .day, value: 1, to: endOfToday) ?? endOfToday
        tomorrowEvents = events.filter { $0.startDate < endOfTomorrow && $0.endDate > endOfToday }
        let upload = CalendarUpload(
            from: start,
            to: end,
            events: events.prefix(500).map { event in
                CalendarUpload.Event(
                    externalId: event.calendarItemIdentifier,
                    title: String((event.title?.isEmpty == false ? event.title! : "Событие").prefix(300)),
                    startsAt: event.startDate,
                    endsAt: max(event.endDate, event.startDate.addingTimeInterval(60)),
                    allDay: event.isAllDay,
                    location: event.location.map { String($0.prefix(300)) },
                    calendarTitle: event.calendar.map { String($0.title.prefix(120)) }
                )
            }
        )
        do {
            let _: CalendarUploadResult = try await APIClient.shared.put("/calendar/events", body: upload)
            lastSync = Date()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Календарь для виджета: ближайшее, что ещё будет сегодня, и завтрашний день.
    var widgetCalendar: WidgetCalendar {
        let now = Date()
        func item(_ event: EKEvent) -> WidgetSnapshot.Item {
            WidgetSnapshot.Item(
                id: event.calendarItemIdentifier,
                title: event.title ?? "Событие",
                meta: event.isAllDay ? "весь день" : event.startDate.formatted(date: .omitted, time: .shortened)
            )
        }
        return WidgetCalendar(
            next: nextEventItem,
            laterToday: todayEvents.filter { !$0.isAllDay && $0.endDate > now }.prefix(4).map(item),
            tomorrow: tomorrowEvents.prefix(6).map(item)
        )
    }

    /// Ближайшее событие сегодня — для виджета.
    var nextEventItem: WidgetSnapshot.Item? {
        let now = Date()
        guard let event = todayEvents.first(where: { $0.endDate > now && !$0.isAllDay }) else { return nil }
        return WidgetSnapshot.Item(
            id: event.calendarItemIdentifier,
            title: event.title ?? "Событие",
            meta: event.startDate.formatted(date: .omitted, time: .shortened)
        )
    }

    /// Поставить дело в календарь телефона — чтобы оно было видно на iPhone и компьютере.
    func addToCalendar(_ task: EalzyTask) async -> Bool {
        do {
            var granted = hasCalendarAccess
            if !granted { granted = try await store.requestFullAccessToEvents() }
            guard granted else {
                errorMessage = "Нет доступа к календарю."
                return false
            }
            guard let due = task.dueAt, let target = store.defaultCalendarForNewEvents else { return false }
            let event = EKEvent(eventStore: store)
            event.title = task.title
            event.notes = [task.description, "Из Ealzy"].compactMap { $0 }.joined(separator: "\n\n")
            event.calendar = target
            if DueClock.isDateOnly(due) {
                event.isAllDay = true
                event.startDate = Calendar.current.startOfDay(for: due)
                event.endDate = event.startDate
            } else {
                event.startDate = due
                event.endDate = due.addingTimeInterval(TimeInterval((task.estimateMinutes ?? 30) * 60))
            }
            try store.save(event, span: .thisEvent)
            await sync()
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    // MARK: Напоминания iPhone

    struct ReminderItem: Identifiable, Hashable {
        let id: String
        let title: String
        let notes: String?
        let due: Date?
        let hasTime: Bool
        let list: String
    }

    func loadReminders() async -> [ReminderItem] {
        do {
            guard try await store.requestFullAccessToReminders() else {
                errorMessage = "Нет доступа к Напоминаниям. Разреши его в Настройках → Ealzy."
                return []
            }
        } catch {
            errorMessage = error.localizedDescription
            return []
        }
        let imported = Set(UserDefaults.standard.stringArray(forKey: Self.importedRemindersKey) ?? [])
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        let reminders: [EKReminder] = await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { continuation.resume(returning: $0 ?? []) }
        }
        return reminders
            .filter { !imported.contains($0.calendarItemIdentifier) }
            .map { reminder in
                let parts = reminder.dueDateComponents
                let hasTime = parts?.hour != nil
                return ReminderItem(
                    id: reminder.calendarItemIdentifier,
                    title: reminder.title?.isEmpty == false ? reminder.title! : "Без названия",
                    notes: reminder.notes,
                    due: parts.flatMap { Calendar.current.date(from: $0) },
                    hasTime: hasTime,
                    list: reminder.calendar?.title ?? ""
                )
            }
            .sorted { ($0.due ?? .distantFuture) < ($1.due ?? .distantFuture) }
    }

    /// Переносит выбранные напоминания в Ealzy. Возвращает, сколько перенесено.
    func importReminders(_ items: [ReminderItem], completeInReminders: Bool) async -> Int {
        var done = 0
        var imported = UserDefaults.standard.stringArray(forKey: Self.importedRemindersKey) ?? []
        for item in items {
            let due = item.due.map { item.hasTime ? Self.avoidNoon($0) : DueClock.dateOnly($0) }
            let task = NewTask(title: String(item.title.prefix(300)), description: item.notes.map { String($0.prefix(4000)) }, dueAt: due)
            let created: EalzyTask? = try? await APIClient.shared.post("/tasks", body: task)
            guard created != nil else { continue }
            done += 1
            imported.append(item.id)
            if completeInReminders,
               let reminder = store.calendarItem(withIdentifier: item.id) as? EKReminder {
                reminder.isCompleted = true
                try? store.save(reminder, commit: false)
            }
        }
        if completeInReminders { try? store.commit() }
        UserDefaults.standard.set(imported, forKey: Self.importedRemindersKey)
        return done
    }

    /// Ровно 12:00 сервер читает как «только день» — сдвигаем на минуту, чтобы напоминание звенело.
    private static func avoidNoon(_ date: Date) -> Date {
        DueClock.isDateOnly(date) ? date.addingTimeInterval(60) : date
    }
}
