import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api";
import { App } from "../App";
import { AuthProvider, SESSION_KEY } from "../auth";
import type { WheelSpin } from "../types";
import type * as WheelPhysics from "../wheelPhysics";
import {
  flapperAngle,
  planSpin,
  simulateSpin,
  slotAt,
  wheelSlots,
  type SpinTrack,
} from "../wheelPhysics";

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

// В тестах интерфейса колесо останавливается за пару кадров: физику проверяем отдельно.
const quick = vi.hoisted(() => ({ on: true }));
vi.mock("../wheelPhysics", async (importOriginal) => {
  const real = await importOriginal<typeof WheelPhysics>();
  const short = (slots: { segment: number }[], from: number, segment: number): SpinTrack => {
    const slot = Math.max(
      0,
      slots.findIndex((s) => s.segment === segment),
    );
    return { frames: [from, from + 5, from + 10], ticks: [1], slot };
  };
  return {
    ...real,
    planSpin: (...args: Parameters<typeof real.planSpin>) =>
      quick.on ? short(args[0], args[1], args[2]) : real.planSpin(...args),
    easedSpin: (...args: Parameters<typeof real.easedSpin>) =>
      quick.on ? short(args[0], args[1], args[2]) : real.easedSpin(...args),
  };
});

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

describe("wheel physics", () => {
  it("repeats options around the circle, slice by weight", () => {
    const slots = wheelSlots([2, 1, 1]);
    expect(slots.length).toBeGreaterThanOrEqual(18);
    expect(slots[0]!.end - slots[0]!.start).toBeCloseTo(2 * (slots[1]!.end - slots[1]!.start));
    expect(slots.at(-1)!.end).toBe(360);
  });

  it("stops by itself on the option the server picked — with pegs and a bounce", () => {
    quick.on = false;
    const slots = wheelSlots([2, 1, 1, 3, 1, 1]);
    let from = 0;
    for (const segment of [0, 1, 2, 3, 4, 5, 3]) {
      const track = planSpin(slots, from, segment, () => 0.5);
      const end = track.frames.at(-1)!;
      expect(slots[slotAt(slots, end)]!.segment).toBe(segment);
      expect(track.frames.length / 60).toBeGreaterThan(3.5);
      expect(end - from).toBeGreaterThan(360 * 2);
      expect(track.ticks.length).toBeGreaterThan(20);
      from = end;
    }
    quick.on = true;
  });

  it("slows down: each peg takes the same energy, the last ones visibly", () => {
    quick.on = false;
    const slots = wheelSlots([1, 1, 1, 1, 1, 1]);
    const { frames } = simulateSpin(slots, 0, 700);
    const speed = (i: number) => (frames[i]! - frames[i - 1]!) * 60;
    expect(speed(5)).toBeGreaterThan(speed(frames.length - 40));
    // В конце — откат от колышка: колесо чуть-чуть идёт назад.
    expect(frames.at(-1)!).toBeLessThan(Math.max(...frames.slice(-15)));
    quick.on = true;
  });

  it("bends the flapper only next to a peg", () => {
    const slots = wheelSlots([1, 1, 1, 1, 1, 1]);
    const peg = slots[1]!.start;
    // Колышек за 2° до стрелки: угол на экране = 358°.
    expect(flapperAngle(slots, 358 - peg)).toBeGreaterThan(5);
    const middle = (slots[1]!.start + slots[1]!.end) / 2;
    expect(flapperAngle(slots, 360 - middle)).toBe(0);
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

  it("asks what you want, spins, then «I'm going» shows places", async () => {
    vi.spyOn(api, "wheelStatus").mockResolvedValue({
      spins_used: 0,
      spins_left: 3,
      spins_limit: 3,
    });
    const spin = vi.spyOn(api, "spinWheel").mockResolvedValueOnce(spinResult());
    const going = vi.spyOn(api, "goingWheel").mockResolvedValue({});
    const nearby = vi.spyOn(api, "nearbyPlaces").mockResolvedValue({
      city: "Saint Petersburg",
      saved: [
        {
          ...spinResult().winner.places[0]!,
          rating: 4.8,
          rating_count: 120,
          phone: "+7 (812) 111-22-33",
          website: "native.coffee",
          lat: 59.93,
          lon: 30.31,
        },
      ],
      found: [],
      source: "2gis",
    });
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
    expect(
      await screen.findByRole("img", { name: /Coffee shop, Karting, Banya/ }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /Coffee shop/ })).toBeInTheDocument();
    // Главное действие — «Пойду», а не «крутить ещё».
    expect(screen.queryByRole("button", { name: /Spin again/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "I'm going" }));
    // Сами ищем рядом — без кнопки «найти»; карточка с контактами и маршрутом.
    expect(await screen.findByText("Native")).toBeInTheDocument();
    expect(nearby).toHaveBeenCalledWith(expect.objectContaining({ type: "kofeynya" }));
    expect(going).toHaveBeenCalledWith("s1", "kofeynya");
    expect(screen.getByText(/★ 4.8/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Call/ })).toHaveAttribute("href", "tel:+78121112233");
    expect(screen.getByRole("link", { name: /Website/ })).toHaveAttribute(
      "href",
      "https://native.coffee",
    );
    expect(screen.getByRole("link", { name: /Route/ })).toHaveAttribute(
      "href",
      "https://yandex.ru/maps/?rtext=~59.93,30.31",
    );
    expect(screen.getByRole("button", { name: "Go here" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No, let's look some more" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Spin again/ })).not.toBeInTheDocument();
  });

  it("«Look for more»: what's wrong, settings, spin again", async () => {
    vi.spyOn(api, "wheelStatus").mockResolvedValue({
      spins_used: 0,
      spins_left: 3,
      spins_limit: 3,
    });
    const spin = vi
      .spyOn(api, "spinWheel")
      .mockResolvedValueOnce(spinResult())
      .mockResolvedValueOnce(
        spinResult({
          spins_used: 2,
          spins_left: 1,
          winner_index: 1,
          winner: {
            ...spinResult().winner,
            type: { ...spinResult().winner.type, id: "karting", name: "Karting", emoji: "🏎️" },
          },
        }),
      );
    const setTaste = vi.spyOn(api, "setTaste").mockResolvedValue({
      summary: null,
      refreshed_at: null,
      ai_available: false,
      items: [],
    });
    renderAt("/surprise");
    await userEvent.click(await screen.findByRole("button", { name: "Spin the wheel" }));
    await userEvent.click(await screen.findByRole("button", { name: "Look for more" }));

    await userEvent.click(screen.getByRole("button", { name: "Too pricey" }));
    await userEvent.click(screen.getByRole("button", { name: /Never suggest/ }));
    expect(setTaste).toHaveBeenLastCalledWith({
      target_kind: "type",
      target_id: "kofeynya",
      verdict: "never",
    });
    await userEvent.type(screen.getByPlaceholderText(/too pricey, too far/), "rainy today");
    await userEvent.click(screen.getByRole("button", { name: "Change request" }));
    await userEvent.click(screen.getByRole("radio", { name: "Active" }));
    await userEvent.click(screen.getByRole("button", { name: "Spin again · 2 left" }));
    expect(spin).toHaveBeenLastCalledWith(
      expect.objectContaining({ mood: "active", feedback: "дорого, rainy today" }),
    );
    expect(await screen.findByRole("heading", { name: /Karting/ })).toBeInTheDocument();
  });

  it("«Go here» → when → it's on the calendar", async () => {
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
    const candidate = {
      source: "osm" as const,
      source_id: "node/7",
      name: "Flow Coffee",
      address: "Nevsky 1",
      city: null,
      lat: 59.9,
      lon: 30.3,
      rating: 4.6,
      rating_count: 40,
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
    vi.spyOn(api, "goingWheel").mockResolvedValue({});
    const plan = vi.spyOn(api, "planOuting").mockImplementation(async (_place, _type, when) => ({
      place: { id: "p9", name: "Flow Coffee", city: null, address: "Nevsky 1", image_url: null, yandex_url: null, yandex_rating: null, yandex_reviews: null },
      visit: { id: "v1", planned_for: when, task_id: "t1" },
      task: { id: "t1", title: "Coffee shop: Flow Coffee", due_at: when, estimate_minutes: 60, description: null },
    }));
    renderAt("/surprise");

    await userEvent.click(await screen.findByRole("button", { name: "Spin the wheel" }));
    expect(await screen.findByText(/тебе понравилось в прошлый раз/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "I'm going" }));

    expect(await screen.findByText("Flow Coffee")).toBeInTheDocument();
    expect(screen.getByText(/850 m/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Go here" }));
    expect(screen.getByText("When are you going?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tomorrow evening" }));
    expect(plan).toHaveBeenCalledWith({ candidate }, "kofeynya", expect.any(String));
    const when = new Date(plan.mock.calls[0]![2]!);
    expect(when.getHours()).toBe(19);
    expect(await screen.findByText(/On the calendar:/)).toBeInTheDocument();
    // Выбрал — остальные места прячем, можно вернуться к списку.
    expect(screen.getByRole("button", { name: "Another place" })).toBeInTheDocument();
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
    const geocode = vi
      .spyOn(api, "geocodePlace")
      .mockImplementation(async (q) =>
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

    vi.spyOn(api, "cities").mockResolvedValue([
      { name: "Saint Petersburg", title: "Saint Petersburg", region: null, lat: 59.94, lon: 30.31 },
    ]);
    const saveCity = vi.spyOn(api, "saveMyCity").mockResolvedValue({ city: "Saint Petersburg" });
    await screen.findByText("3 of 3 spins left today");
    await userEvent.type(screen.getByPlaceholderText("My city"), "Saint");
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Saint Petersburg/ }));
    expect(saveCity).toHaveBeenCalledWith("Saint Petersburg");
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
    await userEvent.click(await screen.findByRole("button", { name: "I'm going" }));
    // Район задан — места вокруг ищутся сразу.
    await waitFor(() =>
      expect(nearby).toHaveBeenCalledWith(
        expect.objectContaining({ lat: 59.965, lon: 30.32, radius: 1000, type: "kofeynya" }),
      ),
    );
    expect(JSON.parse(localStorage.getItem("ealzy.wheel.area")!)).toMatchObject({ mode: "map" });
  });

  it("«весь город» — колесо без точки, места после «Пойду» — по городу", async () => {
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
    vi.spyOn(api, "goingWheel").mockResolvedValue({});
    const nearby = vi
      .spyOn(api, "nearbyPlaces")
      .mockResolvedValue({ city: "Saint Petersburg", saved: [], found: [], source: "2gis" });
    await userEvent.click(await screen.findByRole("button", { name: "I'm going" }));
    await waitFor(() =>
      expect(nearby).toHaveBeenCalledWith(expect.objectContaining({ lat: undefined, type: "kofeynya" })),
    );
    expect(await screen.findByText(/Found nothing nearby/)).toBeInTheDocument();
  });

  it("город — свой из базы, чужое название не проходит", async () => {
    vi.spyOn(api, "wheelStatus").mockResolvedValue({
      spins_used: 0,
      spins_left: 3,
      spins_limit: 3,
      city: "Kazan",
      city_guess: "Moscow",
    });
    vi.spyOn(api, "cities").mockResolvedValue([]);
    vi.spyOn(api, "saveMyCity").mockRejectedValue(
      Object.assign(new Error("Не знаю такой город"), { status: 422 }),
    );
    const spin = vi.spyOn(api, "spinWheel").mockResolvedValue(spinResult());
    renderAt("/surprise");
    const input = await screen.findByPlaceholderText("My city");
    await waitFor(() => expect(input).toHaveValue("Kazan"));
    await userEvent.clear(input);
    await userEvent.type(input, "Sunkt-Pieterburg");
    await userEvent.tab();
    expect(await screen.findByText(/Pick a city from the list/)).toBeInTheDocument();
    expect(input).toHaveValue("Kazan");
    await userEvent.click(screen.getByRole("button", { name: "Spin the wheel" }));
    expect(spin).toHaveBeenLastCalledWith(expect.objectContaining({ city: "Kazan" }));
  });

  it("без подписки — что внутри и «Хочу подписку»", async () => {
    vi.spyOn(api, "wheelStatus").mockResolvedValue({
      spins_used: 0,
      spins_left: 3,
      spins_limit: 3,
      subscribed: false,
    });
    const ask = vi.spyOn(api, "requestSubscription").mockResolvedValue({});
    renderAt("/surprise");
    expect(await screen.findByText("Going out is in the subscription")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spin the wheel" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "I want it" }));
    expect(ask).toHaveBeenCalledWith("surprise");
    expect(screen.getByText(/Noted!/)).toBeInTheDocument();
  });

  it("«Досуг» — в нижнем меню рядом с Илзи", async () => {
    vi.spyOn(api, "wheelStatus").mockResolvedValue({
      spins_used: 0,
      spins_left: 3,
      spins_limit: 3,
    });
    renderAt("/surprise");
    const link = await screen.findByRole("link", { name: "Going out" });
    expect(link).toHaveAttribute("href", "/surprise");
  });
});
