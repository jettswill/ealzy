import Foundation

/// Даты с сервера приходят и как `2026-11-16T09:00:00.000Z` (JS), и как
/// `2026-11-16T09:00:00.123456+00:00` (Postgres). Дробную часть отбрасываем —
/// точность до секунды нам достаточна.
enum ISODates {
    private static let withoutFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func parse(_ raw: String) -> Date? {
        let trimmed = raw.replacingOccurrences(
            of: #"\.\d+"#, with: "", options: .regularExpression
        )
        return withoutFraction.date(from: trimmed)
    }

    /// Сервер (zod `datetime()`) принимает только UTC с `Z`.
    static func format(_ date: Date) -> String {
        withoutFraction.string(from: date)
    }
}

enum JSONCoding {
    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            guard let date = ISODates.parse(raw) else {
                throw DecodingError.dataCorruptedError(
                    in: container, debugDescription: "Unsupported date: \(raw)"
                )
            }
            return date
        }
        return decoder
    }()

    static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(ISODates.format(date))
        }
        return encoder
    }()
}
