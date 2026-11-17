import Foundation

/// Лимит облачной Илзи — как его считает сервер (`GET /billing/quota`).
struct CloudQuota: Decodable, Equatable {
    struct Period: Decodable, Equatable {
        let kind: String
        let limit: Int
        let used: Int
        let resetsAt: Date
    }
    struct Window: Decodable, Equatable {
        let hours: Int
        let limit: Int
        let used: Int
        let resetsAt: Date?
    }

    let plan: String
    let planTitle: String
    let planUntil: Date?
    let enforced: Bool
    let state: String
    let period: Period
    let window: Window
    let availableAt: Date?

    var isExhausted: Bool { enforced && state == "exhausted" }
    var isLow: Bool { enforced && state == "low" }
    var isFree: Bool { plan == "free" }

    /// Сколько процентов периода осталось.
    var periodLeftPercent: Int? {
        guard period.limit > 0 else { return nil }
        return max(0, min(100, Int((1 - Double(period.used) / Double(period.limit)) * 100)))
    }

    /// «до пятницы, 15:00» — когда облако вернётся.
    func returnText(now: Date = Date(), calendar: Calendar = .current) -> String? {
        guard let at = availableAt else { return nil }
        let time = DateFormatter()
        time.locale = Locale(identifier: "ru_RU")
        time.calendar = calendar
        time.timeZone = calendar.timeZone
        time.dateFormat = "HH:mm"
        if calendar.isDate(at, inSameDayAs: now) { return "до \(time.string(from: at))" }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(at, inSameDayAs: tomorrow) {
            return "до завтра, \(time.string(from: at))"
        }
        let day = DateFormatter()
        day.locale = Locale(identifier: "ru_RU")
        day.calendar = calendar
        day.timeZone = calendar.timeZone
        day.dateFormat = "d MMMM"
        return "до \(day.string(from: at)), \(time.string(from: at))"
    }

    var periodWord: String { period.kind == "week" ? "на неделю" : "на месяц" }
}

