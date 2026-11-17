import SwiftUI

/// «Все дела»: отсюда человек сам собирает день — солнышко справа ставит дело на сегодня.
/// Сверху то, что уже на сегодня, потом просроченное, неделя, позже, когда-нибудь.
struct ReserveView: View {
    @Environment(TasksStore.self) private var tasks
    @Environment(AppRouter.self) private var router
    @AppStorage("reserveReviewSnoozedUntil") private var snoozedUntil: Double = 0

    var body: some View {
        let plan = tasks.plan
        let reserve = plan.reserve
        let today = plan.dayOpen
        let groups = [Group(title: "На сегодня", tasks: today), Group(title: "Просрочено", tasks: plan.overdue)]
            .filter { !$0.tasks.isEmpty } + Self.group(reserve)
        let total = today.count + plan.overdue.count + reserve.count
        let stale = Self.stale(reserve)
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ScreenHeader(title: "Все дела")
                Text(total == 0
                     ? "Пусто. Скажи Илзи, что висит в голове."
                     : "\(total) \(TodayView.plural(total, "дело", "дела", "дел")) · на сегодня \(today.count)")
                    .font(.subheadline)
                    .foregroundStyle(Palette.ink2)
                    .padding(.top, 2)

                NewTaskField()
                    .padding(.top, 18)

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
                            TaskRow(task: task, showsDayToggle: true)
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
            .padding(.top, 4)
            .padding(.bottom, 120)
        }
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

/// Новое дело руками: поле сверху списка. «Сегодня» — сразу в день.
struct NewTaskField: View {
    @Environment(TasksStore.self) private var tasks
    @State private var title = ""
    @State private var today = false
    @FocusState private var focused: Bool

    private var hasText: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "plus")
                .font(.body.weight(.semibold))
                .foregroundStyle(Palette.goldText)
                .frame(width: 32)
            TextField("Новое дело", text: $title)
                .font(.subheadline)
                .foregroundStyle(Palette.ink)
                .focused($focused)
                .submitLabel(.done)
                .onSubmit(save)
            if focused || hasText {
                Button {
                    today.toggle()
                    UISelectionFeedbackGenerator().selectionChanged()
                } label: {
                    Label("Сегодня", systemImage: today ? "checkmark" : "plus")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 10)
                        .frame(height: 30)
                        .foregroundStyle(today ? Palette.goldInk : Palette.ink2)
                        .background(today ? Palette.gold : .clear, in: Capsule())
                        .overlay(Capsule().strokeBorder(today ? .clear : Palette.rule))
                        .fixedSize()
                }
                .buttonStyle(.plain)
                .accessibilityLabel(today ? "Не на сегодня" : "Сразу на сегодня")
            }
            if hasText {
                Button(action: save) {
                    Image(systemName: "arrow.up")
                        .font(.footnote.weight(.bold))
                        .frame(width: 30, height: 30)
                        .background(Palette.gold, in: Circle())
                        .foregroundStyle(Palette.goldInk)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Добавить дело")
            }
        }
        .padding(.horizontal, 6)
        .frame(minHeight: 48)
        .background(Palette.raised.opacity(0.7), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.rule))
        .animation(.snappy, value: focused)
        .animation(.snappy, value: hasText)
    }

    private func save() {
        guard hasText else { focused = false; return }
        let text = title, toToday = today
        title = ""
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        Task { await tasks.create(text, today: toToday) }
        focused = true // можно сразу писать следующее
    }
}
