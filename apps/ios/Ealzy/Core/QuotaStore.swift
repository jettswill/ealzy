import Foundation
import Observation

/// Последнее известное состояние лимита — для индикатора в шторке и в «Ещё».
@MainActor
@Observable
final class QuotaStore {
    static let shared = QuotaStore()
    private(set) var quota: CloudQuota?

    func refresh() async {
        guard !DemoData.isOn else { return }
        if let fresh: CloudQuota = try? await APIClient.shared.get("/billing/quota") {
            quota = fresh
        }
    }

    func update(_ quota: CloudQuota?) {
        if let quota { self.quota = quota }
    }

    /// Облако закончилось и ещё не вернулось.
    var cloudPaused: Bool {
        guard let quota, quota.isExhausted else { return false }
        return (quota.availableAt ?? .distantFuture) > Date()
    }
}
