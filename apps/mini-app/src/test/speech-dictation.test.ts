import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { joinDictation, useSpeechDictation } from "../speech-dictation";

describe("joinDictation", () => {
  it("uses spoken text when the field is empty", () => {
    expect(joinDictation("", "привет")).toBe("привет");
    expect(joinDictation("   ", "привет")).toBe("привет");
  });

  it("inserts a space between existing text and new words", () => {
    expect(joinDictation("Купить", "хлеб")).toBe("Купить хлеб");
    expect(joinDictation("Купить ", "хлеб")).toBe("Купить хлеб");
  });

  it("keeps punctuation attached to the previous word", () => {
    expect(joinDictation("Купить хлеб", ", пожалуйста")).toBe("Купить хлеб, пожалуйста");
  });
});

describe("useSpeechDictation", () => {
  it("writes recognized speech into the field", () => {
    const recognition = installSpeechRecognition();
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useSpeechDictation({ value: "Купить", onChange, lang: "ru-RU" }),
    );

    act(() => result.current.toggle());
    expect(recognition.latest?.start).toHaveBeenCalled();
    expect(result.current.listening).toBe(true);

    act(() => recognition.latest?.emit("хлеб", true));
    expect(onChange).toHaveBeenCalledWith("Купить хлеб");
  });
});

function installSpeechRecognition() {
  const instances: FakeSpeechRecognition[] = [];

  class FakeSpeechRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onresult: ((event: { resultIndex: number; results: unknown }) => void) | null = null;
    onerror: ((event: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();

    constructor() {
      instances.push(this);
    }

    emit(transcript: string, isFinal = true) {
      const result = {
        isFinal,
        length: 1,
        0: { transcript },
      };
      this.onresult?.({
        resultIndex: 0,
        results: { length: 1, 0: result },
      });
    }
  }

  Object.defineProperty(window, "SpeechRecognition", {
    configurable: true,
    writable: true,
    value: FakeSpeechRecognition,
  });
  return {
    get latest() {
      return instances.at(-1);
    },
  };
}
