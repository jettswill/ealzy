import CryptoKit
import Foundation
import Observation
import UIKit
import MLXLLM
import MLXLMCommon
import Tokenizers

/// Какую модель ставим на телефон. Поменять — одна строка в `current`.
struct LocalModelSpec: Sendable, Identifiable, Equatable {
    let repo: String
    let title: String
    /// Одной строкой — зачем выбирать эту модель.
    let pitch: String
    /// Размер для подсказки до загрузки.
    let approxBytes: Int64
    /// Конец реплики модели — без него она продолжает говорить за собеседника.
    let extraEOSTokens: Set<String>

    var id: String { repo }

    static let qwen35_2B = LocalModelSpec(
        repo: "mlx-community/Qwen3.5-2B-4bit", title: "Qwen 3.5 2B",
        pitch: "Легче и быстрее", approxBytes: 1_750_000_000, extraEOSTokens: ["<|im_end|>"]
    )
    static let gemma4E2B = LocalModelSpec(
        repo: "mlx-community/gemma-4-e2b-it-4bit", title: "Gemma 4 E2B",
        pitch: "Умнее, но вдвое тяжелее", approxBytes: 3_600_000_000, extraEOSTokens: ["<turn|>"]
    )

    /// Первая — по умолчанию.
    static let all = [qwen35_2B, gemma4E2B]
}

/// Илзи на телефоне: скачать модель по желанию, разбирать простые сообщения прямо на iPhone,
/// удалить целиком. Всё сложное — по-прежнему на сервере.
@MainActor
@Observable
final class LocalBrain {
    static let shared = LocalBrain()

    enum Phase: Equatable {
        case absent
        case downloading(received: Int64, total: Int64)
        case ready
        case failed(String)
    }

    private(set) var phase: Phase = .absent
    /// Сколько модель занимает на диске сейчас.
    private(set) var bytesOnDisk: Int64 = 0

    /// Пользователь включил «Быстрее, на iPhone».
    private(set) var isEnabled: Bool = false

    private func setEnabled(_ on: Bool) {
        isEnabled = on
        UserDefaults.standard.set(on, forKey: Self.enabledKey)
    }

    /// Выбранная модель. Поменять можно, пока ничего не скачано.
    private(set) var spec: LocalModelSpec = LocalModelSpec.all[0]

    var canChooseModel: Bool {
        switch phase {
        case .absent, .failed: return downloadTask == nil
        default: return false
        }
    }

    func choose(_ model: LocalModelSpec) {
        guard canChooseModel else { return }
        spec = model
        UserDefaults.standard.set(model.repo, forKey: Self.modelKey)
        phase = .absent
        refreshDiskState()
    }

    /// Модель работает и готова отвечать.
    var isActive: Bool { isEnabled && phase == .ready && Self.deviceCanRun }

    /// Нужно ~6 ГБ памяти и больше: iPhone 15 Pro и новее.
    static var deviceCanRun: Bool { ProcessInfo.processInfo.physicalMemory >= 7_000_000_000 }

    private static let enabledKey = "localBrainEnabled"
    private static let modelKey = "localBrainModel"
    private var downloadTask: Task<Void, Never>?
    private var container: ModelContainer?
    private var memoryObserver: NSObjectProtocol?

    private init() {
        isEnabled = UserDefaults.standard.bool(forKey: Self.enabledKey)
        let saved = UserDefaults.standard.string(forKey: Self.modelKey)
        spec = LocalModelSpec.all.first { $0.repo == saved } ?? LocalModelSpec.all[0]
        refreshDiskState()
        memoryObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.container = nil }
        }
    }

    // MARK: Файлы

    private var folder: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("LocalModel", isDirectory: true)
            .appendingPathComponent(spec.repo.replacingOccurrences(of: "/", with: "--"), isDirectory: true)
    }

    private var root: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("LocalModel", isDirectory: true)
    }

    private var completeMarker: URL { folder.appendingPathComponent(".complete") }

    func refreshDiskState() {
        bytesOnDisk = Self.size(of: root)
        if FileManager.default.fileExists(atPath: completeMarker.path) {
            phase = .ready
        } else if case .downloading = phase {
            // идёт загрузка — не трогаем
        } else if case .failed = phase {
        } else {
            phase = .absent
        }
    }

    private static func size(of url: URL) -> Int64 {
        guard let items = FileManager.default.enumerator(
            at: url, includingPropertiesForKeys: [.totalFileAllocatedSizeKey, .fileSizeKey]
        ) else { return 0 }
        var total: Int64 = 0
        for case let item as URL in items {
            let values = try? item.resourceValues(forKeys: [.totalFileAllocatedSizeKey, .fileSizeKey])
            total += Int64(values?.totalFileAllocatedSize ?? values?.fileSize ?? 0)
        }
        return total
    }

    // MARK: Загрузка и удаление

    /// Включить: если модели нет — скачать.
    func enable() {
        setEnabled(true)
        if phase != .ready { startDownload() }
    }

    func disable() {
        setEnabled(false)
        container = nil
    }

    func startDownload() {
        guard downloadTask == nil, Self.deviceCanRun else { return }
        phase = .downloading(received: 0, total: spec.approxBytes)
        UIApplication.shared.isIdleTimerDisabled = true
        downloadTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.downloadAll()
                self.phase = .ready
            } catch is CancellationError {
                self.phase = .absent
            } catch {
                let networkCodes: [URLError.Code] = [
                    .timedOut, .cannotConnectToHost, .cannotFindHost, .networkConnectionLost,
                    .secureConnectionFailed, .badServerResponse,
                ]
                let network = (error as? URLError).map { networkCodes.contains($0.code) } ?? false
                self.phase = .failed(network
                    ? "Сервер с моделью не отвечает — похоже, провайдер его режет. Попробуй другую сеть или VPN и нажми «Скачать ещё раз»: уже скачанное не пропадёт."
                    : "Не скачалось: \(error.localizedDescription) Попробуй ещё раз по Wi‑Fi.")
            }
            UIApplication.shared.isIdleTimerDisabled = false
            self.downloadTask = nil
            self.bytesOnDisk = Self.size(of: self.root)
        }
    }

    func cancelDownload() {
        downloadTask?.cancel()
        setEnabled(false)
    }

    /// Удалить модель целиком. Приложение возвращается к работе через облако.
    func deleteModel() {
        downloadTask?.cancel()
        downloadTask = nil
        container = nil
        setEnabled(false)
        try? FileManager.default.removeItem(at: root)
        bytesOnDisk = 0
        phase = .absent
    }

    private struct RemoteFile: Decodable {
        let type: String
        let path: String
        let size: Int64?
        let lfs: LFS?
        struct LFS: Decodable {
            let size: Int64?
            let oid: String?
        }
        var bytes: Int64 { lfs?.size ?? size ?? 0 }
        /// sha256 большого файла — по нему проверяем, что зеркало отдало ровно то же.
        var sha256: String? { lfs?.oid }
    }

    /// Откуда качаем: сначала Hugging Face, если он молчит — зеркало. Большие файлы сверяем по sha256.
    private static let hosts = ["https://huggingface.co", "https://hf-mirror.com"]

    /// Сколько ждём хотя бы байта, прежде чем пробовать другой адрес.
    private static let stallSeconds: Double = 25

    private func listFiles() async throws -> [RemoteFile] {
        var lastError: Error = URLError(.cannotConnectToHost)
        for host in Self.hosts {
            guard let url = URL(string: "\(host)/api/models/\(spec.repo)/tree/main") else { continue }
            var request = URLRequest(url: url)
            request.timeoutInterval = 20
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { continue }
                return try JSONDecoder().decode([RemoteFile].self, from: data)
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    private func downloadAll() async throws {
        let fm = FileManager.default
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        var rootURL = root
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? rootURL.setResourceValues(values)

        let files = try await listFiles()
            .filter { $0.type == "file" }
            .filter { file in
                let name = file.path
                return !name.contains("/")
                    && (name.hasSuffix(".safetensors") || name.hasSuffix(".json") || name.hasSuffix(".jinja"))
            }
            // Сначала маленькие файлы, потом тяжёлые.
            .sorted { $0.bytes < $1.bytes }
        guard files.contains(where: { $0.path.hasSuffix(".safetensors") }) else {
            throw URLError(.fileDoesNotExist)
        }
        let total = files.reduce(0) { $0 + $1.bytes }
        var done: Int64 = 0
        phase = .downloading(received: 0, total: total)

        for file in files {
            try Task.checkCancellation()
            let target = folder.appendingPathComponent(file.path)
            if let existing = try? fm.attributesOfItem(atPath: target.path)[.size] as? Int64,
               existing == file.bytes, file.bytes > 0 {
                done += file.bytes
                phase = .downloading(received: done, total: total)
                continue
            }
            let base = done
            var saved: URL?
            var lastError: Error = URLError(.cannotConnectToHost)
            for host in Self.hosts {
                guard let remote = URL(string: "\(host)/\(spec.repo)/resolve/main/\(file.path)") else { continue }
                do {
                    let temp = try await download(remote, stallAfter: Self.stallSeconds) { [weak self] received in
                        Task { @MainActor in
                            guard let self, case .downloading = self.phase else { return }
                            self.phase = .downloading(received: base + received, total: total)
                        }
                    }
                    if let expected = file.sha256, expected.count == 64 {
                        let actual = try await Self.sha256(of: temp)
                        guard actual == expected.lowercased() else {
                            try? fm.removeItem(at: temp)
                            throw URLError(.cannotDecodeContentData)
                        }
                    }
                    saved = temp
                    break
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    if Task.isCancelled { throw CancellationError() }
                    lastError = error
                    phase = .downloading(received: base, total: total)
                }
            }
            guard let saved else { throw lastError }
            try? fm.removeItem(at: target)
            try fm.moveItem(at: saved, to: target)
            done += file.bytes
            phase = .downloading(received: done, total: total)
        }
        fm.createFile(atPath: completeMarker.path, contents: Data())
    }

    /// sha256 большого файла частями, чтобы не держать гигабайты в памяти.
    private nonisolated static func sha256(of url: URL) async throws -> String {
        try await Task.detached(priority: .utility) {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            var hasher = SHA256()
            while let chunk = try handle.read(upToCount: 8 * 1024 * 1024), !chunk.isEmpty {
                hasher.update(data: chunk)
            }
            return hasher.finalize().map { String(format: "%02x", $0) }.joined()
        }.value
    }

    /// Один файл. Прогресс берём из счётчика байтов задачи; если байты не идут `stallAfter` секунд — бросаем.
    private nonisolated func download(
        _ url: URL, stallAfter: Double, progress: @escaping @Sendable (Int64) -> Void
    ) async throws -> URL {
        let box = DownloadBox()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                var request = URLRequest(url: url)
                request.timeoutInterval = 60
                let task = URLSession.shared.downloadTask(with: request) { location, response, error in
                    box.finished = true
                    if let error {
                        continuation.resume(throwing: box.stalled ? URLError(.timedOut) : error)
                        return
                    }
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard let location, (200..<300).contains(status) else {
                        continuation.resume(throwing: URLError(.badServerResponse))
                        return
                    }
                    // Файл живёт только до конца этого блока — переносим к себе.
                    let keep = FileManager.default.temporaryDirectory
                        .appendingPathComponent(UUID().uuidString)
                    do {
                        try FileManager.default.moveItem(at: location, to: keep)
                        continuation.resume(returning: keep)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
                box.task = task
                task.resume()
                // Сторож: раз в полсекунды отдаёт прогресс и замечает, что загрузка встала.
                Task.detached {
                    var lastBytes: Int64 = -1
                    var lastChange = Date()
                    while !box.finished {
                        try? await Task.sleep(for: .milliseconds(500))
                        let bytes = task.countOfBytesReceived
                        if bytes != lastBytes {
                            lastBytes = bytes
                            lastChange = Date()
                            progress(bytes)
                        } else if Date().timeIntervalSince(lastChange) > stallAfter {
                            box.stalled = true
                            task.cancel()
                            return
                        }
                    }
                }
            }
        } onCancel: {
            box.task?.cancel()
        }
    }

    // MARK: Ответы

    /// Решить на телефоне, что делать с сообщением. nil — модель не готова или не успела.
    func decide(_ text: String, timeout: Duration = .seconds(12)) async -> LocalDecision? {
        guard isActive else { return nil }
        let now = Date()
        let instructions = LocalDecisionParser.instructions(now: now)
        do {
            let model = try await loadedContainer()
            let raw: String? = try await withThrowingTaskGroup(of: String?.self) { group in
                group.addTask {
                    let session = ChatSession(
                        model,
                        instructions: instructions,
                        generateParameters: GenerateParameters(maxTokens: 160, temperature: 0.1),
                        additionalContext: ["enable_thinking": false]
                    )
                    return try await session.respond(to: text)
                }
                group.addTask {
                    try await Task.sleep(for: timeout)
                    return nil
                }
                let first = try await group.next() ?? nil
                group.cancelAll()
                return first
            }
            guard let raw else { return nil }
            return LocalDecisionParser.parse(raw, userText: text, now: now)
        } catch {
            return nil
        }
    }

    /// Ответ целиком на телефоне — когда облачные запросы закончились.
    func reply(to text: String, timeout: Duration = .seconds(30)) async -> String? {
        guard isActive else { return nil }
        let instructions = """
        Ты — Илзи, тёплый личный помощник. Отвечай по-русски, коротко и по делу, на «ты».
        Сейчас ты работаешь прямо на телефоне, без интернета: не выдумывай факты, цены, адреса и новости.
        Если для ответа нужен поиск или точные данные — честно скажи, что вернёшься к этому, когда облако снова будет доступно.
        """
        do {
            let model = try await loadedContainer()
            let raw: String? = try await withThrowingTaskGroup(of: String?.self) { group in
                group.addTask {
                    let session = ChatSession(
                        model,
                        instructions: instructions,
                        generateParameters: GenerateParameters(maxTokens: 400, temperature: 0.5),
                        additionalContext: ["enable_thinking": false]
                    )
                    return try await session.respond(to: text)
                }
                group.addTask {
                    try await Task.sleep(for: timeout)
                    return nil
                }
                let first = try await group.next() ?? nil
                group.cancelAll()
                return first
            }
            var answer = raw ?? ""
            if let end = answer.range(of: "</think>") { answer = String(answer[end.upperBound...]) }
            answer = answer.trimmingCharacters(in: .whitespacesAndNewlines)
            return answer.isEmpty ? nil : answer
        } catch {
            return nil
        }
    }

    private func loadedContainer() async throws -> ModelContainer {
        if let container { return container }
        let configuration = ModelConfiguration(directory: folder, extraEOSTokens: spec.extraEOSTokens)
        let loaded = try await LLMModelFactory.shared.loadContainer(
            from: OfflineDownloader(), using: TransformersTokenizerLoader(), configuration: configuration
        )
        container = loaded
        return loaded
    }

    /// Прогреть модель заранее (при открытии шторки Илзи), чтобы первый ответ был быстрым.
    func warmUp() {
        guard isActive, container == nil else { return }
        Task { _ = try? await loadedContainer() }
    }
}

/// Держит задачу загрузки и наблюдателя прогресса.
private final class DownloadBox: @unchecked Sendable {
    var task: URLSessionDownloadTask?
    var finished = false
    var stalled = false
}

/// Модель уже лежит на диске — сеть не нужна.
private struct OfflineDownloader: MLXLMCommon.Downloader {
    func download(
        id: String, revision: String?, matching patterns: [String], useLatest: Bool,
        progressHandler: @Sendable @escaping (Progress) -> Void
    ) async throws -> URL {
        throw URLError(.notConnectedToInternet)
    }
}

/// Токенизатор из swift-transformers в виде, который понимает MLX.
private struct TransformersTokenizerLoader: MLXLMCommon.TokenizerLoader {
    func load(from directory: URL) async throws -> any MLXLMCommon.Tokenizer {
        let upstream = try await Tokenizers.AutoTokenizer.from(modelFolder: directory)
        return TokenizerBridge(upstream: upstream)
    }
}

private struct TokenizerBridge: MLXLMCommon.Tokenizer {
    let upstream: any Tokenizers.Tokenizer

    func encode(text: String, addSpecialTokens: Bool) -> [Int] {
        upstream.encode(text: text, addSpecialTokens: addSpecialTokens)
    }

    func decode(tokenIds: [Int], skipSpecialTokens: Bool) -> String {
        upstream.decode(tokens: tokenIds, skipSpecialTokens: skipSpecialTokens)
    }

    func convertTokenToId(_ token: String) -> Int? { upstream.convertTokenToId(token) }
    func convertIdToToken(_ id: Int) -> String? { upstream.convertIdToToken(id) }

    var bosToken: String? { upstream.bosToken }
    var eosToken: String? { upstream.eosToken }
    var unknownToken: String? { upstream.unknownToken }

    func applyChatTemplate(
        messages: [[String: any Sendable]],
        tools: [[String: any Sendable]]?,
        additionalContext: [String: any Sendable]?
    ) throws -> [Int] {
        do {
            return try upstream.applyChatTemplate(
                messages: messages, tools: tools, additionalContext: additionalContext)
        } catch Tokenizers.TokenizerError.missingChatTemplate {
            throw MLXLMCommon.TokenizerError.missingChatTemplate
        }
    }
}
