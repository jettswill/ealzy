import { pushPreview, type PushGateway } from "../../infrastructure/apns.js";
import type { AppRepository } from "../../repository.js";
import { withGoalStats, withPromiseStats } from "../../direction.js";
import { pushTasks } from "./task-priority.js";
import type {
  Goal,
  Reflection,
  ScheduledNotificationKind,
  SelfPromise,
  SourceChannel,
  Task,
  UserProfile,
} from "../../types.js";
import type { TelegramGateway } from "../../infrastructure/telegram.js";
import type { AiProvider } from "./index.js";
import { PersonalContextBuilder, ReflectionService } from "./companion.js";
import { refreshPortrait } from "./personal-model.js";
import { upcomingDateDigestLines, upcomingImportantDates, type UpcomingDate } from "./discovery.js";
import { datePrepActionHint, datesNeedingPrep, whenPhrase } from "./date-prep.js";
import { createDayClosePending, createGoalCheckInPending, dayCloseMenuPrompt } from "./pending-actions.js";
import { pickGoalCheckIn, goalSyncDueOn, GOAL_SYNC_GAP_DAYS } from "./goal-plan.js";
import { BRAIN_DUMP_ACTION, startBrainDump } from "./first-session.js";
import { runReengagement } from "../engagement/reengagement.js";
import { trackFunnelEvent } from "../engagement/events.js";
import { runWithUsageOwner } from "../billing/usage.js";
import { formatCompanionAnswer } from "./companion-format.js";

export const NOTIFICATION_WINDOW_MINUTES = 90;
export const GOAL_CHECKIN_GAP_DAYS = GOAL_SYNC_GAP_DAYS;
export const DEFAULT_NOTIFICATION_TIMES = {
  morning_digest_time: "08:00",
  weekly_digest_time: "09:00",
  evening_sync_time: "21:00",
} as const;

const lastSentKey: Record<
  ScheduledNotificationKind,
  "last_morning_digest_on" | "last_weekly_digest_on" | "last_evening_sync_on"
> = {
  morning_digest: "last_morning_digest_on",
  weekly_digest: "last_weekly_digest_on",
  evening_sync: "last_evening_sync_on",
};

export interface ZonedParts {
  weekday: string;
  date: string;
  minutes: number;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(timeZone: string, at: Date): ZonedParts {
  const zone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

export function parseHm(value: string): number {
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function addCalendarDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function notificationDue(
  profile: UserProfile,
  kind: ScheduledNotificationKind,
  at: Date,
  windowMinutes = NOTIFICATION_WINDOW_MINUTES,
): boolean {
  const enabled =
    kind === "morning_digest"
      ? profile.morning_digest_enabled
      : kind === "weekly_digest"
        ? profile.weekly_digest_enabled
        : profile.evening_sync_enabled;
  if (!enabled) return false;
  const local = zonedParts(profile.timezone, at);
  if (kind === "weekly_digest" && local.weekday !== "Mon") return false;
  if (profile[lastSentKey[kind]] === local.date) return false;
  const scheduled = parseHm(
    kind === "morning_digest"
      ? profile.morning_digest_time
      : kind === "weekly_digest"
        ? profile.weekly_digest_time
        : profile.evening_sync_time,
  );
  return local.minutes >= scheduled && local.minutes < scheduled + windowMinutes;
}

export function goalCheckInDue(profile: UserProfile, at: Date, windowMinutes = NOTIFICATION_WINDOW_MINUTES) {
  const local = zonedParts(profile.timezone, at);
  if (!goalSyncDueOn(profile.last_goal_checkin_on, local.date)) return false;
  const inWindow = (time: string, mondayOnly = false) => {
    if (mondayOnly && local.weekday !== "Mon") return false;
    const scheduled = parseHm(time);
    return local.minutes >= scheduled && local.minutes < scheduled + windowMinutes;
  };
  return (
    inWindow(profile.morning_digest_time) ||
    inWindow(profile.weekly_digest_time, true) ||
    inWindow(profile.evening_sync_time)
  );
}

const openStatuses = new Set(["todo", "in_progress"]);
const isOpen = (task: Task) => openStatuses.has(task.status);
const dueDate = (task: Task, timeZone: string) =>
  task.due_at ? zonedParts(timeZone, new Date(task.due_at)).date : null;

export function tasksForDay(tasks: Task[], timeZone: string, date: string): Task[] {
  return tasks.filter((task) => isOpen(task) && dueDate(task, timeZone) === date);
}

export function overdueTasks(tasks: Task[], timeZone: string, date: string): Task[] {
  return tasks.filter((task) => {
    const due = dueDate(task, timeZone);
    return isOpen(task) && due !== null && due < date;
  });
}

export function tasksForWeek(tasks: Task[], timeZone: string, monday: string): Task[] {
  const sunday = addCalendarDays(monday, 6);
  return tasks.filter((task) => {
    const due = dueDate(task, timeZone);
    return isOpen(task) && due !== null && due >= monday && due <= sunday;
  });
}

export function undatedOpenTasks(tasks: Task[]): Task[] {
  return tasks.filter((task) => isOpen(task) && !task.due_at);
}

function localeOf(profile: UserProfile): "ru" | "en" {
  return profile.locale.toLowerCase().startsWith("en") ? "en" : "ru";
}

function bullet(tasks: Task[], ru: boolean): string {
  return tasks
    .map((task) => {
      const mark = task.assignee === "ealzy" ? (ru ? "[ИИ] " : "[AI] ") : "";
      return `• ${mark}${task.title}`;
    })
    .join("\n");
}

export function weeklyReflectionDue(
  profile: UserProfile,
  at: Date,
  windowMinutes = NOTIFICATION_WINDOW_MINUTES,
) {
  if (!profile.weekly_reflection_enabled) return false;
  const local = zonedParts(profile.timezone, at);
  if (local.weekday !== "Mon") return false;
  const scheduled = parseHm(profile.evening_sync_time);
  return local.minutes >= scheduled && local.minutes < scheduled + windowMinutes;
}

function activeGoalTitle(goals?: Goal[]) {
  return goals?.find((goal) => goal.status === "active")?.title?.trim() || null;
}

export function leftoverTodayTasks(tasks: Task[], timeZone: string, date: string): Task[] {
  return tasksForDay(tasks, timeZone, date).filter((task) => (task.assignee ?? "user") !== "ealzy");
}

function upcomingLines(dates: UpcomingDate[], ru: boolean): string[] {
  return upcomingDateDigestLines(dates, ru ? "ru" : "en");
}



function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const WEEKDAY_RU: Record<string, string> = {
  Mon: "Понедельник",
  Tue: "Вторник",
  Wed: "Среда",
  Thu: "Четверг",
  Fri: "Пятница",
  Sat: "Суббота",
  Sun: "Воскресенье",
};
const WEEKDAY_EN: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

function focusLabel(task: Task, ru: boolean) {
  const mark = task.assignee === "ealzy" ? (ru ? "[ИИ] " : "[AI] ") : "";
  return `${mark}**${task.title}**`;
}

/** Одна строка про ближайшую важную дату — вместо отдельного блока со списком. */
function personalMomentLine(dates: UpcomingDate[], ru: boolean): string | null {
  const soon = datesNeedingPrep(dates);
  const item = soon[0];
  if (!item) return null;
  const who = item.person ? `${item.person} — ` : "";
  const hint = datePrepActionHint(item, ru ? "ru" : "en");
  const when = whenPhrase(item.days_until, ru);
  const tail = hint ? ` — ${hint}` : "";
  return ru
    ? `Про близких: ${who}${item.label} (${when})${tail}`
    : `People: ${who}${item.label} (${when})${tail}`;
}

export function fallbackDigest(
  kind: ScheduledNotificationKind,
  profile: UserProfile,
  snapshot: {
    today: Task[];
    overdue: Task[];
    week: Task[];
    tomorrow: Task[];
    undated: Task[];
    leftover?: Task[];
    upcoming?: UpcomingDate[];
    goals?: Goal[];
    promises?: SelfPromise[];
    push?: Task[];
    mail?: { from: string; subject: string; is_meeting: boolean }[];
    weekday?: string;
  },
): string {
  const ru = localeOf(profile) === "ru";
  const goalLines = (snapshot.goals ?? [])
    .filter((goal) => goal.status === "active")
    .slice(0, 5)
    .map((goal) => {
      const stats = goal.stats;
      const progress = stats
        ? ru
          ? `${stats.done_count}/${stats.task_count} дел, ${stats.days_active} дн.`
          : `${stats.done_count}/${stats.task_count} tasks, ${stats.days_active}d`
        : goal.title;
      return `• ${goal.title} — ${progress}`;
    });
  const duePromises = (snapshot.promises ?? []).filter(
    (item) => item.status === "active" && item.stats?.due_for_checkin,
  );
  const streakPromises = (snapshot.promises ?? []).filter(
    (item) => item.status === "active" && (item.stats?.praise_days ?? 0) > 0,
  );
  if (kind === "morning_digest") {
    // Утро — единственный момент суток, когда день ещё можно распределить.
    // Раньше сюда сваливался весь список дел, и сообщение читалось как выгрузка
    // из Todoist: до личного слоя, ради которого продукт и существует,
    // дочитывали редко. Теперь жёсткий порядок и не больше восьми строк:
    // строка дня → одно главное дело → что разобрано за ночь → близкие → хвост.
    const lines: string[] = [];
    const weekday = snapshot.weekday
      ? (ru ? WEEKDAY_RU : WEEKDAY_EN)[snapshot.weekday]
      : undefined;
    const prefix = weekday ? `${weekday}. ` : "";
    const push = snapshot.push ?? [];
    let tail: Task[] = [];
    const focus = push[0] ?? snapshot.overdue[0] ?? snapshot.today[0] ?? null;

    if (focus) {
      const queue = [...push, ...snapshot.overdue, ...snapshot.today];
      const seen = new Set<string>([focus.id]);
      const rest = queue.filter((task) => !seen.has(task.id) && seen.add(task.id));
      const load = new Set(queue.map((task) => task.id)).size;
      const overdueTail =
        snapshot.overdue.length && ru
          ? `, ${snapshot.overdue.length} просрочено`
          : snapshot.overdue.length
            ? `, ${snapshot.overdue.length} overdue`
            : "";
      const mood = ru
        ? load <= 3
          ? "Утро спокойное"
          : "День плотный"
        : load <= 3
          ? "A calm morning"
          : "A full day";
      const count = ru
        ? `${load} ${plural(load, "дело", "дела", "дел")}`
        : `${load} task${load === 1 ? "" : "s"}`;
      lines.push(`${prefix}${mood}: ${count}${overdueTail}`);

      const isOverdue = snapshot.overdue.some((task) => task.id === focus.id);
      const label = `${focusLabel(focus, ru)}${isOverdue ? (ru ? " — просрочено" : " — overdue") : ""}`;
      lines.push(
        push.length
          ? ru
            ? `Не откладывать: ${label}`
            : `Do this first: ${label}`
          : ru
            ? `Главное сегодня: ${label}`
            : `Today's one thing: ${label}`,
      );

      tail = rest;
    } else {
      const goal = activeGoalTitle(snapshot.goals);
      lines.push(
        goal
          ? ru
            ? `${prefix}Цель «${goal}» — какой план на сегодня? Скинь 3 дела или напиши, что взять из открытых — поставлю даты.`
            : `${prefix}Goal “${goal}” — what's the plan for today? Dump 3 tasks or say which open one to date.`
          : ru
            ? `${prefix}На сегодня дат нет. Скинь 3 дела или напиши, что взять из открытых — поставлю даты.`
            : `${prefix}Nothing dated for today. Dump 3 tasks or say which open one to date.`,
      );
      if (snapshot.undated.length)
        lines.push(
          ru ? "Можно взять из открытых:" : "Open tasks you could start:",
          bullet(snapshot.undated.slice(0, 3), ru),
        );
    }

    // Почта уже собиралась в снапшот для утра, но никогда не рендерилась —
    // готовый «секретарский» слой лежал мёртвым грузом.
    const mail = snapshot.mail ?? [];
    if (mail.length) {
      lines.push(
        ru
          ? `За ночь: ${mail.length} ${plural(mail.length, "письмо", "письма", "писем")} по делу`
          : `Overnight: ${mail.length} message${mail.length === 1 ? "" : "s"} worth a look`,
      );
      for (const item of mail.filter((entry) => entry.is_meeting).slice(0, 2)) {
        lines.push(ru ? `• встреча — ${item.subject}` : `• meeting — ${item.subject}`);
      }
    }

    const personal = personalMomentLine(snapshot.upcoming ?? [], ru);
    if (personal) lines.push(personal);

    if (duePromises.length)
      lines.push(
        ru
          ? `Как у тебя с обещаниями: ${duePromises.map((item) => item.title).join(", ")}?`
          : `How are the promises going: ${duePromises.map((item) => item.title).join(", ")}?`,
      );
    else if (streakPromises.length)
      lines.push(
        ru
          ? `Красивая устойчивость: ${streakPromises.map((item) => item.title).join(", ")}.`
          : `Nice streak: ${streakPromises.map((item) => item.title).join(", ")}.`,
      );

    // Хвост — последним: сначала то, ради чего письмо открывают.
    if (tail.length && tail.length <= 2) {
      lines.push(ru ? "Ещё в фокусе:" : "Also in focus:", bullet(tail, ru));
    } else if (tail.length) {
      lines.push(
        ru
          ? `Ещё ${tail.length} ${plural(tail.length, "дело", "дела", "дел")} в работе →`
          : `${tail.length} more in progress →`,
      );
    }

    // Открытые без даты сверх трёх, прогресс целей и полный список дат из утра
    // убраны намеренно: их место в понедельничной сводке и в вечернем синке.
    // Утро отвечает на один вопрос — что сегодня нельзя уронить.
    return lines
      .filter(Boolean)
      .join("\n")
      .split("\n")
      .filter(Boolean)
      .slice(0, 8)
      .join("\n");
  }
  if (kind === "weekly_digest") {
    const lines = [
      ru ? "Понедельник. Краткая сводка дел на неделю." : "Monday. Here is a light weekly plan.",
    ];
    if (snapshot.week.length) lines.push(bullet(snapshot.week.slice(0, 16), ru));
    else {
      const goal = activeGoalTitle(snapshot.goals);
      if (goal) {
        lines.push(
          ru
            ? `Цель «${goal}» — какие 3 шага на эту неделю? Напиши, поставлю даты.`
            : `Goal “${goal}” — what 3 steps this week? Write them and I'll date them.`,
        );
      } else {
        lines.push(ru ? "На эту неделю дат пока нет." : "No dated tasks this week yet.");
      }
    }
    if (snapshot.undated.length)
      lines.push(
        ru ? "Без даты, но в работе:" : "Open, without a date:",
        bullet(snapshot.undated.slice(0, 6), ru),
      );
    if (goalLines.length) lines.push(ru ? "Цели:" : "Goals:", ...goalLines);
    if ((snapshot.push ?? []).length)
      lines.push(
        ru ? "Не откладывать:" : "Do these now:",
        bullet(snapshot.push!.slice(0, 6), ru),
      );
    if (duePromises.length)
      lines.push(
        ru ? "Как у тебя с обещаниями себе?" : "How are you doing with your promises to yourself?",
        ...duePromises.slice(0, 4).map((item) => `• ${item.title}`),
      );
    return lines.filter(Boolean).join("\n");
  }
  const leftover = snapshot.leftover ?? [];
  const lines = [
    ru
      ? "Вечерний синк. Давайте спокойно соберём день и посмотрим на завтра."
      : "Evening sync. Let's close the day gently and look at tomorrow.",
  ];
  if (leftover.length)
    lines.push(ru ? "Осталось сегодня:" : "Still open today:", bullet(leftover.slice(0, 8), ru));
  if ((snapshot.push ?? []).length)
    lines.push(
      ru ? "Не откладывать:" : "Do these now:",
      bullet(snapshot.push!.slice(0, 6), ru),
    );
  if (snapshot.tomorrow.length)
    lines.push(ru ? "На завтра:" : "Tomorrow:", bullet(snapshot.tomorrow.slice(0, 10), ru));
  else if (snapshot.undated.length) {
    lines.push(
      ru
        ? "На завтра дат нет. Поставь даты на 2–3 из открытых — или скинь список, поставлю на завтра."
        : "Nothing dated for tomorrow. Date 2–3 open tasks — or dump a list and I'll put them on tomorrow.",
    );
  } else {
    lines.push(
      ru
        ? "На завтра дат нет. Скинь 3 дела из головы — поставлю на завтра, утро будет непустым."
        : "Nothing dated for tomorrow. Dump 3 things on your mind — I'll date them tomorrow so morning isn't empty.",
    );
  }
  if (snapshot.undated.length)
    lines.push(ru ? "Ещё открыто:" : "Still open:", bullet(snapshot.undated.slice(0, 5), ru));
  if (goalLines.length) lines.push(ru ? "Как идут цели:" : "How the goals are going:", ...goalLines);
  if (streakPromises.length)
    lines.push(
      ru
        ? `Красивая устойчивость: ${streakPromises.map((item) => item.title).join(", ")}.`
        : `Nice streak: ${streakPromises.map((item) => item.title).join(", ")}.`,
    );
  if (duePromises.length)
    lines.push(
      ru
        ? `Как у тебя с обещаниями: ${duePromises.map((item) => item.title).join(", ")}?`
        : `How are you doing with these promises: ${duePromises.map((item) => item.title).join(", ")}?`,
    );
  lines.push(...upcomingLines(snapshot.upcoming ?? [], ru));
  const mail = (snapshot.mail ?? []).slice(0, 5);
  if (mail.length)
    lines.push(
      ru ? "Почта:" : "Mail:",
      ...mail.map(
        (item) =>
          `• ${item.is_meeting ? (ru ? "встреча" : "meeting") : ru ? "важно" : "important"} — ${item.subject || item.from}`,
      ),
    );
  lines.push(
    ru
      ? "Как вы сейчас, если честно? Что из сегодняшнего хочется оставить, а что — отпустить?"
      : "How are you, honestly? What from today do you want to keep, and what can you let go?",
  );
  return lines.filter(Boolean).join("\n");
}

export function formatWeeklyReflection(reflection: Reflection, locale?: string | null): string {
  const ru = locale?.toLowerCase().startsWith("en") ? false : true;
  const lines = [ru ? "Обзор недели." : "Week in review."];
  if (reflection.wins.length) {
    lines.push(ru ? "Что получилось:" : "What worked:", ...reflection.wins.map((item) => `• ${item}`));
  }
  if (reflection.improvements.length) {
    lines.push(
      ru ? "Что усилить:" : "What to improve:",
      ...reflection.improvements.map((item) => `• ${item}`),
    );
  }
  if (reflection.next_steps.length) {
    lines.push(ru ? "Дальше:" : "Next:", ...reflection.next_steps.map((item) => `• ${item}`));
  }
  lines.push(
    ru
      ? "Что из этого хочешь взять в эту неделю?"
      : "What from this do you want to take into this week?",
  );
  return lines.filter(Boolean).join("\n");
}

function reflectionCreatedOn(reflections: Reflection[], timeZone: string, date: string) {
  return reflections.some((item) => {
    const ended = zonedParts(timeZone, new Date(item.period_end)).date;
    const created = zonedParts(timeZone, new Date(item.created_at)).date;
    return ended === date || created === date;
  });
}


/**
 * Сборка данных дайджеста вынесена из отправки. Раньше снапшот существовал
 * только внутри доставки в Telegram, поэтому веб-пользователь не мог увидеть
 * сводку вообще никак: каждая ветка доставки начинается с проверки telegram_id.
 * Теперь те же данные доступны и для показа на экране.
 */
export async function buildDigestSnapshot(
  repository: AppRepository,
  profile: UserProfile,
  kind: ScheduledNotificationKind,
  at: Date,
) {
  const local = zonedParts(profile.timezone, at);
  const [tasks, rawGoals, rawPromises, checkins] = await Promise.all([
    repository.listTasks(profile.owner_id),
    repository.listGoals(profile.owner_id),
    repository.listPromises(profile.owner_id),
    repository.listPromiseCheckins(profile.owner_id),
  ]);
  const goals = rawGoals.map((goal) => withGoalStats(goal, tasks));
  const promises = rawPromises.map((item) => withPromiseStats(item, checkins));
  const people = await repository.listPeople(profile.owner_id);
  const experiences = await repository.listExperiences(profile.owner_id);
  const datedPeople = await Promise.all(
    people.map(async (person) => ({
      id: person.id,
      name: person.name,
      is_self: person.is_self,
      relationship: person.relationship,
      memories: await repository.listMemories(profile.owner_id, person.id),
      dates: person.dates ?? [],
    })),
  );
  const leftover = leftoverTodayTasks(tasks, profile.timezone, local.date);
  const upcoming = upcomingImportantDates(datedPeople, profile.timezone, at, 14, {
    experiences,
  });
  const selfTheses = (datedPeople.find((person) => person.is_self)?.memories ?? [])
    .filter((memory) => memory.status === "active")
    .sort((a, b) => b.importance - a.importance || b.created_at.localeCompare(a.created_at))
    .slice(0, 6)
    .map((memory) => memory.content);
  const mailMessages =
    kind === "evening_sync" || kind === "morning_digest"
      ? (await repository.listMailMessages(profile.owner_id, 20)).filter(
          (item) => !item.handled && (item.is_important || item.is_meeting),
        )
      : [];
  const snapshot = {
    // Строка дня в утреннем брифе начинается с дня недели — берём его из того
    // же локального времени, по которому считается сам день.
    weekday: local.weekday,
    today: tasksForDay(tasks, profile.timezone, local.date),
    overdue: overdueTasks(tasks, profile.timezone, local.date),
    week: tasksForWeek(tasks, profile.timezone, local.date),
    tomorrow: tasksForDay(tasks, profile.timezone, addCalendarDays(local.date, 1)),
    undated: undatedOpenTasks(tasks),
    leftover,
    upcoming,
    goals,
    promises,
    self: { values: profile.values, theses: selfTheses },
    push: pushTasks(tasks),
    mail: mailMessages.slice(0, 5).map((item) => ({
      from: item.from_name || item.from_address,
      subject: item.subject,
      is_meeting: item.is_meeting,
    })),
  };
  return { local, snapshot, leftover };
}

/**
 * Готовый текст сводки без отправки и без обращения к модели. Детерминированно
 * и бесплатно — это то, что можно показать на экране при каждом входе.
 */
export async function composeDigestText(
  repository: AppRepository,
  profile: UserProfile,
  kind: ScheduledNotificationKind,
  at: Date,
) {
  const { snapshot } = await buildDigestSnapshot(repository, profile, kind, at);
  return formatCompanionAnswer(fallbackDigest(kind, profile, snapshot));
}

export class ScheduledMessageService {
  private readonly contextBuilder: PersonalContextBuilder;
  private readonly reflections: ReflectionService;
  constructor(
    private readonly repository: AppRepository,
    private readonly telegram: TelegramGateway,
    private readonly ai?: AiProvider,
    private readonly push?: PushGateway,
  ) {
    this.contextBuilder = new PersonalContextBuilder(repository);
    this.reflections = new ReflectionService(repository, ai);
  }

  async run(
    at = new Date(),
  ): Promise<{ sent: Record<ScheduledNotificationKind, number>; reengagement: number }> {
    const sent: Record<ScheduledNotificationKind, number> = {
      morning_digest: 0,
      weekly_digest: 0,
      evening_sync: 0,
    };
    const profiles = await this.repository.listNotificationProfiles();
    // Сбой у одного человека (заблокировал бота, тестовый telegram_id, таймаут
    // Telegram) раньше обрывал весь проход: следующие по списку не получали ни
    // утренней сводки, ни вечернего разбора. Теперь каждый шаг изолирован.
    const guarded = async (ownerId: string, step: string, work: () => Promise<unknown>) => {
      try {
        return await work();
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "scheduled_step_failed",
            owner_id: ownerId,
            step,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return undefined;
      }
    };
    for (const profile of profiles) {
      await runWithUsageOwner(profile.owner_id, async () => {
        for (const kind of ["morning_digest", "weekly_digest", "evening_sync"] as const) {
          if (!notificationDue(profile, kind, at)) continue;
          if (await guarded(profile.owner_id, kind, () => this.deliver(profile, kind, at))) {
            sent[kind] += 1;
          }
        }
        await guarded(profile.owner_id, "weekly_reflection", () =>
          this.maybeWeeklyReflection(profile, at),
        );
        await guarded(profile.owner_id, "goal_check_in", () => this.maybeGoalCheckIn(profile, at));
      });
    }
    const reengagement = await guarded("all", "reengagement", () =>
      runReengagement(this.repository, this.telegram, at),
    );
    return {
      sent,
      reengagement: (reengagement as { sent: number } | undefined)?.sent ?? 0,
    };
  }

  private async maybeGoalCheckIn(profile: UserProfile, at: Date): Promise<boolean> {
    if (!goalCheckInDue(profile, at)) return false;
    const user = await this.repository.getUser(profile.owner_id);
    if (!user) return false;
    const local = zonedParts(profile.timezone, at);
    const [tasks, goals] = await Promise.all([
      this.repository.listTasks(profile.owner_id),
      this.repository.listGoals(profile.owner_id),
    ]);
    const goal = pickGoalCheckIn(goals, tasks, at);
    const ru = localeOf(profile) === "ru";
    const active = goals.filter((item) => item.status === "active");
    const text = (() => {
      if (!active.length) {
        return ru
          ? [
              "Целей пока нет — и это нормально.",
              "Если хочешь, разберём, чего ты на самом деле хочешь, и соберём первый план. Я не буду давить: это твой ход.",
            ].join("\n")
          : [
              "No goals yet — that's fine.",
              "If you want, we can unpack what you actually want and sketch a first plan. I won't push: it's your move.",
            ].join("\n");
      }
      const focus = goal ? withGoalStats(goal, tasks, at) : null;
      const stats = focus?.stats;
      const progress = stats?.task_count
        ? ru
          ? `${stats.done_count}/${stats.task_count} дел, ${stats.days_active} дн.`
          : `${stats.done_count}/${stats.task_count} tasks, ${stats.days_active}d`
        : ru
          ? "дел пока нет"
          : "no tasks yet";
      const hook = focus
        ? ru
          ? `Сейчас слабее всего движется «${focus.title}» (${progress}).`
          : `The weakest motion right now is "${focus.title}" (${progress}).`
        : "";
      return ru
        ? [
            "Раз в неделю полезно свериться: куда ты идёшь и как выглядит план.",
            hook,
            "Если хочешь — разберём мотивы, цели и ближайшие шаги. Я не буду давить: это твой ход.",
          ]
            .filter(Boolean)
            .join("\n")
        : [
            "Once a week it's useful to sync: where you're heading and how the plan looks.",
            hook,
            "If you want, we'll unpack motives, goals, and next steps. I won't push: it's your move.",
          ]
            .filter(Boolean)
            .join("\n");
    })();
    // The inline-keyboard pending action only makes sense wired to a Telegram
    // chat_id/callback. Web users still get the same check-in text in their
    // conversation history via persist() below — just without the buttons.
    if (user.telegram_id) {
      const { keyboard } = await createGoalCheckInPending(
        this.repository,
        profile.owner_id,
        user.telegram_id,
        goal?.id ?? null,
        profile.locale,
      );
      await this.telegram.sendMessage(user.telegram_id, text, {
        reply_markup: { inline_keyboard: keyboard },
      });
    }
    await this.persist(profile.owner_id, "goal_checkin", text);
    await this.repository.updateProfile(profile.owner_id, { last_goal_checkin_on: local.date });
    profile.last_goal_checkin_on = local.date;
    return true;
  }

  private async maybeWeeklyReflection(profile: UserProfile, at: Date): Promise<boolean> {
    if (!weeklyReflectionDue(profile, at)) return false;
    const user = await this.repository.getUser(profile.owner_id);
    if (!user) return false;
    const local = zonedParts(profile.timezone, at);
    const existing = await this.repository.listReflections(profile.owner_id);
    if (reflectionCreatedOn(existing, profile.timezone, local.date)) return false;
    let reflection: Reflection;
    try {
      reflection = await this.reflections.weekly(profile.owner_id, at);
    } catch {
      return false;
    }
    const text = formatWeeklyReflection(reflection, profile.locale);
    if (user.telegram_id) {
      await this.telegram.sendMessage(user.telegram_id, text);
      await trackFunnelEvent(this.repository, profile.owner_id, "weekly_reflection_sent", {
        channel: "telegram",
      });
    } else {
      await trackFunnelEvent(this.repository, profile.owner_id, "weekly_reflection_sent", {
        channel: "web",
      });
    }
    await this.persist(profile.owner_id, "weekly_reflection", text);
    return true;
  }

  private async deliver(
    profile: UserProfile,
    kind: ScheduledNotificationKind,
    at: Date,
  ): Promise<boolean> {
    const user = await this.repository.getUser(profile.owner_id);
    if (!user) return false;
    // Сводка теперь включена у всех, в том числе у гостей, которых сайт заводит
    // на каждый заход без сессии (и на роботов). Гостю без Telegram, который не
    // заходил неделю, сводку не собираем: её никто не увидит, а модель стоит денег.
    if (!user.telegram_id && user.is_guest) {
      const lastActive = Date.parse(profile.last_active_at ?? "");
      if (Number.isNaN(lastActive) || at.getTime() - lastActive > 7 * 24 * 3600_000) return false;
    }
    const { local, snapshot, leftover } = await buildDigestSnapshot(
      this.repository,
      profile,
      kind,
      at,
    );
    let text = fallbackDigest(kind, profile, snapshot);
    if (this.ai?.digest) {
      try {
        const generated = await this.ai.digest(kind, {
          locale: profile.locale,
          timezone: profile.timezone,
          communication_style: profile.communication_style,
          values: profile.values,
          ...snapshot,
        });
        if (generated && typeof generated === "object" && "text" in generated) {
          const candidate = String((generated as { text: unknown }).text).trim();
          if (candidate) text = candidate.slice(0, 3500);
        }
      } catch {
        // Keep the structured fallback when the model is unavailable.
      }
    }
    if (kind === "evening_sync" && profile.weekly_reflection_enabled && local.weekday === "Mon") {
      const existing = await this.repository.listReflections(profile.owner_id);
      if (!reflectionCreatedOn(existing, profile.timezone, local.date)) {
        try {
          const reflection = await this.reflections.weekly(profile.owner_id, at);
          text = `${text}\n\n${formatWeeklyReflection(reflection, profile.locale)}`.slice(0, 4000);
          await trackFunnelEvent(this.repository, profile.owner_id, "weekly_reflection_sent", {
            channel: "telegram",
            attached: "evening_sync",
          });
        } catch {
          // Evening still goes out without the weekly review.
        }
      }
    }
    text = formatCompanionAnswer(text);
    // Everything above (snapshot, AI digest text, weekly review) is channel-
    // agnostic. Only the Telegram-specific delivery — the actual bot message
    // and its day-close inline keyboard, which needs a chat_id for callbacks —
    // is gated on telegram_id. A web-only user still gets the same digest
    // waiting in their conversation via persist() below, so opening the app
    // is itself a proactive touchpoint instead of a blank chat.
    if (user.telegram_id) {
      const options: Record<string, unknown> = {};
      if (kind === "evening_sync" && leftover.length) {
        text = `${text}\n\n${dayCloseMenuPrompt(profile.locale)}`;
        const { keyboard } = await createDayClosePending(
          this.repository,
          profile.owner_id,
          user.telegram_id,
          leftover,
          local.date,
          profile.locale,
        );
        options.reply_markup = { inline_keyboard: keyboard };
      }
      await this.telegram.sendMessage(user.telegram_id, text, options);
      await trackFunnelEvent(this.repository, profile.owner_id, "digest_sent", {
        kind,
        channel: "telegram",
      });
    } else {
      await trackFunnelEvent(this.repository, profile.owner_id, "digest_sent", {
        kind,
        channel: "web",
      });
    }
    await this.persist(profile.owner_id, kind, text);
    if (this.push) {
      const en = profile.locale === "en";
      const title = {
        morning_digest: en ? "Plan for today" : "План на сегодня",
        evening_sync: en ? "Closing the day" : "Закрываем день",
        weekly_digest: en ? "Your week" : "Неделя",
      }[kind];
      // Push — дополнительный канал: его сбой не должен ломать сводку.
      await this.push
        .notifyOwner(profile.owner_id, { title, body: pushPreview(text), kind })
        .catch(() => 0);
    }
    await this.repository.updateProfile(profile.owner_id, {
      [lastSentKey[kind]]: local.date,
    });
    profile[lastSentKey[kind]] = local.date;
    if (kind === "evening_sync") {
      try {
        await refreshPortrait(this.repository, profile.owner_id, at);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "evening_portrait_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    if (
      kind === "evening_sync" &&
      leftover.length === 0 &&
      snapshot.tomorrow.length === 0 &&
      user.telegram_id &&
      !(profile.weekly_reflection_enabled && local.weekday === "Mon")
    ) {
      const pendingDump = await this.repository.findActivePendingAction(
        profile.owner_id,
        user.telegram_id,
        BRAIN_DUMP_ACTION,
      );
      if (!pendingDump) {
        await startBrainDump(this.repository, profile.owner_id, user.telegram_id, {
          due: "tomorrow",
        });
      }
    }
    if (
      kind === "morning_digest" &&
      snapshot.today.length === 0 &&
      snapshot.undated.length === 0 &&
      user.telegram_id
    ) {
      const pendingDump = await this.repository.findActivePendingAction(
        profile.owner_id,
        user.telegram_id,
        BRAIN_DUMP_ACTION,
      );
      if (!pendingDump) {
        await startBrainDump(this.repository, profile.owner_id, user.telegram_id, {
          due: "today",
        });
      }
    }
    return true;
  }

  private async persist(ownerId: string, kind: string, text: string) {
    try {
      const conversation = await this.repository.getPrimaryConversation(ownerId);
      await this.repository.createMessage(ownerId, {
        conversation_id: conversation.id,
        telegram_chat_id: null,
        telegram_message_id: null,
        role: "assistant",
        content: text,
        intent: "companion",
        source_channel: "system" as SourceChannel,
        metadata: { scheduled: kind },
      });
    } catch {
      // Delivery to Telegram already succeeded; history is best-effort.
    }
  }
}
