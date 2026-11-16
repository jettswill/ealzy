import Foundation

/// Сервер отвечает `{ "data": ... }`.
struct Envelope<T: Decodable>: Decodable {
    let data: T
}

struct ServerErrorBody: Decodable {
    struct Detail: Decodable {
        let code: String?
        let message: String?
    }
    let error: Detail
}

struct EalzyTask: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var description: String?
    var status: String
    var dueAt: Date?
    var estimateMinutes: Int?
    var importance: Int?
    var urgency: Int?
    var kind: String?
    var assignee: String?
    var completedAt: Date?
    var createdAt: Date?

    var isOpen: Bool { status == "todo" || status == "in_progress" }
    var isMeeting: Bool { kind == "meeting" }
    var isForIlzi: Bool { assignee == "ealzy" }
    /// Сильное «сделай сейчас» — как `isPushTask` на сервере.
    var isPush: Bool { (importance ?? 3) >= 4 && (urgency ?? 3) >= 4 }
    var pushScore: Int { (importance ?? 3) * 10 + (urgency ?? 3) }
    var isQuick: Bool { (estimateMinutes ?? Int.max) <= 15 }
}

struct ChatMessage: Codable, Identifiable, Hashable {
    let id: String
    let role: String
    let content: String
    let createdAt: Date?

    var isUser: Bool { role == "user" }
}

struct Conversation: Codable {
    let id: String
}

struct SessionPayload: Decodable {
    let token: String
    let expiresAt: Date?
}

struct AppLoginStart: Decodable {
    let nonce: String
    let telegramUrl: String?
    let telegramAppUrl: String?
    let expiresIn: Int
}

struct AppLoginPoll: Decodable {
    let status: String
    let token: String?
}

/// Как сервер хранит «только день, без времени»: полдень по местному времени
/// (`DATE_ONLY_CLOCK` в companion-workspace.ts). Такие дела не звенят в минуту.
enum DueClock {
    static func isDateOnly(_ date: Date, calendar: Calendar = .current) -> Bool {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return parts.hour == 12 && parts.minute == 0
    }

    static func dateOnly(_ day: Date, calendar: Calendar = .current) -> Date {
        calendar.date(bySettingHour: 12, minute: 0, second: 0, of: day) ?? day
    }
}
