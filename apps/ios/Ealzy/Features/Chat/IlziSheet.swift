import AVFoundation
import SwiftUI

/// Илзи — шторка поверх дня, всегда открыта на последнем сообщении. В полэкрана, во весь — когда печатаешь
/// или листаешь разговор. Закрывается свайпом вниз или касанием над шторкой.
struct IlziSheet: View {
    @Environment(ChatStore.self) private var chat
    @Environment(TasksStore.self) private var tasks
    @Environment(AppRouter.self) private var router
    @Binding var detent: PresentationDetent
    @State private var draft = ""
    @State private var speech = SpeechInput()
    @State private var spokenPrefix = ""
    @FocusState private var inputFocused: Bool
    /// Голосовой разговор: слушаем, по паузе отправляем, ответ Илзи читаем вслух.
    @State private var voiceMode = false
    @State private var lastSpeech = Date()
    @State private var voice = VoiceReply()


    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            QuotaBanner()
                .padding(.horizontal, 22)
                .padding(.top, 16)

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        // Весь разговор, открыт в самом конце: последнее — внизу, над полем ввода.
                        ForEach(Array(chat.messages.enumerated()), id: \.element.id) { index, message in
                            if let day = Self.dayLabel(for: message, after: index > 0 ? chat.messages[index - 1] : nil) {
                                Text(day)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Palette.ink3)
                                    .frame(maxWidth: .infinity)
                                    .padding(.top, index > 0 ? 6 : 0)
                            }
                            MessageBubble(message: message).id(message.id)
                        }
                        if voiceMode && speech.isRecording {
                            ListeningView(text: draft).id("listening")
                        }
                        if chat.isSending {
                            TypingDots().id("typing")
                        }
                        if draft.isEmpty && !chat.isSending, !chips.isEmpty {
                            suggestions
                        }
                        Color.clear.frame(height: 1).id(Self.end)
                    }
                    .padding(.horizontal, 22)
                    .padding(.top, 26)
                    .padding(.bottom, 12)
                }
                .scrollDismissesKeyboard(.interactively)
                .defaultScrollAnchor(.bottom)
                // Сверху разговор мягко уходит под край шторки, а не обрезается под «ручкой».
                .mask {
                    VStack(spacing: 0) {
                        LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
                            .frame(height: 36)
                        Color.black
                    }
                }
                .padding(.top, 20) // под «ручкой» шторки — пусто, текст начинается ниже
                .onAppear { toEnd(proxy) }
                .onChange(of: detent) { toEnd(proxy) }
                .onChange(of: chat.messages.last?.id) { toEnd(proxy, animated: true) }
                .onChange(of: chat.isSending) { toEnd(proxy, animated: true) }
            }

            inputBar
        }
        .background(Palette.sheet.ignoresSafeArea())
        .task { await chat.load() }
        .onChange(of: inputFocused) { if inputFocused { detent = .large } }
        .onChange(of: router.captureRequest) { inputFocused = true }
        .onChange(of: router.voicePending) { if router.voicePending { startVoice() } }
        .onAppear {
            if let text = router.pendingMessage {
                router.pendingMessage = nil
                send(text)
            }
            if router.voicePending { startVoice() }
        }
        .onDisappear {
            voiceMode = false
            speech.stop()
            voice.stop()
        }
        .task(id: voiceMode) {
            // Пауза в речи 1,6 с — фраза закончена, отправляем; тишина 8 с с самого начала — выключаем.
            guard voiceMode else { return }
            let started = Date()
            while voiceMode && !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(300))
                guard speech.isRecording else { continue }
                let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty && Date().timeIntervalSince(lastSpeech) > 1.6 {
                    speech.stop()
                    send(text, speakReply: true)
                    return
                }
                if text.isEmpty && Date().timeIntervalSince(started) > 8 {
                    speech.stop()
                    voiceMode = false
                    return
                }
            }
        }
    }

    private static let end = "end"

    /// Прокрутить в самый конец разговора. Шторка выезжает и меняет высоту с анимацией,
    /// поэтому прокручиваем ещё раз, когда она встанет на место.
    private func toEnd(_ proxy: ScrollViewProxy, animated: Bool = false) {
        let scroll = {
            if animated {
                withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(Self.end, anchor: .bottom) }
            } else {
                proxy.scrollTo(Self.end, anchor: .bottom)
            }
        }
        scroll()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: scroll)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: scroll)
    }

    /// «Сегодня», «Вчера», «15 ноября» — над первым сообщением нового дня.
    static func dayLabel(for message: ChatMessage, after previous: ChatMessage?, calendar: Calendar = .current) -> String? {
        guard let date = message.createdAt else { return nil }
        if let before = previous?.createdAt, calendar.isDate(before, inSameDayAs: date) { return nil }
        if calendar.isDateInToday(date) { return "Сегодня" }
        if calendar.isDateInYesterday(date) { return "Вчера" }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: Date())
        let style = sameYear
            ? Date.FormatStyle().day().month(.wide)
            : Date.FormatStyle().day().month(.wide).year()
        return date.formatted(style.locale(Locale(identifier: "ru_RU")))
    }

    /// Кнопки под разговором — только к месту:
    /// Илзи спросила — быстрые ответы на её вопрос; разговор давно затих или пуст — с чего начать;
    /// иначе ничего, чтобы не мешать.
    private var chips: [(label: String, text: String?)] {
        guard let last = chat.messages.last else { return Self.starters(focus: tasks.plan.focus.first) }
        if !last.isUser, last.content.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix("?") {
            return [("Да", "Да"), ("Нет, не надо", "Нет, не надо"), ("Позже", "Давай позже")]
        }
        let quiet = last.createdAt.map { Date().timeIntervalSince($0) > 3 * 3600 } ?? true
        return quiet ? Self.starters(focus: tasks.plan.focus.first) : []
    }

    private static func starters(focus: EalzyTask?) -> [(label: String, text: String?)] {
        [
            ("Что у меня сегодня?", "Что у меня сегодня?"),
            focus.map { ("Главное — на вечер", "Перенеси «\($0.title)» на сегодня вечер") },
            ("Разгрузить голову", "session:unload"),
            ("Стратегия", "session:strategy"),
        ].compactMap { $0 }
    }

    private var suggestions: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(chips, id: \.label) { chip in
                    Button(chip.label) {
                        if let text = chip.text, text.hasPrefix("session:") {
                            router.openSession(SessionMode(rawValue: String(text.dropFirst(8))) ?? .unload)
                        } else if let text = chip.text { send(text) } else { inputFocused = true }
                    }
                    .font(.subheadline)
                    .foregroundStyle(Palette.ink)
                    .padding(.horizontal, 14)
                    .frame(height: 36)
                    .overlay(Capsule().strokeBorder(Palette.rule))
                }
            }
        }
        .padding(.top, 2)
    }

    private var inputBar: some View {
        VStack(spacing: 4) {
            if let error = chat.errorMessage ?? speech.errorMessage {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            HStack(spacing: 10) {
                // Длинный рассказ, разговор по душам, стратегия — отдельным экраном сессии.
                Button { router.openSession(.unload) } label: {
                    Image(systemName: "brain.head.profile")
                        .font(.body)
                        .foregroundStyle(Palette.ink2)
                        .frame(width: 30, height: 44)
                }
                .accessibilityLabel("Сессия с Илзи")
                .padding(.leading, -8)
                TextField("Скажи Илзи…", text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($inputFocused)
                    .foregroundStyle(Palette.ink)
                if !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !speech.isRecording {
                    Button { send(draft) } label: {
                        Image(systemName: "arrow.up")
                            .font(.body.weight(.semibold))
                            .frame(width: 44, height: 44)
                            .background(Palette.gold, in: Circle())
                            .foregroundStyle(Palette.goldInk)
                    }
                    .disabled(chat.isSending)
                    .accessibilityLabel("Отправить")
                } else {
                    Button {
                        spokenPrefix = draft.isEmpty ? "" : draft + " "
                        voiceMode = false
                        Task { await speech.toggle { text in draft = spokenPrefix + text } }
                    } label: {
                        Image(systemName: speech.isRecording ? "stop.fill" : "mic.fill")
                            .font(.body.weight(.semibold))
                            .frame(width: 44, height: 44)
                            .background(speech.isRecording ? Color.red : Palette.gold, in: Circle())
                            .foregroundStyle(speech.isRecording ? Color.white : Palette.goldInk)
                            .symbolEffect(.pulse, isActive: speech.isRecording)
                    }
                    .accessibilityLabel(speech.isRecording ? "Остановить запись" : "Надиктовать")
                }
            }
            .padding(.leading, 18)
            .padding(.trailing, 5)
            .padding(.vertical, 5)
            .background(Palette.ground, in: Capsule())
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    private func send(_ text: String, speakReply: Bool = false) {
        speech.stop()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft = ""
        Task {
            let reply = await chat.capture(trimmed)
            if speakReply, let reply { voice.speak(reply) }
            voiceMode = false
            await tasks.load() // Илзи могла записать или поменять дела
        }
    }

    /// Как в Shazam: открыл — и уже слушаю.
    private func startVoice() {
        router.voicePending = false
        voice.stop()
        draft = ""
        lastSpeech = Date()
        voiceMode = true
        Task {
            await speech.start { text in
                draft = text
                lastSpeech = Date()
            }
            if !speech.isRecording { voiceMode = false }
        }
    }
}

/// Илзи слушает: пульсирующий круг и то, что уже расслышала.
struct ListeningView: View {
    let text: String

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            ZStack {
                Circle().fill(Palette.gold.opacity(0.25)).frame(width: 52, height: 52)
                    .phaseAnimator([false, true]) { view, on in
                        view.scaleEffect(on ? 1.15 : 0.9)
                    } animation: { _ in .easeInOut(duration: 0.8) }
                Circle().fill(Palette.gold).frame(width: 38, height: 38)
                Image(systemName: "mic.fill").foregroundStyle(Palette.goldInk)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Слушаю…").font(.footnote.weight(.semibold)).foregroundStyle(Palette.goldText)
                Text(text.isEmpty ? "Говори — сделаю паузу и отвечу" : text)
                    .font(.subheadline)
                    .foregroundStyle(text.isEmpty ? Palette.ink3 : Palette.ink)
                    .lineLimit(3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// Ответ Илзи вслух в голосовом разговоре.
@MainActor
@Observable
final class VoiceReply {
    private let synthesizer = AVSpeechSynthesizer()

    func speak(_ text: String) {
        let plain = text.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "*", with: "")
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: .duckOthers)
        try? AVAudioSession.sharedInstance().setActive(true)
        let utterance = AVSpeechUtterance(string: plain)
        utterance.voice = AVSpeechSynthesisVoice(language: "ru-RU")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 1.05
        synthesizer.speak(utterance)
    }

    func stop() {
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    }
}

/// «Илзи думает» — три точки, без лишних подписей.
struct TypingDots: View {
    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.35)) { context in
            let step = Int(context.date.timeIntervalSinceReferenceDate / 0.35) % 3
            HStack(spacing: 5) {
                ForEach(0..<3) { index in
                    Circle()
                        .fill(Palette.ink3.opacity(index == step ? 1 : 0.35))
                        .frame(width: 7, height: 7)
                }
            }
            .padding(.vertical, 6)
        }
        .accessibilityLabel("Илзи думает")
    }
}

struct MessageBubble: View {
    let message: ChatMessage
    var showTime = false
    var lineLimit: Int? = nil
    var expand: (() -> Void)? = nil

    var body: some View {
        if message.isUser {
            // Твои сообщения — справа, в золотистом пузыре.
            HStack {
                Spacer(minLength: 56)
                Text(Self.render(message.content))
                    .font(.body)
                    .foregroundStyle(Palette.ink)
                    .textSelection(.enabled)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Palette.gold.opacity(0.22), in: UnevenRoundedRectangle(
                        topLeadingRadius: 18, bottomLeadingRadius: 18, bottomTrailingRadius: 5, topTrailingRadius: 18))
            }
        } else {
            // Илзи — просто текст на всю ширину, без знака и пузыря: так читается как ответ.
            VStack(alignment: .leading, spacing: 6) {
                if showTime, let date = message.createdAt {
                    Text(date, format: .relative(presentation: .named))
                        .font(.caption)
                        .foregroundStyle(Palette.ink3)
                }
                Text(Self.render(message.content))
                    .font(.body)
                    .foregroundStyle(Palette.ink)
                    .lineSpacing(3)
                    .lineLimit(lineLimit)
                    .textSelection(.enabled)
                if let expand, lineLimit != nil, message.content.count > 220 {
                    Button("Показать полностью", action: expand)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Palette.goldText)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.trailing, 12)
        }
    }

    /// Илзи пишет с **жирными** заголовками и переносами строк.
    static func render(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}

/// Кнопки-подсказки переносятся на новую строку, когда не помещаются.
struct FlowRow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: min(maxX, width), height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
