import { describe, expect, it } from "vitest";
import { messages } from "../i18n/messages";
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

  it("formats numbers, money and temperature by locale", () => {
    expect(languageOf("en-US")).toBe("en");
    expect(localeTag("en", "Europe/Berlin")).toBe(bcp47("en", "Europe/Berlin"));
    expect(formatInteger(12345, "ru-RU")).toMatch(/12/);
    expect(formatTemperature(18.4, "ru-RU")).toBe("18°");
    expect(formatMoney(7990, "ru-RU")).toMatch(/₽|RUB/);
  });
});
