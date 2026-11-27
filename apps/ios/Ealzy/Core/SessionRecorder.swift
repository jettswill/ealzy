import AVFoundation
import Foundation
import Observation
import UIKit

/// Долгая голосовая запись для сессии с Илзи. В отличие от микрофона в чате
/// (распознавание на iPhone, около минуты), пишет звук в файл сколько угодно —
/// до получаса — с паузами; распознаёт сервер целиком. Экран не гаснет, а если
/// погасить его кнопкой, запись продолжается (фоновый режим «аудио»).
@MainActor
@Observable
final class SessionRecorder {
    enum State: Equatable { case idle, recording, paused }

    private(set) var state: State = .idle
    private(set) var elapsed: TimeInterval = 0
    /// Громкость 0…1 — для «живой» волны под кнопкой.
    private(set) var level: Double = 0
    var errorMessage: String?

    static let maxDuration: TimeInterval = 30 * 60

    private var recorder: AVAudioRecorder?
    private var meter: Task<Void, Never>?
    private let url = FileManager.default.temporaryDirectory.appendingPathComponent("ilzi-session.m4a")

    var hasRecording: Bool { elapsed > 0.5 }

    func start() async {
        errorMessage = nil
        guard await AVAudioApplication.requestRecordPermission() else {
            errorMessage = "Разреши микрофон в Настройках → Ealzy."
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
            try? FileManager.default.removeItem(at: url)
            // AAC, моно, 16 кГц, 32 кбит/с: полчаса — около 7 МБ, речи хватает.
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 16_000,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 32_000,
                AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
            ]
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.isMeteringEnabled = true
            guard recorder.record(forDuration: Self.maxDuration) else {
                errorMessage = "Не получилось включить микрофон."
                return
            }
            self.recorder = recorder
            elapsed = 0
            state = .recording
            UIApplication.shared.isIdleTimerDisabled = true
            startMeter()
        } catch {
            errorMessage = "Не получилось включить микрофон."
        }
    }

    func pause() {
        guard state == .recording else { return }
        recorder?.pause()
        state = .paused
        level = 0
    }

    func resume() {
        guard state == .paused, let recorder else { return }
        recorder.record()
        state = .recording
    }

    /// Остановить и отдать запись. nil — если записи нет.
    func finish() -> Data? {
        guard let recorder else { return nil }
        elapsed = max(elapsed, recorder.currentTime)
        recorder.stop()
        self.recorder = nil
        cleanup()
        guard elapsed > 0.5 else { return nil }
        return try? Data(contentsOf: url)
    }

    func cancel() {
        recorder?.stop()
        recorder = nil
        elapsed = 0
        cleanup()
        try? FileManager.default.removeItem(at: url)
    }

    private func cleanup() {
        meter?.cancel()
        meter = nil
        state = .idle
        level = 0
        UIApplication.shared.isIdleTimerDisabled = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func startMeter() {
        meter?.cancel()
        meter = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
                guard let self, let recorder = self.recorder else { return }
                if self.state == .recording {
                    recorder.updateMeters()
                    let power = Double(recorder.averagePower(forChannel: 0)) // −160…0 дБ
                    self.level = max(0, min(1, (power + 50) / 50))
                    self.elapsed = recorder.currentTime
                    if !recorder.isRecording && self.state == .recording {
                        // Дошли до получаса — запись остановилась сама.
                        self.state = .paused
                    }
                }
            }
        }
    }
}
