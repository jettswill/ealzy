import { describe, expect, it } from "vitest";
import {
  bcp47,
  cityForLocale,
  formatInteger,
  formatMoney,
  languageOf,
  localeFromLanguageCode,
} from "../src/locale.js";

describe("locale helpers", () => {
  it("treats missing and Russian locales as ru", () => {
    expect(languageOf(undefined)).toBe("ru");
    expect(languageOf("ru")).toBe("ru");
    expect(languageOf("ru-RU")).toBe("ru");
    expect(languageOf("en-GB")).toBe("en");
  });

  it("maps Telegram language codes to stored locales", () => {
    expect(localeFromLanguageCode("en")).toBe("en-US");
    expect(localeFromLanguageCode("en-GB")).toBe("en-US");
    expect(localeFromLanguageCode("ru")).toBe("ru-RU");
    expect(localeFromLanguageCode(undefined)).toBe("ru-RU");
  });

  it("picks date/number tags from language and timezone", () => {
    expect(bcp47("ru")).toBe("ru-RU");
    expect(bcp47("en", "Europe/Berlin")).toBe("en-GB");
    expect(bcp47("en", "America/New_York")).toBe("en-US");
    expect(bcp47("en-GB", "America/New_York")).toBe("en-GB");
  });

  it("formats money and integers for the user locale", () => {
    expect(formatInteger(7990, "ru-RU")).toMatch(/7/);
    expect(formatMoney(7990, "ru-RU")).toMatch(/₽|RUB/);
    expect(formatMoney(7990, "en-US")).toMatch(/\$|RUB|₽/);
    expect(cityForLocale("Europe/Moscow", "en")).toBe("Moscow");
    expect(cityForLocale("Europe/Moscow", "ru")).toBe("Москва");
  });
});
