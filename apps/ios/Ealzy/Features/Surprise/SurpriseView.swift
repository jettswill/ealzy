import SwiftUI
import UIKit

/// «Удиви меня»: человек говорит, чего хочет, где, когда и с кем, — колесо
/// крутится и выбирает. Три вращения в день; перед повтором можно сказать,
/// что не так, — следующее вращение это учтёт.
struct SurpriseView: View {
    @State private var store = SurpriseStore()
    @State private var rotation: Double = 0
    @Environment(\.dismiss) private var dismiss

    init() {}

    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Удиви меня")
                            .font(Typeface.display(32))
                            .foregroundStyle(Palette.ink)
                        if let left = store.spinsLeftText {
                            Text(left).font(.footnote).foregroundStyle(Palette.ink3).padding(.top, 4)
                        }

                        if let spin = store.spin {
                            wheel(spin).id("wheel")
                            if store.revealed {
                                result(spin.winner)
                                again
                            }
                        }

                        form
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 8)
                    .padding(.bottom, 48)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: store.spin?.spinId) {
                    withAnimation { scroll.scrollTo("wheel", anchor: .top) }
                }
            }
            .background { LampBackground() }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }.foregroundStyle(Palette.goldText)
                }
                ToolbarItem(placement: .topBarLeading) {
                    NavigationLink { TastesView() } label: {
                        Label("Твои вкусы", systemImage: "heart.text.square")
                    }
                    .foregroundStyle(Palette.goldText)
                }
            }
            .task { await store.loadStatus() }
        }
    }

    // MARK: Форма

    private var form: some View {
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
                input("Мой город", text: $store.city)
            }
            field("Где искать") {
                AreaPickerView(store: store)
            }
            VStack(spacing: 0) {
                Toggle(isOn: $store.onlyNew) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Только новое").foregroundStyle(Palette.ink)
                        Text("Не предлагать то, где уже был").font(.footnote).foregroundStyle(Palette.ink3)
                    }
                }
                .tint(Palette.gold)
                .frame(minHeight: 56)
            }
            .padding(.top, 18)

            if store.spin == nil {
                spinButton(title: "Крутить колесо") { await store.spinWheel() }
                    .padding(.top, 20)
            }
            if let error = store.error {
                Text(error).font(.footnote).foregroundStyle(.red).padding(.top, 8)
            }
        }
        .padding(.top, store.spin == nil ? 12 : 34)
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

    private func spinButton(title: String, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            HStack(spacing: 8) {
                if store.isSpinning, store.spin == nil { ProgressView().tint(Palette.goldInk) }
                Text(title)
            }
            .font(.headline)
            .foregroundStyle(Palette.goldInk)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(Palette.gold.opacity(store.canSpin ? 1 : 0.45), in: RoundedRectangle(cornerRadius: 14))
        }
        .disabled(!store.canSpin)
    }

    // MARK: Колесо

    private func wheel(_ spin: WheelSpin) -> some View {
        WheelDisc(segments: spin.segments, rotation: rotation)
            .frame(maxWidth: 340)
            .frame(maxWidth: .infinity)
            .padding(.top, 24)
            .task(id: spin.spinId) { await turn(to: spin) }
    }

    private func turn(to spin: WheelSpin) async {
        let arcs = WheelGeometry.arcs(spin.segments.map(\.weight))
        guard spin.winnerIndex < arcs.count else {
            await store.didStop()
            return
        }
        let target = WheelGeometry.targetRotation(from: rotation, arc: arcs[spin.winnerIndex])
        // Кадр на отрисовку диска в старом положении, потом — вращение.
        try? await Task.sleep(for: .milliseconds(60))
        let duration = UIAccessibility.isReduceMotionEnabled ? 0.4 : 4.2
        withAnimation(.timingCurve(0.12, 0.8, 0.2, 1, duration: duration)) {
            rotation = target
        }
        try? await Task.sleep(for: .seconds(duration))
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        await store.didStop()
    }

    // MARK: Итог

    private func result(_ winner: WheelWinner) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(winner.type.emoji ?? "✨").font(.system(size: 34))
                VStack(alignment: .leading, spacing: 2) {
                    Text(winner.type.name)
                        .font(Typeface.display(24))
                        .foregroundStyle(Palette.ink)
                    if let category = winner.category {
                        Text([category.emoji, category.name].compactMap { $0 }.joined(separator: " "))
                            .font(.footnote).foregroundStyle(Palette.ink3)
                    }
                }
            }
            if let description = winner.type.description, !description.isEmpty {
                Text(description).font(.body).foregroundStyle(Palette.ink2)
            }
            if let reason = winner.reason, !reason.isEmpty {
                Label(reason, systemImage: "sparkles")
                    .font(.footnote)
                    .foregroundStyle(Palette.goldText)
            }
            HStack(spacing: 8) {
                verdictChip("👍 Нравится", on: store.currentVerdict == "like") {
                    await store.setVerdict(store.currentVerdict == "like" ? nil : "like")
                }
                verdictChip("🚫 Не предлагать", on: store.currentVerdict == "never") {
                    await store.setVerdict(store.currentVerdict == "never" ? nil : "never")
                }
            }
            .padding(.top, 2)

            WheelPlacesView(store: store, winner: winner)
                .padding(.top, 14)
        }
        .padding(.top, 24)
    }

    private func verdictChip(_ title: String, on: Bool, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
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

    /// Повтор: можно сказать, что не так, — следующее вращение учтёт.
    private var again: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider().overlay(Palette.rule).padding(.top, 20)
            Text("Не то? Напиши, что не так, — учту")
                .font(.footnote).foregroundStyle(Palette.ink3)
            input("дорого, далеко, холодно, скучно, устал…", text: $store.feedback)
            spinButton(title: (store.status?.spinsLeft ?? 1) > 0 ? "Крутить ещё" : "На сегодня всё") {
                await store.spinWheel(again: true)
            }
            .padding(.top, 4)
        }
    }
}
