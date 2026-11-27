import Foundation
import Observation

/// Ход одной сессии: рассказ (голосом и/или текстом) → разбор Илзи → человек
/// снимает лишнее → записываем дела и цели, мысли — в заметку сессии.
/// Рассказ не теряется: черновик и нераспознанная запись лежат на телефоне,
/// пока сессия не разобрана.
@MainActor
@Observable
final class SessionStore {
    enum Stage: Equatable {
        case compose
        case transcribing
        case thinking
        case review
        case applying
        case done
    }

    var mode: SessionMode
    private(set) var stage: Stage = .compose
    var transcript: String
    var errorMessage: String?

    private(set) var session: LifeSessionDTO?
    /// Отмеченные к записи дела и новые цели.
    var pickedTasks: Set<String> = []
    var pickedGoals: Set<String> = []
    /// Человек передвинул дело в другую корзину или поправил название.
    var buckets: [String: SessionBucket] = [:]
    var titles: [String: String] = [:]
    var nowKey: String?
    private(set) var result: SessionResult?
    /// Запись, которую не удалось распознать (нет сети) — можно отправить ещё раз.
    private(set) var unsentAudio: Data?

    private static let draftKey = "sessionDraft"
    private static let audioURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("unsent-session.m4a")

    init(mode: SessionMode) {
        self.mode = mode
        transcript = UserDefaults.standard.string(forKey: Self.draftKey) ?? ""
        unsentAudio = try? Data(contentsOf: Self.audioURL)
    }

    var proposal: SessionProposal? { session?.proposal }

    /// Черновик рассказа живёт на телефоне, пока сессия не разобрана.
    func saveDraft() {
        UserDefaults.standard.set(transcript, forKey: Self.draftKey)
    }

    func bucket(of task: SessionTask) -> SessionBucket { buckets[task.key] ?? task.bucket }
    func title(of task: SessionTask) -> String { titles[task.key] ?? task.title }

    var pickedCount: Int { pickedTasks.count }

    // MARK: Рассказ

    /// Распознать запись и дописать к рассказу.
    func transcribe(_ audio: Data) async {
        stage = .transcribing
        errorMessage = nil
        defer { if stage == .transcribing { stage = .compose } }
        do {
            struct Heard: Decodable { let text: String }
            let heard: Heard = try await APIClient.shared.upload(
                "/sessions/transcribe", data: audio, contentType: "audio/mp4"
            )
            append(heard.text)
            unsentAudio = nil
            try? FileManager.default.removeItem(at: Self.audioURL)
        } catch {
            unsentAudio = audio
            try? audio.write(to: Self.audioURL)
            errorMessage = Self.message(for: error, fallback: "Не получилось распознать запись. Она сохранена — попробуй ещё раз.")
        }
    }

    func retryUnsent() async {
        guard let audio = unsentAudio else { return }
        await transcribe(audio)
    }

    private func append(_ text: String) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        transcript = transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? clean
            : transcript.trimmingCharacters(in: .whitespacesAndNewlines) + "\n" + clean
        saveDraft()
    }

    // MARK: Разбор

    func analyze() async {
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        stage = .thinking
        errorMessage = nil
        struct Body: Encodable { let mode: SessionMode; let text: String }
        do {
            let session: LifeSessionDTO = try await APIClient.shared.postLong(
                "/sessions", body: Body(mode: mode, text: text)
            )
            show(session)
        } catch {
            stage = .compose
            errorMessage = Self.message(for: error, fallback: "Илзи не смогла разобрать. Рассказ сохранён — попробуй ещё раз.")
        }
    }

    /// Открыть разбор (новый или из прошлых сессий).
    func show(_ session: LifeSessionDTO) {
        self.session = session
        mode = session.mode
        let tasks = session.proposal.tasks
        // По умолчанию отмечено всё, кроме «когда-нибудь»: это идеи, их человек берёт сам.
        pickedTasks = Set(tasks.filter { $0.bucket != .someday }.map(\.key))
        pickedGoals = Set(session.proposal.goals.filter(\.isNew).map(\.key))
        nowKey = session.proposal.now?.taskKey
        buckets = [:]
        titles = [:]
        if let result = session.result, session.appliedAt != nil {
            self.result = result
            stage = .done
        } else {
            stage = .review
        }
    }

    func toggle(_ task: SessionTask) {
        if pickedTasks.contains(task.key) {
            pickedTasks.remove(task.key)
            if nowKey == task.key { nowKey = nil }
        } else {
            pickedTasks.insert(task.key)
        }
    }

    func move(_ task: SessionTask, to bucket: SessionBucket) {
        if bucket == .now {
            // «Сейчас» — одно дело: прежнее уходит в «сегодня».
            if let previous = nowKey, previous != task.key { buckets[previous] = .today }
            nowKey = task.key
        } else if nowKey == task.key {
            nowKey = nil
        }
        buckets[task.key] = bucket
        pickedTasks.insert(task.key)
    }

    func makeNow(_ task: SessionTask) { move(task, to: .now) }

    // MARK: Принять

    func apply(tasks store: TasksStore) async {
        guard let session else { return }
        stage = .applying
        errorMessage = nil
        let ordered = session.proposal.tasks.filter { pickedTasks.contains($0.key) }
        let body = ApplySessionBody(
            tasks: ordered.map { task in
                ApplySessionBody.Choice(
                    key: task.key,
                    title: titles[task.key].flatMap { $0 == task.title ? nil : $0 },
                    bucket: task.key == nowKey ? .now : buckets[task.key]
                )
            },
            goals: session.proposal.goals.filter { $0.isNew && pickedGoals.contains($0.key) }.map(\.key),
            nowKey: nowKey.flatMap { pickedTasks.contains($0) ? $0 : nil },
            saveThoughts: true
        )
        do {
            let result: SessionResult = try await APIClient.shared.postLong(
                "/sessions/\(session.id)/apply", body: body
            )
            self.result = result
            transcript = ""
            UserDefaults.standard.removeObject(forKey: Self.draftKey)
            await store.load()
            if let id = result.nowTaskId, let task = store.tasks.first(where: { $0.id == id }) {
                store.pinFocus(task)
            }
            stage = .done
        } catch {
            stage = .review
            errorMessage = Self.message(for: error, fallback: "Не получилось записать. Попробуй ещё раз.")
        }
    }

    /// Начать новую сессию с чистого листа.
    func reset() {
        session = nil
        result = nil
        stage = .compose
        errorMessage = nil
    }

    var nowTask: SessionTask? {
        guard let nowKey else { return nil }
        return proposal?.tasks.first { $0.key == nowKey }
    }

    private static func message(for error: Error, fallback: String) -> String {
        switch error as? APIError {
        case .offline?: return "Нет связи. " + fallback
        case .quota?: return "Облачные запросы закончились — разбор сессии работает через облако. Рассказ сохранён."
        case .unauthorized?: return "Нужно войти заново."
        default: return fallback
        }
    }
}
