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

export function nextRecurrenceAt(value: string, frequency: TaskRecurrenceFrequency): string {
  const date = new Date(value);
  if (frequency === "daily") date.setUTCDate(date.getUTCDate() + 1);
  if (frequency === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  if (frequency === "monthly") {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date.toISOString();
}
