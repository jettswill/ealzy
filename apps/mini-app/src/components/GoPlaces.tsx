import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { Button } from "./ui";
import { useI18n } from "../i18n";
import { currentPoint, formatDistance } from "./WheelPlaces";
import type { NearbyPlaces, OutingPlan, PlaceCandidate, SavedPlace, WheelArea } from "../types";

// После «Пойду»: сами ищем хорошие места рядом и сразу даём сделать шаг —
// «Пойду сюда», позвонить, открыть сайт, построить маршрут. Потом «Когда?» —
// и выход в календаре; не знает — вечером Илзи спросит сам.

type Card = {
  key: string;
  name: string;
  address: string | null;
  rating: number | null;
  count: number | null;
  distance: number | null;
  phone: string | null;
  website: string | null;
  hours: string | null;
  lat: number | null;
  lon: number | null;
  mapsUrl: string;
  target: { place_id: string } | { candidate: PlaceCandidate };
};

function cards(nearby: NearbyPlaces): Card[] {
  const saved = nearby.saved.map((p: SavedPlace): Card => ({
    key: `s:${p.id}`,
    name: p.name,
    address: p.address,
    rating: p.rating ?? p.yandex_rating ?? null,
    count: p.rating_count ?? p.yandex_reviews ?? null,
    distance: p.distance_m ?? null,
    phone: p.phone ?? null,
    website: p.website ?? null,
    hours: p.hours ?? null,
    lat: p.lat ?? null,
    lon: p.lon ?? null,
    mapsUrl:
      p.yandex_url ||
      p.twogis_url ||
      `https://yandex.ru/maps/?text=${encodeURIComponent([p.name, p.address, p.city].filter(Boolean).join(" "))}`,
    target: { place_id: p.id },
  }));
  const found = nearby.found.map((p): Card => ({
    key: `f:${p.source_id}`,
    name: p.name,
    address: p.address,
    rating: p.rating,
    count: p.rating_count,
    distance: p.distance_m,
    phone: p.phone,
    website: p.website,
    hours: p.hours,
    lat: p.lat,
    lon: p.lon,
    mapsUrl: p.maps_url,
    target: { candidate: p },
  }));
  // Хорошие (4.3+) — вперёд, внутри — ближе раньше; без рейтинга — в конец.
  const good = (c: Card) => (c.rating != null && c.rating >= 4.3 ? 0 : c.rating != null ? 1 : 2);
  return [...saved, ...found].sort(
    (a, b) =>
      good(a) - good(b) ||
      (a.distance ?? 1e9) - (b.distance ?? 1e9) ||
      (b.rating ?? 0) - (a.rating ?? 0),
  );
}

const website = (url: string) => (/^https?:\/\//.test(url) ? url : `https://${url}`);
const route = (c: Card) =>
  c.lat != null && c.lon != null ? `https://yandex.ru/maps/?rtext=~${c.lat},${c.lon}` : c.mapsUrl;

/** Время для быстрых кнопок: сегодня 19:00, завтра 19:00, суббота 12:00. */
export function quickTimes(now = new Date()) {
  const at = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const toSaturday = (6 - now.getDay() + 7) % 7 || 7;
  return {
    tonight: now.getHours() < 18 ? at(0, 19) : null,
    tomorrow: at(1, 19),
    saturday: toSaturday === 1 ? null : at(toSaturday, 12),
  };
}

function When({ onPick, busy }: { onPick: (when: Date | null) => void; busy: boolean }) {
  const { t } = useI18n();
  const [picking, setPicking] = useState(false);
  const [value, setValue] = useState("");
  const times = quickTimes();
  return (
    <div className="go-when">
      <span className="wheel-label">{t("wheel.goWhen")}</span>
      <div className="chip-row">
        {times.tonight && (
          <button
            type="button"
            className="chip"
            disabled={busy}
            onClick={() => onPick(times.tonight)}
          >
            {t("wheel.goTonight")}
          </button>
        )}
        <button
          type="button"
          className="chip"
          disabled={busy}
          onClick={() => onPick(times.tomorrow)}
        >
          {t("wheel.goTomorrow")}
        </button>
        {times.saturday && (
          <button
            type="button"
            className="chip"
            disabled={busy}
            onClick={() => onPick(times.saturday)}
          >
            {t("wheel.goSaturday")}
          </button>
        )}
        <button type="button" className="chip" disabled={busy} onClick={() => setPicking(!picking)}>
          {t("wheel.goPick")}
        </button>
      </div>
      {picking && (
        <div className="wheel-row mt-2">
          <input
            type="datetime-local"
            className="input"
            aria-label={t("wheel.goPick")}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <Button type="button" disabled={!value || busy} onClick={() => onPick(new Date(value))}>
            {t("wheel.goPickSave")}
          </Button>
        </div>
      )}
      <button type="button" className="wheel-link" disabled={busy} onClick={() => onPick(null)}>
        {t("wheel.goLater")}
      </button>
    </div>
  );
}

function PlaceCard({
  card,
  typeId,
  chosen,
  onChoose,
}: {
  card: Card;
  typeId: string;
  chosen: boolean;
  onChoose: (plan: OutingPlan | null) => void;
}) {
  const { api } = useAuth();
  const { t, locale } = useI18n();
  const [plan, setPlan] = useState<OutingPlan | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const distance = formatDistance(card.distance, t("wheel.km"), t("wheel.m"));

  const save = async (when: Date | null) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.planOuting(card.target, typeId, when ? when.toISOString() : null);
      setPlan(result);
      setAsking(false);
      onChoose(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  const planned = plan?.task?.due_at ?? plan?.visit.planned_for ?? null;
  const whenText = planned
    ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ru-RU", {
        weekday: "short",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(planned))
    : null;

  return (
    <article className={`go-card ${chosen ? "go-card-chosen" : ""}`}>
      <div className="go-card-head">
        <h3 className="go-card-name">{card.name}</h3>
        {card.rating != null && (
          <span
            className="go-card-rating"
            aria-label={t("wheel.rating", { rating: card.rating.toFixed(1) })}
          >
            ★ {card.rating.toFixed(1)}
            {card.count ? <small> · {card.count}</small> : null}
          </span>
        )}
      </div>
      <p className="go-card-meta">{[card.address, distance].filter(Boolean).join(" · ")}</p>
      {card.hours && <p className="go-card-meta">{t("wheel.goHours", { hours: card.hours })}</p>}

      {!plan && !asking && (
        <Button type="button" className="go-card-main" onClick={() => setAsking(true)}>
          {t("wheel.goHere")}
        </Button>
      )}
      {asking && !plan && <When busy={busy} onPick={(when) => void save(when)} />}
      {plan && (
        <div className="go-done" role="status">
          <p>✓ {whenText ? t("wheel.goPlanned", { when: whenText }) : t("wheel.goSavedNoDate")}</p>
          <button
            type="button"
            className="wheel-link"
            onClick={() => {
              setPlan(null);
              setAsking(true);
            }}
          >
            {t("wheel.goChangeTime")}
          </button>
        </div>
      )}

      <div className="go-actions">
        {card.phone && (
          <a className="go-action" href={`tel:${card.phone.replace(/[^\d+]/g, "")}`}>
            <span aria-hidden>📞</span> {t("wheel.goCall")}
          </a>
        )}
        {card.website && (
          <a className="go-action" href={website(card.website)} target="_blank" rel="noreferrer">
            <span aria-hidden>🌐</span> {t("wheel.goSite")}
          </a>
        )}
        <a className="go-action" href={route(card)} target="_blank" rel="noreferrer">
          <span aria-hidden>🧭</span> {t("wheel.goRoute")}
        </a>
      </div>
      {error && <p className="wheel-error">{error}</p>}
    </article>
  );
}

export function GoPlaces({
  typeId,
  city,
  area,
  mapsUrl,
}: {
  typeId: string;
  city: string | null;
  area?: WheelArea;
  mapsUrl: string;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [nearby, setNearby] = useState<NearbyPlaces | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(4);
  const [chosen, setChosen] = useState<string | null>(null);

  const look = async () => {
    setError(null);
    try {
      const point = area ?? (await currentPoint());
      setNearby(
        await api.nearbyPlaces({
          type: typeId,
          lat: point?.lat,
          lon: point?.lon,
          city,
          radius: area?.radius_m,
          near: area?.label,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };
  const lookRef = useRef(look);
  lookRef.current = look;
  useEffect(() => {
    setNearby(null);
    setShown(4);
    setChosen(null);
    void lookRef.current();
  }, [typeId, area?.lat, area?.lon, area?.radius_m, area?.label]);

  if (!nearby && !error) return <p className="go-loading">{t("wheel.goLooking")}</p>;
  const list = nearby ? cards(nearby) : [];
  const visible = chosen ? list.filter((c) => c.key === chosen) : list.slice(0, shown);
  return (
    <section className="go-places">
      {list.length ? (
        <>
          {!chosen && <p className="wheel-going">{t("wheel.goingLead")}</p>}
          {visible.map((card) => (
            <PlaceCard
              key={card.key}
              card={card}
              typeId={typeId}
              chosen={chosen === card.key}
              onChoose={(plan) => setChosen(plan ? card.key : null)}
            />
          ))}
          {chosen ? (
            <button type="button" className="wheel-link" onClick={() => setChosen(null)}>
              {t("wheel.goOtherPlace")}
            </button>
          ) : (
            list.length > shown && (
              <button type="button" className="wheel-link" onClick={() => setShown(shown + 4)}>
                {t("wheel.goMore")}
              </button>
            )
          )}
        </>
      ) : (
        <p className="wheel-description">
          {t("wheel.goNothing")}{" "}
          <a href={mapsUrl} target="_blank" rel="noreferrer">
            {t("wheel.openMaps")}
          </a>
        </p>
      )}
      {error && <p className="wheel-error">{error}</p>}
    </section>
  );
}
