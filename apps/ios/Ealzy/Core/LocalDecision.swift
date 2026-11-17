import Foundation

/// Что решила модель на телефоне. Всё, в чём она не уверена, уходит в облако.
enum LocalDecision: Equatable {
    /// Записать одно дело. `due` — только если срок назван в тексте.
    case task(title: String, due: Date?)
    /// Короткий ответ на «спасибо», «ок», «привет».
    case chat(reply: String)
    /// Всё остальное: вопросы, советы, планы, поиск, правка дел.
    case cloud
}

/// Разбор ответа модели и проверки, которые не дают ей ошибиться молча.
enum LocalDecisionParser {
    /// Промпт: модель должна вернуть ровно один JSON-объект.
    static func instructions(now: Date, calendar: Calendar = .current) -> String {
        let day = DateFormatter()
        day.locale = Locale(identifier: "ru_RU")
        day.calendar = calendar
        day.timeZone = calendar.timeZone
        day.dateFormat = "yyyy-MM-dd, EEEE, HH:mm"
        return """
        Ты — быстрый разборщик сообщений для ассистента Илзи. Сейчас \(day.string(from: now)).
        Верни ровно один JSON-объект без пояснений и без markdown.

        1. Человек просит записать или напомнить ОДНО конкретное дело:
        {"kind":"task","title":"…","due":"YYYY-MM-DD" или "YYYY-MM-DDTHH:MM" или null}
        title — короткое понятное дело с глагола, с большой буквы, без «напомни», «добавь задачу», «запиши».
        due — только если срок прямо назван («завтра», «в пятницу в 10», «до конца декабря» = последний день декабря). Не назван — null. Не выдумывай.

        2. Сообщение — только благодарность, согласие или приветствие («спасибо», «ок», «привет»):
        {"kind":"chat","reply":"…"} — одна короткая тёплая фраза от Илзи, без вопросов.

        3. Всё остальное (вопрос, совет, план дня, поиск, подарок, поездка, несколько дел сразу, изменить или удалить дело, мысли вслух, сомнения):
        {"kind":"cloud"}

        Если сомневаешься — {"kind":"cloud"}.
        """
    }

    static func parse(_ raw: String, userText: String, now: Date, calendar: Calendar = .current) -> LocalDecision {
        guard let object = jsonObject(in: raw) else { return .cloud }
        switch object["kind"] as? String {
        case "task":
            guard let title = cleanTitle(object["title"] as? String) else { return .cloud }
            var due = (object["due"] as? String).flatMap { parseDue($0, calendar: calendar) }
            // Срок ставим, только если в самой фразе есть указание на время.
            if due != nil, !mentionsTime(userText) { due = nil }
            // Срок в прошлом — модель ошиблась; пусть решает облако.
            if let date = due, date < calendar.startOfDay(for: now) { return .cloud }
            return .task(title: title, due: due)
        case "chat":
            guard let reply = (object["reply"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
                !reply.isEmpty, reply.count <= 160, isSmallTalk(userText)
            else { return .cloud }
            return .chat(reply: reply)
        default:
            return .cloud
        }
    }

    // MARK: Детали

    /// Первый `{…}` в тексте: модели любят обёртки и рассуждения в <think>.
    static func jsonObject(in raw: String) -> [String: Any]? {
        var text = raw
        if let end = text.range(of: "</think>") { text = String(text[end.upperBound...]) }
        guard let start = text.firstIndex(of: "{"), let end = text.lastIndex(of: "}"), start < end else {
            return nil
        }
        let data = Data(text[start...end].utf8)
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func cleanTitle(_ raw: String?) -> String? {
        guard var title = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
            return nil
        }
        title = title.trimmingCharacters(in: CharacterSet(charactersIn: "«»\".:"))
        let lowered = title.lowercased()
        let junk = ["добавь задачу", "добавить задачу", "напомни", "запиши", "задача"]
        if junk.contains(lowered) { return nil }
        guard title.count <= 300 else { return nil }
        return title.prefix(1).uppercased() + title.dropFirst()
    }

    /// «2026-11-20» — только день (полдень, как на сервере), «2026-11-20T10:00» — со временем.
    static func parseDue(_ raw: String, calendar: Calendar) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        for format in ["yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm", "yyyy-MM-dd'T'HH:mm:ss"] {
            formatter.dateFormat = format
            if let date = formatter.date(from: value) { return date }
        }
        formatter.dateFormat = "yyyy-MM-dd"
        if let day = formatter.date(from: value) { return DueClock.dateOnly(day, calendar: calendar) }
        return nil
    }

    static func mentionsTime(_ text: String) -> Bool {
        let lowered = text.lowercased()
        if lowered.rangeOfCharacter(from: .decimalDigits) != nil { return true }
        let words = lowered.split(whereSeparator: { !$0.isLetter }).map(String.init)
        let exact: Set<String> = ["к", "до", "через", "днём", "днем", "ночью", "час"]
        let stems = [
            "сегодня", "завтра", "послезавтра", "утр", "вечер", "обед", "полдень",
            "понедельник", "вторник", "сред", "четверг", "пятниц", "суббот", "воскресень",
            "недел", "месяц", "выходн", "конц", "начал",
            "январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август",
            "сентябр", "октябр", "ноябр", "декабр",
        ]
        return words.contains { word in
            exact.contains(word) || stems.contains { stem in
                stem == "ма" ? (word == "мая" || word == "май") : word.hasPrefix(stem)
            }
        }
    }

    /// Короткую болтовню отвечаем сами, только если фраза действительно короткая.
    static func isSmallTalk(_ text: String) -> Bool {
        let words = text.split(whereSeparator: { $0.isWhitespace })
        return words.count <= 4 && !text.contains("?")
    }

    /// Ответ Илзи после записи: «Записала: Позвонить маме — завтра в 10:00».
    static func confirmation(title: String, due: Date?, now: Date, calendar: Calendar = .current) -> String {
        guard let due else { return "Записала: \(title)." }
        let time = DateFormatter()
        time.locale = Locale(identifier: "ru_RU")
        time.calendar = calendar
        time.timeZone = calendar.timeZone
        time.dateFormat = "HH:mm"
        let withClock = !DueClock.isDateOnly(due, calendar: calendar)
        let dayWord: String
        if calendar.isDate(due, inSameDayAs: now) {
            dayWord = "сегодня"
        } else if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now),
                  calendar.isDate(due, inSameDayAs: tomorrow) {
            dayWord = "завтра"
        } else {
            let day = DateFormatter()
            day.locale = Locale(identifier: "ru_RU")
            day.calendar = calendar
            day.timeZone = calendar.timeZone
            day.dateFormat = "EEEE, d MMMM"
            dayWord = "на " + day.string(from: due)
        }
        return "Записала: \(title) — \(dayWord)\(withClock ? " в \(time.string(from: due))" : "")."
    }
}
