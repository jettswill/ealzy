import SwiftUI

/// Перед фокусом человек сам решает, сколько времени дать делу: по умолчанию полчаса,
/// ±5 минут кнопками. Если не успеть до встречи — предупреждаем и предлагаем уложиться.
struct StartFocusSheet: View {
    @Environment(FocusSession.self) private var focus
    @Environment(PhoneCalendar.self) private var calendar
    @Environment(\.dismiss) private var dismiss
    @AppStorage(Pomodoro.enabledKey) private var pomodoroOn = false
    @AppStorage(Pomodoro.formatKey) private var pomodoroFormat = Pomodoro.formats[1].key
    let task: EalzyTask
    @State private var minutes = 30

    static let step = 5
    static let range = 5...240

    var body: some View {
        let now = Date()
        let conflict = DayPlanner.focusConflict(minutes: minutes, now: now, events: slots)
        VStack(alignment: .leading, spacing: 0) {
            Text("Сколько времени даёшь делу?")
                .font(.footnote)
                .foregroundStyle(Palette.ink3)
            FocusHeader.title(task.title, size: 24)
                .lineLimit(2)
                .padding(.top, 6)

            HStack(spacing: 0) {
                stepButton("minus", by: -Self.step)
                Spacer(minLength: 8)
                VStack(spacing: 2) {
                    Text(TodayView.duration(TimeInterval(minutes * 60)))
                        .font(.system(size: 44, weight: .light))
                        .monospacedDigit()
                        .foregroundStyle(Palette.ink)
                        .contentTransition(.numericText())
                    Text("до \(now.addingTimeInterval(TimeInterval(minutes * 60)).formatted(date: .omitted, time: .shortened))")
                        .font(.subheadline)
                        .foregroundStyle(Palette.ink3)
                }
                Spacer(minLength: 8)
                stepButton("plus", by: Self.step)
            }
            .padding(.top, 22)

            HStack(spacing: 8) {
                ForEach([15, 30, 45, 60, 90], id: \.self) { value in
                    Button("\(value)") { withAnimation(.snappy) { minutes = value } }
                        .font(.subheadline.weight(minutes == value ? .semibold : .regular))
                        .foregroundStyle(minutes == value ? Palette.goldInk : Palette.ink)
                        .frame(maxWidth: .infinity, minHeight: 36)
                        .background(minutes == value ? Palette.gold : .clear, in: Capsule())
                        .overlay(Capsule().strokeBorder(minutes == value ? .clear : Palette.rule))
                        .accessibilityLabel("\(value) минут")
                }
            }
            .padding(.top, 18)

            if let conflict {
                warning(conflict)
                    .padding(.top, 18)
            } else if pomodoroOn {
                let format = Pomodoro.from(key: pomodoroFormat)
                Label("Помодоро: \(format.workMinutes) мин работы, \(format.breakMinutes) — перерыв, по кругу",
                      systemImage: "timer")
                    .font(.footnote)
                    .foregroundStyle(Palette.ink2)
                    .padding(.top, 18)
            }

            Spacer(minLength: 16)

            Button {
                focus.start(task, minutes: minutes)
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                dismiss()
            } label: {
                Label(conflict == nil ? "Начать фокус" : "Начать всё равно", systemImage: "play.fill")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .background(Palette.gold, in: Capsule())
                    .foregroundStyle(Palette.goldInk)
            }
            .accessibilityIdentifier("Начать фокус")
        }
        .padding(24)
        .background(Palette.sheet.ignoresSafeArea())
        .presentationDetents([.height(conflict == nil ? 470 : 540)])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(30)
        .presentationBackground(Palette.sheet)
        .sensoryFeedback(.selection, trigger: minutes)
    }

    private var slots: [CalendarSlot] {
        calendar.todayEvents.filter { !$0.isAllDay }.map {
            CalendarSlot(title: $0.title ?? "Событие", start: $0.startDate,
                         hasLocation: !($0.location ?? "").trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private func stepButton(_ icon: String, by delta: Int) -> some View {
        let next = minutes + delta
        return Button {
            withAnimation(.snappy) { minutes = min(max(next, Self.range.lowerBound), Self.range.upperBound) }
        } label: {
            Image(systemName: icon)
                .font(.title3.weight(.semibold))
                .frame(width: 56, height: 56)
                .overlay(Circle().strokeBorder(Palette.rule))
                .foregroundStyle(Palette.ink)
        }
        .disabled(!Self.range.contains(next))
        .accessibilityLabel(delta > 0 ? "Плюс 5 минут" : "Минус 5 минут")
    }

    private func warning(_ conflict: FocusConflict) -> some View {
        let time = conflict.start.formatted(date: .omitted, time: .shortened)
        let left = TodayView.duration(conflict.start.timeIntervalSinceNow)
        let reason = conflict.bufferMinutes >= 30
            ? "Ещё нужно добраться — закладываю \(conflict.bufferMinutes) мин на дорогу."
            : "Оставляю \(conflict.bufferMinutes) мин, чтобы переключиться."
        return VStack(alignment: .leading, spacing: 8) {
            Text("В \(time) «\(conflict.title)» — до неё \(left). \(reason)")
                .font(.footnote)
                .foregroundStyle(Palette.ink)
                .fixedSize(horizontal: false, vertical: true)
            if conflict.fitMinutes >= Self.range.lowerBound {
                Button("Уложиться: \(TodayView.duration(TimeInterval(conflict.fitMinutes * 60)))") {
                    withAnimation(.snappy) { minutes = conflict.fitMinutes }
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.goldText)
            }
        }
        .padding(.leading, 12)
        .overlay(alignment: .leading) { Rectangle().fill(Palette.gold).frame(width: 2) }
    }
}
