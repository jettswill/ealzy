import SwiftUI

/// Город — только из справочника городов России: печатаешь — подсказываем,
/// выбрать можно лишь из списка. «Сункт-Петербург» и «спб» тоже найдутся.
struct CityField: View {
    let city: String
    let onChoose: (String) -> Void

    @State private var text = ""
    @State private var suggestions: [CitySuggestion] = []
    @State private var hint: String?
    @FocusState private var focused: Bool

    init(city: String, onChoose: @escaping (String) -> Void) {
        self.city = city
        self.onChoose = onChoose
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Мой город", text: $text)
                .focused($focused)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(Palette.track, in: RoundedRectangle(cornerRadius: 12))
                .onSubmit { Task { await settle() } }

            if focused, !suggestions.isEmpty {
                VStack(spacing: 0) {
                    ForEach(suggestions) { suggestion in
                        Button {
                            choose(suggestion)
                        } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(suggestion.name).foregroundStyle(Palette.ink)
                                if let region = suggestion.region {
                                    Text(region).font(.footnote).foregroundStyle(Palette.ink3)
                                }
                            }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .padding(.horizontal, 12)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if suggestion != suggestions.last {
                            Divider().overlay(Palette.rule).padding(.leading, 12)
                        }
                    }
                }
                .background(Palette.raised, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.rule, lineWidth: 0.5))
            }
            if let hint {
                Text(hint).font(.footnote).foregroundStyle(Palette.ink3)
            }
        }
        .onAppear { text = city }
        .onChange(of: city) { if !focused { text = city } }
        .onChange(of: focused) { if !focused { Task { await settle() } } }
        .task(id: focused ? text : "\u{0}") {
            guard focused else { return }
            // Небольшая пауза: не дёргаем сервер на каждую букву.
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            suggestions = (try? await SurpriseAPI.cities(text)) ?? []
        }
    }

    private func choose(_ suggestion: CitySuggestion) {
        text = suggestion.title
        hint = nil
        suggestions = []
        focused = false
        onChoose(suggestion.title)
    }

    /// Ушли из поля, не выбрав: однозначное — берём, иначе просим выбрать из списка.
    private func settle() async {
        let typed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !typed.isEmpty, typed != city else {
            if typed.isEmpty { text = city }
            return
        }
        // Сервер понимает и опечатки, и «спб»: что узнал — то и город.
        if let saved = try? await SurpriseAPI.saveCity(typed) {
            text = saved.city
            hint = nil
            suggestions = []
            onChoose(saved.city)
        } else {
            hint = "Выбери город из списка — так мы точно поймём, где искать."
            text = city
        }
    }
}
