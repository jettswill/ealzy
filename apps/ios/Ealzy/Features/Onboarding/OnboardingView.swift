import SwiftUI

/// Первые минуты после входа: подключить то, без чего Илзи — просто чат.
/// Каждый шаг можно пропустить; показывается один раз.
struct OnboardingView: View {
    static let doneKey = "onboardingDone"

    @Environment(PhoneCalendar.self) private var calendar
    @Environment(TasksStore.self) private var tasks
    @Environment(\.dismiss) private var dismiss
    @State private var notificationsOn = false
    @State private var showReminders = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Три шага — и Илзи держит твой день: звенит вовремя, знает расписание и забирает дела из Напоминаний.")
                        .foregroundStyle(.secondary)
                        .listRowBackground(Color.clear)
                }
                Section {
                    step(
                        icon: "bell.badge",
                        title: "Уведомления",
                        text: "Напоминания ровно ко времени дела и план на утро.",
                        done: notificationsOn,
                        action: "Включить"
                    ) {
                        notificationsOn = await ReminderScheduler.shared.requestPermission()
                    }
                    step(
                        icon: "calendar",
                        title: "Календарь",
                        text: "Илзи видит встречи и тренировки и не шлёт дела, когда ты занят.",
                        done: calendar.isSyncEnabled && calendar.hasCalendarAccess,
                        action: "Подключить"
                    ) {
                        await calendar.enableSync()
                        tasks.nextEvent = calendar.nextEventItem
                    }
                    step(
                        icon: "checklist",
                        title: "Напоминания iPhone",
                        text: "Перенеси открытые напоминания — дальше звенит Ealzy.",
                        done: false,
                        action: "Перенести"
                    ) {
                        showReminders = true
                    }
                }
                Section {
                    Label("Виджет «Записать» на экран блокировки — запись в одно касание.", systemImage: "square.grid.2x2")
                    Label("«Скажи Ealzy» — Siri передаст Илзи всё, что надиктуешь.", systemImage: "mic")
                } header: {
                    Text("Потом, когда будет минута")
                }
            }
            .navigationTitle("Настроим Илзи")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { finish() }
                }
            }
            .task { notificationsOn = await ReminderScheduler.shared.isAuthorized() }
            .sheet(isPresented: $showReminders) { RemindersImportView() }
        }
        .interactiveDismissDisabled()
    }

    private func finish() {
        UserDefaults.standard.set(true, forKey: Self.doneKey)
        dismiss()
    }

    private func step(
        icon: String,
        title: String,
        text: String,
        done: Bool,
        action: String,
        perform: @escaping () async -> Void
    ) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: done ? "checkmark.circle.fill" : icon)
                .font(.title3)
                .foregroundStyle(done ? Color.green : Color.accentColor)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(text).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
            if !done {
                Button(action) { Task { await perform() } }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 4)
    }
}
