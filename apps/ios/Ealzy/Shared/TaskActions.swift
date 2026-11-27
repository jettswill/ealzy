import Foundation

struct TaskPatch: Encodable {
    var status: String?
    var dueAt: Date?
    /// Снять срок: на сервер уходит `due_at: null`.
    var clearDue = false

    enum CodingKeys: String, CodingKey { case status, dueAt }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(status, forKey: .status)
        if clearDue {
            try container.encodeNil(forKey: .dueAt)
        } else {
            try container.encodeIfPresent(dueAt, forKey: .dueAt)
        }
    }
}

struct NewTask: Encodable {
    var title: String
    var description: String?
    var dueAt: Date?
    /// Полная форма нового дела: всё ниже — по желанию.
    var estimateMinutes: Int?
    var importance: Int?
    var urgency: Int?
    var goalId: String?
    var assignee: String?
    var recurrenceFrequency: String?
}

/// Быстрые сроки для строки «Новое дело»: тап — сегодня/без срока, долгое нажатие — другой день.
enum QuickDue: CaseIterable {
    case today, tomorrow, afterTomorrow, saturday, nextMonday

    var title: String {
        switch self {
        case .today: return "Сегодня"
        case .tomorrow: return "Завтра"
        case .afterTomorrow: return "Послезавтра"
        case .saturday: return "В субботу"
        case .nextMonday: return "В понедельник"
        }
    }

    var icon: String {
        switch self {
        case .today: return "sun.max"
        case .tomorrow: return "sunrise"
        case .afterTomorrow: return "calendar"
        case .saturday: return "beach.umbrella"
        case .nextMonday: return "calendar.badge.clock"
        }
    }

    /// День без времени (полдень — как на сервере).
    func date(from now: Date = Date(), calendar: Calendar = .current) -> Date {
        let today = calendar.startOfDay(for: now)
        let day: Date
        switch self {
        case .today: day = today
        case .tomorrow: day = calendar.date(byAdding: .day, value: 1, to: today) ?? today
        case .afterTomorrow: day = calendar.date(byAdding: .day, value: 2, to: today) ?? today
        case .saturday, .nextMonday:
            let weekday = self == .saturday ? 7 : 2 // григорианский: 1 — воскресенье
            day = calendar.nextDate(after: today, matching: DateComponents(weekday: weekday),
                                    matchingPolicy: .nextTime) ?? today
        }
        return DueClock.dateOnly(day, calendar: calendar)
    }

    /// «Сегодня», «Завтра», «Пт, 5 дек.», «Пт, 5 дек., 18:00».
    static func label(for date: Date, calendar: Calendar = .current) -> String {
        let timed = !DueClock.isDateOnly(date, calendar: calendar)
        let time = timed ? ", " + date.formatted(date: .omitted, time: .shortened) : ""
        if calendar.isDateInToday(date) { return "Сегодня" + time }
        if calendar.isDateInTomorrow(date) { return "Завтра" + time }
        let day = date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)
            .locale(Locale(identifier: "ru_RU")))
        return day + time
    }
}

/// Заметка Ealzy: документ ProseMirror, как в редакторе на сайте.
struct NoteUpsert: Encodable {
    struct Node: Encodable {
        let type: String
        var text: String?
        var content: [Node]?
    }
    let baseRevision = 0
    let clientMutationId: String
    let title: String
    let content: Node
    let plainText: String

    init(title: String, text: String) {
        clientMutationId = UUID().uuidString.lowercased()
        self.title = String(title.prefix(300))
        plainText = text
        let paragraphs = text.components(separatedBy: "\n").map { line -> Node in
            line.isEmpty ? Node(type: "paragraph") : Node(type: "paragraph", content: [Node(type: "text", text: line)])
        }
        content = Node(type: "doc", content: paragraphs.isEmpty ? [Node(type: "paragraph")] : paragraphs)
    }
}

private struct SavedNote: Decodable {
    let id: String
}

/// Действия без стора: из уведомлений, виджета, Siri — приложение может быть не запущено.
enum TaskActions {
    static func complete(id: String) async {
        let _: EalzyTask? = try? await APIClient.shared.patch("/tasks/\(id)", body: TaskPatch(status: "done"))
        WidgetSnapshot.markDone(id)
    }

    static func snooze(id: String, until date: Date) async {
        let _: EalzyTask? = try? await APIClient.shared.patch("/tasks/\(id)", body: TaskPatch(dueAt: date))
    }

    /// Сохранить заметку в Ealzy (перенос из «Заметок» iPhone через «Поделиться» или Команды).
    @discardableResult
    static func saveNote(_ text: String, title: String? = nil) async throws -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let heading = title ?? trimmed.components(separatedBy: "\n").first ?? ""
        let note: SavedNote = try await APIClient.shared.put(
            "/notes/\(UUID().uuidString.lowercased())",
            body: NoteUpsert(title: heading, text: trimmed)
        )
        return note.id
    }

    /// Сказать Илзи — она сама поймёт, дело это, мысль или вопрос. Возвращает ответ.
    static func tellIlzi(_ text: String) async throws -> String {
        let reply: ChatMessage = try await APIClient.shared.post(
            "/companion/messages",
            body: ["content": text, "source_channel": "mini_app"]
        )
        return reply.content
    }
}
