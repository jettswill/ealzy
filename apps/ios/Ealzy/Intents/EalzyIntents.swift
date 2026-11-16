import AppIntents
import Foundation

/// «Скажи Илзи» — Siri, Команды, кнопка действия. Илзи сама решает: дело, мысль, вопрос.
struct TellIlziIntent: AppIntent {
    static var title: LocalizedStringResource = "Сказать Илзи"
    static var description = IntentDescription("Записать дело, мысль или задать вопрос Илзи — она разберёт сама.")

    @Parameter(title: "Что передать", requestValueDialog: IntentDialog("Что передать Илзи?"))
    var text: String

    static var parameterSummary: some ParameterSummary {
        Summary("Сказать Илзи \(\.$text)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
        let reply = try await TaskActions.tellIlzi(text)
        NotificationCenter.default.post(name: .ealzyTasksChanged, object: nil)
        return .result(value: reply, dialog: IntentDialog(stringLiteral: reply))
    }
}

/// «Что у меня сегодня» — фокус и что ещё на день, голосом.
struct TodayPlanIntent: AppIntent {
    static var title: LocalizedStringResource = "План на сегодня"
    static var description = IntentDescription("Фокус дня и что ещё сегодня.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let tasks: [EalzyTask] = try await APIClient.shared.get("/tasks")
        let plan = DayPlanner.plan(tasks)
        var lines = [plan.headline]
        if !plan.focus.isEmpty {
            lines.append("Фокус: " + plan.focus.map(\.title).joined(separator: "; ") + ".")
        }
        let rest = plan.overdue.count + plan.today.count + plan.quick.count
        if rest > 0 { lines.append("Ещё на сегодня: \(rest).") }
        if !plan.reserve.isEmpty { lines.append("В запасе \(plan.reserve.count), ничего не горит.") }
        return .result(dialog: IntentDialog(stringLiteral: lines.joined(separator: " ")))
    }
}

/// Сохранить текст заметкой в Ealzy. Для переноса «Заметок» iPhone через Команды:
/// «Найти заметки» → «Повторить с каждым» → «Сохранить в Ealzy».
struct SaveNoteIntent: AppIntent {
    static var title: LocalizedStringResource = "Сохранить заметку в Ealzy"
    static var description = IntentDescription("Переносит текст в заметки Ealzy, где Илзи сможет его найти.")

    @Parameter(title: "Текст")
    var text: String

    @Parameter(title: "Заголовок")
    var noteTitle: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Сохранить \(\.$text) в Ealzy")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try await TaskActions.saveNote(text, title: noteTitle)
        return .result(dialog: "Сохранила в Ealzy.")
    }
}

/// Открыть приложение сразу на быстрой записи — для кнопки действия и виджета.
struct OpenCaptureIntent: AppIntent {
    static var title: LocalizedStringResource = "Записать в Ealzy"
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRouter.shared.openCapture()
        return .result()
    }
}

struct EalzyShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: TellIlziIntent(),
            phrases: [
                "Скажи \(.applicationName)",
                "Запиши в \(.applicationName)",
                "Передай \(.applicationName)",
            ],
            shortTitle: "Сказать Илзи",
            systemImageName: "bubble.left"
        )
        AppShortcut(
            intent: TodayPlanIntent(),
            phrases: [
                "Что у меня сегодня в \(.applicationName)",
                "План на сегодня в \(.applicationName)",
            ],
            shortTitle: "План на сегодня",
            systemImageName: "sun.max"
        )
        AppShortcut(
            intent: OpenCaptureIntent(),
            phrases: ["Открой запись в \(.applicationName)"],
            shortTitle: "Записать",
            systemImageName: "square.and.pencil"
        )
    }
}
