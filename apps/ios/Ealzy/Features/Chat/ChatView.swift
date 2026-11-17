import SwiftUI

struct ChatView: View {
    @Environment(ChatStore.self) private var chat
    @Environment(TasksStore.self) private var tasks
    @State private var draft = ""
    @State private var speech = SpeechInput()
    @State private var spokenPrefix = ""
    @FocusState private var inputFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
                        if chat.messages.isEmpty {
                            Text("Напиши или надиктуй всё, что висит в голове, — Илзи разберёт.")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .padding(.top, 40)
                        }
                        ForEach(chat.messages) { message in
                            MessageBubble(message: message).id(message.id)
                        }
                        if chat.isSending {
                            HStack {
                                ProgressView()
                                Text("Илзи думает…").font(.footnote).foregroundStyle(.secondary)
                                Spacer()
                            }
                            .padding(.horizontal)
                            .id("typing")
                        }
                    }
                    .padding(.vertical)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: chat.messages.count) {
                    guard let last = chat.messages.last?.id else { return }
                    withAnimation { proxy.scrollTo(last, anchor: .bottom) }
                }
                .onAppear {
                    if let last = chat.messages.last?.id { proxy.scrollTo(last, anchor: .bottom) }
                }
            }
            .background(Palette.ground.ignoresSafeArea())
            .safeAreaInset(edge: .bottom) { inputBar }
            .navigationTitle("Илзи")
            .navigationBarTitleDisplayMode(.inline)
            .task { await chat.load() }
            .refreshable { await chat.load() }
        }
    }

    private var inputBar: some View {
        VStack(spacing: 4) {
            if let error = chat.errorMessage ?? speech.errorMessage {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            HStack(alignment: .bottom, spacing: 8) {
                Button {
                    spokenPrefix = draft.isEmpty ? "" : draft + " "
                    Task { await speech.toggle { text in draft = spokenPrefix + text } }
                } label: {
                    Image(systemName: speech.isRecording ? "stop.circle.fill" : "mic.circle.fill")
                        .font(.system(size: 34))
                        .foregroundStyle(speech.isRecording ? Color.red : Color.accentColor)
                }
                .accessibilityLabel(speech.isRecording ? "Остановить запись" : "Надиктовать")
                TextField("Сообщение Илзи", text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .focused($inputFocused)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
                Button {
                    speech.stop()
                    let text = draft
                    draft = ""
                    Task {
                        await chat.send(text)
                        await tasks.load() // Илзи могла записать или поменять дела
                    }
                } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 34))
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || chat.isSending)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Palette.ground.opacity(0.92))
    }
}

struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.isUser { Spacer(minLength: 40) }
            Text(Self.render(message.content))
                .textSelection(.enabled)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .foregroundStyle(Palette.ink)
                .background(
                    message.isUser ? Palette.raised : Color.clear,
                    in: RoundedRectangle(cornerRadius: 18)
                )
                .overlay(alignment: .leading) {
                    // Илзи говорит без пузыря — тонкая золотая черта, как в «Лампе».
                    if !message.isUser { Rectangle().fill(Palette.gold).frame(width: 2) }
                }
            if !message.isUser { Spacer(minLength: 40) }
        }
        .padding(.horizontal)
    }

    /// Илзи пишет с **жирными** заголовками и переносами строк.
    static func render(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
    }
}
