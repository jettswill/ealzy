import EventKit
import SwiftUI
import UIKit

// MARK: - Карточка дела

/// Нажал на дело — видно всё о нём и что с ним можно сделать.
struct TaskDetailView: View {
    @Environment(TasksStore.self) private var tasks
    @Environment(PhoneCalendar.self) private var calendar
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    let task: EalzyTask
    @State private var editingDue = false
    @State private var due = Date()
    @State private var confirmCancel = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    FocusHeader.title(task.title, size: 28)
                        .fixedSize(horizontal: false, vertical: true)
                    if let meta = TaskMeta.text(for: task) {
                        Text(meta).font(.subheadline).foregroundStyle(Palette.ink2).padding(.top, 8)
                    }
                    if let text = task.description, !text.isEmpty {
                        Text(text)
                            .font(.body)
                            .foregroundStyle(Palette.ink)
                            .padding(.top, 16)
                            .textSelection(.enabled)
                    }

                    VStack(spacing: 0) {
                        action("Готово", "checkmark.circle") {
                            Task { await tasks.complete(task) }
                            dismiss()
                        }
                        if tasks.plan.focus.first?.id != task.id {
                            action("Сделать главным на сегодня", "scope") {
                                tasks.pinFocus(task)
                                dismiss()
                            }
                        }
                        if tasks.isOnToday(task) {
                            action("Убрать из дня", "minus.circle") {
                                Task { await tasks.removeFromToday(task) }
                                dismiss()
                            }
                        } else {
                            action("Поставить на сегодня", "sun.max") {
                                Task { await tasks.addToToday(task) }
                                dismiss()
                            }
                        }
                        action("Изменить срок", "calendar") {
                            due = task.dueAt ?? Date().addingTimeInterval(3600)
                            editingDue.toggle()
                        }
                        if editingDue {
                            DatePicker("Срок", selection: $due, displayedComponents: [.date, .hourAndMinute])
                                .datePickerStyle(.graphical)
                                .tint(Palette.goldText)
                            Button("Сохранить срок") {
                                Task { await tasks.reschedule(task, to: DueClock.isDateOnly(due) ? due.addingTimeInterval(60) : due) }
                                dismiss()
                            }
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .background(Palette.gold, in: Capsule())
                            .foregroundStyle(Palette.goldInk)
                            .padding(.vertical, 8)
                        }
                        action("На завтра", "arrow.right") {
                            Task { await tasks.moveToTomorrow(task) }
                            dismiss()
                        }
                        if task.dueAt != nil {
                            action("Поставить в календарь", "calendar.badge.plus") {
                                Task { _ = await calendar.addToCalendar(task) }
                                dismiss()
                            }
                        }
                        action("Попросить Илзи помочь", "sparkle") {
                            dismiss()
                            router.ask("Помоги с делом «\(task.title)»: с чего начать и что можно сделать за меня?")
                        }
                        action("Убрать дело", "trash", role: .destructive) { confirmCancel = true }
                    }
                    .padding(.top, 24)
                }
                .padding(24)
            }
            .background(Palette.raised.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Закрыть") { dismiss() }.foregroundStyle(Palette.goldText)
                }
            }
            .confirmationDialog("Убрать «\(task.title)»?", isPresented: $confirmCancel, titleVisibility: .visible) {
                Button("Убрать", role: .destructive) {
                    Task { await tasks.cancel(task) }
                    dismiss()
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Palette.raised)
    }

    private func action(
        _ title: String, _ icon: String, role: ButtonRole? = nil, perform: @escaping () -> Void
    ) -> some View {
        VStack(spacing: 0) {
            Divider().overlay(Palette.rule)
            Button(role: role, action: perform) {
                Label(title, systemImage: icon)
                    .frame(maxWidth: .infinity, minHeight: 50, alignment: .leading)
                    .foregroundStyle(role == .destructive ? Color.red : Palette.ink)
            }
        }
    }
}

// MARK: - Событие с ленты дня

struct EventDetailView: View {
    let event: EKEvent
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    if let color = event.calendar?.cgColor {
                        Circle().fill(Color(cgColor: color)).frame(width: 10, height: 10)
                    }
                    Text(event.calendar?.title ?? "Календарь").font(.footnote).foregroundStyle(Palette.ink3)
                }
                Text(event.title ?? "Событие")
                    .font(Typeface.display(28))
                    .foregroundStyle(Palette.ink)
                    .padding(.top, 10)
                Text(timeText)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.ink)
                    .padding(.top, 8)
                if let location = event.location, !location.isEmpty {
                    Label(location, systemImage: "mappin.and.ellipse")
                        .font(.subheadline)
                        .foregroundStyle(Palette.ink2)
                        .padding(.top, 12)
                }
                if let notes = event.notes, !notes.isEmpty {
                    Text(notes)
                        .font(.body)
                        .foregroundStyle(Palette.ink)
                        .lineLimit(8)
                        .padding(.top, 14)
                }
                Spacer(minLength: 20)
                Button {
                    let seconds = Int(event.startDate.timeIntervalSinceReferenceDate)
                    if let url = URL(string: "calshow:\(seconds)") { openURL(url) }
                } label: {
                    Text("Открыть в Календаре")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .overlay(Capsule().strokeBorder(Palette.rule))
                        .foregroundStyle(Palette.ink)
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Palette.raised.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Закрыть") { dismiss() }.foregroundStyle(Palette.goldText)
                }
            }
        }
        .presentationDetents([.medium])
        .presentationBackground(Palette.raised)
    }

    private var timeText: String {
        if event.isAllDay { return "Весь день" }
        let f = { (d: Date) in d.formatted(date: .omitted, time: .shortened) }
        let minutes = Int(event.endDate.timeIntervalSince(event.startDate) / 60)
        return "\(f(event.startDate))–\(f(event.endDate)) · \(TodayView.duration(TimeInterval(minutes * 60)))"
    }
}

// MARK: - Сменить главное

struct FocusPickerView: View {
    @Environment(TasksStore.self) private var tasks
    @Environment(\.dismiss) private var dismiss
    let current: EalzyTask

    var body: some View {
        let plan = tasks.plan
        let options = (plan.overdue + plan.today + plan.quick + plan.reserve).filter { $0.id != current.id }
        NavigationStack {
            List {
                Section {
                    Button {
                        tasks.skipFocus(current)
                        dismiss()
                    } label: {
                        Label("Убрать «\(current.title)» из фокуса на сегодня", systemImage: "minus.circle")
                    }
                    .lampRow()
                    Button {
                        Task { await tasks.moveToTomorrow(current) }
                        dismiss()
                    } label: {
                        Label("Перенести на завтра", systemImage: "arrow.right")
                    }
                    .lampRow()
                }
                Section("Сделать главным") {
                    ForEach(options) { task in
                        Button {
                            tasks.pinFocus(task)
                            dismiss()
                        } label: {
                            HStack {
                                Text(task.title).foregroundStyle(Palette.ink).lineLimit(2)
                                Spacer()
                                if let meta = TaskMeta.text(for: task) {
                                    Text(meta).font(.footnote).foregroundStyle(Palette.ink2)
                                }
                            }
                        }
                        .lampRow()
                    }
                }
            }
            .lampList()
            .navigationTitle("Главное на сегодня")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }.foregroundStyle(Palette.goldText)
                }
            }
        }
    }
}
