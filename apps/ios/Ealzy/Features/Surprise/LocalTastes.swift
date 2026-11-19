import Foundation

/// Запрос и разбор ответа маленькой модели на телефоне. Она знает названия,
/// а не id, — сервер сам сводит названия к справочнику.
enum LocalTastes {
    static func instructions(catalog: String) -> String {
        """
        Ты подбираешь досуг одному человеку для колеса «куда сходить»: что ему скорее понравится — чаще, что вряд ли — реже.
        Опирайся только на факты о нём, ничего не выдумывай. Прямой факт («любит волейбол») — сила до 0.6, догадка по характеру — до 0.3.
        Называй занятия и категории ТОЧНО как в справочнике ниже (строка «Категория: занятие; занятие; …»).
        Ответь ТОЛЬКО JSON, без пояснений:
        {"summary":"1–2 фразы на «ты» о том, какой отдых ему подходит","hypotheses":[{"name":"название из справочника","kind":"type или category","affinity":число от -1 до 1,"reason":"коротко, на «ты»"}]}
        Не больше 15 гипотез; если фактов мало — меньше.
        Справочник:
        \(catalog)
        """
    }

    struct Parsed {
        let summary: String?
        let hypotheses: [LocalTasteHypothesis]
    }

    /// Терпимо к ```json, словам до и после и числам строкой.
    static func parse(_ raw: String) -> Parsed? {
        guard let start = raw.firstIndex(of: "{"), let end = raw.lastIndex(of: "}"), start < end,
              let data = String(raw[start...end]).data(using: .utf8),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return nil }
        let summary = (object["summary"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let items = object["hypotheses"] as? [[String: Any]] ?? []
        var seen = Set<String>()
        var hypotheses: [LocalTasteHypothesis] = []
        for item in items {
            guard let name = (item["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !name.isEmpty, name.count <= 120 else { continue }
            let number: Double?
            if let value = item["affinity"] as? Double { number = value }
            else if let value = item["affinity"] as? String { number = Double(value.replacingOccurrences(of: ",", with: ".")) }
            else { number = nil }
            guard let affinity = number, affinity.isFinite else { continue }
            let key = name.lowercased()
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            let kind = (item["kind"] as? String).flatMap { $0 == "category" || $0 == "type" ? $0 : nil }
            let reason = (item["reason"] as? String).map { String($0.prefix(300)) }
            hypotheses.append(LocalTasteHypothesis(
                name: name, kind: kind, affinity: min(1, max(-1, affinity)), reason: reason
            ))
            if hypotheses.count >= 25 { break }
        }
        return Parsed(summary: summary.map { String($0.prefix(600)) }, hypotheses: hypotheses)
    }
}
