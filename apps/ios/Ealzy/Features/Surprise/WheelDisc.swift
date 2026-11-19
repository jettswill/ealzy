import SwiftUI

/// Диск со стрелкой. `rotation` анимирует экран; по окончании — `onStop`.
struct WheelDisc: View {
    let segments: [WheelSegment]
    let rotation: Double

    private static let fills: [Color] = [
        Color(hex: 0xD4BC82), Color(hex: 0x8C7448), Color(hex: 0xB89A5E), Color(hex: 0x5E4B2E),
    ]

    var body: some View {
        let arcs = WheelGeometry.arcs(segments.map(\.weight))
        GeometryReader { proxy in
            let size = min(proxy.size.width, proxy.size.height)
            ZStack {
                ZStack {
                    ForEach(Array(segments.enumerated()), id: \.offset) { index, segment in
                        if index < arcs.count {
                            sector(arcs[index], size: size)
                                .fill(Self.fills[index % Self.fills.count])
                            sector(arcs[index], size: size)
                                .stroke(Palette.ground, lineWidth: 1.5)
                            label(segment, arc: arcs[index], size: size, dark: index % 2 == 1)
                        }
                    }
                    Circle()
                        .fill(Palette.ground)
                        .frame(width: size * 0.16, height: size * 0.16)
                        .overlay(Circle().strokeBorder(Palette.gold, lineWidth: 2))
                }
                .rotationEffect(.degrees(rotation))

                // Стрелка сверху — не крутится.
                Triangle()
                    .fill(Palette.ink)
                    .frame(width: 22, height: 20)
                    .offset(y: -size / 2 - 2)
                    .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
            }
            .frame(width: size, height: size)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Колесо: " + segments.map(\.name).joined(separator: ", "))
    }

    private func sector(_ arc: WheelArc, size: CGFloat) -> Path {
        Path { path in
            let center = CGPoint(x: size / 2, y: size / 2)
            path.move(to: center)
            // У SwiftUI ноль — справа; у нас — сверху.
            path.addArc(center: center, radius: size / 2,
                        startAngle: .degrees(arc.start - 90), endAngle: .degrees(arc.end - 90), clockwise: false)
            path.closeSubpath()
        }
    }

    private func label(_ segment: WheelSegment, arc: WheelArc, size: CGFloat, dark: Bool) -> some View {
        let angle = (arc.middle - 90) * .pi / 180
        let radius = size * 0.34
        let wide = arc.end - arc.start >= 40
        return VStack(spacing: 1) {
            Text(segment.emoji ?? "✨").font(.system(size: wide ? 24 : 18))
            if wide {
                Text(segment.name)
                    .font(.system(size: 10, weight: .semibold))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .frame(width: size * 0.26)
                    .foregroundStyle(dark ? Color(hex: 0xF1EBDD) : Palette.goldInk)
            }
        }
        .rotationEffect(.degrees(arc.middle))
        .position(x: size / 2 + radius * cos(angle), y: size / 2 + radius * sin(angle))
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: CGPoint(x: rect.midX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
            path.closeSubpath()
        }
    }
}
