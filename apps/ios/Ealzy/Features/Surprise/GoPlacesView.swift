import SwiftUI

/// После «Пойду»: хорошие места рядом и сразу шаг — «Пойду сюда», позвонить,
/// сайт, маршрут. Потом «Когда?» — и выход в календаре Ealzy и iPhone.
struct GoPlacesView: View {
    @Bindable var store: SurpriseStore
    let winner: WheelWinner
    @State private var shown = 4

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if store.nearby == nil {
                HStack(spacing: 10) {
                    ProgressView()
                    Text("Ищу хорошие места рядом…").font(.subheadline).foregroundStyle(Palette.ink3)
                }
                .padding(.vertical, 12)
            } else {
                let cards = store.goCards
                if cards.isEmpty {
                    Text("Рядом под это ничего не нашёл.").font(.body).foregroundStyle(Palette.ink2)
                    if let url = URL(string: winner.mapsUrl) {
                        Link("Посмотреть на картах", destination: url)
                            .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.surpriseText)
                    }
                } else {
                    if store.chosen == nil {
                        Text("Нашёл хорошие места рядом — выбирай:")
                            .font(.body.weight(.semibold)).foregroundStyle(Palette.ink)
                    }
                    let visible = store.chosen.map { id in cards.filter { $0.id == id } } ?? Array(cards.prefix(shown))
                    ForEach(visible) { card in
                        GoCardView(store: store, card: card)
                    }
                    if store.chosen != nil {
                        textLink("Другое место") { store.unchoose() }
                    } else if cards.count > shown {
                        textLink("Показать ещё") { shown += 4 }
                    }
                }
            }
            if let error = store.nearbyError {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
        }
    }

    private func textLink(_ title: String, _ action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Palette.surpriseText)
            .frame(minHeight: 44)
    }
}

private struct GoCardView: View {
    @Bindable var store: SurpriseStore
    let card: GoCard
    @State private var askingWhen = false
    @State private var picking = false
    @State private var pickDate = Date().addingTimeInterval(3 * 3600)
    @State private var inPhoneCalendar = false
    @Environment(PhoneCalendar.self) private var calendar

    private var plan: OutingPlan? { store.plans[card.id] }
    private var busy: Bool { store.planning == card.id }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(card.name).font(.headline).foregroundStyle(Palette.ink)
                Spacer(minLength: 8)
                if let rating = card.rating {
                    Text("★ " + String(format: "%.1f", rating).replacingOccurrences(of: ".", with: ","))
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.goldText)
                    + Text(card.ratingCount.map { " · \($0)" } ?? "").font(.caption).foregroundStyle(Palette.ink3)
                }
            }
            let meta = [card.address, DistanceText.format(card.distanceM)].compactMap { $0 }.joined(separator: " · ")
            if !meta.isEmpty { Text(meta).font(.footnote).foregroundStyle(Palette.ink3) }
            if let hours = card.hours { Text("Часы: \(hours)").font(.footnote).foregroundStyle(Palette.ink3) }

            if let plan {
                planned(plan)
            } else if askingWhen {
                whenPicker
            } else {
                Button { askingWhen = true } label: {
                    Text("Пойду сюда")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .foregroundStyle(Palette.surpriseInk)
                        .background(Palette.surprise, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }

            HStack(spacing: 8) {
                if let url = card.phoneURL { action("Позвонить", "phone", url) }
                if let url = card.siteURL { action("Сайт", "globe", url) }
                if let url = card.routeURL { action("Маршрут", "arrow.triangle.turn.up.right.diamond", url) }
            }
        }
        .padding(14)
        .background(Palette.raised, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(store.chosen == card.id ? Palette.surprise : Palette.rule, lineWidth: 1)
        )
    }

    private var whenPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Когда пойдёшь?").font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink2)
            FlowRow(spacing: 8) {
                ForEach(QuickTimes.options(), id: \.0) { option in
                    chip(option.0) { Task { await store.plan(card, when: option.1) } }
                }
                chip("Выбрать время") { picking.toggle() }
            }
            if picking {
                DatePicker("Когда", selection: $pickDate, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                    .labelsHidden()
                chip("Поставить") { Task { await store.plan(card, when: pickDate) } }
            }
            Button("Пока не знаю") { Task { await store.plan(card, when: nil) } }
                .font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink3).frame(minHeight: 36)
        }
        .disabled(busy)
        .opacity(busy ? 0.6 : 1)
    }

    @ViewBuilder private func planned(_ plan: OutingPlan) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let due = plan.task?.dueAt ?? plan.visit.plannedFor {
                Label("В календаре Ealzy: \(due.formatted(.dateTime.weekday(.abbreviated).day().month(.wide).hour().minute()))",
                      systemImage: "checkmark.circle.fill")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(Palette.surpriseText)
                if let task = plan.task {
                    if inPhoneCalendar {
                        Label("И в календаре iPhone", systemImage: "calendar.badge.checkmark")
                            .font(.footnote).foregroundStyle(Palette.ink3)
                    } else {
                        Button {
                            Task { inPhoneCalendar = await calendar.addToCalendar(task) }
                        } label: {
                            Label("Добавить в календарь iPhone", systemImage: "calendar.badge.plus")
                                .font(.subheadline.weight(.semibold))
                        }
                        .foregroundStyle(Palette.surpriseText)
                        .frame(minHeight: 40)
                    }
                }
            } else {
                Label("Запомнил. Вечером спрошу, когда пойдёшь, — и поставлю в календарь.",
                      systemImage: "checkmark.circle.fill")
                    .font(.subheadline).foregroundStyle(Palette.surpriseText)
            }
            Button("Изменить время") {
                store.forget(card)
                askingWhen = true
            }
            .font(.footnote.weight(.semibold)).foregroundStyle(Palette.ink3).frame(minHeight: 36)
        }
    }

    private func chip(_ title: String, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            Text(title)
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 12)
                .frame(minHeight: 36)
                .foregroundStyle(Palette.ink)
                .background(Palette.track, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func action(_ title: String, _ icon: String, _ url: URL) -> some View {
        Link(destination: url) {
            Label(title, systemImage: icon)
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 11)
                .frame(minHeight: 34)
                .foregroundStyle(Palette.ink)
                .overlay(Capsule().strokeBorder(Palette.rule, lineWidth: 1))
        }
    }
}
