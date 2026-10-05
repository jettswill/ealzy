import { z } from "zod";
import type { AppRepository, ProfileInput } from "../../repository.js";
import type { UserProfile } from "../../types.js";
import { languageOf } from "../../locale.js";

const emptyToNull = (value: unknown) => (value === "" || value === undefined ? null : value);
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

const optionalBool = z.preprocess(emptyToNull, z.boolean().nullable().optional());
const optionalText = z.preprocess(emptyToNull, z.string().trim().max(4000).nullable().optional());

export const CompanionSettingsSchema = z.preprocess(
  emptyToNull,
  z
    .object({
      morning_digest_enabled: optionalBool,
      morning_digest_time: optionalText,
      weekly_digest_enabled: optionalBool,
      weekly_digest_time: optionalText,
      evening_sync_enabled: optionalBool,
      evening_sync_time: optionalText,
      weekly_reflection_enabled: optionalBool,
      reengagement_enabled: optionalBool,
      timezone: optionalText,
      locale: optionalText,
      communication_style: optionalText,
      bio: optionalText,
      values: z.preprocess(
        emptyToNull,
        z.array(z.string().trim().min(1).max(120)).max(50).nullable().optional(),
      ),
    })
    .nullable(),
).optional();

export type CompanionSettings = NonNullable<z.infer<typeof CompanionSettingsSchema>>;

export const SETTINGS_TIME_KEYS = [
  "morning_digest_time",
  "weekly_digest_time",
  "evening_sync_time",
] as const;

export const SETTINGS_FLAG_KEYS = [
  "morning_digest_enabled",
  "weekly_digest_enabled",
  "evening_sync_enabled",
  "weekly_reflection_enabled",
  "reengagement_enabled",
] as const;

const CITY_TO_ZONE: { needle: string; zone: string }[] = [
  { needle: "калининград", zone: "Europe/Kaliningrad" },
  { needle: "kaliningrad", zone: "Europe/Kaliningrad" },
  { needle: "самар", zone: "Europe/Samara" },
  { needle: "samara", zone: "Europe/Samara" },
  { needle: "киров", zone: "Europe/Kirov" },
  { needle: "kirov", zone: "Europe/Kirov" },
  { needle: "екатеринбург", zone: "Asia/Yekaterinburg" },
  { needle: "екб", zone: "Asia/Yekaterinburg" },
  { needle: "yekaterinburg", zone: "Asia/Yekaterinburg" },
  { needle: "екатерин", zone: "Asia/Yekaterinburg" },
  { needle: "новосибир", zone: "Asia/Novosibirsk" },
  { needle: "novosibirsk", zone: "Asia/Novosibirsk" },
  { needle: "краснояр", zone: "Asia/Krasnoyarsk" },
  { needle: "krasnoyarsk", zone: "Asia/Krasnoyarsk" },
  { needle: "иркутск", zone: "Asia/Irkutsk" },
  { needle: "irkutsk", zone: "Asia/Irkutsk" },
  { needle: "владивосток", zone: "Asia/Vladivostok" },
  { needle: "vladivostok", zone: "Asia/Vladivostok" },
  { needle: "киев", zone: "Europe/Kyiv" },
  { needle: "kyiv", zone: "Europe/Kyiv" },
  { needle: "kiev", zone: "Europe/Kyiv" },
  { needle: "минск", zone: "Europe/Minsk" },
  { needle: "minsk", zone: "Europe/Minsk" },
  { needle: "берлин", zone: "Europe/Berlin" },
  { needle: "berlin", zone: "Europe/Berlin" },
  { needle: "лондон", zone: "Europe/London" },
  { needle: "london", zone: "Europe/London" },
  { needle: "париж", zone: "Europe/Paris" },
  { needle: "paris", zone: "Europe/Paris" },
  { needle: "нью йорк", zone: "America/New_York" },
  { needle: "new york", zone: "America/New_York" },
  { needle: "лос анджелес", zone: "America/Los_Angeles" },
  { needle: "los angeles", zone: "America/Los_Angeles" },
  { needle: "москв", zone: "Europe/Moscow" },
  { needle: "moscow", zone: "Europe/Moscow" },
  { needle: "питер", zone: "Europe/Moscow" },
  { needle: "петербург", zone: "Europe/Moscow" },
  { needle: "спб", zone: "Europe/Moscow" },
];

function fold(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zа-я0-9/ ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isValidTimeZone(zone: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeNotificationTime(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (TIME_RE.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function normalizeLocale(value: string | null | undefined, timezone = "UTC") {
  if (!value?.trim()) return null;
  const raw = value.trim();
  const language = languageOf(raw);
  if (/^[a-z]{2,3}-[A-Za-z0-9]+$/i.test(raw)) {
    return language === "en" ? raw.replace(/^en/i, "en") : raw.replace(/^ru/i, "ru");
  }
  if (language === "ru") return "ru-RU";
  if (timezone === "Europe/London" || timezone === "Europe/Dublin") return "en-GB";
  if (timezone.startsWith("Europe/") || timezone.startsWith("Africa/")) return "en-GB";
  return "en-US";
}

export function resolveTimeZone(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const raw = value.trim();
  if (isValidTimeZone(raw)) return raw;
  const hay = fold(raw);
  if (hay === "utc" || hay === "gmt") return "UTC";
  const hit = CITY_TO_ZONE.find((item) => hay.includes(item.needle));
  return hit?.zone ?? null;
}

export function compactSettings(patch: CompanionSettings | null | undefined): CompanionSettings | null {
  if (!patch) return null;
  const next: CompanionSettings = {};
  for (const [key, value] of Object.entries(patch) as [keyof CompanionSettings, unknown][]) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    (next as Record<string, unknown>)[key] = value;
  }
  return Object.keys(next).length ? next : null;
}

export function mergeSettings(
  base: CompanionSettings | null | undefined,
  overlay: CompanionSettings | null | undefined,
) {
  const left = compactSettings(base);
  const right = compactSettings(overlay);
  if (!left && !right) return null;
  return { ...left, ...right } as CompanionSettings;
}

function parseClock(blob: string, around = blob): string | null {
  const match = blob.match(
    /(?:в|на|at|to)\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*(утра|утром|дня|вечера|ночи|am|pm))?/iu,
  ) ?? blob.match(/(\d{1,2})[:.](\d{2})\s*(утра|утром|дня|вечера|ночи|am|pm)?/iu);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  if (Number.isNaN(hours) || hours > 23 || minutes > 59) return null;
  const period = (match[3] ?? around).toLocaleLowerCase();
  const pm = /вечера|ночи|pm/.test(period);
  const am = /утра|утром|am/.test(period) && !pm;
  if (pm && hours < 12) hours += 12;
  if (am && hours === 12) hours = 0;
  if (/ночи/i.test(period) && hours === 12) hours = 0;
  return normalizeNotificationTime(`${hours}:${String(minutes).padStart(2, "0")}`);
}

function wantsOff(text: string) {
  return /выключ|отключ|убери|не\s+присыл|не\s+шли|не\s+надо|stop|disable|turn\s+off|without/iu.test(
    text,
  );
}

function wantsOn(text: string) {
  return /включ|присыл|шли|верни|хочу|enable|turn\s+on|start\s+send/iu.test(text);
}

function channelOf(text: string): "morning" | "weekly" | "evening" | "all" | null {
  const hay = fold(text);
  const morning = /утр|morning|briefing|дайджест утра/.test(hay);
  const weekly = /недельн|weekly|понедельник/.test(hay);
  const evening = /вечер|evening|синк|sync/.test(hay);
  const all = /все\s+(уведомлен|сообщен|дайджест)|all\s+(notifications|digests|messages)/.test(hay);
  if (all || (morning && weekly && evening)) return "all";
  const hits = [
    morning ? "morning" : null,
    weekly ? "weekly" : null,
    evening ? "evening" : null,
  ].filter(Boolean);
  if (hits.length === 1) return hits[0] as "morning" | "weekly" | "evening";
  if (/уведомлен|нотифик|telegram|телеграм|дайджест|сообщен/.test(hay) && hits.length === 0)
    return "morning";
  return null;
}

function localeFromText(text: string) {
  if (/английск|english|switch to en|in english|по[- ]англий/iu.test(text)) return "en";
  if (/русск|russian|switch to ru|по[- ]русск/iu.test(text)) return "ru";
  return null;
}

function timezoneIntent(text: string) {
  return /часовой\s+пояс|timezone|time\s*zone|по\s+местному|поставь.*пояс/iu.test(text);
}

function settingsTalk(text: string) {
  return /уведомлен|нотифик|дайджест|телеграм|telegram|присыл|часовой\s+пояс|timezone|рефлекс|настройк|settings|синк|digest|briefing|reengagement|evening sync|тихие напомина|если я пропал|если пропаду|не\s+присыл|выключ.*вечер|выключ.*утр|включи.*утр|включи.*вечер|weekly reflection/iu.test(
    text,
  );
}

export function inferCompanionSettings(text: string): CompanionSettings | null {
  const trimmed = text.trim();
  if (trimmed.length < 4 || trimmed.length > 400) return null;
  const patch: CompanionSettings = {};
  const off = wantsOff(trimmed);
  const on = wantsOn(trimmed) && !off;
  const channel = channelOf(trimmed);
  const time = parseClock(trimmed);
  const applyChannel = (
    kind: "morning" | "weekly" | "evening",
    enabled?: boolean,
    clock?: string | null,
  ) => {
    if (kind === "morning") {
      if (enabled !== undefined) patch.morning_digest_enabled = enabled;
      if (clock) patch.morning_digest_time = clock;
    }
    if (kind === "weekly") {
      if (enabled !== undefined) patch.weekly_digest_enabled = enabled;
      if (clock) patch.weekly_digest_time = clock;
    }
    if (kind === "evening") {
      if (enabled !== undefined) patch.evening_sync_enabled = enabled;
      if (clock) patch.evening_sync_time = clock;
    }
  };

  if (settingsTalk(trimmed) && (channel || time)) {
    if (channel === "all") {
      const enabled = off ? false : on || Boolean(time) || undefined;
      for (const kind of ["morning", "weekly", "evening"] as const) applyChannel(kind, enabled, time);
    } else if (channel) {
      const enabled = off ? false : on || Boolean(time) || undefined;
      applyChannel(channel, enabled, time);
    } else if (time) {
      applyChannel("morning", off ? false : true, time);
    }
  }

  if (/рефлекс|weekly reflection/iu.test(trimmed)) {
    patch.weekly_reflection_enabled = off ? false : true;
  }
  if (/если я пропал|если пропаду|reengagement|напоминая?\s+если|тихие напомина/iu.test(trimmed)) {
    patch.reengagement_enabled = off ? false : true;
  }

  const locale = localeFromText(trimmed);
  if (locale && /язык|locale|language|переключ|switch|отвечай|говори/iu.test(trimmed)) {
    patch.locale = locale;
  }

  if (timezoneIntent(trimmed)) {
    const zone = resolveTimeZone(trimmed);
    if (zone) patch.timezone = zone;
  }

  const values = trimmed.match(
    /(?:ценност(?:и|ь)|values)\s*[:—\-–]\s*(.+)$/iu,
  );
  if (values?.[1]) {
    patch.values = values[1]
      .split(/[,;]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 50);
  }
  const bio = trimmed.match(/(?:био|bio|обо мне)\s*[:—\-–]\s*(.+)$/iu);
  if (bio?.[1]?.trim()) patch.bio = bio[1].trim().slice(0, 4000);
  const style = trimmed.match(/(?:стиль(?:\s+общения)?|communication style)\s*[:—\-–]\s*(.+)$/iu);
  if (style?.[1]?.trim()) patch.communication_style = style[1].trim().slice(0, 1000);

  return compactSettings(patch);
}

export function settingsToProfilePatch(
  patch: CompanionSettings,
  current: UserProfile,
): ProfileInput {
  const next: ProfileInput = {};
  if (typeof patch.morning_digest_enabled === "boolean")
    next.morning_digest_enabled = patch.morning_digest_enabled;
  if (typeof patch.weekly_digest_enabled === "boolean")
    next.weekly_digest_enabled = patch.weekly_digest_enabled;
  if (typeof patch.evening_sync_enabled === "boolean")
    next.evening_sync_enabled = patch.evening_sync_enabled;
  if (typeof patch.weekly_reflection_enabled === "boolean")
    next.weekly_reflection_enabled = patch.weekly_reflection_enabled;
  if (typeof patch.reengagement_enabled === "boolean")
    next.reengagement_enabled = patch.reengagement_enabled;

  const morningTime = normalizeNotificationTime(patch.morning_digest_time);
  const weeklyTime = normalizeNotificationTime(patch.weekly_digest_time);
  const eveningTime = normalizeNotificationTime(patch.evening_sync_time);
  if (morningTime) {
    next.morning_digest_time = morningTime;
    if (next.morning_digest_enabled === undefined) next.morning_digest_enabled = true;
  }
  if (weeklyTime) {
    next.weekly_digest_time = weeklyTime;
    if (next.weekly_digest_enabled === undefined) next.weekly_digest_enabled = true;
  }
  if (eveningTime) {
    next.evening_sync_time = eveningTime;
    if (next.evening_sync_enabled === undefined) next.evening_sync_enabled = true;
  }

  const zone = resolveTimeZone(patch.timezone ?? null) ?? (patch.timezone && isValidTimeZone(patch.timezone) ? patch.timezone : null);
  if (zone) next.timezone = zone;
  const locale = normalizeLocale(patch.locale ?? null, zone || current.timezone);
  if (locale) next.locale = locale;
  if (typeof patch.communication_style === "string")
    next.communication_style = patch.communication_style.slice(0, 1000);
  if (typeof patch.bio === "string") next.bio = patch.bio.slice(0, 4000);
  if (Array.isArray(patch.values)) next.values = patch.values.slice(0, 50);
  return next;
}

export async function applyCompanionSettings(
  repository: AppRepository,
  ownerId: string,
  patch: CompanionSettings | null | undefined,
) {
  const compact = compactSettings(patch);
  if (!compact) return { applied: {} as ProfileInput, profile: await repository.getProfile(ownerId) };
  const current = await repository.getProfile(ownerId);
  if (!current) return { applied: {} as ProfileInput, profile: null };
  const applied = settingsToProfilePatch(compact, current);
  if (!Object.keys(applied).length) return { applied, profile: current };
  const profile = await repository.updateProfile(ownerId, applied);
  return { applied, profile };
}

const FLAG_LABELS = {
  morning_digest_enabled: { ru: "утренний дайджест", en: "morning briefing" },
  weekly_digest_enabled: { ru: "недельный обзор", en: "weekly briefing" },
  evening_sync_enabled: { ru: "вечерний синк", en: "evening sync" },
  weekly_reflection_enabled: { ru: "недельную рефлексию", en: "weekly reflection" },
  reengagement_enabled: { ru: "напоминания, если пропаду", en: "quiet reengagement" },
} as const;

const TIME_LABELS = {
  morning_digest_time: { ru: "утро", en: "morning" },
  weekly_digest_time: { ru: "недельный обзор", en: "weekly briefing" },
  evening_sync_time: { ru: "вечер", en: "evening" },
} as const;

export function formatSettingsRecap(
  applied: ProfileInput,
  options: { locale?: string | null; telegramLinked?: boolean } = {},
) {
  const ru = languageOf(options.locale) !== "en";
  const parts: string[] = [];
  for (const key of SETTINGS_FLAG_KEYS) {
    const value = applied[key];
    if (typeof value !== "boolean") continue;
    if (key === "morning_digest_enabled" && applied.morning_digest_time) continue;
    if (key === "weekly_digest_enabled" && applied.weekly_digest_time) continue;
    if (key === "evening_sync_enabled" && applied.evening_sync_time) continue;
    const label = FLAG_LABELS[key][ru ? "ru" : "en"];
    if (ru) parts.push(value ? `Включила ${label}.` : `Выключила ${label}.`);
    else parts.push(value ? `Turned on ${label}.` : `Turned off ${label}.`);
  }
  for (const key of SETTINGS_TIME_KEYS) {
    const value = applied[key];
    if (typeof value !== "string") continue;
    const label = TIME_LABELS[key][ru ? "ru" : "en"];
    parts.push(ru ? `${label[0]!.toUpperCase()}${label.slice(1)} — в ${value}.` : `${label} is now ${value}.`);
  }
  if (applied.timezone) {
    parts.push(ru ? `Часовой пояс: ${applied.timezone}.` : `Timezone: ${applied.timezone}.`);
  }
  if (applied.locale) {
    parts.push(
      languageOf(applied.locale) === "en"
        ? "I'll reply in English."
        : "Дальше отвечаю по-русски.",
    );
  }
  if (applied.communication_style) {
    parts.push(ru ? `Стиль: ${applied.communication_style}.` : `Style: ${applied.communication_style}.`);
  }
  if (applied.bio) parts.push(ru ? "Обновила био." : "Updated bio.");
  if (applied.values) {
    parts.push(
      ru
        ? `Ценности: ${applied.values.join(", ") || "пусто"}.`
        : `Values: ${applied.values.join(", ") || "empty"}.`,
    );
  }
  if (
    options.telegramLinked === false &&
    (applied.morning_digest_enabled ||
      applied.weekly_digest_enabled ||
      applied.evening_sync_enabled ||
      applied.morning_digest_time ||
      applied.weekly_digest_time ||
      applied.evening_sync_time)
  ) {
    parts.push(
      ru
        ? "Чтобы письма доходили, открой Ealzy из Telegram-бота."
        : "Link Telegram so these messages can actually arrive.",
    );
  }
  return parts.join(" ");
}

export function workspaceSettings(
  profile: Pick<
    UserProfile,
    | "timezone"
    | "locale"
    | "communication_style"
    | "bio"
    | "values"
    | "weekly_reflection_enabled"
    | "morning_digest_enabled"
    | "morning_digest_time"
    | "weekly_digest_enabled"
    | "weekly_digest_time"
    | "evening_sync_enabled"
    | "evening_sync_time"
    | "reengagement_enabled"
  >,
  telegramLinked: boolean,
) {
  return {
    telegram_linked: telegramLinked,
    timezone: profile.timezone,
    locale: profile.locale,
    communication_style: profile.communication_style,
    bio: profile.bio,
    values: profile.values,
    weekly_reflection_enabled: profile.weekly_reflection_enabled,
    reengagement_enabled: profile.reengagement_enabled !== false,
    morning_digest_enabled: profile.morning_digest_enabled,
    morning_digest_time: profile.morning_digest_time,
    weekly_digest_enabled: profile.weekly_digest_enabled,
    weekly_digest_time: profile.weekly_digest_time,
    evening_sync_enabled: profile.evening_sync_enabled,
    evening_sync_time: profile.evening_sync_time,
  };
}
