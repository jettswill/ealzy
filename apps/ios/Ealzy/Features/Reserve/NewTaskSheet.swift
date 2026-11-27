import SwiftUI

/// Полная форма нового дела: описание, срок (день или день и время), повтор,
/// сколько займёт, важно/срочно, направление и кто делает. Открывается из строки
/// «Новое дело» — то, что уже набрано, переезжает сюда.
struct NewTaskSheet: View {
    @Environment(TasksStore.self) private var tasks
    @Environment(\.dismiss) private var dismiss

    @State private var title: String
    @State private var details = ""
    @State private var hasDue: Bool
    @State private var due: Date
    @State private var hasTime = false
    @State private var repeatRule = "none"
    @State private var estimate = 0
    @State private var important = false
    @State private var urgent = false
    @State private var goalId: String?
    @State private var forIlzi = false
    @State private var goals: [Goal] = []
    @FocusState private var titleFocused: Bool

    private let onSaved: () -> Void

    init(title: String = "", due: Date? = nil, onSaved: @escaping () -> Void = {}) {
        _title = State(initialValue: title)
        _hasDue = State(initialValue: due != nil)
        let start = due ?? QuickDue.today.date()
        _due = State(initialValue: start)
        _hasTime = State(initialValue: due.map { !DueClock.isDateOnly($0) } ?? false)
        self.onSaved = onSaved
    }

    private static let estimates = [0, 5, 15, 30, 45, 60, 90, 120, 180, 240]
    private static let repeats: [(key: String, title: String)] = [
        ("none", "Не повторять"), ("daily", "Каждый день"), ("weekly", "Каждую неделю"), ("monthly", "Каждый месяц"),
    ]

    private var canSave: Bool { !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Что сделать", text: $title, axis: .vertical)
                        .font(.body.weight(.semibold))
                        .lineLimit(1...4)
                        .focused($titleFocused)
                    TextField("Описание, ссылки, подробности", text: $details, axis: .vertical)
                        .lineLimit(2...8)
                }

                Section("Когда") {
                    Toggle("Срок", isOn: $hasDue.animation())
                    if hasDue {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(QuickDue.allCases, id: \.self) { option in
                                    let day = option.date()
                                    let on = Calendar.current.isDate(day, inSameDayAs: due)
                                    Button(option.title) { pickDay(day) }
                                        .font(.footnote.weight(.semibold))
                                        .padding(.horizontal, 12)
                                        .frame(height: 32)
                                        .background(on ? Palette.gold : .clear, in: Capsule())
                                        .overlay(Capsule().strokeBorder(on ? .clear : Palette.rule))
                                        .foregroundStyle(on ? Palette.goldInk : Palette.ink)
                                        .buttonStyle(.plain)
                                }
                            }
                        }
                        DatePicker("День", selection: $due, in: Calendar.current.startOfDay(for: Date())...,
                                   displayedComponents: .date)
                        Toggle("Ко времени", isOn: $hasTime.animation())
                        if hasTime {
                            DatePicker("Время", selection: $due, displayedComponents: .hourAndMinute)
                        }
                    }
                    Picker("Повторять", selection: $repeatRule) {
                        ForEach(Self.repeats, id: \.key) { Text($0.title).tag($0.key) }
                    }
                }

                Section("Сколько займёт") {
                    Picker("Время на дело", selection: $estimate) {
                        ForEach(Self.estimates, id: \.self) { minutes in
                            Text(minutes == 0 ? "Не знаю" : TodayView.duration(TimeInterval(minutes * 60))).tag(minutes)
                        }
                    }
                }

                Section {
                    Toggle("Важно", isOn: $important)
                    Toggle("Срочно", isOn: $urgent)
                } header: {
                    Text("Приоритет")
                } footer: {
                    Text("Важное и срочное Илзи ставит первым, когда выбирает главное на день.")
                }

                Section("Направление") {
                    Picker("Ведёт к цели", selection: $goalId) {
                        Text("Без направления").tag(String?.none)
                        ForEach(goals.filter(\.isActive)) { goal in
                            Text(goal.title).tag(Optional(goal.id))
                        }
                    }
                }

                Section {
                    Toggle("Пусть сделает Илзи", isOn: $forIlzi)
                } footer: {
                    Text("Найти, сравнить, подобрать варианты — Илзи сделает сама и напишет, что получилось.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.raised.ignoresSafeArea())
            .tint(Palette.goldText)
            .navigationTitle("Новое дело")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Добавить", action: save)
                        .font(.body.weight(.semibold))
                        .disabled(!canSave)
                }
            }
            .task {
                if title.isEmpty { titleFocused = true }
                let loaded: [Goal]? = try? await APIClient.shared.get("/goals")
                goals = loaded ?? []
            }
        }
        .presentationDetents([.large])
        .presentationBackground(Palette.raised)
    }

    /// Быстрый день: время, если было выбрано, сохраняем.
    private func pickDay(_ day: Date) {
        let calendar = Calendar.current
        if hasTime {
            let time = calendar.dateComponents([.hour, .minute], from: due)
            due = calendar.date(bySettingHour: time.hour ?? 9, minute: time.minute ?? 0, second: 0, of: day) ?? day
        } else {
            due = day
        }
    }

    private func save() {
        guard canSave else { return }
        var dueAt: Date?
        if hasDue {
            if hasTime {
                // Ровно 12:00 сервер считает «днём без времени» — сдвигаем на минуту.
                dueAt = DueClock.isDateOnly(due) ? due.addingTimeInterval(60) : due
            } else {
                dueAt = DueClock.dateOnly(due)
            }
        }
        let text = details.trimmingCharacters(in: .whitespacesAndNewlines)
        let draft = NewTask(
            title: title,
            description: text.isEmpty ? nil : text,
            dueAt: dueAt,
            estimateMinutes: estimate > 0 ? estimate : nil,
            importance: important ? 4 : nil,
            urgency: urgent ? 4 : nil,
            goalId: goalId,
            assignee: forIlzi ? "ealzy" : nil,
            recurrenceFrequency: hasDue && repeatRule != "none" ? repeatRule : nil
        )
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        Task { await tasks.create(draft) }
        onSaved()
        dismiss()
    }
}
