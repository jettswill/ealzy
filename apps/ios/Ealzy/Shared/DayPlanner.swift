import Foundation

/// План дня (research/focus-day-system.md): день собирает сам человек —
/// в него попадают только дела со сроком «сегодня». Из них — 1 главное
/// (2 — только если оба важные), остальное и мелочи; просроченное и всё прочее
/// живёт во «Всех делах». Чистая функция, покрыта тестами.
struct DayPlan: Equatable {
    var focus: [EalzyTask] = []
    var overdue: [EalzyTask] = []
    var today: [EalzyTask] = []
    var quick: [EalzyTask] = []
    var forIlzi: [EalzyTask] = []
    var reserve: [EalzyTask] = []
    /// Закрытые сегодня — чтобы было видно, что день сделан.
    var done: [EalzyTask] = []

    /// Открытые дела дня: главное, остальное, мелочи.
    var dayOpen: [EalzyTask] { focus + today + quick }

    var isEmpty: Bool { dayOpen.isEmpty }
    /// Всё, что было на сегодня, закрыто.
    var isDayDone: Bool { isEmpty && !done.isEmpty }

    /// Строка дня — одна фраза, которую прочитают гарантированно.
    var headline: String {
        if isDayDone { return "Всё на сегодня сделано. Ты молодец." }
        switch focus.count {
        case 0 where isEmpty: return "День пока пустой. Выбери, что сделаешь сегодня."
        case 2: return "Сегодня два главных — оба важные."
        case 1: return "Одно главное. Сделаешь его — день уже удался."
        default: return "Крупного на сегодня нет — хороший день, чтобы разгрести мелочи."
        }
    }
}

/// Ручной выбор фокуса на сегодня: закреплённое главное и убранные из фокуса дела.
struct FocusChoice: Codable, Equatable {
    var day: String
    var pinned: String?
    var skipped: [String] = []

    static func dayKey(_ date: Date = Date(), calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }
}

enum DayPlanner {
    static func plan(
        _ tasks: [EalzyTask], now: Date = Date(), calendar: Calendar = .current, choice: FocusChoice? = nil
    ) -> DayPlan {
        let choice = choice?.day == FocusChoice.dayKey(now, calendar: calendar) ? choice : nil
        let skipped = Set(choice?.skipped ?? [])
        let startOfToday = calendar.startOfDay(for: now)
        guard let startOfTomorrow = calendar.date(byAdding: .day, value: 1, to: startOfToday) else {
            return DayPlan()
        }
        var plan = DayPlan()
        let open = tasks.filter(\.isOpen)
        plan.forIlzi = open.filter(\.isForIlzi)
        let mine = open.filter { !$0.isForIlzi }

        func isOverdue(_ task: EalzyTask) -> Bool {
            guard let due = task.dueAt else { return false }
            return due < startOfToday
        }
        func isToday(_ task: EalzyTask) -> Bool {
            guard let due = task.dueAt else { return false }
            return due >= startOfToday && due < startOfTomorrow
        }

        // Кандидаты в главное — только из того, что человек сам поставил на сегодня:
        // крупное, не мелочь и не встреча.
        let candidates = mine.filter { task in
            !skipped.contains(task.id) && !task.isMeeting && !task.isQuick && isToday(task)
        }
        let ranked = candidates.sorted {
            let (a, b) = ($0.pushScore, $1.pushScore)
            return a != b ? a > b : $0.title.localizedCompare($1.title) == .orderedAscending
        }
        // Человек сам выбрал главное — оно и есть фокус, без второго.
        if let pinnedId = choice?.pinned, let pinned = mine.first(where: { $0.id == pinnedId && isToday($0) }) {
            plan.focus = [pinned]
        } else if let first = ranked.first {
            plan.focus = [first]
            // Второй фокус — только если он тоже важный и горит сегодня.
            if ranked.count > 1 {
                let second = ranked[1]
                if (second.importance ?? 3) >= 4 && (plan.focus[0].importance ?? 3) >= 4 {
                    plan.focus.append(second)
                }
            }
        }
        plan.done = tasks
            .filter { $0.status == "done" && !$0.isForIlzi }
            .filter { task in
                if let completed = task.completedAt { return completed >= startOfToday && completed < startOfTomorrow }
                return isToday(task)
            }
            .sorted { ($0.completedAt ?? .distantPast) < ($1.completedAt ?? .distantPast) }
        let focusIds = Set(plan.focus.map(\.id))
        let rest = mine.filter { !focusIds.contains($0.id) }

        plan.overdue = rest.filter(isOverdue).sorted(by: byDue)
        let todays = rest.filter(isToday)
        plan.quick = todays.filter { $0.isQuick && !$0.isMeeting }.sorted(by: byDue)
        let quickIds = Set(plan.quick.map(\.id))
        plan.today = todays.filter { !quickIds.contains($0.id) }.sorted(by: byDue)
        plan.reserve = rest
            .filter { !isOverdue($0) && !isToday($0) }
            .sorted { lhs, rhs in
                switch (lhs.dueAt, rhs.dueAt) {
                case let (l?, r?): return l < r
                case (.some, .none): return true
                case (.none, .some): return false
                case (.none, .none): return lhs.pushScore > rhs.pushScore
                }
            }
        return plan
    }

    private static func byDue(_ lhs: EalzyTask, _ rhs: EalzyTask) -> Bool {
        (lhs.dueAt ?? .distantFuture) < (rhs.dueAt ?? .distantFuture)
    }
}

/// Отрезок времени: встреча, тренировка, окно для фокуса.
struct TimeSpan: Equatable {
    let start: Date
    let end: Date
}

extension DayPlanner {
    /// Первое свободное окно не короче `minutes`: начиная с ближайшей четверти часа,
    /// между событиями календаря, не позже `dayEnd`. Это «окно для фокуса» на ленте дня.
    static func focusWindow(
        minutes: Int, busy: [TimeSpan], now: Date, dayEnd: Date, calendar: Calendar = .current
    ) -> TimeSpan? {
        let duration = TimeInterval(max(minutes, 15) * 60)
        var start = roundUp(now, toMinutes: 15, calendar: calendar)
        for span in busy.sorted(by: { $0.start < $1.start }) where span.end > start {
            if span.start >= start.addingTimeInterval(duration) { break }
            start = max(start, span.end)
        }
        let end = start.addingTimeInterval(duration)
        return end <= dayEnd ? TimeSpan(start: start, end: end) : nil
    }

    /// Ближайшее событие, которое ещё не началось.
    static func nextBusy(after now: Date, busy: [TimeSpan]) -> TimeSpan? {
        busy.filter { $0.start > now }.min { $0.start < $1.start }
    }

    static func roundUp(_ date: Date, toMinutes step: Int, calendar: Calendar = .current) -> Date {
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let minute = parts.minute ?? 0
        let rounded = Int((Double(minute) / Double(step)).rounded(.up)) * step
        var base = parts
        base.minute = 0
        let hourStart = calendar.date(from: base) ?? date
        return hourStart.addingTimeInterval(TimeInterval(rounded * 60))
    }
}
