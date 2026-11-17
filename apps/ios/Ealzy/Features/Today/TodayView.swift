import EventKit
import SwiftUI

/// Главный экран «Лампа»: лента дня, одно главное дело под светом лампы,
/// мелочи между делом, всё остальное — в запасе.
struct TodayView: View {
    @Environment(TasksStore.self) private var tasks
    @Environment(PhoneCalendar.self) private var calendar
    @Environment(AppRouter.self) private var router
    @Environment(FocusSession.self) private var focus
    @State private var openedEvent: OpenedEvent?
    @State private var openedTask: EalzyTask?
    @State private var pickingFocusFor: EalzyTask?

    var body: some View {
        let plan = tasks.plan
        let now = Date()
        let busy = busySpans
        let main = plan.focus.first
        let minutes = main?.estimateMinutes ?? 60
        let window = DayPlanner.focusWindow(minutes: minutes, busy: busy, now: now, dayEnd: dayEnd(now))

        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if focus.isRunning && !focus.isPresented {
                    FocusBanner().padding(.bottom, 10)
                }
                Text(Self.dayTitle(now))
                    .font(.subheadline)
                    .foregroundStyle(Palette.ink2)
                    .padding(.top, 8)

                DayRibbon(
                    events: ribbonEvents(now: now),
                    focus: main == nil ? nil : window,
                    now: now,
                    onEvent: { event in if let source = event.source { openedEvent = OpenedEvent(event: source) } },
                    onFocus: { if let main { pickingFocusFor = main } }
                )
                .padding(.top, 14)

                Text(note(plan: plan, busy: busy, now: now))
                    .font(.subheadline)
                    .foregroundStyle(Palette.ink2)
                    .padding(.top, 18)

                if let main {
                    FocusHeader(task: main, window: window, minutes: minutes) {
                        if focus.isRunning, focus.state?.taskId == main.id {
                            focus.isPresented = true
                        } else {
                            focus.start(main, minutes: minutes)
                        }
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    } change: {
                        pickingFocusFor = main
                    } open: {
                        openedTask = main
                    }
                    .padding(.top, 8)
                    if plan.focus.count > 1 {
                        Text("Ещё в фокусе сегодня: \(plan.focus[1].title)")
                            .font(.footnote)
                            .foregroundStyle(Palette.ink2)
                            .padding(.top, 14)
                    }
                } else {
                    Text(plan.headline)
                        .font(Typeface.display(28))
                        .foregroundStyle(Palette.ink)
                        .padding(.top, 10)
                }

                betweenTasks(plan)
                    .padding(.top, 28)
            }
            .padding(.horizontal, 24)
            .padding(.top, 44) // место под «Ещё» справа вверху
            .padding(.bottom, 120) // место под вкладками и кнопкой Илзи
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable {
            await calendar.sync()
            tasks.nextEvent = calendar.nextEventItem
            await tasks.load()
        }
        .overlay {
            if tasks.isLoading && tasks.tasks.isEmpty { ProgressView() }
        }
        .sheet(item: $openedEvent) { EventDetailView(event: $0.event) }
        .sheet(item: $openedTask) { TaskDetailView(task: $0) }
        .sheet(item: $pickingFocusFor) { FocusPickerView(current: $0) }
    }

    // MARK: Между делом

    @ViewBuilder
    private func betweenTasks(_ plan: DayPlan) -> some View {
        let items = plan.overdue + plan.today + plan.quick
        let minutes = items.compactMap(\.estimateMinutes).reduce(0, +)
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(minutes > 0 ? "Между делом · \(minutes) мин" : "Между делом")
                Spacer()
                if !plan.reserve.isEmpty {
                    Button("ещё \(plan.reserve.count) в запасе") { withAnimation { router.tab = .reserve } }
                        .foregroundStyle(Palette.ink2)
                }
            }
            .font(.footnote)
            .foregroundStyle(Palette.ink2)
            .padding(.bottom, 6)

            if items.isEmpty {
                Text("Мелочей на сегодня нет.")
                    .font(.subheadline)
                    .foregroundStyle(Palette.ink3)
                    .padding(.vertical, 6)
            }
            ForEach(items) { TaskRow(task: $0) }
            if let error = tasks.errorMessage {
                Text(error).font(.footnote).foregroundStyle(.red).padding(.top, 8)
            }
        }
    }

    // MARK: Календарь → лента

    private var busySpans: [TimeSpan] {
        calendar.todayEvents
            .filter { !$0.isAllDay }
            .map { TimeSpan(start: $0.startDate, end: $0.endDate) }
    }

    private func ribbonEvents(now: Date) -> [DayRibbon.Event] {
        calendar.todayEvents.filter { !$0.isAllDay }.map {
            DayRibbon.Event(title: $0.title ?? "Событие", start: $0.startDate, end: $0.endDate,
                            isPast: $0.endDate <= now, source: $0)
        }
    }

    private func dayEnd(_ now: Date) -> Date {
        Calendar.current.date(bySettingHour: 22, minute: 0, second: 0, of: now) ?? now
    }

    /// Одна фраза Илзи: сколько свободно до следующего события и что она делает сама.
    private func note(plan: DayPlan, busy: [TimeSpan], now: Date) -> String {
        var parts: [String] = []
        if let next = DayPlanner.nextBusy(after: now, busy: busy) {
            let time = next.start.formatted(date: .omitted, time: .shortened)
            parts.append("Свободно до \(time) — \(Self.duration(next.start.timeIntervalSince(now))).")
        } else if calendar.isSyncEnabled {
            parts.append("Встреч до вечера больше нет.")
        }
        if !plan.forIlzi.isEmpty {
            parts.append("\(plan.forIlzi.count) \(Self.plural(plan.forIlzi.count, "дело", "дела", "дел")) делаю сама.")
        }
        return parts.isEmpty ? plan.headline : parts.joined(separator: " ")
    }

    // MARK: Форматирование

    /// «Вторник, 17 ноября» — с заглавной только первая буква.
    static func dayTitle(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.setLocalizedDateFormatFromTemplate("EEEE d MMMM")
        let text = formatter.string(from: date)
        return text.prefix(1).uppercased() + text.dropFirst()
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let minutes = max(Int(seconds / 60), 0)
        let h = minutes / 60, m = minutes % 60
        if h == 0 { return "\(m) мин" }
        return m == 0 ? "\(h) ч" : "\(h) ч \(m) мин"
    }

    static func plural(_ n: Int, _ one: String, _ few: String, _ many: String) -> String {
        let mod10 = n % 10, mod100 = n % 100
        if mod10 == 1 && mod100 != 11 { return one }
        if (2...4).contains(mod10) && !(12...14).contains(mod100) { return few }
        return many
    }
}

// MARK: - Главное дело

struct FocusHeader: View {
    let task: EalzyTask
    let window: TimeSpan?
    let minutes: Int
    let start: () -> Void
    let change: () -> Void
    let open: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: open) {
                Self.title(task.title, size: 38)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Открыть дело")
            Text(meta)
                .font(.subheadline)
                .foregroundStyle(Palette.ink2)
                .padding(.top, 12)
            HStack(spacing: 6) {
                Button(action: start) {
                    Label("Начать, \(TodayView.duration(TimeInterval(minutes * 60)))", systemImage: "play.fill")
                        .font(.body.weight(.semibold))
                        .padding(.horizontal, 22)
                        .frame(height: 50)
                        .background(Palette.gold, in: Capsule())
                        .foregroundStyle(Palette.goldInk)
                }
                Button("Сменить", action: change)
                    .padding(.horizontal, 14)
                    .frame(height: 50)
                    .foregroundStyle(Palette.ink2)
            }
            .padding(.top, 18)
        }
    }

    private var meta: AttributedString {
        var parts: [String] = []
        if let window {
            let f = { (d: Date) in d.formatted(date: .omitted, time: .shortened) }
            parts.append("\(f(window.start))–\(f(window.end))")
        }
        var dueCopy = task
        dueCopy.estimateMinutes = nil
        if let when = TaskMeta.text(for: dueCopy), !when.isEmpty {
            parts.append(when == "просрочено" ? when : "срок: \(when)")
        }
        var text = AttributedString(parts.joined(separator: " · "))
        if window != nil, let first = parts.first, let range = text.range(of: first) {
            text[range].foregroundColor = Palette.ink
            text[range].font = .subheadline.weight(.semibold)
        }
        return text
    }

    /// Название дела крупно, а то, что в «ёлочках», — курсивом и золотом.
    static func title(_ title: String, size: CGFloat) -> Text {
        let font = Typeface.display(size)
        guard let open = title.firstIndex(of: "«"),
              let close = title[open...].firstIndex(of: "»") else {
            return Text(title).font(font).foregroundColor(Palette.ink)
        }
        let before = String(title[..<open])
        let quoted = String(title[open...close])
        let after = String(title[title.index(after: close)...])
        return Text(before).font(font).foregroundColor(Palette.ink)
            + Text(quoted).font(font).italic().foregroundColor(Palette.goldText)
            + Text(after).font(font).foregroundColor(Palette.ink)
    }
}

// MARK: - Строка дела

struct TaskRow: View {
    @Environment(TasksStore.self) private var tasks
    @Environment(PhoneCalendar.self) private var calendar
    let task: EalzyTask
    var canComplete = true
    @State private var showDetail = false

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            if canComplete {
                Button {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    Task { await tasks.complete(task) }
                } label: {
                    Image(systemName: task.isOpen ? "circle" : "checkmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(task.isOpen ? Palette.ink3 : Palette.goldText)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Готово")
            } else {
                Image(systemName: "hourglass").foregroundStyle(Palette.goldText).frame(width: 22)
            }
            Button { showDetail = true } label: {
                HStack {
                    Text(task.title)
                        .font(.subheadline)
                        .foregroundStyle(Palette.ink)
                        .strikethrough(!task.isOpen)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    if let meta = TaskMeta.text(for: task) {
                        Text(meta).font(.footnote).foregroundStyle(Palette.ink2).lineLimit(1)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 7)
        .contentShape(Rectangle())
        .sheet(isPresented: $showDetail) { TaskDetailView(task: task) }
        .contextMenu {
            if canComplete {
                Button { Task { await tasks.complete(task) } } label: { Label("Готово", systemImage: "checkmark") }
                Button { Task { await tasks.moveToTomorrow(task) } } label: { Label("На завтра", systemImage: "arrow.right") }
            }
            if task.dueAt != nil {
                Button { Task { _ = await calendar.addToCalendar(task) } } label: {
                    Label("В календарь", systemImage: "calendar.badge.plus")
                }
            }
        }
    }
}

/// EKEvent для .sheet(item:).
struct OpenedEvent: Identifiable {
    let id = UUID()
    let event: EKEvent
}
