import Foundation
import Security

/// Токен сессии — в связке ключей, общей для приложения, виджета и «Поделиться»
/// (группа из Info.plist `EalzyKeychainGroup`). Сборка без подписи (CI, симулятор)
/// группу не получает — тогда работаем без неё, только внутри приложения.
enum Keychain {
    private static let service = "ru.ealzy.app.session"
    private static let account = "token"

    private static var sharedGroup: String? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "EalzyKeychainGroup") as? String,
              !group.isEmpty, !group.hasPrefix("$(") else { return nil }
        return group
    }

    static func readToken() -> String? {
        for group in candidateGroups {
            var query = baseQuery(group: group)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var item: CFTypeRef?
            if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
               let data = item as? Data,
               let token = String(data: data, encoding: .utf8) {
                return token
            }
        }
        return nil
    }

    static func saveToken(_ token: String) {
        let data = Data(token.utf8)
        for group in candidateGroups {
            let query = baseQuery(group: group)
            let update = [kSecValueData as String: data]
            var status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
            if status == errSecItemNotFound {
                var insert = query
                insert[kSecValueData as String] = data
                insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
                status = SecItemAdd(insert as CFDictionary, nil)
            }
            if status == errSecSuccess { return }
        }
    }

    static func deleteToken() {
        for group in candidateGroups {
            SecItemDelete(baseQuery(group: group) as CFDictionary)
        }
    }

    /// Сначала общая группа, затем личная связка приложения (запасной путь и старые входы).
    private static var candidateGroups: [String?] {
        sharedGroup.map { [$0, nil] } ?? [nil]
    }

    private static func baseQuery(group: String?) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group { query[kSecAttrAccessGroup as String] = group }
        return query
    }
}
