import { useEffect, useState } from "react";
import { useAuth } from "../auth";
import { Button } from "./ui";
import { useI18n } from "../i18n";
import type {
  NearbyPlaces,
  PlaceCandidate,
  PlaceEmotion,
  PlaceInfo,
  SavedPlace,
  Tastes,
  VisitInput,
} from "../types";

// Места под выпавший тип и вкусы человека. Найденное рядом в базу не пишется,
// пока человек не скажет «хочу» или «я был» — тогда место остаётся в Ealzy
// и в его дневнике с оценкой и впечатлением.

const EMOTIONS: { value: PlaceEmotion; emoji: string; key: string }[] = [
  { value: "wow", emoji: "🤩", key: "wheel.emotionWow" },
  { value: "good", emoji: "🙂", key: "wheel.emotionGood" },
  { value: "meh", emoji: "😐", key: "wheel.emotionMeh" },
  { value: "bad", emoji: "👎", key: "wheel.emotionBad" },
];

export function formatDistance(meters: number | null | undefined, km: string, m: string) {
  if (meters == null) return null;
  if (meters < 1000) return `${Math.round(meters / 10) * 10} ${m}`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0).replace(".", ",")} ${km}`;
}

/** Точка человека: геолокация браузера или null, если не дали или нет за 8 с. */
export function currentPoint(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 10 * 60_000 },
    );
  });
}

function VisitForm({
  onSave,
  onCancel,
}: {
  onSave: (visit: Pick<VisitInput, "rating" | "emotion" | "note">) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [emotion, setEmotion] = useState<PlaceEmotion | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="wheel-visit"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSave({ emotion, rating, note: note.trim() || null });
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="wheel-label">{t("wheel.howWasIt")}</span>
      <div className="chip-row" role="radiogroup" aria-label={t("wheel.howWasIt")}>
        {EMOTIONS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={emotion === item.value}
            className={`chip ${emotion === item.value ? "chip-active" : ""}`}
            onClick={() => setEmotion(emotion === item.value ? null : item.value)}
          >
            {item.emoji} {t(item.key)}
          </button>
        ))}
      </div>
      <div className="wheel-stars" role="radiogroup" aria-label={t("wheel.ratingLabel")}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={String(value)}
            className={`wheel-star ${rating != null && value <= rating ? "wheel-star-on" : ""}`}
            onClick={() => setRating(rating === value ? null : value)}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        className="input min-h-16"
        value={note}
        maxLength={2000}
        placeholder={t("wheel.notePlaceholder")}
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="wheel-row">
        <Button type="submit" disabled={busy}>
          {t("wheel.saveVisit")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

type Row =
  { kind: "saved"; place: SavedPlace | PlaceInfo } | { kind: "found"; place: PlaceCandidate };

function PlaceRow({ row, typeId }: { row: Row; typeId: string }) {
  const { api } = useAuth();
  const { t } = useI18n();
  const place = row.place;
  const [status, setStatus] = useState<"want" | "visited" | null>(
    row.kind === "saved" ? (((place as SavedPlace).my_status as "want" | "visited") ?? null) : null,
  );
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rating =
    row.kind === "found"
      ? row.place.rating
      : ((place as SavedPlace).rating ?? (place as PlaceInfo).yandex_rating ?? null);
  const count =
    row.kind === "found"
      ? row.place.rating_count
      : ((place as SavedPlace).rating_count ?? (place as PlaceInfo).yandex_reviews ?? null);
  const distance = formatDistance(
    (place as { distance_m?: number | null }).distance_m,
    t("wheel.km"),
    t("wheel.m"),
  );
  const href =
    row.kind === "found"
      ? row.place.maps_url
      : (place as PlaceInfo).yandex_url ||
        `https://yandex.ru/maps/?text=${encodeURIComponent(
          [place.name, place.address, place.city].filter(Boolean).join(" "),
        )}`;

  const save = async (visit: VisitInput) => {
    setError(null);
    try {
      if (row.kind === "found") await api.savePlace(row.place, visit);
      else await api.saveVisit((place as PlaceInfo).id, visit);
      setStatus(visit.status === "visited" ? "visited" : "want");
      setAsking(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="wheel-place">
      <a className="wheel-place-main" href={href} target="_blank" rel="noreferrer">
        <span className="list-row-title">{place.name}</span>
        {row.kind === "found" && row.place.note && (
          <span className="list-row-text">{row.place.note}</span>
        )}
        <span className="list-row-text">
          {[
            place.address,
            distance,
            rating != null ? t("wheel.rating", { rating: Number(rating).toFixed(1) }) : null,
            count ? t("wheel.reviews", { n: count }) : null,
            row.kind === "found" && row.place.source === "web" ? t("wheel.fromWeb") : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </a>
      {status === "visited" ? (
        <span className="wheel-badge">{t("wheel.beenThere")}</span>
      ) : asking ? null : (
        <div className="wheel-row">
          <button
            type="button"
            className={`chip ${status === "want" ? "chip-active" : ""}`}
            onClick={() => void save({ activity_type_id: typeId, status: "want" })}
          >
            {status === "want" ? t("wheel.wanted") : t("wheel.want")}
          </button>
          <button type="button" className="chip" onClick={() => setAsking(true)}>
            {t("wheel.been")}
          </button>
        </div>
      )}
      {asking && (
        <VisitForm
          onCancel={() => setAsking(false)}
          onSave={(visit) => save({ activity_type_id: typeId, status: "visited", ...visit })}
        />
      )}
      {error && <p className="wheel-error">{error}</p>}
    </div>
  );
}

export function WheelPlaces({
  typeId,
  city,
  initial,
  mapsUrl,
}: {
  typeId: string;
  city: string | null;
  initial: PlaceInfo[];
  mapsUrl: string;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [nearby, setNearby] = useState<NearbyPlaces | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNearby(null);
    setError(null);
  }, [typeId]);

  const look = async () => {
    setLoading(true);
    setError(null);
    try {
      const point = await currentPoint();
      setNearby(await api.nearbyPlaces({ type: typeId, lat: point?.lat, lon: point?.lon, city }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  const rows: Row[] = nearby
    ? [
        ...nearby.saved.map((place) => ({ kind: "saved" as const, place })),
        ...nearby.found.map((place) => ({ kind: "found" as const, place })),
      ]
    : initial.map((place) => ({ kind: "saved" as const, place }));

  return (
    <section className="mt-4">
      <h3 className="settings-group-title">
        {nearby ? t("wheel.nearbyTitle") : t("wheel.places")}
      </h3>
      {rows.length ? (
        <div className="list-stack">
          {rows.map((row) => (
            <PlaceRow
              key={row.kind === "found" ? `f:${row.place.source_id}` : `s:${row.place.id}`}
              row={row}
              typeId={typeId}
            />
          ))}
        </div>
      ) : (
        <p className="wheel-description">
          {nearby ? t("wheel.nothingNearby") : t("wheel.noPlaces")}
        </p>
      )}
      <div className="wheel-row mt-3">
        {!nearby && (
          <Button type="button" variant="secondary" disabled={loading} onClick={() => void look()}>
            {loading ? t("wheel.looking") : t("wheel.findNearby")}
          </Button>
        )}
        <a className="button button-ghost" href={mapsUrl} target="_blank" rel="noreferrer">
          {t("wheel.openMaps")}
        </a>
      </div>
      {nearby?.web ? (
        <p className="wheel-hint">{t("wheel.webHint")}</p>
      ) : (
        nearby?.source === "osm" &&
        nearby.found.length > 0 && <p className="wheel-hint">{t("wheel.osmHint")}</p>
      )}
      {error && <p className="wheel-error">{error}</p>}
    </section>
  );
}

export function TastesPanel() {
  const { api } = useAuth();
  const { t } = useI18n();
  const [tastes, setTastes] = useState<Tastes | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .tastes()
      .then((value) => alive && setTastes(value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api]);

  if (!tastes) return null;
  const liked = tastes.items.filter(
    (item) => item.verdict === "like" || (!item.verdict && item.score >= 0.3),
  );
  const never = tastes.items.filter((item) => item.verdict === "never");
  const less = tastes.items.filter((item) => !item.verdict && item.score <= -0.3);
  const clear = async (item: (typeof tastes.items)[number]) => {
    setTastes(
      await api.setTaste({
        target_kind: item.target_kind,
        target_id: item.target_id,
        verdict: null,
      }),
    );
  };
  const chip = (item: (typeof tastes.items)[number], kind: "liked" | "never" | "less") => (
    <span
      key={`${item.target_kind}:${item.target_id}`}
      className={`wheel-taste wheel-taste-${kind}`}
    >
      {item.emoji ?? "✦"} {item.name}
      {item.verdict && (
        <button
          type="button"
          className="wheel-taste-x"
          aria-label={t("wheel.forget", { name: item.name })}
          onClick={() => void clear(item)}
        >
          ×
        </button>
      )}
    </span>
  );
  return (
    <section className="wheel-tastes">
      <h2 className="settings-group-title">{t("wheel.tastesTitle")}</h2>
      {tastes.summary ? (
        <p className="wheel-description">{tastes.summary}</p>
      ) : (
        <p className="wheel-hint">{t("wheel.tastesEmpty")}</p>
      )}
      {liked.length > 0 && (
        <div className="chip-row mt-2">{liked.map((i) => chip(i, "liked"))}</div>
      )}
      {less.length > 0 && <div className="chip-row mt-2">{less.map((i) => chip(i, "less"))}</div>}
      {never.length > 0 && (
        <div className="chip-row mt-2">{never.map((i) => chip(i, "never"))}</div>
      )}
      {tastes.ai_available && (
        <button
          type="button"
          className="wheel-link"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setTastes(await api.refreshTastes());
            } catch {
              // Нейросеть недоступна или кончился лимит — оставляем как было.
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t("wheel.thinking") : t("wheel.refreshTastes")}
        </button>
      )}
    </section>
  );
}
