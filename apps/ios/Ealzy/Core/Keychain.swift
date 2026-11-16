import Foundation
import Security

/// Токен сессии храним в связке ключей, а не в UserDefaults.
/// Доступен после первой разблокировки — нужно для кнопок в уведомлениях.
enum Keychain {
    private static let service = "ru.ealzy.app.session"
    private static let account = "token"

    static func readToken() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func saveToken(_ token: String) {
        let data = Data(token.utf8)
        let update = [kSecValueData as String: data]
        if SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary) == errSecItemNotFound {
            var insert = baseQuery
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(insert as CFDictionary, nil)
        }
    }

    static func deleteToken() {
        SecItemDelete(baseQuery as CFDictionary)
    }

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
