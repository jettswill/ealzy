import type { AppRepository } from "../../repository.js";
import type { AssistantDecision, AssistantOrchestrator } from "./index.js";
import type { ExperienceService, ExtractedExperience } from "./experience.js";
import type { Person, Task } from "../../types.js";
import { languageOf } from "../../locale.js";
import { localMidday } from "../../time.js";
import { goalSyncInstruction } from "./goal-plan.js";

export const PENDING_ACTION_PREFIX = "pa";
export const PENDING_ACTION_TTL_MS = 15 * 60_000;
export const FOLLOW_UP_PENDING_TTL_MS = 7 * 24 * 60 * 60_000;

export interface PersonDisambiguationPayload {
  kind: "resolve_person";
  decision: AssistantDecision;
  source_message_id?: string | null;
}

export interface ExperienceFollowUpPayload {
  kind: "experience_follow_up";
  experience_id: string;
}

export interface ExperienceParticipantPayload {
  kind: "resolve_experience_participant";
  extracted: ExtractedExperience;
  source_message_id?: string | null;
  original_text: string;
}

export type PendingActionPayload =
  | PersonDisambiguationPayload
  | ExperienceFollowUpPayload
  | ExperienceParticipantPayload
  | DayClosePayload
  | GoalCheckInPayload
  | MailSendPayload;

export function pendingCallbackData(pendingActionId: string, personId: string) {
  return `${PENDING_ACTION_PREFIX}:${pendingActionId}:${personId}`;
}

export function parsePendingCallback(data: string) {
  if (!data.startsWith(`${PENDING_ACTION_PREFIX}:`)) return null;
  const [, pendingActionId, personId] = data.split(":");
  if (!pendingActionId || !personId) return null;
  return { pendingActionId, personId };
}

export async function createPersonDisambiguation(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
  decision: AssistantDecision,
  candidates: Pick<Person, "id" | "name">[],
  sourceMessageId?: string,
) {
  const pending = await repository.createPendingAction(ownerId, {
    telegram_chat_id: telegramChatId,
    action: "resolve_person",
    payload: {
      kind: "resolve_person",
      decision,
      source_message_id: sourceMessageId ?? null,
    } satisfies PersonDisambiguationPayload,
    expires_at: new Date(Date.now() + PENDING_ACTION_TTL_MS).toISOString(),
  });
  return {
    pending,
    keyboard: candidates.map((person) => [
      { text: person.name, callback_data: pendingCallbackData(pending.id, person.id) },
    ]),
  };
}

export async function createExperienceParticipantDisambiguation(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
  extracted: ExtractedExperience,
  candidates: Pick<Person, "id" | "name">[],
  sourceMessageId: string,
  originalText: string,
) {
  const pending = await repository.createPendingAction(ownerId, {
    telegram_chat_id: telegramChatId,
    action: "resolve_experience_participant",
    payload: {
      kind: "resolve_experience_participant",
      extracted,
      source_message_id: sourceMessageId,
      original_text: originalText,
    } satisfies ExperienceParticipantPayload,
    expires_at: new Date(Date.now() + PENDING_ACTION_TTL_MS).toISOString(),
  });
  return {
    pending,
    keyboard: candidates.map((person) => [
      { text: person.name, callback_data: pendingCallbackData(pending.id, person.id) },
    ]),
  };
}

export async function createExperienceFollowUpPending(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
  experienceId: string,
) {
  return repository.createPendingAction(ownerId, {
    telegram_chat_id: telegramChatId,
    action: "experience_follow_up",
    payload: {
      kind: "experience_follow_up",
      experience_id: experienceId,
    } satisfies ExperienceFollowUpPayload,
    expires_at: new Date(Date.now() + FOLLOW_UP_PENDING_TTL_MS).toISOString(),
  });
}

export async function resumePendingAction(
  repository: AppRepository,
  assistant: AssistantOrchestrator,
  experiences: ExperienceService,
  ownerId: string,
  pendingActionId: string,
  personId: string,
) {
  const pending = await repository.consumePendingAction(ownerId, pendingActionId);
  if (!pending) return null;
  const payload = pending.payload as unknown as PendingActionPayload;
  if (payload.kind === "resolve_person") {
    return assistant.resumeWithPerson(
      ownerId,
      payload.decision,
      personId,
      payload.source_message_id ?? undefined,
    );
  }
  if (payload.kind === "resolve_experience_participant") {
    const result = await experiences.captureWithParticipant(
      ownerId,
      payload.extracted,
      personId,
      payload.source_message_id ?? pendingActionId,
      payload.original_text,
    );
    return { intent: "experience" as const, text: result.text };
  }
  return null;
}

export const DAY_CLOSE_PREFIX = "dc";
export const DAY_CLOSE_TTL_MS = 18 * 60 * 60_000;
export const DAY_CLOSE_BUTTON_LIMIT = 8;
export const GOAL_CHECKIN_PREFIX = "gc";
export const GOAL_CHECKIN_TTL_MS = 7 * 24 * 60 * 60_000;
export type DayCloseNavAction = "select" | "back";
export type DayCloseAction = "done" | "tomorrow" | "discuss" | DayCloseNavAction;
export type TelegramCallbackButton = { text: string; callback_data: string };

export interface DayClosePayload {
  kind: "day_close";
  task_ids: string[];
  local_date: string;
}

const compactId = (id: string) => id.replace(/-/g, "");

export function dayCloseCallbackData(
  pendingActionId: string,
  taskId: string,
  action: DayCloseAction,
) {
  const code =
    action === "done"
      ? "d"
      : action === "tomorrow"
        ? "t"
        : action === "discuss"
          ? "x"
          : action === "select"
            ? "s"
            : "b";
  return `${DAY_CLOSE_PREFIX}:${compactId(pendingActionId).slice(0, 12)}:${compactId(taskId)}:${code}`;
}

export function parseDayCloseCallback(data: string) {
  if (!data.startsWith(`${DAY_CLOSE_PREFIX}:`)) return null;
  const [, pendingPrefix, taskCompact, code] = data.split(":");
  if (!pendingPrefix || !taskCompact || !code) return null;
  const action: DayCloseAction | null =
    code === "d"
      ? "done"
      : code === "t"
        ? "tomorrow"
        : code === "x"
          ? "discuss"
          : code === "s"
            ? "select"
            : code === "b"
              ? "back"
              : null;
  if (!action) return null;
  return { pendingPrefix, taskCompact, action };
}

export function dayCloseMenuPrompt(locale?: string | null) {
  return languageOf(locale) === "en"
    ? "To mark done, discuss with Ealzy, or move to tomorrow — pick a task:"
    : "Чтобы отметить выполненным, обсудить с Илзи или перенести — выберите задачу:";
}

export function dayCloseDiscussInstruction(
  task: Pick<Task, "id" | "title"> & { due_at?: string | null },
  locale?: string | null,
) {
  const ru = languageOf(locale) !== "en";
  const due = task.due_at?.slice(0, 10);
  const dueBit = due
    ? ru
      ? ` Срок ${due}.`
      : ` Due ${due}.`
    : "";
  return ru
    ? `Давай обсудим задачу «${task.title}».${dueBit} Это открытое дело из вечерней сводки. Помоги понять, что с ней делать: сделать сейчас, упростить, перенести или отпустить. Не создавай новые дела и не меняй эту задачу, пока я не попрошу. Сначала один точный вопрос или конкретный следующий шаг.`
    : `Let's discuss the task "${task.title}".${dueBit} It's leftover from the evening wrap-up. Help me decide: do it now, simplify, move, or let go. Don't create new tasks or change this one unless I ask. Start with one precise question or a concrete next step.`;
}

function dayCloseTaskLabel(title: string, ru: boolean) {
  return title.trim().slice(0, 64) || (ru ? "дело" : "task");
}

export function dayCloseListKeyboard(
  pendingId: string,
  tasks: Pick<Task, "id" | "title">[],
  locale?: string | null,
): TelegramCallbackButton[][] {
  const ru = languageOf(locale) !== "en";
  return tasks.map((task) => [
    {
      text: dayCloseTaskLabel(task.title, ru),
      callback_data: dayCloseCallbackData(pendingId, task.id, "select"),
    },
  ]);
}

export function dayCloseActionKeyboard(
  pendingId: string,
  task: Pick<Task, "id" | "title">,
  locale?: string | null,
): TelegramCallbackButton[][] {
  const ru = languageOf(locale) !== "en";
  return [
    [
      {
        text: dayCloseTaskLabel(task.title, ru),
        callback_data: dayCloseCallbackData(pendingId, task.id, "select"),
      },
    ],
    [
      {
        text: ru ? "Выполнено" : "Done",
        callback_data: dayCloseCallbackData(pendingId, task.id, "done"),
      },
    ],
    [
      {
        text: ru ? "Обсудить с Илзи" : "Discuss with Ealzy",
        callback_data: dayCloseCallbackData(pendingId, task.id, "discuss"),
      },
    ],
    [
      {
        text: ru ? "Перенести на завтра" : "Move to tomorrow",
        callback_data: dayCloseCallbackData(pendingId, task.id, "tomorrow"),
      },
    ],
    [
      {
        text: ru ? "← Все задачи" : "← All tasks",
        callback_data: dayCloseCallbackData(pendingId, task.id, "back"),
      },
    ],
  ];
}

function remainingDayCloseTasks(
  tasks: Task[],
  ids: string[],
  localDate: string,
): Pick<Task, "id" | "title">[] {
  const order = new Map(ids.map((id, index) => [id, index]));
  return tasks
    .filter((task) => {
      if (!order.has(task.id)) return false;
      if (task.status === "done" || task.status === "cancelled") return false;
      const due = task.due_at?.slice(0, 10);
      return !due || due <= localDate;
    })
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((task) => ({ id: task.id, title: task.title }));
}

export type DayCloseResult = {
  pendingId: string;
  locale: string;
  remaining: Pick<Task, "id" | "title">[];
} & (
  | { kind: "menu"; view: "list" | "task"; task: Pick<Task, "id" | "title"> | null }
  | { kind: "acted"; intent: "other"; text: string }
  | { kind: "discuss"; instruction: string; task: Pick<Task, "id" | "title"> }
);

export async function createDayClosePending(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
  tasks: Pick<Task, "id" | "title">[],
  localDate: string,
  locale: string,
) {
  const chosen = tasks.slice(0, DAY_CLOSE_BUTTON_LIMIT);
  const pending = await repository.createPendingAction(ownerId, {
    telegram_chat_id: telegramChatId,
    action: "day_close",
    payload: {
      kind: "day_close",
      task_ids: chosen.map((task) => task.id),
      local_date: localDate,
    } satisfies DayClosePayload,
    expires_at: new Date(Date.now() + DAY_CLOSE_TTL_MS).toISOString(),
  });
  const keyboard = dayCloseListKeyboard(pending.id, chosen, locale);
  return { pending, keyboard };
}

export async function resumeDayClose(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
  parsed: { pendingPrefix: string; taskCompact: string; action: DayCloseAction },
): Promise<DayCloseResult | null> {
  const pending = await repository.findActivePendingAction(ownerId, telegramChatId, "day_close");
  if (!pending || compactId(pending.id).slice(0, 12) !== parsed.pendingPrefix) return null;
  const payload = pending.payload as unknown as DayClosePayload;
  if (payload.kind !== "day_close") return null;
  const profile = await repository.getProfile(ownerId);
  const locale = profile?.locale ?? "ru";
  const ru = languageOf(locale) !== "en";
  const tasks = await repository.listTasks(ownerId);
  const remaining = remainingDayCloseTasks(tasks, payload.task_ids, payload.local_date);
  const taskId = payload.task_ids.find((id) => compactId(id) === parsed.taskCompact);
  const task = taskId ? tasks.find((item) => item.id === taskId) : undefined;
  const menu = (
    view: "list" | "task",
    focus: Pick<Task, "id" | "title"> | null = null,
    open = remaining,
  ): DayCloseResult => ({
    kind: "menu",
    pendingId: pending.id,
    locale,
    remaining: open,
    view,
    task: focus,
  });
  if (parsed.action === "back") return menu("list");
  if (parsed.action === "select") {
    if (!task || !remaining.some((item) => item.id === task.id)) return menu("list");
    return menu("task", { id: task.id, title: task.title });
  }
  if (!taskId || !task) return null;
  if (parsed.action === "done") {
    await repository.updateTask(ownerId, taskId, {
      status: "done",
      completed_at: new Date().toISOString(),
    });
    return {
      kind: "acted",
      pendingId: pending.id,
      locale,
      remaining: remaining.filter((item) => item.id !== taskId),
      intent: "other",
      text: ru ? `Отметил: ${task.title}` : `Marked done: ${task.title}`,
    };
  }
  if (parsed.action === "discuss") {
    return {
      kind: "discuss",
      pendingId: pending.id,
      locale,
      remaining,
      task: { id: task.id, title: task.title },
      instruction: dayCloseDiscussInstruction(task, locale),
    };
  }
  // «Перенести на завтра» на закрытии дня: сдвигаем ключ даты, а срок ставим
  // на полдень по поясу человека, а не на полдень UTC.
  const next = new Date(`${payload.local_date}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const dueAt = localMidday(next.toISOString().slice(0, 10), profile?.timezone ?? "UTC");
  await repository.updateTask(ownerId, taskId, { due_at: dueAt });
  return {
    kind: "acted",
    pendingId: pending.id,
    locale,
    remaining: remaining.filter((item) => item.id !== taskId),
    intent: "other",
    text: ru ? `На завтра: ${task.title}` : `Moved to tomorrow: ${task.title}`,
  };
}

export interface GoalCheckInPayload {
  kind: "goal_checkin";
  goal_id: string | null;
}

export type GoalCheckInAction = "plan" | "later" | "pause";

export function goalCheckInCallbackData(pendingActionId: string, action: GoalCheckInAction) {
  const code = action === "plan" ? "p" : action === "later" ? "l" : "x";
  return `${GOAL_CHECKIN_PREFIX}:${compactId(pendingActionId).slice(0, 12)}:${code}`;
}

export function parseGoalCheckInCallback(data: string) {
  if (!data.startsWith(`${GOAL_CHECKIN_PREFIX}:`)) return null;
  const [, pendingPrefix, code] = data.split(":");
  if (!pendingPrefix || !code) return null;
  const action: GoalCheckInAction | null =
    code === "p" ? "plan" : code === "l" ? "later" : code === "x" ? "pause" : null;
  if (!action) return null;
  return { pendingPrefix, action };
}

export async function createGoalCheckInPending(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
  goalId: string | null,
  locale: string,
) {
  const pending = await repository.createPendingAction(ownerId, {
    telegram_chat_id: telegramChatId,
    action: "goal_checkin",
    payload: { kind: "goal_checkin", goal_id: goalId } satisfies GoalCheckInPayload,
    expires_at: new Date(Date.now() + GOAL_CHECKIN_TTL_MS).toISOString(),
  });
  const ru = languageOf(locale) !== "en";
  const keyboard = [
    [
      {
        text: ru ? "Давай" : "Let's talk",
        callback_data: goalCheckInCallbackData(pending.id, "plan"),
      },
      {
        text: ru ? "Позже" : "Later",
        callback_data: goalCheckInCallbackData(pending.id, "later"),
      },
    ],
  ];
  return { pending, keyboard };
}

export async function resumeGoalCheckIn(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
  parsed: { pendingPrefix: string; action: GoalCheckInAction },
) {
  const pending = await repository.findActivePendingAction(ownerId, telegramChatId, "goal_checkin");
  if (!pending || compactId(pending.id).slice(0, 12) !== parsed.pendingPrefix) return null;
  const payload = pending.payload as unknown as GoalCheckInPayload;
  if (payload.kind !== "goal_checkin") return null;
  await repository.consumePendingAction(ownerId, pending.id);
  const profile = await repository.getProfile(ownerId);
  const ru = languageOf(profile?.locale) !== "en";
  const goal = payload.goal_id ? await repository.getGoal(ownerId, payload.goal_id) : null;
  if (parsed.action === "later") {
    return {
      kind: "ack" as const,
      text: ru
        ? "Хорошо, к целям вернёмся позже — когда скажешь."
        : "Okay, we'll come back to goals later — whenever you want.",
      intent: "other" as const,
    };
  }
  if (parsed.action === "pause") {
    if (!goal) {
      return {
        kind: "ack" as const,
        text: ru ? "Этой цели уже нет." : "That goal is gone.",
        intent: "other" as const,
      };
    }
    await repository.updateGoal(ownerId, goal.id, { status: "paused" });
    return {
      kind: "ack" as const,
      text: ru
        ? `Поставил «${goal.title}» на паузу. Открытые дела оставил — можно вернуться, когда будет актуально.`
        : `Paused "${goal.title}". Open tasks stay — you can come back when it's relevant.`,
      intent: "other" as const,
    };
  }
  const [tasks, goals] = await Promise.all([
    repository.listTasks(ownerId),
    repository.listGoals(ownerId),
  ]);
  return {
    kind: "plan" as const,
    instruction: goalSyncInstruction(goals, tasks, profile?.locale, goal?.id ?? payload.goal_id),
  };
}

export async function completeExperienceFollowUpPending(
  repository: AppRepository,
  experiences: ExperienceService,
  ownerId: string,
  telegramChatId: number,
  text: string,
  sourceMessageId?: string,
) {
  const pending = await repository.findActivePendingAction(
    ownerId,
    telegramChatId,
    "experience_follow_up",
  );
  if (!pending) return null;
  const payload = pending.payload as unknown as ExperienceFollowUpPayload;
  if (payload.kind !== "experience_follow_up") return null;
  await repository.consumePendingAction(ownerId, pending.id);
  const result = await experiences.completeFollowUp(
    ownerId,
    payload.experience_id,
    text,
    sourceMessageId,
  );
  return { intent: "experience" as const, text: result.text };
}

export const MAIL_SEND_PREFIX = "ms";
export const MAIL_SEND_TTL_MS = 15 * 60_000;
export type MailSendAction = "confirm" | "cancel";

export interface MailSendPayload {
  kind: "send_mail";
  draft_id: string;
}

export function mailSendCallbackData(pendingActionId: string, action: MailSendAction) {
  const code = action === "confirm" ? "y" : "n";
  return `${MAIL_SEND_PREFIX}:${compactId(pendingActionId).slice(0, 12)}:${code}`;
}

export function parseMailSendCallback(data: string) {
  if (!data.startsWith(`${MAIL_SEND_PREFIX}:`)) return null;
  const [, pendingPrefix, code] = data.split(":");
  if (!pendingPrefix || !code) return null;
  const action: MailSendAction | null = code === "y" ? "confirm" : code === "n" ? "cancel" : null;
  if (!action) return null;
  return { pendingPrefix, action };
}

export async function createMailSendPending(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
  draftId: string,
  locale?: string | null,
) {
  const pending = await repository.createPendingAction(ownerId, {
    telegram_chat_id: telegramChatId,
    action: "send_mail",
    payload: { kind: "send_mail", draft_id: draftId } satisfies MailSendPayload,
    expires_at: new Date(Date.now() + MAIL_SEND_TTL_MS).toISOString(),
  });
  const ru = languageOf(locale) !== "en";
  const keyboard = [
    [
      {
        text: ru ? "Отправить" : "Send",
        callback_data: mailSendCallbackData(pending.id, "confirm"),
      },
      {
        text: ru ? "Не сейчас" : "Not now",
        callback_data: mailSendCallbackData(pending.id, "cancel"),
      },
    ],
  ];
  return { pending, keyboard };
}

export async function resumeMailSend(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
  parsed: { pendingPrefix: string; action: MailSendAction },
) {
  const pending = await repository.findActivePendingAction(ownerId, telegramChatId, "send_mail");
  if (!pending || compactId(pending.id).slice(0, 12) !== parsed.pendingPrefix) return null;
  const payload = pending.payload as unknown as MailSendPayload;
  if (payload.kind !== "send_mail") return null;
  await repository.consumePendingAction(ownerId, pending.id);
  const ru = languageOf((await repository.getProfile(ownerId))?.locale) !== "en";
  if (parsed.action === "cancel") {
    return {
      kind: "cancel" as const,
      draft_id: payload.draft_id,
      text: ru ? "Оставил черновик без отправки." : "Left the draft unsent.",
    };
  }
  return { kind: "confirm" as const, draft_id: payload.draft_id, text: null as string | null };
}

