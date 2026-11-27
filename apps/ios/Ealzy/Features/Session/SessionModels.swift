import Foundation

/// Сессия с Илзи (сервер: life-session.ts). Человек выгружает всё из головы,
/// Илзи раскладывает на дела, направления и мысли и выбирает одно «сейчас».
enum SessionMode: String, Codable, CaseIterable, Identifiable {
    case unload, strategy, talk

    var id: String { rawValue }

    var title: String {
        switch self {
        case .unload: return "Разгрузить голову"
        case .strategy: return "Стратегия"
        case .talk: return "Поговорить"
        }
    }

    var icon: String {
        switch self {
        case .unload: return "tray.and.arrow.down"
        case .strategy: return "scope"
        case .talk: return "bubble.left.and.bubble.right"
        }
    }

    /// Что сказать человеку перед записью.
    var prompt: String {
        switch self {
        case .unload:
            return "Говори всё, что крутится в голове: дела, обещания, мелочи, тревоги. В любом порядке — я разложу."
        case .strategy:
            return "Расскажи, куда хочешь прийти за полгода-год, что сейчас делаешь и что тормозит. Я сверю дела с целями."
        case .talk:
            return "Расскажи, что на душе. Можно сбивчиво — я слушаю и помогу найти один шаг."
        }
    }
}

enum SessionBucket: String, Codable, CaseIterable, Identifiable {
    case now, today, week, later, someday

    var id: String { rawValue }

    var title: String {
        switch self {
        case .now: return "Сейчас"
        case .today: return "Сегодня"
        case .week: return "На неделе"
        case .later: return "Потом"
        case .someday: return "Когда-нибудь"
        }
    }
}

struct SessionGoal: Codable, Hashable, Identifiable {
    let key: String
    let op: String
    let goalId: String?
    let title: String
    let horizon: String?
    let why: String?

    var id: String { key }
    var isNew: Bool { op == "create" }

    var horizonTitle: String? {
        switch horizon {
        case "short": return "до 3 месяцев"
        case "medium": return "на год"
        case "long": return "надолго"
        default: return nil
        }
    }
}

struct SessionTask: Codable, Hashable, Identifiable {
    let key: String
    var title: String
    let description: String?
    var bucket: SessionBucket
    let dueAt: Date?
    let estimateMinutes: Int?
    let sphere: String?
    let goalKey: String?
    let assignee: String?
    let existingTaskId: String?

    var id: String { key }
    var isForIlzi: Bool { assignee == "ealzy" }
    var isUpdate: Bool { existingTaskId != nil }

    enum CodingKeys: String, CodingKey {
        case key, title, description, bucket, dueAt, estimateMinutes, sphere, goalKey, assignee, existingTaskId
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        title = try c.decode(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        bucket = (try? c.decode(SessionBucket.self, forKey: .bucket)) ?? .later
        dueAt = try? c.decodeIfPresent(Date.self, forKey: .dueAt)
        estimateMinutes = try c.decodeIfPresent(Int.self, forKey: .estimateMinutes)
        sphere = try c.decodeIfPresent(String.self, forKey: .sphere)
        goalKey = try c.decodeIfPresent(String.self, forKey: .goalKey)
        assignee = try c.decodeIfPresent(String.self, forKey: .assignee)
        existingTaskId = try c.decodeIfPresent(String.self, forKey: .existingTaskId)
    }

    var sphereTitle: String? {
        switch sphere {
        case "work": return "работа"
        case "home": return "быт"
        case "health": return "здоровье"
        case "people": return "близкие"
        case "rest": return "отдых"
        case "growth": return "рост"
        case "money": return "деньги"
        default: return nil
        }
    }
}

struct SessionNow: Codable, Hashable {
    let taskKey: String?
    let reason: String?
    let firstStep: String?
}

struct SessionProposal: Codable, Hashable {
    let summary: String
    let reflection: String?
    let goals: [SessionGoal]
    var tasks: [SessionTask]
    let thoughts: [String]
    let now: SessionNow?
    let alignment: String?
    let questions: [String]
}

struct SessionResult: Codable, Hashable {
    let tasks: [EalzyTask]
    let goals: [Goal]
    let nowTaskId: String?
    let noteId: String?
}

struct LifeSessionDTO: Codable, Identifiable, Hashable {
    let id: String
    let mode: SessionMode
    let transcript: String
    let proposal: SessionProposal
    let summary: String?
    let result: SessionResult?
    let appliedAt: Date?
    let createdAt: Date?
}

/// Долгосрочное направление (цель) — `GET /goals`.
struct Goal: Codable, Hashable, Identifiable {
    struct Stats: Codable, Hashable {
        let taskCount: Int
        let doneCount: Int
        let openCount: Int
        let progress: Int
    }

    let id: String
    let title: String
    let description: String?
    let status: String
    let horizon: String?
    let currentPlan: String?
    let stats: Stats?

    var isActive: Bool { status == "active" }

    var horizonTitle: String? {
        switch horizon {
        case "short": return "до 3 месяцев"
        case "medium": return "на год"
        case "long": return "надолго"
        default: return nil
        }
    }
}

/// «Что сейчас?» — `POST /focus/now`.
struct FocusSuggestion: Codable, Hashable {
    let taskId: String?
    let title: String?
    let reason: String
    let firstStep: String?
    let minutes: Int?
}

struct ApplySessionBody: Encodable {
    struct Choice: Encodable {
        let key: String
        let title: String?
        let bucket: SessionBucket?
    }

    let tasks: [Choice]
    let goals: [String]
    let nowKey: String?
    let saveThoughts: Bool
}
