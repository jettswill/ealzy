import Foundation

/// Место после «Пойду»: из базы или найденное рядом — в одном виде.
struct GoCard: Identifiable, Hashable {
    let id: String
    let name: String
    let address: String?
    let rating: Double?
    let ratingCount: Int?
    let distanceM: Double?
    let phone: String?
    let website: String?
    let hours: String?
    let lat: Double?
    let lon: Double?
    let mapsUrl: String?
    let target: OutingTarget

    static func == (a: GoCard, b: GoCard) -> Bool { a.id == b.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    init(saved p: SavedPlace) {
        id = "s:\(p.id)"
        name = p.name
        address = p.address
        rating = p.rating ?? p.yandexRating
        ratingCount = p.ratingCount ?? p.yandexReviews
        distanceM = p.distanceM
        phone = p.phone
        website = p.website
        hours = p.hours
        lat = p.lat
        lon = p.lon
        mapsUrl = p.yandexUrl ?? p.twogisUrl
        target = .saved(p.id)
    }

    init(candidate p: PlaceCandidate) {
        id = "f:\(p.id)"
        name = p.name
        address = p.address
        rating = p.rating
        ratingCount = p.ratingCount
        distanceM = p.distanceM
        phone = p.phone
        website = p.website
        hours = p.hours
        lat = p.lat
        lon = p.lon
        mapsUrl = p.mapsUrl
        target = .candidate(p)
    }

    /// Хорошие (4.3+) — вперёд, внутри — ближе раньше; без рейтинга — в конец.
    static func sorted(_ cards: [GoCard]) -> [GoCard] {
        func good(_ c: GoCard) -> Int { c.rating.map { $0 >= 4.3 ? 0 : 1 } ?? 2 }
        return cards.sorted {
            (good($0), $0.distanceM ?? 1e9, -($0.rating ?? 0)) < (good($1), $1.distanceM ?? 1e9, -($1.rating ?? 0))
        }
    }

    var phoneURL: URL? {
        guard let phone else { return nil }
        let digits = phone.filter { $0.isNumber || $0 == "+" }
        return digits.isEmpty ? nil : URL(string: "tel:\(digits)")
    }

    var siteURL: URL? {
        guard let website, !website.isEmpty else { return nil }
        return URL(string: website.hasPrefix("http") ? website : "https://\(website)")
    }

    /// Маршрут в Яндекс Картах до точки, а без точки — карточка места.
    var routeURL: URL? {
        if let lat, let lon { return URL(string: "https://yandex.ru/maps/?rtext=~\(lat),\(lon)") }
        return mapsUrl.flatMap(URL.init(string:))
    }
}

/// Быстрые варианты «когда»: сегодня в 19, завтра в 19, суббота в 12.
enum QuickTimes {
    static func options(now: Date = Date(), calendar: Calendar = .current) -> [(String, Date)] {
        func at(_ days: Int, _ hour: Int) -> Date {
            let day = calendar.date(byAdding: .day, value: days, to: now)!
            return calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day)!
        }
        var list: [(String, Date)] = []
        if calendar.component(.hour, from: now) < 18 { list.append(("Сегодня вечером", at(0, 19))) }
        list.append(("Завтра вечером", at(1, 19)))
        let weekday = calendar.component(.weekday, from: now) // 1 = вс, 7 = сб
        let toSaturday = (7 - weekday + 7) % 7
        if toSaturday > 1 { list.append(("В субботу днём", at(toSaturday, 12))) }
        return list
    }
}
