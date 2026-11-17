import type { Memory, Message, PersonalContext, Person, PersonProfile } from "../../types.js";
import { withGoalStats } from "../../direction.js";
import { compactLocations } from "./locations.js";
import { compactDates } from "./dates.js";
import { personMentionedIn } from "./people.js";
import { isPushTask } from "./task-priority.js";
import { workspaceSettings } from "./settings.js";

export function queryOverlap(text: string, query: string) {
  const hay = text.toLocaleLowerCase();
  const tokens = query
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 3);
  if (!tokens.length) return 0;
  return tokens.reduce((score, token) => score + (hay.includes(token) ? 1 : 0), 0);
}

export function rankByQuery<T>(
  items: T[],
  query: string,
  textOf: (item: T) => string,
  bonus: (item: T) => number = () => 0,
) {
  return [...items].sort((a, b) => {
    const delta =
      queryOverlap(textOf(b), query) * 4 +
      bonus(b) -
      (queryOverlap(textOf(a), query) * 4 + bonus(a));
    return delta;
  });
}

export const COMPANION_CAPABILITIES = [
  "grounding: every reply is oriented on workspace.self (bio, values, memories), workspace.goals (current_plan, open_tasks), workspace.promises (bearings) and workspace.tasks — do not give generic advice that ignores or contradicts that record",
  "tasks: create a task for every real next action in this message — a spoken dump, a numbered list, a short infinitive errand («купить лекарства»), or several requests in one turn all count; «добавь задачу на завтра» plus a research question is one new task whose title is that question, not a request to list when=tomorrow; do not wait for «поставь дело»; if workspace.tasks already has the same open work, update that id instead of creating another; «добавь в описание» / «допиши в задачу» is op=update with task_actions.description on that id — never a new task titled as the description request; if which task is unclear, ask once and leave task_actions empty; bind goal_id when the work belongs to a workspace goal; never turn a feeling or a question into a task unless they asked to capture it; never collapse several errands into one title; a title is the action itself in plain words («Купить молоко», «Позвонить Пете про аренду») — never copy the request wrapper into it («добавь задачу», «поставь дело», «запиши в список», «пожалуйста», the assistant's name), rephrase spoken or messy speech into a clear short task; max 8 new tasks per turn; use ids from workspace.tasks; kind task or meeting; importance and urgency 1-5; push=true means remind the person firmly to do it now; assignee user for the person, ealzy for work Ealzy will do later from the global calendar queue — never complete, start, update or create task_actions for assignee ealzy, put that draft in the answer only; due_at only when the user named a date or deadline in this or recent messages, or it follows unambiguously from context (an upcoming date they referred to) — otherwise due_at is null: a task without a stated date stays undated, never pick a date yourself; «до конца декабря» / «до конца месяца» means the last day of that month; resolve due_at from workspace.now; when the user gives only a day, return a YYYY-MM-DD date and leave due_time empty — never invent 09:00 or 12:00; include a clock only when the user explicitly specified one; set estimate_minutes when the user says how long the work will take",
  "goals: a goal is an outcome the person wants to keep, not a one-off errand. If motives are fuzzy, ask one precise question and leave goal_actions empty. If portrait/values/memories already hold the motive, do not re-ask — propose this week's 1-3 moves and ask to save. If workspace.goals already has that outcome, update that id — never duplicate and never shrink the title to a short restatement. Write current_plan as this week's plan (why it matters to THIS person from portrait/values + 1-3 moves). Use workspace.goals[].open_tasks as the live plan: op=update those ids, do not recreate them. Nested new tasks must use that goal_id. Distinct quantities stay distinct tasks. After discuss/check-in, a short «да, давай» / «давай» writes the plan; «давай подумаем», «давай разберём», «давай сначала», unpacking a task, «спасибо» / «подумаю» / a why-question do not. Archive only via explicit archive_task_ids. Do not invent progress numbers or goals the person did not name",
  "promises: workspace.promises are commitments to self; ask how they are going, praise streaks, and if a promise is broken offer a psychologist-style talk without shame or diagnosis",
  "self: workspace.self.portrait is your long-term model of THIS person; patterns are silent observations from their tasks and promises; bio, values, communication_style and memories fill in the rest — use all of it in every reply; when they ask about more work or another project, name a value from workspace.self.values; do not re-ask facts already in portrait or memories; persist new durable facts with self_facts even when they did not say «запомни»; update by memory_id when a thesis already exists. Never tasks or other people; never invent",
  'people: any durable fact about ANOTHER person (relative, partner, friend, colleague) — a taste, a birthday, a job, a story — goes to person_facts, never to self_facts, also when the person did not say «запомни». One item per fact: {"person_name": nominative name or the role word when no name is given («Оля», «мама»), "relationship": «сестра» | «мама» | «друг» | null, "content": short fact in the user\'s language or null, "category": interest | dislike | favorite_food | gift | size | dream | important_date | personality | important_fact | other, "occurred_at": "YYYY-MM-DD" or "DD.MM" for a date else null, "date_kind": birthday | wedding | met | anniversary | other | null}. Example — «у сестры Оли день рождения 14 ноября, любит настолки»: [{"person_name":"Оля","relationship":"сестра","content":"День рождения 14 ноября","category":"important_date","occurred_at":"14.11","date_kind":"birthday"},{"person_name":"Оля","relationship":"сестра","content":"Любит настольные игры","category":"interest","occurred_at":null,"date_kind":null}]. Say «запомнила» about a person only when person_facts is non-empty in this reply. Use people_index and focused_people memories and dates (likes, birthdays, wedding, when you met, job, family)',
  "locations: optional cities/addresses on self and people; use them for products, services, places and logistics; prefer workspace.now.city and person locations; never invent addresses",
  "products/places/gifts: live listings; cite only workspace.discovery_results",
  "errands: when they capture a real-world errand, offer ONE specific chip Ilzi can execute — cash rates, nearby pharmacy/post/MFC/bank, marketplace search, afisha, train/flight tickets, a repair pro, live weather, florists, food delivery, Gosuslugi — never generic web search for that; cite only discovery_results, never invent rates, addresses, showtimes or fares",
  "web: internet search for facts, news, definitions — not for errands that have a specific live helper; cite only discovery_results",
  "venue booking: requests to find/rent a real place, room, table or service for an event (a poker room with a croupier, a banquet hall, a photo studio) have NO live search behind them yet — discovery_results will not have a real match. Never say «нашла», «подобрала» or list a specific venue you did not get from discovery_results, and never go silent or drop the request. Instead: say plainly you cannot search real venues yet, ask the 1-2 details still missing (budget, headcount, exact area) only if genuinely needed, and create/update the task with the date, time and requirements already given so nothing the person said is lost — move the conversation toward a next concrete step instead of a dead end",
  "reminders: dates in upcoming_dates within 14 days are a two-week heads-up — mention them and offer a relevant next step using gender, relationship, tastes and gift_history (never flowers for a man, especially from a man); a prep project is an offer only: create the empty project when asked, then discuss which tasks belong in it — do not invent a task list; offer to take research/search work yourself (assignee ealzy, bound to that project_id) and leave buying/booking to the person unless they ask; do not invent shops; task_actions with due_at only when asked to remind",
  "mail: workspace.mail has connected inboxes, important/meeting messages, drafts and playbooks; summarize important mail; draft replies with mail_actions.op=draft_reply; create dated tasks for meetings; never send until the user confirms — mail_actions.op=send only prepares a draft for confirmation",
  "overflow: if workspace.overflow.extra_tasks or extra_overdue is greater than 0, the visible task list is truncated — when the person asks about tasks, load, plan, agenda or priorities you MUST name those leftover counts instead of treating the listed tasks as the whole load; on unrelated topics do not bring tasks up at all",
  "reply: if workspace.replied_to is present, the person tapped Reply on that Telegram message — «это», «эту задачу», «добавь туда», «готово», a date, or a description edit refers to THAT message, not the latest agenda; attach writes to the matching workspace.tasks item named there",
  "settings: workspace.settings is the live app config — Telegram digest times, weekly reflection, quiet reengagement, timezone, locale, communication_style, bio and values. Change any of it in this turn with a settings patch (times as HH:MM 24h in workspace.settings.timezone). If they ask what is set, report workspace.settings. Never send them to the profile screen. You MAY claim a settings write only if settings is non-null. If telegram_linked is false, still save the times and say they need to open Ealzy from the Telegram bot",
] as const;

export function refersToFocusedPerson(text: string) {
  const haystack = ` ${text.toLocaleLowerCase().replace(/[^\p{L}-]+/gu, " ")} `;
  return / (?:ему|его|ней|ей|нему|он|она|этому|этой|этого) | для него | для неё | для нее | про него | про неё | про нее /iu.test(
    haystack,
  );
}

export function conversationTurns(
  messages: Message[],
  currentQuery: string,
  limit = 12,
  replyTo?: { role?: string; content?: string } | null,
) {
  const turns = messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );
  const last = turns.at(-1);
  const withoutCurrent =
    last?.role === "user" && last.content === currentQuery ? turns.slice(0, -1) : turns;
  const mapped = withoutCurrent.slice(-limit).map((message) => ({
    role: message.role as "user" | "assistant",
    content: message.content.slice(0, 1200),
  }));
  const quoted = replyTo?.content?.trim();
  if (!quoted) return mapped;
  const snippet = quoted.slice(0, 80);
  const already = mapped.some(
    (turn) => turn.content.includes(snippet) || quoted.includes(turn.content.slice(0, 80)),
  );
  if (already) return mapped;
  const role = replyTo?.role === "user" ? "user" : "assistant";
  return [{ role, content: `[replied-to]\n${quoted.slice(0, 1200)}` }, ...mapped].slice(0, limit);
}

export function peopleFromConversation<
  T extends Pick<Person, "id" | "name" | "aliases" | "is_self">,
>(people: T[], texts: string[]) {
  const mentioned: T[] = [];
  const seen = new Set<string>();
  for (const text of [...texts].reverse()) {
    for (const person of people) {
      if (seen.has(person.id) || !personMentionedIn(text, person)) continue;
      seen.add(person.id);
      mentioned.push(person);
    }
  }
  return mentioned;
}

export function selectFocusedPeople<T extends Pick<Person, "id" | "name" | "aliases" | "is_self">>(
  people: T[],
  query: string,
  messages: Pick<Message, "content">[],
) {
  const others = people.filter((person) => !person.is_self);
  const inQuery = others.filter((person) => personMentionedIn(query, person));
  const inHistory = peopleFromConversation(
    others,
    messages.map((message) => message.content),
  );
  if (inQuery.length) {
    const rest = inHistory.filter((person) => !inQuery.some((item) => item.id === person.id));
    return [...inQuery, ...rest].slice(0, 4);
  }
  return inHistory.slice(0, 4);
}

export function focusedSearchQuery(
  text: string,
  person: { name: string; memories?: Pick<Memory, "content" | "category">[] } | null | undefined,
) {
  if (!person) return text;
  const named = personMentionedIn(text, { name: person.name, aliases: [], is_self: false });
  const unnamedGift = /подарк/iu.test(text) && !named;
  if (!refersToFocusedPerson(text) && !unnamedGift) return text;
  const interests = (person.memories ?? [])
    .filter(
      (memory) =>
        memory.category === "interest" ||
        memory.category === "gift" ||
        memory.category === "preference",
    )
    .map((memory) => memory.content)
    .slice(0, 3)
    .join(" ");
  return `${text} ${person.name} ${interests}`.replace(/\s+/g, " ").trim();
}

function addCalendarDays(dateKey: string, days: number) {
  const next = new Date(`${dateKey}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

const DATE_ONLY_CLOCK = "12:00";

export type CompanionTaskWhen = "overdue" | "today" | "tomorrow" | "later" | "unscheduled";

export function packCompanionTaskDue(
  dueAt: string | null | undefined,
  timezone: string,
  today: string,
): { due_on: string | null; due_time: string | null; when: CompanionTaskWhen } {
  if (!dueAt) return { due_on: null, due_time: null, when: "unscheduled" };
  const instant = new Date(dueAt);
  if (Number.isNaN(instant.getTime())) return { due_on: null, due_time: null, when: "unscheduled" };
  const clock = companionClock(timezone, instant);
  const time = clock.time.replace(/^(\d{1,2}):(\d{2})$/, (_, hour: string, minute: string) => {
    return `${hour.padStart(2, "0")}:${minute}`;
  });
  const due_time = time === DATE_ONLY_CLOCK ? null : time;
  if (clock.date < today) return { due_on: clock.date, due_time, when: "overdue" };
  if (clock.date === today) return { due_on: clock.date, due_time, when: "today" };
  if (clock.date === addCalendarDays(today, 1))
    return { due_on: clock.date, due_time, when: "tomorrow" };
  return { due_on: clock.date, due_time, when: "later" };
}

export function agendaQueryDay(text: string): "today" | "tomorrow" | null {
  const t = text.trim();
  if (!t) return null;
  const listing =
    /(?:какие|какт[еe]|что\s+(?:за\s+)?|покажи(?:те)?|список|есть(?:\s+ли)?(?:\s+у\s+меня)?)\s+(?:у\s+меня\s+)?(?:открыт\S*\s+)?(?:дел(?:о|а|у)?|задач[аиуей]?|todos?|tasks?)|(?:дела|задачи|todos?|tasks?)\s+(?:есть(?:\s+на)?|на)\s+(?:сегодня|завтра|today|tomorrow)|(?:покажи(?:те)?|список)\s+(?:дел(?:о|а)|задач|todos?|tasks?|на\s+(?:сегодня|завтра))|что\s+(?:у\s+меня\s+)?на\s+(?:сегодня|завтра|today|tomorrow)|what(?:['’]?s|\s+are|\s+is)\s+(?:on\s+)?(?:my\s+)?(?:todo|task|agenda|plate)|(?:show(?:\s+me)?|do i have)\s+(?:any\s+)?(?:my\s+)?(?:todos?|tasks?)/iu.test(
      t,
    );
  if (!listing) return null;
  const forTomorrow = /завтра|tomorrow/iu.test(t);
  const forToday = /сегодня|today/iu.test(t);
  if (forToday && forTomorrow) return null;
  if (forTomorrow) return "tomorrow";
  if (forToday) return "today";
  return null;
}

export function companionClock(timezone: string, now = new Date()) {
  let zone = timezone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(now);
  } catch {
    zone = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  const daysToSunday = (7 - weekday) % 7;
  return {
    date,
    weekday: get("weekday"),
    time: `${get("hour")}:${get("minute")}`,
    end_of_this_week: addCalendarDays(date, daysToSunday),
    end_of_next_week: addCalendarDays(date, daysToSunday + 7),
  };
}

function compactMemories(memories: Memory[], limit = 8) {
  return memories.slice(0, limit).map((memory) => ({
    id: memory.id,
    category: memory.category,
    content: memory.content,
    occurred_at: memory.occurred_at,
  }));
}

function compactTaskDue(
  task: { due_at?: string | null; recurrence_frequency?: string | null },
  timezone: string,
  today: string,
) {
  return {
    ...packCompanionTaskDue(task.due_at, timezone, today),
    recurrence: task.recurrence_frequency ?? null,
  };
}

/** События календаря телефона в местном времени человека — для плана дня и свободных окон. */
export function compactCalendar(
  events: NonNullable<PersonalContext["calendar_events"]>,
  timezone: string,
) {
  return events.map((event) => {
    const start = companionClock(timezone, new Date(event.starts_at));
    const end = companionClock(timezone, new Date(event.ends_at));
    return {
      title: event.title,
      date: start.date,
      start: event.all_day ? null : start.time,
      end: event.all_day ? null : end.time,
      all_day: event.all_day,
      ...(event.location ? { location: event.location } : {}),
    };
  });
}

export function toCompanionWorkspace(context: PersonalContext) {
  const focused = context.relevant_people.length
    ? context.relevant_people
    : context.relevant_person
      ? [context.relevant_person]
      : [];
  const timezone = context.profile.timezone || "UTC";
  const today = companionClock(timezone).date;
  return {
    capabilities: [...COMPANION_CAPABILITIES],
    now: {
      timezone: context.profile.timezone,
      locale: context.profile.locale,
      city: context.city,
      ...companionClock(timezone),
    },
    settings: workspaceSettings(context.profile, context.telegram_linked),
    people_index: context.people_index,
    focused_people: focused.map((person: PersonProfile) => ({
      id: person.id,
      name: person.name,
      relationship: person.relationship,
      memories: compactMemories(person.memories),
      locations: compactLocations(person.locations),
      dates: compactDates(person.dates),
    })),
    tasks: context.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description?.slice(0, 160) || null,
      status: task.status,
      kind: task.kind ?? "task",
      importance: task.importance ?? 3,
      urgency: task.urgency ?? 3,
      push: isPushTask(task),
      ...compactTaskDue(task, timezone, today),
      estimate_minutes: task.estimate_minutes ?? null,
      goal_id: task.goal_id,
      project_id: task.project_id,
      assignee: task.assignee ?? "user",
    })),
    goals: context.goals.map((goal) => {
      const stats = goal.stats ?? withGoalStats(goal, context.tasks).stats;
      const history = (context.goal_history_tasks ?? []).filter((task) => task.goal_id === goal.id);
      const open = context.tasks.filter((task) => task.goal_id === goal.id);
      return {
        id: goal.id,
        title: goal.title,
        description: goal.description,
        horizon: goal.horizon,
        status: goal.status,
        target_date: goal.target_date,
        current_plan: goal.current_plan ?? null,
        plan_revised_at: goal.plan_revised_at ?? null,
        done_count: stats?.done_count ?? 0,
        task_count: stats?.task_count ?? 0,
        progress: stats?.progress ?? 0,
        days_active: stats?.days_active ?? 0,
        open_tasks: open.slice(0, 8).map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          ...compactTaskDue(task, timezone, today),
          assignee: task.assignee ?? "user",
        })),
        done_tasks: history.slice(0, 6).map((task) => ({ id: task.id, title: task.title })),
      };
    }),
    promises: context.promises.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      status: item.status,
      keeping_days: item.stats?.keeping_days ?? 0,
      last_checkin_status: item.stats?.last_checkin_status ?? null,
      due_for_checkin: item.stats?.due_for_checkin ?? false,
      praise_days: item.stats?.praise_days ?? null,
    })),
    projects: context.projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.description?.slice(0, 160) || null,
      status: project.status,
      goal_id: project.goal_id,
    })),
    spaces: context.spaces.map((space) => ({
      id: space.id,
      name: space.name,
      type: space.type,
    })),
    overflow: context.overflow ?? {
      extra_tasks: 0,
      extra_overdue: 0,
      extra_goals: 0,
      extra_projects: 0,
      extra_spaces: 0,
    },
    upcoming_dates: context.upcoming_dates,
    calendar: compactCalendar(context.calendar_events ?? [], timezone),
    mail: {
      accounts: context.mail_accounts.map((account) => ({
        id: account.id,
        email: account.email,
        provider: account.provider,
        status: account.status,
        last_synced_at: account.last_synced_at,
      })),
      important: context.mail_messages
        .filter((item) => item.is_important && !item.handled)
        .slice(0, 8)
        .map((item) => ({
          id: item.id,
          from: item.from_name || item.from_address,
          subject: item.subject,
          snippet: item.snippet.slice(0, 240),
          received_at: item.received_at,
          is_meeting: item.is_meeting,
          meeting_at: item.meeting_at,
        })),
      meetings: context.mail_messages
        .filter((item) => item.is_meeting && !item.handled)
        .slice(0, 5)
        .map((item) => ({
          id: item.id,
          subject: item.subject,
          from: item.from_name || item.from_address,
          meeting_at: item.meeting_at,
        })),
      drafts: context.mail_drafts
        .filter((item) => item.status !== "sent")
        .slice(0, 5)
        .map((item) => ({
          id: item.id,
          to: item.to_address,
          subject: item.subject,
          status: item.status,
        })),
      playbooks: context.mail_playbooks
        .filter((item) => item.enabled)
        .map((item) => ({
          id: item.id,
          name: item.name,
          trigger: item.trigger,
          actions: item.actions,
          prompt: item.prompt,
        })),
    },
    discovery_results: context.discovery_results,
    self: {
      bio: context.profile.bio,
      values: context.profile.values,
      communication_style: context.profile.communication_style,
      portrait: context.profile.context_summary,
      patterns: context.known_patterns ?? [],
      memories: compactMemories(context.self_memories, 12),
      locations: compactLocations(context.self_locations),
    },
  };
}
