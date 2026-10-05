import { describe, expect, it } from "vitest";
import { hasTelegramAuthResult, telegramAuthUrl, telegramLoginFromSearch } from "../telegram-login";

function encodeAuthResult(payload: Record<string, unknown>, urlSafe: boolean) {
  let encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  if (urlSafe) encoded = encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return encoded;
}

describe("Telegram website login", () => {
  it("parses a Login Widget redirect payload", () => {
    const search =
      "?id=88&first_name=Ira&username=ira&auth_date=1710000000&hash=abc&photo_url=https%3A%2F%2Fexample.com%2Fa.png";
    expect(telegramLoginFromSearch(search)).toEqual({
      id: 88,
      first_name: "Ira",
      username: "ira",
      auth_date: 1710000000,
      hash: "abc",
      photo_url: "https://example.com/a.png",
    });
  });

  it("parses Telegram's #tgAuthResult redirect used on iOS", () => {
    const payload = {
      id: 88,
      first_name: "Ира",
      username: "ira",
      auth_date: 1710000000,
      hash: "abc123",
      photo_url: "https://example.com/a.png",
    };
    const encoded = encodeAuthResult(payload, true);
    expect(hasTelegramAuthResult(`#tgAuthResult=${encoded}`)).toBe(true);
    expect(telegramLoginFromSearch("", `#tgAuthResult=${encoded}`)).toEqual(payload);
  });

  it("parses standard base64 tgAuthResult from the hash or the query string", () => {
    const payload = {
      id: 88,
      first_name: "Ира",
      username: "ira",
      auth_date: 1710000000,
      hash: "abc123",
      photo_url: "https://example.com/a.png",
    };
    const encoded = encodeAuthResult(payload, false);
    expect(telegramLoginFromSearch("", `#tgAuthResult=${encoded}`)).toEqual(payload);
    expect(telegramLoginFromSearch(`?tgAuthResult=${encodeURIComponent(encoded)}`)).toEqual(payload);
  });

  it("builds an oauth.telegram.org URL for the native button", () => {
    expect(telegramAuthUrl("8605994246", "https://ealzy.ru/auth/telegram")).toContain(
      "https://oauth.telegram.org/auth?",
    );
    expect(telegramAuthUrl("8605994246", "https://ealzy.ru/auth/telegram")).toContain(
      "bot_id=8605994246",
    );
  });
});
