import { describe, expect, it } from "vitest";
import {
  captureTelegramInbound,
  stripForwardAttribution,
  telegramQuotedReply,
} from "../src/infrastructure/telegram-inbound.js";

describe("telegram inbound capture", () => {
  it("keeps remember commands at the start of a forward", async () => {
    const captured = await captureTelegramInbound({
      text: "Запомни: Маша любит чай",
      forward_date: 1_700_000_000,
      forward_from: { first_name: "Ира" },
    });
    expect(captured).toMatchObject({ source: "forward", forwarded_from: "Ира" });
    if ("text" in captured) {
      expect(captured.text.startsWith("Запомни:")).toBe(true);
      expect(captured.text).toMatch(/переслано от Ира/);
    }
  });

  it("strips the forward marker so remember commands still parse", () => {
    expect(stripForwardAttribution("Запомни: Маша любит чай\n\n(переслано от Ира)")).toBe(
      "Запомни: Маша любит чай",
    );
  });

  it("transcribes a voice note and uses the caption when both exist", async () => {
    let transcribedFile: { filename: string; mime: string } | undefined;
    const captured = await captureTelegramInbound(
      {
        caption: "Запомни:",
        voice: { file_id: "v1", file_size: 120 },
      },
      {
        downloadFile: async () => ({
          bytes: new Uint8Array([1, 2, 3]),
          filename: "voice.ogg",
          mime: "audio/ogg",
        }),
        transcribe: async (file) => {
          transcribedFile = file;
          return "Маша любит походы";
        },
      },
    );
    expect(transcribedFile).toMatchObject({ filename: "voice.ogg", mime: "audio/ogg" });
    expect(captured).toMatchObject({ source: "caption" });
    if ("text" in captured) {
      expect(captured.text).toMatch(/Запомни:/);
      expect(captured.text).toMatch(/Маша любит походы/);
    }
  });

  it("compresses Telegram video note audio before transcription", async () => {
    let preparedFile: { filename: string; mime: string } | undefined;
    let transcribedFile: { filename: string; mime: string } | undefined;
    const captured = await captureTelegramInbound(
      { video_note: { file_id: "circle1", file_size: 3_000_000 } },
      {
        downloadFile: async () => ({
          bytes: new Uint8Array([1, 2, 3]),
          filename: "file_1.mp4",
          mime: "application/octet-stream",
        }),
        prepareForTranscription: async (file) => {
          preparedFile = file;
          return {
            bytes: new Uint8Array([4, 5]),
            filename: "video_note.mp3",
            mime: "audio/mpeg",
          };
        },
        transcribe: async (file) => {
          transcribedFile = file;
          return "Купить молоко";
        },
      },
    );

    expect(preparedFile).toMatchObject({
      filename: "video_note.mp4",
      mime: "video/mp4",
    });
    expect(transcribedFile).toMatchObject({
      filename: "video_note.mp3",
      mime: "audio/mpeg",
    });
    expect(captured).toMatchObject({ text: "Купить молоко", source: "voice" });
  });

  it("returns unreadable when media has no text and transcription fails", async () => {
    const captured = await captureTelegramInbound(
      { photo: [{ file_id: "p1" }] },
      { downloadFile: async () => null, transcribe: async () => null },
    );
    expect(captured).toEqual({ unreadable: true });
  });

  it("reads the quoted Telegram reply", () => {
    expect(
      telegramQuotedReply({
        reply_to_message: {
          message_id: 44,
          text: "Поставил задачу «Купить лекарства» на сегодня.",
          from: { is_bot: true, first_name: "Ealzy" },
        },
      }),
    ).toEqual({
      telegram_message_id: 44,
      role: "assistant",
      content: "Поставил задачу «Купить лекарства» на сегодня.",
    });
    expect(telegramQuotedReply({})).toBeNull();
  });
});
