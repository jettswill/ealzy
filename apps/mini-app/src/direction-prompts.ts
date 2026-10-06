import type { Language } from "./i18n/locale";
import type { Goal, SelfPromise, Task } from "./types";
import { dateKeyInZone } from "./today-tasks";

export const GOAL_SYNC_MARKER_RU = "Синк по целям и плану.";
export const GOAL_SYNC_MARKER_EN = "Goals and plan sync.";
export const GOAL_SYNC_GAP_DAYS = 7;
export const GOAL_SYNC_LATER_KEY = "ealzy.goal-sync-later";

export function isGoalSyncPrompt(text: string) {
  const raw = text.replace(/^сделай сам:\s*/iu, "").trim();
  return raw.startsWith(GOAL_SYNC_MARKER_RU) || raw.startsWith(GOAL_SYNC_MARKER_EN);
}

export function goalSyncInviteDue(
  lastOn: string | null | undefined,
  timezone: string,
  now = new Date(),
) {
  const today = dateKeyInZone(now, timezone || "UTC");
  const dismissed = typeof localStorage === "undefined" ? null : localStorage.getItem(GOAL_SYNC_LATER_KEY);
  const latest = [lastOn, dismissed].filter(Boolean).sort().at(-1) ?? null;
  if (!latest) return true;
  if (latest === today) return false;
  const start = Date.parse(`${latest}T12:00:00.000Z`);
  const end = Date.parse(`${today}T12:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return true;
  return Math.floor((end - start) / 86_400_000) >= GOAL_SYNC_GAP_DAYS;
}

export function markGoalSyncDismissed(timezone: string, now = new Date()) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(GOAL_SYNC_LATER_KEY, dateKeyInZone(now, timezone || "UTC"));
}

export function goalSyncPrompt(goals: Goal[], language: Language) {
  const marker = language === "en" ? GOAL_SYNC_MARKER_EN : GOAL_SYNC_MARKER_RU;
  const active = goals.filter((goal) => goal.status === "active");
  const lines = active.map((goal) => {
    const stats = goal.stats;
    const progress = stats
      ? language === "en"
        ? `${stats.done_count}/${stats.task_count} tasks, ${stats.days_active}d`
        : `${stats.done_count}/${stats.task_count} дел, ${stats.days_active} дн.`
      : language === "en"
        ? "no tasks yet"
        : "дел пока нет";
    const plan = goal.current_plan?.trim()
      ? language === "en"
        ? `plan: ${goal.current_plan.trim()}`
        : `план: ${goal.current_plan.trim()}`
      : language === "en"
        ? "no plan yet"
        : "плана ещё нет";
    return `• ${goal.title} [${goal.id}] — ${progress}; ${plan}`;
  });
  const listed = lines.length
    ? language === "en"
      ? ["Currently in play:", ...lines]
      : ["Сейчас в работе:", ...lines]
    : [];
  return language === "en"
    ? [
        marker,
        "Talk with me as a calm time-management mentor and psychologist: no guru talk, no diagnosis, no pressure.",
        "First get at the real motives — what I actually want and why. If the why is still fuzzy, ask one precise question and don't dump a plan or create goals.",
        "When the direction is clear: update the matching goal instead of duplicating it. Write current_plan as this week's plan (motive + 1–3 moves). Tasks are the next moves only, bound to those goals. One-off errands are tasks, not goals. Don't invent facts.",
        ...listed,
      ].join("\n")
    : [
        marker,
        "Поговори со мной как спокойный ментор по тайм-менеджменту и психолог: без пафоса, без диагнозов, без давления.",
        "Сначала пойми истинные мотивы — чего я хочу на самом деле и зачем. Если «зачем» ещё мутное, задай один точный вопрос и не вываливай план и не создавай цели.",
        "Когда направление ясно: если такая цель уже есть — обнови её, не плоди дубль. Запиши план на эту неделю (мотив + 1–3 шага) и ближайшие дела к этой цели. Одноразовые поручения — это дела, не цели. Не выдумывай факты.",
        ...listed,
      ].join("\n");
}

export function taskDiscussPrompt(task: Task, language: Language) {
  const due = task.due_at ?? task.due_date;
  const status = task.status;
  const owner =
    task.assignee === "ealzy"
      ? language === "en"
        ? "Assigned to Ilzi."
        : "Поручено Илзи."
      : "";
  const meta = [
    status,
    due ? (language === "en" ? `due ${due}` : `срок ${due}`) : "",
    task.kind === "meeting" ? (language === "en" ? "meeting" : "встреча") : "",
    task.importance != null ? (language === "en" ? `importance ${task.importance}/5` : `важность ${task.importance}/5`) : "",
    task.urgency != null ? (language === "en" ? `urgency ${task.urgency}/5` : `срочность ${task.urgency}/5`) : "",
    task.goal?.title
      ? language === "en"
        ? `goal: ${task.goal.title} [${task.goal_id}]`
        : `цель: ${task.goal.title} [${task.goal_id}]`
      : "",
    owner,
  ]
    .filter(Boolean)
    .join(" · ");
  return language === "en"
    ? `Let's talk through the task "${task.title}". ${meta}${task.description ? `\n${task.description}` : ""}\nHelp me unpack it. Split it only if that makes the next move obvious. Create a follow-up only when I need a real next action — for me (assignee user) or for you (assignee ealzy). If this task belongs to a goal, bind the follow-up to that goal_id. Don't rewrite that goal's current_plan. Don't invent a new goal. Don't invent facts.`
    : `Давай разберём дело «${task.title}». ${meta}${task.description ? `\n${task.description}` : ""}\nПомоги разобрать. Разбивай только если так яснее следующий шаг. Новое дело создавай, только если это реальный следующий шаг — на меня (assignee user) или на тебя (assignee ealzy). Если дело уже в цели — привяжи следующий шаг к тому же goal_id. План цели не переписывай. Не делай из этого новую цель. Не выдумывай факты.`;
}

export function goalDiscussPrompt(goal: Goal, language: Language) {
  const stats = goal.stats;
  const progress = stats
    ? language === "en"
      ? `${stats.done_count}/${stats.task_count} tasks, ${stats.days_active} days in`
      : `${stats.done_count}/${stats.task_count} дел, ${stats.days_active} дн.`
    : "";
  const horizon = goal.horizon ?? "";
  return language === "en"
    ? `Let's talk about the goal "${goal.title}" [${goal.id}]. ${progress}${horizon ? ` Horizon: ${horizon}.` : ""}${goal.description ? `\n${goal.description}` : ""}\nDiscuss direction. If a concrete next action is clear, create at most 1–3 tasks with this goal_id. Don't rewrite current_plan unless I ask to plan or say «да, давай». Don't create a second goal. Don't invent facts.`
    : `Давай обсудим цель «${goal.title}» [${goal.id}]. ${progress}${horizon ? ` Горизонт: ${horizon}.` : ""}${goal.description ? `\n${goal.description}` : ""}\nРазберём направление. Если следующий шаг ясен — создай не больше 1–3 дел с её goal_id. План цели не переписывай, пока я не попрошу план или не скажу «да, давай». Не создавай вторую цель. Не выдумывай факты.`;
}

export function goalCheckInPrompt(goal: Goal, language: Language) {
  const stats = goal.stats;
  const progress = stats
    ? language === "en"
      ? `${stats.done_count}/${stats.task_count} tasks, ${stats.days_active} days in`
      : `${stats.done_count}/${stats.task_count} дел, ${stats.days_active} дн.`
    : "";
  const horizon = goal.horizon ?? "";
  return language === "en"
    ? `Let's check in on the goal "${goal.title}" [${goal.id}]. ${progress}${horizon ? ` Horizon: ${horizon}.` : ""}${goal.description ? `\n${goal.description}` : ""}\nHow is it going? What's moving, what's stuck? If a concrete next step is clear, create at most one task with this goal_id. Don't invent a second goal. Don't invent facts.`
    : `Давай проверим цель «${goal.title}» [${goal.id}]. ${progress}${horizon ? ` Горизонт: ${horizon}.` : ""}${goal.description ? `\n${goal.description}` : ""}\nКак дела? Что сдвинулось, что тормозит? Если следующий шаг ясен — создай не больше одного дела с этим goal_id. Не создавай вторую цель. Не выдумывай факты.`;
}

export function goalPlanPrompt(goal: Goal, language: Language) {
  const stats = goal.stats;
  const progress = stats
    ? language === "en"
      ? `${stats.done_count}/${stats.task_count} tasks, ${stats.days_active} days in`
      : `${stats.done_count}/${stats.task_count} дел, ${stats.days_active} дн.`
    : "";
  const plan = goal.current_plan?.trim()
    ? language === "en"
      ? `\nCurrent plan:\n${goal.current_plan}`
      : `\nТекущий план:\n${goal.current_plan}`
    : "";
  const done = (goal.tasks ?? [])
    .filter((task) => task.status === "done")
    .slice(0, 8)
    .map((task) => `• ${task.title}`)
    .join("\n");
  const open = (goal.tasks ?? [])
    .filter((task) => task.status === "todo" || task.status === "in_progress")
    .map((task) => `• ${task.title}`)
    .join("\n");
  return language === "en"
    ? `Decompose the goal "${goal.title}" [${goal.id}] for right now. ${progress}${goal.description ? `\n${goal.description}` : ""}${plan}\nAlready done:\n${done || "• (none yet)"}\nCurrently open:\n${open || "• (none)"}\nWrite this week's plan (why it matters + 1–3 next moves). Update this goal_id. Create only those next tasks with this goal_id. Archive only open tasks that are truly obsolete. Don't invent facts.`
    : `Разложи цель «${goal.title}» [${goal.id}] на текущий момент. ${progress}${goal.description ? `\n${goal.description}` : ""}${plan}\nУже сделано:\n${done || "• (ещё ничего не закрыто)"}\nСейчас открыто:\n${open || "• (открытых дел нет)"}\nСобери план на эту неделю (зачем это важно + 1–3 шага). Обнови эту же цель. Новые дела — только ближайшие, с goal_id этой цели. Сними только те открытые дела, которые правда устарели. Не выдумывай факты.`;
}

export function goalRelevancePrompt(goal: Goal, language: Language) {
  const stats = goal.stats;
  const progress = stats
    ? language === "en"
      ? `${stats.done_count}/${stats.task_count} tasks done, running ${stats.days_active} days`
      : `${stats.done_count}/${stats.task_count} дел сделано, идёт ${stats.days_active} дн.`
    : "";
  return language === "en"
    ? `Look at this goal: "${goal.title}" [${goal.id}]. ${progress}${goal.description ? `\n${goal.description}` : ""}\nIs it still relevant and well-formed? If the wording or horizon is off, update this goal_id's title/horizon/status. Do not rewrite current_plan. Don't create a second goal. Don't invent facts.`
    : `Посмотри цель «${goal.title}» [${goal.id}]. ${progress}${goal.description ? `\n${goal.description}` : ""}\nОна ещё актуальна и корректно сформулирована? Если формулировка или горизонт неточные — обнови title/horizon/status этой цели. current_plan не переписывай. Не создавай вторую цель. Не выдумывай факты.`;
}

export function promiseCheckInPrompt(promises: SelfPromise[], language: Language) {
  if (!promises.length) {
    return language === "en"
      ? "I don't have promises to myself yet. Help me name 1–3 internal principles or directions I actually want to keep. Don't invent facts."
      : "Обещаний себе пока нет. Помоги назвать 1–3 внутренних принципа или направления, которые я реально хочу держать. Не выдумывай факты.";
  }
  const list = promises
    .map((item) => {
      const days = item.stats?.keeping_days ?? 0;
      const last = item.stats?.last_checkin_status;
      return language === "en"
        ? `• ${item.title} — keeping ${days}d${last ? `, last: ${last}` : ""}`
        : `• ${item.title} — держу ${days} дн.${last ? `, последний отклик: ${last}` : ""}`;
    })
    .join("\n");
  return language === "en"
    ? `How am I doing with my promises to myself:\n${list}\nAsk how it's going, praise real streaks, and if something is shaky help unpack it. Don't invent facts.`
    : `Как у меня с обещаниями себе:\n${list}\nСпроси как дела, похвали за устойчивость, если что-то шатко — помоги разобрать. Не выдумывай факты.`;
}

export function promisePsychologistPrompt(promise: SelfPromise, language: Language) {
  return language === "en"
    ? `I promised myself: "${promise.title}". Today that slipped.${promise.description ? `\n${promise.description}` : ""}\nTalk with me as a warm psychologist: no shame, look at what happened, and help me either adjust the promise or return to the ritual. Don't invent facts.`
    : `Я обещал себе: «${promise.title}». Сегодня это сорвалось.${promise.description ? `\n${promise.description}` : ""}\nПоговори со мной как тёплый психолог: без стыда, разбери что произошло, и помоги понять — скорректировать обещание или вернуть ритуал. Не выдумывай факты.`;
}
