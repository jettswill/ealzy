import { describe, expect, it, vi } from "vitest";
import { createPlaceSearch } from "../src/modules/assistant/place-search.js";
import {
  parseWebPlaces,
  webCandidates,
  webSourceId,
  type WebPlaceHit,
} from "../src/modules/assistant/web-places.js";

const wave = { id: "iskusstvennaya-volna", name: "Искусственная волна", search_query: "серф волна" };

/** Карты пусты; Nominatim геокодит адрес «Приморский 72» в точку у Лахты. */
function fakeFetch() {
  const calls: string[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("overpass") || url.includes("maps.mail.ru")) {
      return new Response(JSON.stringify({ elements: [] }));
    }
    if (url.includes("nominatim") && /Приморский/.test(decodeURIComponent(url))) {
      return new Response(JSON.stringify([{ lat: "59.985", lon: "30.21" }]));
    }
    return new Response("[]");
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const hits: WebPlaceHit[] = [
  {
    name: "Surf Hub",
    address: "Приморский пр., 72",
    website: "https://surfhub.example",
    note: "волна для серфинга в помещении",
  },
  { name: "Волна без адреса", address: null, website: null, note: null },
];

describe("parseWebPlaces", () => {
  it("достаёт массив из ```json, сносок и пояснений", () => {
    const text = [
      "Вот что нашлось:",
      "```json",
      '[{"name":"Surf Hub [1]","address":"Приморский пр., 72 [2]","website":"https://surfhub.example","note":"крытая волна"},',
      ' {"name":"surf hub","address":"дубль"},',
      ' {"name":"", "address":"пусто"},',
      ' {"name":"Флоу","url":"ftp://bad","description":"волна в ТРК"}]',
      "```",
      "Цены уточняйте.",
    ].join("\n");
    expect(parseWebPlaces(text)).toEqual([
      {
        name: "Surf Hub",
        address: "Приморский пр., 72",
        website: "https://surfhub.example",
        note: "крытая волна",
      },
      { name: "Флоу", address: null, website: null, note: "волна в ТРК" },
    ]);
  });

  it("мусор и пустой ответ — пустой список", () => {
    expect(parseWebPlaces("ничего надёжного не нашлось")).toEqual([]);
    expect(parseWebPlaces("[]")).toEqual([]);
    expect(parseWebPlaces("[{oops")).toEqual([]);
  });

  it("не больше шести мест", () => {
    const many = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ name: `Место ${i}` })));
    expect(parseWebPlaces(many)).toHaveLength(6);
  });
});

describe("webCandidates", () => {
  it("геокодит адрес с городом, без адреса — без точки", async () => {
    const { impl, calls } = fakeFetch();
    const rows = await webCandidates(hits, "Санкт-Петербург", { fetch: impl, gapMs: 0 });
    expect(rows[0]).toMatchObject({
      source: "web",
      name: "Surf Hub",
      lat: 59.985,
      lon: 30.21,
      website: "https://surfhub.example",
      note: "волна для серфинга в помещении",
      rating: null,
    });
    expect(rows[1]).toMatchObject({ lat: null, lon: null });
    // Без адреса в геокодер не ходим.
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!).searchParams.get("q")).toBe("Санкт-Петербург, Приморский пр., 72");
  });

  it("id устойчив к регистру, ё и пунктуации", () => {
    expect(webSourceId({ name: "Surf Hub!", address: "Приморский пр. 72" }, "СПб")).toBe(
      webSourceId({ name: "surf  hub", address: "приморский пр, 72" }, "спб"),
    );
  });
});

describe("createPlaceSearch с веб-поиском", () => {
  const query = {
    type: wave,
    lat: 59.94,
    lon: 30.31,
    city: "Санкт-Петербург",
    allowWeb: true,
  };

  it("на картах пусто — добирает из интернета, с расстоянием, и кэширует", async () => {
    const { impl } = fakeFetch();
    const web = vi.fn(async () => hits);
    const search = createPlaceSearch({ fetch: impl, web, geocodeGapMs: 0 });
    const found = await search.nearby(query);
    expect(found.map((p) => p.name)).toEqual(["Surf Hub", "Волна без адреса"]);
    expect(found[0]!.source).toBe("web");
    expect(found[0]!.distance_m).toBeGreaterThan(5_000);
    expect(found[0]!.maps_url).toContain("yandex.ru/maps");
    expect(web).toHaveBeenCalledWith({
      type_name: "Искусственная волна",
      search_query: "серф волна",
      city: "Санкт-Петербург",
    });
    // Тот же тип и город — второй раз в интернет не ходим.
    await search.nearby({ ...query, lat: 59.99, lon: 30.2 });
    expect(web).toHaveBeenCalledTimes(1);
  });

  it("без квоты или без города — только карты", async () => {
    const { impl } = fakeFetch();
    const web = vi.fn(async () => hits);
    const search = createPlaceSearch({ fetch: impl, web, geocodeGapMs: 0 });
    expect(await search.nearby({ ...query, allowWeb: false })).toEqual([]);
    expect(await search.nearby({ ...query, city: null })).toEqual([]);
    expect(web).not.toHaveBeenCalled();
  });

  it("сбой веб-поиска не ломает выдачу и не кэшируется", async () => {
    const { impl } = fakeFetch();
    const web = vi
      .fn<() => Promise<WebPlaceHit[]>>()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(hits);
    const search = createPlaceSearch({ fetch: impl, web, geocodeGapMs: 0 });
    expect(await search.nearby(query)).toEqual([]);
    expect((await search.nearby(query)).length).toBe(2);
    expect(web).toHaveBeenCalledTimes(2);
  });

  it("на картах достаточно — в интернет не идёт", async () => {
    const element = (id: number, name: string) => ({
      type: "node",
      id,
      lat: 59.941,
      lon: 30.311,
      tags: { name, amenity: "cafe" },
    });
    const impl = vi.fn(async () =>
      new Response(
        JSON.stringify({ elements: [element(1, "А"), element(2, "Б"), element(3, "В")] }),
      ),
    ) as unknown as typeof fetch;
    const web = vi.fn(async () => hits);
    const search = createPlaceSearch({ fetch: impl, web, geocodeGapMs: 0 });
    const found = await search.nearby({
      ...query,
      type: { id: "kofeynya", name: "Кофейня", search_query: "кофейня" },
    });
    expect(found).toHaveLength(3);
    expect(web).not.toHaveBeenCalled();
  });
});
