import EventKit
import SwiftUI

/// Лента дня 8:00–23:00: цвет полосы — время суток, встречи — капсулы со временем,
/// золотая капсула — окно для главного дела, черта — «сейчас».
struct DayRibbon: View {
    struct Event: Identifiable {
        let id = UUID()
        let title: String
        let start: Date
        let end: Date
        let isPast: Bool
        var source: EKEvent?
    }

    let events: [Event]
    let focus: TimeSpan?
    let now: Date
    var startHour = 8
    var endHour = 23
    var onEvent: (Event) -> Void = { _ in }
    var onFocus: () -> Void = {}

    @Environment(\.colorScheme) private var scheme

    private let laneTop: CGFloat = 18
    private let laneHeight: CGFloat = 40
    private let pillHeight: CGFloat = 32
    private let minPill: CGFloat = 40

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            ZStack(alignment: .topLeading) {
                Capsule()
                    .fill(Palette.lane(scheme))
                    .frame(width: width, height: laneHeight)
                    .offset(y: laneTop)

                ForEach(events) { event in
                    pill(time(event.start), from: event.start, to: event.end, width: width,
                         fill: event.isPast ? Palette.pillPast : Palette.pill,
                         ink: event.isPast ? Palette.ink2 : Palette.ink) { onEvent(event) }
                        .accessibilityLabel("\(time(event.start)) \(event.title)")
                }
                if let focus {
                    pill(time(focus.start), from: focus.start, to: focus.end, width: width,
                         fill: Palette.gold, ink: Palette.goldInk) { onFocus() }
                        .accessibilityLabel("Окно для фокуса с \(time(focus.start))")
                }

                if let x = position(now, width: width) {
                    Capsule().fill(Palette.ink)
                        .frame(width: 2, height: 48)
                        .offset(x: x - 1, y: laneTop - 4)
                    Text(time(now))
                        .font(.caption2.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(Palette.ink)
                        .fixedSize()
                        .alignmentGuide(.leading) { $0[HorizontalAlignment.center] - x }
                }

                ForEach(labels(width: width), id: \.x) { label in
                    Text(label.text)
                        .font(.caption2.weight(label.isFocus ? .semibold : .regular))
                        .foregroundStyle(label.isFocus ? Palette.goldText : Palette.ink2)
                        .lineLimit(1)
                        .fixedSize()
                        .offset(x: label.x, y: laneTop + laneHeight + 6)
                }

                HStack {
                    ForEach(Array(stride(from: startHour, through: endHour, by: 3)), id: \.self) { hour in
                        Text("\(hour)")
                        if hour < endHour { Spacer(minLength: 0) }
                    }
                }
                .font(.caption2)
                .monospacedDigit()
                .foregroundStyle(Palette.ink3)
                .frame(width: width)
                .offset(y: laneTop + laneHeight + 22)
            }
        }
        .frame(height: laneTop + laneHeight + 36)
        .accessibilityElement(children: .contain)
    }

    // MARK: Геометрия

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
    private func pill(
        _ text: String, from: Date, to: Date, width: CGFloat, fill: Color, ink: Color,
        action: @escaping () -> Void
    ) -> some View {
        let x = fraction(from) * width
        let w = max((fraction(to) - fraction(from)) * width, minPill)
        let left = min(x, width - w - 4)
        Button(action: action) {
            Text(text)
                .font(.caption2.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(ink)
                .lineLimit(1)
                .frame(width: w, height: pillHeight)
                .background(fill, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .offset(x: max(left, 4), y: laneTop + (laneHeight - pillHeight) / 2)
    }

    private struct Label { let x: CGFloat; let text: String; let isFocus: Bool }

    /// Подписи под капсулами — только если не налезают друг на друга.
    private func labels(width: CGFloat) -> [Label] {
        var all = events.filter { !$0.isPast }.map {
            Label(x: fraction($0.start) * width, text: Self.shortTitle($0.title), isFocus: false)
        }
        if let focus { all.append(Label(x: fraction(focus.start) * width, text: "фокус", isFocus: true)) }
        var kept: [Label] = []
        // Подпись шириной ~84 pt не должна уходить за правый край.
        let maxX = width - 84
        for label in all.sorted(by: { $0.x < $1.x }) {
            let x = min(label.x, maxX)
            if let last = kept.last, x - last.x < 72 { continue }
            kept.append(Label(x: x, text: label.text, isFocus: label.isFocus))
        }
        return kept
    }

    static func shortTitle(_ title: String) -> String {
        title.count > 12 ? String(title.prefix(11)) + "…" : title
    }

    private func time(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    private var accessibilityText: String {
        let parts = events.map { "\(time($0.start)) \($0.title)" }
        let focusText = focus.map { "окно для фокуса с \(time($0.start)) до \(time($0.end))" }
        return (["Лента дня"] + parts + [focusText].compactMap { $0 }).joined(separator: ", ")
    }
}
