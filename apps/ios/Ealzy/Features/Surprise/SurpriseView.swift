import SwiftUI
import UIKit

/// «Удиви меня» — третья вкладка, рядом с Илзи. Человек говорит, чего хочет, —
/// колесо (видна верхняя треть) крутится и само останавливается на выпавшем.
/// Дальше главное — «Пойду»: куда именно и как добраться. «Поискать ещё» — что
/// не так, настройки и новое вращение.
struct SurpriseView: View {
    @State private var store = SurpriseStore()
    @State private var showSettings = false

    init() {}

    /// Быстрые ответы «что не так» — сервер понимает эти слова.
    private static let quickReasons: [(title: String, word: String)] = [
        ("Дорого", "дорого"), ("Далеко", "далеко"), ("Скучно", "скучно"),
        ("Нет сил", "устал"), ("Хочу подвигаться", "хочу подвигаться"), ("Долго", "долго"),
    ]

    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ScreenHeader(title: "Удиви меня")
                        if let left = store.spinsLeftText {
                            Text(left).font(.footnote).foregroundStyle(Palette.ink3)
                        }

                        WheelDisc(
                            slots: store.slots,
                            icons: store.icons,
                            rotation: store.rotation,
                            settled: store.phase == .spinning || store.phase == .setup ? nil : store.track?.slot,
                            accessibilityText: store.spin?.segments.map(\.name).joined(separator: ", ") ?? ""
                        )
                        .frame(maxWidth: 520)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 12)
                        .id("wheel")

                        switch store.phase {
                        case .setup:
                            Text("Скажи, чего хочется, — колесо выберет, а я подскажу, куда именно.")
                                .font(.body).foregroundStyle(Palette.ink2).padding(.top, 4)
                            settings
                            primaryButton(store.canSpin ? "Крутить колесо" : "На сегодня всё") {
                                await store.spinWheel()
                            }
                            .padding(.top, 20)
                            errorText
                            NavigationLink { TastesView() } label: {
                                Label("Твои вкусы", systemImage: "heart.text.square")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Palette.goldText)
                                    .frame(minHeight: 44)
                            }
                            .padding(.top, 8)
                        case .spinning:
                            Text("Крутится…").font(.footnote).foregroundStyle(Palette.ink3)
                                .frame(maxWidth: .infinity).padding(.top, 4)
                        case .result, .going, .more:
                            if let winner = store.spin?.winner {
                                resultCard(winner).id("result")
                            }
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 8)
                    .padding(.bottom, 120) // под нижней панелью
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: store.phase) {
                    switch store.phase {
                    case .spinning: withAnimation { scroll.scrollTo("wheel", anchor: .top) }
                    case .result: withAnimation { scroll.scrollTo("result", anchor: .top) }
                    default: break
                    }
                }
            }
            .background { LampBackground() }
            .toolbar(.hidden, for: .navigationBar)
            .task { await store.loadStatus() }
            .task(id: store.track) { await play() }
        }
    }

    // MARK: Вращение

    /// Проиграть просчитанное вращение кадр за кадром; щелчки — лёгкой вибрацией.
    private func play() async {
        guard store.phase == .spinning, let track = store.track, !track.frames.isEmpty else { return }
        let haptic = UISelectionFeedbackGenerator()
        haptic.prepare()
        let ticks = Set(track.ticks)
        let started = Date()
        var last = -1
        var lastTick = -10
        while !Task.isCancelled {
            let index = min(track.frames.count - 1, Int(Date().timeIntervalSince(started) * 60))
            if index > last {
                for i in (last + 1)...index where ticks.contains(i) {
                    // На разгоне колышки мелькают часто — щёлкаем, когда их уже различимо.
                    if i - lastTick >= 4 { haptic.selectionChanged() }
                    lastTick = i
                }
                last = index
                store.rotation = track.frames[index]
            }
            if index >= track.frames.count - 1 { break }
            try? await Task.sleep(for: .milliseconds(16))
        }
        guard !Task.isCancelled else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        store.didStop()
    }

    // MARK: Настройки

    private var settings: some View {
        VStack(alignment: .leading, spacing: 0) {
            field("Настроение") {
                LampChoice(options: WheelMood.allCases, selection: $store.mood, title: \.title)
            }
            field("Или что-то конкретное") {
                input("Например: кофейня, баня, картинг", text: $store.want)
            }
            field("Когда") {
                LampChoice(options: WheelWhen.allCases, selection: $store.when, title: \.title)
            }
            field("С кем") {
                LampChoice(options: WheelCompany.allCases, selection: $store.company, title: \.title)
            }
            field("Город") {
                CityField(city: store.city) { store.chooseCity($0) }
            }
            field("Где искать") {
                AreaPickerView(store: store)
            }
            Toggle(isOn: $store.onlyNew) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Только новое").foregroundStyle(Palette.ink)
                    Text("Не предлагать то, где уже был").font(.footnote).foregroundStyle(Palette.ink3)
                }
            }
            .tint(Palette.gold)
            .frame(minHeight: 56)
            .padding(.top, 18)
        }
    }

    private func field<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.footnote).foregroundStyle(Palette.ink3)
            content()
        }
        .padding(.top, 18)
    }

    private func input(_ prompt: String, text: Binding<String>) -> some View {
        TextField(prompt, text: text)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(Palette.track, in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private var errorText: some View {
        if let error = store.error {
            Text(error).font(.footnote).foregroundStyle(.red).padding(.top, 8)
        }
    }

    private func primaryButton(_ title: String, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            Text(title)
                .font(.headline)
                .foregroundStyle(Palette.goldInk)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(Palette.gold.opacity(store.canSpin ? 1 : 0.45), in: RoundedRectangle(cornerRadius: 14))
        }
        .disabled(!store.canSpin)
    }

    private func secondaryButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.headline)
                .foregroundStyle(Palette.ink)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(Palette.track, in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }

    private func link(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.subheadline).foregroundStyle(Palette.goldText).frame(minHeight: 44)
        }
        .buttonStyle(.plain)
    }

    // MARK: Итог

    private func resultCard(_ winner: WheelWinner) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(winner.type.emoji ?? "✨").font(.system(size: 34))
                VStack(alignment: .leading, spacing: 2) {
                    Text(winner.type.name)
                        .font(Typeface.display(26))
                        .foregroundStyle(Palette.ink)
                    if let category = winner.category {
                        Text([category.emoji, category.name].compactMap { $0 }.joined(separator: " "))
                            .font(.footnote).foregroundStyle(Palette.ink3)
                    }
                }
            }
            if let reason = winner.reason, !reason.isEmpty {
                Label(reason, systemImage: "sparkles").font(.footnote).foregroundStyle(Palette.goldText)
            }
            if store.phase != .going, let description = winner.type.description, !description.isEmpty {
                Text(description).font(.body).foregroundStyle(Palette.ink2)
            }

            switch store.phase {
            case .result:
                VStack(spacing: 10) {
                    primaryButton("Пойду") { await store.going() }
                    secondaryButton("Поискать ещё") { store.lookMore() }
                }
                .padding(.top, 8)
            case .going:
                Text("Отлично! Вот куда можно пойти и как добраться:")
                    .font(.body.weight(.semibold)).foregroundStyle(Palette.ink).padding(.top, 4)
                WheelPlacesView(store: store, winner: winner)
                link("Нет, давай ещё посмотрим") { store.lookMore() }
            case .more:
                more
            default:
                EmptyView()
            }
            errorText
        }
        .padding(.top, 16)
    }

    /// «Поискать ещё»: что не так, «не предлагать», настройки и новое вращение.
    private var more: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Что не так? Напиши — учтём").font(.footnote).foregroundStyle(Palette.ink3).padding(.top, 6)
            FlowRow(spacing: 8) {
                ForEach(Self.quickReasons, id: \.word) { reason in
                    let on = store.reasons.contains(reason.word)
                    chip(reason.title, on: on) {
                        if on { store.reasons.remove(reason.word) } else { store.reasons.insert(reason.word) }
                    }
                }
                chip("🚫 Не предлагать", on: store.currentVerdict == "never") {
                    Task { await store.setVerdict(store.currentVerdict == "never" ? nil : "never") }
                }
            }
            if store.currentVerdict == "never" {
                Text("Больше не покажем. Передумаешь — убери в «Твоих вкусах».")
                    .font(.footnote).foregroundStyle(Palette.ink3)
            }
            input("дорого, далеко, хочу активнее…", text: $store.feedback)
            link(showSettings ? "Скрыть настройки" : "Изменить запрос") {
                withAnimation(.snappy) { showSettings.toggle() }
            }
            if showSettings { settings }
            primaryButton(store.canSpin ? (store.status?.spinsLeft).map { "Крутить ещё · осталось \($0)" } ?? "Крутить ещё" : "На сегодня всё") {
                await store.spinWheel(again: true)
                showSettings = false
            }
            .padding(.top, 6)
            link("Всё-таки пойду") { Task { await store.going() } }
        }
    }

    private func chip(_ title: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(on ? .semibold : .regular))
                .foregroundStyle(on ? Palette.goldInk : Palette.ink)
                .padding(.horizontal, 12)
                .frame(minHeight: 34)
                .background(on ? Palette.gold : Palette.track, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
