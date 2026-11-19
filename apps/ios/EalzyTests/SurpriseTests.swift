import XCTest
@testable import Ealzy

final class SurpriseTests: XCTestCase {
    func testSlotsRepeatAroundTheCircleByWeight() {
        let slots = WheelPhysics.slots([2, 1, 1])
        XCTAssertGreaterThanOrEqual(slots.count, 18)
        XCTAssertEqual(slots[0].end - slots[0].start, 2 * (slots[1].end - slots[1].start), accuracy: 0.001)
        XCTAssertEqual(slots.last?.end, 360)
    }

    /// Колесо само останавливается на выбранном сервером варианте: колышки, трение, откат.
    func testSpinStopsOnServerPick() {
        let slots = WheelPhysics.slots([2, 1, 1, 3, 1, 1])
        var from = 0.0
        for segment in [0, 1, 2, 3, 4, 5, 3] {
            let track = WheelPhysics.plan(slots, from: from, segment: segment, random: { 0.5 })
            let end = track.frames.last!
            XCTAssertEqual(slots[WheelPhysics.slot(at: end, in: slots)].segment, segment)
            XCTAssertGreaterThan(Double(track.frames.count) / 60, 3.5)
            XCTAssertGreaterThan(track.ticks.count, 20)
            from = end
        }
    }

    func testFlapperBendsOnlyNextToAPeg() {
        let slots = WheelPhysics.slots([1, 1, 1, 1, 1, 1])
        XCTAssertGreaterThan(WheelPhysics.flapper(slots, rotation: 358 - slots[1].start), 5)
        XCTAssertEqual(WheelPhysics.flapper(slots, rotation: 360 - slots[1].middle), 0)
    }

    func testLocalTastesParsing() {
        let raw = """
        Вот:
        ```json
        {"summary":"Тебе подходит активное.","hypotheses":[
         {"name":"Пляжный волейбол","kind":"type","affinity":0.9,"reason":"ты любишь волейбол"},
         {"name":"пляжный волейбол","affinity":0.2},
         {"name":"Творчество","kind":"category","affinity":"-0,4"},
         {"name":"","affinity":0.3},
         {"name":"Баня","kind":"что-то","affinity":2}
        ]}
        ```
        """
        let parsed = LocalTastes.parse(raw)
        XCTAssertEqual(parsed?.summary, "Тебе подходит активное.")
        XCTAssertEqual(parsed?.hypotheses.map(\.name), ["Пляжный волейбол", "Творчество", "Баня"])
        XCTAssertEqual(parsed?.hypotheses[1].affinity, -0.4)
        XCTAssertEqual(parsed?.hypotheses[2].affinity, 1)
        XCTAssertNil(parsed?.hypotheses[2].kind)
        XCTAssertNil(LocalTastes.parse("не знаю"))
    }

    /// Сервер ждёт все поля кандидата, пустые — явным null.
    func testCandidateKeepsNullFields() throws {
        let json = #"""
        {"source":"web","source_id":"spb|surf hub|","name":"Surf Hub","address":null,"city":"Санкт-Петербург",
         "lat":59.98,"lon":30.21,"rating":null,"rating_count":null,"image_url":null,"photos":[],"phone":null,
         "website":"https://surf.example","hours":null,"twogis_url":null,"distance_m":1234.5,
         "maps_url":"https://yandex.ru/maps/?text=Surf","note":"крытая волна"}
        """#
        let candidate = try JSONCoding.decoder.decode(PlaceCandidate.self, from: Data(json.utf8))
        XCTAssertTrue(candidate.isFromWeb)
        let sent = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONCoding.encoder.encode(candidate)) as? [String: Any]
        )
        XCTAssertTrue(sent["address"] is NSNull)
        XCTAssertEqual(sent["source_id"] as? String, "spb|surf hub|")
    }

    func testStatusCarriesOwnCity() throws {
        let json = #"{"spins_used":0,"spins_left":3,"spins_limit":3,"city":"Казань","city_guess":"Москва"}"#
        let status = try JSONCoding.decoder.decode(WheelStatus.self, from: Data(json.utf8))
        XCTAssertEqual(status.city, "Казань")
        XCTAssertEqual(status.cityGuess, "Москва")
    }

    func testDistanceText() {
        XCTAssertEqual(DistanceText.format(456), "460 м")
        XCTAssertEqual(DistanceText.format(1234), "1,2 км")
        XCTAssertNil(DistanceText.format(nil))
    }
}
