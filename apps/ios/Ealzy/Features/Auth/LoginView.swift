import AuthenticationServices
import SwiftUI

struct LoginView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            VStack(spacing: 28) {
                Image("EalzyLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 200)
                    .foregroundStyle(Palette.goldText)
                    .accessibilityLabel("Ealzy")
                VStack(spacing: 10) {
                    Text("Освободи голову")
                        .font(Typeface.display(34))
                        .foregroundStyle(Palette.ink)
                    Text("Дела, мысли и планы держу я. Подскажу, напомню и буду рядом.")
                        .font(.title3)
                        .foregroundStyle(Palette.ink2)
                }
                .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 32)
            Spacer()

            if auth.phase == .waitingForTelegram {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Нажми «Старт» в боте Ealzy и вернись сюда.")
                        .font(.callout)
                        .multilineTextAlignment(.center)
                    Button("Отменить") { auth.cancelTelegram() }
                        .font(.callout)
                }
                .padding(.horizontal, 32)
            } else {
                VStack(spacing: 12) {
                    Button {
                        Task { await auth.signInWithTelegram() }
                    } label: {
                        Label("Войти через Telegram", systemImage: "paperplane.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Palette.gold)
                    .foregroundStyle(Palette.goldInk)
                    .controlSize(.large)

                    Button {
                        Task { await signInWithGoogle() }
                    } label: {
                        Text("Войти через Google").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                }
                .disabled(auth.phase == .working)
                .padding(.horizontal, 24)
            }

            if let error = auth.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            Text("Тот же аккаунт, что в Telegram-боте и на ealzy.ru: дела, люди и память — общие.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.bottom, 24)
        }
        .background { LampBackground() }
        .foregroundStyle(Palette.ink)
    }

    private func signInWithGoogle() async {
        do {
            let callback = try await webAuthenticationSession.authenticate(
                using: AuthStore.googleStartURL,
                callbackURLScheme: "ealzy",
                preferredBrowserSession: .shared
            )
            auth.handleCallback(callback)
        } catch {
            // Закрыл окно входа — это не ошибка.
        }
    }
}
