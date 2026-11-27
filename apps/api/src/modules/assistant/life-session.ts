import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppRepository } from "../../repository.js";
import { localMidday } from "../../time.js";
import { withGoalStats } from "../../direction.js";
import type { Goal, LifeSession, LifeSessionMode, Task } from "../../types.js";
import { assertCloudQuota } from "../billing/quota.js";
import { dateKeyInZone, resolveCompanionDueAt, similarTaskTitles } from "./companion.js";
import { meetingNoteDocument } from "./meeting-notes.js";

// Сессия с Илзи. Человек выгружает всё из головы — голосом или текстом, сколько
// угодно долго, — а Илзи разбирает рассказ: какие из этого дела (конкретные,
// с глаголом), к каким долгосрочным направлениям они ведут, что не дело, а мысль
// или тревога, и что одно сделать прямо сейчас. Ничего не записывается само:
// человек видит разбор, снимает лишнее и принимает. Мысли не теряются — они
// ложатся в заметку сессии.
//
// Три режима:
//   unload   — «Разгрузить голову»: поймать всё и разложить;
//   strategy — «Стратегия»: свериться с долгосрочными целями, что к ним ведёт;
//   talk     — «Поговорить»: выговориться, Илзи отражает и помогает найти один шаг.

export const LIFE_SESSION_MODES = ["unload", "strategy", "talk"] as const;
export const SESSION_BUCKETS = ["now", "today", "week", "later", "someday"] as const;
export const SESSION_SPHERES = [
  "work",
  "home",
  "health",
  "people",
  "rest",
  "growth",
  "money",
  "other",
] as const;
export type SessionBucket = (typeof SESSION_BUCKETS)[number];

export const MAX_SESSION_TRANSCRIPT = 60_000;
const MAX_SESSION_TASKS = 30;
const MAX_SESSION_GOALS = 6;

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim() : null),
    z.string().max(max).nullable(),
  );
const score = z.preprocess(
  (value) => (typeof value === "number" ? Math.round(value) : 3),
  z.number().int().min(1).max(5).catch(3),
);

export const SessionGoalSchema = z.object({
  key: z.string().trim().min(1).max(40),
  op: z.enum(["create", "touch"]),
  goal_id: z.preprocess((v) => (v ? v : null), z.string().uuid().nullable().catch(null)),
  title: z.string().trim().min(1).max(200),
  horizon: z.enum(["short", "medium", "long"]).nullable().catch(null),
  why: nullableText(600),
});

export const SessionTaskSchema = z.object({
  key: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  description: nullableText(1000),
  bucket: z.enum(SESSION_BUCKETS).catch("later"),
  due_phrase: nullableText(80),
  due_date: nullableText(40),
  estimate_minutes: z.preprocess(
    (value) => (typeof value === "number" && value > 0 ? Math.round(value) : null),
    z.number().int().min(1).max(480).nullable().catch(null),
  ),
  sphere: z.enum(SESSION_SPHERES).catch("other"),
  goal_key: nullableText(40),
  importance: score,
  urgency: score,
  assignee: z.enum(["user", "ealzy"]).catch("user"),
  existing_task_id: z.preprocess((v) => (v ? v : null), z.string().uuid().nullable().catch(null)),
});

export const SessionProposalSchema = z.object({
  summary: z.string().trim().min(1).max(1500),
  reflection: nullableText(1500),
  goals: z
    .preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown()))
    .transform((items) =>
      items.slice(0, MAX_SESSION_GOALS).flatMap((item) => {
        const parsed = SessionGoalSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  tasks: z
    .preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown()))
    .transform((items) =>
      items.slice(0, MAX_SESSION_TASKS).flatMap((item) => {
        const parsed = SessionTaskSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  thoughts: z
    .preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown()))
    .transform((items) =>
      items
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim().slice(0, 400))
        .slice(0, 10),
    ),
  now: z
    .object({
      task_key: nullableText(40),
      reason: nullableText(400),
      first_step: nullableText(300),
    })
    .nullable()
    .catch(null),
  alignment: nullableText(800),
  questions: z
    .preprocess((v) => (Array.isArray(v) ? v : []), z.array(z.unknown()))
    .transform((items) =>
      items
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim().slice(0, 300))
        .slice(0, 3),
    ),
});
export type SessionProposal = z.infer<typeof SessionProposalSchema>;
export type SessionTask = z.infer<typeof SessionTaskSchema>;
export type SessionGoal = z.infer<typeof SessionGoalSchema>;
export type NormalizedTask = SessionTask & { due_at: string | null };
export type NormalizedProposal = Omit<SessionProposal, "tasks"> & { tasks: NormalizedTask[] };

/** Что видит модель: цели, открытые дела, календарь, прошлая сессия. */
export interface LifeContext {
  now_local: string;
  weekday: string;
  timezone: string;
  today: string;
  goals: {
    id: string;
    title: string;
    horizon: Goal["horizon"];
    plan: string | null;
    open_tasks: number;
    done_tasks: number;
  }[];
  open_tasks: {
    id: string;
    title: string;
    due: string | null;
    estimate_minutes: number | null;
    goal_id: string | null;
    importance: number;
    urgency: number;
    kind: string;
  }[];
  calendar: { title: string; when: string; all_day: boolean }[];
  previous_sessions: { date: string; mode: LifeSessionMode; summary: string }[];
}

export interface FocusSuggestion {
  task_id: string | null;
  title: string | null;
  reason: string;
  first_step: string | null;
  minutes: number | null;
  source: "ai" | "rule";
}

export interface LifeSessionAi {
  lifeSession?(input: {
    mode: LifeSessionMode;
    transcript: string;
    context: LifeContext;
  }): Promise<unknown>;
  focusNow?(input: { context: LifeContext; hint: string | null }): Promise<unknown>;
}

const open = (task: Task) => task.status === "todo" || task.status === "in_progress";

function localParts(at: Date, timezone: string) {
  const fmt = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, ...options }).format(at);
    } catch {
      return new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", ...options }).format(at);
    }
  };
  return {
    time: fmt({ hour: "2-digit", minute: "2-digit", hour12: false }),
    weekday: fmt({ weekday: "long" }),
    date: fmt({ day: "numeric", month: "long" }),
    short: fmt({ day: "numeric", month: "short" }).replace(".", ""),
  };
}

function safeZone(timezone: string | null | undefined) {
  const zone = timezone || "Europe/Moscow";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return zone;
  } catch {
    return "Europe/Moscow";
  }
}

/** «2026-11-27» для дел без времени, «2026-11-27 18:00» — со временем. */
function localDue(iso: string | null, timezone: string) {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const key = dateKeyInZone(at, timezone);
  const time = localParts(at, timezone).time;
  return time === "12:00" ? key : `${key} ${time}`;
}

export async function buildLifeContext(
  repository: AppRepository,
  ownerId: string,
  now = new Date(),
): Promise<LifeContext> {
  const profile = await repository.getProfile(ownerId);
  const timezone = safeZone(profile?.timezone);
  const [goals, tasks, sessions] = await Promise.all([
    repository.listGoals(ownerId),
    repository.listTasks(ownerId),
    repository.listLifeSessions(ownerId, 3),
  ]);
  const dayStart = new Date(now.getTime() - 2 * 3600_000).toISOString();
  const dayEnd = new Date(now.getTime() + 36 * 3600_000).toISOString();
  const events = await repository.listCalendarEvents(ownerId, dayStart, dayEnd).catch(() => []);
  const parts = localParts(now, timezone);
  const openTasks = tasks
    .filter(open)
    .sort((a, b) => {
      const ad = a.due_at ?? "9999";
      const bd = b.due_at ?? "9999";
      if (ad !== bd) return ad.localeCompare(bd);
      return (b.importance ?? 3) - (a.importance ?? 3);
    })
    .slice(0, 80);
  return {
    now_local: `${parts.date}, ${parts.time}`,
    weekday: parts.weekday,
    timezone,
    today: dateKeyInZone(now, timezone),
    goals: goals
      .filter((goal) => goal.status === "active")
      .slice(0, 12)
      .map((goal) => {
        const stats = withGoalStats(goal, tasks, now).stats;
        return {
          id: goal.id,
          title: goal.title,
          horizon: goal.horizon,
          plan: goal.current_plan ? goal.current_plan.slice(0, 400) : null,
          open_tasks: stats?.open_count ?? 0,
          done_tasks: stats?.done_count ?? 0,
        };
      }),
    open_tasks: openTasks.map((task) => ({
      id: task.id,
      title: task.title,
      due: localDue(task.due_at, timezone),
      estimate_minutes: task.estimate_minutes ?? null,
      goal_id: task.goal_id,
      importance: task.importance ?? 3,
      urgency: task.urgency ?? 3,
      kind: task.kind ?? "task",
    })),
    calendar: events.slice(0, 20).map((event) => {
      const start = localParts(new Date(event.starts_at), timezone);
      const end = localParts(new Date(event.ends_at), timezone);
      const day = dateKeyInZone(new Date(event.starts_at), timezone);
      return {
        title: event.title,
        when: event.all_day ? `${day} весь день` : `${day} ${start.time}–${end.time}`,
        all_day: event.all_day,
      };
    }),
    previous_sessions: sessions
      .filter((session) => session.summary)
      .map((session) => ({
        date: localParts(new Date(session.created_at), timezone).short,
        mode: session.mode,
        summary: (session.summary ?? "").slice(0, 600),
      })),
  };
}

const normalizedWords = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Срок только из слов человека: фраза про срок должна быть в его рассказе. */
export function groundedDue(
  task: Pick<SessionTask, "due_phrase" | "due_date">,
  transcript: string,
  timezone: string,
  now = new Date(),
) {
  const phrase = task.due_phrase?.trim();
  if (!phrase) return null;
  const heard = normalizedWords(transcript);
  const said = normalizedWords(phrase);
  if (!said || !heard.includes(said)) return null;
  return resolveCompanionDueAt(task.due_date, timezone, phrase, now);
}

/**
 * Приводим разбор модели к тому, что можно показать и принять: ключи уникальны,
 * ссылки на дела и цели — только существующие, срок — только названный,
 * повторы уже записанных дел превращаются в «обновить это дело».
 */
export function normalizeProposal(
  raw: unknown,
  context: LifeContext,
  transcript: string,
  now = new Date(),
): NormalizedProposal {
  const parsed = SessionProposalSchema.parse(raw);
  const goalIds = new Set(context.goals.map((goal) => goal.id));
  const taskIds = new Map(context.open_tasks.map((task) => [task.id, task]));
  const seenKeys = new Set<string>();
  const goals = parsed.goals.filter((goal) => {
    if (seenKeys.has(goal.key)) return false;
    seenKeys.add(goal.key);
    if (goal.op === "touch") return Boolean(goal.goal_id && goalIds.has(goal.goal_id));
    // «Создать» цель, которая уже есть, — это та же цель.
    const same = context.goals.find((item) => similarTaskTitles(item.title, goal.title));
    if (same) {
      goal.op = "touch";
      goal.goal_id = same.id;
    }
    return true;
  });
  const goalKeys = new Set(goals.map((goal) => goal.key));
  const goalByExisting = new Map(
    goals.filter((goal) => goal.goal_id).map((goal) => [goal.goal_id!, goal.key]),
  );
  const titles = new Set<string>();
  const tasks: NormalizedTask[] = [];
  for (const task of parsed.tasks) {
    if (seenKeys.has(task.key)) continue;
    const titleKey = normalizedWords(task.title);
    if (!titleKey || titles.has(titleKey)) continue;
    seenKeys.add(task.key);
    titles.add(titleKey);
    if (task.existing_task_id && !taskIds.has(task.existing_task_id)) task.existing_task_id = null;
    if (!task.existing_task_id) {
      const same = context.open_tasks.find((item) => similarTaskTitles(item.title, task.title));
      if (same) task.existing_task_id = same.id;
    }
    // Цель по ключу этой сессии, или по id существующей (модель могла дать id вместо ключа).
    if (task.goal_key && !goalKeys.has(task.goal_key)) {
      task.goal_key = goalIds.has(task.goal_key)
        ? (goalByExisting.get(task.goal_key) ?? null)
        : null;
    }
    tasks.push({ ...task, due_at: groundedDue(task, transcript, context.timezone, now) });
  }
  const nowKey =
    parsed.now?.task_key && tasks.some((task) => task.key === parsed.now!.task_key)
      ? parsed.now.task_key
      : (tasks.find((task) => task.bucket === "now")?.key ?? null);
  return {
    ...parsed,
    goals,
    tasks,
    now:
      parsed.now || nowKey
        ? { ...(parsed.now ?? { reason: null, first_step: null }), task_key: nowKey }
        : null,
  };
}

/** Без модели: каждая непустая фраза — кандидат в дело, всё в «потом». */
export function fallbackProposal(transcript: string): SessionProposal {
  const items = transcript
    .split(/\n+|(?<=[.!?;])\s+|,\s*(?:а\s+)?(?:ещё|еще|и\s+ещё|и\s+еще)\s+/u)
    .map((item) => item.replace(/^[-•*\d.)\s]+/u, "").trim())
    .filter((item) => item.length >= 4 && item.length <= 200)
    .slice(0, MAX_SESSION_TASKS);
  return {
    summary:
      "Записала всё, что ты сказал. Разобрать подробно сейчас не получилось — проверь список.",
    reflection: null,
    goals: [],
    tasks: items.map((title, index) => ({
      key: `t${index + 1}`,
      title: title.charAt(0).toLocaleUpperCase() + title.slice(1),
      description: null,
      bucket: "later" as const,
      due_phrase: null,
      due_date: null,
      estimate_minutes: null,
      sphere: "other" as const,
      goal_key: null,
      importance: 3,
      urgency: 3,
      assignee: "user" as const,
      existing_task_id: null,
    })),
    thoughts: [],
    now: null,
    alignment: null,
    questions: [],
  };
}

export async function createLifeSession(
  repository: AppRepository,
  ai: LifeSessionAi | undefined,
  ownerId: string,
  mode: LifeSessionMode,
  rawTranscript: string,
  now = new Date(),
): Promise<LifeSession> {
  const transcript = rawTranscript.replace(/\r\n?/g, "\n").trim().slice(0, MAX_SESSION_TRANSCRIPT);
  const context = await buildLifeContext(repository, ownerId, now);
  let raw: unknown = null;
  if (ai?.lifeSession) {
    await assertCloudQuota(repository, ownerId);
    try {
      raw = await ai.lifeSession({ mode, transcript, context });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "life_session_ai_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  let proposal: NormalizedProposal;
  try {
    proposal = normalizeProposal(raw ?? fallbackProposal(transcript), context, transcript, now);
  } catch {
    proposal = normalizeProposal(fallbackProposal(transcript), context, transcript, now);
  }
  return repository.createLifeSession(ownerId, {
    mode,
    transcript,
    proposal: proposal as unknown as Record<string, unknown>,
    summary: proposal.summary,
  });
}

export const ApplySessionSchema = z
  .object({
    tasks: z
      .array(
        z
          .object({
            key: z.string().min(1).max(40),
            title: z.string().trim().min(1).max(200).optional(),
            bucket: z.enum(SESSION_BUCKETS).optional(),
          })
          .strict(),
      )
      .max(MAX_SESSION_TASKS),
    goals: z.array(z.string().min(1).max(40)).max(MAX_SESSION_GOALS),
    now_key: z.string().min(1).max(40).nullable().optional(),
    save_thoughts: z.boolean().optional().default(true),
  })
  .strict();
export type ApplySessionInput = z.infer<typeof ApplySessionSchema>;

export interface ApplySessionResult {
  tasks: Task[];
  goals: Goal[];
  now_task_id: string | null;
  note_id: string | null;
}

const BUCKET_LABEL: Record<SessionBucket, string> = {
  now: "Сейчас",
  today: "Сегодня",
  week: "На неделе",
  later: "Потом",
  someday: "Когда-нибудь",
};

function sessionNoteBody(
  session: LifeSession,
  proposal: NormalizedProposal,
  accepted: { title: string; bucket: SessionBucket }[],
) {
  const lines: string[] = [proposal.summary];
  if (proposal.reflection) lines.push("", proposal.reflection);
  if (proposal.thoughts.length) {
    lines.push("", "Мысли и тревоги:");
    for (const thought of proposal.thoughts) lines.push(`• ${thought}`);
  }
  if (accepted.length) {
    lines.push("", "Записала в дела:");
    for (const item of accepted) lines.push(`• ${item.title} — ${BUCKET_LABEL[item.bucket]}`);
  }
  if (proposal.alignment) lines.push("", proposal.alignment);
  if (proposal.questions.length) {
    lines.push("", "Подумать:");
    for (const question of proposal.questions) lines.push(`• ${question}`);
  }
  lines.push("", "Что я сказал:", session.transcript);
  return lines.join("\n").slice(0, 50_000);
}

const SESSION_TITLE: Record<LifeSessionMode, string> = {
  unload: "Разгрузка головы",
  strategy: "Стратегическая сессия",
  talk: "Разговор с Илзи",
};

/** Человек принял разбор: заводим отмеченные цели и дела, мысли — в заметку. */
export async function applyLifeSession(
  repository: AppRepository,
  ownerId: string,
  sessionId: string,
  input: ApplySessionInput,
  now = new Date(),
): Promise<ApplySessionResult | null> {
  const session = await repository.getLifeSession(ownerId, sessionId);
  if (!session) return null;
  if (session.applied_at && session.result) return session.result as unknown as ApplySessionResult;
  const proposal = session.proposal as unknown as NormalizedProposal;
  const profile = await repository.getProfile(ownerId);
  const timezone = safeZone(profile?.timezone);
  const todayKey = dateKeyInZone(now, timezone);
  const todayMidday = localMidday(todayKey, timezone);

  const goalIdByKey = new Map<string, string>();
  const goals: Goal[] = [];
  const existingGoals = await repository.listGoals(ownerId);
  for (const goal of proposal.goals ?? []) {
    if (goal.op === "touch" && goal.goal_id) {
      const found = existingGoals.find((item) => item.id === goal.goal_id);
      if (found) goalIdByKey.set(goal.key, found.id);
      continue;
    }
    if (!input.goals.includes(goal.key)) continue;
    const created = await repository.createGoal(ownerId, {
      title: goal.title,
      description: goal.why,
      status: "active",
      horizon: goal.horizon,
    });
    goalIdByKey.set(goal.key, created.id);
    goals.push(created);
  }

  const byKey = new Map((proposal.tasks ?? []).map((task) => [task.key, task]));
  const tasks: Task[] = [];
  const accepted: { title: string; bucket: SessionBucket }[] = [];
  let nowTaskId: string | null = null;
  for (const choice of input.tasks) {
    const task = byKey.get(choice.key);
    if (!task) continue;
    const bucket = choice.bucket ?? task.bucket;
    const title = choice.title ?? task.title;
    // «Сейчас» и «Сегодня» человек сам поставил на сегодня, приняв разбор;
    // остальное — только со сроком, который он назвал.
    const onToday = bucket === "now" || bucket === "today";
    const dueKey = task.due_at ? dateKeyInZone(new Date(task.due_at), timezone) : null;
    const due = onToday ? (dueKey && dueKey <= todayKey ? task.due_at : todayMidday) : task.due_at;
    const goalId = task.goal_key ? (goalIdByKey.get(task.goal_key) ?? null) : null;
    const fields = {
      title,
      description: task.description,
      due_at: due,
      estimate_minutes: task.estimate_minutes,
      importance: bucket === "now" ? Math.max(task.importance, 4) : task.importance,
      urgency: bucket === "now" ? Math.max(task.urgency, 4) : task.urgency,
      assignee: task.assignee,
    };
    let saved: Task | null = null;
    if (task.existing_task_id) {
      const patch: Parameters<AppRepository["updateTask"]>[2] = {};
      if (due) patch.due_at = due;
      if (goalId) patch.goal_id = goalId;
      if (task.estimate_minutes) patch.estimate_minutes = task.estimate_minutes;
      if (bucket === "now") {
        patch.importance = fields.importance;
        patch.urgency = fields.urgency;
      }
      saved = Object.keys(patch).length
        ? await repository.updateTask(ownerId, task.existing_task_id, patch)
        : ((await repository.listTasks(ownerId)).find(
            (item) => item.id === task.existing_task_id,
          ) ?? null);
    } else {
      saved = await repository.createTask(ownerId, { ...fields, goal_id: goalId, status: "todo" });
    }
    if (!saved) continue;
    tasks.push(saved);
    accepted.push({ title: saved.title, bucket });
    const wantedNow = input.now_key === undefined ? proposal.now?.task_key : input.now_key;
    if (wantedNow === choice.key) nowTaskId = saved.id;
  }

  let noteId: string | null = null;
  if (input.save_thoughts) {
    noteId = randomUUID();
    const body = sessionNoteBody(session, proposal, accepted);
    const day = localParts(new Date(session.created_at), timezone).short;
    const result = await repository.mutateNote(ownerId, noteId, {
      base_revision: 0,
      client_mutation_id: randomUUID(),
      title: `${SESSION_TITLE[session.mode]} · ${day}`,
      content: meetingNoteDocument(body),
      plain_text: body,
    });
    if (result.status !== "ok") noteId = null;
  }

  const result: ApplySessionResult = { tasks, goals, now_task_id: nowTaskId, note_id: noteId };
  await repository.updateLifeSession(ownerId, sessionId, {
    result: result as unknown as Record<string, unknown>,
    note_id: noteId,
    applied_at: now.toISOString(),
  });
  return result;
}

/** Что сделать сейчас — без модели: самое важное и срочное из сегодняшнего и просроченного. */
export function ruleFocus(context: LifeContext): FocusSuggestion {
  const candidates = context.open_tasks.filter(
    (task) => task.kind !== "meeting" && task.due && task.due.slice(0, 10) <= context.today,
  );
  const pool = candidates.length
    ? candidates
    : context.open_tasks.filter((t) => t.kind !== "meeting");
  const best = [...pool].sort(
    (a, b) => b.importance * 10 + b.urgency - (a.importance * 10 + a.urgency),
  )[0];
  if (!best)
    return {
      task_id: null,
      title: null,
      reason: "Открытых дел нет. Можно выгрузить из головы то, что крутится, — я разложу.",
      first_step: null,
      minutes: null,
      source: "rule",
    };
  return {
    task_id: best.id,
    title: best.title,
    reason: candidates.length
      ? "Самое важное из того, что стоит на сегодня."
      : "На сегодня ничего не стоит — это самое важное из всех дел.",
    first_step: null,
    minutes: best.estimate_minutes,
    source: "rule",
  };
}

const FocusSchema = z.object({
  task_id: z.preprocess((v) => (v ? v : null), z.string().uuid().nullable().catch(null)),
  reason: z.string().trim().min(1).max(500),
  first_step: nullableText(300),
  minutes: z.preprocess(
    (value) => (typeof value === "number" && value > 0 ? Math.round(value) : null),
    z.number().int().min(1).max(480).nullable().catch(null),
  ),
});

export async function suggestFocusNow(
  repository: AppRepository,
  ai: LifeSessionAi | undefined,
  ownerId: string,
  hint: string | null,
  now = new Date(),
): Promise<FocusSuggestion> {
  const context = await buildLifeContext(repository, ownerId, now);
  if (!ai?.focusNow || !context.open_tasks.length) return ruleFocus(context);
  await assertCloudQuota(repository, ownerId);
  try {
    const parsed = FocusSchema.parse(await ai.focusNow({ context, hint }));
    const task = context.open_tasks.find((item) => item.id === parsed.task_id);
    if (!task) return ruleFocus(context);
    return {
      task_id: task.id,
      title: task.title,
      reason: parsed.reason,
      first_step: parsed.first_step,
      minutes: parsed.minutes ?? task.estimate_minutes,
      source: "ai",
    };
  } catch {
    return ruleFocus(context);
  }
}

/** Ответ клиенту: сессия без служебного. */
export function sessionView(session: LifeSession) {
  return {
    id: session.id,
    mode: session.mode,
    transcript: session.transcript,
    proposal: session.proposal,
    summary: session.summary,
    result: session.result,
    note_id: session.note_id,
    applied_at: session.applied_at,
    created_at: session.created_at,
  };
}
