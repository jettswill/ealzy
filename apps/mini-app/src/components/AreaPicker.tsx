import { useEffect, useRef, useState } from "react";
import type { Circle, CircleMarker, Map as LeafletMap } from "leaflet";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import type { WheelArea } from "../types";
import { currentPoint } from "./WheelPlaces";

// Где искать: рядом со мной (геолокация), район (словами или точкой на карте)
// или весь город. Точность не нужна — центр и радиус «примерно тут».

export type AreaMode = "near" | "map" | "city";
export interface AreaChoice {
  mode: AreaMode;
  area: WheelArea | null;
}

export const RADII = [1_000, 3_000, 5_000, 10_000] as const;
const DEFAULT_RADIUS = 3_000;
const STORAGE_KEY = "ealzy.wheel.area";
/** Центр карты, если город неизвестен и не нашёлся. */
const FALLBACK_CENTER = { lat: 55.7558, lon: 37.6173 };

export function loadAreaChoice(): AreaChoice {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { mode: "city", area: null };
    const parsed = JSON.parse(raw) as AreaChoice;
    if (parsed.mode === "map" && parsed.area) return parsed;
    // Геолокацию не храним: человек мог уехать — спросим заново.
    if (parsed.mode === "near") return { mode: "near", area: null };
  } catch {
    // Хранилище недоступно (приватный режим, встроенный браузер) — начинаем с города.
  }
  return { mode: "city", area: null };
}

function rememberAreaChoice(choice: AreaChoice) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // Не страшно: в следующий раз выберет снова.
  }
}

export function radiusLabel(meters: number, km: string, m: string) {
  return meters >= 1_000 ? `${meters / 1_000} ${km}` : `${meters} ${m}`;
}

/** Карта OpenStreetMap: тап — центр района, круг — радиус. Leaflet грузим лениво. */
function AreaMap({
  area,
  fallback,
  onPick,
}: {
  area: WheelArea | null;
  fallback: { lat: number; lon: number };
  onPick: (point: { lat: number; lon: number }) => void;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const circle = useRef<Circle | null>(null);
  const dot = useRef<CircleMarker | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const L = (await import("leaflet")).default;
        await import("leaflet/dist/leaflet.css");
        if (!alive || !box.current || map.current) return;
        const center = area ?? fallback;
        const instance = L.map(box.current, { zoomControl: true, attributionControl: true });
        instance.setView([center.lat, center.lon], area ? zoomFor(area.radius_m) : 11);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: "© OpenStreetMap",
        }).addTo(instance);
        instance.on("click", (event) => pick.current({ lat: event.latlng.lat, lon: event.latlng.lng }));
        map.current = instance;
        circle.current = L.circle([center.lat, center.lon], {
          radius: area?.radius_m ?? DEFAULT_RADIUS,
          color: "#b99a5c",
          weight: 2,
          fillOpacity: 0.15,
        });
        dot.current = L.circleMarker([center.lat, center.lon], {
          radius: 6,
          color: "#1c1810",
          fillColor: "#d4bc82",
          fillOpacity: 1,
          weight: 2,
        });
        setReady(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      map.current?.remove();
      map.current = null;
    };
    // Карта создаётся один раз; дальше двигаем круг в эффекте ниже.
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    if (!area) {
      circle.current?.remove();
      dot.current?.remove();
      map.current.setView([fallback.lat, fallback.lon], 11);
      return;
    }
    circle.current?.setLatLng([area.lat, area.lon]).setRadius(area.radius_m).addTo(map.current);
    dot.current?.setLatLng([area.lat, area.lon]).addTo(map.current);
    map.current.setView([area.lat, area.lon], zoomFor(area.radius_m), { animate: true });
  }, [ready, area, fallback.lat, fallback.lon]);

  if (failed) return <p className="wheel-hint">{t("wheel.mapFailed")}</p>;
  return <div ref={box} className="area-map" aria-label={t("wheel.mapLabel")} />;
}

function zoomFor(radius: number) {
  return radius <= 1_000 ? 15 : radius <= 3_000 ? 13 : radius <= 5_000 ? 12 : 11;
}

export function AreaPicker({
  city,
  value,
  onChange,
}: {
  city: string | null;
  value: AreaChoice;
  onChange: (choice: AreaChoice) => void;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [query, setQuery] = useState(value.area?.label ?? "");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [fallback, setFallback] = useState(FALLBACK_CENTER);
  const radius = value.area?.radius_m ?? DEFAULT_RADIUS;

  const set = (choice: AreaChoice) => {
    rememberAreaChoice(choice);
    onChange(choice);
  };

  const locate = async () => {
    setBusy(true);
    setStatus(null);
    const point = await currentPoint();
    setBusy(false);
    if (point) {
      set({ mode: "near", area: { ...point, radius_m: radius, label: null } });
      setStatus(t("wheel.located"));
    } else {
      set({ mode: "near", area: null });
      setStatus(t("wheel.locateFailed"));
    }
  };

  // «Рядом со мной», вспомненное с прошлого раза, — спрашиваем точку сразу.
  useEffect(() => {
    if (value.mode === "near" && !value.area) void locate();
  }, []);

  // Центр карты по умолчанию — сам город.
  useEffect(() => {
    if (value.mode !== "map" || value.area || !city?.trim()) return;
    let alive = true;
    api
      .geocodePlace(city.trim())
      .then((found) => alive && setFallback({ lat: found.lat, lon: found.lon }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, city, value.mode, value.area]);

  const find = async () => {
    const text = query.trim();
    if (text.length < 2) return;
    setBusy(true);
    setStatus(null);
    try {
      const found = await api.geocodePlace(text, city);
      set({
        mode: "map",
        area: { lat: found.lat, lon: found.lon, radius_m: radius, label: text },
      });
    } catch {
      setStatus(t("wheel.areaNotFound"));
    } finally {
      setBusy(false);
    }
  };

  const modes: { mode: AreaMode; label: string }[] = [
    { mode: "near", label: t("wheel.areaNear") },
    { mode: "map", label: t("wheel.areaMap") },
    { mode: "city", label: t("wheel.areaCity") },
  ];

  return (
    <div className="wheel-field">
      <span className="wheel-label">{t("wheel.areaTitle")}</span>
      <div className="segmented" role="radiogroup" aria-label={t("wheel.areaTitle")}>
        {modes.map((item) => (
          <button
            key={item.mode}
            type="button"
            role="radio"
            aria-checked={value.mode === item.mode}
            className={`segmented-item ${value.mode === item.mode ? "segmented-item-active" : ""}`}
            onClick={() => {
              setStatus(null);
              if (item.mode === "near") void locate();
              else if (item.mode === "city") set({ mode: "city", area: null });
              else set({ mode: "map", area: value.mode === "map" ? value.area : null });
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {value.mode === "map" && (
        <>
          <div className="area-search">
            <input
              className="input"
              value={query}
              maxLength={120}
              placeholder={t("wheel.areaPlaceholder")}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void find();
                }
              }}
            />
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || query.trim().length < 2}
              onClick={() => void find()}
            >
              {t("wheel.areaFind")}
            </button>
          </div>
          <AreaMap
            area={value.area}
            fallback={fallback}
            onPick={(point) => {
              setQuery("");
              set({ mode: "map", area: { ...point, radius_m: radius, label: null } });
            }}
          />
          <p className="wheel-hint">
            {value.area
              ? value.area.label
                ? t("wheel.areaAround", { place: value.area.label })
                : t("wheel.areaPoint")
              : t("wheel.areaTap")}
          </p>
        </>
      )}

      {value.mode !== "city" && value.area && (
        <div className="chip-row mt-2" role="radiogroup" aria-label={t("wheel.radiusTitle")}>
          {RADII.map((meters) => (
            <button
              key={meters}
              type="button"
              role="radio"
              aria-checked={radius === meters}
              className={`chip ${radius === meters ? "chip-active" : ""}`}
              onClick={() => set({ ...value, area: { ...value.area!, radius_m: meters } })}
            >
              {t("wheel.radius", { r: radiusLabel(meters, t("wheel.km"), t("wheel.m")) })}
            </button>
          ))}
        </div>
      )}
      {status && <p className="wheel-hint">{status}</p>}
    </div>
  );
}
