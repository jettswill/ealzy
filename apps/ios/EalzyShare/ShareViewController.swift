import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// «Поделиться» → Ealzy: заметка, ссылка, текст из любого приложения.
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareModel(context: extensionContext)
        let host = UIHostingController(rootView: ShareView(model: model))
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        host.didMove(toParent: self)
        Task { await model.loadInput() }
    }
}

@MainActor
final class ShareModel: ObservableObject {
    enum Mode: String, CaseIterable, Identifiable {
        case ilzi = "Отдать Илзи"
        case note = "Сохранить заметкой"
        var id: String { rawValue }
    }

    @Published var text = ""
    @Published var comment = ""
    @Published var mode: Mode = .ilzi
    @Published var isSending = false
    @Published var reply: String?
    @Published var error: String?

    let isSignedIn = Keychain.readToken() != nil
    private weak var context: NSExtensionContext?

    init(context: NSExtensionContext?) {
        self.context = context
    }

    func loadInput() async {
        let providers = (context?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        var parts: [String] = []
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
               let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
                parts.append(url.absoluteString)
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                      let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) {
                if let string = value as? String {
                    parts.append(string)
                } else if let data = value as? Data, let string = String(data: data, encoding: .utf8) {
                    parts.append(string)
                }
            }
        }
        if parts.isEmpty {
            let titles = (context?.inputItems as? [NSExtensionItem] ?? []).compactMap { $0.attributedContentText?.string }
            parts.append(contentsOf: titles)
        }
        text = parts.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func send() async {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        isSending = true
        defer { isSending = false }
        do {
            switch mode {
            case .ilzi:
                let note = comment.trimmingCharacters(in: .whitespacesAndNewlines)
                let message = note.isEmpty
                    ? "Переслано через «Поделиться»:\n\n\(body)"
                    : "\(note)\n\nПереслано через «Поделиться»:\n\n\(body)"
                reply = try await TaskActions.tellIlzi(String(message.prefix(10_000)))
            case .note:
                try await TaskActions.saveNote(String(body.prefix(100_000)))
                reply = "Сохранила в заметки Ealzy."
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func close() {
        context?.completeRequest(returningItems: nil)
    }
}

struct ShareView: View {
    @ObservedObject var model: ShareModel

    var body: some View {
        NavigationStack {
            Form {
                if !model.isSignedIn {
                    Text("Сначала войди в приложение Ealzy.").foregroundStyle(.secondary)
                } else if let reply = model.reply {
                    Section("Илзи") {
                        Text((try? AttributedString(
                            markdown: reply,
                            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
                        )) ?? AttributedString(reply))
                    }
                } else {
                    Section {
                        Picker("Что сделать", selection: $model.mode) {
                            ForEach(ShareModel.Mode.allCases) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)
                    }
                    if model.mode == .ilzi {
                        Section {
                            TextField("Что с этим сделать? (необязательно)", text: $model.comment, axis: .vertical)
                        }
                    }
                    Section("Текст") {
                        TextEditor(text: $model.text).frame(minHeight: 160)
                    }
                    if let error = model.error {
                        Text(error).foregroundStyle(.red).font(.footnote)
                    }
                }
            }
            .navigationTitle("Ealzy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.reply == nil ? "Отмена" : "Готово") { model.close() }
                }
                if model.isSignedIn && model.reply == nil {
                    ToolbarItem(placement: .confirmationAction) {
                        if model.isSending {
                            ProgressView()
                        } else {
                            Button("Отправить") { Task { await model.send() } }
                                .disabled(model.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                }
            }
        }
    }
}
