import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api";
import { App } from "../App";
import { AuthProvider, SESSION_KEY } from "../auth";
import { targetRotation, wheelArcs } from "../pages/WheelPage";
import type { WheelSpin } from "../types";

// Настоящая карта в jsdom не нужна: заглушка с тем же интерфейсом.
const leafletStub = vi.hoisted(() => {
  const layer = () => {
    const self = {
      addTo: () => self,
      setLatLng: () => self,
      setRadius: () => self,
      remove: () => self,
    };
    return self;
  };
  const clicks: ((event: { latlng: { lat: number; lng: number } }) => void)[] = [];
  const map = () => {
    const self = {
      setView: () => self,
      on: (_name: string, handler: (typeof clicks)[number]) => {
        clicks.push(handler);
        return self;
      },
      remove: () => undefined,
    };
    return self;
  };
  return { clicks, default: { map, tileLayer: layer, circle: layer, circleMarker: layer } };
});
vi.mock("leaflet", () => ({ default: leafletStub.default }));
vi.mock("leaflet/dist/leaflet.css", () => ({}));

const api = new ApiClient(() => "test-token");
const factory = () => api;

function spinResult(extra: Partial<WheelSpin> = {}): WheelSpin {
  return {
    spin_id: "s1",
    segments: [
      { id: "kofeynya", weight: 2, name: "Coffee shop", emoji: "☕", category: "Coffee" },
      { id: "karting", weight: 1, name: "Karting", emoji: "🏎️", category: "Speed" },
      { id: "banya", weight: 1, name: "Banya", emoji: "🧖", category: "Relax" },
    ],
    winner_index: 0,
    winner: {
      type: {
        id: "kofeynya",
        name: "Coffee shop",
        emoji: "☕",
        description: "A new coffee place",
        activity_level: 1,
        emotion_level: 2,
        price_level: 1,
        duration_hours: 1,
        setting: "indoor",
      },
      category: { name: "Coffee", emoji: "☕" },
      places: [
        {
          id: "p1",
          name: "Native",
          city: "Saint Petersburg",
          address: "Gribanova 7",
          image_url: null,
          yandex_url: null,
          yandex_rating: 4.8,
          yandex_reviews: 120,
        },
      ],
      maps_url: "https://yandex.ru/maps/?text=coffee",
    },
    spins_used: 1,
    spins_left: 2,
    spins_limit: 3,
    ...extra,
  };
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider apiFactory={factory}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("wheel geometry", () => {
  it("gives named options a wider slice", () => {
    const arcs = wheelArcs([{ weight: 2 }, { weight: 1 }, { weight: 1 }]);
    expect(arcs[0]).toEqual({ start: 0, end: 180, mid: 90 });
    expect(arcs[2]!.end).toBe(360);
  });

  it("lands the winning slice under the pointer after full turns", () => {
    const next = targetRotation(0, 90);
    expect(next).toBe(5 * 360 + 270);
    expect((next + 90) % 360).toBe(0);
    const again = targetRotation(next, 315);
    expect(again).toBeGreaterThan(next + 360 * 4);
    expect((again + 315) % 360).toBe(0);
  });
});

describe("surprise wheel", () => {
  beforeEach(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: "test-token" }));
    vi.restoreAllMocks();
    localStorage.setItem("ealzy.language", "en");
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Moscow",
      locale: "en",
    });
    vi.spyOn(api, "dueExperienceFollowUps").mockResolvedValue([]);
  });

  it("asks what you want, spins, shows places and respins with a reason", async () => {
    vi.spyOn(api, "wheelStatus").mockResolvedValue({
      spins_used: 0,
      spins_left: 3,
      spins_limit: 3,
    });
    const spin = vi
      .spyOn(api, "spinWheel")
      .mockResolvedValueOnce(spinResult())
      .mockResolvedValueOnce(spinResult({ spins_used: 2, spins_left: 1, winner_index: 1 }));
    renderAt("/surprise");

    expect(await screen.findByText("3 of 3 spins left today")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Calm" }));
    await userEvent.click(screen.getByRole("radio", { name: "Two of us" }));
    await userEvent.type(screen.getByPlaceholderText(/coffee, a bar/), "coffee");
    await userEvent.click(screen.getByRole("button", { name: "Spin the wheel" }));

    expect(spin).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mood: "calm",
        company: "pair",
        want: "coffee",
        only_new: true,
        feedback: null,
      }),
    );
    const disc = await screen.findByRole("img", { name: /Coffee shop, Karting, Banya/ });
    await screen.findByText("Spinning…");
    fireEvent.transitionEnd(disc);
    expect(await screen.findByRole("heading", { name: /Coffee shop/ })).toBeInTheDocument();
    expect(screen.getByText("Native")).toBeInTheDocument();
    expect(screen.getByText(/★ 4.8/)).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText(/too pricey/), "too pricey");
    await userEvent.click(screen.getByRole("button", { name: "Spin again · 2 left" }));
    expect(spin).toHaveBeenLastCalledWith(
      expect.objectContaining({ mood: "calm", feedback: "too pricey" }),
    );
  });

  it("likes, finds places nearby and saves a visit with an impression", async () => {
    vi.spyOn(api, "wheelStatus").mockResolvedValue({
      spins_used: 0,
      spins_left: 3,
      spins_limit: 3,
    });
    vi.spyOn(api, "tastes").mockResolvedValue({
      summary: null,
      refreshed_at: null,
      ai_available: false,
      items: [],
    });
    vi.spyOn(api, "spinWheel").mockResolvedValue(
      spinResult({
        winner: { ...spinResult().winner, places: [], reason: "тебе понравилось в прошлый раз" },
      }),
    );
    const setTaste = vi.spyOn(api, "setTaste").mockResolvedValue({
      summary: null,
      refreshed_at: null,
      ai_available: false,
      items: [],
    });
    const candidate = {
      source: "osm" as const,
      source_id: "node/7",
      name: "Flow Coffee",
      address: "Nevsky 1",
      city: null,
      lat: 59.9,
      lon: 30.3,
      rating: null,
      rating_count: null,
      image_url: null,
      photos: [],
      phone: null,
      website: null,
      hours: null,
      twogis_url: null,
      distance_m: 850,
      maps_url: "https://yandex.ru/maps/?text=Flow",
    };
    vi.spyOn(api, "nearbyPlaces").mockResolvedValue({
      city: "Saint Petersburg",
      saved: [],
      found: [candidate],
      source: "osm",
    });
    const savePlace = vi.spyOn(api, "savePlace").mockResolvedValue({});
    renderAt("/surprise");

    await userEvent.click(await screen.findByRole("button", { name: "Spin the wheel" }));
    const disc = await screen.findByRole("img", { name: /Coffee shop/ });
    await screen.findByText("Spinning…");
    fireEvent.transitionEnd(disc);
    expect(await screen.findByText(/тебе понравилось в прошлый раз/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Like/ }));
    expect(setTaste).toHaveBeenLastCalledWith({
      target_kind: "type",
      target_id: "kofeynya",
      verdict: "like",
    });

    await userEvent.click(screen.getByRole("button", { name: "Find near me" }));
    expect(await screen.findByText("Flow Coffee")).toBeInTheDocument();
    expect(screen.getByText(/850 m/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "I've been" }));
    await userEvent.click(screen.getByRole("radio", { name: /Loved it/ }));
    await userEvent.click(screen.getByRole("radio", { name: "5" }));
    await userEvent.type(screen.getByPlaceholderText(/What stuck with you/), "Great flat white");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(savePlace).toHaveBeenCalledWith(candidate, {
      activity_type_id: "kofeynya",
      status: "visited",
      emotion: "wow",
      rating: 5,
      note: "Great flat white",
    });
    expect(await screen.findByText("✓ Been")).toBeInTheDocument();
  });

  it("shows what Ilzi thinks of your taste and lets you take a «never» back", async () => {
    vi.spyOn(api, "wheelStatus").mockResolvedValue({
      spins_used: 0,
      spins_left: 3,
      spins_limit: 3,
    });
    vi.spyOn(api, "tastes").mockResolvedValue({
      summary: "Active team sports suit you; drawing — hardly.",
      refreshed_at: "2026-11-18T10:00:00Z",
      ai_available: true,
      items: [
        {
          target_kind: "type",
          target_id: "voleybol",
          name: "Beach volleyball",
          emoji: "🏐",
          verdict: "like",
          score: 1,
          reason: null,
          source: "you",
        },
        {
          target_kind: "category",
          target_id: "creative",
          name: "Crafts",
          emoji: "🎨",
          verdict: "never",
          score: -1,
          reason: null,
          source: "you",
        },
      ],
    });
    const setTaste = vi.spyOn(api, "setTaste").mockResolvedValue({
      summary: null,
      refreshed_at: null,
      ai_available: true,
      items: [],
    });
    renderAt("/surprise");
    expect(await screen.findByText(/Active team sports suit you/)).toBeInTheDocument();
    expect(screen.getByText(/Beach volleyball/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove «Crafts»" }));
    expect(setTaste).toHaveBeenCalledWith({
      target_kind: "category",
      target_id: "creative",
      verdict: null,
    });
    expect(
      screen.getByRole("button", { name: "Update from what Ilzi knows about me" }),
    ).toBeInTheDocument();
  });

  it("stops after three spins a day", async () => {
    vi.spyOn(api, "wheelStatus").mockResolvedValue({
      spins_used: 3,
      spins_left: 0,
      spins_limit: 3,
    });
    renderAt("/surprise");
    expect(await screen.findByText(/three spins a day/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Spin the wheel" })).toBeDisabled(),
    );
  });

  it("ищет в районе: словами, точкой на карте и с радиусом", async () => {
    localStorage.removeItem("ealzy.wheel.area");
    vi.spyOn(api, "wheelStatus").mockResolvedValue({
      spins_used: 0,
      spins_left: 3,
      spins_limit: 3,
    });
    const geocode = vi.spyOn(api, "geocodePlace").mockImplementation(async (q) =>
      q === "Petrogradka"
        ? { lat: 59.96, lon: 30.31, label: "Петроградский район", city: "Saint Petersburg" }
        : { lat: 59.94, lon: 30.31, label: "Saint Petersburg", city: "Saint Petersburg" },
    );
    const spin = vi.spyOn(api, "spinWheel").mockResolvedValue(spinResult());
    const nearby = vi.spyOn(api, "nearbyPlaces").mockResolvedValue({
      city: "Saint Petersburg",
      saved: [],
      found: [],
      source: "osm",
    });
    renderAt("/surprise");

    await screen.findByText("3 of 3 spins left today");
    await userEvent.type(screen.getByPlaceholderText("My city"), "Saint Petersburg");
    await userEvent.click(screen.getByRole("radio", { name: "Area" }));
    await userEvent.type(screen.getByPlaceholderText("District, metro or address"), "Petrogradka");
    await userEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(geocode).toHaveBeenCalledWith("Petrogradka", "Saint Petersburg");
    expect(await screen.findByText(/Looking around: Petrogradka/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "up to 1 km" }));
    // Тап по карте сдвигает центр, радиус остаётся.
    await waitFor(() => expect(leafletStub.clicks.length).toBeGreaterThan(0));
    leafletStub.clicks.at(-1)!({ latlng: { lat: 59.965, lng: 30.32 } });
    expect(await screen.findByText("Looking around the point on the map.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Spin the wheel" }));
    expect(spin).toHaveBeenLastCalledWith(
      expect.objectContaining({
        area: { lat: 59.965, lon: 30.32, radius_m: 1000, label: null },
      }),
    );
    const disc = await screen.findByRole("img", { name: /Coffee shop/ });
    await screen.findByText("Spinning…");
    fireEvent.transitionEnd(disc);
    // Район задан — места вокруг ищутся сразу.
    await waitFor(() =>
      expect(nearby).toHaveBeenCalledWith(
        expect.objectContaining({ lat: 59.965, lon: 30.32, radius: 1000, type: "kofeynya" }),
      ),
    );
    expect(JSON.parse(localStorage.getItem("ealzy.wheel.area")!)).toMatchObject({ mode: "map" });
  });

  it("«весь город» — без точки; рядом — только по кнопке", async () => {
    localStorage.setItem("ealzy.wheel.area", JSON.stringify({ mode: "city", area: null }));
    vi.spyOn(api, "wheelStatus").mockResolvedValue({
      spins_used: 0,
      spins_left: 3,
      spins_limit: 3,
    });
    const spin = vi.spyOn(api, "spinWheel").mockResolvedValue(spinResult());
    renderAt("/surprise");
    await screen.findByText("3 of 3 spins left today");
    expect(screen.getByRole("radio", { name: "Whole city" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "Spin the wheel" }));
    expect(spin).toHaveBeenLastCalledWith(expect.objectContaining({ area: null }));
    const disc = await screen.findByRole("img", { name: /Coffee shop/ });
    await screen.findByText("Spinning…");
    fireEvent.transitionEnd(disc);
    expect(await screen.findByRole("button", { name: "Find near me" })).toBeInTheDocument();
  });
});
