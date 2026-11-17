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
        // Во время фокуса — ещё одна запись на момент, когда выйдет время.
        let now = Date()
        let snapshot = WidgetSnapshot.load()
        var entries = [SnapshotEntry(date: now, snapshot: snapshot)]
        if let ends = snapshot?.focusRun?.endsAt, ends > now {
            entries.append(SnapshotEntry(date: ends, snapshot: snapshot))
        }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
    }
}

// MARK: Фокус дня

struct FocusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "EalzyFocus", provider: SnapshotProvider()) { entry in
            FocusWidgetView(entry: entry)
                .containerBackground(for: .widget) { Palette.ground }
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
        if let snapshot = entry.snapshot, let run = snapshot.focusRun {
            FocusRunView(run: run, now: entry.date, family: family)
        } else if let snapshot = entry.snapshot {
            switch family {
            case .accessoryInline:
                Text(snapshot.focus.first.map { "Главное: \($0.title)" } ?? Self.emptyLine(snapshot))
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 1) {
                    Text("Главное").font(.caption2).foregroundStyle(.secondary)
                    Text(snapshot.focus.first?.title ?? Self.emptyLine(snapshot))
                        .font(.headline)
                        .lineLimit(2)
                    if let event = snapshot.nextEvent {
                        Text("\(event.meta ?? "") \(event.title)").font(.caption2).lineLimit(1)
                    }
                }
            case .systemSmall:
                SmallFocus(snapshot: snapshot)
            case .systemLarge:
                DayList(snapshot: snapshot, titleLines: 3, rows: 6, showEvent: true)
            default:
                DayList(snapshot: snapshot, titleLines: 2, rows: 2, showEvent: false)
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("Ealzy").font(.headline).foregroundStyle(Palette.ink)
                Text("Открой приложение, чтобы увидеть план дня.").font(.caption).foregroundStyle(Palette.ink2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    static func emptyLine(_ snapshot: WidgetSnapshot) -> String {
        snapshot.doneCount > 0 && snapshot.next.isEmpty ? "Всё на сегодня сделано" : "День пока пустой"
    }
}

/// Идёт фокус: виджет повторяет экран приложения — дело, сколько осталось, «не отвлекайся».
private struct FocusRunView: View {
    let run: WidgetSnapshot.FocusRun
    let now: Date
    let family: WidgetFamily

    private var isOver: Bool { run.endsAt.map { $0 <= now } ?? false }

    @ViewBuilder
    private var clock: some View {
        if let ends = run.endsAt, ends > now {
            Text(timerInterval: now...ends, countsDown: true)
        } else if let rest = run.pausedRemaining {
            Text(Self.format(rest))
        } else {
            Text("время вышло")
        }
    }

    private var status: String {
        if run.pausedRemaining != nil { return "На паузе" }
        return isOver ? "Время вышло — закончи или продли" : "Не отвлекайся — остальное подождёт"
    }

    var body: some View {
        switch family {
        case .accessoryInline:
            HStack { Text("Фокус ·"); clock }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 4) { Text("В фокусе"); clock.monospacedDigit() }
                    .font(.caption2)
                Text(run.title).font(.headline).lineLimit(2)
            }
        default:
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Text("СЕЙЧАС В ФОКУСЕ").font(.caption2.weight(.semibold)).foregroundStyle(Palette.goldText)
                    Spacer(minLength: 4)
                    if family != .systemSmall {
                        Button(intent: CompleteTaskIntent(taskId: run.taskId)) {
                            Image(systemName: "checkmark.circle").font(.title3).foregroundStyle(Palette.goldText)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Готово")
                    }
                }
                Text(run.title)
                    .font(Typeface.display(family == .systemSmall ? 16 : (family == .systemLarge ? 24 : 19)))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(family == .systemLarge ? 4 : 2)
                    .minimumScaleFactor(0.85)
                    .padding(.top, 4)
                Spacer(minLength: 4)
                clock
                    .font(.system(size: family == .systemSmall ? 30 : 38, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(isOver ? Palette.goldText : Palette.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(status)
                    .font(.caption)
                    .foregroundStyle(Palette.ink2)
                    .lineLimit(family == .systemSmall ? 2 : 1)
                    .padding(.top, 2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    static func format(_ seconds: TimeInterval) -> String {
        let total = max(Int(seconds), 0)
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}

/// Маленький виджет — только главное дело и кнопка «Готово».
private struct SmallFocus: View {
    let snapshot: WidgetSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("ФОКУС").font(.caption2.weight(.semibold)).foregroundStyle(Palette.goldText)
            if let focus = snapshot.focus.first {
                Text(focus.title)
                    .font(Typeface.display(17))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(4)
                    .minimumScaleFactor(0.85)
                    .padding(.top, 4)
                Spacer(minLength: 4)
                Button(intent: CompleteTaskIntent(taskId: focus.id)) {
                    Label("Готово", systemImage: "checkmark.circle")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.goldText)
                }
                .buttonStyle(.plain)
            } else if let first = snapshot.next.first {
                Text(first.title)
                    .font(Typeface.display(17))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(4)
                    .minimumScaleFactor(0.85)
                    .padding(.top, 4)
                Spacer(minLength: 4)
                Button(intent: CompleteTaskIntent(taskId: first.id)) {
                    Label("Готово", systemImage: "checkmark.circle")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Palette.goldText)
                }
                .buttonStyle(.plain)
            } else {
                Text(FocusWidgetView.emptyLine(snapshot))
                    .font(Typeface.display(17)).foregroundStyle(Palette.ink).padding(.top, 4)
                Spacer(minLength: 4)
                Text(snapshot.doneCount > 0 ? "Ты молодец." : "Выбери дела в приложении")
                    .font(.caption).foregroundStyle(Palette.ink2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Средний и большой: главное дело сверху, ниже — что дальше, строго в одну строку,
/// чтобы ничего не обрезалось (виджет не прокручивается).
private struct DayList: View {
    let snapshot: WidgetSnapshot
    let titleLines: Int
    let rows: Int
    let showEvent: Bool

    var body: some View {
        let next = Array(snapshot.next.prefix(rows))
        let hidden = snapshot.next.count - next.count
        VStack(alignment: .leading, spacing: 0) {
            if let focus = snapshot.focus.first {
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("ФОКУС").font(.caption2.weight(.semibold)).foregroundStyle(Palette.goldText)
                        Text(focus.title)
                            .font(Typeface.display(titleLines > 2 ? 22 : 18))
                            .foregroundStyle(Palette.ink)
                            .lineLimit(titleLines)
                            .minimumScaleFactor(0.85)
                    }
                    Spacer(minLength: 0)
                    Button(intent: CompleteTaskIntent(taskId: focus.id)) {
                        Image(systemName: "checkmark.circle")
                            .font(.title3)
                            .foregroundStyle(Palette.goldText)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Готово")
                }
            } else {
                Text(snapshot.next.isEmpty ? FocusWidgetView.emptyLine(snapshot) : "На сегодня")
                    .font(Typeface.display(17))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(2)
            }

            if showEvent, let event = snapshot.nextEvent {
                Row(icon: "calendar", title: event.title, meta: event.meta, taskId: nil)
                    .padding(.top, 10)
            }
            if !next.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(next) { item in
                        Row(icon: nil, title: item.title, meta: Self.short(item.meta), taskId: item.id)
                    }
                }
                .padding(.top, 10)
            }
            Spacer(minLength: 0)
            if hidden > 0 || snapshot.doneCount > 0 {
                Text([hidden > 0 ? "ещё \(hidden) на сегодня" : nil,
                      snapshot.doneCount > 0 ? "сделано \(snapshot.doneCount)" : nil]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(Palette.ink3)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// В строке виджета — только самое нужное: время или «просрочено».
    static func short(_ meta: String?) -> String? {
        guard let meta else { return nil }
        let first = meta.components(separatedBy: " · ").first ?? meta
        return first.hasPrefix("~") ? nil : first
    }
}

private struct Row: View {
    let icon: String?
    let title: String
    let meta: String?
    let taskId: String?

    var body: some View {
        HStack(spacing: 8) {
            if let taskId {
                Button(intent: CompleteTaskIntent(taskId: taskId)) {
                    Image(systemName: "circle").font(.footnote).foregroundStyle(Palette.ink3)
                }
                .buttonStyle(.plain)
            } else if let icon {
                Image(systemName: icon).font(.footnote).foregroundStyle(Palette.ink3)
            }
            Text(title)
                .font(.subheadline)
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
            Spacer(minLength: 4)
            if let meta {
                Text(meta)
                    .font(.caption)
                    .foregroundStyle(Palette.ink2)
                    .lineLimit(1)
                    .layoutPriority(1)
            }
        }
    }
}

// MARK: Записать

struct CaptureWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "EalzyCapture", provider: SnapshotProvider()) { _ in
            CaptureWidgetView()
                .containerBackground(for: .widget) { Palette.ground }
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
                    .foregroundStyle(Palette.goldText)
                Spacer(minLength: 0)
                Text("Скажи Илзи").font(.headline)
                Text("дело, мысль, вопрос").font(.caption).foregroundStyle(Palette.ink2)
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
