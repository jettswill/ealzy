import SwiftUI

/// «Ещё» → «Илзи на iPhone»: включить модель на телефоне, следить за загрузкой, удалить её.
struct LocalBrainSection: View {
    private let brain = LocalBrain.shared
    @State private var confirmDelete = false

    private let quotas = QuotaStore.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            note("Зачем: с моделью прямо в iPhone Илзи работает бесплатно, без подписки — записи, напоминания, короткие ответы, даже без интернета. Поиск, планы и советы идут через облако: без подписки — небольшой лимит на неделю, с подпиской — больше и на месяц.")
            if let quota = quotas.quota, quota.enforced {
                cloudUsage(quota)
            }
            Divider().overlay(Palette.rule)
            Toggle(isOn: Binding(
                get: { brain.isEnabled },
                set: { on in if on { brain.enable() } else { brain.disable() } }
            )) {
                Label {
                    Text("Быстрее, прямо на iPhone").foregroundStyle(Palette.ink)
                } icon: {
                    Image(systemName: "bolt").foregroundStyle(Palette.goldText)
                }
            }
            .tint(Palette.gold)
            .disabled(!LocalBrain.deviceCanRun)
            .frame(minHeight: 50)

            status

            if brain.bytesOnDisk > 0, !isDownloading {
                Divider().overlay(Palette.rule)
                Button(role: .destructive) { confirmDelete = true } label: {
                    HStack {
                        Text("Удалить модель")
                        Spacer()
                        Text(Self.size(brain.bytesOnDisk)).foregroundStyle(Palette.ink3)
                    }
                }
                .frame(minHeight: 50)
            }
        }
        .onAppear { brain.refreshDiskState() }
        .task { await quotas.refresh() }
        .confirmationDialog("Удалить модель с iPhone?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) { brain.deleteModel() }
        } message: {
            Text("Освободится \(Self.size(brain.bytesOnDisk)). Илзи продолжит работать через облако.")
        }
    }

    private var isDownloading: Bool {
        if case .downloading = brain.phase { return true }
        return false
    }

    @ViewBuilder
    private var status: some View {
        if !LocalBrain.deviceCanRun {
            note("Нужен iPhone 15 Pro или новее — на этом всё работает через облако.")
        } else {
            switch brain.phase {
            case .downloading(let received, let total):
                ProgressView(value: Double(received), total: Double(max(total, 1)))
                    .tint(Palette.gold)
                    .padding(.top, 4)
                HStack(alignment: .firstTextBaseline) {
                    note(received < 1_000_000
                         ? "Подключаюсь к серверу с моделью… Лучше по Wi‑Fi, приложение держи открытым."
                         : "Скачиваю \(Self.size(received)) из \(Self.size(total)). Лучше по Wi‑Fi, приложение держи открытым.")
                    Spacer()
                    Button("Отменить") { brain.cancelDownload() }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Palette.goldText)
                }
            case .failed(let message):
                modelPicker
                note(message, color: .red)
                Button("Скачать ещё раз") { brain.enable() }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.goldText)
                    .padding(.bottom, 8)
            case .ready:
                note("Модель: \(brain.spec.title). Чтобы поменять — удали эту.")
                note(brain.isEnabled
                     ? "Простые записи и короткие ответы Илзи разбирает прямо на iPhone — за секунду и без интернета. Поиск, планы и советы — через облако, как раньше."
                     : "Модель скачана, но выключена: всё идёт через облако.")
            case .absent:
                modelPicker
                note("Скачается один раз. Простые записи пойдут на iPhone, сложное — через облако.")
            }
        }
    }

    /// Выбор модели — пока ничего не скачано.
    private var modelPicker: some View {
        VStack(spacing: 0) {
            ForEach(LocalModelSpec.all) { model in
                Button { brain.choose(model) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: brain.spec == model ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(Palette.goldText)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.title).foregroundStyle(Palette.ink)
                            Text(model.pitch).font(.footnote).foregroundStyle(Palette.ink3)
                        }
                        Spacer()
                        Text(Self.size(model.approxBytes)).font(.footnote).foregroundStyle(Palette.ink3)
                    }
                    .frame(minHeight: 46)
                }
                .disabled(!brain.canChooseModel)
            }
        }
        .padding(.top, 4)
    }

    /// Сколько облачных запросов осталось в этом периоде.
    private func cloudUsage(_ quota: CloudQuota) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if quota.period.limit > 0 {
                ProgressView(value: Double(min(quota.period.used, quota.period.limit)), total: Double(quota.period.limit))
                    .tint(quota.isExhausted ? .red : Palette.gold)
            }
            let left = quota.periodLeftPercent.map { "осталось \($0)%" } ?? "без лимита"
            let when = quota.isExhausted ? (quota.returnText().map { ", вернутся \($0)" } ?? "") : ""
            note("\(quota.planTitle): облачные запросы \(quota.periodWord) — \(quota.isExhausted ? "закончились" : left)\(when).")
        }
        .padding(.bottom, 4)
    }

    private func note(_ text: String, color: Color = Palette.ink3) -> some View {
        Text(text).font(.footnote).foregroundStyle(color).padding(.top, 6).padding(.bottom, 8)
    }

    static func size(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}
