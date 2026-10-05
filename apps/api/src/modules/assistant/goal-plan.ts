import type { AppRepository } from "../../repository.js";
import { daysBetween, withGoalStats } from "../../direction.js";
import { languageOf } from "../../locale.js";
import type { Goal, Task } from "../../types.js";

const openStatuses = new Set(["todo", "in_progress"]);

export const GOAL_SYNC_MARKER_RU = "Синк по целям и плану.";
export const GOAL_SYNC_MARKER_EN = "Goals and plan sync.";

export type GoalPlanEntity = {
  type: "goal" | "task";
  id: string;
  label: string;
  op?: "create" | "update";
};

export interface GoalPlanAction {
  goal_id: string | null;
  summary: string | null;
  archive_task_ids: string[];
}

export interface GoalWriteTask {
  title: string;
  due_at: string | null;
  importance?: number | null;
  urgency?: number | null;
  assignee: "user" | "ealzy";
}

export interface GoalWriteAction {
  op: "create" | "update";
  goal_id: string | null;
  title: string | null;
  description: string | null;
  status?: Goal["status"] | null;
  horizon?: "short" | "medium" | "long" | null;
  current_plan: string | null;
  tasks: GoalWriteTask[];
}

export interface LinkedGoalTask extends GoalWriteTask {
  goal_id: string;
}

export const GOAL_SYNC_GAP_DAYS = 7;

export function isGoalSyncTurn(text: string) {
  const raw = text.replace(/^сделай сам:\s*/iu, "").trim();
  return raw.startsWith(GOAL_SYNC_MARKER_RU) || raw.startsWith(GOAL_SYNC_MARKER_EN);
}

const GOAL_SYNC_BOILERPLATE =
  /^(Поговори со мной|Talk with me as|Сначала пойми|First get at|Когда направление|When the direction|Сейчас в работе|Currently in play|Особенно слабо|The weakest motion)/u;

export function goalSyncUserAddendum(text: string) {
  const raw = text.replace(/^сделай сам:\s*/iu, "").trim();
  if (!isGoalSyncTurn(raw)) return raw;
  return raw
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line === GOAL_SYNC_MARKER_RU || line === GOAL_SYNC_MARKER_EN) return false;
      if (GOAL_SYNC_BOILERPLATE.test(line)) return false;
      if (/^•\s/.test(line)) return false;
      return true;
    })
    .join(" ")
    .trim();
}

export function goalSyncAllowsCreate(
  text: string,
  goals: { title: string; status?: string | null }[],
) {
  if (!isGoalSyncTurn(text)) return true;
  const active = goals.filter((goal) => !goal.status || goal.status === "active");
  if (!active.length) return true;
  return goalSyncUserAddendum(text).length >= 8;
}

export function explicitGoalWriteIntent(text: string) {
  const raw = text.replace(/^сделай сам:\s*/iu, "").trim();
  if (isGoalSyncTurn(raw)) return true;
  return /запиши(?:те)?\s+(?:это\s+)?(?:как\s+)?цель|создай(?:те)?\s+цель|зафиксир|составь(?:те)?\s+(?:мне\s+)?план|разлож\p{L}*|обнови(?:те)?\s+(?:цель|план)|сделай(?:те)?\s+(?:мне\s+)?план|сделай(?:те)?\s+(?:это\s+)?целью|(?:это|как)\s+цель|create (?:a )?goal|build a (?:short )?action plan|decompose the goal|make (?:this|it) a goal/iu.test(
    raw,
  );
}

const THANKS_ONLY =
  /^(спасибо|благодар(?:ю|им)|thanks|thank you|понял(?:а|и)?|ясно|ок(?:ей)?|ok|угу|ага|лол|хаха)[.!\s]*$/iu;
const CONTINUED_WRITE =
  /^(?:да[,.]?\s+)?(?:давай|сделай(?:те)?|запиши(?:те)?|обнови(?:те)?|разлож\p{L}*|составь(?:те)?|(?:ок(?:ей)?|хорошо)[,.]?\s*давай|yes|sure|go)(?=\s|$|[.,!?])/iu;
const TALK_AFTER_ASSENT =
  /^(?:да[,.]?\s+)?(?:давай|(?:ок(?:ей)?|хорошо)[,.]?\s*давай|yes|sure)\s+(?:подума\p{L}*|разбер\p{L}*|обсуд\p{L}*|поговор\p{L}*|верн\p{L}*|сначала|потом|позже|не\s+сейчас|не\s+надо|ещё|еще|просто|про\s+(?:мотив|зачем|смысл)|без\s+плана|я\s+сам)/iu;
const GOAL_FOCUS =
  /давай обсудим цель|давай проверим цель|посмотри цель|разлож\p{L}*\s+цель|let's talk about the goal|let's check in on the goal|look at this goal|decompose the goal/iu;
const TASK_FOCUS =
  /давай разберём дело|давай разберем дело|let's talk through the task/iu;
const GOAL_DISCUSS =
  /давай обсудим цель|let's talk about the goal/iu;

export function continuedGoalWriteIntent(text: string) {
  const raw = text.replace(/^сделай сам:\s*/iu, "").trim();
  if (!raw) return false;
  if (explicitGoalWriteIntent(raw)) return true;
  if (THANKS_ONLY.test(raw)) return false;
  if (GOAL_FOCUS.test(raw)) return false;
  if (TASK_FOCUS.test(raw)) return false;
  if (TALK_AFTER_ASSENT.test(raw)) return false;
  if (/\?/u.test(raw) && !CONTINUED_WRITE.test(raw)) return false;
  return CONTINUED_WRITE.test(raw);
}

export function goalRefineIntent(text: string) {
  const raw = text.replace(/^сделай сам:\s*/iu, "").trim();
  return /посмотри цель|look at this goal|актуальн|well-formed|сформулир/iu.test(raw);
}

export function goalCheckInIntent(text: string) {
  const raw = text.replace(/^сделай сам:\s*/iu, "").trim();
  return /давай проверим цель|let's check in on the goal/iu.test(raw);
}

export function goalDiscussIntent(text: string) {
  const raw = text.replace(/^сделай сам:\s*/iu, "").trim();
  return GOAL_DISCUSS.test(raw);
}

export function goalStatusWriteIntent(text: string) {
  const raw = text.replace(/^сделай сам:\s*/iu, "").trim();
  return /постав(?:ь|ьте)\s+(?:это\s+)?(?:цель\s+)?на паузу|приостанов|пауза цели|заверш(?:и|ить)\s+цель|закро(?:й|йте)\s+цель|больше не актуал|сними цель|pause (?:the |this )?goal|complete (?:the |this )?goal|cancel (?:the |this )?goal|mark (?:the |this )?goal (?:as )?(?:complete|paused)/iu.test(
    raw,
  );
}

const TOPIC_SHIFT =
  /(?:^|[^\p{L}])(?:куп(?:ить|и)|позвон(?:ить|и)|записа(?:ться|ть)|отправ(?:ить|ь)|оплат(?:ить|и)|добав(?:ь|ьте)\s+(?:дел|задач)|поставь(?:те)?\s+дел|какие дела|что на сегодня|что на завтра)(?=\s|$|[.,!?])/iu;

export function isGoalTopicShift(text: string) {
  const raw = text.replace(/^сделай сам:\s*/iu, "").trim();
  if (!raw) return false;
  if (GOAL_FOCUS.test(raw) || TASK_FOCUS.test(raw)) return false;
  if (explicitGoalWriteIntent(raw) || isGoalSyncTurn(raw) || continuedGoalWriteIntent(raw)) return false;
  if (goalRefineIntent(raw) || goalCheckInIntent(raw)) return false;
  return TOPIC_SHIFT.test(raw);
}

const GOAL_UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

export function focusedGoalFromText<T extends { id: string; title: string }>(
  text: string,
  goals: T[],
  tasks: { title: string; goal_id?: string | null }[] = [],
): T | null {
  if (!goals.length) return null;
  const raw = text.replace(/^сделай сам:\s*/iu, "").trim();
  const uuid = raw.match(GOAL_UUID)?.[0];
  if (uuid) {
    const byId = goals.find((goal) => goal.id === uuid);
    if (byId) return byId;
  }
  const quoted = raw.match(/(?:цель|goal)\s+[«"]([^»"]{2,120})[»"]/iu)?.[1];
  if (quoted) {
    return goals.find((goal) => similarGoalTitles(goal.title, quoted)) ?? null;
  }
  const taskQuoted = raw.match(/(?:дело|задач[уие]|task)\s+[«"]([^»"]{2,120})[»"]/iu)?.[1];
  if (taskQuoted) {
    const linked = tasks.find(
      (task) =>
        Boolean(task.goal_id) &&
        (similarGoalTitles(task.title, taskQuoted) ||
          task.title.toLocaleLowerCase() === taskQuoted.toLocaleLowerCase()),
    );
    const goal = linked?.goal_id ? goals.find((item) => item.id === linked.goal_id) : null;
    if (goal) return goal;
  }
  if (!GOAL_FOCUS.test(raw)) return null;
  const mentioned = goals.filter(
    (goal) =>
      similarGoalTitles(goal.title, raw) ||
      raw.toLocaleLowerCase().includes(goal.title.toLocaleLowerCase()),
  );
  return mentioned.length === 1 ? mentioned[0]! : null;
}

export const FOCUS_USER_TURNS = 12;

export function focusedGoalFromConversation<T extends { id: string; title: string }>(
  text: string,
  messages: { content: string; role?: string }[],
  goals: T[],
  tasks: { title: string; goal_id?: string | null }[] = [],
) {
  const current = focusedGoalFromText(text, goals, tasks);
  if (current) return current;
  const recent = messages.filter((message) => message.role !== "assistant").slice(-FOCUS_USER_TURNS);
  for (const message of [...recent].reverse()) {
    const found = focusedGoalFromText(message.content, goals, tasks);
    if (found) return found;
    if (isGoalTopicShift(message.content)) return null;
  }
  return null;
}

function normalizeTitle(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function titleNumbersConflict(left: string, right: string) {
  const numbers = (value: string) =>
    [...value.matchAll(/\d+/gu)].map((match) => String(Number(match[0])));
  const a = new Set(numbers(left));
  const b = new Set(numbers(right));
  if (!a.size || !b.size) return false;
  const onlyA = [...a].filter((n) => !b.has(n));
  const onlyB = [...b].filter((n) => !a.has(n));
  return onlyA.length > 0 && onlyB.length > 0;
}

const GOAL_GENERIC = new Set([
  "выучить",
  "начать",
  "стать",
  "сделать",
  "хочу",
  "план",
  "цель",
  "кажды",
  "каждый",
  "день",
  "неделя",
  "неделе",
  "утром",
  "вечером",
  "сегодня",
  "завтра",
  "язык",
  "научиться",
  "learn",
  "start",
  "become",
  "make",
  "goal",
  "plan",
  "every",
  "week",
  "morning",
  "evening",
  "language",
]);

function titleContentTokens(value: string) {
  return normalizeTitle(value)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((token) => (token.length > 3 || /^\d+$/.test(token)) && !GOAL_GENERIC.has(token));
}

function relatedTitleToken(left: string, right: string) {
  if (left === right) return true;
  return (
    left.length >= 4 &&
    right.length >= 4 &&
    (left.startsWith(right.slice(0, 4)) || right.startsWith(left.slice(0, 4)))
  );
}

export function titleDistinctiveConflict(left: string, right: string) {
  const ta = titleContentTokens(left);
  const tb = titleContentTokens(right);
  if (!ta.length || !tb.length) return false;
  const uniqueA = ta.filter((token) => !tb.some((other) => relatedTitleToken(token, other)));
  const uniqueB = tb.filter((token) => !ta.some((other) => relatedTitleToken(token, other)));
  const objectA = uniqueA.filter((token) => token.length > 4 && !/^\d+$/.test(token));
  const objectB = uniqueB.filter((token) => token.length > 4 && !/^\d+$/.test(token));
  return objectA.length > 0 && objectB.length > 0;
}

export function similarGoalTitles(left: string, right: string) {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (titleNumbersConflict(a, b)) return false;
  if (titleDistinctiveConflict(a, b)) return false;
  if (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a))) return true;
  const tokens = (value: string) =>
    value
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3 || /^\d+$/.test(token));
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return false;
  let overlap = 0;
  for (const token of ta) {
    if (tb.some((other) => other.startsWith(token.slice(0, 4)) || token.startsWith(other.slice(0, 4))))
      overlap += 1;
  }
  return overlap / Math.min(ta.length, tb.length) >= 0.6;
}

export function shouldReplaceGoalTitle(existing: string, incoming: string) {
  const a = normalizeTitle(existing);
  const b = normalizeTitle(incoming);
  if (!b || a === b) return false;
  if (a.includes(b) && a.length > b.length) return false;
  if (similarGoalTitles(a, b) && b.length < a.length) return false;
  return true;
}

export function goalSyncDueOn(lastOn: string | null | undefined, today: string) {
  if (!lastOn) return true;
  if (lastOn === today) return false;
  return daysBetween(`${lastOn}T12:00:00.000Z`, new Date(`${today}T12:00:00.000Z`)) >= GOAL_SYNC_GAP_DAYS;
}

export function pickGoalCheckIn(goals: Goal[], tasks: Task[], now = new Date()): Goal | null {
  const active = goals
    .filter((goal) => goal.status === "active")
    .map((goal) => withGoalStats(goal, tasks, now));
  if (!active.length) return null;
  const score = (goal: Goal) => {
    const stats = goal.stats;
    const openCount = stats?.open_count ?? 0;
    const doneCount = stats?.done_count ?? 0;
    const days = stats?.days_active ?? 0;
    const noPlan = !goal.current_plan?.trim();
    const planAge = goal.plan_revised_at ? daysBetween(goal.plan_revised_at, now) : 99;
    return (
      (noPlan ? 4 : 0) +
      (openCount === 0 ? 3 : 0) +
      (doneCount === 0 && days >= 3 ? 2 : 0) +
      (planAge >= 14 ? 2 : 0) +
      Math.min(days, 30) / 30
    );
  };
  return [...active].sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title))[0] ?? null;
}

export function goalPlanInstruction(goal: Goal, locale: string | null | undefined, tasks: Task[]) {
  const ru = languageOf(locale) !== "en";
  const linked = tasks.filter((task) => task.goal_id === goal.id);
  const open = linked.filter((task) => openStatuses.has(task.status));
  const done = linked.filter((task) => task.status === "done").slice(0, 8);
  const stats = goal.stats;
  const progress = stats
    ? ru
      ? `${stats.done_count}/${stats.task_count} дел, ${stats.days_active} дн.`
      : `${stats.done_count}/${stats.task_count} tasks, ${stats.days_active}d`
    : "";
  const doneLines = done.length
    ? done.map((task) => `• ${task.title}`).join("\n")
    : ru
      ? "• (ещё ничего не закрыто)"
      : "• (nothing completed yet)";
  const openLines = open.length
    ? open.map((task) => `• ${task.title} [${task.id}]`).join("\n")
    : ru
      ? "• (открытых дел нет)"
      : "• (no open tasks)";
  const plan = goal.current_plan?.trim()
    ? ru
      ? `Текущий план:\n${goal.current_plan}`
      : `Current plan:\n${goal.current_plan}`
    : ru
      ? "Текущего плана ещё нет."
      : "There is no current plan yet.";
  return ru
    ? [
        `Разложи цель «${goal.title}» [${goal.id}] на текущий момент. ${progress}`,
        goal.description ? `Описание: ${goal.description}` : "",
        plan,
        `Уже сделано:\n${doneLines}`,
        `Сейчас открыто:\n${openLines}`,
        "Собери план на эту неделю: зачем это ей/ему важно, 1–3 следующих шага, что пока не делать. Обнови эту же цель (goal_actions.update с её goal_id), запиши current_plan / goal_plan.summary. Новые дела — только ближайшие, с goal_id этой цели. Снимай через archive_task_ids только те открытые дела, которые правда устарели — не трогай остальные. Не создавай вторую цель с тем же смыслом. Не выдумывай факты.",
      ]
        .filter(Boolean)
        .join("\n")
    : [
        `Decompose the goal "${goal.title}" [${goal.id}] for right now. ${progress}`,
        goal.description ? `Description: ${goal.description}` : "",
        plan,
        `Already done:\n${doneLines}`,
        `Currently open:\n${openLines}`,
        "Write a plan for this week: why it matters to this person, 1–3 next moves, what not to do yet. Update this same goal (goal_actions.update with its goal_id) and save current_plan / goal_plan.summary. New tasks must be the next moves only, with this goal_id. Archive via archive_task_ids only open tasks that are truly obsolete. Do not create a second goal with the same meaning. Don't invent facts.",
      ]
        .filter(Boolean)
        .join("\n");
}

function goalSyncLines(goal: Goal, tasks: Task[], ru: boolean) {
  const stats = goal.stats;
  const progress = stats
    ? ru
      ? `${stats.done_count}/${stats.task_count} дел, ${stats.days_active} дн.`
      : `${stats.done_count}/${stats.task_count} tasks, ${stats.days_active}d`
    : ru
      ? "дел пока нет"
      : "no tasks yet";
  const open = tasks.filter(
    (task) => task.goal_id === goal.id && openStatuses.has(task.status),
  );
  const openLine = open.length
    ? open
        .slice(0, 6)
        .map((task) => task.title)
        .join("; ")
    : ru
      ? "открытых дел нет"
      : "no open tasks";
  const plan = goal.current_plan?.trim()
    ? ru
      ? `план: ${goal.current_plan.trim()}`
      : `plan: ${goal.current_plan.trim()}`
    : ru
      ? "плана ещё нет"
      : "no plan yet";
  return `• ${goal.title} [${goal.id}] — ${progress}; ${plan}; ${openLine}`;
}

export function goalSyncInstruction(
  goals: Goal[],
  tasks: Task[],
  locale: string | null | undefined,
  highlightGoalId?: string | null,
) {
  const ru = languageOf(locale) !== "en";
  const active = goals.filter((goal) => goal.status === "active");
  const highlight = highlightGoalId
    ? active.find((goal) => goal.id === highlightGoalId)
    : null;
  const lines = active.length
    ? active.map((goal) => goalSyncLines(goal, tasks, ru))
    : [ru ? "• (активных целей пока нет)" : "• (no active goals yet)"];
  const focus = highlight
    ? ru
      ? `Особенно слабо движется «${highlight.title}».`
      : `The weakest motion right now is "${highlight.title}".`
    : "";
  return ru
    ? [
        GOAL_SYNC_MARKER_RU,
        "Поговори со мной как спокойный ментор по тайм-менеджменту и психолог: без пафоса, без диагнозов, без давления.",
        "Сначала пойми истинные мотивы — чего я хочу на самом деле и зачем. Если «зачем» ещё мутное, задай один точный вопрос и не вываливай план и не создавай цели.",
        "Когда направление ясно: если такая цель уже есть — обнови её, не плоди дубль. Запиши current_plan как план на эту неделю (мотив + 1–3 шага). Дела только ближайшие, с goal_id. Одноразовые поручения — это дела, не цели. Опирайся на память обо мне. Не выдумывай факты.",
        focus,
        "Сейчас в работе:",
        ...lines,
      ]
        .filter(Boolean)
        .join("\n")
    : [
        GOAL_SYNC_MARKER_EN,
        "Talk with me as a calm time-management mentor and psychologist: no guru talk, no diagnosis, no pressure.",
        "First get at the real motives — what I actually want and why. If the why is still fuzzy, ask one precise question and don't dump a plan or create goals.",
        "When the direction is clear: update the matching goal instead of duplicating it. Write current_plan as this week's plan (motive + 1–3 moves). Tasks are the next moves only, with that goal_id. One-off errands are tasks, not goals. Use what you already know about me. Don't invent facts.",
        focus,
        "Currently in play:",
        ...lines,
      ]
        .filter(Boolean)
        .join("\n");
}

export async function archiveGoalLinkedWork(
  repository: AppRepository,
  ownerId: string,
  goalId: string,
) {
  const goal = await repository.getGoal(ownerId, goalId);
  if (!goal) return false;
  const [tasks, projects] = await Promise.all([
    repository.listTasks(ownerId),
    repository.listProjects(ownerId),
  ]);
  for (const task of tasks) {
    if (task.goal_id !== goalId || !openStatuses.has(task.status)) continue;
    await repository.updateTask(ownerId, task.id, { status: "cancelled" });
  }
  for (const project of projects) {
    if (project.goal_id !== goalId || project.status !== "active") continue;
    await repository.updateProject(ownerId, project.id, { status: "cancelled" });
  }
  await repository.updateGoal(ownerId, goalId, { status: "cancelled" });
  return true;
}

export async function applyGoalPlan(
  repository: AppRepository,
  ownerId: string,
  plan: GoalPlanAction | null | undefined,
  createdTaskIds: Set<string>,
): Promise<GoalPlanEntity[]> {
  const goalId = plan?.goal_id;
  const summary = plan?.summary?.trim();
  if (!goalId || !summary) return [];
  const goal = await repository.getGoal(ownerId, goalId);
  if (!goal) return [];
  const revisedAt = new Date().toISOString();
  await repository.updateGoal(ownerId, goalId, {
    current_plan: summary.slice(0, 4000),
    plan_revised_at: revisedAt,
  });
  const entities: GoalPlanEntity[] = [{ type: "goal", id: goal.id, label: goal.title, op: "update" }];
  const tasks = await repository.listTasks(ownerId);
  const requested = new Set(plan?.archive_task_ids ?? []);
  for (const task of tasks) {
    if (task.goal_id !== goalId || !openStatuses.has(task.status)) continue;
    if (createdTaskIds.has(task.id)) continue;
    if (!requested.has(task.id)) continue;
    const updated = await repository.updateTask(ownerId, task.id, { status: "cancelled" });
    if (updated) entities.push({ type: "task", id: updated.id, label: updated.title });
  }
  return entities;
}

export async function applyGoalActions(
  repository: AppRepository,
  ownerId: string,
  actions: GoalWriteAction[] | null | undefined,
  options: {
    allowCreate?: boolean;
    allowMatchByTitle?: boolean;
    allowPlan?: boolean;
    allowStatus?: boolean;
    allowHorizon?: boolean;
  } = {},
): Promise<{ entities: GoalPlanEntity[]; linked_tasks: LinkedGoalTask[] }> {
  const entities: GoalPlanEntity[] = [];
  const linked_tasks: LinkedGoalTask[] = [];
  if (!actions?.length) return { entities, linked_tasks };
  const allowCreate = options.allowCreate ?? false;
  const allowMatchByTitle = options.allowMatchByTitle ?? allowCreate;
  const allowPlan = options.allowPlan ?? true;
  const allowStatus = options.allowStatus ?? false;
  const allowHorizon = options.allowHorizon ?? false;
  const revisedAt = new Date().toISOString();
  const existing = (await repository.listGoals(ownerId)).filter((item) => item.status === "active");
  for (const action of actions) {
    const title = action.title?.trim();
    let goal =
      action.goal_id && (allowCreate || allowMatchByTitle)
        ? await repository.getGoal(ownerId, action.goal_id)
        : null;
    if (!goal && title && allowMatchByTitle) {
      goal = existing.find((item) => similarGoalTitles(item.title, title)) ?? null;
    }
    let op: "create" | "update" = "update";
    if (goal) {
      op = "update";
    } else if (action.op === "create") {
      if (!title || !allowCreate) continue;
      op = "create";
      goal = await repository.createGoal(ownerId, {
        title: title.slice(0, 300),
        description: action.description?.trim() || null,
        status:
          allowStatus && (action.status === "paused" || action.status === "completed")
            ? action.status
            : "active",
        horizon: allowHorizon ? action.horizon : undefined,
        current_plan: action.current_plan?.trim() || null,
        plan_revised_at: action.current_plan?.trim() ? revisedAt : null,
      });
      existing.push(goal);
    }
    if (!goal) continue;
    if (op === "update") {
      const patch: Parameters<AppRepository["updateGoal"]>[2] = {};
      if (title && shouldReplaceGoalTitle(goal.title, title)) patch.title = title.slice(0, 300);
      const incomingDescription = action.description?.trim();
      if (incomingDescription) patch.description = incomingDescription;
      if (allowStatus && action.status) patch.status = action.status;
      if (allowHorizon && action.horizon) patch.horizon = action.horizon;
      if (allowPlan && action.current_plan?.trim()) {
        patch.current_plan = action.current_plan.trim().slice(0, 4000);
        patch.plan_revised_at = revisedAt;
      }
      if (Object.keys(patch).length) {
        goal = (await repository.updateGoal(ownerId, goal.id, patch)) ?? goal;
      }
    }
    if (!goal) continue;
    entities.push({ type: "goal", id: goal.id, label: goal.title, op });
    for (const task of action.tasks.slice(0, 3)) {
      const taskTitle = task.title?.trim();
      if (!taskTitle) continue;
      linked_tasks.push({
        title: taskTitle.slice(0, 300),
        due_at: task.due_at,
        importance: task.importance ?? null,
        urgency: task.urgency ?? null,
        assignee: task.assignee === "ealzy" ? "ealzy" : "user",
        goal_id: goal.id,
      });
    }
  }
  return { entities, linked_tasks };
}
