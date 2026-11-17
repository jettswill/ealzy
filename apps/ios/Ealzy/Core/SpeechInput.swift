import AVFoundation
import Foundation
import Observation
import Speech

/// Кнопка микрофона: говоришь — текст появляется в поле. Распознавание по-русски,
/// на устройстве, если iPhone это умеет (тогда без интернета и без отправки звука).
@MainActor
@Observable
final class SpeechInput {
    private(set) var isRecording = false
    private(set) var transcript = ""
    var errorMessage: String?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ru-RU"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func toggle(onText: @escaping (String) -> Void) async {
        if isRecording {
            stop()
        } else {
            await start(onText: onText)
        }
    }

    func start(onText: @escaping (String) -> Void) async {
        errorMessage = nil
        guard await Self.authorize() else {
            errorMessage = "Разреши микрофон и распознавание речи в Настройках → Ealzy."
            return
        }
        guard let recognizer, recognizer.isAvailable else {
            errorMessage = "Распознавание речи сейчас недоступно."
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
            request.addsPunctuation = true
            self.request = request

            let input = engine.inputNode
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
                request.append(buffer)
            }
            engine.prepare()
            try engine.start()
            isRecording = true
            transcript = ""

            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                Task { @MainActor in
                    guard let self else { return }
                    if let result {
                        self.transcript = result.bestTranscription.formattedString
                        onText(self.transcript)
                        if result.isFinal { self.stop() }
                    }
                    if error != nil, self.isRecording { self.stop() }
                }
            }
        } catch {
            errorMessage = "Не получилось включить микрофон."
            stop()
        }
    }

    func stop() {
        guard isRecording || engine.isRunning else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.finish()
        request = nil
        task = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private static func authorize() async -> Bool {
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }
}
