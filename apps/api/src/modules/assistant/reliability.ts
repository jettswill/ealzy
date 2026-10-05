import { languageOf } from "../../locale.js";
import type { Task } from "../../types.js";
import { companionClock } from "./companion-workspace.js";

export const RELIABILITY_ACHIEVEMENTS = [7, 30, 60, 100, 360] as const;
export const RELIABILITY_SOLID = 60;
export const RELIABILITY_EXCELLENT = 90;

export type ReliabilityPraise = "none" | "solid" | "excellent";

export type AchievementCommunity = {
  users: number;
  holders: Record<(typeof RELIABILITY_ACHIEVEMENTS)[number], number>;
};

export type ReliabilityStats = {
  percent: number;
  on_time: number;
  dated: number;
  current_streak: number;
  best_streak: number;
  achievements: number[];
  praise: ReliabilityPraise;
  community?: AchievementCommunity;
};

type TaskLike = Pick<Task, "status" | "due_at"> & {
  assignee?: Task["assignee"] | null;
  completed_at?: string | null;
  updated_at?: string | null;
};

function isUserTask(task: TaskLike) {
  return (task.assignee ?? "user") !== "ealzy";
}

function dateOf(timezone: string, value: Date | string) {
  return companionClock(timezone, new Date(value)).date;
}

function addCalendarDays(dateKey: string, days: number) {
  const next = new Date(`${dateKey}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function completedOn(task: TaskLike, timezone: string) {
  if (task.status !== "done") return null;
  const at = task.completed_at || task.updated_at;
  return at ? dateOf(timezone, at) : null;
}

function dailyRate(
  tasks: TaskLike[],
  dateKey: string,
  timezone: string,
  today: string,
): number | null {
  const due = tasks.filter((task) => dateOf(timezone, task.due_at!) === dateKey);
  if (!due.length) return null;
  if (dateKey === today) {
    const settled = due.filter((task) => task.status === "done");
    if (!settled.length) return null;
    const onTime = settled.filter((task) => (completedOn(task, timezone) ?? dateKey) <= dateKey)
      .length;
    return onTime / settled.length;
  }
  const onTime = due.filter((task) => {
    const completeKey = completedOn(task, timezone);
    return Boolean(completeKey && completeKey <= dateKey);
  }).length;
  return onTime / due.length;
}

function streaks(tasks: TaskLike[], timezone: string, today: string) {
  if (!tasks.length) return { current_streak: 0, best_streak: 0 };
  const start = tasks
    .map((task) => dateOf(timezone, task.due_at!))
    .reduce((earliest, key) => (key < earliest ? key : earliest));
  const days: boolean[] = [];
  for (let day = start; day <= today; day = addCalendarDays(day, 1)) {
    const rate = dailyRate(tasks, day, timezone, today);
    if (rate == null) continue;
    days.push(rate * 100 >= RELIABILITY_EXCELLENT);
  }
  let best = 0;
  let run = 0;
  for (const ok of days) {
    if (ok) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  let current = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (!days[index]) break;
    current += 1;
  }
  return { current_streak: current, best_streak: best };
}

function isSettled(
  task: TaskLike,
  timezone: string,
  today: string,
): { dueKey: string; completeKey: string | null } | null {
  const dueKey = dateOf(timezone, task.due_at!);
  const completeKey = completedOn(task, timezone);
  if (completeKey) return { dueKey, completeKey };
  if (dueKey < today) return { dueKey, completeKey: null };
  return null;
}

export function computeReliability(
  tasks: TaskLike[],
  timezone: string,
  now = new Date(),
): ReliabilityStats {
  const today = companionClock(timezone, now).date;
  const dated = tasks.filter(
    (task) => isUserTask(task) && task.status !== "cancelled" && task.due_at,
  );
  let onTime = 0;
  let late = 0;
  for (const task of dated) {
    const settled = isSettled(task, timezone, today);
    if (!settled) continue;
    if (settled.completeKey && settled.completeKey <= settled.dueKey) onTime += 1;
    else late += 1;
  }
  const sample = onTime + late;
  const percent = sample ? Math.round((onTime / sample) * 100) : 0;
  const praise: ReliabilityPraise =
    sample >= 3 && percent >= RELIABILITY_EXCELLENT
      ? "excellent"
      : sample >= 3 && percent >= RELIABILITY_SOLID
        ? "solid"
        : "none";
  const { current_streak, best_streak } = streaks(dated, timezone, today);
  return {
    percent,
    on_time: onTime,
    dated: sample,
    current_streak,
    best_streak,
    achievements: RELIABILITY_ACHIEVEMENTS.filter((days) => best_streak >= days),
    praise,
  };
}

export type ReliabilityCohortRow = {
  timezone: string;
  tasks: TaskLike[];
};

export function summarizeAchievementHolders(
  cohort: ReliabilityCohortRow[],
  now = new Date(),
): AchievementCommunity {
  const holders = Object.fromEntries(
    RELIABILITY_ACHIEVEMENTS.map((days) => [days, 0]),
  ) as AchievementCommunity["holders"];
  for (const row of cohort) {
    const stats = computeReliability(row.tasks, row.timezone || "UTC", now);
    for (const days of RELIABILITY_ACHIEVEMENTS) {
      if (stats.achievements.includes(days)) holders[days] += 1;
    }
  }
  return { users: cohort.length, holders };
}

export function reliabilityPortraitLine(
  stats: ReliabilityStats,
  locale: string | null | undefined,
) {
  if (!stats.dated) return "";
  const ru = languageOf(locale) !== "en";
  const parts = [
    ru ? `Дела в срок: ${stats.percent}%.` : `On-time tasks: ${stats.percent}%.`,
  ];
  if (stats.praise === "excellent") {
    parts.push(
      ru
        ? "Закрываете почти всё вовремя — редкая точность."
        : "Almost everything lands on time — rare precision.",
    );
  } else if (stats.praise === "solid") {
    parts.push(
      ru
        ? "Больше половины дел успеваете к сроку — на вас можно рассчитывать."
        : "More than half of dated work lands on time — people can count on you.",
    );
  }
  if (stats.best_streak >= 7) {
    parts.push(
      ru
        ? `Дней выше 90%: ${stats.best_streak}.`
        : `Days above 90%: ${stats.best_streak}.`,
    );
  }
  return parts.join(" ");
}
