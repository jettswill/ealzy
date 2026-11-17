import Foundation
import Observation

/// Дела человека: загрузка, «готово», перенос. Источник для экрана «Сегодня»
/// и для локальных напоминаний.
@MainActor
@Observable
final class TasksStore {
    private(set) var tasks: [EalzyTask] = []
    private(set) var isLoading = false
    var errorMessage: String?
    /// Календарь для виджета (ставит PhoneCalendar после синхронизации).
    var calendarInfo = WidgetCalendar() {
        didSet { publishSnapshot() }
    }

    private static let choiceKey = "focusChoice"
    /// Ручной выбор главного на сегодня; завтра сбрасывается сам.
    private(set) var focusChoice: FocusChoice? = {
        guard let data = UserDefaults.standard.data(forKey: "focusChoice") else { return nil }
        return try? JSONDecoder().decode(FocusChoice.self, from: data)
    }() {
        didSet {
            if let focusChoice, let data = try? JSONEncoder().encode(focusChoice) {
                UserDefaults.standard.set(data, forKey: Self.choiceKey)
            }
            publishSnapshot()
        }
    }

    var plan: DayPlan { DayPlanner.plan(tasks, choice: focusChoice) }

    private var todayChoice: FocusChoice {
        let today = FocusChoice.dayKey()
        if let focusChoice, focusChoice.day == today { return focusChoice }
        return FocusChoice(day: today)
    }

    /// Сделать дело главным на сегодня (и поставить его в день, если его там нет).
    func pinFocus(_ task: EalzyTask) {
        var choice = todayChoice
        choice.pinned = task.id
        choice.skipped.removeAll { $0 == task.id }
        focusChoice = choice
        if !isOnToday(task) { Task { await addToToday(task) } }
    }

    func isOnToday(_ task: EalzyTask) -> Bool {
        task.dueAt.map { Calendar.current.isDateInToday($0) } ?? false
    }

    /// Человек сам собирает день: дело — в «Сегодня».
    func addToToday(_ task: EalzyTask) async {
        let due = DueClock.dateOnly(Date())
        replace(task.id) { $0.dueAt = due }
        await send(task.id, TaskPatch(dueAt: due))
    }

    /// Убрать из дня — дело уходит во «Все дела», без срока.
    func removeFromToday(_ task: EalzyTask) async {
        if focusChoice?.pinned == task.id { focusChoice?.pinned = nil }
        replace(task.id) { $0.dueAt = nil }
        await send(task.id, TaskPatch(clearDue: true))
    }

    /// Случайно отметил — вернуть в работу.
    func reopen(_ task: EalzyTask) async {
        replace(task.id) { $0.status = "todo"; $0.completedAt = nil }
        await send(task.id, TaskPatch(status: "todo"))
    }

    /// Убрать дело из фокуса на сегодня — оно остаётся в списке, главным станет следующее.
    func skipFocus(_ task: EalzyTask) {
        var choice = todayChoice
        if choice.pinned == task.id { choice.pinned = nil }
        if !choice.skipped.contains(task.id) { choice.skipped.append(task.id) }
        focusChoice = choice
    }

    // MARK: Отметить готовым — с запасом на «ой, не то»

    /// Отмеченные, но ещё не отправленные: строка зачёркнута и стоит на месте несколько секунд,
    /// можно снять галочку. Уходит с экрана — отправляем сразу.
    private(set) var pendingDone: Set<String> = []
    static let undoDelay: Duration = .seconds(4)

    func isChecked(_ task: EalzyTask) -> Bool { !task.isOpen || pendingDone.contains(task.id) }

    func toggleDone(_ task: EalzyTask) {
        if pendingDone.contains(task.id) {
            pendingDone.remove(task.id)
            return
        }
        if !task.isOpen {
            Task { await reopen(task) }
            return
        }
        pendingDone.insert(task.id)
        Task {
            try? await Task.sleep(for: Self.undoDelay)
            await commit(task.id)
        }
    }

    /// Ушли с экрана или свернули приложение — отмеченное уходит сразу.
    func commitPending() {
        for id in pendingDone { Task { await commit(id) } }
    }

    private func commit(_ id: String) async {
        guard pendingDone.remove(id) != nil, let task = tasks.first(where: { $0.id == id }) else { return }
        await complete(task)
    }

    /// Новое дело руками — во «Всех делах» или сразу на сегодня.
    func create(_ title: String, today: Bool) async {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let due = today ? DueClock.dateOnly(Date()) : nil
        let local = EalzyTask(id: "local-\(UUID().uuidString)", title: trimmed, description: nil, status: "todo",
                              dueAt: due, estimateMinutes: nil, importance: nil, urgency: nil, kind: "task",
                              assignee: "user", completedAt: nil, createdAt: Date())
        tasks.append(local)
        if DemoData.isOn { return }
        do {
            let created: EalzyTask = try await APIClient.shared.post("/tasks", body: NewTask(title: trimmed, dueAt: due))
            replace(local.id) { $0 = created }
            errorMessage = nil
        } catch {
            tasks.removeAll { $0.id == local.id }
            errorMessage = error.localizedDescription
        }
        publishSnapshot()
        await ReminderScheduler.shared.reschedule(for: tasks)
    }

    func cancel(_ task: EalzyTask) async {
        replace(task.id) { $0.status = "cancelled" }
        await send(task.id, TaskPatch(status: "cancelled"))
    }

    func reschedule(_ task: EalzyTask, to date: Date) async {
        replace(task.id) { $0.dueAt = date }
        await send(task.id, TaskPatch(dueAt: date))
    }

    func publishSnapshot() {
        guard !tasks.isEmpty || errorMessage == nil else { return }
        var snapshot = WidgetSnapshot.make(plan: plan, agenda: calendarInfo)
        // Идущий фокус пишет FocusSession — его не трогаем.
        snapshot.focusRun = WidgetSnapshot.load()?.focusRun
        snapshot.save()
    }

    func load() async {
        if DemoData.isOn {
            tasks = DemoData.tasks
            return
        }
        isLoading = true
        defer { isLoading = false }
        do {
            tasks = try await APIClient.shared.get("/tasks")
            errorMessage = nil
            publishSnapshot()
            await ReminderScheduler.shared.reschedule(for: tasks)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func complete(_ task: EalzyTask) async {
        replace(task.id) { $0.status = "done"; $0.completedAt = Date() }
        await send(task.id, TaskPatch(status: "done"))
    }

    func moveToTomorrow(_ task: EalzyTask) async {
        let calendar = Calendar.current
        let base = task.dueAt ?? DueClock.dateOnly(Date())
        let next = calendar.date(byAdding: .day, value: 1, to: max(base, calendar.startOfDay(for: Date())))
            ?? base
        // У дела без времени оставляем «только день», у дела со временем — то же время завтра.
        let keepsClock = task.dueAt.map { !DueClock.isDateOnly($0) } ?? false
        let due = keepsClock ? next : DueClock.dateOnly(next)
        replace(task.id) { $0.dueAt = due }
        await send(task.id, TaskPatch(dueAt: due))
    }

    private func replace(_ id: String, _ change: (inout EalzyTask) -> Void) {
        guard let index = tasks.firstIndex(where: { $0.id == id }) else { return }
        change(&tasks[index])
    }

    private func send(_ id: String, _ patch: TaskPatch) async {
        do {
            let updated: EalzyTask = try await APIClient.shared.patch("/tasks/\(id)", body: patch)
            replace(id) { $0 = updated }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
            await load()
        }
        publishSnapshot()
        await ReminderScheduler.shared.reschedule(for: tasks)
    }
}
