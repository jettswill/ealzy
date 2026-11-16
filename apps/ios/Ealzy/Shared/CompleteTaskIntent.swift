import AppIntents
import Foundation

/// Кнопка «Готово» прямо в виджете (iOS 17, интерактивный виджет).
struct CompleteTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Отметить дело готовым"
    static var isDiscoverable = false

    @Parameter(title: "Дело")
    var taskId: String

    init() {}

    init(taskId: String) {
        self.taskId = taskId
    }

    func perform() async throws -> some IntentResult {
        await TaskActions.complete(id: taskId)
        return .result()
    }
}
