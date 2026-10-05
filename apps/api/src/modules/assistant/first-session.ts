import type { AppRepository } from "../../repository.js";
import type { Goal, SelfPromise, Task } from "../../types.js";
import { languageOf } from "../../locale.js";
import { trackFunnelEvent } from "../engagement/events.js";
import { parseTaskText } from "../import/text.js";
import { localMidday } from "../../time.js";
import { companionClock } from "./companion-workspace.js";
import {
  inferCommunicationStyle,
  inferImplicitSelfFacts,
  refreshPortrait,
} from "./personal-model.js";
import { applyCompanionSelfFacts, inferCompanionSelfFacts } from "./self-context.js";
import {
  applyCompanionPersonFacts,
  inferCompanionPersonFacts,
  personMentionedIn,
} from "./people.js";

export const BRAIN_DUMP_ACTION = "first_brain_dump";
export const MINI_APP_PENDING_CHAT = 0;
export const FALLBACK_GOAL_RU = "Навести порядок в дне";
export const FALLBACK_GOAL_EN = "Get the day in order";
export type BrainDumpDue = "today" | "tomorrow";
const EXPIRY_HOURS = 24;
const MAX_DUMP_TASKS = 7;
const SKIP_DUMP = /^(?:позже|не сейчас|пока нет|не надо|skip|later)[.!?]*$/iu;
const PROSE_MARKERS =
  /давай поговорим|пока не готов|про то,|вообще живу|потому что|расскажи|не знаю с чего/iu;

export type BrainDumpResult = {
  handled: boolean;
  captured: boolean;
  skipped?: boolean;
  reply: string;
  tasks: Task[];
  promise: SelfPromise | null;
};

function calendarDueAt(timezone: string, now: Date, due: BrainDumpDue = "today") {
  const date = companionClock(timezone, now).date;
  if (due === "today") return localMidday(date, timezone);
  // Прибавляем день по ключу даты, а не по времени: полдень UTC здесь нужен
  // только чтобы не перескочить сутки, реальный срок считает localMidday.
  const next = new Date(`${date}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return localMidday(next.toISOString().slice(0, 10), timezone);
}

function dueFromPayload(payload?: Record<string, unknown> | null): BrainDumpDue {
  return payload?.due === "tomorrow" ? "tomorrow" : "today";
}

export function inferValues(text: string): string[] {
  const match = text.match(/(?:мне |для меня )?важно(?:е)?\s+([^.!?\n]+)/iu);
  if (!match?.[1]) return [];
  return match[1]
    .split(/,| и | and /iu)
    .map((part) => part.trim().replace(/[.,;]+$/u, "").slice(0, 40))
    .filter((part) => part.length >= 2)
    .slice(0, 5);
}

export function looksLikeTaskList(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^\s*(?:[-*•]|\d+[.)])\s+/m.test(trimmed)) return true;
  const lines = trimmed.split(/[\n;]+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) return true;
  const parts = trimmed.split(/,|\s+и\s+|\s+and\s+/iu).map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 && parts.every((part) => part.length <= 60);
}

function cleanDumpLine(line: string) {
  return line
    .replace(/^\s*(?:[-*•]+|\d+[.)])\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPromiseLine(text: string): { rest: string; title: string | null } {
  const lines = text.split(/\r?\n/);
  let title: string | null = null;
  const kept: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:обещаю|i promise[:\s]+)\s*(.+)$/iu);
    if (match?.[1] && !title) {
      title = match[1].trim().slice(0, 120);
      continue;
    }
    kept.push(line);
  }
  if (!title) {
    const inline = text.match(/(?:^|[.\n])\s*(?:обещаю|i promise[:\s]+)\s*([^.!\n]+)/iu);
    if (inline?.[1]) title = inline[1].trim().slice(0, 120);
  }
  return { rest: kept.join("\n").trim() || text, title };
}

export function parseBrainDump(
  text: string,
  timezone: string,
  now = new Date(),
  due: BrainDumpDue = "today",
): { title: string; due_at: string }[] {
  const trimmed = text.trim();
  if (!trimmed || SKIP_DUMP.test(trimmed)) return [];
  let source = trimmed;
  if (looksLikeTaskList(trimmed) && !/[\n;]/.test(trimmed) && !/^\s*(?:[-*•]|\d+[.)])/m.test(trimmed)) {
    source = trimmed
      .split(/,|\s+и\s+|\s+and\s+/iu)
      .map(cleanDumpLine)
      .filter(Boolean)
      .join("\n");
  } else {
    source = trimmed
      .split(/[\n;]+/)
      .map(cleanDumpLine)
      .filter(Boolean)
      .join("\n");
  }
  const fallbackDue = calendarDueAt(timezone, now, due);
  return parseTaskText(source, now, timezone)
    .slice(0, MAX_DUMP_TASKS)
    .map((task) => ({
      title: task.title.replace(/^(?:надо|нужно|нужен)\s+/iu, "").trim(),
      due_at: task.due_at ?? fallbackDue,
    }))
    .filter((task) => task.title.length >= 2);
}

export function composeFirstMove(input: {
  goalTitle?: string | null;
  values?: string[];
  locale?: string | null;
}) {
  const ru = languageOf(input.locale) !== "en";
  const goal = input.goalTitle?.trim();
  const values = (input.values ?? []).filter(Boolean).slice(0, 3);
  if (ru) {
    const goalLine = goal
      ? `Вот что я вижу: цель «${goal}».`
      : "Вот что я вижу: пока одна цель — навести порядок в дне.";
    const valueLine = values.length ? ` Для тебя важно: ${values.join(", ")}.` : "";
    return `${goalLine}${valueLine}\n\nСкинь 3–7 дел из головы — каждое с новой строки или через запятую. Поставлю на сегодня и утром напомню.\n\nЕсли хочешь одно обещание себе на эту неделю — напиши «обещаю …».`;
  }
  const goalLine = goal
    ? `Here's what I see: the goal “${goal}”.`
    : "Here's what I see: one goal for now — get the day in order.";
  const valueLine = values.length ? ` What matters to you: ${values.join(", ")}.` : "";
  return `${goalLine}${valueLine}\n\nDump 3–7 things on your mind — one per line or comma-separated. I'll date them today and remind you in the morning.\n\nIf you want one promise to yourself this week, write “I promise …”.`;
}

export async function applyOnboardingSignals(
  repository: AppRepository,
  ownerId: string,
  text: string,
) {
  const profile = await repository.getProfile(ownerId);
  if (!profile) return;
  const patch: { values?: string[]; communication_style?: string } = {};
  const values = inferValues(text);
  if (values.length) {
    const merged = [...profile.values];
    for (const value of values) {
      if (!merged.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) {
        merged.push(value);
      }
    }
    if (merged.length !== profile.values.length) patch.values = merged.slice(0, 12);
  }
  if (!profile.communication_style) {
    const style = inferCommunicationStyle(text);
    if (style) patch.communication_style = style;
  }
  if (Object.keys(patch).length) await repository.updateProfile(ownerId, patch);
  await applyCompanionSelfFacts(
    repository,
    ownerId,
    [...inferCompanionSelfFacts(text), ...inferImplicitSelfFacts(text)],
  );
}

export async function ensureActivationGoal(
  repository: AppRepository,
  ownerId: string,
  locale?: string | null,
  fallbackTitle?: string | null,
) {
  const goals = await repository.listGoals(ownerId);
  const active = goals.find((goal) => goal.status === "active");
  if (active) return active;
  const ru = languageOf(locale) !== "en";
  const title = (fallbackTitle?.trim() || (ru ? FALLBACK_GOAL_RU : FALLBACK_GOAL_EN)).slice(0, 80);
  if (!title) return null;
  try {
    return await repository.createGoal(ownerId, { title, priority: 4 });
  } catch {
    return null;
  }
}

async function ensureWeekPlan(repository: AppRepository, ownerId: string, locale?: string | null) {
  const active = await ensureActivationGoal(repository, ownerId, locale);
  if (!active) return null;
  if (!active.current_plan?.trim()) {
    const ru = languageOf(locale) !== "en";
    await repository.updateGoal(ownerId, active.id, {
      current_plan: ru
        ? "На этой неделе: выгрузить дела из головы и закрыть одно сегодня."
        : "This week: dump what's on your mind and finish one thing today.",
      plan_revised_at: new Date().toISOString(),
    });
  }
  return (await repository.getGoal(ownerId, active.id)) ?? active;
}

export async function startBrainDump(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
  options?: { due?: BrainDumpDue },
) {
  const due = options?.due ?? "today";
  const existing = await repository.findActivePendingAction(
    ownerId,
    telegramChatId,
    BRAIN_DUMP_ACTION,
  );
  if (existing) {
    if (dueFromPayload(existing.payload) === due) return existing;
    await repository.consumePendingAction(ownerId, existing.id);
  }
  return repository.createPendingAction(ownerId, {
    telegram_chat_id: telegramChatId,
    action: BRAIN_DUMP_ACTION,
    payload: { kind: BRAIN_DUMP_ACTION, due },
    expires_at: new Date(Date.now() + EXPIRY_HOURS * 3600_000).toISOString(),
  });
}

export async function cancelBrainDump(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
) {
  const pending = await repository.findActivePendingAction(
    ownerId,
    telegramChatId,
    BRAIN_DUMP_ACTION,
  );
  if (pending) await repository.consumePendingAction(ownerId, pending.id);
}

async function consumeBrainDumpPendings(repository: AppRepository, ownerId: string) {
  const user = await repository.getUser(ownerId);
  const chats = [MINI_APP_PENDING_CHAT, user?.telegram_id].filter(
    (id): id is number => typeof id === "number",
  );
  for (const chat of [...new Set(chats)]) {
    const pending = await repository.findActivePendingAction(ownerId, chat, BRAIN_DUMP_ACTION);
    if (pending) await repository.consumePendingAction(ownerId, pending.id);
  }
}

/**
 * Онбординг — самый дорогой момент: человек сам рассказывает про семью и даты
 * («жена Аня, сын Лёва, у мамы день рождения 3 октября»). Раньше этот текст
 * оседал одним сырым куском в памяти «self», и ни одной карточки человека из
 * него не появлялось — первая персональная рекомендация становилась невозможной.
 */
export async function savePeopleFromBio(
  repository: AppRepository,
  ownerId: string,
  bio: string | null | undefined,
) {
  const text = bio?.trim();
  if (!text) return [];
  try {
    const facts = inferCompanionPersonFacts(text, { maxLength: 2000 });
    if (!facts.length) return [];
    return await applyCompanionPersonFacts(repository, ownerId, facts);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "onboarding_people_from_bio_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return [];
  }
}

export async function finishOnboardingActivation(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number | null,
  locale?: string | null,
) {
  const profile = await repository.getProfile(ownerId);
  const goal = await ensureWeekPlan(repository, ownerId, locale ?? profile?.locale);
  await savePeopleFromBio(repository, ownerId, profile?.bio);
  try {
    await refreshPortrait(repository, ownerId);
  } catch {
    // Portrait is best-effort; the first move still has to go out.
  }
  const patch: { weekly_reflection_enabled?: boolean; weekly_digest_enabled?: boolean } = {};
  if (!profile?.weekly_reflection_enabled) patch.weekly_reflection_enabled = true;
  if (!profile?.weekly_digest_enabled) patch.weekly_digest_enabled = true;
  if (Object.keys(patch).length) await repository.updateProfile(ownerId, patch);
  const user = telegramChatId == null ? await repository.getUser(ownerId) : null;
  const dumpChat = telegramChatId ?? user?.telegram_id ?? MINI_APP_PENDING_CHAT;
  await startBrainDump(repository, ownerId, dumpChat);
  await trackFunnelEvent(repository, ownerId, "first_move", {
    channel: telegramChatId != null ? "telegram" : "mini_app",
    goal: goal?.title ?? null,
  });
  return composeFirstMove({
    goalTitle: goal?.title,
    values: profile?.values,
    locale: locale ?? profile?.locale,
  });
}

export async function applyBrainDump(
  repository: AppRepository,
  ownerId: string,
  text: string,
  now = new Date(),
  options?: { due?: BrainDumpDue },
): Promise<{ tasks: Task[]; promise: SelfPromise | null; skipped: boolean; empty: boolean }> {
  const profile = await repository.getProfile(ownerId);
  if (SKIP_DUMP.test(text.trim())) {
    await consumeBrainDumpPendings(repository, ownerId);
    return { tasks: [], promise: null, skipped: true, empty: false };
  }
  const { rest, title: promiseTitle } = extractPromiseLine(text);
  const timezone = profile?.timezone || "Europe/Moscow";
  const due = options?.due ?? "today";
  const parsed = parseBrainDump(rest, timezone, now, due);
  const goals = await repository.listGoals(ownerId);
  const goal = goals.find((item) => item.status === "active") ?? null;
  const existing = await repository.listTasks(ownerId);
  const seen = new Set(existing.map((task) => task.title.toLocaleLowerCase().trim()));
  const tasks: Task[] = [];
  // «Купить подарок маме», «Записать Лёву к стоматологу» — в выгрузке головы
  // человек сам называет тех, о ком дело. Привязываем, когда в названии узнан
  // ровно один человек: связка «дела + люди» должна собираться сама, иначе она
  // не соберётся никогда.
  const known = (await repository.listPeople(ownerId)).filter((person) => !person.is_self);
  for (const item of parsed) {
    const key = item.title.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const mentioned = known.filter((person) => personMentionedIn(item.title, person));
    tasks.push(
      await repository.createTask(ownerId, {
        title: item.title.slice(0, 160),
        due_at: item.due_at,
        goal_id: goal?.id ?? null,
        person_id: mentioned.length === 1 ? mentioned[0]!.id : null,
        importance: tasks.length === 0 ? 4 : 3,
        urgency: tasks.length === 0 ? 4 : 3,
      }),
    );
  }
  let promise: SelfPromise | null = null;
  if (promiseTitle) {
    const already = (await repository.listPromises(ownerId)).some(
      (item) => item.status === "active" && item.title.toLocaleLowerCase() === promiseTitle.toLocaleLowerCase(),
    );
    if (!already) promise = await repository.createPromise(ownerId, { title: promiseTitle });
  }
  if (tasks.length || promise) {
    await consumeBrainDumpPendings(repository, ownerId);
    await trackFunnelEvent(repository, ownerId, "first_brain_dump", {
      tasks: tasks.length,
      promise: Boolean(promise),
    });
    if (tasks.length) await trackFunnelEvent(repository, ownerId, "first_task", { source: "brain_dump" });
    try {
      await refreshPortrait(repository, ownerId, now);
    } catch {
      // Keep the captured work even if the portrait write fails.
    }
  }
  return { tasks, promise, skipped: false, empty: !tasks.length && !promise };
}

export function formatBrainDumpReply(
  result: Awaited<ReturnType<typeof applyBrainDump>>,
  locale?: string | null,
  goal?: Goal | null,
  due: BrainDumpDue = "today",
) {
  const ru = languageOf(locale) !== "en";
  const when = due === "tomorrow" ? (ru ? "завтра" : "tomorrow") : ru ? "сегодня" : "today";
  if (result.skipped) {
    return ru
      ? "Ок. Когда будешь готов — скинь список или открой Ealzy, утро всё равно придёт."
      : "Okay. When you're ready, dump the list or open Ealzy — morning still comes.";
  }
  if (result.empty) {
    return ru
      ? "Не разобрала список. Напиши дела с новой строки или через запятую — например: «позвонить маме, оплатить счета, дописать оффер»."
      : "I couldn't read a list. Write tasks one per line or comma-separated — e.g. “call mom, pay bills, finish the offer”.";
  }
  const titles = result.tasks.map((task) => task.title).join(ru ? ", " : ", ");
  const goalBit = goal?.title
    ? ru
      ? ` под цель «${goal.title}»`
      : ` under “${goal.title}”`
    : "";
  const taskBit = result.tasks.length
    ? ru
      ? `Поставила на ${when}${goalBit}: ${titles}. Утром напомню.`
      : `Dated for ${when}${goalBit}: ${titles}. I'll remind you in the morning.`
    : "";
  const promiseBit = result.promise
    ? ru
      ? ` Обещание «${result.promise.title}» держу в ориентирах.`
      : ` Promise “${result.promise.title}” is on your bearings.`
    : "";
  return `${taskBit}${promiseBit}`.trim();
}

export async function handleBrainDumpReply(
  repository: AppRepository,
  ownerId: string,
  pending: { id: string; telegram_chat_id: number; payload?: Record<string, unknown> },
  text: string,
): Promise<BrainDumpResult> {
  const profile = await repository.getProfile(ownerId);
  const due = dueFromPayload(pending.payload);
  const parsed = parseBrainDump(
    extractPromiseLine(text).rest,
    profile?.timezone || "Europe/Moscow",
    new Date(),
    due,
  );
  const conversational =
    (PROSE_MARKERS.test(text) && !/[\n;]/.test(text) && !/^\s*(?:[-*•]|\d+[.)])/m.test(text)) ||
    (!looksLikeTaskList(text) &&
      (parsed.length === 0 || (parsed.length === 1 && (parsed[0]?.title.length ?? 0) > 60)) &&
      text.trim().length > 80 &&
      !/обещаю|i promise/iu.test(text));
  if (conversational) {
    return { handled: false, captured: false, reply: "", tasks: [], promise: null };
  }
  await repository.consumePendingAction(ownerId, pending.id);
  const applied = await applyBrainDump(repository, ownerId, text, new Date(), { due });
  if (applied.empty && !applied.skipped) {
    await startBrainDump(repository, ownerId, pending.telegram_chat_id, { due });
  }
  const goals = await repository.listGoals(ownerId);
  const goal = goals.find((item) => item.status === "active") ?? null;
  return {
    handled: true,
    captured: applied.tasks.length > 0 || Boolean(applied.promise),
    skipped: applied.skipped,
    reply: formatBrainDumpReply(applied, profile?.locale, goal, due),
    tasks: applied.tasks,
    promise: applied.promise,
  };
}
