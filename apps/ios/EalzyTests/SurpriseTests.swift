import XCTest
@testable import Ealzy

final class SurpriseTests: XCTestCase {
    func testArcsFollowWeights() {
        let arcs = WheelGeometry.arcs([2, 1, 1])
        XCTAssertEqual(arcs[0].end, 180, accuracy: 0.001)
        XCTAssertEqual(arcs[2].end, 360, accuracy: 0.001)
    }

    /// Итог всегда встаёт под стрелку сверху, после нескольких полных оборотов.
    func testWinnerStopsUnderPointer() {
        let arcs = WheelGeometry.arcs([2, 1, 1, 3])
        var current = 0.0
        for index in [0, 3, 1, 2, 3] {
            for jitter in [-0.3, 0, 0.3] {
                let target = WheelGeometry.targetRotation(from: current, arc: arcs[index], jitter: jitter)
                let top = (360 - target.truncatingRemainder(dividingBy: 360)).truncatingRemainder(dividingBy: 360)
                XCTAssertTrue(top >= arcs[index].start - 0.001 && top <= arcs[index].end + 0.001, "сектор \(index)")
                XCTAssertGreaterThanOrEqual(target - current, 5 * 360)
                current = target
            }
        }
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
        XCTAssertEqual(candidate.distanceM, 1234.5)
        let sent = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONCoding.encoder.encode(candidate)) as? [String: Any]
        )
        XCTAssertTrue(sent["address"] is NSNull)
        XCTAssertTrue(sent["twogis_url"] is NSNull)
        XCTAssertEqual(sent["source_id"] as? String, "spb|surf hub|")
    }

    func testDistanceText() {
        XCTAssertEqual(DistanceText.format(456), "460 м")
        XCTAssertEqual(DistanceText.format(1234), "1,2 км")
        XCTAssertEqual(DistanceText.format(15_400), "15 км")
        XCTAssertNil(DistanceText.format(nil))
    }
}
