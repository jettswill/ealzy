import { describe, expect, it } from "vitest";
import { messages, ruInformal } from "../i18n/messages";
import {
  bcp47,
  formatInteger,
  formatMoney,
  formatTemperature,
  languageOf,
  localeTag,
} from "../i18n/locale";

describe("mini-app i18n", () => {
  it("keeps Russian and English dictionaries in sync", () => {
    expect(Object.keys(messages.en).sort()).toEqual(Object.keys(messages.ru).sort());
    expect(messages.ru.nav.home).toBe("Дела");
    expect(messages.en.nav.home).toBe("Tasks");
    expect(messages.ru.auth.language).toBe("Язык");
  });

  it("has a «ты» version only for strings that exist, with the same placeholders", () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const [key, informal] of Object.entries(ruInformal)) {
      const base = key
        .split(".")
        .reduce<unknown>(
          (node, part) =>
            node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
          messages.ru,
        );
      expect(typeof base, key).toBe("string");
      expect(placeholders(informal), key).toEqual(placeholders(base as string));
    }
  });

  it("formats numbers, money and temperature by locale", () => {
    expect(languageOf("en-US")).toBe("en");
    expect(localeTag("en", "Europe/Berlin")).toBe(bcp47("en", "Europe/Berlin"));
    expect(formatInteger(12345, "ru-RU")).toMatch(/12/);
    expect(formatTemperature(18.4, "ru-RU")).toBe("18°");
    expect(formatMoney(7990, "ru-RU")).toMatch(/₽|RUB/);
  });
});
