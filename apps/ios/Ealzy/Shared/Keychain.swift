import Foundation
import Security

/// Токен сессии — в связке ключей, общей для приложения, виджета и «Поделиться»
/// (группа из Info.plist `EalzyKeychainGroup`). Сборка без подписи (CI, симулятор)
/// группу не получает — тогда работаем без неё, только внутри приложения.
enum Keychain {
    private static let service = "ru.ealzy.app.session"
    private static let account = "token"
    private static let snapshotAccount = "widget-snapshot"
    private static let placeAccount = "widget-place"

    private static var sharedGroup: String? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "EalzyKeychainGroup") as? String,
              !group.isEmpty, !group.hasPrefix("$(") else { return nil }
        return group
    }

    static func readToken() -> String? {
        readData(account: account).flatMap { String(data: $0, encoding: .utf8) }
    }

    static func saveToken(_ token: String) {
        saveData(Data(token.utf8), account: account)
    }

    static func deleteToken() {
        delete(account: account)
    }

    /// Снимок для виджета, если нет общей папки (бесплатная учётка Apple без групп приложений).
    static func readSnapshot() -> Data? { readData(account: snapshotAccount) }
    static func saveSnapshot(_ data: Data) { saveData(data, account: snapshotAccount) }
    static func deleteSnapshot() { delete(account: snapshotAccount) }

    /// Где телефон и погода там — тоже для виджета без общей папки.
    static func readPlace() -> Data? { readData(account: placeAccount) }
    static func savePlace(_ data: Data) { saveData(data, account: placeAccount) }
    static func deletePlace() { delete(account: placeAccount) }

    private static func readData(account: String) -> Data? {
        for group in candidateGroups {
            var query = baseQuery(group: group, account: account)
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var item: CFTypeRef?
            if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data {
                return data
            }
        }
        return nil
    }

    private static func saveData(_ data: Data, account: String) {
        for group in candidateGroups {
            let query = baseQuery(group: group, account: account)
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

    private static func delete(account: String) {
        for group in candidateGroups {
            SecItemDelete(baseQuery(group: group, account: account) as CFDictionary)
        }
    }

    /// Сначала общая группа, затем личная связка приложения (запасной путь и старые входы).
    private static var candidateGroups: [String?] {
        sharedGroup.map { [$0, nil] } ?? [nil]
    }

    private static func baseQuery(group: String?, account: String) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let group { query[kSecAttrAccessGroup as String] = group }
        return query
    }
}
