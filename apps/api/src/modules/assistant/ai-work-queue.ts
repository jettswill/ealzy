import type { Task } from "../../types.js";

export const AI_WORK_STALE_MS = 12 * 60 * 1000;
export const AI_WORK_MAX_ATTEMPTS = 3;

export function isEalzyTask(task: Pick<Task, "assignee">) {
  return task.assignee === "ealzy";
}

export function isDueAiWork(task: Task, now: Date, maxAttempts = AI_WORK_MAX_ATTEMPTS) {
  if (!isEalzyTask(task) || task.status !== "todo") return false;
  if ((task.agent_attempts ?? 0) >= maxAttempts) return false;
  if (!task.due_at) return true;
  const due = Date.parse(task.due_at);
  return !Number.isNaN(due) && due <= now.getTime();
}

export function isFreshAiLock(task: Task, now: Date, staleMs = AI_WORK_STALE_MS) {
  if (!isEalzyTask(task) || task.status !== "in_progress" || !task.agent_locked_at) return false;
  const locked = Date.parse(task.agent_locked_at);
  return !Number.isNaN(locked) && now.getTime() - locked < staleMs;
}

export function isStaleAiLock(task: Task, now: Date, staleMs = AI_WORK_STALE_MS) {
  if (!isEalzyTask(task) || task.status !== "in_progress") return false;
  if (!task.agent_locked_at) return true;
  const locked = Date.parse(task.agent_locked_at);
  return Number.isNaN(locked) || now.getTime() - locked >= staleMs;
}

export function pickNextAiWork(tasks: Task[], now: Date, maxAttempts = AI_WORK_MAX_ATTEMPTS) {
  return (
    tasks
      .filter((task) => isDueAiWork(task, now, maxAttempts))
      .sort((a, b) => {
        const dueA = a.due_at ?? a.created_at;
        const dueB = b.due_at ?? b.created_at;
        return dueA.localeCompare(dueB) || a.created_at.localeCompare(b.created_at);
      })[0] ?? null
  );
}

export function aiWorkInstruction(task: Task) {
  const details = task.description?.trim() ? `\n${task.description.trim()}` : "";
  return [
    `Сделай сам: ${task.title}${details}`,
    "",
    `Это дело в очереди Ealzy (id ${task.id}). Выполни его сейчас. Результат напиши в ответе.`,
    "Новые дела на себя (assignee ealzy) создавай только если нужен следующий шаг позже, с due_at в будущем.",
    "Не выдумывай факты.",
  ].join("\n");
}
