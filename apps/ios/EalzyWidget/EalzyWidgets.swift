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
        } else if let snapshot = entry.snapshot, snapshot.focus.isEmpty && snapshot.next.isEmpty {
            FreeDayView(snapshot: snapshot, family: family)
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
            OpenAppHint()
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

/// Средний и большой: главное дело — своей карточкой, ниже отдельно «дальше сегодня»,
/// строго в одну строку, чтобы ничего не обрезалось (виджет не прокручивается).
private struct DayList: View {
    let snapshot: WidgetSnapshot
    let titleLines: Int
    let rows: Int
    let showEvent: Bool

    var body: some View {
        // Без фокуса первое дело и так главное — показываем его списком, без карточки.
        let next = Array(snapshot.next.prefix(snapshot.focus.isEmpty ? rows + 1 : rows))
        let hidden = snapshot.next.count - next.count
        VStack(alignment: .leading, spacing: 0) {
            if let focus = snapshot.focus.first {
                FocusCard(item: focus, titleLines: titleLines)
            }

            if showEvent, let event = snapshot.nextEvent {
                Row(icon: "calendar", title: event.title, meta: event.meta, taskId: nil)
                    .padding(.top, 10)
                    .padding(.horizontal, 2)
            }
            if !next.isEmpty {
                HStack(alignment: .firstTextBaseline) {
                    Text(snapshot.focus.isEmpty ? "НА СЕГОДНЯ" : "ДАЛЬШЕ СЕГОДНЯ")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Palette.ink3)
                    Spacer(minLength: 4)
                    if hidden > 0 {
                        Text("ещё \(hidden)")
                            .font(.caption2)
                            .foregroundStyle(Palette.ink3)
                    }
                }
                .padding(.top, snapshot.focus.isEmpty ? 0 : 10)
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(next) { item in
                        Row(icon: nil, title: item.title, meta: Self.short(item.meta), taskId: item.id)
                    }
                }
                .padding(.top, 5)
                .padding(.horizontal, 2)
            }
            Spacer(minLength: 0)
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

/// Главное дело дня — отдельной карточкой. Кружок пустой: дело ещё не сделано,
/// нажал — отметил.
private struct FocusCard: View {
    let item: WidgetSnapshot.Item
    let titleLines: Int

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Button(intent: CompleteTaskIntent(taskId: item.id)) {
                Image(systemName: "circle")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(Palette.goldText)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Отметить «\(item.title)» сделанным")
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text("ФОКУС").font(.caption2.weight(.semibold)).foregroundStyle(Palette.goldText)
                    if let meta = DayList.short(item.meta) {
                        Text(meta).font(.caption2).foregroundStyle(Palette.ink2)
                    }
                }
                Text(item.title)
                    .font(Typeface.display(titleLines > 2 ? 21 : 17))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(titleLines)
                    .minimumScaleFactor(0.85)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.pool, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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

// MARK: Впереди — отдельный виджет. Его, «Фокус дня» и «Илзи» можно сложить
// в одну стопку на экране и листать пальцем вверх-вниз (сам виджет свайпы не ловит).

struct AheadWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "EalzyAhead", provider: SnapshotProvider()) { entry in
            Group {
                if let snapshot = entry.snapshot {
                    AheadWidgetView(snapshot: snapshot)
                } else {
                    OpenAppHint()
                }
            }
            .containerBackground(for: .widget) { Palette.ground }
            .widgetURL(URL(string: "ealzy://today"))
        }
        .configurationDisplayName("Впереди")
        .description("Что ещё сегодня в календаре, завтра и на неделе.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

private struct AheadWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let snapshot: WidgetSnapshot

    var body: some View {
        FreeDayView(snapshot: snapshot, family: family, mode: .ahead)
    }
}

private struct OpenAppHint: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Ealzy").font(.headline).foregroundStyle(Palette.ink)
            Text("Открой приложение, чтобы увидеть план дня.").font(.caption).foregroundStyle(Palette.ink2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Страница «Илзи»: большая кнопка — сразу говорить, и пара быстрых вопросов.
private struct IlziPage: View {
    let family: WidgetFamily

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 14) {
                Link(destination: URL(string: "ealzy://voice")!) {
                    ZStack {
                        Circle().fill(Palette.gold)
                        Image(systemName: "mic.fill")
                            .font(.system(size: 26, weight: .semibold))
                            .foregroundStyle(Palette.goldInk)
                    }
                    .frame(width: 72, height: 72)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("Скажи Илзи")
                        .font(Typeface.display(18))
                        .foregroundStyle(Palette.ink)
                    Text("Дело, мысль, вопрос — нажми и говори, я разберусь.")
                        .font(.caption)
                        .foregroundStyle(Palette.ink2)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 6)
            HStack(spacing: 6) {
                chip("Что завтра?", FreeDayView.ask("Что у меня завтра? Календарь и дела"))
                chip("Спланируй неделю", FreeDayView.ask("Давай спланируем неделю"))
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func chip(_ title: String, _ url: URL) -> some View {
        Link(destination: url) {
            Text(title)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .frame(height: 28)
                .foregroundStyle(Palette.ink)
                .background(Palette.rule.opacity(0.6), in: Capsule())
        }
    }
}

// MARK: Голос — как Shazam: одна большая кнопка

struct VoiceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "EalzyVoice", provider: SnapshotProvider()) { _ in
            VoiceWidgetView()
                .containerBackground(for: .widget) { Palette.ground }
                .widgetURL(URL(string: "ealzy://voice"))
        }
        .configurationDisplayName("Илзи — голосом")
        .description("Одно касание — и говоришь с Илзи: записать дело, спросить, попросить.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular])
    }
}

struct VoiceWidgetView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if family == .accessoryCircular {
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "mic.fill").font(.title2)
            }
            .accessibilityLabel("Сказать Илзи")
        } else if family == .systemMedium {
            IlziPage(family: family)
        } else {
            VStack(spacing: 10) {
                ZStack {
                    Circle().fill(Palette.gold.opacity(0.22)).frame(width: 104, height: 104)
                    Circle().fill(Palette.gold).frame(width: 80, height: 80)
                    Image("IlziMark")
                        .resizable()
                        .frame(width: 40, height: 40)
                        .foregroundStyle(Palette.goldInk)
                }
                Text("Скажи Илзи")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.ink)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
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
        AheadWidget()
        VoiceWidget()
        CaptureWidget()
        FocusLiveActivityWidget()
    }
}
