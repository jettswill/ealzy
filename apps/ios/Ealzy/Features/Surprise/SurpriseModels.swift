import Foundation

// Колесо «Удиви меня», места и вкусы — те же данные, что на сайте
// (`/api/activities/wheel`, `/api/places/*`, `/api/activities/tastes`).
// Ключи с сервера — snake_case, декодер сам переводит их в camelCase.

enum WheelMood: String, Codable, CaseIterable, Identifiable {
    case calm, active, any
    var id: String { rawValue }
    var title: String {
        switch self {
        case .calm: return "Спокойное"
        case .active: return "Активное"
        case .any: return "Всё равно"
        }
    }
}

enum WheelWhen: String, Codable, CaseIterable, Identifiable {
    case now, today, weekend
    var id: String { rawValue }
    var title: String {
        switch self {
        case .now: return "Сейчас"
        case .today: return "Сегодня"
        case .weekend: return "Выходные"
        }
    }
}

enum WheelCompany: String, Codable, CaseIterable, Identifiable {
    case solo, pair, friends, kids
    var id: String { rawValue }
    var title: String {
        switch self {
        case .solo: return "Один"
        case .pair: return "Вдвоём"
        case .friends: return "С друзьями"
        case .kids: return "С детьми"
        }
    }
}

/// Где искать: точка (геолокация или выбранная на карте) и радиус.
struct WheelArea: Codable, Hashable {
    var lat: Double
    var lon: Double
    var radiusM: Int
    /// Что человек назвал сам: «Петроградка», «м. Чкаловская». nil — точка на карте или «я».
    var label: String?
}

struct WheelRequest: Encodable {
    var mood: WheelMood
    var want: String?
    var when: WheelWhen
    var company: WheelCompany
    var city: String?
    var onlyNew: Bool
    var feedback: String?
    var area: WheelArea?
}

struct WheelStatus: Decodable {
    let spinsUsed: Int
    /// nil — без ограничения.
    let spinsLeft: Int?
    let spinsLimit: Int
    /// Свой город человека из базы.
    var city: String? = nil
    /// Догадка по часовому поясу, пока своего нет.
    var cityGuess: String? = nil
}

/// Город из справочника городов России.
struct CitySuggestion: Decodable, Identifiable, Hashable {
    let name: String
    /// Как храним: у одноимённых — с регионом («Кировск, Ленинградская область»).
    let title: String
    let region: String?
    let lat: Double
    let lon: Double
    var id: String { title }
}

private struct CityBody: Encodable { let city: String }
struct CityPayload: Decodable { let city: String }

struct WheelSegment: Decodable, Identifiable, Hashable {
    let id: String
    let weight: Double
    let liked: Bool?
    let name: String
    let emoji: String?
    let category: String
}

struct ActivityTypeInfo: Decodable, Hashable {
    let id: String
    let name: String
    let emoji: String?
    let description: String?
}

struct WheelPlaceInfo: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let city: String?
    let address: String?
    let distanceM: Double?
    let yandexUrl: String?
    let yandexRating: Double?
    let yandexReviews: Int?
}

struct WheelWinner: Decodable, Hashable {
    struct Category: Decodable, Hashable {
        let name: String
        let emoji: String?
    }
    let type: ActivityTypeInfo
    let category: Category?
    let places: [WheelPlaceInfo]
    let mapsUrl: String
    let reason: String?
    let verdict: String?
}

struct WheelSpin: Decodable {
    let spinId: String
    let segments: [WheelSegment]
    let winnerIndex: Int
    let winner: WheelWinner
    let spinsUsed: Int
    let spinsLeft: Int?
    let spinsLimit: Int
}

enum PlaceEmotion: String, Codable, CaseIterable, Identifiable {
    case wow, good, meh, bad
    var id: String { rawValue }
    var title: String {
        switch self {
        case .wow: return "🤩 Восторг"
        case .good: return "🙂 Хорошо"
        case .meh: return "😐 Так себе"
        case .bad: return "🙁 Не моё"
        }
    }
}

enum PlaceVisitStatus: String, Codable {
    case visited, want, skip
}

/// Место из поиска рядом — в базе Ealzy его ещё нет. Сохраняем как пришло,
/// поэтому при отправке пустые поля уходят явным null (сервер этого ждёт).
struct PlaceCandidate: Codable, Identifiable, Hashable {
    let source: String
    let sourceId: String
    let name: String
    let address: String?
    let city: String?
    let lat: Double?
    let lon: Double?
    let rating: Double?
    let ratingCount: Int?
    let imageUrl: String?
    let photos: [String]
    let phone: String?
    let website: String?
    let hours: String?
    let twogisUrl: String?
    let distanceM: Double?
    let mapsUrl: String
    let note: String?

    var id: String { "\(source):\(sourceId)" }
    var isFromWeb: Bool { source == "web" }

    enum CodingKeys: String, CodingKey {
        case source, sourceId, name, address, city, lat, lon, rating, ratingCount, imageUrl, photos
        case phone, website, hours, twogisUrl, distanceM, mapsUrl, note
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        source = try c.decode(String.self, forKey: .source)
        sourceId = try c.decode(String.self, forKey: .sourceId)
        name = try c.decode(String.self, forKey: .name)
        address = try c.decodeIfPresent(String.self, forKey: .address)
        city = try c.decodeIfPresent(String.self, forKey: .city)
        lat = try c.decodeIfPresent(Double.self, forKey: .lat)
        lon = try c.decodeIfPresent(Double.self, forKey: .lon)
        rating = try c.decodeIfPresent(Double.self, forKey: .rating)
        ratingCount = try c.decodeIfPresent(Int.self, forKey: .ratingCount)
        imageUrl = try c.decodeIfPresent(String.self, forKey: .imageUrl)
        photos = try c.decodeIfPresent([String].self, forKey: .photos) ?? []
        phone = try c.decodeIfPresent(String.self, forKey: .phone)
        website = try c.decodeIfPresent(String.self, forKey: .website)
        hours = try c.decodeIfPresent(String.self, forKey: .hours)
        twogisUrl = try c.decodeIfPresent(String.self, forKey: .twogisUrl)
        distanceM = try c.decodeIfPresent(Double.self, forKey: .distanceM)
        mapsUrl = try c.decode(String.self, forKey: .mapsUrl)
        note = try c.decodeIfPresent(String.self, forKey: .note)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        // `encode(Optional)` пишет null, а не пропускает ключ.
        try c.encode(source, forKey: .source)
        try c.encode(sourceId, forKey: .sourceId)
        try c.encode(name, forKey: .name)
        try c.encode(address, forKey: .address)
        try c.encode(city, forKey: .city)
        try c.encode(lat, forKey: .lat)
        try c.encode(lon, forKey: .lon)
        try c.encode(rating, forKey: .rating)
        try c.encode(ratingCount, forKey: .ratingCount)
        try c.encode(imageUrl, forKey: .imageUrl)
        try c.encode(photos, forKey: .photos)
        try c.encode(phone, forKey: .phone)
        try c.encode(website, forKey: .website)
        try c.encode(hours, forKey: .hours)
        try c.encode(twogisUrl, forKey: .twogisUrl)
        try c.encode(distanceM, forKey: .distanceM)
        try c.encode(mapsUrl, forKey: .mapsUrl)
        try c.encode(note, forKey: .note)
    }
}

/// Место, уже известное Ealzy (с ним кто-то что-то делал).
struct SavedPlace: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let city: String?
    let address: String?
    let distanceM: Double?
    let yandexUrl: String?
    let yandexRating: Double?
    let yandexReviews: Int?
    let rating: Double?
    let ratingCount: Int?
    let myStatus: PlaceVisitStatus?
}

struct NearbyPlaces: Decodable {
    let city: String
    let saved: [SavedPlace]
    let found: [PlaceCandidate]
    let source: String
    let web: Bool?
}

struct GeoArea: Decodable {
    let lat: Double
    let lon: Double
    let label: String
}

/// Оценка места: хочу сходить или был — с впечатлением, звёздами и заметкой.
struct VisitFields: Encodable {
    var activityTypeId: String
    var status: PlaceVisitStatus
    var rating: Int?
    var emotion: PlaceEmotion?
    var note: String?
}

private struct VisitBody: Encodable {
    let placeId: String
    let fields: VisitFields

    enum CodingKeys: String, CodingKey { case placeId }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(placeId, forKey: .placeId)
        try fields.encode(to: encoder)
    }
}

private struct SaveBody: Encodable {
    let candidate: PlaceCandidate
    let fields: VisitFields

    enum CodingKeys: String, CodingKey { case candidate }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(candidate, forKey: .candidate)
        try fields.encode(to: encoder)
    }
}

struct TasteItem: Decodable, Identifiable, Hashable {
    let targetKind: String
    let targetId: String
    let name: String
    let emoji: String?
    let verdict: String?
    let score: Double
    let reason: String?
    let source: String

    var id: String { "\(targetKind):\(targetId)" }
}

struct Tastes: Decodable {
    let summary: String?
    let refreshedAt: Date?
    let aiAvailable: Bool
    let items: [TasteItem]
}

private struct TasteVerdictBody: Encodable {
    let targetKind: String
    let targetId: String
    let verdict: String?

    enum CodingKeys: String, CodingKey { case targetKind, targetId, verdict }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(targetKind, forKey: .targetKind)
        try c.encode(targetId, forKey: .targetId)
        try c.encode(verdict, forKey: .verdict) // null — снять отметку
    }
}

/// Что Илзи знает о человеке и справочник названиями — для модели на iPhone.
struct TasteEvidencePayload: Decodable {
    let facts: String
    let catalog: String
}

struct LocalTasteHypothesis: Encodable {
    let name: String
    let kind: String?
    let affinity: Double
    let reason: String?
}

private struct LocalTastesBody: Encodable {
    let summary: String?
    let hypotheses: [LocalTasteHypothesis]
}

/// Ответ, содержимое которого не нужно.
struct IgnoredPayload: Decodable {
    init(from decoder: Decoder) throws {}
}

/// Запросы колеса, мест и вкусов.
enum SurpriseAPI {
    static var api: APIClient { .shared }

    static func status() async throws -> WheelStatus {
        try await api.get("/activities/wheel")
    }

    static func spin(_ request: WheelRequest) async throws -> WheelSpin {
        try await api.post("/activities/wheel", body: request)
    }

    static func nearby(type: String, area: WheelArea?, city: String?) async throws -> NearbyPlaces {
        var query = ["type": type]
        if let area {
            query["lat"] = String(area.lat)
            query["lon"] = String(area.lon)
            query["radius"] = String(area.radiusM)
            if let label = area.label, !label.isEmpty { query["near"] = label }
        }
        if let city, !city.isEmpty { query["city"] = city }
        return try await api.get("/places/nearby", query: query)
    }

    static func cities(_ q: String) async throws -> [CitySuggestion] {
        try await api.get("/cities", query: ["q": q])
    }

    static func saveCity(_ city: String) async throws -> CityPayload {
        try await api.put("/me/city", body: CityBody(city: city))
    }

    static func geocode(_ text: String, city: String?) async throws -> GeoArea {
        var query = ["q": text]
        if let city, !city.isEmpty { query["city"] = city }
        return try await api.get("/places/geocode", query: query)
    }

    static func saveCandidate(_ candidate: PlaceCandidate, _ fields: VisitFields) async throws {
        let _: IgnoredPayload = try await api.post("/places/save", body: SaveBody(candidate: candidate, fields: fields))
    }

    static func saveVisit(placeId: String, _ fields: VisitFields) async throws {
        let _: IgnoredPayload = try await api.post("/places/visits", body: VisitBody(placeId: placeId, fields: fields))
    }

    static func tastes() async throws -> Tastes {
        try await api.get("/activities/tastes")
    }

    static func setVerdict(kind: String, id: String, verdict: String?) async throws -> Tastes {
        try await api.put("/activities/tastes", body: TasteVerdictBody(targetKind: kind, targetId: id, verdict: verdict))
    }

    static func refreshInCloud() async throws -> Tastes {
        try await api.post("/activities/tastes/refresh", body: EmptyBody())
    }

    static func evidence() async throws -> TasteEvidencePayload {
        try await api.get("/activities/tastes/evidence")
    }

    static func saveLocal(summary: String?, hypotheses: [LocalTasteHypothesis]) async throws -> Tastes {
        try await api.post("/activities/tastes/local", body: LocalTastesBody(summary: summary, hypotheses: hypotheses))
    }
}

enum DistanceText {
    static func format(_ meters: Double?) -> String? {
        guard let meters else { return nil }
        if meters < 1_000 { return "\(Int((meters / 10).rounded()) * 10) м" }
        let km = meters / 1_000
        return km < 10 ? String(format: "%.1f км", km).replacingOccurrences(of: ".", with: ",") : "\(Int(km.rounded())) км"
    }
}
