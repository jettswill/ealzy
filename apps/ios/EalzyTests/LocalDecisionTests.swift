import XCTest
@testable import Ealzy

final class LocalDecisionTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Moscow")!
        return calendar
    }()
    private lazy var now = calendar.date(from: DateComponents(year: 2026, month: 11, day: 17, hour: 19))!

    private func parse(_ raw: String, _ text: String) -> LocalDecision {
        LocalDecisionParser.parse(raw, userText: text, now: now, calendar: calendar)
    }

    func testTaskWithTime() {
        let decision = parse(#"{"kind":"task","title":"позвонить маме","due":"2026-11-18T10:00"}"#,
                             "напомни завтра в 10 позвонить маме")
        let due = calendar.date(from: DateComponents(year: 2026, month: 11, day: 18, hour: 10))!
        XCTAssertEqual(decision, .task(title: "Позвонить маме", due: due))
    }

    func testDateOnlyIsNoon() {
        let decision = parse(#"{"kind":"task","title":"Сдать отчёт","due":"2026-12-31"}"#,
                             "до конца декабря сдать отчёт")
        let due = calendar.date(from: DateComponents(year: 2026, month: 12, day: 31, hour: 12))!
        XCTAssertEqual(decision, .task(title: "Сдать отчёт", due: due))
    }

    func testInventedDueIsDropped() {
        let decision = parse(#"{"kind":"task","title":"Купить молоко","due":"2026-11-18"}"#,
                             "купить молоко")
        XCTAssertEqual(decision, .task(title: "Купить молоко", due: nil))
    }

    func testPastDueGoesToCloud() {
        let decision = parse(#"{"kind":"task","title":"Купить молоко","due":"2026-11-10"}"#,
                             "купить молоко 10 ноября")
        XCTAssertEqual(decision, .cloud)
    }

    func testJunkTitleGoesToCloud() {
        XCTAssertEqual(parse(#"{"kind":"task","title":"Добавь задачу","due":null}"#, "добавь задачу"), .cloud)
    }

    func testThinkingAndFencesAreIgnored() {
        let raw = "<think>хм</think>\n```json\n{\"kind\":\"chat\",\"reply\":\"Пожалуйста!\"}\n```"
        XCTAssertEqual(parse(raw, "спасибо"), .chat(reply: "Пожалуйста!"))
    }

    func testLongMessageNeverAnsweredLocally() {
        XCTAssertEqual(parse(#"{"kind":"chat","reply":"Ок"}"#, "что подарить маме на день рождения?"), .cloud)
    }

    func testGarbageGoesToCloud() {
        XCTAssertEqual(parse("не знаю", "что-то"), .cloud)
    }

    func testConfirmation() {
        let due = calendar.date(from: DateComponents(year: 2026, month: 11, day: 18, hour: 10))!
        XCTAssertEqual(
            LocalDecisionParser.confirmation(title: "Позвонить маме", due: due, now: now, calendar: calendar),
            "Записала: Позвонить маме — завтра в 10:00."
        )
        XCTAssertEqual(
            LocalDecisionParser.confirmation(title: "Купить молоко", due: nil, now: now, calendar: calendar),
            "Записала: Купить молоко."
        )
    }
}
