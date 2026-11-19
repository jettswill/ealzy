import SwiftUI

/// Колесо видно только верхней третью: центр ниже края, в секторах — иконки без
/// текста, на стыках колышки, сверху язычок-стрелка, который за них цепляется.
struct WheelDisc: View {
    let slots: [WheelSlot]
    /// Иконка для каждого варианта (`WheelSlot.segment`).
    let icons: [String]
    let rotation: Double
    /// Сектор, на котором остановились, — подсвечен.
    var settled: Int? = nil
    var accessibilityText = ""

    /// Пока колесо не крутили — просто красивый набор занятий.
    static let previewIcons = ["☕", "🎳", "🏞️", "🎨", "🎭", "🧗", "🍜", "🎬", "🛶", "🧖", "🎯", "🚲"]

    private static let fills: [Color] = [
        Color(hex: 0xD4BC82), Color(hex: 0x3A332A), Color(hex: 0xB99A5C), Color(hex: 0x2A251E),
    ]

    var body: some View {
        // Сцена 400 × 168, как на сайте: центр колеса (200; 232), радиус 210.
        GeometryReader { proxy in
            let scale = proxy.size.width / 400
            Canvas { context, _ in
                let center = CGPoint(x: 200 * scale, y: 232 * scale)
                let radius = 210 * scale
                var wheel = context
                wheel.translateBy(x: center.x, y: center.y)
                wheel.rotate(by: .degrees(rotation))
                for (index, slot) in slots.enumerated() {
                    var sector = Path()
                    sector.move(to: .zero)
                    sector.addArc(center: .zero, radius: radius,
                                  startAngle: .degrees(slot.start - 90), endAngle: .degrees(slot.end - 90),
                                  clockwise: false)
                    sector.closeSubpath()
                    let fill = Self.fills[index % Self.fills.count]
                    wheel.fill(sector, with: .color(index == settled ? fill.opacity(1) : fill.opacity(0.94)))
                    wheel.stroke(sector, with: .color(Color(hex: 0x191714)), lineWidth: 1)
                    if index == settled {
                        wheel.stroke(sector, with: .color(Palette.gold), lineWidth: 3)
                    }
                    // Иконка — повернута по сектору.
                    let angle = (slot.middle - 90) * .pi / 180
                    let size = min(30, max(15, (slot.end - slot.start) * 1.35)) * scale
                    var icon = wheel
                    icon.translateBy(x: radius * 0.8 * cos(angle), y: radius * 0.8 * sin(angle))
                    icon.rotate(by: .degrees(slot.middle))
                    icon.draw(Text(icons.indices.contains(slot.segment) ? icons[slot.segment] : "✨")
                        .font(.system(size: size)), at: .zero)
                }
                let rim = Path(ellipseIn: CGRect(x: -radius + 1, y: -radius + 1, width: radius * 2 - 2, height: radius * 2 - 2))
                wheel.stroke(rim, with: .color(Palette.gold), lineWidth: 2)
                for slot in slots {
                    let angle = (slot.start - 90) * .pi / 180
                    let point = CGPoint(x: (radius - 7 * scale) * cos(angle), y: (radius - 7 * scale) * sin(angle))
                    let peg = Path(ellipseIn: CGRect(x: point.x - 3.4 * scale, y: point.y - 3.4 * scale,
                                                     width: 6.8 * scale, height: 6.8 * scale))
                    wheel.fill(peg, with: .color(Color(hex: 0xF1EBDD)))
                    wheel.stroke(peg, with: .color(Color(hex: 0x191714)), lineWidth: 1)
                }

                // Язычок: висит на оси сверху, колышки отгибают его вправо.
                var flapper = context
                flapper.translateBy(x: center.x, y: 6 * scale)
                flapper.rotate(by: .degrees(-WheelPhysics.flapper(slots, rotation: rotation)))
                var tongue = Path()
                tongue.move(to: CGPoint(x: -9 * scale, y: -2 * scale))
                tongue.addLine(to: CGPoint(x: 9 * scale, y: -2 * scale))
                tongue.addLine(to: CGPoint(x: 0, y: 38 * scale))
                tongue.closeSubpath()
                flapper.fill(tongue, with: .color(Palette.ink))
                let pivot = Path(ellipseIn: CGRect(x: -5 * scale, y: -3 * scale, width: 10 * scale, height: 10 * scale))
                flapper.fill(pivot, with: .color(Palette.gold))
            }
        }
        .aspectRatio(400 / 168, contentMode: .fit)
        // Низ колеса уходит в тень — видна только верхняя треть.
        .mask(LinearGradient(stops: [.init(color: .black, location: 0.62), .init(color: .clear, location: 1)],
                             startPoint: .top, endPoint: .bottom))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText.isEmpty ? "Колесо «Удиви меня»" : "Колесо: \(accessibilityText)")
    }
}
