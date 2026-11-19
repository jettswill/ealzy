import CoreLocation
import Foundation

private struct WhereaboutsUpload: Encodable {
    struct Weather: Encodable {
        let temp: Double
        let code: Int
        let at: Date
    }
    let city: String
    let country: String?
    let lat: Double
    let lon: Double
    let timezone: String?
    let weather: Weather?
}

private struct WhereaboutsResult: Decodable {
    let city: String
}

/// Где я сейчас: точку берёт iPhone, город определяет тоже он (CLGeocoder),
/// погоду — Open-Meteo. Виджет получает погоду для колонки справа, Илзи — город
/// (точка уходит на сервер округлённой до ~10 км). Не чаще раза в полчаса.
@MainActor
final class WhereaboutsTracker {
    static let shared = WhereaboutsTracker()

    private let location = OneShotLocation()
    private var running = false
    private var lastRun: Date?

    /// `prompt` — можно ли спросить разрешение (только когда приложение на экране).
    func refresh(prompt: Bool) async {
        guard !running, !DemoData.isOn else { return }
        if let lastRun, Date().timeIntervalSince(lastRun) < 30 * 60 { return }
        let status = CLLocationManager().authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways || (prompt && status == .notDetermined)
        else { return }
        running = true
        defer { running = false }
        guard let point = await location.current() else { return }
        lastRun = Date()

        var place = WidgetPlace.load() ?? WidgetPlace(lat: point.latitude, lon: point.longitude, updatedAt: Date())
        let moved = CLLocation(latitude: place.lat, longitude: place.lon)
            .distance(from: CLLocation(latitude: point.latitude, longitude: point.longitude)) > 3_000
        place.lat = point.latitude
        place.lon = point.longitude
        place.updatedAt = Date()
        if moved || place.city == nil,
           let mark = try? await CLGeocoder().reverseGeocodeLocation(
               CLLocation(latitude: point.latitude, longitude: point.longitude),
               preferredLocale: Locale(identifier: "ru_RU")
           ).first {
            place.city = mark.locality ?? mark.subAdministrativeArea ?? mark.administrativeArea
            place.country = mark.country
        }
        if let weather = await WeatherNow.fetch(lat: point.latitude, lon: point.longitude) {
            place.weather = weather
        }
        place.save()
        WidgetSnapshot.reloadWidgets()

        guard let city = place.city, !city.isEmpty else { return }
        let upload = WhereaboutsUpload(
            city: String(city.prefix(120)),
            country: place.country.map { String($0.prefix(120)) },
            lat: (point.latitude * 10).rounded() / 10,
            lon: (point.longitude * 10).rounded() / 10,
            timezone: TimeZone.current.identifier,
            weather: place.weather.map { WhereaboutsUpload.Weather(temp: $0.temp, code: $0.code, at: $0.at) }
        )
        let _: WhereaboutsResult? = try? await APIClient.shared.put("/me/whereabouts", body: upload)
    }
}
