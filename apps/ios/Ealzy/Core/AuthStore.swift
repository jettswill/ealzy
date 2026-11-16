import Foundation
import Observation
import UIKit

/// Вход: через Telegram (тот же аккаунт, что в боте) или Google.
@MainActor
@Observable
final class AuthStore {
    enum Phase: Equatable {
        case idle
        case waitingForTelegram
        case working
    }

    private(set) var isSignedIn = Keychain.readToken() != nil
    private(set) var phase: Phase = .idle
    var errorMessage: String?

    private var pollTask: Task<Void, Never>?

    init() {
        APIClient.shared.onUnauthorized = { [weak self] in
            Task { @MainActor in self?.signOut() }
        }
    }

    // MARK: Telegram

    func signInWithTelegram() async {
        errorMessage = nil
        phase = .working
        do {
            let start: AppLoginStart = try await APIClient.shared.post("/auth/app-login/start", body: EmptyBody())
            guard let link = Self.telegramLink(start) else {
                throw APIError.server("Вход через Telegram пока не настроен на сервере.")
            }
            phase = .waitingForTelegram
            _ = await UIApplication.shared.open(link)
            poll(nonce: start.nonce, expiresIn: start.expiresIn)
        } catch {
            phase = .idle
            errorMessage = error.localizedDescription
        }
    }

    func cancelTelegram() {
        pollTask?.cancel()
        pollTask = nil
        phase = .idle
    }

    private static func telegramLink(_ start: AppLoginStart) -> URL? {
        if let app = start.telegramAppUrl.flatMap(URL.init(string:)),
           UIApplication.shared.canOpenURL(app) {
            return app
        }
        return start.telegramUrl.flatMap(URL.init(string:))
    }

    private func poll(nonce: String, expiresIn: Int) {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            let deadline = Date().addingTimeInterval(TimeInterval(expiresIn))
            while !Task.isCancelled, Date() < deadline {
                try? await Task.sleep(for: .seconds(2))
                guard let self, !Task.isCancelled else { return }
                do {
                    let result: AppLoginPoll = try await APIClient.shared.post(
                        "/auth/app-login/poll", body: ["nonce": nonce]
                    )
                    switch result.status {
                    case "approved":
                        if let token = result.token { self.finish(token: token) }
                        return
                    case "expired":
                        self.phase = .idle
                        self.errorMessage = "Ссылка для входа устарела. Попробуй ещё раз."
                        return
                    default:
                        continue
                    }
                } catch {
                    continue // сеть могла пропасть, пока человек был в Telegram
                }
            }
            if self?.phase == .waitingForTelegram { self?.phase = .idle }
        }
    }

    // MARK: Google и общий возврат по ealzy://auth/callback

    static var googleStartURL: URL {
        var components = URLComponents(
            url: AppConfig.baseURL.appendingPathComponent("api/auth/oauth/google/start"),
            resolvingAgainstBaseURL: false
        )!
        components.queryItems = [URLQueryItem(name: "client", value: "ios")]
        return components.url!
    }

    /// `ealzy://auth/callback#token=…` или `#error=…`.
    func handleCallback(_ url: URL) {
        guard url.scheme == "ealzy", url.host == "auth" else { return }
        var fragment = URLComponents()
        fragment.query = url.fragment
        let items = fragment.queryItems ?? []
        if let token = items.first(where: { $0.name == "token" })?.value, !token.isEmpty {
            finish(token: token)
        } else if let error = items.first(where: { $0.name == "error" })?.value {
            errorMessage = error
            phase = .idle
        }
    }

    // MARK: Сессия

    private func finish(token: String) {
        Keychain.saveToken(token)
        pollTask?.cancel()
        pollTask = nil
        phase = .idle
        errorMessage = nil
        isSignedIn = true
        Task { await ReminderScheduler.shared.requestPermission() }
    }

    /// Продлеваем сессию при каждом запуске, чтобы человек не выпадал из аккаунта.
    func refresh() async {
        guard isSignedIn else { return }
        if let session: SessionPayload = try? await APIClient.shared.post("/auth/refresh", body: EmptyBody()) {
            Keychain.saveToken(session.token)
        }
    }

    func signOut() {
        Keychain.deleteToken()
        isSignedIn = false
        phase = .idle
    }
}
