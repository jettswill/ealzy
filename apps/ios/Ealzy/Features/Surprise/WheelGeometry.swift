import Foundation

// Физика колеса «Удиви меня» — та же, что на сайте (apps/mini-app/src/wheelPhysics.ts).
// Итог выбирает сервер; подбираем толчок, после которого колесо остановится на нём
// само: трение, колышки на стыках (каждый отнимает одну порцию энергии), а когда
// сил перескочить колышек уже нет — колесо упирается и чуть откатывается.

/// Сектор колеса: вариант `segment`, от `start` до `end` в градусах по часовой от верха.
struct WheelSlot: Equatable {
    let segment: Int
    let start: Double
    var end: Double
    var middle: Double { (start + end) / 2 }
}

struct SpinParams {
    /// Постоянное торможение, °/с².
    var friction = 34.0
    /// Сопротивление, пропорциональное скорости, 1/с.
    var drag = 0.22
    /// «Цена» колышка в скорости, °/с: v² уменьшается на peg²; медленнее — не перескочить.
    var peg = 42.0
    /// Откат от колышка, °.
    var bounce = 2.2
    var fps = 60.0
}

struct SpinTrack: Equatable {
    /// Поворот колеса по кадрам (°, по часовой).
    var frames: [Double]
    /// Кадры, на которых язычок щёлкнул о колышек.
    var ticks: [Int]
    /// Сектор под стрелкой в конце.
    var slot: Int
}

enum WheelPhysics {
    private static func mod(_ value: Double, _ base: Double) -> Double {
        let r = value.truncatingRemainder(dividingBy: base)
        return r < 0 ? r + base : r
    }

    /// Варианты повторяются по кругу — колесо выглядит полным (видна только верхняя треть).
    static func slots(_ weights: [Double], minSlots: Int = 18) -> [WheelSlot] {
        let n = weights.count
        guard n > 0 else { return [] }
        let copies = max(1, Int((Double(minSlots) / Double(n)).rounded(.up)))
        let safe = weights.map { max(0.35, $0) }
        let total = safe.reduce(0, +) * Double(copies)
        var result: [WheelSlot] = []
        var at = 0.0
        for _ in 0..<copies {
            for (index, weight) in safe.enumerated() {
                let size = weight / total * 360
                result.append(WheelSlot(segment: index, start: at, end: at + size))
                at += size
            }
        }
        result[result.count - 1].end = 360
        return result
    }

    /// Сектор под стрелкой (она сверху), когда колесо повёрнуто на `rotation`.
    static func slot(at rotation: Double, in slots: [WheelSlot]) -> Int {
        let angle = mod(-rotation, 360)
        return slots.firstIndex { angle >= $0.start && angle < $0.end } ?? max(0, slots.count - 1)
    }

    static func simulate(_ slots: [WheelSlot], from: Double, velocity: Double, params: SpinParams = SpinParams()) -> SpinTrack {
        let pegs = Array(Set(slots.map { mod(360 - $0.start, 360) })).sorted()
        let steps = 2
        let dt = 1 / (params.fps * Double(steps))
        func nextPeg(after position: Double) -> Double {
            let base = position - mod(position, 360)
            for turn in 0..<2 {
                for peg in pegs {
                    let at = base + Double(turn) * 360 + peg
                    if at > position + 1e-9 { return at }
                }
            }
            return position + 360
        }
        var frames = [from]
        var ticks: [Int] = []
        var position = from
        var speed = velocity
        var peg = nextPeg(after: position)
        var step = 0
        while speed > 0, Double(frames.count) < params.fps * 30 {
            speed -= (params.friction + params.drag * speed) * dt
            if speed <= 0 { break }
            var next = position + speed * dt
            if next >= peg {
                let left = speed * speed - params.peg * params.peg
                if left <= 0 {
                    // Не хватило сил перескочить: упёрлось и откатилось.
                    next = peg - 0.4
                    frames.append(next)
                    ticks.append(frames.count - 1)
                    let back = max(4, Int((params.fps * 0.18).rounded()))
                    for i in 1...back {
                        let t = Double(i) / Double(back)
                        frames.append(next - params.bounce * sin(t * .pi / 2))
                    }
                    position = frames[frames.count - 1]
                    speed = 0
                    break
                }
                speed = left.squareRoot()
                ticks.append(frames.count)
                peg = nextPeg(after: peg)
            }
            position = next
            step += 1
            if step % steps == 0 { frames.append(position) }
        }
        if frames.last != position { frames.append(position) }
        return SpinTrack(frames: frames, ticks: ticks, slot: slot(at: position, in: slots))
    }

    /// Толчок, после которого колесо остановится на варианте `segment` (4–8,5 с).
    static func plan(
        _ slots: [WheelSlot], from: Double, segment: Int,
        random: () -> Double = { Double.random(in: 0..<1) }, params: SpinParams = SpinParams()
    ) -> SpinTrack {
        var fits: [SpinTrack] = []
        var velocity = 380.0
        while velocity <= 1100 {
            let track = simulate(slots, from: from, velocity: velocity, params: params)
            let seconds = Double(track.frames.count) / params.fps
            if seconds >= 4, seconds <= 8.5, slots[track.slot].segment == segment { fits.append(track) }
            velocity += 2.5
        }
        if !fits.isEmpty { return fits[min(fits.count - 1, Int(random() * Double(fits.count)))] }
        return eased(slots, from: from, segment: segment, random: random, params: params)
    }

    /// Запасной путь и «меньше движения»: плавно в середину сектора.
    static func eased(
        _ slots: [WheelSlot], from: Double, segment: Int, random: () -> Double = { Double.random(in: 0..<1) },
        params: SpinParams = SpinParams(), seconds: Double = 4.5, turns: Double = 3
    ) -> SpinTrack {
        let candidates = slots.indices.filter { slots[$0].segment == segment }
        let index = candidates.isEmpty ? 0 : candidates[min(candidates.count - 1, Int(random() * Double(candidates.count)))]
        guard !slots.isEmpty else { return SpinTrack(frames: [from], ticks: [], slot: 0) }
        let target = from - mod(from, 360) + turns * 360 + mod(360 - slots[index].middle, 360)
        let total = max(1, Int((seconds * params.fps).rounded()))
        let frames = (0...total).map { i -> Double in
            let t = Double(i) / Double(total)
            return from + (target - from) * (1 - pow(1 - t, 4))
        }
        return SpinTrack(frames: frames, ticks: [], slot: index)
    }

    /// Насколько отогнут язычок (°, ≥ 0): колышек на колесе под углом s при повороте r
    /// виден на экране под углом (s + r) mod 360; стрелка — на 0.
    static func flapper(_ slots: [WheelSlot], rotation: Double, contact: Double = 4.5, release: Double = 2.5, max limit: Double = 26) -> Double {
        var angle = 0.0
        for slot in slots {
            let screen = mod(slot.start + rotation, 360)
            let remaining = 360 - screen
            if remaining > 0, remaining <= contact {
                angle = max(angle, limit * (1 - remaining / contact))
            } else if screen < release {
                angle = max(angle, limit * 0.5 * (1 - screen / release))
            }
        }
        return angle
    }
}
