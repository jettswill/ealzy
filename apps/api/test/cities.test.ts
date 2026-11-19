import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { SubscribedRepository } from "./subscribed.js";
import { createSession } from "../src/modules/auth/index.js";
import {
  canonicalCityName,
  cityFromMessage,
  resolveCity,
  searchCities,
} from "../src/modules/assistant/cities.js";
import { ownCity, saveOwnCity } from "../src/modules/assistant/locations.js";
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
const telegram: TelegramGateway = { async sendMessage() {}, async answerCallbackQuery() {} };

describe("справочник городов", () => {
  it("подсказки: начало, сокращения, опечатки; крупные выше", () => {
    expect(searchCities("санк", 3).map((c) => c.name)).toEqual(["Санкт-Петербург"]);
    expect(searchCities("спб", 1)[0]!.name).toBe("Санкт-Петербург");
    expect(searchCities("Сункт-Петербург", 1)[0]!.name).toBe("Санкт-Петербург");
    expect(searchCities("мос", 1)[0]!.name).toBe("Москва");
    const nizh = searchCities("нижн", 3).map((c) => c.name);
    expect(nizh[0]).toBe("Нижний Новгород");
    expect(nizh).toContain("Нижний Тагил");
  });

  it("приводит название к одному виду", () => {
    expect(resolveCity("Сункт-Петербург")?.title).toBe("Санкт-Петербург");
    expect(resolveCity("г. Москва")?.title).toBe("Москва");
    expect(resolveCity("питер")?.title).toBe("Санкт-Петербург");
    expect(resolveCity("Нигдебург")).toBeNull();
    expect(canonicalCityName("спб")).toBe("Санкт-Петербург");
    // Чужой город не ломаем: остаётся как написали.
    expect(canonicalCityName("Барселона")).toBe("Барселона");
  });

  it("одноимённые — с регионом, «Ростов» — Ростов-на-Дону", () => {
    expect(resolveCity("Ростов")?.title).toBe("Ростов-на-Дону");
    expect(resolveCity("Ростов, Ярославская область")?.title).toBe("Ростов, Ярославская область");
    expect(resolveCity("Кировск, Ленинградская")?.title).toBe("Кировск, Ленинградская область");
    const kirovsk = searchCities("кировск", 2).map((c) => c.title);
    expect(kirovsk).toEqual(["Кировск, Мурманская область", "Кировск, Ленинградская область"]);
  });

  it("город из сообщения в чате — в любом падеже", () => {
    expect(cityFromMessage("Я живу в Казани")?.name).toBe("Казань");
    expect(cityFromMessage("сейчас живу в Нижнем Новгороде, работаю там")?.name).toBe(
      "Нижний Новгород",
    );
    expect(cityFromMessage("переехала в Питер весной")?.name).toBe("Санкт-Петербург");
    expect(cityFromMessage("мой город — Тверь")?.name).toBe("Тверь");
    expect(cityFromMessage("живу в Санкт-Петербурге")?.name).toBe("Санкт-Петербург");
    expect(cityFromMessage("живу во Владимире")?.name).toBe("Владимир");
    expect(cityFromMessage("живу в деревне у бабушки")).toBeNull();
    expect(cityFromMessage("съездил в Казань на выходные")).toBeNull();
  });
});

describe("свой город", () => {
  async function setup() {
    const repository = new SubscribedRepository();
    const app = createApp({ repository, telegram, env });
    const user = await repository.upsertTelegramUser({ telegram_id: 501, name: "Андрей" });
    const auth = { Authorization: `Bearer ${await createSession(user.id, sessionSecret, 900)}` };
    return { app, auth, repository, user };
  }

  it("хранится основным адресом и меняется без дублей", async () => {
    const { repository, user } = await setup();
    expect(await ownCity(repository, user.id)).toBeNull();
    expect(await saveOwnCity(repository, user.id, "Казань")).toBe(true);
    expect(await saveOwnCity(repository, user.id, "Казань")).toBe(false);
    expect(await saveOwnCity(repository, user.id, "Санкт-Петербург")).toBe(true);
    const self = await repository.getSelfPerson(user.id);
    const locations = await repository.listLocations(user.id, self!.id);
    expect(locations).toHaveLength(1);
    expect(locations[0]).toMatchObject({ city: "Санкт-Петербург", is_primary: true });
    expect(await ownCity(repository, user.id)).toBe("Санкт-Петербург");
  });

  it("API: подсказки, сохранить, прочитать; неизвестный — 422", async () => {
    const { app, auth } = await setup();
    const suggest = await request(app).get("/api/cities").query({ q: "екб" }).set(auth).expect(200);
    expect(suggest.body.data[0]).toMatchObject({
      name: "Екатеринбург",
      title: "Екатеринбург",
      region: "Свердловская область",
    });
    const empty = await request(app).get("/api/me/city").set(auth).expect(200);
    expect(empty.body.data.city).toBeNull();
    expect(empty.body.data.guess).toBeTruthy();

    await request(app).put("/api/me/city").set(auth).send({ city: "Нигдебург" }).expect(422);
    const saved = await request(app)
      .put("/api/me/city")
      .set(auth)
      .send({ city: "сункт-петербург" })
      .expect(200);
    expect(saved.body.data.city).toBe("Санкт-Петербург");
    const read = await request(app).get("/api/me/city").set(auth).expect(200);
    expect(read.body.data).toMatchObject({ city: "Санкт-Петербург", guess: null });
  });

  it("колесо: город из справочника запоминается, чужой — 422", async () => {
    const { app, auth } = await setup();
    await request(app).post("/api/activities/wheel").set(auth).send({ city: "Сункт" }).expect(422);
    const status = await request(app).get("/api/activities/wheel").set(auth).expect(200);
    expect(status.body.data.city).toBeNull();
    // Вращение может не найти вариантов (пустой справочник занятий) — город всё равно запомнится.
    await request(app).post("/api/activities/wheel").set(auth).send({ city: "Казань" });
    const after = await request(app).get("/api/activities/wheel").set(auth).expect(200);
    expect(after.body.data.city).toBe("Казань");
  });

  it("адрес в карточке «Я» пишется справочным названием", async () => {
    const { app, auth } = await setup();
    const created = await request(app)
      .post("/api/me/locations")
      .set(auth)
      .send({ city: "спб", is_primary: true })
      .expect(201);
    expect(created.body.data.city).toBe("Санкт-Петербург");
  });
});
