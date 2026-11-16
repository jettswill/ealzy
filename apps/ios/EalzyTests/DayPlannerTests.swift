import XCTest
@testable import Ealzy

final class DayPlannerTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Moscow")!
        return calendar
    }()
    private lazy var now = calendar.date(from: DateComponents(year: 2026, month: 11, day: 16, hour: 9))!

    private func task(
        _ title: String,
        dayOffset: Int? = 0,
        hour: Int = 12,
        importance: Int = 3,
        urgency: Int = 3,
        estimate: Int? = nil,
        kind: String = "task",
        assignee: String = "user",
        status: String = "todo"
    ) -> EalzyTask {
        let due = dayOffset.map { offset -> Date in
            let day = calendar.date(byAdding: .day, value: offset, to: now)!
            return calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day)!
        }
        return EalzyTask(
            id: title, title: title, description: nil, status: status, dueAt: due,
            estimateMinutes: estimate, importance: importance, urgency: urgency,
            kind: kind, assignee: assignee, completedAt: nil, createdAt: nil
        )
    }

    func testOneFocusByDefaultAndTheRestInReserve() {
        let plan = DayPlanner.plan([
            task("Смета", importance: 5, estimate: 90),
            task("Отчёт", importance: 3, estimate: 60),
            task("Оплатить интернет", estimate: 5),
            task("Купить подарок", dayOffset: 3),
            task("Почитать книгу", dayOffset: nil),
            task("Готово", status: "done"),
        ], now: now, calendar: calendar)
        XCTAssertEqual(plan.focus.map(\.title), ["Смета"])
        XCTAssertEqual(plan.today.map(\.title), ["Отчёт"])
        XCTAssertEqual(plan.quick.map(\.title), ["Оплатить интернет"])
        XCTAssertEqual(plan.reserve.map(\.title), ["Купить подарок", "Почитать книгу"])
    }

    func testTwoFocusesOnlyWhenBothAreImportantAndDue() {
        let burning = DayPlanner.plan([
            task("Смета", importance: 5),
            task("Презентация", dayOffset: -1, importance: 4),
        ], now: now, calendar: calendar)
        XCTAssertEqual(Set(burning.focus.map(\.title)), ["Смета", "Презентация"])

        let calm = DayPlanner.plan([
            task("Смета", importance: 5),
            task("Разобрать почту", importance: 3),
        ], now: now, calendar: calendar)
        XCTAssertEqual(calm.focus.map(\.title), ["Смета"])
    }

    func testMeetingsAndQuickTasksNeverBecomeFocus() {
        let plan = DayPlanner.plan([
            task("Встреча с Петей", hour: 14, importance: 5, kind: "meeting"),
            task("Позвонить маме", importance: 5, estimate: 10),
        ], now: now, calendar: calendar)
        XCTAssertTrue(plan.focus.isEmpty)
        XCTAssertEqual(plan.today.map(\.title), ["Встреча с Петей"])
        XCTAssertEqual(plan.quick.map(\.title), ["Позвонить маме"])
    }

    func testIlziTasksAreSeparate() {
        let plan = DayPlanner.plan([task("Подобрать билеты", assignee: "ealzy")], now: now, calendar: calendar)
        XCTAssertEqual(plan.forIlzi.map(\.title), ["Подобрать билеты"])
        XCTAssertTrue(plan.isEmpty)
    }

    func testRemindersSkipDateOnlyAndPastTasks() {
        let tasks = [
            task("Только день", dayOffset: 1, hour: 12),
            task("Со временем", dayOffset: 1, hour: 16), // 16:00 МСК = 13:00 UTC: не «полдень» ни в одном поясе
            task("Прошло", dayOffset: -1, hour: 15),
            task("Для Илзи", dayOffset: 1, hour: 17, assignee: "ealzy"),
        ]
        let titles = ReminderScheduler.reminderTasks(tasks, now: now).map(\.title)
        XCTAssertTrue(titles.contains("Со временем"))
        XCTAssertFalse(titles.contains("Прошло"))
        XCTAssertFalse(titles.contains("Для Илзи"))
    }

    func testParsesServerDates() {
        XCTAssertNotNil(ISODates.parse("2026-11-16T09:00:00.000Z"))
        XCTAssertNotNil(ISODates.parse("2026-11-16T09:00:00.123456+00:00"))
        XCTAssertNotNil(ISODates.parse("2026-11-16T09:00:00+03:00"))
        XCTAssertEqual(ISODates.format(Date(timeIntervalSince1970: 0)), "1970-01-01T00:00:00Z")
    }

    func testDecodesTaskFromServerJSON() throws {
        let json = """
        {"data":[{"id":"t1","owner_id":"u","title":"Смета","description":null,"status":"todo",
        "due_at":"2026-11-16T09:00:00.000Z","estimate_minutes":90,"importance":5,"urgency":4,
        "kind":"task","assignee":"user","completed_at":null,"created_at":"2026-11-15T10:00:00.5+00:00",
        "person":null}]}
        """
        let tasks = try JSONCoding.decoder.decode(Envelope<[EalzyTask]>.self, from: Data(json.utf8)).data
        XCTAssertEqual(tasks.first?.estimateMinutes, 90)
        XCTAssertNotNil(tasks.first?.dueAt)
    }
}
