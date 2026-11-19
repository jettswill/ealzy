import CoreLocation
import Foundation
import Observation
import UIKit

/// Где искать: рядом со мной, район (словами или точкой на карте) или весь город.
enum AreaMode: String, Codable, CaseIterable, Identifiable {
    case near, map, city
    var id: String { rawValue }
    var title: String {
        switch self {
        case .near: return "Рядом со мной"
        case .map: return "Район"
        case .city: return "Весь город"
        }
    }
}

/// Что сейчас на экране колеса.
enum SurprisePhase: Equatable {
    /// Человек говорит, чего хочет.
    case setup
    case spinning
    /// Выпало — «Пойду» или «Поискать ещё».
    case result
    /// Решил идти: куда именно и как добраться.
    case going
    /// Ищем дальше: что не так, настройки, новое вращение.
    case more
}

/// Колесо «Удиви меня»: запрос, вращения, итог, места вокруг и отметки.
@MainActor
@Observable
final class SurpriseStore {
    static let radii = [1_000, 3_000, 5_000, 10_000]
    static let defaultRadius = 3_000
    private static let areaKey = "surpriseArea"
    private static let modeKey = "surpriseAreaMode"

    // Запрос
    var mood: WheelMood = .any
    var want = ""
    var when: WheelWhen = .today
    var company: WheelCompany = .solo
    /// Город из справочника; свой город хранится на сервере и подставляется сам.
    var city = ""
    var onlyNew = true
    /// Что не так — своими словами и быстрыми кнопками.
    var feedback = ""
    var reasons: Set<String> = []

    // Где искать
    var areaMode: AreaMode = .city
    var area: WheelArea?
    var areaStatus: String?
    var isLocating = false

    // Колесо
    private(set) var status: WheelStatus?
    private(set) var spin: WheelSpin?
    var phase: SurprisePhase = .setup
    /// Просчитанное вращение до выпавшего варианта.
    private(set) var track: SpinTrack?
    /// Где колесо стоит, когда не крутится.
    var rotation: Double = 0
    var error: String?

    var isSpinning: Bool { phase == .spinning }

    /// Секторы колеса: варианты с сервера, а до первого вращения — красивый набор.
    var slots: [WheelSlot] {
        WheelPhysics.slots(spin?.segments.map(\.weight) ?? WheelDisc.previewIcons.map { _ in 1 })
    }

    var icons: [String] {
        spin?.segments.map { $0.emoji ?? "✨" } ?? WheelDisc.previewIcons
    }

    // Места вокруг итога
    private(set) var nearby: NearbyPlaces?
    private(set) var isLookingNearby = false
    private(set) var nearbyError: String?
    /// Что человек уже отметил в этой выдаче: id → «хочу» / «был».
    private(set) var marked: [String: PlaceVisitStatus] = [:]

    private let locator = OneShotLocation()

    init() {
        let saved = UserDefaults.standard.string(forKey: Self.modeKey).flatMap(AreaMode.init(rawValue:)) ?? .city
        if saved == .map, let data = UserDefaults.standard.data(forKey: Self.areaKey),
           let area = try? JSONDecoder().decode(WheelArea.self, from: data) {
            areaMode = .map
            self.area = area
        } else if saved == .near {
            // Точку не храним: человек мог уехать — спросим заново.
            areaMode = .near
        }
    }

    var radius: Int { area?.radiusM ?? Self.defaultRadius }
    /// Район, который реально уходит в запрос: «весь город» — без точки.
    var effectiveArea: WheelArea? { areaMode == .city ? nil : area }

    var spinsLeftText: String? {
        guard let status else { return nil }
        guard let left = status.spinsLeft else { return "Без ограничений" }
        return left == 0 ? "На сегодня вращения закончились" : "Осталось \(left) из \(status.spinsLimit) на сегодня"
    }

    var canSpin: Bool { !isSpinning && (status?.spinsLeft ?? 1) > 0 }

    func loadStatus() async {
        if DemoData.isOn { return }
        status = try? await SurpriseAPI.status()
        // Свой город — из базы; пока его нет — догадка по часовому поясу.
        if city.isEmpty, let known = status?.city ?? status?.cityGuess { city = known }
    }

    /// Выбран город из справочника — запоминаем как свой.
    func chooseCity(_ title: String) {
        city = title
        Task { _ = try? await SurpriseAPI.saveCity(title) }
    }

    // MARK: Где искать

    func choose(_ mode: AreaMode) async {
        areaStatus = nil
        switch mode {
        case .city:
            areaMode = .city
            remember()
        case .map:
            if areaMode != .map { area = nil }
            areaMode = .map
            remember()
        case .near:
            areaMode = .near
            await locate()
        }
    }

    func locate() async {
        isLocating = true
        defer { isLocating = false }
        if let point = await locator.current() {
            area = WheelArea(lat: point.latitude, lon: point.longitude, radiusM: radius, label: nil)
            areaStatus = "Нашли, где ты. Ищем вокруг."
        } else {
            area = nil
            areaStatus = "Не получилось определить, где ты, — выбери район или весь город."
        }
        remember()
    }

    /// Район словами: «Петроградка», «м. Чкаловская», «Патрики».
    func findArea(_ text: String) async {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 2 else { return }
        isLocating = true
        defer { isLocating = false }
        do {
            let found = try await SurpriseAPI.geocode(query, city: cityOrNil)
            areaMode = .map
            area = WheelArea(lat: found.lat, lon: found.lon, radiusM: radius, label: query)
            areaStatus = nil
            remember()
        } catch {
            areaStatus = "Не нашли такое место — попробуй иначе или ткни в карту."
        }
    }

    func pick(_ coordinate: CLLocationCoordinate2D) {
        areaMode = .map
        area = WheelArea(lat: coordinate.latitude, lon: coordinate.longitude, radiusM: radius, label: nil)
        areaStatus = nil
        remember()
    }

    func setRadius(_ meters: Int) {
        guard var current = area else { return }
        current.radiusM = meters
        area = current
        remember()
    }

    /// Центр карты, пока точки нет: сам город.
    func cityCenter() async -> CLLocationCoordinate2D? {
        guard let city = cityOrNil, let found = try? await SurpriseAPI.geocode(city, city: nil) else { return nil }
        return CLLocationCoordinate2D(latitude: found.lat, longitude: found.lon)
    }

    private func remember() {
        UserDefaults.standard.set(areaMode.rawValue, forKey: Self.modeKey)
        if areaMode == .map, let area, let data = try? JSONEncoder().encode(area) {
            UserDefaults.standard.set(data, forKey: Self.areaKey)
        } else {
            UserDefaults.standard.removeObject(forKey: Self.areaKey)
        }
    }

    private var cityOrNil: String? {
        let trimmed = city.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    // MARK: Вращение

    /// Покрутить колесо. `again` — повтор: учитываем, что не понравилось.
    func spinWheel(again: Bool = false) async {
        guard canSpin else { return }
        error = nil
        let wantText = want.trimmingCharacters(in: .whitespacesAndNewlines)
        let typed = feedback.trimmingCharacters(in: .whitespacesAndNewlines)
        let why = (reasons.sorted() + (typed.isEmpty ? [] : [typed])).joined(separator: ", ")
        let request = WheelRequest(
            mood: mood,
            want: wantText.isEmpty ? nil : String(wantText.prefix(120)),
            when: when,
            company: company,
            city: cityOrNil,
            onlyNew: onlyNew,
            feedback: again && !why.isEmpty ? String(why.prefix(500)) : nil,
            area: effectiveArea
        )
        do {
            let result = try await SurpriseAPI.spin(request)
            let weights = result.segments.map(\.weight)
            let from = rotation
            let reduce = UIAccessibility.isReduceMotionEnabled
            let winner = result.winnerIndex
            // Подбор толчка — сотни прогонов физики; не держим главный поток.
            let plan = await Task.detached(priority: .userInitiated) { () -> SpinTrack in
                let slots = WheelPhysics.slots(weights)
                return reduce
                    ? WheelPhysics.eased(slots, from: from, segment: winner, seconds: 0.6, turns: 1)
                    : WheelPhysics.plan(slots, from: from, segment: winner)
            }.value
            spin = result
            track = plan
            nearby = nil
            nearbyError = nil
            marked = [:]
            currentVerdict = result.winner.verdict
            status = WheelStatus(spinsUsed: result.spinsUsed, spinsLeft: result.spinsLeft,
                                 spinsLimit: result.spinsLimit, city: status?.city, cityGuess: status?.cityGuess)
            reasons = []
            feedback = ""
            phase = .spinning
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Колесо остановилось — показываем итог.
    func didStop() {
        if let last = track?.frames.last { rotation = last }
        phase = .result
    }

    /// «Пойду»: куда именно; с районом места ищем сразу.
    func going() async {
        phase = .going
        if effectiveArea != nil, nearby == nil { await lookNearby() }
    }

    /// «Поискать ещё»: что не так, настройки, новое вращение.
    func lookMore() { phase = .more }

    // MARK: Места

    func lookNearby() async {
        guard let type = spin?.winner.type.id else { return }
        isLookingNearby = true
        nearbyError = nil
        defer { isLookingNearby = false }
        var where_ = effectiveArea
        if where_ == nil, areaMode == .city {
            // «Весь город», но человек сам нажал «рядом со мной» — спросим точку.
            if let point = await locator.current() {
                where_ = WheelArea(lat: point.latitude, lon: point.longitude, radiusM: 5_000, label: nil)
            }
        }
        do {
            nearby = try await SurpriseAPI.nearby(type: type, area: where_, city: cityOrNil)
        } catch {
            nearbyError = error.localizedDescription
        }
    }

    func mark(candidate: PlaceCandidate, _ fields: VisitFields) async -> Bool {
        do {
            try await SurpriseAPI.saveCandidate(candidate, fields)
            marked[candidate.id] = fields.status
            return true
        } catch {
            nearbyError = error.localizedDescription
            return false
        }
    }

    func mark(placeId: String, _ fields: VisitFields) async -> Bool {
        do {
            try await SurpriseAPI.saveVisit(placeId: placeId, fields)
            marked[placeId] = fields.status
            return true
        } catch {
            nearbyError = error.localizedDescription
            return false
        }
    }

    func visitStatus(of id: String) -> PlaceVisitStatus? { marked[id] }

    // MARK: Вкус к итогу

    /// «Нравится» / «Не предлагать» прямо на итоге колеса.
    func setVerdict(_ verdict: String?) async {
        guard let type = spin?.winner.type else { return }
        _ = try? await SurpriseAPI.setVerdict(kind: "type", id: type.id, verdict: verdict)
        currentVerdict = verdict
    }

    var currentVerdict: String?
}

/// Одна точка «где я» — с вежливым запросом разрешения. nil — нельзя или не вышло.
@MainActor
final class OneShotLocation: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var waiting: [CheckedContinuation<CLLocationCoordinate2D?, Never>] = []
    private var authWaiting: CheckedContinuation<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func current() async -> CLLocationCoordinate2D? {
        if manager.authorizationStatus == .notDetermined {
            await withCheckedContinuation { continuation in
                authWaiting = continuation
                manager.requestWhenInUseAuthorization()
            }
        }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: break
        default: return nil
        }
        // Свежая точка уже есть — не ждём спутников.
        if let last = manager.location, last.timestamp.timeIntervalSinceNow > -300 {
            return last.coordinate
        }
        return await withCheckedContinuation { continuation in
            waiting.append(continuation)
            if waiting.count == 1 { manager.requestLocation() }
        }
    }

    private func finish(_ point: CLLocationCoordinate2D?) {
        let pending = waiting
        waiting = []
        pending.forEach { $0.resume(returning: point) }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            guard manager.authorizationStatus != .notDetermined, let continuation = self.authWaiting else { return }
            self.authWaiting = nil
            continuation.resume()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let point = locations.last?.coordinate
        Task { @MainActor in self.finish(point) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in self.finish(nil) }
    }
}
