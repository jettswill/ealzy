import { spawn } from "node:child_process";
import type { TelegramFile } from "./telegram-inbound.js";

const TRANSCODE_TIMEOUT_MS = 30_000;
const MAX_COMPRESSED_BYTES = 5_000_000;
const MAX_ERROR_BYTES = 8_000;

export function compressVideoNoteAudio(file: TelegramFile): Promise<TelegramFile> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "24k",
        "-threads",
        "1",
        "-f",
        "mp3",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ffmpeg.kill("SIGKILL");
      reject(error);
    };

    const timer = setTimeout(
      () => fail(new Error("Video note audio conversion timed out")),
      TRANSCODE_TIMEOUT_MS,
    );

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_COMPRESSED_BYTES) {
        fail(new Error("Compressed video note audio is too large"));
        return;
      }
      output.push(chunk);
    });
    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      if (errorBytes >= MAX_ERROR_BYTES) return;
      const remaining = MAX_ERROR_BYTES - errorBytes;
      errors.push(chunk.subarray(0, remaining));
      errorBytes += Math.min(chunk.byteLength, remaining);
    });
    ffmpeg.on("error", (error) => fail(error));
    ffmpeg.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") fail(error);
    });
    ffmpeg.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 || outputBytes === 0) {
        const detail = Buffer.concat(errors).toString("utf8").trim();
        reject(
          new Error(
            `Video note audio conversion failed (${code ?? "unknown"})${detail ? `: ${detail}` : ""}`,
          ),
        );
        return;
      }
      resolve({
        bytes: new Uint8Array(Buffer.concat(output)),
        filename: "video_note.mp3",
        mime: "audio/mpeg",
      });
    });

    ffmpeg.stdin.end(file.bytes);
  });
}
