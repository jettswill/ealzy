import Foundation

/// План дня вместо списка (research/focus-day-system.md):
/// 1 фокус (2 — только если горят сроки), мелочи, остальное на сегодня,
/// всё прочее — «в запасе N». Чистая функция, покрыта тестами.
struct DayPlan: Equatable {
    var focus: [EalzyTask] = []
    var overdue: [EalzyTask] = []
    var today: [EalzyTask] = []
    var quick: [EalzyTask] = []
    var forIlzi: [EalzyTask] = []
    var reserve: [EalzyTask] = []

    var isEmpty: Bool {
        focus.isEmpty && overdue.isEmpty && today.isEmpty && quick.isEmpty
    }

    /// Строка дня — одна фраза, которую прочитают гарантированно.
    var headline: String {
        switch (focus.count, reserve.count) {
        case (0, 0) where isEmpty: return "День свободен. Скажи Илзи, что висит в голове."
        case (0, _) where isEmpty: return "На сегодня ничего не горит. Можно взять что-то из запаса."
        case (2, _): return "Сегодня два фокуса — иначе не успеть по срокам."
        case (1, _): return "Один фокус. Сделаешь его — день уже удался."
        default: return "Крупного на сегодня нет — хороший день, чтобы разгрести мелочи."
        }
    }
}

enum DayPlanner {
    static func plan(_ tasks: [EalzyTask], now: Date = Date(), calendar: Calendar = .current) -> DayPlan {
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

        // Кандидаты в фокус: крупное (не мелочь, не встреча) со сроком сегодня/просрочено
        // или сильное «сделай сейчас» без оглядки на дату.
        let candidates = mine.filter { task in
            !task.isMeeting && !task.isQuick && (isToday(task) || isOverdue(task) || task.isPush)
        }
        func focusScore(_ task: EalzyTask) -> Int {
            var score = task.pushScore
            if isOverdue(task) { score += 5 }
            if isToday(task) { score += 3 }
            return score
        }
        let ranked = candidates.sorted {
            let (a, b) = (focusScore($0), focusScore($1))
            return a != b ? a > b : $0.title.localizedCompare($1.title) == .orderedAscending
        }
        if let first = ranked.first {
            plan.focus = [first]
            // Второй фокус — только если он тоже важный и горит сегодня.
            if ranked.count > 1 {
                let second = ranked[1]
                if (second.importance ?? 3) >= 4 && (isToday(second) || isOverdue(second)) {
                    plan.focus.append(second)
                }
            }
        }
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
