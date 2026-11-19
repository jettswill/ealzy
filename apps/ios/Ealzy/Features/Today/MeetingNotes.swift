import EventKit
import Observation
import SwiftUI

// MARK: - Данные

/// Встреча из календаря телефона, к которой пишем заметки.
/// Ключ — id события в календаре + время начала: у повторяющейся встречи id общий.
struct MeetingRef: Hashable {
    let externalId: String
    let startsAt: Date
    let endsAt: Date
    let title: String

    init(event: EKEvent) {
        externalId = event.calendarItemIdentifier
        startsAt = event.startDate
        endsAt = max(event.endDate, event.startDate.addingTimeInterval(60))
        title = String((event.title?.isEmpty == false ? event.title! : "Встреча").prefix(300))
    }

    var draftKey: String { "meetingNoteDraft|\(externalId)|\(ISODates.format(startsAt))" }
    var isNow: Bool { startsAt <= Date() && Date() < endsAt }
}

private struct MeetingNotePayload: Decodable {
    let noteId: String
    let body: String
    let revision: Int
}

private struct MeetingNoteSave: Encodable {
    let externalId: String
    let startsAt: Date
    let endsAt: Date
    let title: String
    let body: String
    let clientMutationId: String
}

/// Заметка одной встречи: грузит с сервера, сохраняет сама, пока пишешь.
/// Черновик дублируется на телефоне — без связи текст не пропадёт и уйдёт позже.
@MainActor
@Observable
final class MeetingNoteStore {
    enum Status: Equatable { case idle, loading, saving, saved, offline }

    let meeting: MeetingRef
    var text = ""
    private(set) var status: Status = .idle
    private(set) var savedText = ""
    private var loaded = false
    /// Открыли без связи: не знаем, что уже лежит на сервере, — перед записью сверимся.
    private var serverUnknown = false
    private var saveTask: Task<Void, Never>?

    init(meeting: MeetingRef) {
        self.meeting = meeting
    }

    var hasUnsaved: Bool { text != savedText }

    func load() async {
        guard !loaded else { return }
        status = .loading
        let draft = UserDefaults.standard.string(forKey: meeting.draftKey)
        var server: String? = ""
        if !DemoData.isOn { server = await fetchServerText() }
        if server == nil { serverUnknown = true }
        savedText = server ?? ""
        text = draft ?? server ?? ""
        loaded = true
        status = server == nil ? .offline : .idle
        // Остался несохранённый черновик с прошлого раза — досылаем.
        if hasUnsaved { await save() }
    }

    /// Текст с сервера; nil — сервер не ответил (а не «заметки нет»).
    private func fetchServerText() async -> String? {
        do {
            let payload: MeetingNotePayload? = try await APIClient.shared.get(
                "/calendar/meeting-note",
                query: [
                    "external_id": meeting.externalId,
                    "starts_at": ISODates.format(meeting.startsAt),
                ]
            )
            return payload?.body ?? ""
        } catch {
            return nil
        }
    }

    /// Текст поменялся в редакторе: черновик на телефон, сохранение — после паузы.
    func edited() {
        guard loaded else { return }
        UserDefaults.standard.set(text, forKey: meeting.draftKey)
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.2))
            guard !Task.isCancelled else { return }
            await self?.save()
        }
    }

    /// Сохранить сейчас (по паузе в наборе, «Готово», уходу из приложения).
    func save() async {
        guard loaded, hasUnsaved else { return }
        let sending = text
        if DemoData.isOn {
            savedText = sending
            status = .saved
            return
        }
        status = .saving
        if serverUnknown {
            guard let server = await fetchServerText() else {
                status = .offline
                return
            }
            serverUnknown = false
            // Не затираем то, что уже было записано раньше (например, с сайта).
            let mine = sending.trimmingCharacters(in: .whitespacesAndNewlines)
            if !server.isEmpty && !mine.isEmpty && !sending.hasPrefix(server) && server != sending {
                text = server + "\n\n" + sending
                savedText = server
                await save()
                return
            }
        }
        let outgoing = text
        do {
            let result: MeetingNotePayload = try await APIClient.shared.put(
                "/calendar/meeting-note",
                body: MeetingNoteSave(
                    externalId: meeting.externalId,
                    startsAt: meeting.startsAt,
                    endsAt: meeting.endsAt,
                    title: meeting.title,
                    body: outgoing,
                    clientMutationId: UUID().uuidString.lowercased()
                )
            )
            savedText = result.body
            if text == outgoing {
                UserDefaults.standard.removeObject(forKey: meeting.draftKey)
                status = .saved
            }
        } catch {
            status = .offline
        }
    }

    func flush() {
        saveTask?.cancel()
        Task { await save() }
    }
}

// MARK: - Карточка в шторке события

/// «Заметки со встречи» под описанием события: превью и вход в редактор.
struct MeetingNotesCard: View {
    let store: MeetingNoteStore

    var body: some View {
        NavigationLink {
            MeetingNotesView(store: store)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "square.and.pencil")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(Palette.goldText)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Palette.ink)
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(Palette.ink2)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.ink3)
                    .padding(.top, 3)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(store.meeting.isNow ? Palette.pool : Palette.pill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Palette.rule)
            )
        }
        .buttonStyle(.plain)
        .accessibilityHint("Открыть заметки со встречи")
    }

    private var trimmed: String { store.text.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var title: String {
        if !trimmed.isEmpty { return "Заметки со встречи" }
        return store.meeting.isNow ? "Идёт сейчас — записать заметки" : "Записать заметки"
    }

    private var subtitle: String {
        if store.status == .loading { return "Загружаю…" }
        if !trimmed.isEmpty { return trimmed }
        return "Что обсудили, о чём договорились. Илзи запомнит."
    }
}

// MARK: - Редактор

struct MeetingNotesView: View {
    @Bindable var store: MeetingNoteStore
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text(store.meeting.title)
                    .font(Typeface.display(24))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    if store.meeting.isNow {
                        Circle().fill(Palette.gold).frame(width: 7, height: 7)
                        Text("идёт сейчас").foregroundStyle(Palette.goldText)
                        Text("·").foregroundStyle(Palette.ink3)
                    }
                    Text(timeText).foregroundStyle(Palette.ink2)
                    Spacer()
                    statusLabel
                }
                .font(.footnote.weight(.medium))
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 12)

            ZStack(alignment: .topLeading) {
                if store.text.isEmpty {
                    Text("Что обсудили, кто что делает, к какому сроку…")
                        .font(.body)
                        .foregroundStyle(Palette.ink3)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 8)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $store.text)
                    .font(.body)
                    .foregroundStyle(Palette.ink)
                    .scrollContentBackground(.hidden)
                    .focused($focused)
            }
            .padding(.horizontal, 19)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Palette.raised.ignoresSafeArea())
        .navigationTitle("Заметки")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Готово") {
                    focused = false
                    store.flush()
                }
                .foregroundStyle(Palette.goldText)
            }
        }
        .task {
            await store.load()
            if store.text.isEmpty { focused = true }
        }
        .onChange(of: store.text) { _, _ in store.edited() }
        .onDisappear { store.flush() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { store.flush() }
        }
    }

    @ViewBuilder private var statusLabel: some View {
        switch store.status {
        case .loading:
            ProgressView().controlSize(.mini)
        case .saving:
            Text("Сохраняю…").foregroundStyle(Palette.ink3)
        case .saved:
            Label("В Илзи", systemImage: "checkmark").foregroundStyle(Palette.ink3)
        case .offline:
            Text("Нет связи — сохраню позже").foregroundStyle(Palette.ink3)
        case .idle:
            EmptyView()
        }
    }

    private var timeText: String {
        let f = { (d: Date) in d.formatted(date: .omitted, time: .shortened) }
        let day = store.meeting.startsAt.formatted(.dateTime.day().month(.abbreviated))
        return "\(day), \(f(store.meeting.startsAt))–\(f(store.meeting.endsAt))"
    }
}

// MARK: - Встреча идёт сейчас (экран «Сегодня»)

/// Плашка под лентой дня: идёт встреча — одно касание до заметок.
struct LiveMeetingChip: View {
    let title: String
    let ends: Date
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 10) {
                Circle().fill(Palette.gold).frame(width: 8, height: 8)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Идёт сейчас · до \(ends.formatted(date: .omitted, time: .shortened))")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.goldText)
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Label("Заметки", systemImage: "square.and.pencil")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.goldInk)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(Palette.gold, in: Capsule())
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Palette.pool)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Идёт встреча \(title). Открыть заметки")
    }
}
