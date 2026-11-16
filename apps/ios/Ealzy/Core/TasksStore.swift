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
    /// Ближайшее событие календаря — для виджета (ставит PhoneCalendar после синхронизации).
    var nextEvent: WidgetSnapshot.Item? {
        didSet { publishSnapshot() }
    }

    var plan: DayPlan { DayPlanner.plan(tasks) }

    func publishSnapshot() {
        guard !tasks.isEmpty || errorMessage == nil else { return }
        WidgetSnapshot.make(plan: plan, nextEvent: nextEvent).save()
    }

    func load() async {
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
        replace(task.id) { $0.status = "done" }
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
