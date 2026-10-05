import { describe, expect, it } from "vitest";
import { composePortrait } from "../src/modules/assistant/personal-model.js";

const BIO =
  "Руковожу отделом маркетинга, двое детей. Сейчас важно не заваливать семью: жена Аня, сын Лёва 7 лет.";

describe("портрет", () => {
  it("не повторяет био ещё раз под видом памяти", () => {
    // Онбординг кладёт один и тот же текст и в bio, и в память о себе —
    // портрет склеивал «<био>. Из памяти: <то же био>.» и удваивал токены.
    const portrait = composePortrait({
      bio: BIO,
      memories: [{ content: BIO, category: "important_fact" }],
      locale: "ru",
    });
    expect(portrait).not.toContain("Из памяти");
    expect(portrait).toContain("Руковожу отделом маркетинга");
  });

  it("настоящие факты из памяти при этом сохраняются", () => {
    const portrait = composePortrait({
      bio: BIO,
      memories: [
        { content: BIO, category: "important_fact" },
        { content: "лучше думаю утром, сложное ставлю до обеда", category: "important_fact" },
      ],
      locale: "ru",
    });
    expect(portrait).toContain("лучше думаю утром");
    expect(portrait.match(/Руковожу отделом маркетинга/g)).toHaveLength(1);
  });
});
