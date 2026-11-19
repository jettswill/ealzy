import { useEffect, useMemo, useRef, useState } from "react";
import { flapperAngle, type SpinTrack, type WheelSlot } from "../wheelPhysics";

// Колесо видно только верхней частью: большое, центр ниже края, бока уходят
// за экран; в секторах — иконки, на стыках колышки, сверху язычок-стрелка,
// который за них цепляется. По высоте — около трети экрана телефона.

const R = 300;
const CX = 200;
const CY = 330;
const VIEW_H = 262;
const FILLS = ["#d4bc82", "#3a332a", "#b99a5c", "#2a251e"];
/** Пока колесо не крутили — просто красивый набор занятий. */
export const PREVIEW_ICONS = [
  "☕",
  "🎳",
  "🏞️",
  "🎨",
  "🎭",
  "🧗",
  "🍜",
  "🎬",
  "🛶",
  "🧖",
  "🎯",
  "🚲",
];

const toXY = (angle: number, radius: number) => {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)] as const;
};

function sector(start: number, end: number) {
  const [x1, y1] = toXY(start, R);
  const [x2, y2] = toXY(end, R);
  const large = end - start > 180 ? 1 : 0;
  return `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
}

export function WheelArc({
  slots,
  icons,
  track,
  onDone,
  label,
  rotation: rest,
}: {
  slots: WheelSlot[];
  /** Иконка для каждого варианта (segment). */
  icons: string[];
  /** Просчитанное вращение; null — колесо стоит. */
  track: SpinTrack | null;
  onDone: () => void;
  label: string;
  /** Где колесо стоит, когда не крутится. */
  rotation: number;
}) {
  const [live, setLive] = useState<number | null>(null);
  const rotation = track && live !== null ? live : rest;
  const [settled, setSettled] = useState<number | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!track || track.frames.length === 0) return;
    setSettled(null);
    setLive(track.frames[0]!);
    const fps = 60;
    const ticks = new Set(track.ticks);
    let raf = 0;
    let last = -1;
    const started = performance.now();
    const frame = (now: number) => {
      const index = Math.min(track.frames.length - 1, Math.floor(((now - started) / 1000) * fps));
      for (let i = last + 1; i <= index; i++) {
        // Лёгкий щелчок на телефоне, когда язычок задевает колышек.
        if (ticks.has(i)) navigator.vibrate?.(4);
      }
      last = index;
      setLive(track.frames[index]!);
      if (index >= track.frames.length - 1) {
        setSettled(track.slot);
        done.current();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // Вкладка ушла в фон и кадры не идут — итог всё равно покажем.
    const fallback = window.setTimeout(
      () => {
        cancelAnimationFrame(raf);
        setLive(track.frames[track.frames.length - 1]!);
        setSettled(track.slot);
        done.current();
      },
      (track.frames.length / fps) * 1000 + 600,
    );
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
    };
  }, [track]);

  const flap = useMemo(() => flapperAngle(slots, rotation), [slots, rotation]);

  return (
    <div className="wheel-arc" role="img" aria-label={label}>
      <svg viewBox={`0 0 400 ${VIEW_H}`} preserveAspectRatio="xMidYMin slice">
        <g transform={`rotate(${rotation} ${CX} ${CY})`}>
          {slots.map((slot, index) => {
            const size = slot.end - slot.start;
            const mid = (slot.start + slot.end) / 2;
            const [ix, iy] = toXY(mid, R * 0.82);
            const fontSize = Math.max(20, Math.min(42, size * 1.9));
            const win = settled === index;
            return (
              <g key={index}>
                <path
                  d={sector(slot.start, slot.end)}
                  fill={FILLS[index % FILLS.length]}
                  stroke="#191714"
                  strokeWidth="1"
                  className={win ? "wheel-arc-win" : undefined}
                />
                <text
                  x={ix}
                  y={iy}
                  fontSize={fontSize}
                  textAnchor="middle"
                  dominantBaseline="central"
                  transform={`rotate(${mid} ${ix} ${iy})`}
                >
                  {icons[slot.segment] ?? "✦"}
                </text>
              </g>
            );
          })}
          <circle cx={CX} cy={CY} r={R - 1} fill="none" stroke="var(--app-gold)" strokeWidth="2.5" />
          {slots.map((slot, index) => {
            const [px, py] = toXY(slot.start, R - 9);
            return (
              <circle
                key={`peg-${index}`}
                cx={px}
                cy={py}
                r="4.6"
                fill="#f1ebdd"
                stroke="#191714"
                strokeWidth="1"
              />
            );
          })}
        </g>
        {/* Язычок: висит на оси сверху, колышки отгибают его вправо. */}
        <g transform={`rotate(${-flap} ${CX} 6)`} className="wheel-arc-flapper">
          <path d={`M ${CX - 11} 4 L ${CX + 11} 4 L ${CX} 56 Z`} fill="var(--app-text)" />
          <circle cx={CX} cy="9" r="6" fill="var(--app-gold)" stroke="var(--app-text)" />
        </g>
      </svg>
    </div>
  );
}
