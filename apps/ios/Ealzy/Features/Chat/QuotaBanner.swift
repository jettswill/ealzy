import SwiftUI

/// Над разговором: облачные запросы заканчиваются, закончились, или Илзи отвечает с iPhone.
struct QuotaBanner: View {
    private let quotas = QuotaStore.shared
    private let brain = LocalBrain.shared

    var body: some View {
        if let quota = quotas.quota, quota.isLow || quotas.cloudPaused {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: quotas.cloudPaused ? (brain.isActive ? "iphone" : "cloud.slash") : "gauge.low")
                        .foregroundStyle(Palette.goldText)
                    Text(message(for: quota))
                        .font(.footnote)
                        .foregroundStyle(Palette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                action
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.pool, in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private func message(for quota: CloudQuota) -> String {
        let when = quota.returnText() ?? ""
        if quotas.cloudPaused {
            if brain.isActive {
                return "Облачные запросы \(quota.periodWord) закончились — отвечаю прямо с iPhone, попроще и без интернета. Облако вернётся \(when)."
            }
            return "Облачные запросы \(quota.periodWord) закончились, вернутся \(when). Чтобы продолжать бесплатно — скачай Илзи на iPhone."
        }
        let left = quota.periodLeftPercent.map { " — осталось около \($0)%" } ?? ""
        if brain.isActive {
            return "Облачные запросы \(quota.periodWord) заканчиваются\(left). Когда кончатся, отвечу с iPhone."
        }
        return "Облачные запросы \(quota.periodWord) заканчиваются\(left). С Илзи на iPhone можно продолжать бесплатно."
    }

    @ViewBuilder
    private var action: some View {
        switch brain.phase {
        case .downloading(let received, let total):
            ProgressView(value: Double(received), total: Double(max(total, 1)))
                .tint(Palette.gold)
            Text("Скачиваю \(LocalBrainSection.size(received)) из \(LocalBrainSection.size(total))")
                .font(.caption)
                .foregroundStyle(Palette.ink3)
        case .ready where !brain.isEnabled:
            Button("Включить Илзи на iPhone") { brain.enable() }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.goldText)
        case .absent, .failed:
            if LocalBrain.deviceCanRun {
                Button("Скачать Илзи на iPhone · \(LocalBrainSection.size(brain.spec.approxBytes))") { brain.enable() }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Palette.goldText)
            }
        default:
            EmptyView()
        }
    }
}
