import ActivityKit
import SwiftUI
import WidgetKit

/// Фокус в Dynamic Island и на экране блокировки: дело и сколько осталось.
/// Нажатие возвращает на экран фокуса в приложении.
struct FocusLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FocusActivityAttributes.self) { context in
            FocusLockScreen(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(Color(red: 0.098, green: 0.090, blue: 0.078))
                .activitySystemActionForegroundColor(Palette.gold)
                .widgetURL(URL(string: "ealzy://focus"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image("IlziMark")
                        .resizable()
                        .frame(width: 26, height: 26)
                        .foregroundStyle(Palette.gold)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    FocusClock(state: context.state)
                        .font(.system(size: 24, weight: .semibold, design: .rounded))
                        .foregroundStyle(Palette.gold)
                        .frame(maxWidth: 100, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title)
                        .font(.headline)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        FocusProgress(attributes: context.attributes, state: context.state)
                        Text(context.state.pausedRemaining != nil ? "На паузе" : "Не отвлекайся — остальное подождёт")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image("IlziMark")
                    .resizable()
                    .frame(width: 18, height: 18)
                    .foregroundStyle(Palette.gold)
            } compactTrailing: {
                FocusClock(state: context.state)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.gold)
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: context.state.pausedRemaining != nil ? "pause.fill" : "timer")
                    .foregroundStyle(Palette.gold)
            }
            .widgetURL(URL(string: "ealzy://focus"))
            .keylineTint(Palette.gold)
        }
    }
}

/// Отсчёт: идёт сам, без обновлений из приложения; на паузе — застывшее время.
private struct FocusClock: View {
    let state: FocusActivityAttributes.ContentState

    var body: some View {
        Group {
            if let ends = state.endsAt, ends > Date() {
                Text(timerInterval: Date()...ends, countsDown: true)
            } else if let rest = state.pausedRemaining {
                Text(Self.format(rest))
            } else {
                Text("0:00")
            }
        }
        .monospacedDigit()
        .multilineTextAlignment(.trailing)
    }

    static func format(_ seconds: TimeInterval) -> String {
        let total = max(Int(seconds), 0)
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

private struct FocusProgress: View {
    let attributes: FocusActivityAttributes
    let state: FocusActivityAttributes.ContentState

    var body: some View {
        let total = TimeInterval(attributes.plannedMinutes * 60)
        if let ends = state.endsAt {
            ProgressView(timerInterval: ends.addingTimeInterval(-total)...ends, countsDown: false) {
                EmptyView()
            } currentValueLabel: {
                EmptyView()
            }
            .tint(Palette.gold)
        } else if let rest = state.pausedRemaining {
            ProgressView(value: max(0, min(1, 1 - rest / max(total, 1))))
                .tint(Palette.gold)
        }
    }
}

private struct FocusLockScreen: View {
    let attributes: FocusActivityAttributes
    let state: FocusActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                Image("IlziMark")
                    .resizable()
                    .frame(width: 24, height: 24)
                    .foregroundStyle(Palette.gold)
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.pausedRemaining != nil ? "ФОКУС НА ПАУЗЕ" : "СЕЙЧАС В ФОКУСЕ")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Palette.gold)
                    Text(attributes.title)
                        .font(.headline)
                        .foregroundStyle(Color(red: 0.945, green: 0.922, blue: 0.867))
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                FocusClock(state: state)
                    .font(.system(size: 30, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(red: 0.945, green: 0.922, blue: 0.867))
                    .frame(maxWidth: 120, alignment: .trailing)
            }
            FocusProgress(attributes: attributes, state: state)
            Text("Не отвлекайся — остальное подождёт")
                .font(.caption)
                .foregroundStyle(Color(red: 0.761, green: 0.725, blue: 0.651))
        }
        .padding(16)
    }
}
