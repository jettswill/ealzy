import type { AppRepository } from "../../repository.js";
import type { QuotaPeriod, QuotaPlan, UsageHour } from "../../types.js";

/** Доля лимита, после которой предупреждаем, что запросы заканчиваются. */
export const LOW_SHARE = 0.8;
const HOUR = 3_600_000;

export type QuotaState = "ok" | "low" | "exhausted";

export type QuotaStatus = {
  plan: string;
  plan_title: string;
  plan_until: string | null;
  /** Лимиты включены в админке. Выключены — всё считается, но ничего не блокируется. */
  enforced: boolean;
  state: QuotaState;
  period: {
    kind: QuotaPeriod;
    limit: number;
    used: number;
    resets_at: string;
  };
  window: {
    hours: number;
    limit: number;
    used: number;
    resets_at: string | null;
  };
  /** Когда облако снова станет доступно, если сейчас исчерпано. */
  available_at: string | null;
};

export class QuotaExceededError extends Error {
  status = 429;
  code = "QUOTA_EXCEEDED";
  constructor(public details: QuotaStatus) {
    super(quotaMessage(details));
  }
}

/** Начало текущего периода: неделя — с понедельника, месяц — с 1-го числа (UTC). */
export function periodStart(kind: QuotaPeriod, at: Date): Date {
  const day = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  if (kind === "month") return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const weekday = (day.getUTCDay() + 6) % 7; // понедельник = 0
  return new Date(day.getTime() - weekday * 24 * HOUR);
}

export function periodEnd(kind: QuotaPeriod, at: Date): Date {
  const start = periodStart(kind, at);
  if (kind === "month") {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }
  return new Date(start.getTime() + 7 * 24 * HOUR);
}

const sum = (rows: UsageHour[]) => rows.reduce((total, row) => total + row.total_tokens, 0);

export function computeQuota(input: {
  plan: QuotaPlan;
  planUntil: string | null;
  enforced: boolean;
  hours: UsageHour[];
  at: Date;
}): QuotaStatus {
  const { plan, enforced, hours, at } = input;
  const start = periodStart(plan.period, at).toISOString();
  const periodUsed = sum(hours.filter((row) => row.hour_start >= start));

  const windowFrom = new Date(
    Math.floor(at.getTime() / HOUR) * HOUR - (plan.window_hours - 1) * HOUR,
  ).toISOString();
  const windowRows = hours.filter((row) => row.hour_start >= windowFrom);
  const windowUsed = sum(windowRows);

  // Окно скользит: лимит вернётся, когда «выпадут» самые старые часы.
  let windowResets: string | null = null;
  if (plan.window_tokens > 0 && windowUsed >= plan.window_tokens) {
    let remaining = windowUsed;
    for (const row of windowRows) {
      remaining -= row.total_tokens;
      if (remaining < plan.window_tokens) {
        windowResets = new Date(
          Date.parse(row.hour_start) + plan.window_hours * HOUR,
        ).toISOString();
        break;
      }
    }
  }

  const periodResets = periodEnd(plan.period, at).toISOString();
  const periodOut = plan.period_tokens > 0 && periodUsed >= plan.period_tokens;
  const windowOut = windowResets !== null;
  const periodLow = plan.period_tokens > 0 && periodUsed >= plan.period_tokens * LOW_SHARE;
  const windowLow = plan.window_tokens > 0 && windowUsed >= plan.window_tokens * LOW_SHARE;

  const state: QuotaState =
    periodOut || windowOut ? "exhausted" : periodLow || windowLow ? "low" : "ok";
  const available_at = periodOut ? periodResets : windowOut ? windowResets : null;

  return {
    plan: plan.plan,
    plan_title: plan.title,
    plan_until: input.planUntil,
    enforced,
    state,
    period: {
      kind: plan.period,
      limit: plan.period_tokens,
      used: periodUsed,
      resets_at: periodResets,
    },
    window: {
      hours: plan.window_hours,
      limit: plan.window_tokens,
      used: windowUsed,
      resets_at: windowResets,
    },
    available_at,
  };
}

export async function loadQuota(
  repository: AppRepository,
  ownerId: string,
  at = new Date(),
): Promise<QuotaStatus> {
  const [plans, userPlan, enforced, isAdmin] = await Promise.all([
    repository.listQuotaPlans(),
    repository.getUserPlan(ownerId),
    repository.getQuotaEnforced(),
    repository.isAdmin(ownerId),
  ]);
  // Администратор пользуется без лимитов, что бы ни стояло в его тарифе.
  const active = isAdmin
    ? { plan: "unlimited", plan_until: null }
    : userPlan && (!userPlan.plan_until || Date.parse(userPlan.plan_until) > at.getTime())
      ? userPlan
      : null;
  const plan =
    plans.find((x) => x.plan === (active?.plan ?? "free")) ??
    plans.find((x) => x.plan === "free") ??
    ({
      plan: "free",
      title: "Бесплатно",
      period: "week",
      period_tokens: 0,
      window_hours: 5,
      window_tokens: 0,
      updated_at: at.toISOString(),
    } satisfies QuotaPlan);
  // Хватает данных с начала месяца или с начала окна — что раньше.
  const since = new Date(
    Math.min(
      periodStart(plan.period, at).getTime(),
      Math.floor(at.getTime() / HOUR) * HOUR - plan.window_hours * HOUR,
    ),
  ).toISOString();
  const hours = await repository.listUsageHours(ownerId, since);
  return computeQuota({
    plan,
    planUntil: active?.plan_until ?? null,
    enforced,
    hours,
    at,
  });
}

/** Перед облачным ответом: при исчерпанном и включённом лимите — 429 QUOTA_EXCEEDED. */
export async function assertCloudQuota(repository: AppRepository, ownerId: string) {
  const status = await loadQuota(repository, ownerId);
  if (status.enforced && status.state === "exhausted") throw new QuotaExceededError(status);
  return status;
}

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** «в пятницу, 21 ноября, в 15:00» по Москве — для сообщений в Telegram. */
export function formatReturn(iso: string, timeZone = "Europe/Moscow") {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${Number(get("day"))} ${MONTHS[Number(get("month")) - 1]} в ${get("hour")}:${get("minute")}`;
}

export function quotaMessage(status: QuotaStatus, timeZone?: string) {
  const when = status.available_at ? formatReturn(status.available_at, timeZone) : null;
  const scope =
    status.available_at === status.period.resets_at
      ? status.period.kind === "week"
        ? "на эту неделю"
        : "на этот месяц"
      : "на ближайшие часы";
  return [
    `Облачные запросы ${scope} закончились${when ? ` — вернусь в полную силу ${when}` : ""}.`,
    "В приложении Ealzy можно продолжать бесплатно: «Ещё» → «Илзи на iPhone».",
  ].join(" ");
}
