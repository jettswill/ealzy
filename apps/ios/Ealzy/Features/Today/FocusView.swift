import SwiftUI

/// Режим фокуса: пока дело идёт, приложение — это одно дело под светом лампы.
/// Лента дня сверху, отсчёт, и только нужное: пауза, готово, спросить Илзи,
/// записать мысль на потом, выйти из фокуса. Остальных дел здесь нет — они подождут.
struct FocusView: View {
    @Environment(FocusSession.self) private var focus
    @Environment(TasksStore.self) private var tasks
    @Environment(PhoneCalendar.self) private var calendar
    @Environment(AppRouter.self) private var router
    @State private var confirmExit = false
    @State private var openedEvent: OpenedEvent?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = focus.remaining(at: context.date)
            let planned = TimeInterval((focus.state?.plannedMinutes ?? 60) * 60)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Circle().fill(Palette.gold).frame(width: 7, height: 7)
                    Text(focus.isPaused ? "ФОКУС НА ПАУЗЕ" : "РЕЖИМ ФОКУСА")
                        .font(.caption.weight(.semibold))
                        .tracking(0.6)
                        .foregroundStyle(Palette.goldText)
                    Text("· \(endText)")
                        .font(.caption)
                        .foregroundStyle(Palette.ink3)
                }
                .padding(.top, 14)

                DayRibbon(
                    events: ribbonEvents(now: context.date),
                    focus: focusSpan(remaining: remaining, at: context.date),
                    now: context.date,
                    onEvent: { event in if let source = event.source { openedEvent = OpenedEvent(event: source) } }
                )
                .frame(height: 76)
                .padding(.top, 16)

                Spacer(minLength: 24)

                FocusHeader.title(focus.state?.title ?? "", size: 34)
                    .fixedSize(horizontal: false, vertical: true)
                    .lineLimit(4)

                Text(Self.clock(remaining))
                    .font(.system(size: 76, weight: .light))
                    .monospacedDigit()
                    .tracking(-2)
                    .foregroundStyle(remaining >= 0 ? Palette.ink : Palette.goldText)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .contentTransition(.numericText(countsDown: true))
                    .padding(.top, 18)
                Text(remaining >= 0
                     ? "осталось из \(TodayView.duration(planned))"
                     : "время вышло — закончи или продолжай")
                    .font(.subheadline)
                    .foregroundStyle(Palette.ink3)

                ProgressView(value: min(max(1 - remaining / max(planned, 1), 0), 1))
                    .tint(Palette.gold)
                    .padding(.top, 18)

                Spacer(minLength: 24)

                HStack(spacing: 10) {
                    Button {
                        focus.togglePause()
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    } label: {
                        Label(focus.isPaused ? "Продолжить" : "Пауза", systemImage: focus.isPaused ? "play.fill" : "pause.fill")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 54)
                            .overlay(Capsule().strokeBorder(Palette.rule))
                            .foregroundStyle(Palette.ink)
                    }
                    Button(action: finish) {
                        Label("Готово", systemImage: "checkmark")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 54)
                            .background(Palette.gold, in: Capsule())
                            .foregroundStyle(Palette.goldInk)
                    }
                }

                HStack(spacing: 0) {
                    tool("Илзи", image: Image("IlziMark")) { router.openIlzi() }
                    tool("Записать", image: Image(systemName: "square.and.pencil")) { router.openCapture() }
                    tool("Выйти", image: Image(systemName: "xmark.circle")) { confirmExit = true }
                        .accessibilityLabel("Выйти из фокуса")
                }
                .padding(.top, 14)
                .padding(.bottom, 6)
            }
            .padding(.horizontal, 24)
        }
        .background { LampBackground(narrow: true) }
        .confirmationDialog("Выйти из фокуса?", isPresented: $confirmExit, titleVisibility: .visible) {
            Button("Выйти, дело останется на сегодня") { focus.finish() }
            Button("Убрать дело совсем", role: .destructive) { cancelTask() }
        } message: {
            Text("Таймер сбросится.")
        }
        .sheet(item: $openedEvent) { EventDetailView(event: $0.event) }
    }

    /// Кнопка второго ряда: иконка над подписью, как в нижней панели.
    private func tool(_ title: String, image: Image, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                image
                    .resizable()
                    .scaledToFit()
                    .frame(width: 22, height: 22)
                Text(title).font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(Palette.ink2)
            .frame(maxWidth: .infinity, minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func ribbonEvents(now: Date) -> [DayRibbon.Event] {
        calendar.todayEvents.filter { !$0.isAllDay }.map {
            DayRibbon.Event(title: $0.title ?? "Событие", start: $0.startDate, end: $0.endDate,
                            isPast: $0.endDate <= now, source: $0)
        }
    }

    /// На ленте — сам фокус: от начала до того, когда выйдет время.
    private func focusSpan(remaining: TimeInterval, at now: Date) -> TimeSpan? {
        guard focus.state != nil else { return nil }
        let elapsed = focus.elapsed(at: now)
        return TimeSpan(start: now.addingTimeInterval(-elapsed), end: now.addingTimeInterval(max(remaining, 0)))
    }

    private func cancelTask() {
        guard let id = focus.state?.taskId, let task = tasks.tasks.first(where: { $0.id == id }) else {
            focus.finish()
            return
        }
        focus.finish()
        Task { await tasks.cancel(task) }
    }

    private var endText: String {
        guard let state = focus.state else { return "" }
        let end = state.startedAt.addingTimeInterval(TimeInterval(state.plannedMinutes * 60) - state.banked)
        return "до \(end.formatted(date: .omitted, time: .shortened))"
    }

    private func finish() {
        guard let id = focus.state?.taskId,
              let task = tasks.tasks.first(where: { $0.id == id }) else {
            focus.finish()
            return
        }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        focus.finish()
        Task { await tasks.complete(task) }
    }

    static func clock(_ seconds: TimeInterval) -> String {
        let total = Int(abs(seconds).rounded(.down))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        let sign = seconds < 0 ? "+" : ""
        return h > 0
            ? String(format: "%@%d:%02d:%02d", sign, h, m, s)
            : String(format: "%@%d:%02d", sign, m, s)
    }
}
