import type { Task, TaskRecurrenceFrequency } from "./types.js";

export type RecurrenceTemplate = Pick<
  Task,
  | "title"
  | "description"
  | "person_id"
  | "space_id"
  | "goal_id"
  | "project_id"
  | "kind"
  | "activity_type"
  | "value_score"
  | "estimate_minutes"
  | "importance"
  | "urgency"
  | "assignee"
>;

export function recurrenceTemplate(task: Task): RecurrenceTemplate {
  return {
    title: task.title,
    description: task.description,
    person_id: task.person_id,
    space_id: task.space_id,
    goal_id: task.goal_id,
    project_id: task.project_id,
    kind: task.kind ?? "task",
    activity_type: task.activity_type ?? null,
    value_score: task.value_score ?? null,
    estimate_minutes: task.estimate_minutes ?? null,
    importance: task.importance ?? 3,
    urgency: task.urgency ?? 3,
    assignee: task.assignee ?? "user",
  };
}

function addPeriods(value: string, frequency: TaskRecurrenceFrequency, count: number): string {
  const date = new Date(value);
  if (frequency === "daily") date.setUTCDate(date.getUTCDate() + count);
  if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + 7 * count);
  if (frequency === "monthly") {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + count);
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date.toISOString();
}

export function nextRecurrenceAt(value: string, frequency: TaskRecurrenceFrequency): string {
  return addPeriods(value, frequency, 1);
}

function localDateKey(value: string | Date, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

// Следующий экземпляр регулярной задачи после закрытия текущего.
// Пропущенные дни не воскрешаем: если закрыли просроченный экземпляр,
// новый ставим на ближайшую дату по расписанию начиная с сегодняшнего дня
// пользователя, а не на следующий уже прошедший день. Иначе закрытие
// просрочки порождало цепочку новых просрочек — по одной на каждый пропуск.
export function nextUpcomingRecurrenceAt(
  anchor: string,
  frequency: TaskRecurrenceFrequency,
  now: Date = new Date(),
  timezone = "UTC",
): string {
  const today = localDateKey(now, timezone);
  let count = 1;
  let next = addPeriods(anchor, frequency, count);
  while (localDateKey(next, timezone) < today && count < 5000) {
    count += 1;
    next = addPeriods(anchor, frequency, count);
  }
  return next;
}
