import SwiftUI

/// Илзи — шторка поверх дня. Открывается в полэкрана, во весь — когда печатаешь
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

    private var isHalf: Bool { detent == .medium }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, 22)
                .padding(.top, 22)
                .padding(.bottom, 4)

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        // В полэкрана — только последний ответ Илзи (коротко), полностью — весь разговор.
                        if isHalf {
                            if let last = chat.messages.last(where: { !$0.isUser }) ?? chat.messages.last {
                                MessageBubble(message: last, showTime: true, lineLimit: 5) {
                                    detent = .large
                                }
                                .id(last.id)
                            }
                        } else {
                            ForEach(chat.messages) { message in
                                MessageBubble(message: message).id(message.id)
                            }
                        }
                        if chat.isSending {
                            HStack(spacing: 8) {
                                ProgressView()
                                Text("Илзи думает…").font(.footnote).foregroundStyle(Palette.ink3)
                            }
                            .id("typing")
                        }
                        if draft.isEmpty && !chat.isSending {
                            suggestions
                        }
                    }
                    .padding(.horizontal, 22)
                    .padding(.vertical, 16)
                }
                .scrollDismissesKeyboard(.interactively)
                .defaultScrollAnchor(.bottom)
                .onChange(of: detent) {
                    guard let last = chat.messages.last?.id else { return }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { proxy.scrollTo(last, anchor: .bottom) }
                }
                .onChange(of: chat.messages.count) {
                    guard let last = chat.messages.last?.id else { return }
                    withAnimation { proxy.scrollTo(last, anchor: .bottom) }
                }
                .onAppear {
                    if let last = chat.messages.last?.id { proxy.scrollTo(last, anchor: .bottom) }
                }
            }

            inputBar
        }
        .background(Palette.raised.ignoresSafeArea())
        .task { await chat.load() }
        .onChange(of: inputFocused) { if inputFocused { detent = .large } }
        .onChange(of: router.captureRequest) { inputFocused = true }
        .onAppear {
            if let text = router.pendingMessage {
                router.pendingMessage = nil
                send(text)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image("IlziMark")
                .resizable()
                .frame(width: 34, height: 34)
                .foregroundStyle(Palette.goldText)
            VStack(alignment: .leading, spacing: 1) {
                Text("Илзи").font(.headline).foregroundStyle(Palette.ink)
                Text(chat.isSending ? "думает…" : "на связи").font(.caption).foregroundStyle(Palette.ink3)
            }
            Spacer()
        }
        .accessibilityElement(children: .combine)
    }

    /// Подсказки по ситуации: что можно попросить прямо сейчас.
    private var suggestions: some View {
        let focus = tasks.plan.focus.first
        let items = [
            "Что у меня сегодня?",
            focus.map { _ in "Главное — на вечер" },
            "Выгрузить мысли",
        ].compactMap { $0 }
        return ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(items, id: \.self) { item in
                Button(item) {
                    if item == "Выгрузить мысли" {
                        inputFocused = true
                    } else if item == "Главное — на вечер", let focus {
                        send("Перенеси «\(focus.title)» на сегодня вечер")
                    } else {
                        send(item)
                    }
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

    private func send(_ text: String) {
        speech.stop()
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft = ""
        Task {
            _ = await chat.capture(trimmed)
            await tasks.load() // Илзи могла записать или поменять дела
        }
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
            // Илзи — слева, со своим знаком, на «бумаге», без пузыря.
            HStack(alignment: .top, spacing: 10) {
                Image("IlziMark")
                    .resizable()
                    .frame(width: 20, height: 20)
                    .foregroundStyle(Palette.goldText)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 6) {
                    if showTime, let date = message.createdAt {
                        Text(date, format: .relative(presentation: .named))
                            .font(.caption)
                            .foregroundStyle(Palette.ink3)
                    }
                    Text(Self.render(message.content))
                        .font(.body)
                        .foregroundStyle(Palette.ink)
                        .lineSpacing(2)
                        .lineLimit(lineLimit)
                        .textSelection(.enabled)
                    if let expand, lineLimit != nil, message.content.count > 220 {
                        Button("Показать полностью", action: expand)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Palette.goldText)
                    }
                }
                Spacer(minLength: 24)
            }
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
