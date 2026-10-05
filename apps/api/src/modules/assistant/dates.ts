import type { PersonDate, PersonDateKind } from "../../types.js";

export const PERSON_DATE_KINDS = ["birthday", "met", "wedding", "anniversary", "other"] as const;
export const UNIQUE_PERSON_DATE_KINDS = ["birthday", "met", "wedding"] as const;
export const PERSON_DATE_MAX = 20;

const KIND_RANK: Record<string, number> = {
  birthday: 0,
  wedding: 1,
  met: 2,
  anniversary: 3,
  other: 4,
};

const KIND_LABELS: Record<PersonDateKind, string> = {
  birthday: "День рождения",
  met: "Знакомство",
  wedding: "Свадьба",
  anniversary: "Годовщина",
  other: "Дата",
};

export function isUniquePersonDateKind(kind: string): kind is (typeof UNIQUE_PERSON_DATE_KINDS)[number] {
  return (UNIQUE_PERSON_DATE_KINDS as readonly string[]).includes(kind);
}

export function isValidCalendarDay(month: number, day: number, year: number | null | undefined) {
  const y = year ?? 2000;
  const date = new Date(Date.UTC(y, month - 1, day));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function sortPersonDates<T extends { kind: string; month: number; day: number }>(dates: T[]) {
  return [...dates].sort(
    (a, b) =>
      (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || a.month - b.month || a.day - b.day,
  );
}

export function personDateLabel(date: { kind: string; label?: string | null }) {
  if (date.label?.trim()) return date.label.trim();
  return KIND_LABELS[date.kind as PersonDateKind] ?? KIND_LABELS.other;
}

export function compactDates(
  dates:
    | {
        kind: string;
        label: string | null;
        month: number;
        day: number;
        year: number | null;
      }[]
    | null
    | undefined,
) {
  return sortPersonDates(dates ?? []).slice(0, 8).map((date) => ({
    kind: date.kind,
    label: personDateLabel(date),
    month: date.month,
    day: date.day,
    year: date.year,
  }));
}

export function compactBirthday(
  dates: { kind: string; month: number; day: number; year: number | null }[] | null | undefined,
) {
  const birthday = (dates ?? []).find((date) => date.kind === "birthday");
  if (!birthday) return null;
  const pad = (value: number) => String(value).padStart(2, "0");
  return birthday.year
    ? `${birthday.year}-${pad(birthday.month)}-${pad(birthday.day)}`
    : `${pad(birthday.month)}-${pad(birthday.day)}`;
}

export function partsFromIso(value: string | null | undefined): {
  month: number;
  day: number;
  year: number;
} | null {
  if (!value) return null;
  const match = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidCalendarDay(month, day, year)) return null;
  return { month, day, year };
}

export function birthdayOf(dates: PersonDate[] | null | undefined) {
  return (dates ?? []).find((date) => date.kind === "birthday") ?? null;
}
