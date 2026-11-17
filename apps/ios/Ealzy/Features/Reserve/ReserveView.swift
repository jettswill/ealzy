import SwiftUI

/// «Запас»: всё, что не на сегодня. Ничего не горит — но и не теряется.
struct ReserveView: View {
    @Environment(TasksStore.self) private var tasks
    @Environment(AppRouter.self) private var router
    @AppStorage("reserveReviewSnoozedUntil") private var snoozedUntil: Double = 0

    var body: some View {
        let reserve = tasks.plan.reserve
        let groups = Self.group(reserve)
        let stale = Self.stale(reserve)
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Запас")
                    .font(Typeface.display(34))
                    .foregroundStyle(Palette.ink)
                Text(reserve.isEmpty
                     ? "Пусто. Всё, что не на сегодня, будет здесь."
                     : "\(reserve.count) \(TodayView.plural(reserve.count, "дело", "дела", "дел")), ничего не горит")
                    .font(.subheadline)
                    .foregroundStyle(Palette.ink2)
                    .padding(.top, 6)

                if stale.count >= 3 && Date().timeIntervalSince1970 > snoozedUntil {
                    staleCard(stale)
                        .padding(.top, 22)
                }

                ForEach(groups, id: \.title) { group in
                    VStack(alignment: .leading, spacing: 0) {
                        HStack {
                            Text(group.title)
                            Spacer()
                            Text("\(group.tasks.count)").monospacedDigit()
                        }
                        .font(.footnote)
                        .foregroundStyle(Palette.ink2)
                        .padding(.bottom, 4)
                        ForEach(group.tasks) { task in
                            Divider().overlay(Palette.rule)
                            TaskRow(task: task)
                        }
                    }
                    .padding(.top, 26)
                }

                if !tasks.plan.forIlzi.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Илзи делает сама")
                            .font(.footnote)
                            .foregroundStyle(Palette.ink2)
                            .padding(.bottom, 4)
                        ForEach(tasks.plan.forIlzi) { task in
                            Divider().overlay(Palette.rule)
                            TaskRow(task: task, canComplete: false)
                        }
                    }
                    .padding(.top, 26)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 44)
            .padding(.bottom, 120)
        }
        .background { LampBackground() }
        .refreshable { await tasks.load() }
    }

    /// Раз в неделю: «эти три лежат больше трёх недель — ещё актуально?»
    private func staleCard(_ stale: [EalzyTask]) -> some View {
        let three = Array(stale.prefix(3))
        return VStack(alignment: .leading, spacing: 10) {
            Text("Эти три лежат больше трёх недель. Ещё актуально?")
                .font(.subheadline)
                .foregroundStyle(Palette.ink)
            Text(three.map(\.title).joined(separator: " · "))
                .font(.footnote)
                .foregroundStyle(Palette.ink2)
            HStack(spacing: 8) {
                Button("Разобрать") {
                    let list = three.map { "— \($0.title)" }.joined(separator: "\n")
                    router.ask("Давай разберём залежавшиеся дела — что оставить, что убрать:\n\(list)")
                }
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 13)
                .frame(height: 34)
                .background(Palette.gold, in: Capsule())
                .foregroundStyle(Palette.goldInk)
                Button("Потом") {
                    snoozedUntil = Date().addingTimeInterval(7 * 86_400).timeIntervalSince1970
                }
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 13)
                .frame(height: 34)
                .overlay(Capsule().strokeBorder(Palette.rule))
                .foregroundStyle(Palette.ink)
            }
        }
        .padding(.leading, 12)
        .overlay(alignment: .leading) { Rectangle().fill(Palette.gold).frame(width: 2) }
    }

    struct Group {
        let title: String
        let tasks: [EalzyTask]
    }

    static func group(_ tasks: [EalzyTask], now: Date = Date(), calendar: Calendar = .current) -> [Group] {
        let weekEnd = calendar.date(byAdding: .day, value: 7, to: calendar.startOfDay(for: now)) ?? now
        let week = tasks.filter { ($0.dueAt ?? .distantFuture) < weekEnd }
        let later = tasks.filter { $0.dueAt.map { $0 >= weekEnd } ?? false }
        let someday = tasks.filter { $0.dueAt == nil }
        return [
            Group(title: "На этой неделе", tasks: week),
            Group(title: "Позже", tasks: later),
            Group(title: "Когда-нибудь", tasks: someday),
        ].filter { !$0.tasks.isEmpty }
    }

    /// Лежат больше трёх недель без срока или со сроком, который всё отодвигается.
    static func stale(_ tasks: [EalzyTask], now: Date = Date()) -> [EalzyTask] {
        tasks.filter { task in
            guard let created = task.createdAt else { return false }
            return now.timeIntervalSince(created) > 21 * 86_400 && task.dueAt == nil
        }
        .sorted { ($0.createdAt ?? now) < ($1.createdAt ?? now) }
    }
}
