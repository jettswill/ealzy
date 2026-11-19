import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import { resetActivityCatalogCache } from "../src/modules/assistant/activities.js";
import {
  feedbackFilters,
  typesNamedIn,
  weightedIndex,
  wheelPool,
  wheelSegments,
  type WheelRequest,
} from "../src/modules/assistant/wheel.js";
import type { ActivityCatalog, ActivityType } from "../src/types.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";

const sessionSecret = "session-secret-at-least-thirty-two-characters";
const env = {
  CORS_ORIGIN: "*",
  TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyz",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret-at-least-sixteen",
  TELEGRAM_MINI_APP_URL: "https://example.com/app",
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: 300,
  TELEGRAM_LOGIN_MAX_AGE_SECONDS: 86_400,
  SESSION_SECRET: sessionSecret,
  SESSION_TTL_SECONDS: 900,
};
const telegram: TelegramGateway = {
  async sendMessage() {},
  async answerCallbackQuery() {},
};

function type(id: string, category: string, extra: Partial<ActivityType> = {}): ActivityType {
  return {
    id,
    category_id: category,
    name: id,
    emoji: "✨",
    description: null,
    activity_level: 2,
    emotion_level: 3,
    price_level: 2,
    duration_hours: 2,
    season: "all",
    setting: "indoor",
    min_people: 1,
    kids_ok: false,
    search_query: null,
    geo: "любой крупный город",
    sort: 0,
    ...extra,
  };
}

const types = [
  type("kofeynya", "coffee-tea", { name: "Кофейня, где ещё не был", search_query: "кофейня" }),
  type("speshelti", "coffee-tea", { name: "Спешелти-кофейня", search_query: "спешелти кофе" }),
  type("chaynaya", "coffee-tea", { name: "Чайная" }),
  type("karting", "speed", { name: "Картинг", activity_level: 3, emotion_level: 4 }),
  type("parashyut", "sky", {
    name: "Прыжок с парашютом",
    activity_level: 3,
    emotion_level: 5,
    price_level: 4,
    duration_hours: 4,
    season: "warm",
    setting: "outdoor",
    geo: "загород",
  }),
  type("bokс", "sport-try", { id: "boks", name: "Бокс", activity_level: 5, emotion_level: 4 }),
  type("muzey", "museums-tours", { name: "Музей", kids_ok: true }),
  type("mafiya", "games", { name: "Мафия", activity_level: 1, emotion_level: 4, min_people: 6 }),
  type("banya", "relax", { name: "Баня", activity_level: 1, emotion_level: 3, price_level: 3 }),
  type("park", "parks-walks", { name: "Парк", setting: "outdoor", price_level: 1, kids_ok: true }),
];
const catalog: ActivityCatalog = {
  categories: [
    { id: "coffee-tea", name: "Кофейни", emoji: "☕", sort: 0 },
    { id: "speed", name: "Скорость", emoji: "🏎️", sort: 1 },
  ],
  types,
};

const ask = (extra: Partial<WheelRequest> = {}): WheelRequest => ({
  mood: "any",
  want: null,
  when: "today",
  company: "solo",
  city: null,
  only_new: false,
  feedback: null,
  ...extra,
});
const none = new Set<string>();
const pool = (request: WheelRequest, extra: Partial<Parameters<typeof wheelPool>[0]> = {}) =>
  wheelPool({
    types,
    request,
    month: 11,
    tried: none,
    skipped: none,
    wonToday: none,
    last: null,
    ...extra,
  }).map((t) => t.id);

beforeEach(() => resetActivityCatalogCache());

describe("wheel pool", () => {
  it("follows the mood", () => {
    expect(pool(ask({ mood: "calm" }))).toEqual(
      expect.arrayContaining(["kofeynya", "muzey", "banya", "park"]),
    );
    expect(pool(ask({ mood: "calm" }))).not.toContain("karting");
    expect(pool(ask({ mood: "active" }))).toEqual(expect.arrayContaining(["karting", "boks"]));
    expect(pool(ask({ mood: "active" }))).not.toContain("muzey");
  });

  it("narrows to what they named, else to its category", () => {
    const coffee = pool(ask({ want: "хочу в кофейню" }));
    // Названное — первым, остальное колесо добирают похожие.
    expect(coffee.slice(0, 2).sort()).toEqual(["kofeynya", "speshelti"]);
    expect(coffee).toHaveLength(4);
    expect(coffee[2]).toBe("chaynaya");
    expect(typesNamedIn("картинг", types).map((t) => t.id)).toEqual(["karting"]);
    expect(pool(ask({ want: "что-нибудь с десертами" }))).toEqual(
      expect.arrayContaining(["kofeynya", "speshelti", "chaynaya"]),
    );
  });

  it("respects season, time, company and «only new»", () => {
    expect(pool(ask({ when: "weekend" }))).not.toContain("parashyut"); // ноябрь
    expect(pool(ask({ company: "solo" }))).not.toContain("mafiya");
    expect(pool(ask({ company: "friends" }))).toContain("mafiya");
    expect(pool(ask({ company: "kids" })).sort()).toEqual(["muzey", "park"]);
    expect(pool(ask({ only_new: true }), { tried: new Set(["muzey"]) })).not.toContain("muzey");
    expect(pool(ask({ only_new: false }), { tried: new Set(["muzey"]) })).toContain("muzey");
  });

  it("never puts today's earlier result back on the wheel", () => {
    expect(pool(ask(), { wonToday: new Set(["banya"]) })).not.toContain("banya");
  });
});

describe("why they spin again", () => {
  const banya = types.find((t) => t.id === "banya")!;
  it("turns words into filters", () => {
    const f = feedbackFilters("дорого и далеко, а на улице холодно", banya);
    expect(f.maxPrice).toBe(2);
    expect(f.nearOnly).toBe(true);
    expect(f.indoorOnly).toBe(true);
    expect(feedbackFilters("скучно", banya).minEmotion).toBe(4);
    expect(feedbackFilters("устал, лень", banya).maxActivity).toBe(2);
    expect(feedbackFilters("не люблю такое", banya).excludeCategories.has("relax")).toBe(true);
  });

  it("drops the previous pick's whole category when it was «не то»", () => {
    const result = pool(ask({ feedback: "не то, хочу другое" }), {
      last: types.find((t) => t.id === "kofeynya")!,
    });
    expect(result.some((id) => ["kofeynya", "speshelti", "chaynaya"].includes(id))).toBe(false);
  });

  it("picks fairly by weight", () => {
    expect(weightedIndex([2, 1, 1], () => 0.49)).toBe(0);
    expect(weightedIndex([2, 1, 1], () => 0.51)).toBe(1);
    expect(weightedIndex([2, 1, 1], () => 0.99)).toBe(2);
  });

  it("keeps the wheel varied", () => {
    const segments = wheelSegments(types, () => 0.3);
    expect(segments.length).toBe(8);
    const coffee = segments.filter((t) => t.category_id === "coffee-tea");
    expect(coffee.length).toBeLessThanOrEqual(2);
  });
});

describe("wheel API", () => {
  async function setup() {
    const repository = new InMemoryRepository();
    repository.activityCatalog = catalog;
    repository.places = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Кофе на Невском",
        city: "Санкт-Петербург",
        address: "Невский, 1",
        lat: null,
        lon: null,
        description: null,
        image_url: null,
        photos: [],
        phone: null,
        website: null,
        hours: null,
        price_from: null,
        yandex_org_id: null,
        yandex_url: null,
        yandex_rating: 4.8,
        yandex_reviews: 120,
        twogis_url: null,
        source: "test",
        activity_type_ids: ["kofeynya"],
      },
    ];
    const app = createApp({ repository, telegram, env });
    const user = await repository.upsertTelegramUser({ telegram_id: 501, name: "Андрей" });
    const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
    return { repository, app, auth, user };
  }

  it("spins three times a day and remembers why", async () => {
    const { app, auth, repository } = await setup();
    const status = await request(app).get("/api/activities/wheel").set(auth);
    expect(status.body.data).toMatchObject({ spins_left: 3, spins_limit: 3 });

    const first = await request(app)
      .post("/api/activities/wheel")
      .set(auth)
      .send({ want: "кофейня", city: "Санкт-Петербург" });
    expect(first.status).toBe(201);
    const data = first.body.data;
    expect(data.segments[data.winner_index].id).toBe(data.winner.type.id);
    // Названное занимает на колесе вдвое больше места, добивка — по одной доле.
    const weights = Object.fromEntries(
      data.segments.map((s: { id: string; weight: number }) => [s.id, s.weight]),
    );
    expect(weights).toMatchObject({ kofeynya: 2, speshelti: 2 });
    expect(data.segments.length).toBe(4);
    expect(data.spins_left).toBe(2);

    const second = await request(app)
      .post("/api/activities/wheel")
      .set(auth)
      .send({ mood: "calm", feedback: "дорого" });
    expect(second.status).toBe(201);
    expect(second.body.data.winner.type.id).not.toBe(data.winner.type.id);
    expect(repository.activitySpins.at(-1)?.feedback).toBe("дорого");

    await request(app).post("/api/activities/wheel").set(auth).send({}).expect(201);
    const fourth = await request(app).post("/api/activities/wheel").set(auth).send({});
    expect(fourth.status).toBe(429);
    expect(fourth.body.error?.code ?? fourth.body.code).toBe("WHEEL_LIMIT");
  });

  it("does not spend a spin when nothing fits", async () => {
    const { app, auth } = await setup();
    // Детские варианты в каталоге только спокойные — «активное с детьми» пусто.
    const res = await request(app)
      .post("/api/activities/wheel")
      .set(auth)
      .send({ mood: "active", company: "kids" });
    expect(res.status).toBe(422);
    const status = await request(app).get("/api/activities/wheel").set(auth);
    expect(status.body.data.spins_left).toBe(3);
  });

  it("lets the founder spin without a limit", async () => {
    const { app, auth, repository, user } = await setup();
    repository.admins.push(user.id);
    for (let i = 0; i < 4; i += 1)
      await request(app).post("/api/activities/wheel").set(auth).send({}).expect(201);
  });
});

describe("wheel around a point", () => {
  const place = (id: string, name: string, lat: number | null, lon: number | null) => ({
    id,
    name,
    city: "Санкт-Петербург",
    address: null,
    lat,
    lon,
    description: null,
    image_url: null,
    photos: [],
    phone: null,
    website: null,
    hours: null,
    price_from: null,
    yandex_org_id: null,
    yandex_url: null,
    yandex_rating: null,
    yandex_reviews: null,
    twogis_url: null,
    source: "test",
    activity_type_ids: ["kofeynya"],
  });

  async function setup(
    geocoder?: (
      text: string,
      city: string | null,
    ) => Promise<null | {
      lat: number;
      lon: number;
      label: string;
    }>,
  ) {
    resetActivityCatalogCache();
    const repository = new InMemoryRepository();
    repository.activityCatalog = catalog;
    repository.places = [
      place("11111111-1111-4111-8111-111111111111", "Далеко, в Купчино", 59.83, 30.38),
      place("22222222-2222-4222-8222-222222222222", "Рядом, на Петроградке", 59.962, 30.311),
      place("33333333-3333-4333-8333-333333333333", "Чуть дальше", 59.97, 30.3),
      place("44444444-4444-4444-8444-444444444444", "Без координат", null, null),
    ];
    const app = createApp({ repository, telegram, env, placeGeocoder: geocoder });
    const user = await repository.upsertTelegramUser({ telegram_id: 777, name: "Андрей" });
    const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
    return { app, auth };
  }

  it("берёт места в радиусе по расстоянию, а карты открывает на точке", async () => {
    const { app, auth } = await setup();
    const response = await request(app)
      .post("/api/activities/wheel")
      .set(auth)
      .send({
        want: "кофейня",
        city: "Санкт-Петербург",
        area: { lat: 59.9615, lon: 30.3115, radius_m: 3_000, label: "Петроградка" },
      });
    expect(response.status).toBe(201);
    const winner = response.body.data.winner;
    if (winner.type.id !== "kofeynya") return; // выпал сосед по кофе — мест у него нет
    expect(winner.places.map((p: { name: string }) => p.name)).toEqual([
      "Рядом, на Петроградке",
      "Чуть дальше",
    ]);
    expect(winner.places[0].distance_m).toBeLessThan(200);
    expect(winner.maps_url).toContain("ll=30.31150%2C59.96150");
  });

  it("отклоняет кривой радиус", async () => {
    const { app, auth } = await setup();
    const response = await request(app)
      .post("/api/activities/wheel")
      .set(auth)
      .send({ area: { lat: 59.96, lon: 30.31, radius_m: 100_000 } });
    expect(response.status).toBe(400);
  });

  it("находит район словами", async () => {
    const calls: [string, string | null][] = [];
    const { app, auth } = await setup(async (text, city) => {
      calls.push([text, city]);
      return text.includes("Чкаловская") ? { lat: 59.961, lon: 30.292, label: "Чкаловская" } : null;
    });
    const found = await request(app)
      .get("/api/places/geocode")
      .query({ q: "м. Чкаловская", city: "Санкт-Петербург" })
      .set(auth);
    expect(found.body.data).toEqual({
      lat: 59.961,
      lon: 30.292,
      label: "Чкаловская",
      city: "Санкт-Петербург",
    });
    const missing = await request(app)
      .get("/api/places/geocode")
      .query({ q: "Нигдебург", city: "Санкт-Петербург" })
      .set(auth);
    expect(missing.status).toBe(404);
    expect(calls).toEqual([
      ["м. Чкаловская", "Санкт-Петербург"],
      ["Нигдебург", "Санкт-Петербург"],
    ]);
  });
});
