// Физика колеса «Удиви меня». Итог выбирает сервер; здесь подбираем такой толчок,
// чтобы колесо остановилось на нём само — с трением, колышками на стыках и
// язычком-стрелкой, который за них цепляется. Всё детерминированно: один и тот же
// толчок даёт ту же траекторию, поэтому её можно просчитать заранее и проиграть.

export interface WheelSlot {
  /** Индекс варианта (сегмента) с сервера. */
  segment: number;
  /** Градусы по часовой от верха колеса. */
  start: number;
  end: number;
}

/**
 * Секторы на всём круге: варианты повторяются по кругу, чтобы колесо выглядело
 * полным (на экране видна только верхняя треть); доля сектора — по весу.
 */
export function wheelSlots(weights: number[], minSlots = 18): WheelSlot[] {
  const n = weights.length;
  if (!n) return [];
  const copies = Math.max(1, Math.ceil(minSlots / n));
  const safe = weights.map((w) => Math.max(0.35, w));
  const total = safe.reduce((sum, w) => sum + w, 0) * copies;
  const slots: WheelSlot[] = [];
  let at = 0;
  for (let copy = 0; copy < copies; copy++) {
    for (let i = 0; i < n; i++) {
      const size = (safe[i]! / total) * 360;
      slots.push({ segment: i, start: at, end: at + size });
      at += size;
    }
  }
  // Погрешность сложения — последнему.
  slots[slots.length - 1]!.end = 360;
  return slots;
}

export interface SpinParams {
  /** Постоянное торможение, °/с². */
  friction: number;
  /** Сопротивление, пропорциональное скорости, 1/с. */
  drag: number;
  /**
   * Скорость, которую «съедает» колышек, °/с: каждый отнимает одну и ту же порцию
   * энергии (v² − peg²). На разгоне почти незаметно, на излёте — рывками, а
   * медленнее `peg` колышек уже не перескочить — колесо упирается и откатывается.
   */
  peg: number;
  /** Откат от колышка, °. */
  bounce: number;
  fps: number;
}

export const DEFAULT_SPIN: SpinParams = {
  friction: 34,
  drag: 0.22,
  peg: 42,
  bounce: 2.2,
  fps: 60,
};

export interface SpinTrack {
  /** Поворот колеса по кадрам, °, по часовой. */
  frames: number[];
  /** Кадры, на которых язычок щёлкнул о колышек. */
  ticks: number[];
  /** Сектор под стрелкой в конце. */
  slot: number;
}

const mod = (value: number, base: number) => ((value % base) + base) % base;

/** Какой сектор под стрелкой (она сверху), когда колесо повёрнуто на `rotation`. */
export function slotAt(slots: WheelSlot[], rotation: number) {
  const angle = mod(-rotation, 360);
  const index = slots.findIndex((slot) => angle >= slot.start && angle < slot.end);
  return index < 0 ? slots.length - 1 : index;
}

/**
 * Прокрутить колесо с начальной скоростью `velocity` (°/с) от поворота `from`.
 * Колышек на стыке проходит под стрелкой, когда поворот ≡ −угол колышка (mod 360).
 */
export function simulateSpin(
  slots: WheelSlot[],
  from: number,
  velocity: number,
  params: SpinParams = DEFAULT_SPIN,
): SpinTrack {
  const pegs = [...new Set(slots.map((slot) => mod(360 - slot.start, 360)))].sort((a, b) => a - b);
  const steps = 2; // считаем вдвое чаще, чем рисуем
  const dt = 1 / (params.fps * steps);
  // Ближайший колышек впереди (в развёрнутых градусах).
  const nextPeg = (position: number) => {
    const base = position - mod(position, 360);
    for (let turn = 0; turn < 2; turn++) {
      for (const peg of pegs) {
        const at = base + turn * 360 + peg;
        if (at > position + 1e-9) return at;
      }
    }
    return position + 360;
  };
  const frames: number[] = [from];
  const ticks: number[] = [];
  let position = from;
  let speed = velocity;
  let peg = nextPeg(position);
  let step = 0;
  while (speed > 0 && frames.length < params.fps * 30) {
    speed -= (params.friction + params.drag * speed) * dt;
    if (speed <= 0) break;
    let next = position + speed * dt;
    if (next >= peg) {
      const left = speed * speed - params.peg * params.peg;
      if (left <= 0) {
        // Не хватило сил перескочить: упёрлось и откатилось назад.
        next = peg - 0.4;
        frames.push(next);
        ticks.push(frames.length - 1);
        const back = Math.max(4, Math.round(params.fps * 0.18));
        for (let i = 1; i <= back; i++) {
          const t = i / back;
          frames.push(next - params.bounce * Math.sin((t * Math.PI) / 2));
        }
        position = frames[frames.length - 1]!;
        speed = 0;
        break;
      }
      speed = Math.sqrt(left);
      ticks.push(frames.length);
      peg = nextPeg(peg);
    }
    position = next;
    step++;
    if (step % steps === 0) frames.push(position);
  }
  if (frames[frames.length - 1] !== position) frames.push(position);
  return { frames, ticks, slot: slotAt(slots, position) };
}

/**
 * Толчок, после которого колесо остановится на варианте `segment`: перебираем
 * скорости в пределах «приятных» 4–7 секунд и берём случайную из подходящих.
 */
export function planSpin(
  slots: WheelSlot[],
  from: number,
  segment: number,
  rng: () => number = Math.random,
  params: SpinParams = DEFAULT_SPIN,
): SpinTrack {
  const fits: SpinTrack[] = [];
  let fallback: SpinTrack | null = null;
  for (let velocity = 380; velocity <= 1100; velocity += 2.5) {
    const track = simulateSpin(slots, from, velocity, params);
    const seconds = track.frames.length / params.fps;
    if (seconds < 4 || seconds > 8.5) continue;
    if (slots[track.slot]?.segment === segment) fits.push(track);
    else fallback ??= track;
  }
  if (fits.length) return fits[Math.floor(rng() * fits.length)]!;
  // Не нашлось (очень узкий сектор) — плавная остановка точно в нём.
  return easedSpin(slots, from, segment, rng, params);
}

/** Запасной путь и «меньше движения»: гладкое замедление в середину сектора. */
export function easedSpin(
  slots: WheelSlot[],
  from: number,
  segment: number,
  rng: () => number = Math.random,
  params: SpinParams = DEFAULT_SPIN,
  seconds = 4.5,
  turns = 3,
): SpinTrack {
  const candidates = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot.segment === segment);
  const { slot, index } = candidates[Math.floor(rng() * candidates.length)] ?? {
    slot: slots[0]!,
    index: 0,
  };
  const mid = (slot.start + slot.end) / 2;
  const target = from - mod(from, 360) + turns * 360 + mod(360 - mid, 360);
  const total = Math.max(1, Math.round(seconds * params.fps));
  const frames: number[] = [];
  for (let i = 0; i <= total; i++) {
    const t = i / total;
    frames.push(from + (target - from) * (1 - (1 - t) ** 4));
  }
  return { frames, ticks: [], slot: index };
}

/**
 * Насколько отогнут язычок (°, всегда ≥ 0): колышек, подходящий к стрелке слева,
 * толкает его вбок; перескочил — язычок пружинит обратно. Колышек на колесе под
 * углом s при повороте r виден на экране под углом (s + r) mod 360, стрелка — на 0.
 */
export function flapperAngle(
  slots: WheelSlot[],
  rotation: number,
  contact = 4.5,
  release = 2.5,
  max = 26,
) {
  let angle = 0;
  for (const slot of slots) {
    const screen = mod(slot.start + rotation, 360);
    const remaining = 360 - screen; // ещё не дошёл до стрелки
    if (remaining > 0 && remaining <= contact) {
      angle = Math.max(angle, max * (1 - remaining / contact));
    } else if (screen < release) {
      angle = Math.max(angle, max * 0.5 * (1 - screen / release));
    }
  }
  return angle;
}
