import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { InMemoryRepository } from "../src/repository.js";
import { createSession } from "../src/modules/auth/index.js";
import {
  activityCategoryHint,
  attachPlaces,
  fitsSeason,
  isOutingRequest,
  pickActivityIdeas,
  resetActivityCatalogCache,
} from "../src/modules/assistant/activities.js";
import { PersonalContextBuilder } from "../src/modules/assistant/companion.js";
import { compactCompanionWorkspace } from "../src/infrastructure/openai.js";
import { toCompanionWorkspace } from "../src/modules/assistant/companion-workspace.js";
import type { ActivityCatalog, ActivityType, Place, PlaceVisit } from "../src/types.js";
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
    emoji: null,
    description: null,
    activity_level: 2,
    emotion_level: 3,
    price_level: 2,
    duration_hours: 2,
    season: "all",
    setting: "indoor",
    min_people: 1,
    kids_ok: false,
    search_query: id,
    geo: null,
    sort: 0,
    ...extra,
  };
}

const catalog: ActivityCatalog = {
  categories: [
    { id: "coffee-tea", name: "Кофейни, чай и сладкое", emoji: "☕", sort: 0 },
    { id: "water", name: "Вода", emoji: "🌊", sort: 1 },
    { id: "games", name: "Игры", emoji: "🎲", sort: 2 },
    { id: "kids", name: "Дети", emoji: "🎠", sort: 3 },
  ],
  types: [
    type("kofeynya", "coffee-tea", { kids_ok: true }),
    type("speshelti", "coffee-tea"),
    type("matcha", "coffee-tea"),
    type("sap", "water", { season: "summer", setting: "outdoor" }),
    type("kvest", "games"),
    type("mafiya", "games"),
    type("prjatki", "games"),
    type("detskiy-park", "kids", { kids_ok: true }),
  ],
};

function place(
  id: string,
  types: string[],
  rating: number | null,
  city = "Санкт-Петербург",
): Place {
  return {
    id,
    name: `Место ${id}`,
    city,
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
    yandex_rating: rating,
    yandex_reviews: null,
    twogis_url: null,
    source: "test",
    activity_type_ids: types,
  };
}

function visit(input: Partial<PlaceVisit>): PlaceVisit {
  return {
    id: crypto.randomUUID(),
    owner_id: "u",
    place_id: null,
    activity_type_id: null,
    title: null,
    city: null,
    status: "visited",
    rating: null,
    note: null,
    visited_on: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...input,
  };
}

beforeEach(() => resetActivityCatalogCache());

describe("outing requests", () => {
  it("recognises «where to go» and leaves ordinary messages alone", () => {
    for (const text of [
      "Куда сходить в субботу вечером?",
      "чем бы заняться на выходных",
      "Удиви меня",
      "где поужинать с Олей",
      "хочу новую кофейню, где я ещё не был",
      "идеи для свидания",
    ])
      expect(isOutingRequest(text), text).toBe(true);
    for (const text of ["Купить молоко", "Напомни позвонить маме", "сходить к врачу в среду"])
      expect(isOutingRequest(text), text).toBe(false);
  });

  it("reads the occasion from the words", () => {
    expect(activityCategoryHint("хочу в новую кофейню")).toBe("coffee-tea");
    expect(activityCategoryHint("куда сходить в бар")).toBe("bars-nightlife");
    expect(activityCategoryHint("где поужинать")).toBe("restaurants");
    expect(activityCategoryHint("пойдём в баню")).toBe("relax");
    expect(activityCategoryHint("куда сходить")).toBeNull();
  });

  it("keeps summer-only things out of November", () => {
    expect(fitsSeason("summer", 11)).toBe(false);
    expect(fitsSeason("winter", 1)).toBe(true);
    expect(fitsSeason("warm", 5)).toBe(true);
    expect(fitsSeason("all", 11)).toBe(true);
  });
});

describe("activity ideas", () => {
  it("puts what the person has not tried first and drops what they asked to skip", () => {
    const ideas = pickActivityIdeas({
      catalog,
      visits: [
        visit({ activity_type_id: "kvest", status: "visited" }),
        visit({ activity_type_id: "mafiya", status: "skip" }),
      ],
      text: "чем заняться",
      month: 11,
      limit: 20,
      rng: () => 0.42,
    });
    const ids = ideas.map((idea) => idea.type_id);
    expect(ids).not.toContain("sap");
    expect(ids).not.toContain("mafiya");
    expect(ids.indexOf("kvest")).toBeGreaterThanOrEqual(0);
    expect(ideas.find((idea) => idea.type_id === "kvest")?.tried).toBe(true);
    // Без повода — не больше двух из одной категории.
    expect(ids.filter((id) => ["kofeynya", "speshelti", "matcha"].includes(id)).length).toBe(2);
  });

  it("follows the occasion and kids", () => {
    const coffee = pickActivityIdeas({
      catalog,
      visits: [],
      text: "хочу в кофейню",
      month: 11,
      limit: 10,
    });
    expect(coffee.map((i) => i.type_id).sort()).toEqual(["kofeynya", "matcha", "speshelti"]);
    const kids = pickActivityIdeas({
      catalog,
      visits: [],
      text: "куда сходить с детьми",
      month: 11,
      limit: 10,
    });
    expect(kids.map((i) => i.type_id).sort()).toEqual(["detskiy-park", "kofeynya"]);
  });

  it("attaches only places the person has not been to", () => {
    const [idea] = pickActivityIdeas({
      catalog,
      visits: [],
      text: "",
      category: "coffee-tea",
      month: 11,
      limit: 1,
      rng: () => 0,
    });
    const places = [
      place("a", [idea!.type_id], 4.9),
      place("b", [idea!.type_id], 4.5),
      place("c", [idea!.type_id], 4.1),
    ];
    const [withPlaces] = attachPlaces([idea!], places, [visit({ place_id: "a" })]);
    expect(withPlaces!.places.map((p) => p.id)).toEqual(["b", "c"]);
  });
});

describe("activities API", () => {
  async function setup() {
    const repository = new InMemoryRepository();
    repository.activityCatalog = catalog;
    repository.places = [
      place("11111111-1111-4111-8111-111111111111", ["kofeynya"], 4.8),
      place("22222222-2222-4222-8222-222222222222", ["kofeynya"], 4.6),
      place("33333333-3333-4333-8333-333333333333", ["kofeynya"], 4.7, "Москва"),
    ];
    const app = createApp({ repository, telegram, env });
    const user = await repository.upsertTelegramUser({ telegram_id: 77, name: "Андрей" });
    const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
    return { repository, app, auth, user };
  }

  it("serves the catalog", async () => {
    const { app, auth } = await setup();
    const res = await request(app).get("/api/activities").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.types).toHaveLength(catalog.types.length);
  });

  it("surprises with a place in the city the person has not visited", async () => {
    const { app, auth } = await setup();
    await request(app)
      .post("/api/places/visits")
      .set(auth)
      .send({
        place_id: "11111111-1111-4111-8111-111111111111",
        activity_type_id: "kofeynya",
        rating: 4,
      })
      .expect(201);
    const res = await request(app)
      .get("/api/activities/surprise")
      .query({ type: "kofeynya", city: "Санкт-Петербург" })
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.type.id).toBe("kofeynya");
    expect(res.body.data.places.map((p: Place) => p.id)).toEqual([
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(res.body.data.maps_url).toContain("yandex.ru/maps");
  });

  it("keeps one diary row per place and rejects unknown types", async () => {
    const { app, auth } = await setup();
    const placeId = "22222222-2222-4222-8222-222222222222";
    await request(app)
      .post("/api/places/visits")
      .set(auth)
      .send({ place_id: placeId, status: "want" })
      .expect(201);
    await request(app)
      .post("/api/places/visits")
      .set(auth)
      .send({ place_id: placeId, rating: 5 })
      .expect(201);
    const list = await request(app).get("/api/places/visits").set(auth);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ status: "visited", rating: 5 });
    await request(app)
      .post("/api/places/visits")
      .set(auth)
      .send({ title: "Кофейня у дома", activity_type_id: "nope" })
      .expect(400);
    await request(app).delete(`/api/places/visits/${list.body.data[0].id}`).set(auth).expect(204);
  });
});

describe("Ilzi sees the catalog", () => {
  it("adds ideas with real places only when asked where to go", async () => {
    const repository = new InMemoryRepository();
    repository.activityCatalog = catalog;
    repository.places = [place("p1", ["kofeynya"], 4.8, "Москва")];
    const user = await repository.upsertTelegramUser({ telegram_id: 78, name: "Андрей" });
    const builder = new PersonalContextBuilder(repository);
    const plain = await builder.build(user.id, "Купить молоко");
    expect(plain.activity_ideas).toBeUndefined();
    const asked = await builder.build(user.id, "Хочу в новую кофейню, куда сходить?");
    expect(asked.activity_ideas?.length).toBeGreaterThan(0);
    expect(asked.activity_ideas!.every((idea) => idea.category === "Кофейни, чай и сладкое")).toBe(
      true,
    );
    const workspace = compactCompanionWorkspace(toCompanionWorkspace(asked)) as {
      activity_ideas?: { name: string }[];
    };
    expect(workspace.activity_ideas?.length).toBe(asked.activity_ideas!.length);
  });
});
