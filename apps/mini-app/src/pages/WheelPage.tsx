import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Button, PageHeader } from "../components/ui";
import { useI18n } from "../i18n";
import type {
  WheelCompany,
  WheelMood,
  WheelRequest,
  WheelSegment,
  WheelSpin,
  WheelWhen,
} from "../types";

// Колесо «Удиви меня»: человек говорит, чего хочет, — сервер собирает типы
// под запрос и сам решает, где колесо остановится. Здесь — только форма,
// анимация до выпавшего сектора и карточка с местами.

const SPIN_MS = 4600;
const COLORS = [
  { fill: "#d4bc82", text: "#1c1810" },
  { fill: "#3a332a", text: "#f1ebdd" },
  { fill: "#b99a5c", text: "#1c1810" },
  { fill: "#2a251e", text: "#e9dcbc" },
];

export interface WheelArc {
  start: number;
  end: number;
  mid: number;
}

/** Секторы по часовой от верха (0° — где стрелка), доля — по весу. */
export function wheelArcs(segments: Pick<WheelSegment, "weight">[]): WheelArc[] {
  const total = segments.reduce((sum, s) => sum + Math.max(1, s.weight), 0) || 1;
  let angle = 0;
  return segments.map((segment) => {
    const size = (Math.max(1, segment.weight) / total) * 360;
    const arc = { start: angle, end: angle + size, mid: angle + size / 2 };
    angle += size;
    return arc;
  });
}

/** Новый угол поворота: пять полных оборотов и сектор с центром mid под стрелкой. */
export function targetRotation(previous: number, mid: number, turns = 5) {
  const settled = previous - (((previous % 360) + 360) % 360);
  return settled + turns * 360 + ((360 - mid) % 360);
}

function point(angle: number, radius: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return [100 + radius * Math.cos(rad), 100 + radius * Math.sin(rad)] as const;
}

function sectorPath(arc: WheelArc, radius = 96) {
  if (arc.end - arc.start >= 359.99) return `M 100 4 A 96 96 0 1 1 99.99 4 Z`;
  const [x1, y1] = point(arc.start, radius);
  const [x2, y2] = point(arc.end, radius);
  const large = arc.end - arc.start > 180 ? 1 : 0;
  return `M 100 100 L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
}

const shortName = (name: string) => {
  const clean = name.replace(/\s*\(.*?\)\s*/g, " ").trim();
  return clean.length > 18 ? `${clean.slice(0, 17).trim()}…` : clean;
};

export function Wheel({
  segments,
  rotation,
  spinning,
  onStop,
  pointerLabel,
}: {
  segments: WheelSegment[];
  rotation: number;
  spinning: boolean;
  onStop: () => void;
  pointerLabel: string;
}) {
  const arcs = wheelArcs(segments);
  return (
    <div className="wheel">
      <div className="wheel-pointer" aria-label={pointerLabel} />
      <svg
        viewBox="0 0 200 200"
        className="wheel-disc"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.15, 0.7, 0.12, 1)` : "none",
        }}
        onTransitionEnd={() => spinning && onStop()}
        role="img"
        aria-label={segments.map((s) => s.name).join(", ")}
      >
        <circle cx="100" cy="100" r="99" fill="var(--app-gold)" opacity="0.35" />
        {segments.map((segment, index) => {
          const arc = arcs[index]!;
          const color = COLORS[index % COLORS.length]!;
          const [ex, ey] = point(arc.mid, 74);
          return (
            <g key={segment.id}>
              <path d={sectorPath(arc)} fill={color.fill} stroke="#191714" strokeWidth="0.6" />
              <text
                x={ex}
                y={ey}
                fontSize="13"
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${arc.mid} ${ex} ${ey})`}
              >
                {segment.emoji ?? "✦"}
              </text>
              <text
                x="100"
                y="100"
                fill={color.text}
                fontSize={segments.length > 6 ? 6.2 : 7}
                fontWeight="600"
                textAnchor="end"
                dominantBaseline="central"
                transform={`rotate(${arc.mid - 90} 100 100) translate(62 0)`}
              >
                {shortName(segment.name)}
              </text>
            </g>
          );
        })}
        <circle cx="100" cy="100" r="13" fill="#191714" stroke="var(--app-gold)" strokeWidth="2" />
        <text x="100" y="100" fontSize="11" textAnchor="middle" dominantBaseline="central">
          🎲
        </text>
      </svg>
    </div>
  );
}

const DEFAULT_REQUEST: WheelRequest = {
  mood: "any",
  want: null,
  when: "today",
  company: "solo",
  city: null,
  only_new: true,
  feedback: null,
};

function Choice<T extends string>({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="wheel-field">
      <span className="wheel-label">{title}</span>
      <div className="segmented" role="radiogroup" aria-label={title}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={`segmented-item ${value === option.value ? "segmented-item-active" : ""}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function WheelPage() {
  const { api } = useAuth();
  const { t } = useI18n();
  const [request, setRequest] = useState<WheelRequest>(DEFAULT_REQUEST);
  const [left, setLeft] = useState<number | null | undefined>(undefined);
  const [limit, setLimit] = useState(3);
  const [spin, setSpin] = useState<WheelSpin | null>(null);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const stopTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    api
      .wheelStatus()
      .then((status) => {
        if (!alive) return;
        setLeft(status.spins_left);
        setLimit(status.spins_limit);
      })
      .catch(() => alive && setLeft(null));
    return () => {
      alive = false;
      window.clearTimeout(stopTimer.current);
    };
  }, [api]);

  const out = left === 0;
  const patch = (next: Partial<WheelRequest>) => setRequest((current) => ({ ...current, ...next }));

  const stop = () => {
    window.clearTimeout(stopTimer.current);
    setSpinning(false);
    setRevealed(true);
    window.setTimeout(() => resultRef.current?.scrollIntoView?.({ behavior: "smooth" }), 60);
  };

  const go = async (withFeedback: boolean) => {
    if (spinning || out) return;
    setError(null);
    setRevealed(false);
    try {
      const result = await api.spinWheel({
        ...request,
        want: request.want?.trim() || null,
        city: request.city?.trim() || null,
        feedback: withFeedback ? feedback.trim() || null : null,
      });
      const arc = wheelArcs(result.segments)[result.winner_index]!;
      setSpin(result);
      setEditing(false);
      setLeft(result.spins_left);
      setLimit(result.spins_limit);
      setFeedback("");
      // Новый набор секторов рисуем с прежнего угла, потом запускаем оборот.
      // Два кадра: сначала React рисует новые секторы на прежнем угле.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setSpinning(true);
          setRotation((previous) => targetRotation(previous, arc.mid));
          // Если transitionend не пришёл (вкладка в фоне) — всё равно показываем итог.
          stopTimer.current = window.setTimeout(stop, SPIN_MS + 400);
        }),
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      if ((caught as { status?: number }).status === 429) setLeft(0);
    }
  };

  const counter =
    left === undefined
      ? null
      : left === null
        ? t("wheel.unlimited")
        : t("wheel.left", { n: left, limit });

  const winner = spin?.winner;
  const priceKey = winner ? `wheel.price${Math.min(4, Math.max(1, winner.type.price_level))}` : "";

  return (
    <>
      <Link className="back-link" to="/more">
        {t("common.back")}
      </Link>
      <PageHeader
        eyebrow={t("wheel.eyebrow")}
        title={t("wheel.title")}
        description={t("wheel.description")}
      />

      {editing ? (
        <form
          className="wheel-form"
          onSubmit={(event) => {
            event.preventDefault();
            void go(false);
          }}
        >
          <Choice<WheelMood>
            title={t("wheel.moodTitle")}
            value={request.mood}
            onChange={(mood) => patch({ mood })}
            options={[
              { value: "calm", label: t("wheel.moodCalm") },
              { value: "active", label: t("wheel.moodActive") },
              { value: "any", label: t("wheel.moodAny") },
            ]}
          />
          <label className="wheel-field">
            <span className="wheel-label">{t("wheel.wantLabel")}</span>
            <input
              className="input"
              value={request.want ?? ""}
              maxLength={120}
              placeholder={t("wheel.wantPlaceholder")}
              onChange={(event) => patch({ want: event.target.value })}
            />
          </label>
          <Choice<WheelWhen>
            title={t("wheel.whenTitle")}
            value={request.when}
            onChange={(when) => patch({ when })}
            options={[
              { value: "now", label: t("wheel.whenNow") },
              { value: "today", label: t("wheel.whenToday") },
              { value: "weekend", label: t("wheel.whenWeekend") },
            ]}
          />
          <Choice<WheelCompany>
            title={t("wheel.companyTitle")}
            value={request.company}
            onChange={(company) => patch({ company })}
            options={[
              { value: "solo", label: t("wheel.companySolo") },
              { value: "pair", label: t("wheel.companyPair") },
              { value: "friends", label: t("wheel.companyFriends") },
              { value: "kids", label: t("wheel.companyKids") },
            ]}
          />
          <label className="wheel-field">
            <span className="wheel-label">{t("wheel.cityLabel")}</span>
            <input
              className="input"
              value={request.city ?? ""}
              maxLength={80}
              placeholder={t("wheel.cityPlaceholder")}
              onChange={(event) => patch({ city: event.target.value })}
            />
          </label>
          <label className="wheel-check">
            <input
              type="checkbox"
              checked={request.only_new}
              onChange={(event) => patch({ only_new: event.target.checked })}
            />
            <span>{t("wheel.onlyNew")}</span>
          </label>
          <Button type="submit" className="wheel-go" disabled={out || spinning}>
            {t("wheel.spin")}
          </Button>
          {counter && <p className="wheel-counter">{out ? t("wheel.noneLeft") : counter}</p>}
          {error && <p className="wheel-error">{error}</p>}
        </form>
      ) : (
        spin && (
          <>
            <Wheel
              segments={spin.segments}
              rotation={rotation}
              spinning={spinning}
              onStop={stop}
              pointerLabel={t("wheel.pointer")}
            />
            {spinning && <p className="wheel-counter">{t("wheel.spinning")}</p>}
            {revealed && winner && (
              <div ref={resultRef} className="wheel-result">
                <p className="eyebrow">{t("wheel.result")}</p>
                <h2 className="wheel-result-title">
                  <span aria-hidden>{winner.type.emoji ?? "✦"}</span> {winner.type.name}
                </h2>
                <p className="wheel-meta">
                  {[
                    winner.category?.name,
                    t(priceKey),
                    t("wheel.hours", { n: winner.type.duration_hours }),
                    t(`wheel.${winner.type.setting}`),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {winner.type.description && (
                  <p className="wheel-description">{winner.type.description}</p>
                )}
                <h3 className="settings-group-title mt-4">{t("wheel.places")}</h3>
                {winner.places.length ? (
                  <div className="list-stack">
                    {winner.places.map((place) => (
                      <a
                        key={place.id}
                        className="list-row"
                        href={
                          place.yandex_url ||
                          `https://yandex.ru/maps/?text=${encodeURIComponent(
                            [place.name, place.address, place.city].filter(Boolean).join(" "),
                          )}`
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span className="list-row-body">
                          <span className="list-row-title">{place.name}</span>
                          <span className="list-row-text">
                            {[
                              place.address,
                              place.yandex_rating != null
                                ? t("wheel.rating", { rating: place.yandex_rating.toFixed(1) })
                                : null,
                              place.yandex_reviews
                                ? t("wheel.reviews", { n: place.yandex_reviews })
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="wheel-description">{t("wheel.noPlaces")}</p>
                )}
                <a
                  className="button button-secondary wheel-maps"
                  href={winner.maps_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("wheel.openMaps")}
                </a>

                {out ? (
                  <p className="wheel-counter">{t("wheel.noneLeft")}</p>
                ) : (
                  <form
                    className="wheel-again"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void go(true);
                    }}
                  >
                    <label className="wheel-field">
                      <span className="wheel-label">{t("wheel.whyTitle")}</span>
                      <textarea
                        className="input min-h-20"
                        value={feedback}
                        maxLength={500}
                        placeholder={t("wheel.whyPlaceholder")}
                        onChange={(event) => setFeedback(event.target.value)}
                      />
                    </label>
                    <Button type="submit" disabled={spinning}>
                      {left == null ? t("wheel.again") : t("wheel.againLeft", { n: left })}
                    </Button>
                  </form>
                )}
                {error && <p className="wheel-error">{error}</p>}
                <button type="button" className="wheel-link" onClick={() => setEditing(true)}>
                  {t("wheel.change")}
                </button>
              </div>
            )}
          </>
        )
      )}
    </>
  );
}
