import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(PhoneCalendar.self) private var calendar
    @Environment(TasksStore.self) private var tasks
    @State private var notificationsOn = true
    @State private var showReminders = false
    @State private var confirmDelete = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle(isOn: Binding(
                        get: { calendar.isSyncEnabled },
                        set: { on in
                            Task {
                                if on { await calendar.enableSync() } else { await calendar.disableSync() }
                            }
                        }
                    )) {
                        Label("Календарь телефона", systemImage: "calendar")
                    }
                    if let error = calendar.errorMessage {
                        Text(error).font(.footnote).foregroundStyle(.red)
                    }
                } header: {
                    Text("Календарь")
                } footer: {
                    Text("Илзи видит все календари с iPhone (iCloud, Google, рабочий) на неделю вперёд и планирует день вокруг встреч и тренировок. Свайп вправо по делу — «В календарь».")
                }

                Section {
                    Button {
                        showReminders = true
                    } label: {
                        Label("Перенести из Напоминаний", systemImage: "checklist")
                    }
                } header: {
                    Text("Напоминания iPhone")
                } footer: {
                    Text("Открытые напоминания станут делами Ealzy — со сроками и временем. Звенеть будет Ealzy.")
                }

                Section {
                    HowToRow(
                        icon: "note.text",
                        title: "Одна заметка",
                        text: "В «Заметках» открой заметку → «Поделиться» → Ealzy. Можно сохранить заметкой или отдать Илзи разобрать."
                    )
                    HowToRow(
                        icon: "square.stack.3d.up",
                        title: "Все заметки сразу",
                        text: "В «Командах»: «Найти заметки» → «Повторить с каждым» → «Сохранить заметку в Ealzy». Apple не даёт приложениям читать «Заметки» напрямую — только так."
                    )
                } header: {
                    Text("Заметки iPhone")
                }

                Section {
                    HowToRow(
                        icon: "mic",
                        title: "Siri",
                        text: "«Скажи Ealzy» — и надиктуй. «Что у меня сегодня в Ealzy» — фокус дня голосом."
                    )
                    HowToRow(
                        icon: "button.horizontal.top.press",
                        title: "Кнопка действия",
                        text: "Настройки → Кнопка действия → Команда → Ealzy → «Записать» или «Сказать Илзи»."
                    )
                    HowToRow(
                        icon: "square.grid.2x2",
                        title: "Виджеты",
                        text: "Долгое нажатие на экране «Домой» или блокировки → «+» → Ealzy: «Фокус дня» и «Записать»."
                    )
                } header: {
                    Text("Быстрый доступ")
                }

                Section {
                    if notificationsOn {
                        Label("Напоминания и сообщения Илзи включены", systemImage: "bell.badge")
                    } else {
                        Button {
                            if let url = URL(string: UIApplication.openSettingsURLString) {
                                UIApplication.shared.open(url)
                            }
                        } label: {
                            Label("Включить уведомления", systemImage: "bell.slash")
                        }
                    }
                } header: {
                    Text("Уведомления")
                }

                Section {
                    Button("Выйти") { auth.signOut() }
                    Button("Удалить аккаунт", role: .destructive) { confirmDelete = true }
                } footer: {
                    Text("Удаление стирает дела, людей, заметки и память Илзи на всех устройствах, в Telegram и на сайте.")
                }
            }
            .navigationTitle("Ещё")
            .task { notificationsOn = await ReminderScheduler.shared.isAuthorized() }
            .sheet(isPresented: $showReminders) {
                RemindersImportView()
            }
            .confirmationDialog(
                "Удалить аккаунт и все данные?",
                isPresented: $confirmDelete,
                titleVisibility: .visible
            ) {
                Button("Удалить навсегда", role: .destructive) {
                    Task { _ = await auth.deleteAccount() }
                }
            } message: {
                Text("Это нельзя отменить.")
            }
        }
    }
}

private struct HowToRow: View {
    let icon: String
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).foregroundStyle(Color.accentColor).frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(text).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
