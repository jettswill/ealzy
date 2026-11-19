import Foundation
import Observation
import SwiftUI

/// «Твои вкусы»: что нравится, что реже, что никогда. Гипотезы по тому, что Илзи
/// знает о человеке, строит модель на iPhone (бесплатно, без лимита), а если её
/// нет или она не справилась — облако.
@MainActor
@Observable
final class TastesStore {
    private(set) var tastes: Tastes?
    private(set) var busy = false
    private(set) var busyText: String?
    var error: String?

    func load() async {
        if DemoData.isOn { return }
        do { tastes = try await SurpriseAPI.tastes() } catch { self.error = error.localizedDescription }
    }

    /// Снять свою отметку («нравится» / «никогда»).
    func clear(_ item: TasteItem) async {
        do {
            tastes = try await SurpriseAPI.setVerdict(kind: item.targetKind, id: item.targetId, verdict: nil)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func refresh() async {
        busy = true
        error = nil
        defer { busy = false; busyText = nil }
        if LocalBrain.shared.isActive {
            busyText = "Думаю прямо на iPhone — до пары минут…"
            if await refreshOnPhone() { return }
        }
        busyText = "Думаю…"
        do {
            tastes = try await SurpriseAPI.refreshInCloud()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// true — гипотезы построены на телефоне и сохранены.
    private func refreshOnPhone() async -> Bool {
        guard let evidence = try? await SurpriseAPI.evidence() else { return false }
        if evidence.facts.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            error = "Пока мало знаю о тебе. Отмечай места и лайки на колесе — вкусы соберутся сами."
            return true
        }
        guard let raw = await LocalBrain.shared.complete(
            instructions: LocalTastes.instructions(catalog: evidence.catalog),
            prompt: "Факты о человеке:\n\(evidence.facts)"
        ) else { return false }
        guard let parsed = LocalTastes.parse(raw), !parsed.hypotheses.isEmpty else { return false }
        do {
            tastes = try await SurpriseAPI.saveLocal(summary: parsed.summary, hypotheses: parsed.hypotheses)
            return true
        } catch {
            return false
        }
    }
}

struct TastesView: View {
    @State private var store = TastesStore()

    init() {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Твои вкусы")
                    .font(Typeface.display(30))
                    .foregroundStyle(Palette.ink)

                if let summary = store.tastes?.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.body)
                        .foregroundStyle(Palette.ink2)
                        .padding(.top, 12)
                }

                let items = store.tastes?.items ?? []
                group("Нравится", items.filter { $0.verdict == "like" || ($0.verdict == nil && $0.score > 0.15) })
                group("Реже", items.filter { $0.verdict == nil && $0.score < -0.15 })
                group("Никогда не предлагать", items.filter { $0.verdict == "never" })

                if store.tastes != nil, items.isEmpty {
                    Text("Пока пусто. Ставь «Нравится» и «Не предлагать» на колесе, отмечай места — колесо подстроится.")
                        .font(.footnote).foregroundStyle(Palette.ink3).padding(.top, 20)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Divider().overlay(Palette.rule).padding(.top, 24)
                    Button {
                        Task { await store.refresh() }
                    } label: {
                        HStack(spacing: 8) {
                            if store.busy { ProgressView().controlSize(.small) }
                            Text(store.busy ? (store.busyText ?? "Думаю…") : "Обновить по тому, что Илзи обо мне знает")
                                .multilineTextAlignment(.leading)
                        }
                        .frame(minHeight: 50, alignment: .leading)
                    }
                    .foregroundStyle(Palette.goldText)
                    .disabled(store.busy)
                    Text(LocalBrain.shared.isActive
                         ? "Гипотезы строит модель прямо на iPhone — бесплатно и без лимита."
                         : "Гипотезы строит облако — это один облачный запрос. С моделью на iPhone («Ещё» → «Илзи на iPhone») — бесплатно.")
                        .font(.footnote).foregroundStyle(Palette.ink3)
                    if let error = store.error {
                        Text(error).font(.footnote).foregroundStyle(.red).padding(.top, 4)
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 8)
            .padding(.bottom, 40)
        }
        .background { LampBackground() }
        .task { await store.load() }
    }

    @ViewBuilder
    private func group(_ title: String, _ items: [TasteItem]) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.footnote).foregroundStyle(Palette.ink3).padding(.bottom, 8)
                ForEach(items) { item in
                    VStack(spacing: 0) {
                        Divider().overlay(Palette.rule)
                        HStack(alignment: .top, spacing: 10) {
                            Text(item.emoji ?? "✨")
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.name).foregroundStyle(Palette.ink)
                                if let reason = item.reason, !reason.isEmpty {
                                    Text(reason).font(.footnote).foregroundStyle(Palette.ink3)
                                } else if item.source == "visits" {
                                    Text("по твоим оценкам мест").font(.footnote).foregroundStyle(Palette.ink3)
                                }
                            }
                            Spacer()
                            if item.verdict != nil {
                                Button {
                                    Task { await store.clear(item) }
                                } label: {
                                    Image(systemName: "xmark.circle")
                                        .foregroundStyle(Palette.ink3)
                                        .frame(width: 32, height: 32)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Передумал: \(item.name)")
                            }
                        }
                        .padding(.vertical, 10)
                    }
                }
            }
            .padding(.top, 26)
        }
    }
}
