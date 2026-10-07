import { describe, expect, it } from "vitest";
import {
  attachSearchAnswer,
  datePrepOffers,
  inferBirthdayReminders,
  inferDiscoveryIntent,
  isExplicitDiscoveryRequest,
  mergeCapabilityOffers,
  reminderTasksFromDates,
  runDiscovery,
  catalogTopicsFor,
  giftActionHits,
  isVenueRequest,
  venueQuery,
  isGiftAdviceQuestion,
  shoppingQuery,
  searchProducts,
  upcomingDateDigestLines,
  upcomingImportantDates,
  type FetchLike,
} from "../src/modules/assistant/discovery.js";

describe("companion discovery", () => {
  it("infers product search with a budget", () => {
    expect(inferDiscoveryIntent("найди наушники sony до 8000", "Москва")).toMatchObject({
      type: "products",
      maxPrice: 8000,
    });
  });

  it("infers restaurants and entertainment", () => {
    expect(inferDiscoveryIntent("куда сходить вечером", "Москва")?.type).toBe("places");
    expect(inferDiscoveryIntent("найди итальянский ресторан в Казани")?.city).toBe("Казани");
  });

  it("does not treat a task listing as a product hunt", () => {
    expect(inferDiscoveryIntent("покажи просроченные задачи")).toBeNull();
    expect(inferDiscoveryIntent("подскажи что делать сегодня")).toBeNull();
  });

  it("does not treat a low mood as a search", () => {
    expect(inferDiscoveryIntent("мне плохо и тревожно")).toBeNull();
  });

  it("infers internet search without treating it as a product hunt", () => {
    expect(inferDiscoveryIntent("что такое OLED")?.type).toBe("web");
    expect(inferDiscoveryIntent("погугли новости openai")?.query).toMatch(/openai/i);
    expect(inferDiscoveryIntent("найди наушники sony до 8000")?.type).toBe("products");
    expect(inferDiscoveryIntent("найди ему подарок")?.type).toBe("gifts");
  });

  it("offers nearby cash exchangers instead of a generic web hunt", () => {
    expect(inferDiscoveryIntent("поставь дело на понедельник поменять деньги", "Москва")).toMatchObject({
      type: "fx",
      city: "Москва",
    });
    expect(inferDiscoveryIntent("поменять планы")).toBeNull();
    expect(isExplicitDiscoveryRequest("поставь дело на понедельник поменять деньги")).toBe(false);
    expect(
      isExplicitDiscoveryRequest(
        "Сделай сам: Найди обменники рядом с выгодным курсом в Москве: живые наличные курсы USD, EUR к рублю",
      ),
    ).toBe(true);
    expect(
      inferDiscoveryIntent(
        "Сделай сам: Найди обменники рядом с выгодным курсом в Москве: живые наличные курсы USD, EUR к рублю",
        "Москва",
      )?.type,
    ).toBe("fx");
    const offers = mergeCapabilityOffers(
      [{ kind: "research", title: "Найти в интернете", instruction: "Найди в интернете" }],
      {
        userText: "поставь дело на понедельник поменять деньги",
        upcomingDates: [],
        recentOfferTitles: [],
        didSearch: false,
        city: "Москва",
      },
    );
    expect(offers.map((offer) => offer.title)).toEqual(["Выгодный курс · Москва"]);
    expect(offers[0]?.instruction).toMatch(/обменники.*выгодным курсом/i);
    expect(offers[0]?.kind).toBe("search_places");
  });

  it("offers a specific live helper for common errands instead of generic web search", () => {
    expect(isExplicitDiscoveryRequest("поставь дело купить молоко")).toBe(false);
    expect(
      isExplicitDiscoveryRequest(
        "слушай надо купить молоко, позвонить в банк, записаться к врачу и отправить документы",
      ),
    ).toBe(false);
    expect(inferDiscoveryIntent("поставь дело купить молоко", "Москва")).toMatchObject({
      type: "products",
      query: "молоко",
    });
    expect(
      mergeCapabilityOffers(
        [{ kind: "research", title: "Найти в интернете", instruction: "Найди в интернете" }],
        {
          userText: "поставь дело купить парацетамол",
          upcomingDates: [],
          recentOfferTitles: [],
          didSearch: false,
          city: "Москва",
        },
      ).map((offer) => offer.title),
    ).toEqual(["Аптеки рядом · Москва"]);
    expect(
      mergeCapabilityOffers([], {
        userText: "поставь дело купить билеты на кино",
        upcomingDates: [],
        recentOfferTitles: [],
        didSearch: false,
        city: "Москва",
      }).map((offer) => offer.title),
    ).toEqual(["Афиша · Москва"]);
    expect(
      mergeCapabilityOffers([], {
        userText: "поставь дело билет на поезд в Казань",
        upcomingDates: [],
        recentOfferTitles: [],
        didSearch: false,
        city: "Москва",
      }).map((offer) => offer.title),
    ).toEqual(["Билеты: поезд и самолёт"]);
    expect(
      mergeCapabilityOffers([], {
        userText: "поставь дело вызвать сантехника",
        upcomingDates: [],
        recentOfferTitles: [],
        didSearch: false,
        city: "Москва",
      }).map((offer) => offer.title),
    ).toEqual(["Мастер рядом · Москва"]);
    expect(
      mergeCapabilityOffers([], {
        userText: "какая погода завтра",
        upcomingDates: [],
        recentOfferTitles: [],
        didSearch: false,
        city: "Москва",
      }).map((offer) => offer.title),
    ).toEqual(["Погода · Москва"]);
    expect(
      mergeCapabilityOffers([], {
        userText: "поставь дело заказать букет",
        upcomingDates: [],
        recentOfferTitles: [],
        didSearch: false,
        city: "Москва",
      }).map((offer) => offer.title),
    ).toEqual(["Букеты рядом · Москва"]);
    expect(
      mergeCapabilityOffers([], {
        userText: "ответь на письмо от банка",
        upcomingDates: [],
        recentOfferTitles: [],
        didSearch: false,
        city: "Москва",
        canDraftMail: true,
      }).map((offer) => offer.title),
    ).toEqual(["Набросать ответ"]);
  });

  it("lists upcoming birthdays and holidays", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const dates = upcomingImportantDates(
      [
        {
          name: "Маша",
          memories: [
            {
              category: "important_date",
              content: "День рождения 1 сентября",
              occurred_at: "1994-09-01T00:00:00.000Z",
              status: "active",
            },
          ],
        },
      ],
      "Europe/Moscow",
      now,
      45,
    );
    expect(dates.some((item) => item.person === "Маша" && item.date.endsWith("-09-01"))).toBe(true);
    expect(
      upcomingImportantDates(
        [
          {
            name: "Дима",
            memories: [],
            dates: [{ kind: "wedding", label: null, month: 8, day: 30, year: 2019 }],
          },
        ],
        "Europe/Moscow",
        now,
        45,
      ).some((item) => item.person === "Дима" && item.label === "Свадьба"),
    ).toBe(true);
    expect(
      upcomingImportantDates([], "Europe/Moscow", new Date("2026-03-01T12:00:00.000Z"), 20).some(
        (item) => item.kind === "holiday" && item.label.includes("8 Марта"),
      ),
    ).toBe(true);
  });

  it("offers gift and table chips two weeks before a birthday", () => {
    const birthday = {
      person: "Маша",
      label: "День рождения",
      date: "2026-09-01",
      days_until: 14,
      kind: "birthday" as const,
    };
    expect(datePrepOffers([birthday]).map((offer) => offer.title)).toEqual([
      "Подарок: Маша",
      "Купить цветы",
      "Проект: День рождения Маша",
    ]);
    expect(datePrepOffers([birthday])[0]?.instruction).toMatch(/вкусам|focused_people/);
    expect(
      datePrepOffers([
        {
          person: "Дима",
          label: "Свадьба",
          date: "2026-08-30",
          days_until: 6,
          kind: "date",
        },
      ]).map((offer) => offer.title),
    ).toEqual(["Столик: Дима", "Подарок: Дима", "Проект: Свадьба Дима"]);
    expect(
      datePrepOffers([
        {
          person: null,
          label: "8 Марта",
          date: "2026-03-08",
          days_until: 7,
          kind: "holiday",
        },
      ]).map((offer) => offer.title),
    ).toEqual(["Подобрать подарок", "Купить цветы", "Проект: 8 Марта"]);
    expect(
      datePrepOffers([
        {
          person: "Маша",
          label: "День рождения",
          date: "2026-10-01",
          days_until: 30,
          kind: "birthday",
        },
      ]),
    ).toEqual([]);
    expect(
      upcomingDateDigestLines([
        {
          person: "Маша",
          label: "День рождения",
          date: "2026-09-25",
          days_until: 14,
          kind: "birthday",
        },
      ]).join("\n"),
    ).toMatch(/через 2 недели.*подарок, цветы или столик/);
  });

  it("puts two-week prep chips on a greeting instead of a generic remind", () => {
    const offers = mergeCapabilityOffers([], {
      userText: "привет",
      upcomingDates: [
        {
          person: "Маша",
          label: "День рождения",
          date: "2026-09-01",
          days_until: 12,
          kind: "birthday",
        },
      ],
      recentOfferTitles: [],
      didSearch: false,
    });
    expect(offers.map((offer) => offer.title)).toEqual(
      expect.arrayContaining(["Подарок: Маша", "Проект: День рождения Маша"]),
    );
    expect(offers.some((offer) => /цвет/i.test(offer.title))).toBe(true);
    expect(offers.some((offer) => offer.title === "Напомнить о праздниках")).toBe(false);
    expect(
      mergeCapabilityOffers([], {
        userText: "привет",
        upcomingDates: [
          {
            person: "Маша",
            label: "День рождения",
            date: "2026-10-01",
            days_until: 30,
            kind: "birthday",
          },
        ],
        recentOfferTitles: [],
        didSearch: false,
      }).some((offer) => /Подарок: Маша|Столик: Маша/.test(offer.title)),
    ).toBe(false);
  });

  it("creates reminder tasks from upcoming dates", () => {
    const actions = inferBirthdayReminders("напомни о днях рождения", [
      {
        person: "Маша",
        label: "День рождения",
        date: "2026-09-01",
        days_until: 8,
        kind: "birthday",
      },
    ]);
    expect(actions).toEqual([
      expect.objectContaining({ op: "create", title: "День рождения: Маша", due_at: "2026-09-01" }),
    ]);
    expect(reminderTasksFromDates([])).toEqual([]);
  });

  it("does not push generic discovery chips without a matching ask", () => {
    expect(
      mergeCapabilityOffers([], {
        userText: "привет",
        upcomingDates: [],
        recentOfferTitles: [],
        didSearch: false,
      }),
    ).toEqual([]);
    expect(
      mergeCapabilityOffers(
        [{ kind: "search_products", title: "Найти товар", instruction: "Найди товары" }],
        {
          userText: "покажи просроченные задачи",
          upcomingDates: [],
          recentOfferTitles: [],
          didSearch: false,
        },
      ),
    ).toEqual([]);
    expect(
      mergeCapabilityOffers([{ kind: "plan", title: "План", instruction: "Составь план" }], {
        userText: "найди наушники",
        upcomingDates: [],
        recentOfferTitles: [],
        didSearch: true,
      }),
    ).toEqual([expect.objectContaining({ title: "План" })]);
  });

  it("offers a product chip when the person asked to find a thing", () => {
    const offers = mergeCapabilityOffers([], {
      userText: "найди наушники sony",
      upcomingDates: [],
      recentOfferTitles: [],
      didSearch: false,
    });
    expect(offers.some((offer) => offer.kind === "search_products")).toBe(true);
    expect(offers.some((offer) => offer.title === "Куда сходить")).toBe(false);
  });

  it("lists discovery chips when asked what it can do", () => {
    const offers = mergeCapabilityOffers([], {
      userText: "что умеешь",
      upcomingDates: [],
      recentOfferTitles: [],
      didSearch: false,
    });
    expect(offers.map((offer) => offer.title)).toEqual(
      expect.arrayContaining(["Напомнить о праздниках", "Куда сходить"]),
    );
  });

  it("offers a goals sync chip when a check-in is due", () => {
    const offers = mergeCapabilityOffers([], {
      userText: "привет",
      upcomingDates: [],
      recentOfferTitles: [],
      didSearch: false,
      goalSyncDue: true,
    });
    expect(offers.some((offer) => offer.title === "Свериться по целям")).toBe(true);
    expect(offers[0]?.instruction).toMatch(/Синк по целям и плану/);
  });

  it("returns live marketplace links for a product query", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      json: async () => ({}),
    });
    const hits = await runDiscovery(
      {
        type: "products",
        query: "наушники sony",
        city: "Москва",
        maxPrice: 8000,
        minPrice: null,
        brand: null,
        category: null,
        placeKind: "place",
      },
      fetchImpl,
    );
    expect(hits.some((hit) => hit.url.includes("market.yandex.ru"))).toBe(true);
    expect(hits.some((hit) => hit.url.includes("8000"))).toBe(true);
    expect(attachSearchAnswer("Коротко.", hits)).toMatch(/Вот что нашлось/);
  });

  it("returns wikipedia and search-engine links for a web query", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("wikipedia")) {
        return {
          ok: true,
          json: async () => ["oled", ["OLED"], ["органический дисплей"], ["https://ru.wikipedia.org/wiki/OLED"]],
        };
      }
      if (url.includes("duckduckgo")) {
        return {
          ok: true,
          json: async () => ({
            Heading: "OLED",
            AbstractURL: "https://ddg.example/oled",
            AbstractText: "дисплей",
            RelatedTopics: [],
          }),
        };
      }
      if (url.includes("news.google")) {
        return {
          ok: true,
          json: async () => ({}),
          text: async () =>
            "<rss><item><title><![CDATA[News OLED]]></title><link>https://news.example/oled</link></item></rss>",
        };
      }
      return { ok: false, json: async () => ({}) };
    };
    const hits = await runDiscovery(
      {
        type: "web",
        query: "OLED",
        city: "Москва",
        maxPrice: null,
        minPrice: null,
        brand: null,
        category: null,
        placeKind: "place",
      },
      fetchImpl,
    );
    expect(hits.some((hit) => hit.url.includes("wikipedia.org") && hit.source === "Wikipedia")).toBe(
      true,
    );
    expect(hits.some((hit) => hit.url.includes("yandex.ru/search"))).toBe(true);
    expect(hits.some((hit) => hit.url.includes("google.com/search"))).toBe(true);
    expect(hits.some((hit) => hit.url === "https://news.example/oled")).toBe(true);
  });

  it("returns live cash rates and nearby exchangers", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("cbr-xml-daily")) {
        return {
          ok: true,
          json: async () => ({
            Valute: {
              USD: { CharCode: "USD", Nominal: 1, Value: 92.12 },
              EUR: { CharCode: "EUR", Nominal: 1, Value: 101.55 },
            },
          }),
        };
      }
      if (url.includes("open.er-api.com")) {
        return {
          ok: true,
          json: async () => ({ rates: { RUB: 91.8, EUR: 0.91 } }),
        };
      }
      if (url.includes("banki.ru") && url.includes("/usd/")) {
        return {
          ok: true,
          json: async () => ({}),
          text: async () => '{"buy":"91.20","sell":"93.40"}',
        };
      }
      if (url.includes("nominatim")) {
        return {
          ok: true,
          json: async () => [
            {
              name: "Обменник на Арбате",
              display_name: "Обменник на Арбате, Москва",
              osm_type: "node",
              osm_id: "123",
              type: "bureau_de_change",
            },
          ],
        };
      }
      return { ok: false, json: async () => ({}) };
    };
    const hits = await runDiscovery(
      {
        type: "fx",
        query: "поменять деньги",
        city: "Москва",
        maxPrice: null,
        minPrice: null,
        brand: null,
        category: null,
        placeKind: "place",
      },
      fetchImpl,
    );
    expect(hits.some((hit) => hit.source === "ЦБ РФ" && hit.title.includes("92,12"))).toBe(true);
    expect(
      hits.some(
        (hit) =>
          hit.url.includes("banki.ru/products/currency/cash/usd/moskva") &&
          /91,20/.test(hit.title),
      ),
    ).toBe(true);
    expect(hits.some((hit) => hit.url.includes("yandex.ru/maps"))).toBe(true);
    expect(hits.some((hit) => hit.title === "Обменник на Арбате")).toBe(true);
    expect(hits.some((hit) => /google.com\/search|yandex.ru\/search/.test(hit.url))).toBe(false);
  });

  it("returns a live forecast and weather pages", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes("geocoding-api.open-meteo")) {
        return {
          ok: true,
          json: async () => ({ results: [{ latitude: 55.75, longitude: 37.62 }] }),
        };
      }
      if (url.includes("api.open-meteo.com")) {
        return {
          ok: true,
          json: async () => ({
            current: { temperature_2m: 12.4, weather_code: 61, wind_speed_10m: 3 },
            daily: { temperature_2m_max: [14.1], temperature_2m_min: [7.2] },
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    };
    const hits = await runDiscovery(
      {
        type: "web",
        query: "погода",
        city: "Москва",
        maxPrice: null,
        minPrice: null,
        brand: null,
        category: "weather",
        placeKind: "place",
      },
      fetchImpl,
    );
    expect(hits.some((hit) => hit.source === "Open-Meteo" && /12°/.test(hit.title))).toBe(true);
    expect(hits.some((hit) => hit.url.includes("yandex.ru/pogoda"))).toBe(true);
  });

  it("returns live ticket and repair aggregators", async () => {
    const tickets = await runDiscovery(
      {
        type: "web",
        query: "кино",
        city: "Москва",
        maxPrice: null,
        minPrice: null,
        brand: null,
        category: "tickets",
        placeKind: "entertainment",
      },
      async () => ({ ok: false, json: async () => ({}) }),
    );
    expect(tickets.some((hit) => hit.url.includes("afisha.yandex.ru/moscow"))).toBe(true);
    const travel = await runDiscovery(
      {
        type: "web",
        query: "билет на поезд в Казань",
        city: "Москва",
        maxPrice: null,
        minPrice: null,
        brand: null,
        category: "travel",
        placeKind: "place",
      },
      async () => ({ ok: false, json: async () => ({}) }),
    );
    expect(travel.some((hit) => hit.source === "Туту")).toBe(true);
    expect(travel.some((hit) => hit.source === "Aviasales")).toBe(true);
    const repair = await runDiscovery(
      {
        type: "web",
        query: "сантехник",
        city: "Москва",
        maxPrice: null,
        minPrice: null,
        brand: null,
        category: "repair",
        placeKind: "place",
      },
      async () => ({ ok: false, json: async () => ({}) }),
    );
    expect(repair.some((hit) => hit.url.includes("profi.ru"))).toBe(true);
  });

  it("does not push catalogue noise into a gift question", async () => {
    const asked: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      asked.push(url);
      return { ok: false, json: async () => ({}) };
    };
    const hits = await searchProducts(
      {
        type: "products",
        query: "Что подарить маме на день рождения?",
        city: "Москва",
        maxPrice: null,
        minPrice: null,
        brand: null,
        category: null,
        placeKind: "place",
      },
      fetchImpl,
    );
    // Раньше сюда уходил сырой вопрос, и iTunes отвечал песнями «С днём рождения, мама!».
    expect(asked.some((url) => url.includes("itunes.apple.com"))).toBe(false);
    expect(asked.some((url) => url.includes("openfoodfacts"))).toBe(false);
    expect(asked.some((url) => url.includes("googleapis.com/books"))).toBe(false);
    // Живой поиск остаётся — и по предмету, а не по тексту вопроса.
    const market = hits.find((hit) => hit.url.includes("market.yandex.ru"));
    expect(market?.title).toBe("Яндекс Маркет: подарок маме на день рождения");
  });

  it("asks a catalogue only when the request is about its domain", async () => {
    const asked: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      asked.push(url);
      return { ok: false, json: async () => ({}) };
    };
    await searchProducts(
      {
        type: "products",
        query: "найди альбом Radiohead на виниле",
        city: "Москва",
        maxPrice: null,
        minPrice: null,
        brand: null,
        category: null,
        placeKind: "place",
      },
      fetchImpl,
    );
    expect(asked.some((url) => url.includes("itunes.apple.com"))).toBe(true);
    expect(asked.some((url) => url.includes("openbeautyfacts"))).toBe(false);
    expect(catalogTopicsFor({ query: "посоветуй книгу про керамику" })).toEqual(["books"]);
    expect(catalogTopicsFor({ query: "подбери крем для сухой кожи" })).toEqual(["beauty"]);
    expect(catalogTopicsFor({ query: "что подарить жене" })).toEqual([]);
  });

  it("puts the subject of the search into the card, not the request", () => {
    expect(shoppingQuery("Что подарить маме на день рождения?")).toBe(
      "подарок маме на день рождения",
    );
    expect(shoppingQuery("подбери мне мастерские по керамике в Москве")).toBe(
      "мастерские по керамике в Москве",
    );
    expect(shoppingQuery("наушники sony")).toBe("наушники sony");
  });

  it("treats a hall for an event as a place to find on a map, not a product", async () => {
    const text = "Найди покерный зал с крупье на 10 человек в субботу вечером";
    expect(isVenueRequest(text)).toBe(true);
    expect(isVenueRequest("найди наушники sony")).toBe(false);
    expect(venueQuery("покерный зал с крупье на 10 человек в субботу вечером")).toBe(
      "покерный зал с крупье",
    );
    const intent = inferDiscoveryIntent(text, "Москва");
    expect(intent).toMatchObject({ type: "places", query: "покерный зал с крупье" });
    const hits = await runDiscovery(intent!, async () => {
      throw new Error("no network in this test");
    });
    expect(hits.map((hit) => hit.title)).toEqual([
      "Яндекс Карты: покерный зал с крупье Москва",
      "2ГИС: покерный зал с крупье Москва",
    ]);
  });

  it("turns the model's gift decisions into the right kind of card", () => {
    expect(isGiftAdviceQuestion("Что подарить Ире на день рождения?")).toBe(true);
    expect(isGiftAdviceQuestion("найди ему подарок")).toBe(false);
    expect(isGiftAdviceQuestion("какие дела на сегодня?")).toBe(false);
    const hits = giftActionHits(
      [
        { type: "places", query: "суши ресторан", city: null },
        { type: "products", query: "коврик для йоги 6 мм", city: null },
      ],
      "Казань",
      "ru",
    );
    expect(hits.map((hit) => hit.title)).toEqual([
      "Яндекс Карты: суши ресторан Казань",
      "2ГИС: суши ресторан Казань",
      "Яндекс Маркет: коврик для йоги 6 мм",
    ]);
    expect(giftActionHits([], "Казань", "ru")).toEqual([]);
  });
});
