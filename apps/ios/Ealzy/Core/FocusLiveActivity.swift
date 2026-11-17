import ActivityKit
import Foundation

/// Запуск, обновление и завершение живой активности фокуса.
@MainActor
enum FocusLiveActivity {
    static func sync(_ state: FocusSession.State?, remaining: TimeInterval, phase: Pomodoro.Phase? = nil) {
        let current = Activity<FocusActivityAttributes>.activities
        guard let state else {
            end(current)
            return
        }
        let content = FocusActivityAttributes.ContentState(
            endsAt: state.pausedAt == nil ? Date().addingTimeInterval(remaining) : nil,
            pausedRemaining: state.pausedAt == nil ? nil : remaining,
            isBreak: phase?.isBreak,
            phaseLength: phase?.length,
            round: phase?.round
        )
        let stale = content.endsAt?.addingTimeInterval(15 * 60)
        if let activity = current.first(where: { $0.attributes.taskId == state.taskId }) {
            end(current.filter { $0.id != activity.id })
            Task { await activity.update(ActivityContent(state: content, staleDate: stale)) }
            return
        }
        end(current)
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let attributes = FocusActivityAttributes(
            taskId: state.taskId, title: state.title, plannedMinutes: state.plannedMinutes
        )
        _ = try? Activity.request(
            attributes: attributes,
            content: ActivityContent(state: content, staleDate: stale),
            pushType: nil
        )
    }

    private static func end(_ activities: [Activity<FocusActivityAttributes>]) {
        for activity in activities {
            Task { await activity.end(nil, dismissalPolicy: .immediate) }
        }
    }
}
