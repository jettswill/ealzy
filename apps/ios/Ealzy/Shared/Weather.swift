import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Погода сейчас — бесплатный Open-Meteo (без ключа и без аккаунта Apple Developer).
struct WeatherNow: Codable, Equatable {
    let temp: Double
    /// Код погоды WMO.
    let code: Int
    let isDay: Bool
    let at: Date

    /// «−3°» — с настоящим минусом.
    var tempText: String {
        let value = Int(temp.rounded())
        return value < 0 ? "−\(-value)°" : "\(value)°"
    }

    /// Значок SF Symbols под код погоды.
    var symbol: String {
        switch code {
        case 0: return isDay ? "sun.max.fill" : "moon.stars.fill"
        case 1, 2: return isDay ? "cloud.sun.fill" : "cloud.moon.fill"
        case 3: return "cloud.fill"
        case 45, 48: return "cloud.fog.fill"
        case 51...57: return "cloud.drizzle.fill"
        case 65, 82: return "cloud.heavyrain.fill"
        case 61...67, 80...81: return "cloud.rain.fill"
        case 71...77, 85, 86: return "cloud.snow.fill"
        case 95...99: return "cloud.bolt.rain.fill"
        default: return "cloud.fill"
        }
    }

    var isFresh: Bool { Date().timeIntervalSince(at) < 3 * 3600 }

    private struct Response: Decodable {
        struct Current: Decodable {
            let temperature_2m: Double
            let weather_code: Int
            let is_day: Int
        }
        let current: Current
    }

    static func fetch(lat: Double, lon: Double) async -> WeatherNow? {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        components.queryItems = [
            URLQueryItem(name: "latitude", value: String(format: "%.2f", lat)),
            URLQueryItem(name: "longitude", value: String(format: "%.2f", lon)),
            URLQueryItem(name: "current", value: "temperature_2m,weather_code,is_day"),
        ]
        guard let url = components.url else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let decoded = try? JSONDecoder().decode(Response.self, from: data) else { return nil }
        return WeatherNow(
            temp: decoded.current.temperature_2m,
            code: decoded.current.weather_code,
            isDay: decoded.current.is_day == 1,
            at: Date()
        )
    }
}

/// Где телефон (город и точка) и последняя погода там. Пишет приложение,
/// виджет читает и сам обновляет погоду раз в полчаса.
struct WidgetPlace: Codable, Equatable {
    var lat: Double
    var lon: Double
    var city: String?
    var country: String?
    var updatedAt: Date
    var weather: WeatherNow?

    private static let fileName = "widget-place.json"

    private static var fileURL: URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: WidgetSnapshot.appGroup)?
            .appendingPathComponent(fileName)
    }

    static func load() -> WidgetPlace? {
        let data = fileURL.flatMap { try? Data(contentsOf: $0) } ?? Keychain.readPlace()
        return data.flatMap { try? JSONCoding.decoder.decode(WidgetPlace.self, from: $0) }
    }

    func save() {
        guard let data = try? JSONCoding.encoder.encode(self) else { return }
        if let url = Self.fileURL {
            try? data.write(to: url, options: .atomic)
        } else {
            Keychain.savePlace(data)
        }
    }

    static func clear() {
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        Keychain.deletePlace()
    }
}
