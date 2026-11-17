import SwiftUI

/// Переезд из Напоминаний iPhone: выбрать, перенести, по желанию закрыть их там.
struct RemindersImportView: View {
    @Environment(PhoneCalendar.self) private var calendar
    @Environment(TasksStore.self) private var tasks
    @Environment(\.dismiss) private var dismiss

    @State private var items: [PhoneCalendar.ReminderItem] = []
    @State private var selected: Set<String> = []
    @State private var completeInReminders = true
    @State private var isLoading = true
    @State private var isImporting = false
    @State private var result: String?

    var body: some View {
        NavigationStack {
            List {
                if isLoading {
                    ProgressView()
                } else if let result {
                    Text(result)
                } else if items.isEmpty {
                    Text(calendar.errorMessage ?? "Открытых напоминаний нет — переносить нечего.")
                        .foregroundStyle(.secondary)
                } else {
                    Section {
                        Toggle("Отметить перенесённые выполненными в Напоминаниях", isOn: $completeInReminders)
                            .tint(Palette.gold)
                            .lampRow()
                    } footer: {
                        Text("Так они не будут звенеть дважды — дальше напоминает Ealzy.")
                    }
                    Section("Выбрано \(selected.count) из \(items.count)") {
                        ForEach(items) { item in
                            Button {
                                if selected.contains(item.id) { selected.remove(item.id) } else { selected.insert(item.id) }
                            } label: {
                                HStack(alignment: .firstTextBaseline) {
                                    Image(systemName: selected.contains(item.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(selected.contains(item.id) ? Palette.goldText : Palette.ink3)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.title).foregroundStyle(Palette.ink)
                                        Text(subtitle(item)).font(.caption).foregroundStyle(Palette.ink2)
                                    }
                                }
                            }
                            .lampRow()
                        }
                    }
                }
            }
            .lampList()
            .navigationTitle("Из Напоминаний")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(result == nil ? "Отмена" : "Готово") { dismiss() }
                }
                if result == nil && !items.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        if isImporting {
                            ProgressView()
                        } else {
                            Button("Перенести") { Task { await runImport() } }
                                .disabled(selected.isEmpty)
                        }
                    }
                }
            }
            .task {
                items = await calendar.loadReminders()
                selected = Set(items.map(\.id))
                isLoading = false
            }
        }
    }

    private func subtitle(_ item: PhoneCalendar.ReminderItem) -> String {
        var parts = [item.list]
        if let due = item.due {
            parts.append(item.hasTime ? due.formatted(date: .abbreviated, time: .shortened) : due.formatted(date: .abbreviated, time: .omitted))
        }
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func runImport() async {
        isImporting = true
        let chosen = items.filter { selected.contains($0.id) }
        let count = await calendar.importReminders(chosen, completeInReminders: completeInReminders)
        isImporting = false
        result = count == chosen.count
            ? "Перенесено: \(count). Теперь они в Ealzy и будут звенеть отсюда."
            : "Перенесено \(count) из \(chosen.count). Остальные попробуй ещё раз позже."
        await tasks.load()
    }
}
