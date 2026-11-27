import SwiftUI

/// «Направления» — долгосрочные цели и дела, которые к ним ведут. Видно, что двигает
/// жизнь вперёд, а что из дел ни к чему не ведёт.
struct GoalsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(TasksStore.self) private var tasks
    @Environment(AppRouter.self) private var router
    @State private var goals: [Goal] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    let active = goals.filter(\.isActive)
                    let open = tasks.tasks.filter { $0.isOpen && !$0.isMeeting }
                    let aimless = open.filter { task in task.goalId == nil || !active.contains { $0.id == task.goalId } }

                    if isLoading && goals.isEmpty {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                    } else if active.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Пока без направлений.")
                                .font(Typeface.display(28))
                                .foregroundStyle(Palette.ink)
                            Text("Расскажи Илзи, куда хочешь прийти за полгода-год, — она соберёт направления и свяжет с ними дела.")
                                .font(.body)
                                .foregroundStyle(Palette.ink2)
                        }
                        .padding(.top, 10)
                    } else {
                        ForEach(active) { goal in
                            goalCard(goal, linked: open.filter { $0.goalId == goal.id })
                                .padding(.bottom, 14)
                        }
                        if !open.isEmpty {
                            let share = Int((Double(open.count - aimless.count) / Double(open.count) * 100).rounded())
                            Text("\(share)% открытых дел ведут к направлениям. Ещё \(aimless.count) \(TodayView.plural(aimless.count, "дело", "дела", "дел")) — быт, обязательства или шум.")
                                .font(.footnote)
                                .foregroundStyle(Palette.ink3)
                                .padding(.top, 6)
                        }
                    }

                    Button {
                        dismiss()
                        router.openSession(.strategy)
                    } label: {
                        Label("Стратегическая сессия", systemImage: "scope")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 54)
                            .background(Palette.gold, in: Capsule())
                            .foregroundStyle(Palette.goldInk)
                    }
                    .padding(.top, 28)

                    if let errorMessage {
                        Text(errorMessage).font(.footnote).foregroundStyle(Palette.dayMark).padding(.top, 12)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 16)
            }
            .background(Palette.ground.ignoresSafeArea())
            .navigationTitle("Направления")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Готово") { dismiss() }
                }
            }
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private func goalCard(_ goal: Goal, linked: [EalzyTask]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(goal.title)
                        .font(.headline)
                        .foregroundStyle(Palette.ink)
                    if let horizon = goal.horizonTitle {
                        Text(horizon).font(.caption).foregroundStyle(Palette.ink3)
                    }
                }
                Spacer(minLength: 8)
                Menu {
                    Button { Task { await setStatus(goal, "completed") } } label: {
                        Label("Достигнута", systemImage: "checkmark.seal")
                    }
                    Button { Task { await setStatus(goal, "paused") } } label: {
                        Label("На паузу", systemImage: "pause")
                    }
                    Button {
                        dismiss()
                        router.ask("Давай распишем план по цели «\(goal.title)»: что уже есть, какие 3 следующих шага.")
                    } label: { Label("Расписать план с Илзи", systemImage: "bubble.left") }
                } label: {
                    Image(systemName: "ellipsis")
                        .foregroundStyle(Palette.ink3)
                        .frame(width: 36, height: 30)
                }
            }
            if let stats = goal.stats, stats.taskCount > 0 {
                ProgressView(value: Double(stats.progress), total: 100)
                    .tint(Palette.gold)
                Text("Сделано \(stats.doneCount) из \(stats.taskCount)")
                    .font(.caption)
                    .foregroundStyle(Palette.ink3)
            }
            if linked.isEmpty {
                Text("Нет открытых шагов — направление стоит на месте.")
                    .font(.footnote)
                    .foregroundStyle(Palette.dayMark)
            } else {
                ForEach(linked.prefix(4)) { task in
                    Text("· \(task.title)")
                        .font(.subheadline)
                        .foregroundStyle(Palette.ink2)
                        .lineLimit(2)
                }
                if linked.count > 4 {
                    Text("и ещё \(linked.count - 4)").font(.caption).foregroundStyle(Palette.ink3)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.raised, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            goals = try await APIClient.shared.get("/goals")
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func setStatus(_ goal: Goal, _ status: String) async {
        struct Patch: Encodable { let status: String }
        do {
            let _: Goal = try await APIClient.shared.patch("/goals/\(goal.id)", body: Patch(status: status))
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// «Что сейчас?» на «Сегодня»: Илзи выбирает одно дело с учётом времени, календаря и целей.
struct FocusNowCard: View {
    @Environment(TasksStore.self) private var tasks
    let suggestion: FocusSuggestion
    let start: (EalzyTask) -> Void
    let close: () -> Void

    var body: some View {
        let task = suggestion.taskId.flatMap { id in tasks.tasks.first { $0.id == id } }
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("ИЛЗИ ПРЕДЛАГАЕТ СЕЙЧАС")
                    .font(.caption.weight(.bold))
                    .tracking(0.8)
                    .foregroundStyle(Palette.goldText)
                Spacer()
                Button(action: close) {
                    Image(systemName: "xmark").font(.caption.weight(.semibold)).foregroundStyle(Palette.ink3)
                }
                .accessibilityLabel("Скрыть")
            }
            if let title = suggestion.title {
                Text(title).font(Typeface.display(20)).foregroundStyle(Palette.ink)
            }
            Text(suggestion.reason).font(.subheadline).foregroundStyle(Palette.ink2)
            if let step = suggestion.firstStep {
                Label(step, systemImage: "arrow.turn.down.right").font(.subheadline).foregroundStyle(Palette.ink2)
            }
            if let task {
                HStack(spacing: 10) {
                    Button { start(task) } label: {
                        Label("Начать", systemImage: "play.fill")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 18)
                            .frame(height: 40)
                            .background(Palette.gold, in: Capsule())
                            .foregroundStyle(Palette.goldInk)
                    }
                    Button {
                        tasks.pinFocus(task)
                        close()
                    } label: {
                        Text("Сделать главным")
                            .font(.subheadline)
                            .padding(.horizontal, 14)
                            .frame(height: 40)
                            .overlay(Capsule().strokeBorder(Palette.rule))
                            .foregroundStyle(Palette.ink)
                    }
                }
                .padding(.top, 4)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.raised, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.gold.opacity(0.4)))
    }
}
