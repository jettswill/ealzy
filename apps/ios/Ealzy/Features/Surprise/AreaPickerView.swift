import MapKit
import SwiftUI

/// «Где искать»: рядом со мной, район (словами или тапом по карте) или весь город.
/// Точно не нужно — центр и радиус «примерно тут».
struct AreaPickerView: View {
    @Bindable var store: SurpriseStore
    @State private var query = ""
    @State private var camera: MapCameraPosition = .automatic
    @State private var fallback: CLLocationCoordinate2D?

    init(store: SurpriseStore) {
        self.store = store
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LampChoice(options: AreaMode.allCases, selection: Binding(
                get: { store.areaMode },
                set: { mode in Task { await store.choose(mode) } }
            ), title: \.title)

            if store.areaMode == .map {
                HStack(spacing: 8) {
                    TextField("Район, метро или адрес — например, Петроградка", text: $query)
                        .textInputAutocapitalization(.sentences)
                        .submitLabel(.search)
                        .onSubmit { Task { await store.findArea(query) } }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .background(Palette.track, in: RoundedRectangle(cornerRadius: 12))
                    Button("Найти") { Task { await store.findArea(query) } }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.goldText)
                        .disabled(query.trimmingCharacters(in: .whitespaces).count < 2 || store.isLocating)
                }
                map
                Text(hint).font(.footnote).foregroundStyle(Palette.ink3)
            }

            if store.areaMode != .city, store.area != nil {
                HStack(spacing: 8) {
                    ForEach(SurpriseStore.radii, id: \.self) { meters in
                        let on = store.radius == meters
                        Button {
                            store.setRadius(meters)
                            recenter()
                        } label: {
                            Text("до \(meters / 1_000) км")
                                .font(.subheadline.weight(on ? .semibold : .regular))
                                .foregroundStyle(on ? Palette.goldInk : Palette.ink2)
                                .padding(.horizontal, 12)
                                .frame(minHeight: 34)
                                .background(on ? Palette.gold : Palette.track, in: Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
            }

            if store.isLocating {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Ищу…").font(.footnote).foregroundStyle(Palette.ink3)
                }
            } else if let status = store.areaStatus {
                Text(status).font(.footnote).foregroundStyle(Palette.ink3)
            }
        }
        .onAppear {
            if let label = store.area?.label { query = label }
            recenter()
        }
        .onChange(of: store.area) { recenter() }
        .task(id: store.areaMode) {
            if store.areaMode == .map, store.area == nil, fallback == nil {
                fallback = await store.cityCenter()
                recenter()
            }
        }
    }

    private var hint: String {
        guard let area = store.area else { return "Напиши район или ткни в карту — точно не нужно, примерно." }
        if let label = area.label { return "Ищем вокруг: \(label). Можно поправить точку на карте." }
        return "Ищем вокруг точки на карте."
    }

    private var map: some View {
        MapReader { proxy in
            Map(position: $camera, interactionModes: [.pan, .zoom]) {
                if let area = store.area {
                    let center = CLLocationCoordinate2D(latitude: area.lat, longitude: area.lon)
                    MapCircle(center: center, radius: CLLocationDistance(area.radiusM))
                        .foregroundStyle(Palette.gold.opacity(0.18))
                        .stroke(Palette.gold, lineWidth: 2)
                    Annotation("", coordinate: center) {
                        Circle()
                            .fill(Palette.gold)
                            .frame(width: 14, height: 14)
                            .overlay(Circle().strokeBorder(Palette.goldInk, lineWidth: 2))
                    }
                }
            }
            .onTapGesture { point in
                if let coordinate = proxy.convert(point, from: .local) {
                    query = ""
                    store.pick(coordinate)
                }
            }
        }
        .frame(height: 240)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Palette.rule, lineWidth: 0.5))
        .accessibilityLabel("Карта: коснись, чтобы выбрать центр")
    }

    private func recenter() {
        if let area = store.area {
            let center = CLLocationCoordinate2D(latitude: area.lat, longitude: area.lon)
            let span = Double(area.radiusM) * 2.6
            withAnimation { camera = .region(MKCoordinateRegion(center: center, latitudinalMeters: span, longitudinalMeters: span)) }
        } else if let fallback {
            camera = .region(MKCoordinateRegion(center: fallback, latitudinalMeters: 20_000, longitudinalMeters: 20_000))
        }
    }
}

/// Выбор одного из нескольких — та же дорожка с бумажной «таблеткой», что у темы в «Ещё».
struct LampChoice<Option: Hashable & Identifiable>: View {
    let options: [Option]
    @Binding var selection: Option
    let title: KeyPath<Option, String>
    @Namespace private var pill

    init(options: [Option], selection: Binding<Option>, title: KeyPath<Option, String>) {
        self.options = options
        _selection = selection
        self.title = title
    }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options) { option in
                let on = selection == option
                Button {
                    withAnimation(.snappy) { selection = option }
                } label: {
                    Text(option[keyPath: title])
                        .font(.subheadline.weight(on ? .semibold : .regular))
                        .foregroundStyle(on ? Palette.ink : Palette.ink2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .frame(maxWidth: .infinity, minHeight: 38)
                        .background {
                            if on {
                                RoundedRectangle(cornerRadius: 9)
                                    .fill(Palette.raised)
                                    .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
                                    .matchedGeometryEffect(id: "pill", in: pill)
                            }
                        }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Palette.track, in: RoundedRectangle(cornerRadius: 12))
    }
}
