import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth";
import { Button, PageHeader } from "../components/ui";
import { AreaPicker, loadAreaChoice, type AreaChoice } from "../components/AreaPicker";
import { CityInput } from "../components/CityInput";
import { PREVIEW_ICONS, WheelArc } from "../components/WheelArc";
import { TastesPanel } from "../components/WheelPlaces";
import { GoPlaces } from "../components/GoPlaces";
import { useI18n } from "../i18n";
import type { WheelCompany, WheelMood, WheelRequest, WheelSpin, WheelWhen } from "../types";
import { easedSpin, planSpin, wheelSlots, type SpinTrack } from "../wheelPhysics";

// Колесо «Удиви меня». Человек говорит, чего хочет, — сервер выбирает вариант,
// колесо (верхняя треть, иконки, колышки) докручивается до него само. Дальше
// главное — «Пойду»: показываем, куда именно; «Поискать ещё» — что не так,
// настройки и новое вращение.

type Phase = "setup" | "spinning" | "result" | "going" | "more";

const DEFAULT_REQUEST: WheelRequest = {
  mood: "any",
  want: null,
  when: "today",
  company: "solo",
  city: null,
  only_new: true,
  feedback: null,
};

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Быстрые ответы «что не так» — сервер понимает эти слова. */
const QUICK_REASONS = [
  { id: "Expensive", word: "дорого" },
  { id: "Far", word: "далеко" },
  { id: "Boring", word: "скучно" },
  { id: "Tired", word: "устал" },
  { id: "Move", word: "хочу подвигаться" },
  { id: "Long", word: "долго" },
] as const;

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
  const [where, setWhere] = useState<AreaChoice>(loadAreaChoice);
  const area = where.mode === "city" ? null : where.area;
  const [left, setLeft] = useState<number | null | undefined>(undefined);
  const [limit, setLimit] = useState(3);
  const [phase, setPhase] = useState<Phase>("setup");
  const [spin, setSpin] = useState<WheelSpin | null>(null);
  const [track, setTrack] = useState<SpinTrack | null>(null);
  const [rotation, setRotation] = useState(0);
  const [reasons, setReasons] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<"like" | "never" | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [subscribed, setSubscribed] = useState<boolean | undefined>(undefined);
  const [asked, setAsked] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .wheelStatus()
      .then((status) => {
        if (!alive) return;
        setLeft(status.spins_left);
        setLimit(status.spins_limit);
        setSubscribed(status.subscribed ?? true);
        const known = status.city ?? status.city_guess ?? null;
        if (known) setRequest((current) => (current.city ? current : { ...current, city: known }));
      })
      .catch(() => alive && setLeft(null));
    return () => {
      alive = false;
    };
  }, [api]);

  const segments = spin?.segments;
  const slots = useMemo(
    () => wheelSlots(segments ? segments.map((s) => s.weight) : PREVIEW_ICONS.map(() => 1)),
    [segments],
  );
  const icons = segments ? segments.map((s) => s.emoji ?? "✦") : PREVIEW_ICONS;

  const out = left === 0;
  const patch = (next: Partial<WheelRequest>) => setRequest((current) => ({ ...current, ...next }));

  const go = async (again: boolean) => {
    if (phase === "spinning" || out) return;
    setError(null);
    const why = [...reasons, feedback.trim()].filter(Boolean).join(", ");
    try {
      const result = await api.spinWheel({
        ...request,
        want: request.want?.trim() || null,
        city: request.city?.trim() || null,
        feedback: again ? why || null : null,
        area,
      });
      const nextSlots = wheelSlots(result.segments.map((s) => s.weight));
      const plan = reducedMotion()
        ? easedSpin(nextSlots, rotation, result.winner_index, Math.random, undefined, 0.6, 1)
        : planSpin(nextSlots, rotation, result.winner_index);
      setSpin(result);
      setTrack(plan);
      setVerdict(result.winner.verdict ?? null);
      setLeft(result.spins_left);
      setLimit(result.spins_limit);
      setReasons([]);
      setFeedback("");
      setShowSettings(false);
      setPhase("spinning");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      if ((caught as { status?: number }).status === 429) setLeft(0);
      if ((caught as { status?: number }).status === 402) setSubscribed(false);
    }
  };

  const stopped = () => {
    if (track) setRotation(track.frames[track.frames.length - 1] ?? rotation);
    setPhase("result");
    window.setTimeout(() => resultRef.current?.scrollIntoView?.({ behavior: "smooth" }), 80);
  };

  // «Не предлагать» пишется сразу: следующее вращение это учтёт.
  const judge = async (next: "like" | "never" | null) => {
    if (!spin) return;
    const previous = verdict;
    setVerdict(next);
    try {
      await api.setTaste({ target_kind: "type", target_id: spin.winner.type.id, verdict: next });
    } catch (caught) {
      setVerdict(previous);
      setError(caught instanceof Error ? caught.message : String(caught));
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

  const settings = (
    <>
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
      <div className="wheel-field">
        <span className="wheel-label">{t("wheel.cityLabel")}</span>
        <CityInput value={request.city} onChange={(city) => patch({ city })} />
      </div>
      <AreaPicker city={request.city?.trim() || null} value={where} onChange={setWhere} />
      <label className="wheel-check">
        <input
          type="checkbox"
          checked={request.only_new}
          onChange={(event) => patch({ only_new: event.target.checked })}
        />
        <span>{t("wheel.onlyNew")}</span>
      </label>
    </>
  );

  if (subscribed === false)
    return (
      <div className="wheel-page">
        <PageHeader eyebrow={t("wheel.eyebrow")} title={t("wheel.title")} />
        <WheelArc
          slots={slots}
          icons={icons}
          track={null}
          onDone={() => undefined}
          label={t("wheel.description")}
          rotation={rotation}
        />
        <section className="wheel-paywall">
          <h2 className="wheel-result-title">{t("wheel.paywallTitle")}</h2>
          <p className="wheel-description">{t("wheel.paywallText")}</p>
          <ul className="wheel-paywall-points">
            <li>✦ {t("wheel.paywallPoint1")}</li>
            <li>📍 {t("wheel.paywallPoint2")}</li>
            <li>📅 {t("wheel.paywallPoint3")}</li>
          </ul>
          {asked ? (
            <p className="go-done" role="status">✓ {t("wheel.paywallSent")}</p>
          ) : (
            <Button
              type="button"
              className="wheel-go"
              onClick={() => {
                setAsked(true);
                void api.requestSubscription("surprise").catch(() => undefined);
              }}
            >
              {t("wheel.paywallCta")}
            </Button>
          )}
        </section>
      </div>
    );

  return (
    <div className="wheel-page">
      <PageHeader eyebrow={t("wheel.eyebrow")} title={t("wheel.title")} />

      <WheelArc
        slots={slots}
        icons={icons}
        track={phase === "spinning" ? track : null}
        onDone={stopped}
        label={segments ? segments.map((s) => s.name).join(", ") : t("wheel.description")}
        rotation={rotation}
      />
      {phase === "spinning" && <p className="wheel-counter">{t("wheel.spinning")}</p>}

      {phase === "setup" && (
        <form
          className="wheel-form"
          onSubmit={(event) => {
            event.preventDefault();
            void go(false);
          }}
        >
          <p className="wheel-lead">{t("wheel.description")}</p>
          {settings}
          <Button type="submit" className="wheel-go" disabled={out}>
            {t("wheel.spin")}
          </Button>
          {counter && <p className="wheel-counter">{out ? t("wheel.noneLeft") : counter}</p>}
          {error && <p className="wheel-error">{error}</p>}
          <TastesPanel />
        </form>
      )}

      {winner && (phase === "result" || phase === "going" || phase === "more") && (
        <div ref={resultRef} className="wheel-result">
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
          {winner.reason && <p className="wheel-reason">✦ {winner.reason}</p>}
          {winner.type.description && phase !== "going" && (
            <p className="wheel-description">{winner.type.description}</p>
          )}

          {phase === "result" && (
            <div className="wheel-choice">
              <Button
                type="button"
                className="wheel-go"
                onClick={() => {
                  setPhase("going");
                  void api.goingWheel(spin?.spin_id ?? null, winner.type.id).catch(() => undefined);
                }}
              >
                {t("wheel.going")}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setPhase("more")}>
                {t("wheel.searchMore")}
              </Button>
            </div>
          )}

          {phase === "going" && (
            <>
              <GoPlaces
                typeId={winner.type.id}
                city={request.city?.trim() || null}
                area={area ?? undefined}
                mapsUrl={winner.maps_url}
              />
              <button type="button" className="wheel-link wheel-link-quiet" onClick={() => setPhase("more")}>
                {t("wheel.notThis")}
              </button>
            </>
          )}

          {phase === "more" && (
            <form
              className="wheel-again"
              onSubmit={(event) => {
                event.preventDefault();
                void go(true);
              }}
            >
              <span className="wheel-label">{t("wheel.whyTitle")}</span>
              <div className="wheel-row" role="group" aria-label={t("wheel.whyTitle")}>
                {QUICK_REASONS.map(({ id, word }) => {
                  const on = reasons.includes(word);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`chip ${on ? "chip-active" : ""}`}
                      aria-pressed={on}
                      onClick={() =>
                        setReasons((current) =>
                          on ? current.filter((r) => r !== word) : [...current, word],
                        )
                      }
                    >
                      {t(`wheel.reason${id}`)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className={`chip ${verdict === "never" ? "chip-active" : ""}`}
                  aria-pressed={verdict === "never"}
                  onClick={() => void judge(verdict === "never" ? null : "never")}
                >
                  🚫 {t("wheel.never")}
                </button>
              </div>
              {verdict === "never" && <p className="wheel-hint">{t("wheel.neverHint")}</p>}
              <textarea
                className="input min-h-16"
                value={feedback}
                maxLength={500}
                placeholder={t("wheel.whyPlaceholder")}
                aria-label={t("wheel.whyTitle")}
                onChange={(event) => setFeedback(event.target.value)}
              />
              <button
                type="button"
                className="wheel-link"
                aria-expanded={showSettings}
                onClick={() => setShowSettings((open) => !open)}
              >
                {showSettings ? t("wheel.hideSettings") : t("wheel.change")}
              </button>
              {showSettings && <div className="wheel-form">{settings}</div>}
              {out ? (
                <p className="wheel-counter">{t("wheel.noneLeft")}</p>
              ) : (
                <Button type="submit">
                  {left == null ? t("wheel.again") : t("wheel.againLeft", { n: left })}
                </Button>
              )}
              <button type="button" className="wheel-link" onClick={() => setPhase("going")}>
                {t("wheel.backToGoing")}
              </button>
            </form>
          )}
          {error && <p className="wheel-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
