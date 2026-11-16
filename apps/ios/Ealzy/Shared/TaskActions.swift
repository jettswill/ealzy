import Foundation

struct TaskPatch: Encodable {
    var status: String?
    var dueAt: Date?
}

struct NewTask: Encodable {
    var title: String
    var description: String?
    var dueAt: Date?
}

/// Заметка Ealzy: документ ProseMirror, как в редакторе на сайте.
struct NoteUpsert: Encodable {
    struct Node: Encodable {
        let type: String
        var text: String?
        var content: [Node]?
    }
    let baseRevision = 0
    let clientMutationId: String
    let title: String
    let content: Node
    let plainText: String

    init(title: String, text: String) {
        clientMutationId = UUID().uuidString.lowercased()
        self.title = String(title.prefix(300))
        plainText = text
        let paragraphs = text.components(separatedBy: "\n").map { line -> Node in
            line.isEmpty ? Node(type: "paragraph") : Node(type: "paragraph", content: [Node(type: "text", text: line)])
        }
        content = Node(type: "doc", content: paragraphs.isEmpty ? [Node(type: "paragraph")] : paragraphs)
    }
}

private struct SavedNote: Decodable {
    let id: String
}

/// Действия без стора: из уведомлений, виджета, Siri — приложение может быть не запущено.
enum TaskActions {
    static func complete(id: String) async {
        let _: EalzyTask? = try? await APIClient.shared.patch("/tasks/\(id)", body: TaskPatch(status: "done"))
        WidgetSnapshot.markDone(id)
    }

    static func snooze(id: String, until date: Date) async {
        let _: EalzyTask? = try? await APIClient.shared.patch("/tasks/\(id)", body: TaskPatch(dueAt: date))
    }

    /// Сохранить заметку в Ealzy (перенос из «Заметок» iPhone через «Поделиться» или Команды).
    @discardableResult
    static func saveNote(_ text: String, title: String? = nil) async throws -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let heading = title ?? trimmed.components(separatedBy: "\n").first ?? ""
        let note: SavedNote = try await APIClient.shared.put(
            "/notes/\(UUID().uuidString.lowercased())",
            body: NoteUpsert(title: heading, text: trimmed)
        )
        return note.id
    }

    /// Сказать Илзи — она сама поймёт, дело это, мысль или вопрос. Возвращает ответ.
    static func tellIlzi(_ text: String) async throws -> String {
        let reply: ChatMessage = try await APIClient.shared.post(
            "/companion/messages",
            body: ["content": text, "source_channel": "mini_app"]
        )
        return reply.content
    }
}
