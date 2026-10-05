import type { Goal, SelfPromise, SelfPromiseCheckin, Task } from "./types.js";

export const PROMISE_CHECKIN_GAP_DAYS = 3;
export const PROMISE_FIRST_CHECKIN_DAYS = 1;
export const PRAISE_MILESTONES = [7, 14, 30, 90] as const;

const counted = new Set(["todo", "in_progress", "done"]);
const open = new Set(["todo", "in_progress"]);

export function daysBetween(from: string | Date, to: Date) {
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((to.getTime() - start) / 86_400_000));
}

export function computeGoalStats(goal: Goal, linkedTasks: Task[], now = new Date()) {
  const tasks = linkedTasks.filter((task) => counted.has(task.status));
  const done = tasks.filter((task) => task.status === "done").length;
  const openCount = tasks.filter((task) => open.has(task.status)).length;
  return {
    task_count: tasks.length,
    done_count: done,
    open_count: openCount,
    progress: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    days_active: daysBetween(goal.created_at, now),
  };
}

export function withGoalStats(goal: Goal, allTasks: Task[], now = new Date()): Goal {
  const linked = allTasks.filter((task) => task.goal_id === goal.id);
  return { ...goal, stats: computeGoalStats(goal, linked, now) };
}

export function praiseMilestone(keepingDays: number, lastBroken: boolean) {
  if (lastBroken || keepingDays <= 0) return null;
  return [...PRAISE_MILESTONES].reverse().find((days) => keepingDays >= days) ?? null;
}

export function computePromiseStats(
  promise: SelfPromise,
  checkins: SelfPromiseCheckin[],
  now = new Date(),
) {
  const mine = checkins
    .filter((item) => item.promise_id === promise.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const last = mine[0] ?? null;
  const lastBroken = mine.find((item) => item.status === "broken") ?? null;
  const lastIsBroken = last?.status === "broken";
  const streakStart = lastIsBroken
    ? last.created_at
    : (lastBroken?.created_at ?? promise.started_at);
  const keepingDays = lastIsBroken ? 0 : daysBetween(streakStart, now);
  const sinceLast = daysBetween(last?.created_at ?? promise.started_at, now);
  const gap = last ? PROMISE_CHECKIN_GAP_DAYS : PROMISE_FIRST_CHECKIN_DAYS;
  return {
    keeping_days: keepingDays,
    keeping_count: mine.filter((item) => item.status === "keeping").length,
    struggling_count: mine.filter((item) => item.status === "struggling").length,
    broken_count: mine.filter((item) => item.status === "broken").length,
    last_checkin_at: last?.created_at ?? null,
    last_checkin_status: last?.status ?? null,
    due_for_checkin: promise.status === "active" && sinceLast >= gap,
    praise_days: praiseMilestone(keepingDays, lastIsBroken),
  };
}

export function withPromiseStats(
  promise: SelfPromise,
  checkins: SelfPromiseCheckin[],
  now = new Date(),
): SelfPromise {
  return {
    ...promise,
    stats: computePromiseStats(promise, checkins, now),
    recent_checkins: checkins
      .filter((item) => item.promise_id === promise.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 8),
  };
}
