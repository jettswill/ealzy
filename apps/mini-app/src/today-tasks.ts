import type { Task } from "./types";

export const EVENING_PLAN_HOUR = 20;
export const HOME_ARCHIVE_LINGER_MS = 5000;
export const HOME_SWIPE_DAYS = 7;

const openStatuses = new Set(["todo", "in_progress"]);
const archivedStatuses = new Set(["done", "cancelled"]);

export function isArchivedTask(task: Task) {
  return archivedStatuses.has(task.status);
}

function isListedTask(task: Task, includeIds?: ReadonlySet<string>) {
  return isOpenTask(task) || Boolean(includeIds?.has(task.id));
}

export function dateKeyInZone(value: Date | string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function addCalendarDays(dateKey: string, days: number) {
  const next = new Date(`${dateKey}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function localHour(now: Date, timezone: string) {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .find((part) => part.type === "hour")?.value;
  return Number(hour);
}

export function middayIso(dateKey: string) {
  return new Date(`${dateKey}T12:00:00`).toISOString();
}

function dueKey(task: Task, timezone: string) {
  const due = task.due_at ?? task.due_date ?? null;
  return due ? dateKeyInZone(due, timezone) : null;
}

export function isOpenTask(task: Task) {
  return openStatuses.has(task.status);
}

export const SORT_GAP = 1024;

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const leftDue = a.due_at ?? a.due_date;
    const rightDue = b.due_at ?? b.due_date;
    if (leftDue && rightDue) {
      const byTime = new Date(leftDue).getTime() - new Date(rightDue).getTime();
      if (byTime) return byTime;
    } else if (leftDue) {
      return -1;
    } else if (rightDue) {
      return 1;
    }
    const byValue = (b.value_score ?? 0) - (a.value_score ?? 0);
    if (byValue) return byValue;
    const left = a.sort_order;
    const right = b.sort_order;
    if (left != null && right != null && left !== right) return left - right;
    if (left != null && right == null) return -1;
    if (left == null && right != null) return 1;
    const created = (a.created_at ?? "").localeCompare(b.created_at ?? "");
    if (created) return created;
    return a.id.localeCompare(b.id);
  });
}

export function planListReorder(
  list: Task[],
  moved: Task,
  index: number,
): { id: string; sort_order: number }[] {
  const without = list.filter((task) => task.id !== moved.id);
  const clamped = Math.max(0, Math.min(index, without.length));
  const prev = without[clamped - 1]?.sort_order;
  const next = without[clamped]?.sort_order;
  if (prev != null && next != null && next - prev > 1) {
    return [{ id: moved.id, sort_order: Math.floor((prev + next) / 2) }];
  }
  if (prev != null && next == null) {
    return [{ id: moved.id, sort_order: prev + SORT_GAP }];
  }
  if (prev == null && next != null && next > 1) {
    return [{ id: moved.id, sort_order: Math.floor(next / 2) }];
  }
  const ordered = [...without.slice(0, clamped), moved, ...without.slice(clamped)];
  return ordered.map((task, order) => ({ id: task.id, sort_order: (order + 1) * SORT_GAP }));
}

export function tasksOnDate(
  tasks: Task[],
  timezone: string,
  dateKey: string,
  includeIds?: ReadonlySet<string>,
): Task[] {
  return sortTasks(
    tasks.filter((task) => isListedTask(task, includeIds) && dueKey(task, timezone) === dateKey),
  );
}

export function todaysTasks(
  tasks: Task[],
  timezone: string,
  now = new Date(),
  includeIds?: ReadonlySet<string>,
): Task[] {
  return tasksOnDate(tasks, timezone, dateKeyInZone(now, timezone), includeIds);
}

function isUserOwned(task: Task) {
  return (task.assignee ?? "user") !== "ealzy";
}

function completedKey(task: Task, timezone: string) {
  if (task.status !== "done") return null;
  const at = task.completed_at || task.updated_at;
  return at ? dateKeyInZone(at, timezone) : null;
}

export function completedTodayTasks(tasks: Task[], timezone: string, now = new Date()): Task[] {
  const today = dateKeyInZone(now, timezone);
  return tasks.filter((task) => completedKey(task, timezone) === today);
}

const WEEKDAY_FROM_MONDAY: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

export function weekdayShortInZone(now: Date, timezone: string) {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    })
      .formatToParts(now)
      .find((part) => part.type === "weekday")?.value ?? ""
  );
}

export function weekStartKey(now: Date, timezone: string) {
  const today = dateKeyInZone(now, timezone);
  const offset = WEEKDAY_FROM_MONDAY[weekdayShortInZone(now, timezone)] ?? 0;
  return addCalendarDays(today, -offset);
}

export function weekEndKey(now: Date, timezone: string) {
  return addCalendarDays(weekStartKey(now, timezone), 6);
}

export function isEndOfWeek(now: Date, timezone: string, hour = EVENING_PLAN_HOUR) {
  const weekday = weekdayShortInZone(now, timezone);
  if (weekday === "Sat" || weekday === "Sun") return true;
  return weekday === "Fri" && localHour(now, timezone) >= hour;
}

export type WeekStats = {
  completed: number;
  on_time: number;
  dated: number;
  percent: number;
};

export function weekStats(tasks: Task[], timezone: string, now = new Date()): WeekStats {
  const start = weekStartKey(now, timezone);
  const today = dateKeyInZone(now, timezone);
  const end = weekEndKey(now, timezone);
  let completed = 0;
  let onTime = 0;
  let late = 0;
  for (const task of tasks) {
    if (!isUserOwned(task)) continue;
    const doneKey = completedKey(task, timezone);
    if (doneKey && doneKey >= start && doneKey <= today) completed += 1;
    if (task.status === "cancelled") continue;
    const due = task.due_at ?? task.due_date;
    if (!due) continue;
    const dueKey = dateKeyInZone(due, timezone);
    if (dueKey < start || dueKey > end) continue;
    if (doneKey) {
      if (doneKey <= dueKey) onTime += 1;
      else late += 1;
      continue;
    }
    if (dueKey < today) late += 1;
  }
  const dated = onTime + late;
  return {
    completed,
    on_time: onTime,
    dated,
    percent: dated ? Math.round((onTime / dated) * 100) : 0,
  };
}

export function shouldShowWeekSummary(stats: WeekStats, now: Date, timezone: string) {
  return isEndOfWeek(now, timezone) && (stats.completed > 0 || stats.dated > 0);
}

export const STREAK_MILESTONES = [7, 14, 30, 90] as const;

export function completionStreak(tasks: Task[], timezone: string, now = new Date()) {
  const doneDays = new Set(
    tasks.map((task) => completedKey(task, timezone)).filter((key): key is string => Boolean(key)),
  );
  let cursor = dateKeyInZone(now, timezone);
  if (!doneDays.has(cursor)) cursor = addCalendarDays(cursor, -1);
  let streak = 0;
  while (doneDays.has(cursor)) {
    streak += 1;
    cursor = addCalendarDays(cursor, -1);
  }
  return streak;
}

export function streakMilestone(streak: number) {
  return [...STREAK_MILESTONES].reverse().find((days) => streak >= days) ?? null;
}

export function tomorrowsTasks(
  tasks: Task[],
  timezone: string,
  now = new Date(),
  includeIds?: ReadonlySet<string>,
): Task[] {
  return tasksOnDate(tasks, timezone, addCalendarDays(dateKeyInZone(now, timezone), 1), includeIds);
}

export function overdueTasks(
  tasks: Task[],
  timezone: string,
  now = new Date(),
  includeIds?: ReadonlySet<string>,
): Task[] {
  const today = dateKeyInZone(now, timezone);
  return sortTasks(
    tasks.filter((task) => {
      if (!isListedTask(task, includeIds)) return false;
      const key = dueKey(task, timezone);
      return Boolean(key && key < today);
    }),
  );
}

export function undatedTasks(
  tasks: Task[],
  timezone: string,
  includeIds?: ReadonlySet<string>,
): Task[] {
  return sortTasks(
    tasks.filter((task) => isListedTask(task, includeIds) && !dueKey(task, timezone)),
  );
}

export function laterTasks(
  tasks: Task[],
  timezone: string,
  now = new Date(),
  includeIds?: ReadonlySet<string>,
): Task[] {
  const tomorrow = addCalendarDays(dateKeyInZone(now, timezone), 1);
  return sortTasks(
    tasks.filter((task) => {
      if (!isListedTask(task, includeIds)) return false;
      const key = dueKey(task, timezone);
      return Boolean(key && key > tomorrow);
    }),
  ).sort((a, b) => {
    const left = dueKey(a, timezone) ?? "";
    const right = dueKey(b, timezone) ?? "";
    if (left !== right) return left.localeCompare(right);
    return 0;
  });
}

export function laterDays(
  tasks: Task[],
  timezone: string,
  now = new Date(),
  includeIds?: ReadonlySet<string>,
): { dateKey: string; tasks: Task[] }[] {
  const groups: { dateKey: string; tasks: Task[] }[] = [];
  for (const task of laterTasks(tasks, timezone, now, includeIds)) {
    const key = dueKey(task, timezone);
    if (!key) continue;
    const last = groups[groups.length - 1];
    if (last?.dateKey === key) last.tasks.push(task);
    else groups.push({ dateKey: key, tasks: [task] });
  }
  return groups;
}

export function plannedLaterDays(
  tasks: Task[],
  timezone: string,
  now = new Date(),
  includeIds?: ReadonlySet<string>,
  windowDays = HOME_SWIPE_DAYS,
): { dateKey: string; tasks: Task[] }[] {
  const today = dateKeyInZone(now, timezone);
  const grouped = laterDays(tasks, timezone, now, includeIds);
  const byKey = new Map(grouped.map((group) => [group.dateKey, group.tasks]));
  const days: { dateKey: string; tasks: Task[] }[] = [];
  const seen = new Set<string>();
  for (let offset = 2; offset < windowDays; offset += 1) {
    const dateKey = addCalendarDays(today, offset);
    days.push({ dateKey, tasks: byKey.get(dateKey) ?? [] });
    seen.add(dateKey);
  }
  for (const group of grouped) {
    if (!seen.has(group.dateKey)) days.push(group);
  }
  return days;
}

export function todayIsClear(tasks: Task[], timezone: string, now = new Date()) {
  return todaysTasks(tasks, timezone, now).length === 0;
}

export function shouldShowTomorrowPlan(
  tasks: Task[],
  timezone: string,
  now = new Date(),
  hour = EVENING_PLAN_HOUR,
) {
  return localHour(now, timezone) >= hour && todayIsClear(tasks, timezone, now);
}

function bulletList(tasks: Task[]) {
  return tasks.map((task) => `• ${task.title}`).join("\n");
}

export function pickTodayPrompt(undated: Task[], language: "ru" | "en") {
  if (language === "en") {
    const parts = [
      "Help me pick a realistic set of tasks for today. Estimate the effort of each one and only put on today what can actually fit — don't overload the day. Set due_at for the ones you choose. Don't invent facts.",
    ];
    if (undated.length) parts.push(`No date yet:\n${bulletList(undated)}`);
    else
      parts.push(
        "There are no undated tasks to pull onto today. Help me sketch a realistic day by effort.",
      );
    return parts.join("\n\n");
  }
  const parts = [
    "Помоги подобрать реалистичный набор дел на сегодня. Оцени ожидаемые трудозатраты каждого и поставь на сегодня только то, что реально влезает — не перегружай день. Выбранным поставь срок на сегодня (due_at). Не выдумывай факты.",
  ];
  if (undated.length) parts.push(`Без даты:\n${bulletList(undated)}`);
  else parts.push("Дел без даты нет. Помоги набросать реалистичный день по трудозатратам.");
  return parts.join("\n\n");
}

export function todayDiscussPrompt(
  today: Task[],
  overdue: Task[],
  undated: Task[],
  language: "ru" | "en",
) {
  if (language === "en") {
    const parts = ["Here's my day. Help me prioritize. Don't invent facts."];
    if (overdue.length) parts.push(`Overdue:\n${bulletList(overdue)}`);
    if (today.length) parts.push(`Today:\n${bulletList(today)}`);
    else parts.push("Nothing dated for today yet.");
    if (undated.length) parts.push(`No date yet:\n${bulletList(undated)}`);
    return parts.join("\n\n");
  }
  const parts = ["Вот мой день. Помоги приоритизировать. Не выдумывай факты."];
  if (overdue.length) parts.push(`Просрочено:\n${bulletList(overdue)}`);
  if (today.length) parts.push(`Сегодня:\n${bulletList(today)}`);
  else parts.push("На сегодня дел с датой пока нет.");
  if (undated.length) parts.push(`Без даты:\n${bulletList(undated)}`);
  return parts.join("\n\n");
}

export function tomorrowDiscussPrompt(tasks: Task[], language: "ru" | "en") {
  if (!tasks.length) {
    return language === "en"
      ? "Tomorrow has no dated tasks yet. Help me sketch a realistic plan: priorities, logistics, and order. Don't invent facts."
      : "На завтра дел с датой нет. Помоги набросать реалистичный план: приоритеты, логистика, порядок. Не выдумывай факты.";
  }
  const list = bulletList(tasks);
  return language === "en"
    ? `Let's go through tomorrow's plan:\n${list}\nHelp me prioritize, think through logistics and order, and suggest concrete edits. Don't invent facts.`
    : `Давай разберём план на завтра:\n${list}\nПомоги приоритизировать, продумать логистику и порядок. Предложи конкретные правки. Не выдумывай факты.`;
}

export function scheduleTomorrowPrompt(undated: Task[], tomorrow: Task[], language: "ru" | "en") {
  if (language === "en") {
    const parts = ["Help me plan tomorrow. Don't invent facts."];
    if (tomorrow.length) parts.push(`Already dated for tomorrow:\n${bulletList(tomorrow)}`);
    if (undated.length) parts.push(`No date yet:\n${bulletList(undated)}`);
    else parts.push("No undated tasks to pull onto tomorrow.");
    return parts.join("\n\n");
  }
  const parts = ["Помоги запланировать завтра. Не выдумывай факты."];
  if (tomorrow.length) parts.push(`Уже на завтра:\n${bulletList(tomorrow)}`);
  if (undated.length) parts.push(`Без даты:\n${bulletList(undated)}`);
  else parts.push("Дел без даты нет.");
  return parts.join("\n\n");
}
