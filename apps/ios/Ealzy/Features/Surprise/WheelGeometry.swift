import Foundation

/// Сектор колеса: от `start` до `end` в градусах по часовой стрелке от верха.
struct WheelArc: Equatable {
    let start: Double
    let end: Double
    var middle: Double { (start + end) / 2 }
}

enum WheelGeometry {
    /// Доля сектора = вес (= шанс выпасть).
    static func arcs(_ weights: [Double]) -> [WheelArc] {
        let total = weights.reduce(0) { $0 + max($1, 0.01) }
        guard total > 0 else { return [] }
        var at = 0.0
        return weights.map { weight in
            let size = max(weight, 0.01) / total * 360
            defer { at += size }
            return WheelArc(start: at, end: at + size)
        }
    }

    /// Поворот, при котором `winner` встаёт под стрелку сверху: несколько полных
    /// оборотов от текущего положения и случайная точка внутри сектора.
    static func targetRotation(from current: Double, arc: WheelArc, turns: Int = 5, jitter: Double = Double.random(in: -0.3...0.3)) -> Double {
        let inside = arc.middle + (arc.end - arc.start) / 2 * jitter
        // Колесо крутится по часовой: точка на угле a окажется сверху при повороте −a.
        let wanted = (360 - inside.truncatingRemainder(dividingBy: 360)).truncatingRemainder(dividingBy: 360)
        let base = current - current.truncatingRemainder(dividingBy: 360)
        var target = base + Double(turns) * 360 + wanted
        if target - current < Double(turns) * 360 { target += 360 }
        return target
    }
}
