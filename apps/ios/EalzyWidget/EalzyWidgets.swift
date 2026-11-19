import AppIntents
import SwiftUI
import WidgetKit

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot?
    var weather: WeatherNow? = nil
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), snapshot: .placeholder,
                      weather: WeatherNow(temp: -3, code: 3, isDay: true, at: Date()))
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
            return
        }
        completion(SnapshotEntry(date: Date(), snapshot: WidgetSnapshot.load(), weather: Self.cachedWeather()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        // Снимок обновляет приложение; виджет перечитывает его раз в полчаса на всякий случай
        // и заодно обновляет погоду там, где телефон был последний раз.
        // Во время фокуса — ещё одна запись на момент, когда выйдет время.
        Task {
            let now = Date()
            let snapshot = WidgetSnapshot.load()
            let weather = await Self.freshWeather()
            // Черта «сейчас» на ленте дня сдвигается каждые 10 минут.
            var entries = stride(from: 0, to: 30 * 60, by: 10 * 60).map {
                SnapshotEntry(date: now.addingTimeInterval(TimeInterval($0)), snapshot: snapshot, weather: weather)
            }
            if let ends = snapshot?.focusRun?.endsAt, ends > now {
                entries.append(SnapshotEntry(date: ends, snapshot: snapshot, weather: weather))
            }
            completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
        }
    }

    static func cachedWeather() -> WeatherNow? {
        guard let weather = WidgetPlace.load()?.weather, weather.isFresh else { return nil }
        return weather
    }

    /// Погода не старше 25 минут — берём из кэша, иначе спрашиваем Open-Meteo.
    static func freshWeather() async -> WeatherNow? {
        guard var place = WidgetPlace.load() else { return nil }
        if let weather = place.weather, Date().timeIntervalSince(weather.at) < 25 * 60 { return weather }
        if let weather = await WeatherNow.fetch(lat: place.lat, lon: place.lon) {
            place.weather = weather
            place.save()
            return weather
        }
        return place.weather?.isFresh == true ? place.weather : nil
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

    /// Средний и большой листаются стрелками справа: день → впереди → Илзи.
    private var pages: Bool { family == .systemMedium || family == .systemLarge }

    var body: some View {
        if pages {
            let page = WidgetPage.current
            HStack(alignment: .top, spacing: 10) {
                Group {
                    if page == 1, let snapshot = entry.snapshot {
                        FreeDayView(snapshot: snapshot, family: family, mode: .ahead)
                    } else if page == 2 {
                        IlziPage(family: family)
                    } else if let snapshot = entry.snapshot, snapshot.focusRun == nil {
                        VStack(alignment: .leading, spacing: family == .systemLarge ? 12 : 8) {
                            WidgetRibbon(snapshot: snapshot, now: entry.date, large: family == .systemLarge)
                            day
                        }
                    } else {
                        day
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                PagerRail(page: page, weather: entry.weather, now: entry.date)
            }
        } else {
            day
        }
    }

    @ViewBuilder
    private var day: some View {
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
                DayList(snapshot: snapshot, rows: 9, showEvent: false)
            default:
                DayList(snapshot: snapshot, rows: 3, showEvent: false)
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

/// Средний и большой: все дела одинаковыми строками. Главное — первым, с золотой
/// звёздочкой; ниже подпись «Ещё на сегодня» и остальные. Строго в одну строку,
/// чтобы ничего не обрезалось (виджет не прокручивается).
private struct DayList: View {
    let snapshot: WidgetSnapshot
    /// Сколько строк помещается всего, вместе с главным делом.
    let rows: Int
    let showEvent: Bool

    var body: some View {
        let focus = snapshot.focus.first
        let room = max(rows - (focus == nil ? 0 : 1) - (showEvent && snapshot.nextEvent != nil ? 1 : 0), 0)
        let next = Array(snapshot.next.prefix(room))
        let hidden = snapshot.next.count - next.count
        VStack(alignment: .leading, spacing: 0) {
            if showEvent, let event = snapshot.nextEvent {
                Row(icon: "calendar", title: event.title, meta: event.meta, taskId: nil)
                    .padding(.bottom, 8)
            }
            if let focus {
                Row(icon: nil, title: focus.title, meta: Self.short(focus.meta), taskId: focus.id, isMain: true)
            }
            if !next.isEmpty {
                if focus != nil {
                    // Главное отделено тонкой чертой; сколько ещё не влезло — мелко на ней.
                    HStack(spacing: 6) {
                        Rectangle().fill(Palette.rule).frame(height: 1)
                        if hidden > 0 {
                            Text("ещё \(hidden)").font(.caption2).foregroundStyle(Palette.ink3).fixedSize()
                        }
                    }
                    .frame(height: 12)
                    .padding(.vertical, 3)
                }
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(next) { item in
                        Row(icon: nil, title: item.title, meta: Self.short(item.meta), taskId: item.id)
                    }
                }
                if focus == nil, hidden > 0 {
                    Text("ещё \(hidden)")
                        .font(.caption2)
                        .foregroundStyle(Palette.ink3)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                        .padding(.top, 2)
                }
            } else if focus == nil {
                Text(FocusWidgetView.emptyLine(snapshot))
                    .font(Typeface.display(17))
                    .foregroundStyle(Palette.ink)
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

private struct Row: View {
    let icon: String?
    let title: String
    let meta: String?
    let taskId: String?
    /// Главное дело дня: золотой кружок и звёздочка; шрифт — как у остальных.
    var isMain = false

    var body: some View {
        HStack(spacing: 8) {
            if let taskId {
                Button(intent: CompleteTaskIntent(taskId: taskId)) {
                    Image(systemName: "circle")
                        .font(.footnote.weight(isMain ? .semibold : .regular))
                        .foregroundStyle(isMain ? Palette.goldText : Palette.ink3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Отметить «\(title)» сделанным")
            } else if let icon {
                Image(systemName: icon).font(.footnote).foregroundStyle(Palette.ink3)
            }
            Text(title)
                .font(.subheadline)
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
            if isMain {
                Image(systemName: "star.fill")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(Palette.goldText)
                    .accessibilityLabel("главное")
            }
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

// MARK: Листание

/// Страницы виджета: 0 — день, 1 — «Впереди», 2 — Илзи.
/// Свайпы виджет iOS не ловит, поэтому — стрелки ▲▼ справа, всегда на одном месте.
enum WidgetPage {
    static let count = 3
    static let key = "widgetPage"
    static var current: Int { ((UserDefaults.standard.integer(forKey: key) % count) + count) % count }

    static func move(_ step: Int) {
        UserDefaults.standard.set(((current + step) % count + count) % count, forKey: key)
    }
}

struct NextWidgetPageIntent: AppIntent {
    static var title: LocalizedStringResource = "Следующая страница"
    static var isDiscoverable = false

    func perform() async throws -> some IntentResult {
        WidgetPage.move(1)
        return .result()
    }
}

struct PreviousWidgetPageIntent: AppIntent {
    static var title: LocalizedStringResource = "Предыдущая страница"
    static var isDiscoverable = false

    func perform() async throws -> some IntentResult {
        WidgetPage.move(-1)
        return .result()
    }
}

/// Колонка справа: день недели и число, погода там, где ты, и переключатель
/// страниц — одна плашка с точками: нажал — следующий экран (по кругу).
private struct PagerRail: View {
    let page: Int
    let weather: WeatherNow?
    let now: Date

    private static let weekday: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ru_RU")
        f.dateFormat = "EEEEEE"
        return f
    }()

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 1) {
                Text(Self.weekday.string(from: now).uppercased())
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Palette.dayMark)
                Text(now.formatted(.dateTime.day()))
                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Palette.ink)
            }
            .accessibilityElement(children: .combine)
            if let weather {
                VStack(spacing: 1) {
                    Image(systemName: weather.symbol)
                        .symbolRenderingMode(.multicolor)
                        .font(.system(size: 12))
                    Text(weather.tempText)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(Palette.ink2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .padding(.top, 7)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Погода: \(weather.tempText)")
            }
            Spacer(minLength: 6)
            Button(intent: NextWidgetPageIntent()) {
                VStack(spacing: 4) {
                    ForEach(0..<WidgetPage.count, id: \.self) { index in
                        Capsule()
                            .fill(index == page ? Palette.goldText : Palette.ink3.opacity(0.45))
                            .frame(width: 5, height: index == page ? 11 : 5)
                    }
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(Palette.ink2)
                        .padding(.top, 1)
                }
                .padding(.vertical, 7)
                .frame(width: 24)
                .background(Palette.rule, in: Capsule())
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Следующая страница виджета")
        }
        .frame(width: 32)
        .frame(maxHeight: .infinity)
    }
}

/// Лента дня 8:00–23:00 — схематично, как на «Сегодня» в приложении:
/// цвет полосы — время суток, встречи — капсулы, золотая — окно под главное дело,
/// черта — «сейчас». В большом виджете крупнее и со временем на капсулах.
private struct WidgetRibbon: View {
    let snapshot: WidgetSnapshot
    let now: Date
    let large: Bool
    @Environment(\.colorScheme) private var scheme

    private let startHour = 8
    private let endHour = 23

    private var laneHeight: CGFloat { large ? 26 : 16 }
    private var pillHeight: CGFloat { large ? 18 : 12 }

    var body: some View {
        VStack(spacing: 2) {
            GeometryReader { proxy in
                let width = proxy.size.width
                ZStack(alignment: .topLeading) {
                    Capsule()
                        .fill(Palette.lane(scheme))
                        .frame(width: width, height: laneHeight)
                    ForEach(Array(snapshot.dayEvents.enumerated()), id: \.offset) { _, span in
                        pill(span, width: width, fill: span.end <= now ? Palette.pillPast : Palette.pill,
                             ink: span.end <= now ? Palette.ink2 : Palette.ink)
                    }
                    if let focus = snapshot.focusWindow {
                        pill(focus, width: width, fill: Palette.gold, ink: Palette.goldInk)
                    }
                    if let x = position(now, width: width) {
                        Capsule()
                            .fill(Palette.ink)
                            .frame(width: 2, height: laneHeight + 4)
                            .offset(x: x - 1, y: -2)
                    }
                }
            }
            .frame(height: laneHeight)
            HStack(spacing: 0) {
                ForEach(Array(stride(from: startHour, through: endHour, by: 3)), id: \.self) { hour in
                    Text("\(hour)")
                    if hour < endHour { Spacer(minLength: 0) }
                }
            }
            .font(.system(size: large ? 9 : 8.5))
            .monospacedDigit()
            .foregroundStyle(Palette.ink3)
        }
        .padding(.top, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var dayStart: Date {
        Calendar.current.date(bySettingHour: startHour, minute: 0, second: 0, of: now) ?? now
    }

    private var span: TimeInterval { TimeInterval((endHour - startHour) * 3600) }

    private func fraction(_ date: Date) -> CGFloat {
        CGFloat(min(max(date.timeIntervalSince(dayStart) / span, 0), 1))
    }

    private func position(_ date: Date, width: CGFloat) -> CGFloat? {
        let f = date.timeIntervalSince(dayStart) / span
        return (0...1).contains(f) ? CGFloat(f) * width : nil
    }

    @ViewBuilder
    private func pill(_ item: WidgetSnapshot.Span, width: CGFloat, fill: Color, ink: Color) -> some View {
        let minWidth: CGFloat = large ? 34 : 12
        let x = fraction(item.start) * width
        let w = max((fraction(item.end) - fraction(item.start)) * width, minWidth)
        if item.end > dayStart, fraction(item.start) < 1 {
            let left = max(min(x, width - w - 2), 2)
            ZStack {
                Capsule().fill(fill)
                if large && w >= 34 {
                    Text(item.start.formatted(date: .omitted, time: .shortened))
                        .font(.system(size: 9, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .padding(.horizontal, 3)
                }
            }
            .frame(width: w, height: pillHeight)
            .offset(x: left, y: (laneHeight - pillHeight) / 2)
        }
    }

    private var accessibilityText: String {
        let time = { (d: Date) in d.formatted(date: .omitted, time: .shortened) }
        let parts = snapshot.dayEvents.map { "\(time($0.start)) \($0.title)" }
        return (["Лента дня"] + parts).joined(separator: ", ")
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
