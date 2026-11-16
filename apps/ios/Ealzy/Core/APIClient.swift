import Foundation

enum AppConfig {
    /// Тот же сервер, что у сайта и Telegram-бота.
    static let baseURL = URL(string: "https://ealzy.ru")!
}

enum APIError: LocalizedError {
    case unauthorized
    case server(String)
    case offline

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "Нужно войти заново."
        case .server(let message): return message
        case .offline: return "Нет связи с сервером. Попробуй ещё раз."
        }
    }
}

/// Тонкий клиент к API Ealzy: вся логика Илзи — на сервере.
final class APIClient {
    static let shared = APIClient()

    var onUnauthorized: (() -> Void)?

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 90 // ответ Илзи с поиском бывает долгим
        return URLSession(configuration: config)
    }()

    func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        try await call(path, method: "GET", query: query, body: Optional<String>.none)
    }

    func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await call(path, method: "POST", body: body)
    }

    func patch<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await call(path, method: "PATCH", body: body)
    }

    func delete<B: Encodable>(_ path: String, body: B) async throws {
        _ = try await raw(path, method: "DELETE", body: body)
    }

    private func call<T: Decodable, B: Encodable>(
        _ path: String, method: String, query: [String: String] = [:], body: B?
    ) async throws -> T {
        let data = try await raw(path, method: method, query: query, body: body)
        do {
            return try JSONCoding.decoder.decode(Envelope<T>.self, from: data).data
        } catch {
            throw APIError.server("Не понял ответ сервера.")
        }
    }

    private func raw<B: Encodable>(
        _ path: String, method: String, query: [String: String] = [:], body: B?
    ) async throws -> Data {
        var components = URLComponents(
            url: AppConfig.baseURL.appendingPathComponent("api" + path),
            resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = Keychain.readToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONCoding.encoder.encode(body)
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError.offline
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 {
            onUnauthorized?()
            throw APIError.unauthorized
        }
        guard (200..<300).contains(status) else {
            let message = (try? JSONCoding.decoder.decode(ServerErrorBody.self, from: data))?
                .error.message
            throw APIError.server(message ?? "Сервер ответил ошибкой \(status).")
        }
        return data
    }
}

/// Пустое тело для POST без параметров.
struct EmptyBody: Encodable {}
