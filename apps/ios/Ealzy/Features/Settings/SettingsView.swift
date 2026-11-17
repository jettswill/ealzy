import SwiftUI
import UIKit

/// «Ещё»: оформление, подключения, подсказки и аккаунт — строками на бумаге, без карточек.
struct SettingsView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(PhoneCalendar.self) private var calendar
    @Environment(\.dismiss) private var dismiss
    @State private var notificationsOn = true
    @State private var showReminders = false
    @State private var confirmDelete = false
    @AppStorage(Appearance.storageKey) private var appearance = Appearance.system.rawValue

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Ещё")
                        .font(Typeface.display(34))
                        .foregroundStyle(Palette.ink)

                    section("Оформление") {
                        AppearancePicker(selection: $appearance)
                        note(appearance == Appearance.system.rawValue
                             ? "Ealzy светлеет и темнеет вместе с iPhone."
                             : "Тема не зависит от настроек iPhone.")
                    }

                    section("Подключено") {
                        row {
                            Toggle(isOn: Binding(
                                get: { calendar.isSyncEnabled },
                                set: { on in
                                    Task { if on { await calendar.enableSync() } else { await calendar.disableSync() } }
                                }
                            )) { label("Календарь телефона", "calendar") }
                            .tint(Palette.gold)
                        }
                        if let error = calendar.errorMessage { note(error, color: .red) }
                        note("Все календари iPhone на неделю вперёд: Илзи планирует день вокруг встреч и тренировок.")
                        row {
                            Button { showReminders = true } label: {
                                HStack {
                                    label("Перенести из Напоминаний", "checklist")
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.footnote).foregroundStyle(Palette.ink3)
                                }
                            }
                        }
                        row {
                            if notificationsOn {
                                HStack {
                                    label("Уведомления", "bell")
                                    Spacer()
                                    Text("вкл.").font(.subheadline.weight(.semibold)).foregroundStyle(Palette.goldText)
                                }
                            } else {
                                Button {
                                    if let url = URL(string: UIApplication.openSettingsURLString) {
                                        UIApplication.shared.open(url)
                                    }
                                } label: {
                                    HStack {
                                        label("Включить уведомления", "bell.slash")
                                        Spacer()
                                        Image(systemName: "arrow.up.right").font(.footnote).foregroundStyle(Palette.ink3)
                                    }
                                }
                            }
                        }
                    }

                    section("Илзи на iPhone") {
                        LocalBrainSection()
                    }

                    section("Как быстрее") {
                        howTo("mic", "Siri", "«Скажи Ealzy» — и надиктуй. «Что у меня сегодня в Ealzy» — фокус голосом.")
                        howTo("button.horizontal.top.press", "Кнопка действия",
                              "Настройки → Кнопка действия → Команда → Ealzy → «Записать».")
                        howTo("square.grid.2x2", "Виджеты",
                              "Долгое нажатие на экране «Домой» или блокировки → «+» → Ealzy.")
                        howTo("note.text", "Заметки iPhone",
                              "Заметка → «Поделиться» → Ealzy. Все сразу — Команда «Найти заметки» → «Сохранить заметку в Ealzy».")
                    }

                    section("Аккаунт") {
                        row {
                            Button("Выйти") { auth.signOut() }
                                .foregroundStyle(Palette.ink)
                        }
                        row {
                            Button("Удалить аккаунт", role: .destructive) { confirmDelete = true }
                        }
                        note("Удаление стирает дела, людей, заметки и память Илзи везде — в приложении, Telegram и на сайте.")
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)
                .padding(.bottom, 40)
            }
            .background { LampBackground() }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }.foregroundStyle(Palette.goldText)
                }
            }
            .task { notificationsOn = await ReminderScheduler.shared.isAuthorized() }
            .sheet(isPresented: $showReminders) { RemindersImportView() }
            .confirmationDialog("Удалить аккаунт и все данные?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Удалить навсегда", role: .destructive) { Task { _ = await auth.deleteAccount() } }
            } message: {
                Text("Это нельзя отменить.")
            }
        }
    }

    // MARK: Строительные блоки

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.footnote).foregroundStyle(Palette.ink3).padding(.bottom, 8)
            content()
        }
        .padding(.top, 30)
    }

    private func row<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            Divider().overlay(Palette.rule)
            content()
                .font(.body)
                .foregroundStyle(Palette.ink)
                .frame(minHeight: 50)
        }
    }

    private func label(_ text: String, _ icon: String) -> some View {
        Label {
            Text(text).foregroundStyle(Palette.ink)
        } icon: {
            Image(systemName: icon).foregroundStyle(Palette.goldText)
        }
    }

    private func note(_ text: String, color: Color = Palette.ink3) -> some View {
        Text(text).font(.footnote).foregroundStyle(color).padding(.top, 6).padding(.bottom, 8)
    }

    private func howTo(_ icon: String, _ title: String, _ text: String) -> some View {
        VStack(spacing: 0) {
            Divider().overlay(Palette.rule)
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon).foregroundStyle(Palette.goldText).frame(width: 24)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).foregroundStyle(Palette.ink)
                    Text(text).font(.footnote).foregroundStyle(Palette.ink2)
                }
            }
            .padding(.vertical, 12)
        }
    }
}

/// Переключатель темы в духе «Лампы»: дорожка и бумажная «таблетка».
struct AppearancePicker: View {
    @Binding var selection: String
    @Namespace private var pill

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Appearance.allCases) { option in
                let on = selection == option.rawValue
                Button {
                    withAnimation(.snappy) { selection = option.rawValue }
                } label: {
                    Text(option.title)
                        .font(.subheadline.weight(on ? .semibold : .regular))
                        .foregroundStyle(on ? Palette.ink : Palette.ink2)
                        .frame(maxWidth: .infinity, minHeight: 38)
                        .background {
                            if on {
                                RoundedRectangle(cornerRadius: 9)
                                    .fill(Palette.raised)
                                    .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
                                    .matchedGeometryEffect(id: "pill", in: pill)
                            }
                        }
                }
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Palette.track, in: RoundedRectangle(cornerRadius: 12))
    }
}
