import type { Response } from "express";

export type CompanionStreamEvent =
  | { type: "delta"; answer: string }
  | { type: "done"; data: unknown }
  | { type: "error"; error: string };

/** Pull the growing JSON string value of `"answer"` out of a partial object. */
export function extractStreamingAnswer(partial: string): string | null {
  const match = /"answer"\s*:\s*"/u.exec(partial);
  if (!match || match.index === undefined) return null;
  let index = match.index + match[0].length;
  let out = "";
  while (index < partial.length) {
    const char = partial[index]!;
    if (char === "\\") {
      if (index + 1 >= partial.length) break;
      const next = partial[index + 1]!;
      if (next === "u") {
        const hex = partial.slice(index + 2, index + 6);
        if (hex.length < 4 || /[^0-9a-fA-F]/u.test(hex)) break;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        index += 6;
        continue;
      }
      const escaped: Record<string, string> = {
        n: "\n",
        t: "\t",
        r: "\r",
        b: "\b",
        f: "\f",
        '"': '"',
        "\\": "\\",
        "/": "/",
      };
      out += escaped[next] ?? next;
      index += 2;
      continue;
    }
    if (char === '"') return out;
    out += char;
    index += 1;
  }
  return out;
}

export function writeSse(res: Response, event: CompanionStreamEvent) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  const flushed = res as Response & { flush?: () => void };
  flushed.flush?.();
}

export function beginCompanionSse(res: Response) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.socket?.setNoDelay?.(true);
  res.write(":\n\n");
}
