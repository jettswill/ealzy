import { describe, expect, it } from "vitest";
import { extractStreamingAnswer } from "../src/modules/assistant/companion-stream.js";

describe("extractStreamingAnswer", () => {
  it("returns the growing answer from a partial JSON object", () => {
    expect(extractStreamingAnswer('{"answer":"Hel')).toBe("Hel");
    expect(extractStreamingAnswer('{"answer": "Hello", "follow_up": null}')).toBe("Hello");
  });

  it("unescapes JSON string content as it arrives", () => {
    expect(extractStreamingAnswer('{"answer":"Hi\\nthere')).toBe("Hi\nthere");
    expect(extractStreamingAnswer('{"answer":"\\u041f\\u0440\\u0438')).toBe("При");
  });

  it("waits for a complete unicode escape before emitting more text", () => {
    expect(extractStreamingAnswer('{"answer":"Hi\\u04')).toBe("Hi");
  });
});
