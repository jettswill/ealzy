import UIKit

private struct DeviceRegistration: Encodable {
    let platform = "ios"
    let pushToken: String
    let environment: String
    let appVersion: String?
}

private struct RegisteredDevice: Decodable {
    let id: String
}

/// Push от сервера: утренний план, вечер, сообщения Илзи. Токен устройства уходит
/// на сервер (/api/devices); сами push заработают, когда на сервере будет ключ APNs.
final class AppDelegate: NSObject, UIApplicationDelegate {
    static let pushTokenKey = "apnsPushToken"

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        ReminderScheduler.shared.configure()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: Self.pushTokenKey)
        Task { await Self.upload(token: token) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Без подписи и без аккаунта Apple push недоступен — это ожидаемо.
    }

    static func upload(token: String? = UserDefaults.standard.string(forKey: pushTokenKey)) async {
        guard let token, Keychain.readToken() != nil else { return }
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        let body = DeviceRegistration(
            pushToken: token,
            environment: environment,
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        )
        let _: RegisteredDevice? = try? await APIClient.shared.post("/devices", body: body)
    }

    static func forget() async {
        guard let token = UserDefaults.standard.string(forKey: pushTokenKey), Keychain.readToken() != nil else { return }
        try? await APIClient.shared.delete("/devices", body: ["push_token": token])
    }
}
