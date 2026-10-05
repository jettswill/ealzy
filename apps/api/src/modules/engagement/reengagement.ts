import type { AppRepository } from "../../repository.js";
import type { Task, UserProfile } from "../../types.js";
import { languageOf } from "../../locale.js";
import type { TelegramGateway } from "../../infrastructure/telegram.js";
import { trackFunnelEvent } from "./events.js";

const isUserTask = (task: Task) => (task.assignee ?? "user") !== "ealzy";

export const REENGAGEMENT_D1_MS = 24 * 3600_000;
export const REENGAGEMENT_D3_MS = 72 * 3600_000;
export const REENGAGEMENT_GAP_MS = 48 * 3600_000;
export const LAST_ACTIVE_TOUCH_MS = 5 * 60_000;

export type ReengagementKind = "d1" | "d3";

function dateInZone(timeZone: string, at: Date) {
  let zone = timeZone || "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format(at);
  } catch {
    zone = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function openDueDate(task: Task, timeZone: string) {
  if (task.status === "done" || task.status === "cancelled") return null;
  return task.due_at ? dateInZone(timeZone, new Date(task.due_at)) : null;
}

export function reengagementKind(
  lastActiveAt: string | null | undefined,
  now = new Date(),
): ReengagementKind | null {
  if (!lastActiveAt) return null;
  const idle = now.getTime() - Date.parse(lastActiveAt);
  if (Number.isNaN(idle) || idle < REENGAGEMENT_D1_MS) return null;
  return idle >= REENGAGEMENT_D3_MS ? "d3" : "d1";
}

export function canNudge(lastReengagementAt: string | null | undefined, now = new Date()) {
  if (!lastReengagementAt) return true;
  const elapsed = now.getTime() - Date.parse(lastReengagementAt);
  return Number.isNaN(elapsed) || elapsed >= REENGAGEMENT_GAP_MS;
}

export async function touchLastActive(repository: AppRepository, ownerId: string) {
  const profile = await repository.getProfile(ownerId);
  if (!profile) return;
  if (
    profile.last_active_at &&
    Date.now() - Date.parse(profile.last_active_at) < LAST_ACTIVE_TOUCH_MS
  ) {
    return;
  }
  await repository.updateProfile(ownerId, { last_active_at: new Date().toISOString() });
}

export function composeReengagementMessage(
  kind: ReengagementKind,
  locale: string,
  todayCount: number,
  overdueCount: number,
  brokenStreak: boolean,
  goalTitle?: string | null,
) {
  const ru = languageOf(locale) !== "en";
  const goal = goalTitle?.trim();
  if (kind === "d1") {
    if (todayCount > 0) {
      return ru
        ? `У тебя ${todayCount} ${todayCount === 1 ? "дело" : "дел"} на сегодня. Как дела?`
        : `You have ${todayCount} task${todayCount === 1 ? "" : "s"} for today. How's it going?`;
    }
    if (goal) {
      return ru
        ? `Цель «${goal}» никуда не делась. Какой один шаг на 20 минут сегодня?`
        : `The goal “${goal}” is still there. What's one 20-minute step today?`;
    }
    return ru
      ? "Я рядом. Скинь 3 дела из головы — поставлю на сегодня."
      : "I'm here. Dump 3 things on your mind — I'll date them today.";
  }
  const overdue = ru
    ? overdueCount
      ? `${overdueCount} просроченных`
      : "просрочки нет"
    : overdueCount
      ? `${overdueCount} overdue`
      : "nothing overdue";
  const streak = brokenStreak
    ? ru
      ? " стрик обещания прерван."
      : " a promise streak broke."
    : "";
  if (overdueCount || brokenStreak) {
    const goalBit = goal
      ? ru
        ? ` Цель «${goal}» никуда не делась.`
        : ` The goal “${goal}” is still there.`
      : "";
    return ru
      ? `Давно не виделись. Вот что изменилось: ${overdue}.${streak}${goalBit}`
      : `It's been a while. Here's what changed: ${overdue}.${streak}${goalBit}`;
  }
  if (goal) {
    return ru
      ? `Давно не виделись. Цель «${goal}» никуда не делась. Один шаг сегодня?`
      : `It's been a while. The goal “${goal}” is still there. One step today?`;
  }
  return ru
    ? "Давно не виделись. Я всё ещё помню тебя — напиши, что сейчас важнее."
    : "It's been a while. I still remember you — tell me what matters most right now.";
}

export async function runReengagement(
  repository: AppRepository,
  telegram: TelegramGateway,
  at = new Date(),
): Promise<{ sent: number }> {
  const profiles = await repository.listNotificationProfiles();
  let sent = 0;
  for (const profile of profiles) {
    if (profile.reengagement_enabled === false) continue;
    if (!canNudge(profile.last_reengagement_at, at)) continue;
    const kind = reengagementKind(profile.last_active_at, at);
    if (!kind) continue;
    const user = await repository.getUser(profile.owner_id);
    if (!user?.telegram_id) continue;
    const today = dateInZone(profile.timezone, at);
    const [tasks, promises, checkins, goals] = await Promise.all([
      repository.listTasks(profile.owner_id),
      repository.listPromises(profile.owner_id),
      repository.listPromiseCheckins(profile.owner_id),
      repository.listGoals(profile.owner_id),
    ]);
    const userTasks = tasks.filter(isUserTask);
    const todayCount = userTasks.filter(
      (task) => openDueDate(task, profile.timezone) === today,
    ).length;
    const overdueCount = userTasks.filter((task) => {
      const due = openDueDate(task, profile.timezone);
      return Boolean(due && due < today);
    }).length;
    const brokenStreak = promises.some((item) => {
      const last = checkins
        .filter((row) => row.promise_id === item.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return last?.status === "broken";
    });
    const goalTitle = goals.find((goal) => goal.status === "active")?.title ?? null;
    const text = composeReengagementMessage(
      kind,
      profile.locale,
      todayCount,
      overdueCount,
      brokenStreak,
      goalTitle,
    );
    await telegram.sendMessage(user.telegram_id, text);
    await trackFunnelEvent(repository, profile.owner_id, "reengagement_sent", { kind });
    await repository.updateProfile(profile.owner_id, {
      last_reengagement_at: at.toISOString(),
    });
    profile.last_reengagement_at = at.toISOString();
    sent += 1;
  }
  return { sent };
}

export function profileAllowsReengagement(profile: Pick<UserProfile, "reengagement_enabled">) {
  return profile.reengagement_enabled !== false;
}
