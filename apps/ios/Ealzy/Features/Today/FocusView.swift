import SwiftUI

/// Фирменный момент: «Начать» — и на экране остаётся одно дело под светом лампы.
struct FocusView: View {
    @Environment(FocusSession.self) private var focus
    @Environment(TasksStore.self) private var tasks

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = focus.remaining(at: context.date)
            let planned = TimeInterval((focus.state?.plannedMinutes ?? 60) * 60)
            VStack(alignment: .leading, spacing: 0) {
                Label(endText, systemImage: "moon")
                    .font(.footnote)
                    .foregroundStyle(Palette.ink2)
                    .padding(.top, 12)

                Spacer(minLength: 40)

                Text(Self.clock(remaining))
                    .font(.system(size: 88, weight: .light))
                    .monospacedDigit()
                    .tracking(-2)
                    .foregroundStyle(Palette.ink)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .contentTransition(.numericText(countsDown: true))
                Text(remaining >= 0
                     ? "осталось из \(TodayView.duration(planned))\(focus.isPaused ? " · пауза" : "")"
                     : "время вышло — можно закончить или продолжить")
                    .font(.subheadline)
                    .foregroundStyle(Palette.ink3)
                    .padding(.top, 8)

                FocusHeader.title(focus.state?.title ?? "", size: 28)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 26)

                ProgressView(value: min(max(1 - remaining / max(planned, 1), 0), 1))
                    .tint(Palette.gold)
                    .padding(.top, 22)

                Spacer()

                HStack(spacing: 10) {
                    Button {
                        focus.togglePause()
                    } label: {
                        Text(focus.isPaused ? "Продолжить" : "Пауза")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 54)
                            .overlay(Capsule().strokeBorder(Palette.rule))
                            .foregroundStyle(Palette.ink)
                    }
                    Button {
                        finish()
                    } label: {
                        Text("Готово")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 54)
                            .background(Palette.gold, in: Capsule())
                            .foregroundStyle(Palette.goldInk)
                    }
                }
                .padding(.bottom, 12)
            }
            .padding(.horizontal, 24)
        }
        .background { LampBackground(narrow: true) }
        .overlay(alignment: .topTrailing) {
            Button {
                focus.finish()
            } label: {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.ink3)
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Выйти из фокуса")
            .padding(.trailing, 12)
        }
    }

    private var endText: String {
        guard let state = focus.state else { return "" }
        let end = state.startedAt.addingTimeInterval(TimeInterval(state.plannedMinutes * 60) - state.banked)
        return "Фокус до \(end.formatted(date: .omitted, time: .shortened))"
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
