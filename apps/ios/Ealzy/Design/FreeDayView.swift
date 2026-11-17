import SwiftUI
import WidgetKit

/// На сегодня ничего не осталось (или и не было). Не пустой экран, а взгляд вперёд:
/// что ещё будет сегодня, календарь и дела на завтра, неделя — и кнопка спланировать.
struct FreeDayView: View {
    enum Mode { case rest, ahead }

    let snapshot: WidgetSnapshot
    let family: WidgetFamily
    /// rest — «всё сделано / свободно»; ahead — страница «Впереди» в карусели виджета.
    var mode: Mode = .rest
    /// Переключатель страниц карусели (рисует виджет).
    var accessory: AnyView? = nil

    private var isDone: Bool { snapshot.doneCount > 0 }
    private var title: String {
        if mode == .ahead { return "Впереди" }
        if isDone { return "Всё сделано" }
        return family == .systemSmall ? "Свободно" : "Свободный день"
    }

    struct Line: Identifiable {
        let id: String
        let icon: String
        let time: String?
        let title: String
    }

    struct Section {
        let title: String
        let lines: [Line]
    }

    /// Завтра: сначала календарь по времени, потом дела.
    private var tomorrow: [Line] {
        snapshot.tomorrowEvents.map { Line(id: "e\($0.id)", icon: "calendar", time: $0.meta, title: $0.title) }
            + snapshot.tomorrow.map { item in
                let time = item.meta?.components(separatedBy: " · ").first.flatMap { $0.hasPrefix("~") ? nil : $0 }?
                    .replacingOccurrences(of: "завтра", with: "")
                    .trimmingCharacters(in: .whitespaces)
                return Line(id: "t\(item.id)", icon: "circle", time: time?.isEmpty == false ? time : nil, title: item.title)
            }
    }

    private var sections: [Section] {
        var result: [Section] = []
        if !snapshot.laterToday.isEmpty {
            result.append(Section(title: "ДАЛЬШЕ СЕГОДНЯ", lines: snapshot.laterToday.map {
                Line(id: "l\($0.id)", icon: "calendar", time: $0.meta, title: $0.title)
            }))
        }
        let tomorrowLines = tomorrow
        let events = snapshot.tomorrowEvents.count, tasks = snapshot.tomorrow.count
        let counts = [events > 0 ? "\(events) в календаре" : nil, tasks > 0 ? "\(tasks) \(Self.deal(tasks))" : nil]
            .compactMap { $0 }.joined(separator: ", ")
        result.append(Section(title: counts.isEmpty ? "ЗАВТРА" : "ЗАВТРА · \(counts)", lines: tomorrowLines))
        if !snapshot.week.isEmpty {
            result.append(Section(title: "НА НЕДЕЛЕ", lines: snapshot.week.map {
                Line(id: "w\($0.id)", icon: "circle", time: $0.meta, title: $0.title)
            }))
        }
        return result
    }

    /// Средний виджет: одна секция — завтра; если завтра пусто — сегодня вечером или неделя.
    private var mainSection: Section? {
        let all = sections
        return all.first { $0.title.hasPrefix("ЗАВТРА") && !$0.lines.isEmpty }
            ?? all.first { !$0.lines.isEmpty }
    }

    private static func deal(_ n: Int) -> String {
        let mod10 = n % 10, mod100 = n % 100
        if mod10 == 1 && mod100 != 11 { return "дело" }
        if (2...4).contains(mod10) && !(12...14).contains(mod100) { return "дела" }
        return "дел"
    }

    /// Две кнопки: спланировать вперёд и навести порядок.
    private var actions: [(String, String, URL)] {
        let plan = ("План на завтра", "sunrise", Self.ask("Давай спланируем завтра: что в календаре и какие дела взять"))
        let first = isDone ? plan : ("Собрать день", "plus", URL(string: "ealzy://reserve")!)
        let second: (String, String, URL)
        if snapshot.overdueCount > 0 {
            second = ("Разгрести \(snapshot.overdueCount)", "tray",
                      Self.ask("Давай разгребём просроченные дела: что сделать, что перенести, что убрать"))
        } else if !isDone {
            second = plan
        } else if snapshot.somedayCount > 0 {
            second = ("Разобрать \(snapshot.somedayCount)", "tray",
                      Self.ask("Давай разберём дела без срока: что запланировать на неделю, что убрать"))
        } else {
            second = ("Взять ещё", "plus", URL(string: "ealzy://reserve")!)
        }
        return [first, second]
    }

    static func ask(_ text: String) -> URL {
        var components = URLComponents()
        components.scheme = "ealzy"
        components.host = "chat"
        components.queryItems = [URLQueryItem(name: "text", value: text)]
        return components.url!
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: mode == .ahead ? "calendar" : (isDone ? "checkmark.seal.fill" : "sun.max"))
                .font(.footnote)
                .foregroundStyle(Palette.goldText)
            Text(title)
                .font(Typeface.display(family == .systemSmall ? 16 : 17))
                .foregroundStyle(Palette.ink)
                .lineLimit(1)
            Spacer(minLength: 4)
            if mode == .ahead, let accessory {
                accessory
            } else if isDone && family != .systemSmall {
                Text("сделано \(snapshot.doneCount)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Palette.goldText)
            }
        }
    }

    private func sectionView(_ section: Section, limit: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(family == .systemSmall ? (section.title.components(separatedBy: " · ").first ?? section.title) : section.title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Palette.goldText)
                .lineLimit(1)
            if section.lines.isEmpty {
                Text("Пока пусто — самое время спланировать.")
                    .font(.caption)
                    .foregroundStyle(Palette.ink2)
            }
            ForEach(section.lines.prefix(limit)) { line in
                HStack(spacing: 6) {
                    Image(systemName: line.icon)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(Palette.ink3)
                        .frame(width: 12)
                    if let time = line.time {
                        Text(time)
                            .font(.caption.weight(.semibold))
                            .monospacedDigit()
                            .foregroundStyle(Palette.ink)
                            .frame(minWidth: 38, alignment: .leading)
                    }
                    Text(line.title)
                        .font(.caption)
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                }
            }
            if section.lines.count > limit {
                Text("ещё \(section.lines.count - limit)")
                    .font(.caption2)
                    .foregroundStyle(Palette.ink3)
                    .padding(.leading, 18)
            }
        }
    }

    private var buttons: some View {
        HStack(spacing: 6) {
            ForEach(Array(actions.enumerated()), id: \.offset) { index, action in
                Link(destination: action.2) {
                    Label(action.0, systemImage: action.1)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .padding(.horizontal, 8)
                        .frame(maxWidth: .infinity, minHeight: 28)
                        .foregroundStyle(index == 0 ? Palette.goldInk : Palette.ink)
                        .background(index == 0 ? Palette.gold : Palette.rule.opacity(0.6), in: Capsule())
                }
            }
            if mode == .rest, let accessory { accessory }
        }
    }

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(tomorrow.first.map { "Завтра: \([$0.time, $0.title].compactMap { $0 }.joined(separator: " "))" }
                 ?? (isDone ? "Всё сделано" : "Свободный день"))
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(isDone ? "Всё сделано · завтра" : "Свободно · завтра").font(.caption2.weight(.semibold))
                ForEach(tomorrow.prefix(2)) { line in
                    Text([line.time, line.title].compactMap { $0 }.joined(separator: " "))
                        .font(.caption)
                        .lineLimit(1)
                }
                if tomorrow.isEmpty { Text("пока пусто").font(.caption) }
            }
        case .systemSmall:
            VStack(alignment: .leading, spacing: 8) {
                header
                if let section = mainSection {
                    sectionView(section, limit: 3)
                } else {
                    Text("Завтра пока пусто. Нажми — спланируем.")
                        .font(.caption)
                        .foregroundStyle(Palette.ink2)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .widgetURL(isDone ? actions[0].2 : URL(string: "ealzy://reserve"))
        case .systemLarge:
            VStack(alignment: .leading, spacing: 12) {
                header
                ForEach(sections, id: \.title) { section in
                    sectionView(section, limit: section.title.hasPrefix("ЗАВТРА") ? 5 : 3)
                }
                Spacer(minLength: 0)
                if mode == .rest { buttons }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        case .systemMedium where mode == .ahead:
            // «Впереди» в среднем: две ближайшие секции, первая — две строки, вторая — одна.
            let visible = sections.filter { !$0.lines.isEmpty }
            VStack(alignment: .leading, spacing: 8) {
                header
                if visible.isEmpty {
                    Text("Ни встреч, ни дел на ближайшие дни. Можно отдыхать — или спланировать неделю.")
                        .font(.caption)
                        .foregroundStyle(Palette.ink2)
                }
                ForEach(Array(visible.prefix(2).enumerated()), id: \.offset) { index, section in
                    sectionView(section, limit: index == 0 ? 2 : 1)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        default:
            VStack(alignment: .leading, spacing: 8) {
                header
                if let section = mainSection {
                    sectionView(section, limit: 2)
                } else {
                    Text("Завтра пока пусто — спланируем, пока есть время?")
                        .font(.caption)
                        .foregroundStyle(Palette.ink2)
                }
                Spacer(minLength: 0)
                buttons
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

