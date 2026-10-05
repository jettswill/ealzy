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
