import EventKit
import SwiftUI

/// Главный экран: день, а не база дел.
struct TodayView: View {
    @Environment(TasksStore.self) private var tasks
    @Environment(ChatStore.self) private var chat
    @Environment(PhoneCalendar.self) private var calendar
    @Environment(AppRouter.self) private var router
    @State private var showReserve = false
    @State private var capture = ""
    @State private var lastReply: String?
    @FocusState private var captureFocused: Bool

    var body: some View {
        let plan = tasks.plan
        NavigationStack {
            List {
                Section {
                    Text(plan.headline)
                        .font(.headline)
                        .listRowBackground(Color.clear)
                }

                if let reply = lastReply {
                    Section {
                        HStack(alignment: .top) {
                            Text(MessageBubble.render(reply)).font(.callout)
                            Spacer()
                            Button { lastReply = nil } label: {
                                Image(systemName: "xmark").foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                        }
                    } header: { Text("Илзи") }
                }

                if !calendar.todayEvents.isEmpty {
                    Section("Расписание") {
                        // У повторяющихся событий один идентификатор на все повторы — берём порядок.
                        ForEach(Array(calendar.todayEvents.enumerated()), id: \.offset) { EventRow(event: $0.element) }
                    }
                }

                if !plan.focus.isEmpty {
                    Section("Фокус") {
                        ForEach(plan.focus) { TaskRow(task: $0, emphasis: true) }
                    }
                }
                if !plan.overdue.isEmpty {
                    Section("Просрочено") {
                        ForEach(plan.overdue) { TaskRow(task: $0) }
                    }
                }
                if !plan.today.isEmpty {
                    Section("Сегодня") {
                        ForEach(plan.today) { TaskRow(task: $0) }
                    }
                }
                if !plan.quick.isEmpty {
                    Section("Мелочи — в перерывах") {
                        ForEach(plan.quick) { TaskRow(task: $0) }
                    }
                }
                if !plan.forIlzi.isEmpty {
                    Section("Илзи делает сама") {
                        ForEach(plan.forIlzi) { TaskRow(task: $0, canComplete: false) }
                    }
                }
                if !plan.reserve.isEmpty {
                    Section {
                        DisclosureGroup(isExpanded: $showReserve) {
                            ForEach(plan.reserve) { TaskRow(task: $0) }
                        } label: {
                            Text("В запасе \(plan.reserve.count) — ничего не горит")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                if let error = tasks.errorMessage {
                    Section { Text(error).foregroundStyle(.red).font(.footnote) }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Self.dayTitle(Date()))
            .refreshable {
                await calendar.sync()
                tasks.nextEvent = calendar.nextEventItem
                await tasks.load()
            }
            .onChange(of: router.captureRequest) { captureFocused = true }
            .onAppear { if router.captureRequest > 0 { captureFocused = true } }
            .safeAreaInset(edge: .bottom) { captureBar }
            .overlay {
                if tasks.isLoading && tasks.tasks.isEmpty { ProgressView() }
            }
        }
    }

    /// Быстрая запись: всё уходит Илзи — она сама поймёт дату, время и что это вообще.
    private var captureBar: some View {
        HStack(spacing: 8) {
            TextField("Скажи Илзи: «позвонить маме завтра в 19»", text: $capture, axis: .vertical)
                .lineLimit(1...4)
                .focused($captureFocused)
                .submitLabel(.send)
                .onSubmit(sendCapture)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
            if chat.isSending {
                ProgressView().frame(width: 34)
            } else {
                Button(action: sendCapture) {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 34))
                }
                .disabled(capture.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }

    private func sendCapture() {
        let text = capture
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        capture = ""
        captureFocused = false
        Task {
            if let reply = await chat.send(text) { lastReply = reply.content }
            await tasks.load()
        }
    }

    static func dayTitle(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.setLocalizedDateFormatFromTemplate("EEEE d MMMM")
        return formatter.string(from: date).capitalized(with: Locale(identifier: "ru_RU"))
    }
}

struct EventRow: View {
    let event: EKEvent

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(event.isAllDay ? "весь день" : event.startDate.formatted(date: .omitted, time: .shortened))
                .font(.callout.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(minWidth: 52, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.title ?? "Событие")
                if let location = event.location, !location.isEmpty {
                    Text(location).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct TaskRow: View {
    @Environment(TasksStore.self) private var tasks
    @Environment(PhoneCalendar.self) private var calendar
    let task: EalzyTask
    var emphasis = false
    var canComplete = true

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            if canComplete {
                Button {
                    Task { await tasks.complete(task) }
                } label: {
                    Image(systemName: task.isOpen ? "circle" : "checkmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(task.isOpen ? Color.secondary : Color.accentColor)
                }
                .buttonStyle(.plain)
            } else {
                Image(systemName: "sparkles").foregroundStyle(Color.accentColor)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(task.title)
                    .font(emphasis ? .body.weight(.semibold) : .body)
                    .strikethrough(!task.isOpen)
                if let meta = meta { Text(meta).font(.caption).foregroundStyle(.secondary) }
            }
        }
        .swipeActions(edge: .trailing) {
            if canComplete {
                Button("Готово") { Task { await tasks.complete(task) } }.tint(.green)
                Button("Завтра") { Task { await tasks.moveToTomorrow(task) } }.tint(.orange)
            }
        }
        .swipeActions(edge: .leading) {
            if task.dueAt != nil {
                Button {
                    Task { _ = await calendar.addToCalendar(task) }
                } label: {
                    Label("В календарь", systemImage: "calendar.badge.plus")
                }
                .tint(.blue)
            }
        }
    }

    private var meta: String? { TaskMeta.text(for: task) }
}
