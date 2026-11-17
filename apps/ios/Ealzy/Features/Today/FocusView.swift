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
            let phase = focus.phase(at: context.date)
            let planned = phase?.length ?? TimeInterval((focus.state?.plannedMinutes ?? 60) * 60)
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Circle().fill(phase?.isBreak == true ? Palette.ink3 : Palette.gold).frame(width: 7, height: 7)
                    Text(headerText(phase))
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
                    .foregroundStyle(remaining < 0 ? Palette.goldText : (phase?.isBreak == true ? Palette.ink2 : Palette.ink))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .contentTransition(.numericText(countsDown: true))
                    .padding(.top, 18)
                Text(subtitle(phase: phase, remaining: remaining, planned: planned))
                    .font(.subheadline)
                    .foregroundStyle(Palette.ink3)
                if phase?.isBreak == true {
                    Button("Пропустить перерыв") {
                        focus.skipBreak()
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.goldText)
                    .padding(.top, 8)
                }

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
            .onChange(of: phase.map { "\($0.round)-\($0.isBreak)" }) {
                // Сменилась фаза помодоро: тактильно отметить и обновить виджет и Dynamic Island.
                UINotificationFeedbackGenerator().notificationOccurred(.warning)
                focus.refreshExternal()
            }
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

    private func headerText(_ phase: Pomodoro.Phase?) -> String {
        if focus.isPaused { return "ФОКУС НА ПАУЗЕ" }
        guard let phase else { return "РЕЖИМ ФОКУСА" }
        if phase.isBreak { return "ПЕРЕРЫВ" }
        let estimate = tasks.tasks.first(where: { $0.id == focus.state?.taskId })?.estimateMinutes
        if let total = focus.state?.pomodoro?.rounds(forEstimate: estimate), total >= phase.round {
            return "ПОМИДОР \(phase.round) ИЗ \(total)"
        }
        return "ПОМИДОР \(phase.round)"
    }

    private func subtitle(phase: Pomodoro.Phase?, remaining: TimeInterval, planned: TimeInterval) -> String {
        if let phase, let pomodoro = focus.state?.pomodoro {
            return phase.isBreak
                ? "перерыв — встань, разомнись, отойди от экрана"
                : "работа \(pomodoro.workMinutes) мин · потом перерыв \(pomodoro.breakMinutes)"
        }
        return remaining >= 0
            ? "осталось из \(TodayView.duration(planned))"
            : "время вышло — закончи или продолжай"
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
        guard focus.state != nil else { return "" }
        let end = Date().addingTimeInterval(max(focus.remaining(), 0))
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
