import SwiftUI

/// Куда именно пойти под выпавший вариант: места из базы Ealzy, потом найденные
/// на картах и в интернете. «Хочу» / «Я был» сохраняет место в общую базу.
struct WheelPlacesView: View {
    @Bindable var store: SurpriseStore
    let winner: WheelWinner
    @State private var rating: VisitTarget?
    @Environment(\.openURL) private var openURL

    init(store: SurpriseStore, winner: WheelWinner) {
        self.store = store
        self.winner = winner
    }

    /// Что оцениваем: место из базы или найденное.
    struct VisitTarget: Identifiable {
        let id: String
        let name: String
        let placeId: String?
        let candidate: PlaceCandidate?
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Куда именно").font(.footnote).foregroundStyle(Palette.ink3).padding(.bottom, 6)

            // Места из базы, которые колесо подобрало сразу.
            if store.nearby == nil {
                ForEach(winner.places) { place in
                    row(
                        id: place.id, name: place.name,
                        details: [place.address, DistanceText.format(place.distanceM), ratingText(place.yandexRating)],
                        note: nil, url: place.yandexUrl
                    ) { status in
                        if status == .want {
                            Task { _ = await store.mark(placeId: place.id, VisitFields(activityTypeId: winner.type.id, status: .want)) }
                        } else {
                            rating = VisitTarget(id: place.id, name: place.name, placeId: place.id, candidate: nil)
                        }
                    }
                }
            }

            if let nearby = store.nearby {
                ForEach(nearby.saved) { place in
                    row(
                        id: place.id, name: place.name,
                        details: [place.address, DistanceText.format(place.distanceM), ratingText(place.rating ?? place.yandexRating)],
                        note: nil, url: place.yandexUrl, already: place.myStatus
                    ) { status in
                        if status == .want {
                            Task { _ = await store.mark(placeId: place.id, VisitFields(activityTypeId: winner.type.id, status: .want)) }
                        } else {
                            rating = VisitTarget(id: place.id, name: place.name, placeId: place.id, candidate: nil)
                        }
                    }
                }
                ForEach(nearby.found) { place in
                    row(
                        id: place.id, name: place.name,
                        details: [place.address, DistanceText.format(place.distanceM), ratingText(place.rating),
                                  place.isFromWeb ? "из интернета" : nil],
                        note: place.note, url: place.mapsUrl
                    ) { status in
                        if status == .want {
                            Task { _ = await store.mark(candidate: place, VisitFields(activityTypeId: winner.type.id, status: .want)) }
                        } else {
                            rating = VisitTarget(id: place.id, name: place.name, placeId: nil, candidate: place)
                        }
                    }
                }
                if nearby.saved.isEmpty, nearby.found.isEmpty {
                    Text("Рядом ничего не нашлось — открой карты, там шире.")
                        .font(.footnote).foregroundStyle(Palette.ink3).padding(.vertical, 8)
                } else if nearby.web == true {
                    Text("На картах такого мало — часть мест Илзи нашла в интернете. Проверь адрес перед поездкой.")
                        .font(.footnote).foregroundStyle(Palette.ink3).padding(.top, 8)
                } else if nearby.source == "osm", !nearby.found.isEmpty {
                    Text("Места из OpenStreetMap — без рейтингов. Отметь, где был, — сохраним.")
                        .font(.footnote).foregroundStyle(Palette.ink3).padding(.top, 8)
                }
            }

            if let error = store.nearbyError {
                Text(error).font(.footnote).foregroundStyle(.red).padding(.top, 6)
            }

            HStack(spacing: 12) {
                if store.nearby == nil {
                    Button {
                        Task { await store.lookNearby() }
                    } label: {
                        HStack(spacing: 6) {
                            if store.isLookingNearby { ProgressView().controlSize(.small) }
                            Text(store.isLookingNearby ? "Ищу места…" : store.effectiveArea == nil ? "Найти рядом со мной" : "Найти в выбранном районе")
                        }
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.goldText)
                    .disabled(store.isLookingNearby)
                } else if store.isLookingNearby {
                    ProgressView().controlSize(.small)
                }
                Spacer()
                if let url = URL(string: winner.mapsUrl) {
                    Button("Открыть карты") { openURL(url) }
                        .font(.subheadline)
                        .foregroundStyle(Palette.ink2)
                }
            }
            .padding(.top, 12)
        }
        .sheet(item: $rating) { target in
            VisitSheet(name: target.name) { fields in
                var full = fields
                full.activityTypeId = winner.type.id
                if let candidate = target.candidate {
                    return await store.mark(candidate: candidate, full)
                }
                return await store.mark(placeId: target.placeId ?? target.id, full)
            }
            .presentationDetents([.medium])
            .presentationBackground(Palette.sheet)
        }
    }

    private func ratingText(_ value: Double?) -> String? {
        guard let value else { return nil }
        return "★ " + String(format: "%.1f", value).replacingOccurrences(of: ".", with: ",")
    }

    private func row(
        id: String, name: String, details: [String?], note: String?, url: String?,
        already: PlaceVisitStatus? = nil, action: @escaping (PlaceVisitStatus) -> Void
    ) -> some View {
        let status = store.visitStatus(of: id) ?? already
        return VStack(alignment: .leading, spacing: 4) {
            Divider().overlay(Palette.rule)
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    if let url, let link = URL(string: url) {
                        Button { openURL(link) } label: {
                            Text(name).font(.body.weight(.medium)).foregroundStyle(Palette.ink).multilineTextAlignment(.leading)
                        }
                        .buttonStyle(.plain)
                    } else {
                        Text(name).font(.body.weight(.medium)).foregroundStyle(Palette.ink)
                    }
                    if let note, !note.isEmpty {
                        Text(note).font(.footnote).foregroundStyle(Palette.ink2)
                    }
                    let line = details.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
                    if !line.isEmpty {
                        Text(line).font(.footnote).foregroundStyle(Palette.ink3)
                    }
                }
                Spacer(minLength: 4)
                switch status {
                case .some(.visited):
                    Text("был ✓").font(.footnote.weight(.semibold)).foregroundStyle(Palette.goldText)
                case .some(.want):
                    VStack(alignment: .trailing, spacing: 6) {
                        Text("хочу ✓").font(.footnote.weight(.semibold)).foregroundStyle(Palette.goldText)
                        chip("Я был") { action(.visited) }
                    }
                default:
                    VStack(alignment: .trailing, spacing: 6) {
                        chip("Хочу") { action(.want) }
                        chip("Я был") { action(.visited) }
                    }
                }
            }
            .padding(.vertical, 8)
        }
    }

    private func chip(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.ink)
                .padding(.horizontal, 10)
                .frame(minHeight: 28)
                .background(Palette.track, in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// «Я был»: впечатление, звёзды и заметка — колесо по ним учится.
struct VisitSheet: View {
    let name: String
    let save: (VisitFields) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var emotion: PlaceEmotion?
    @State private var stars = 0
    @State private var note = ""
    @State private var saving = false

    init(name: String, save: @escaping (VisitFields) async -> Bool) {
        self.name = name
        self.save = save
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(name).font(Typeface.display(22)).foregroundStyle(Palette.ink).lineLimit(2)
            Text("Как тебе?").font(.footnote).foregroundStyle(Palette.ink3)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(PlaceEmotion.allCases) { option in
                    let on = emotion == option
                    Button { emotion = on ? nil : option } label: {
                        Text(option.title)
                            .font(.subheadline.weight(on ? .semibold : .regular))
                            .foregroundStyle(on ? Palette.goldInk : Palette.ink)
                            .frame(maxWidth: .infinity, minHeight: 40)
                            .background(on ? Palette.gold : Palette.track, in: RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            HStack(spacing: 6) {
                ForEach(1...5, id: \.self) { value in
                    Button { stars = stars == value ? 0 : value } label: {
                        Image(systemName: value <= stars ? "star.fill" : "star")
                            .font(.title3)
                            .foregroundStyle(Palette.goldText)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(value) из 5")
                }
            }
            TextField("Заметка — что запомнилось", text: $note, axis: .vertical)
                .lineLimit(2...4)
                .padding(10)
                .background(Palette.track, in: RoundedRectangle(cornerRadius: 12))
            Button {
                saving = true
                Task {
                    let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
                    let ok = await save(VisitFields(
                        activityTypeId: "", status: .visited,
                        rating: stars == 0 ? nil : stars, emotion: emotion,
                        note: trimmed.isEmpty ? nil : String(trimmed.prefix(2000))
                    ))
                    saving = false
                    if ok { dismiss() }
                }
            } label: {
                Text(saving ? "Сохраняю…" : "Сохранить")
                    .font(.headline)
                    .foregroundStyle(Palette.goldInk)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(Palette.gold, in: RoundedRectangle(cornerRadius: 14))
            }
            .disabled(saving)
        }
        .padding(24)
    }
}
