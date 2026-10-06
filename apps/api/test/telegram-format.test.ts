import { describe, expect, it } from "vitest";
import { formatTelegramHtml } from "../src/infrastructure/telegram.js";

describe("Telegram message formatting", () => {
  it("renders Markdown emphasis without visible asterisks", () => {
    expect(formatTelegramHtml("**Важно:** сделать *сегодня*")).toBe(
      "<b>Важно:</b> сделать <i>сегодня</i>",
    );
  });

  it("escapes arbitrary HTML while preserving supported Markdown", () => {
    expect(formatTelegramHtml("2 < 3 & **безопасно**")).toBe("2 &lt; 3 &amp; <b>безопасно</b>");
  });

  it("supports nested emphasis, links, code, and fenced blocks", () => {
    expect(formatTelegramHtml("**Очень *важно***")).toBe("<b>Очень <i>важно</i></b>");
    expect(
      formatTelegramHtml(
        "**Ссылка:** [пример](https://example.com?a=1&b=2), `x < y`\n```ts\nconst x = 1 < 2;\n```",
      ),
    ).toBe(
      '<b>Ссылка:</b> <a href="https://example.com?a=1&amp;b=2">пример</a>, <code>x &lt; y</code>\n<pre>const x = 1 &lt; 2;\n</pre>',
    );
  });

  it("leaves unmatched asterisks as ordinary text", () => {
    expect(formatTelegramHtml("Цена: 5 * 3")).toBe("Цена: 5 * 3");
  });
});

describe("Telegram API base URL", () => {
  it("sends bot calls through the configured proxy and keeps the token path", async () => {
    const { TelegramClient } = await import("../src/infrastructure/telegram.js");
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ ok: true, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      await new TelegramClient("1:abc", "https://proxy.example/secret/").sendMessage(7, "hi");
      await new TelegramClient("1:abc").sendMessage(7, "hi");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls[0]).toBe("https://proxy.example/secret/bot1:abc/sendMessage");
    expect(calls[1]).toBe("https://api.telegram.org/bot1:abc/sendMessage");
  });
});
