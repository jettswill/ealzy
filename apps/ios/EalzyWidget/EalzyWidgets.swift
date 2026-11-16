import AppIntents
import SwiftUI
import WidgetKit

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), snapshot: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: Date(), snapshot: context.isPreview ? .placeholder : WidgetSnapshot.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        // Снимок обновляет приложение; виджет перечитывает его раз в полчаса на всякий случай.
        let entry = SnapshotEntry(date: Date(), snapshot: WidgetSnapshot.load())
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(30 * 60))))
    }
}

// MARK: Фокус дня

struct FocusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "EalzyFocus", provider: SnapshotProvider()) { entry in
            FocusWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "ealzy://today"))
        }
        .configurationDisplayName("Фокус дня")
        .description("Главное на сегодня и что дальше.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline])
    }
}

struct FocusWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SnapshotEntry

    var body: some View {
        if let snapshot = entry.snapshot {
            switch family {
            case .accessoryInline:
                Text(snapshot.focus.first.map { "Фокус: \($0.title)" } ?? "Ealzy: ничего не горит")
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 1) {
                    Text("Фокус").font(.caption2).foregroundStyle(.secondary)
                    Text(snapshot.focus.first?.title ?? "Ничего не горит")
                        .font(.headline)
                        .lineLimit(2)
                    if let event = snapshot.nextEvent {
                        Text("\(event.meta ?? "") \(event.title)").font(.caption2).lineLimit(1)
                    }
                }
            case .systemSmall:
                smallBody(snapshot)
            default:
                largeBody(snapshot, limit: family == .systemLarge ? 6 : 2)
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("Ealzy").font(.headline)
                Text("Открой приложение, чтобы увидеть план дня.").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func smallBody(_ snapshot: WidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Фокус").font(.caption).foregroundStyle(.secondary)
            if let focus = snapshot.focus.first {
                Text(focus.title).font(.headline).lineLimit(4)
                Spacer(minLength: 0)
                Button(intent: CompleteTaskIntent(taskId: focus.id)) {
                    Label("Готово", systemImage: "checkmark.circle")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color.accentColor)
            } else {
                Text("Ничего не горит").font(.headline)
                Spacer(minLength: 0)
                Text("В запасе \(snapshot.reserveCount)").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func largeBody(_ snapshot: WidgetSnapshot, limit: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if snapshot.focus.isEmpty {
                Text(snapshot.headline).font(.subheadline.weight(.semibold)).lineLimit(2)
            }
            ForEach(snapshot.focus) { item in
                ItemLine(item: item, emphasis: true)
            }
            if let event = snapshot.nextEvent {
                HStack(spacing: 6) {
                    Image(systemName: "calendar").foregroundStyle(.secondary)
                    Text("\(event.meta ?? "") \(event.title)").font(.caption).lineLimit(1)
                }
            }
            ForEach(snapshot.next.prefix(limit)) { item in
                ItemLine(item: item, emphasis: false)
            }
            Spacer(minLength: 0)
            Text("В запасе \(snapshot.reserveCount) — ничего не горит")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct ItemLine: View {
    let item: WidgetSnapshot.Item
    let emphasis: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Button(intent: CompleteTaskIntent(taskId: item.id)) {
                Image(systemName: "circle")
            }
            .buttonStyle(.plain)
            .foregroundStyle(emphasis ? Color.accentColor : Color.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .font(emphasis ? .subheadline.weight(.semibold) : .subheadline)
                    .lineLimit(emphasis ? 2 : 1)
                if let meta = item.meta {
                    Text(meta).font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }
}

// MARK: Записать

struct CaptureWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "EalzyCapture", provider: SnapshotProvider()) { _ in
            CaptureWidgetView()
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: "ealzy://capture"))
        }
        .configurationDisplayName("Записать")
        .description("Одно касание — и говоришь Илзи, что висит в голове.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

struct CaptureWidgetView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if family == .accessoryCircular {
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "square.and.pencil").font(.title2)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "square.and.pencil")
                    .font(.title)
                    .foregroundStyle(Color.accentColor)
                Spacer(minLength: 0)
                Text("Скажи Илзи").font(.headline)
                Text("дело, мысль, вопрос").font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

@main
struct EalzyWidgetBundle: WidgetBundle {
    var body: some Widget {
        FocusWidget()
        CaptureWidget()
    }
}
