export function isPushTask(task: {
  status?: string;
  importance?: number | null;
  urgency?: number | null;
}) {
  if (task.status === "done" || task.status === "cancelled") return false;
  return (task.importance ?? 3) >= 4 && (task.urgency ?? 3) >= 4;
}

export function dueIso(date: string, time?: string) {
  if (!date) return null;
  const clock = time && /^\d{2}:\d{2}$/.test(time) ? time : "12:00";
  const parsed = new Date(`${date}T${clock}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function splitDue(iso?: string | null, timezone?: string) {
  if (!iso) return { date: "", time: "" };
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return { date: "", time: "" };
  if (timezone) {
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
    return { date, time: dueClock(iso, timezone) };
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const hours = value.getHours();
  const minutes = value.getMinutes();
  const time = hours === 12 && minutes === 0 ? "" : `${pad(hours)}:${pad(minutes)}`;
  return { date, time };
}

export function dueClock(iso: string | Date | null | undefined, timezone: string) {
  if (!iso) return "";
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  if (hour === "12" && minute === "00") return "";
  return `${hour}:${minute}`;
}

export const ESTIMATE_PRESETS = [5, 15, 30, 60, 120] as const;

export function formatEstimate(minutes: number, language: "ru" | "en") {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (language === "ru") {
    if (!hours) return `${rest}м`;
    if (!rest) return `${hours}ч`;
    return `${hours}ч ${rest}м`;
  }
  if (!hours) return `${rest}m`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}m`;
}
