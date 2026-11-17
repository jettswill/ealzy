import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Что показывает виджет: снимок плана дня в общей папке группы приложений.
/// Приложение пишет его после каждой загрузки дел, виджет только читает —
/// так виджету не нужно ходить в сеть, чтобы показать фокус.
struct WidgetSnapshot: Codable, Equatable {
    struct Item: Codable, Equatable, Identifiable {
        let id: String
        let title: String
        let meta: String?
    }

    var updatedAt: Date
    var headline: String
    var focus: [Item]
    var next: [Item]
    var quickCount: Int
    var reserveCount: Int
    var nextEvent: Item?

    static let appGroup = "group.ru.ealzy.app"
    private static let fileName = "widget-snapshot.json"

    static let placeholder = WidgetSnapshot(
        updatedAt: Date(),
        headline: "Один фокус. Сделаешь его — день уже удался.",
        focus: [Item(id: "p1", title: "Дописать смету по проекту", meta: "~1,5 ч")],
        next: [
            Item(id: "p2", title: "Оплатить интернет", meta: "~5 мин"),
            Item(id: "p3", title: "Ответить Оле про субботу", meta: nil),
        ],
        quickCount: 3,
        reserveCount: 14,
        nextEvent: Item(id: "e1", title: "Встреча с Петей", meta: "14:00")
    )

    private static var fileURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(fileName)
    }

    static func load() -> WidgetSnapshot? {
        let data = fileURL.flatMap { try? Data(contentsOf: $0) } ?? Keychain.readSnapshot()
        return data.flatMap { try? JSONCoding.decoder.decode(WidgetSnapshot.self, from: $0) }
    }

    /// Общая папка группы приложений, а без неё (бесплатная учётка Apple) — общая связка ключей.
    func save() {
        guard let data = try? JSONCoding.encoder.encode(self) else { return }
        if let url = Self.fileURL {
            try? data.write(to: url, options: .atomic)
        } else {
            Keychain.saveSnapshot(data)
        }
        Self.reloadWidgets()
    }

    static func make(plan: DayPlan, nextEvent: Item?) -> WidgetSnapshot {
        let next = (plan.overdue + plan.today + plan.quick).prefix(8).map {
            Item(id: $0.id, title: $0.title, meta: TaskMeta.text(for: $0))
        }
        return WidgetSnapshot(
            updatedAt: Date(),
            headline: plan.headline,
            focus: plan.focus.map { Item(id: $0.id, title: $0.title, meta: TaskMeta.text(for: $0)) },
            next: Array(next),
            quickCount: plan.quick.count,
            reserveCount: plan.reserve.count,
            nextEvent: nextEvent
        )
    }

    /// Дело закрыли из виджета или уведомления — убираем сразу, не дожидаясь приложения.
    static func markDone(_ id: String) {
        guard var snapshot = load() else { return }
        snapshot.focus.removeAll { $0.id == id }
        snapshot.next.removeAll { $0.id == id }
        snapshot.save()
    }

    static func clear() {
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        Keychain.deleteSnapshot()
        reloadWidgets()
    }

    static func reloadWidgets() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}

/// Подпись к делу: время, «завтра», оценка. Одна на приложение и виджет.
enum TaskMeta {
    static func text(for task: EalzyTask, calendar: Calendar = .current) -> String? {
        var parts: [String] = []
        if task.isMeeting { parts.append("встреча") }
        if let due = task.dueAt {
            let time = DueClock.isDateOnly(due, calendar: calendar)
                ? nil
                : due.formatted(date: .omitted, time: .shortened)
            if calendar.isDateInToday(due) {
                if let time { parts.append(time) }
            } else if calendar.isDateInTomorrow(due) {
                parts.append(["завтра", time].compactMap { $0 }.joined(separator: " "))
            } else if due < calendar.startOfDay(for: Date()) {
                parts.append("просрочено")
            } else {
                let day = due.formatted(.dateTime.day().month(.wide).locale(Locale(identifier: "ru_RU")))
                parts.append([day, time].compactMap { $0 }.joined(separator: " "))
            }
        }
        if let minutes = task.estimateMinutes {
            if minutes >= 60 {
                let rest = minutes % 60
                parts.append("~\(minutes / 60) ч" + (rest == 0 ? "" : " \(rest) мин"))
            } else {
                parts.append("~\(minutes) мин")
            }
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
