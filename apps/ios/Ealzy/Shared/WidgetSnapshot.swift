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

    /// Идущий фокус: виджет повторяет то, что сейчас в приложении.
    struct FocusRun: Codable, Equatable {
        let taskId: String
        let title: String
        /// Когда выйдет время (если таймер идёт).
        var endsAt: Date?
        /// Сколько осталось, если на паузе.
        var pausedRemaining: TimeInterval?
    }

    var updatedAt: Date
    var headline: String
    var focus: [Item]
    var next: [Item]
    var quickCount: Int
    var reserveCount: Int
    var nextEvent: Item?
    var doneCount: Int = 0
    var focusRun: FocusRun?
    /// Что на завтра — показать, когда сегодня свободно или всё сделано.
    var tomorrow: [Item] = []
    var overdueCount: Int = 0

    init(updatedAt: Date, headline: String, focus: [Item], next: [Item], quickCount: Int, reserveCount: Int,
         nextEvent: Item?, doneCount: Int = 0, focusRun: FocusRun? = nil, tomorrow: [Item] = [], overdueCount: Int = 0) {
        self.updatedAt = updatedAt
        self.headline = headline
        self.focus = focus
        self.next = next
        self.quickCount = quickCount
        self.reserveCount = reserveCount
        self.nextEvent = nextEvent
        self.doneCount = doneCount
        self.focusRun = focusRun
        self.tomorrow = tomorrow
        self.overdueCount = overdueCount
    }

    /// Новые поля необязательны: снимок от старой версии приложения тоже читается.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        updatedAt = try c.decode(Date.self, forKey: .updatedAt)
        headline = try c.decode(String.self, forKey: .headline)
        focus = try c.decode([Item].self, forKey: .focus)
        next = try c.decode([Item].self, forKey: .next)
        quickCount = try c.decode(Int.self, forKey: .quickCount)
        reserveCount = try c.decode(Int.self, forKey: .reserveCount)
        nextEvent = try c.decodeIfPresent(Item.self, forKey: .nextEvent)
        doneCount = try c.decodeIfPresent(Int.self, forKey: .doneCount) ?? 0
        focusRun = try c.decodeIfPresent(FocusRun.self, forKey: .focusRun)
        tomorrow = try c.decodeIfPresent([Item].self, forKey: .tomorrow) ?? []
        overdueCount = try c.decodeIfPresent(Int.self, forKey: .overdueCount) ?? 0
    }

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
        let next = (plan.today + plan.quick).prefix(8).map {
            Item(id: $0.id, title: $0.title, meta: TaskMeta.text(for: $0))
        }
        return WidgetSnapshot(
            updatedAt: Date(),
            headline: plan.headline,
            focus: plan.focus.map { Item(id: $0.id, title: $0.title, meta: TaskMeta.text(for: $0)) },
            next: Array(next),
            quickCount: plan.quick.count,
            reserveCount: plan.reserve.count + plan.overdue.count,
            nextEvent: nextEvent,
            doneCount: plan.done.count,
            tomorrow: plan.reserve
                .filter { $0.dueAt.map(Calendar.current.isDateInTomorrow) ?? false }
                .prefix(3)
                .map { Item(id: $0.id, title: $0.title, meta: TaskMeta.text(for: $0)) },
            overdueCount: plan.overdue.count
        )
    }

    /// Фокус начали, поставили на паузу или закончили — виджет сразу показывает это же.
    static func setFocusRun(_ run: FocusRun?) {
        var snapshot = load() ?? WidgetSnapshot(
            updatedAt: Date(), headline: "", focus: [], next: [], quickCount: 0, reserveCount: 0, nextEvent: nil
        )
        guard snapshot.focusRun != run else { return }
        snapshot.focusRun = run
        snapshot.save()
    }

    /// Дело закрыли из виджета или уведомления — убираем сразу, не дожидаясь приложения.
    static func markDone(_ id: String) {
        guard var snapshot = load() else { return }
        if snapshot.focus.contains(where: { $0.id == id }) || snapshot.next.contains(where: { $0.id == id }) {
            snapshot.doneCount += 1
        }
        snapshot.focus.removeAll { $0.id == id }
        snapshot.next.removeAll { $0.id == id }
        if snapshot.focusRun?.taskId == id { snapshot.focusRun = nil }
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
        if let minutes = task.estimateMinutes, task.isOpen {
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
