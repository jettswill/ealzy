import { localMidday } from "../../time.js";

export type ParsedTextTask = {
  title: string;
  due_at: string | null;
  importance: number | null;
};

const PRIORITY_TOKEN = /^(?:!|p|приор\.?\s*)([1-4])$/iu;

function dateKeyInZone(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function addDays(dateKey: string, days: number) {
  const next = new Date(`${dateKey}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function resolveNumericDate(
  day: number,
  month: number,
  year: number | null,
  todayKey: string,
): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const todayYear = Number(todayKey.slice(0, 4));
  let fullYear = year;
  if (fullYear != null && fullYear < 100) fullYear += 2000;
  if (fullYear == null) {
    const candidate = `${todayYear}-${pad(month)}-${pad(day)}`;
    fullYear = candidate < todayKey ? todayYear + 1 : todayYear;
  }
  return `${fullYear}-${pad(month)}-${pad(day)}`;
}

function parseDateToken(token: string, todayKey: string): string | null {
  const lower = token.toLocaleLowerCase();
  if (lower === "сегодня" || lower === "today") return todayKey;
  if (lower === "завтра" || lower === "tomorrow") return addDays(todayKey, 1);
  if (lower === "послезавтра" || lower === "день спустя") return addDays(todayKey, 2);
  const iso = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = token.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/);
  if (!dotted) return null;
  return resolveNumericDate(
    Number(dotted[1]),
    Number(dotted[2]),
    dotted[3] ? Number(dotted[3]) : null,
    todayKey,
  );
}

function parsePriorityToken(token: string): number | null {
  const match = token.match(PRIORITY_TOKEN);
  if (!match?.[1]) return null;
  const rank = Number(match[1]);
  return 6 - rank;
}

function splitCsvLine(line: string) {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current.trim());
  return parts;
}

function looksLikeHeader(cells: string[]) {
  const joined = cells.map((cell) => cell.toLocaleLowerCase()).join(" ");
  return /title|назван|task|дел/.test(joined) && cells.length >= 2;
}

export function parseTaskText(
  text: string,
  now = new Date(),
  timeZone = "UTC",
): ParsedTextTask[] {
  const todayKey = dateKeyInZone(now, timeZone);
  const rawLines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (!rawLines.length) return [];

  const firstCells = splitCsvLine(rawLines[0] ?? "");
  const csvMode = firstCells.length >= 2 && (looksLikeHeader(firstCells) || rawLines.every((line) => splitCsvLine(line).length >= 2));
  const lines = csvMode && looksLikeHeader(firstCells) ? rawLines.slice(1) : rawLines;

  const parsed: ParsedTextTask[] = [];
  for (const line of lines) {
    if (csvMode) {
      const [title, dateCell, priorityCell] = splitCsvLine(line);
      if (!title) continue;
      const dueKey = dateCell ? parseDateToken(dateCell, todayKey) : null;
      parsed.push({
        title,
        due_at: dueKey ? localMidday(dueKey, timeZone) : null,
        importance: priorityCell ? parsePriorityToken(priorityCell) : null,
      });
      continue;
    }

    const tokens = line.split(/\s+/);
    let due_at: string | null = null;
    let importance: number | null = null;
    while (tokens.length > 1) {
      const last = tokens[tokens.length - 1] ?? "";
      const dueKey = parseDateToken(last, todayKey);
      const priority = parsePriorityToken(last);
      if (dueKey) {
        due_at = localMidday(dueKey, timeZone);
        tokens.pop();
        continue;
      }
      if (priority != null) {
        importance = priority;
        tokens.pop();
        continue;
      }
      break;
    }
    const title = tokens.join(" ").replace(/[.,;]+$/u, "").trim();
    if (!title) continue;
    parsed.push({ title, due_at, importance });
  }
  return parsed;
}
