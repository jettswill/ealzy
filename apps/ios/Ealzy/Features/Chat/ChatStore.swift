import Foundation
import Observation

/// Тот же разговор с Илзи, что в Telegram и на сайте.
@MainActor
@Observable
final class ChatStore {
    private(set) var messages: [ChatMessage] = []
    private(set) var isSending = false
    var errorMessage: String?

    private var conversationId: String?
    private static let queueKey = "pendingCaptures"

    /// Сколько записей ждут сети.
    var pendingCount: Int { (UserDefaults.standard.stringArray(forKey: Self.queueKey) ?? []).count }

    /// Быстрая запись: без сети не теряется, а ждёт и уходит позже.
    func capture(_ text: String) async -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let reply = await send(trimmed) { return reply.content }
        if case .offline? = lastError as? APIError {
            var queue = UserDefaults.standard.stringArray(forKey: Self.queueKey) ?? []
            queue.append(trimmed)
            UserDefaults.standard.set(queue, forKey: Self.queueKey)
            errorMessage = nil
            return "Нет связи — записала у себя и передам Илзи, как появится интернет."
        }
        return nil
    }

    /// Отправить отложенные записи по одной, в том порядке, в каком их надиктовали.
    func flushQueue() async {
        var queue = UserDefaults.standard.stringArray(forKey: Self.queueKey) ?? []
        while let next = queue.first {
            guard await send(next) != nil else { break }
            queue.removeFirst()
            UserDefaults.standard.set(queue, forKey: Self.queueKey)
        }
    }

    private var lastError: Error?

    func load() async {
        LocalBrain.shared.warmUp()
        Task { await QuotaStore.shared.refresh() }
        if DemoData.isOn {
            messages = DemoData.messages
            return
        }
        do {
            if conversationId == nil {
                let conversation: Conversation = try await APIClient.shared.get("/conversations/primary")
                conversationId = conversation.id
            }
            guard let conversationId else { return }
            let loaded: [ChatMessage] = try await APIClient.shared.get(
                "/conversations/\(conversationId)/messages", query: ["limit": "50"]
            )
            messages = loaded
                .filter { $0.role != "system" }
                .sorted { ($0.createdAt ?? .distantPast) < ($1.createdAt ?? .distantPast) }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Отправить Илзи. Возвращает её ответ — для быстрой записи на экране «Сегодня».
    @discardableResult
    func send(_ text: String) async -> ChatMessage? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        isSending = true
        defer { isSending = false }
        let local = ChatMessage(id: "local-\(UUID().uuidString)", role: "user", content: trimmed, createdAt: Date())
        messages.append(local)
        if let reply = await answerOnPhone(trimmed) {
            messages.append(reply)
            errorMessage = nil
            lastError = nil
            return reply
        }
        if QuotaStore.shared.cloudPaused {
            let reply = await answerWhileCloudPaused(trimmed)
            messages.append(reply)
            return reply
        }
        do {
            let reply: ChatMessage = try await APIClient.shared.post(
                "/companion/messages",
                body: ["content": trimmed, "source_channel": "mini_app"]
            )
            messages.append(reply)
            errorMessage = nil
            lastError = nil
            Task { await QuotaStore.shared.refresh() }
            return reply
        } catch APIError.quota(let details) {
            QuotaStore.shared.update(details)
            let reply = await answerWhileCloudPaused(trimmed)
            messages.append(reply)
            errorMessage = nil
            lastError = nil
            return reply
        } catch {
            messages.removeAll { $0.id == local.id }
            lastError = error
            errorMessage = error.localizedDescription
            return nil
        }
    }

    /// Облачные запросы закончились: отвечает модель на iPhone, а если её нет — говорим, как продолжить.
    private func answerWhileCloudPaused(_ text: String) async -> ChatMessage {
        let quota = QuotaStore.shared.quota
        let content: String
        if let answer = await LocalBrain.shared.reply(to: text) {
            content = answer
        } else {
            let scope = quota?.periodWord ?? "сейчас"
            let when = quota?.returnText().map { " \($0)" } ?? ""
            content = "Облачные запросы \(scope) закончились\(when). Чтобы продолжать бесплатно, "
                + "включи «Илзи на iPhone» — кнопка над разговором или в «Ещё»."
        }
        return ChatMessage(id: "phone-\(UUID().uuidString)", role: "assistant", content: content, createdAt: Date())
    }

    /// Модель на iPhone: одно дело — записываем сами, «спасибо» — отвечаем сами.
    /// Всё остальное (и любой сбой) — как раньше, через сервер.
    private func answerOnPhone(_ text: String) async -> ChatMessage? {
        guard !DemoData.isOn, LocalBrain.shared.isActive,
              let decision = await LocalBrain.shared.decide(text) else { return nil }
        let now = Date()
        switch decision {
        case .cloud:
            return nil
        case .chat(let reply):
            return ChatMessage(id: "phone-\(UUID().uuidString)", role: "assistant", content: reply, createdAt: now)
        case .task(let title, let due):
            do {
                let created: EalzyTask = try await APIClient.shared.post(
                    "/tasks", body: NewTaskBody(title: title, dueAt: due)
                )
                let reply = LocalDecisionParser.confirmation(title: created.title, due: created.dueAt ?? due, now: now)
                return ChatMessage(id: "phone-\(UUID().uuidString)", role: "assistant", content: reply, createdAt: now)
            } catch {
                return nil
            }
        }
    }
}

/// Новое дело, записанное моделью на телефоне.
private struct NewTaskBody: Encodable {
    let title: String
    let dueAt: Date?
}
