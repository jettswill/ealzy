import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { SubscribedRepository } from "./subscribed.js";
import { createSession } from "../src/modules/auth/index.js";
import { resetActivityCatalogCache } from "../src/modules/assistant/activities.js";
import {
  inferenceFromLocal,
  needsTasteRefresh,
  sanitizeInference,
  tasteFor,
  tasteIndex,
  tasteMultiplier,
  visitSignal,
  type TasteEvidence,
} from "../src/modules/assistant/tastes.js";
import { osmFilters, searchOsm, type PlaceSearch } from "../src/modules/assistant/place-search.js";
import type {
  ActivityCatalog,
  ActivityPreference,
  ActivityType,
  PlaceCandidate,
} from "../src/types.js";
import type { TelegramGateway } from "../src/infrastructure/telegram.js";
import type { AiProvider } from "../src/modules/assistant/index.js";

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
    activity_level: 3,
    emotion_level: 3,
    price_level: 2,
    duration_hours: 2,
    season: "all",
    setting: "indoor",
    min_people: 1,
    kids_ok: false,
    search_query: id,
    geo: "любой крупный город",
    sort: 0,
    ...extra,
  };
}
const catalog: ActivityCatalog = {
  categories: [
    { id: "creative", name: "Творчество", emoji: "🎨", sort: 0 },
    { id: "sport-try", name: "Спорт", emoji: "🏐", sort: 1 },
    { id: "water", name: "Вода", emoji: "🌊", sort: 2 },
  ],
  types: [
    type("zhivopis", "creative", { name: "Живопись", activity_level: 1 }),
    type("goncharka", "creative", { name: "Гончарный мастер-класс", activity_level: 1 }),
    type("voleybol", "sport-try", { name: "Пляжный волейбол", search_query: "пляжный волейбол" }),
    type("futbol", "sport-try", { name: "Мини-футбол" }),
    type("volna", "water", {
      name: "Сёрфинг на искусственной волне",
      search_query: "искусственная волна",
    }),
  ],
};
const pref = (p: Partial<ActivityPreference>): ActivityPreference => ({
  owner_id: "u",
  target_kind: "type",
  target_id: "x",
  verdict: null,
  visit_affinity: 0,
  ai_affinity: 0,
  ai_reason: null,
  updated_at: "2026-11-18T10:00:00Z",
  ...p,
});

beforeEach(() => resetActivityCatalogCache());

describe("taste scoring", () => {
  const goncharka = catalog.types[1]!;
  const zhivopis = catalog.types[0]!;
  it("never hides a type, a category «never» hides its types unless one is liked", () => {
    const index = tasteIndex([
      pref({ target_kind: "category", target_id: "creative", verdict: "never" }),
      pref({ target_id: "goncharka", verdict: "like" }),
    ]);
    expect(tasteFor(zhivopis, index).never).toBe(true);
    expect(tasteFor(goncharka, index)).toMatchObject({ never: false, liked: true, score: 1 });
  });

  it("learns from visits and AI guesses, with reasons", () => {
    const index = tasteIndex([
      pref({ target_id: "volna", visit_affinity: 0.7 }),
      pref({
        target_kind: "category",
        target_id: "creative",
        ai_affinity: -0.6,
        ai_reason: "ты не любишь рисовать",
      }),
    ]);
    const volna = tasteFor(catalog.types[4]!, index);
    expect(volna.score).toBeCloseTo(0.7);
    expect(volna.reason).toBe("тебе понравилось в прошлый раз");
    const paint = tasteFor(zhivopis, index);
    expect(paint.score).toBeLessThan(0);
    expect(paint.never).toBe(false);
    expect(paint.reason).toBe("ты не любишь рисовать");
    expect(tasteMultiplier(1)).toBeCloseTo(3, 0);
    expect(tasteMultiplier(-1)).toBeCloseTo(0.33, 1);
  });

  it("turns a rating and an emotion into a signal", () => {
    expect(visitSignal(5, "wow")).toBeCloseTo(0.85);
    expect(visitSignal(null, "bad")).toBe(-0.8);
    expect(visitSignal(null, null)).toBeNull();
  });

  it("asks the AI again only when there is something new", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    expect(needsTasteRefresh(null, null, now)).toBe(true);
    expect(needsTasteRefresh("2026-11-18T09:00:00Z", "2026-11-17T09:00:00Z", now)).toBe(false);
    expect(needsTasteRefresh("2026-11-18T09:00:00Z", "2026-11-18T10:00:00Z", now)).toBe(true);
    expect(needsTasteRefresh("2026-11-18T11:50:00Z", "2026-11-18T11:55:00Z", now)).toBe(false);
    expect(needsTasteRefresh("2026-10-01T09:00:00Z", null, now)).toBe(true);
  });

  it("keeps only catalog ids from the AI and caps its confidence", () => {
    const clean = sanitizeInference(
      {
        summary: "Тебе подходит активное и командное.",
        hypotheses: [
          { target_kind: "category", target_id: "sport-try", affinity: 1, reason: "любишь футбол" },
          { target_kind: "type", target_id: "nope", affinity: 0.5, reason: "?" },
          { target_kind: "type", target_id: "volna", affinity: 0.4, reason: "похоже на сёрф" },
        ],
      },
      catalog,
    );
    expect(clean?.hypotheses.map((h) => h.target_id)).toEqual(["sport-try", "volna"]);
    expect(clean?.hypotheses[0]?.affinity).toBe(0.8);
  });
});

describe("place search", () => {
  it("maps common types to OpenStreetMap tags", () => {
    expect(
      osmFilters({ id: "k", name: "Кофейня, где ещё не был", search_query: "кофейня" }),
    ).toEqual(['["amenity"="cafe"]']);
    expect(
      osmFilters({ id: "b", name: "Барабаны: пробный урок", search_query: "уроки барабанов" }),
    ).toBeNull();
    expect(
      osmFilters({ id: "w", name: "Коктейльный бар", search_query: "коктейльный бар" })?.[0],
    ).toBe('["amenity"="bar"]');
  });

  it("finds places around the point and sorts them by distance", async () => {
    const fetcher = (async (url: string) => {
      expect(String(url)).toContain("overpass");
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: "node",
              id: 2,
              lat: 59.95,
              lon: 30.32,
              tags: { name: "Дальняя", "addr:street": "Невский" },
            },
            { type: "node", id: 1, lat: 59.9392, lon: 30.3159, tags: { name: "Ближняя" } },
            { type: "node", id: 3, lat: 59.94, lon: 30.31, tags: {} },
          ],
        }),
      );
    }) as typeof fetch;
    const found = await searchOsm(
      {
        type: { id: "k", name: "Кофейня", search_query: "кофейня" },
        lat: 59.9391,
        lon: 30.3158,
        city: "СПб",
      },
      fetcher,
    );
    expect(found.map((p) => p.name)).toEqual(["Ближняя", "Дальняя"]);
    expect(found[0]?.distance_m).toBeLessThan(50);
    expect(found[0]?.source_id).toBe("node/1");
  });
});

describe("tastes API", () => {
  const candidate: PlaceCandidate = {
    source: "osm",
    source_id: "node/42",
    name: "Flow Surf",
    address: "Благодатная, 63",
    city: "Санкт-Петербург",
    lat: 59.88,
    lon: 30.32,
    rating: null,
    rating_count: null,
    image_url: null,
    photos: [],
    phone: null,
    website: null,
    hours: null,
    twogis_url: null,
    distance_m: 1200,
    maps_url: "https://yandex.ru/maps/?text=Flow",
  };
  async function setup(ai?: AiProvider) {
    const repository = new SubscribedRepository();
    repository.activityCatalog = catalog;
    const placeSearch: PlaceSearch = { nearby: async () => [candidate] };
    const app = createApp({ repository, telegram, env, placeSearch, ai });
    const user = await repository.upsertTelegramUser({ telegram_id: 601, name: "Андрей" });
    const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
    return { repository, app, auth, user };
  }

  it("likes, «never» and both show up in tastes and on the wheel", async () => {
    const { app, auth } = await setup();
    await request(app)
      .put("/api/activities/tastes")
      .set(auth)
      .send({ target_kind: "category", target_id: "creative", verdict: "never" })
      .expect(200);
    const liked = await request(app)
      .put("/api/activities/tastes")
      .set(auth)
      .send({ target_kind: "type", target_id: "voleybol", verdict: "like" })
      .expect(200);
    expect(liked.body.data.items.map((i: { target_id: string }) => i.target_id)).toEqual([
      "voleybol",
      "creative",
    ]);
    for (let i = 0; i < 3; i += 1) {
      const spin = await request(app).post("/api/activities/wheel").set(auth).send({});
      const ids = spin.body.data.segments.map((s: { id: string }) => s.id);
      expect(ids).not.toContain("zhivopis");
      expect(ids).not.toContain("goncharka");
      const volley = spin.body.data.segments.find((s: { id: string }) => s.id === "voleybol");
      if (volley) expect(volley).toMatchObject({ liked: true });
      if (volley) expect(volley.weight).toBeGreaterThan(2.5);
    }
  });

  it("finds places nearby without saving, and saves one only when visited", async () => {
    const { app, auth, repository } = await setup();
    const nearby = await request(app)
      .get("/api/places/nearby")
      .query({ type: "volna", lat: 59.9, lon: 30.3 })
      .set(auth)
      .expect(200);
    expect(nearby.body.data.found).toHaveLength(1);
    expect(repository.places).toHaveLength(0);

    const saved = await request(app)
      .post("/api/places/save")
      .set(auth)
      .send({
        candidate,
        activity_type_id: "volna",
        status: "visited",
        rating: 5,
        emotion: "wow",
        note: "Огонь",
      })
      .expect(201);
    expect(repository.places).toHaveLength(1);
    expect(saved.body.data.place.activity_type_ids).toEqual(["volna"]);
    expect(saved.body.data.visit).toMatchObject({ status: "visited", rating: 5, emotion: "wow" });

    // Визит научил: волна теперь «понравилось в прошлый раз».
    const tastes = await request(app).get("/api/activities/tastes").set(auth);
    const volna = tastes.body.data.items.find(
      (i: { target_id: string }) => i.target_id === "volna",
    );
    expect(volna.score).toBeGreaterThan(0.4);
    expect(volna.source).toBe("visits");

    // Теперь место известно Ealzy — второй раз оно в «saved», а не в «found».
    const again = await request(app)
      .get("/api/places/nearby")
      .query({ type: "volna", lat: 59.9, lon: 30.3 })
      .set(auth);
    expect(again.body.data.saved[0]).toMatchObject({ name: "Flow Surf", my_status: "visited" });
    expect(again.body.data.found).toHaveLength(0);
  });

  it("asks the AI for hypotheses from what Ilzi knows", async () => {
    let seen: TasteEvidence | null = null;
    const ai = {
      async decide() {
        return {};
      },
      async recommend() {
        return {};
      },
      async inferActivityTastes(evidence: TasteEvidence) {
        seen = evidence;
        return {
          summary: "Тебе подходит активное и командное, творчество — вряд ли.",
          hypotheses: [
            {
              target_kind: "category" as const,
              target_id: "creative",
              affinity: -0.6,
              reason: "ты не любишь рисовать",
            },
            {
              target_kind: "category" as const,
              target_id: "sport-try",
              affinity: 0.6,
              reason: "ты любишь футбол",
            },
          ],
        };
      },
    } satisfies AiProvider;
    const { app, auth, repository, user } = await setup(ai);
    const self = await repository.getSelfPerson(user.id);
    await repository.createMemory(user.id, self!.id, {
      content: "Не любит рисовать, любит футбол и волейбол",
      category: "preference",
    } as never);
    const res = await request(app).post("/api/activities/tastes/refresh").set(auth).expect(200);
    expect(seen!.memories.join(" ")).toContain("футбол");
    expect(res.body.data.summary).toContain("активное");
    const creative = res.body.data.items.find(
      (i: { target_id: string }) => i.target_id === "creative",
    );
    expect(creative).toMatchObject({ source: "ai", reason: "ты не любишь рисовать" });
  });

  it("гипотезы с телефона: факты и справочник туда, названия обратно", async () => {
    const { app, auth, repository, user } = await setup();
    const self = await repository.getSelfPerson(user.id);
    await repository.createMemory(user.id, self!.id, {
      content: "Любит волейбол",
      category: "preference",
    } as never);
    const evidence = await request(app)
      .get("/api/activities/tastes/evidence")
      .set(auth)
      .expect(200);
    expect(evidence.body.data.facts).toContain("Любит волейбол");
    expect(evidence.body.data.catalog).toContain("Спорт: Пляжный волейбол; Мини-футбол");

    const res = await request(app)
      .post("/api/activities/tastes/local")
      .set(auth)
      .send({
        summary: "Тебе подходит командный спорт.",
        hypotheses: [
          { name: "пляжный  волейбол", affinity: 0.9, reason: "ты любишь волейбол" },
          { name: "Творчество", kind: "category", affinity: -0.3, reason: "не похоже на тебя" },
          { name: "Прыжки с парашютом", affinity: 0.5 },
        ],
      })
      .expect(200);
    expect(res.body.data.summary).toBe("Тебе подходит командный спорт.");
    const volley = res.body.data.items.find(
      (i: { target_id: string }) => i.target_id === "voleybol",
    );
    // Телефонной догадке больше ±0,6 не верим.
    expect(volley).toMatchObject({ source: "ai", reason: "ты любишь волейбол" });
    expect(volley.score).toBeLessThanOrEqual(0.6);
    expect(res.body.data.items.some((i: { target_id: string }) => i.target_id === "creative")).toBe(
      true,
    );
  });
});

describe("inferenceFromLocal", () => {
  it("находит по названию и по id, неизвестное выбрасывает", () => {
    const result = inferenceFromLocal(
      {
        summary: "s",
        hypotheses: [
          { name: "Сёрфинг на искусственной волне", affinity: 0.4, reason: "r" },
          { target_id: "futbol", affinity: -0.2 },
          { name: "Вода", affinity: 0.3 },
          { name: "Нет такого", affinity: 0.3 },
          { name: "Живопись", affinity: "много" },
        ],
      },
      catalog,
    );
    expect(result!.hypotheses.map((h) => `${h.target_kind}:${h.target_id}`)).toEqual([
      "type:volna",
      "type:futbol",
      "category:water",
    ]);
  });
});
