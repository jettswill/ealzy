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
            task("Презентация", hour: 15, importance: 4),
        ], now: now, calendar: calendar)
        XCTAssertEqual(Set(burning.focus.map(\.title)), ["Смета", "Презентация"])

        let calm = DayPlanner.plan([
            task("Смета", importance: 5),
            task("Разобрать почту", importance: 3),
        ], now: now, calendar: calendar)
        XCTAssertEqual(calm.focus.map(\.title), ["Смета"])
    }

    func testDayHoldsOnlyWhatIsPlannedForToday() {
        var done = task("Позвонить в банк", estimate: 10, status: "done")
        done.completedAt = calendar.date(byAdding: .hour, value: -1, to: now)
        let plan = DayPlanner.plan([
            task("Просроченное", dayOffset: -2, importance: 5, urgency: 5),
            task("Горит, но без даты", dayOffset: nil, importance: 5, urgency: 5),
            task("Отчёт", estimate: 60),
            done,
        ], now: now, calendar: calendar)
        XCTAssertEqual(plan.focus.map(\.title), ["Отчёт"])
        XCTAssertEqual(plan.overdue.map(\.title), ["Просроченное"])
        XCTAssertEqual(plan.reserve.map(\.title), ["Горит, но без даты"])
        XCTAssertEqual(plan.done.map(\.title), ["Позвонить в банк"])
        XCTAssertFalse(plan.isDayDone)

        let finished = DayPlanner.plan([done, task("Когда-нибудь", dayOffset: nil)], now: now, calendar: calendar)
        XCTAssertTrue(finished.isDayDone)
        XCTAssertTrue(finished.headline.hasPrefix("Всё на сегодня сделано"))
    }

    func testPomodoroPhasesGoInCircles() {
        let pomodoro = Pomodoro(workMinutes: 30, breakMinutes: 10)
        let start = pomodoro.phase(elapsed: 0)
        XCTAssertEqual(start, Pomodoro.Phase(isBreak: false, round: 1, remaining: 1800, length: 1800))
        let rest = pomodoro.phase(elapsed: 31 * 60)
        XCTAssertTrue(rest.isBreak)
        XCTAssertEqual(rest.round, 1)
        XCTAssertEqual(rest.remaining, 9 * 60)
        let second = pomodoro.phase(elapsed: 41 * 60)
        XCTAssertFalse(second.isBreak)
        XCTAssertEqual(second.round, 2)
        XCTAssertEqual(second.remaining, 29 * 60)
        XCTAssertEqual(pomodoro.rounds(forEstimate: 90), 3)
        XCTAssertEqual(pomodoro.rounds(forEstimate: 20), 1)
        XCTAssertEqual(Pomodoro.from(key: "45/15"), Pomodoro(workMinutes: 45, breakMinutes: 15))
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

    func testWidgetSnapshotKeepsFocusAndCounts() {
        let plan = DayPlanner.plan([
            task("Смета", importance: 5, estimate: 90),
            task("Оплатить интернет", estimate: 5),
            task("Купить подарок", dayOffset: 3),
        ], now: now, calendar: calendar)
        var snapshot = WidgetSnapshot.make(plan: plan, nextEvent: nil)
        snapshot.updatedAt = now // в файле дата хранится с точностью до секунды
        XCTAssertEqual(snapshot.focus.map(\.title), ["Смета"])
        XCTAssertEqual(snapshot.next.map(\.title), ["Оплатить интернет"])
        XCTAssertEqual(snapshot.reserveCount, 1)
        snapshot.focusRun = .init(taskId: "Смета", title: "Смета", endsAt: now.addingTimeInterval(1800), pausedRemaining: nil)
        // Снимок от прошлой версии (без новых полей) читается.
        let old = #"{"updatedAt":"2026-11-16T09:00:00Z","headline":"h","focus":[],"next":[],"quickCount":0,"reserveCount":2}"#
        let legacy = try! JSONCoding.decoder.decode(WidgetSnapshot.self, from: Data(old.utf8))
        XCTAssertEqual(legacy.reserveCount, 2)
        XCTAssertEqual(legacy.doneCount, 0)
        XCTAssertTrue(legacy.tomorrow.isEmpty)
        let data = try! JSONCoding.encoder.encode(snapshot)
        XCTAssertEqual(try! JSONCoding.decoder.decode(WidgetSnapshot.self, from: data), snapshot)
    }

    func testNoteBodyMatchesTheWebEditor() throws {
        let note = NoteUpsert(title: "Покупки", text: "Молоко\n\nХлеб")
        let json = try JSONSerialization.jsonObject(with: JSONCoding.encoder.encode(note)) as! [String: Any]
        XCTAssertEqual(json["base_revision"] as? Int, 0)
        XCTAssertEqual(json["plain_text"] as? String, "Молоко\n\nХлеб")
        let content = json["content"] as! [String: Any]
        XCTAssertEqual(content["type"] as? String, "doc")
        XCTAssertEqual((content["content"] as! [Any]).count, 3)
    }

    private func at(_ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(bySettingHour: hour, minute: minute, second: 0, of: now)!
    }

    func testFocusWindowFindsTheGapBetweenEvents() {
        // 10:47, бокс прошёл, созвон в 14:00 — 90 минут встают с 11:00.
        let busy = [TimeSpan(start: at(9), end: at(10, 30)), TimeSpan(start: at(14), end: at(14, 45))]
        let window = DayPlanner.focusWindow(minutes: 90, busy: busy, now: at(10, 47), dayEnd: at(22), calendar: calendar)
        XCTAssertEqual(window, TimeSpan(start: at(11), end: at(12, 30)))
    }

    func testFocusWindowSkipsATooShortGap() {
        // До созвона в 11:30 только 30 минут — окно на 2 часа после него.
        let busy = [TimeSpan(start: at(11, 30), end: at(12, 15))]
        let window = DayPlanner.focusWindow(minutes: 120, busy: busy, now: at(10, 50), dayEnd: at(22), calendar: calendar)
        XCTAssertEqual(window, TimeSpan(start: at(12, 15), end: at(14, 15)))
        XCTAssertNil(DayPlanner.focusWindow(minutes: 120, busy: [], now: at(21), dayEnd: at(22), calendar: calendar))
    }

    func testDayTitleAndPlural() {
        XCTAssertEqual(TodayView.plural(1, "дело", "дела", "дел"), "дело")
        XCTAssertEqual(TodayView.plural(3, "дело", "дела", "дел"), "дела")
        XCTAssertEqual(TodayView.plural(11, "дело", "дела", "дел"), "дел")
        XCTAssertEqual(TodayView.duration(3 * 3600 + 13 * 60), "3 ч 13 мин")
        let title = TodayView.dayTitle(now)
        XCTAssertTrue(title.hasPrefix("Понедельник"))
        XCTAssertTrue(title.contains("ноября"), title)
        XCTAssertEqual(FocusView.clock(68 * 60 + 12), "1:08:12")
        XCTAssertEqual(FocusView.clock(-65), "+1:05")
    }
}
