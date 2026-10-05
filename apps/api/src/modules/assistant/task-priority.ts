import type { Task } from "../../types.js";

const openStatuses = new Set(["todo", "in_progress"]);

export function isOpenTask(task: Pick<Task, "status">) {
  return openStatuses.has(task.status);
}

export function isPushTask(
  task: Pick<Task, "status"> & { importance?: number | null; urgency?: number | null },
) {
  if (!isOpenTask(task)) return false;
  return (task.importance ?? 3) >= 4 && (task.urgency ?? 3) >= 4;
}

export function pushScore(task: { importance?: number | null; urgency?: number | null }) {
  return (task.importance ?? 3) * 10 + (task.urgency ?? 3);
}

export function pushTasks(tasks: Task[]): Task[] {
  return tasks.filter(isPushTask).sort((a, b) => pushScore(b) - pushScore(a) || a.title.localeCompare(b.title));
}
