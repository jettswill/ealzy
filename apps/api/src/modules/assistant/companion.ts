import { z } from "zod";
import type { AppRepository } from "../../repository.js";
import { formatDate, languageOf } from "../../locale.js";
import { localMidday } from "../../time.js";
import type { Message, PersonalContext, Reflection, SourceChannel, Task } from "../../types.js";
import { withGoalStats, withPromiseStats } from "../../direction.js";
import type { AiProvider } from "./index.js";
import {
  attachSearchAnswer,
  cityForTimezone,
  collectUpcomingDates,
  defaultDiscoveryClient,
  discoverySearchOffer,
  formatSearchResults,
  inferBirthdayReminders,
  inferDiscoveryIntent,
  intentFromSearchAction,
  isExplicitDiscoveryRequest,
  mergeCapabilityOffers,
  OFFER_KINDS,
  type CapabilityOffer,
  type DiscoveryClient,
  type DiscoveryHit,
  type DiscoveryIntent,
} from "./discovery.js";
import {
  applyCompanionPersonFacts,
  CompanionPersonFactSchema,
  selfFactIsAboutSavedPerson,
  formatPersonSaveAnswer,
  inferCompanionPersonFacts,
  personMentionedIn,
} from "./people.js";
import {
  applyCompanionSelfFacts,
  CompanionSelfFactSchema,
  formatSelfSaveAnswer,
  inferCompanionSelfFacts,
  selectSelfTheses,
} from "./self-context.js";
import {
  composePortrait,
  inferBehaviorPatterns,
  inferCommunicationStyle,
  inferImplicitSelfFacts,
  mergeSelfFacts,
  refreshPortrait,
} from "./personal-model.js";
import { applyGoalActions, applyGoalPlan, continuedGoalWriteIntent, explicitGoalWriteIntent, focusedGoalFromConversation, focusedGoalFromText, goalCheckInIntent, goalDiscussIntent, goalRefineIntent, goalSyncDueOn, isGoalSyncTurn, titleNumbersConflict } from "./goal-plan.js";
import {
  applyCompanionMailActions,
  CompanionMailActionSchema,
  type MailConfirmKeyboard,
} from "../mail/companion-actions.js";
import {
  applyCompanionSettings,
  CompanionSettingsSchema,
  formatSettingsRecap,
  inferCompanionSettings,
  mergeSettings,
} from "./settings.js";
import {
  applyDatePrepProject,
  datePrepEalzyOffers,
  inferDatePrepProject,
  inferPersonGender,
} from "./date-prep.js";
import {
  conversationTurns,
  companionClock,
  focusedSearchQuery,
  refersToFocusedPerson,
  selectFocusedPeople,
  toCompanionWorkspace,
  rankByQuery,
  agendaQueryDay,
  packCompanionTaskDue,
} from "./companion-workspace.js";
import { cityFromLocations } from "./locations.js";
import { compactBirthday } from "./dates.js";
import { isPushTask } from "./task-priority.js";
import { formatCompanionAnswer } from "./companion-format.js";

export {
  companionClock,
  conversationTurns,
  focusedSearchQuery,
  refersToFocusedPerson,
  selectFocusedPeople,
  toCompanionWorkspace,
  agendaQueryDay,
  packCompanionTaskDue,
} from "./companion-workspace.js";
export { cityFromLocations, primaryLocation } from "./locations.js";

const emptyToNull = (value: unknown) => (value === "" || value === undefined ? null : value);
const emptyToArray = (value: unknown) => {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === "object") return [value];
  return [];
};
const clipContextTag = (value: unknown) =>
  typeof value === "string" ? value.trim().slice(0, 200) : value;
const MAX_NEW_TASKS = 8;
const MAX_CAPTURE_CHARS = 4000;

export const CompanionTaskActionSchema = z.object({
  op: z.enum(["create", "complete", "start", "update"]),
  task_id: z.preprocess(emptyToNull, z.string().uuid().nullable().catch(null)),
  title: z.preprocess(emptyToNull, z.string().trim().max(300).nullable()),
  description: z.preprocess(emptyToNull, z.string().trim().max(4000).nullable()).optional(),
  due_at: z.preprocess(emptyToNull, z.string().trim().max(40).nullable()),
  estimate_minutes: z.preprocess(
    emptyToNull,
    z.coerce.number().int().min(1).max(480).nullable().catch(null),
  ).optional(),
  goal_id: z
    .preprocess(emptyToNull, z.string().uuid().nullable().catch(null))
    .optional()
    .default(null),
  project_id: z
    .preprocess(emptyToNull, z.string().uuid().nullable().catch(null))
    .optional()
    .default(null),
  kind: z.enum(["task", "meeting"]).optional().default("task"),
  importance: z.number().int().min(1).max(5).optional().nullable(),
  urgency: z.number().int().min(1).max(5).optional().nullable(),
  assignee: z.enum(["user", "ealzy"]).optional().default("user"),
});
export const CompanionSearchActionSchema = z.object({
  type: z.enum(["products", "places", "gifts", "web", "fx"]),
  query: z
    .preprocess(emptyToNull, z.string().trim().max(200).nullable())
    .transform((value) => value ?? ""),
  city: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
  max_price: z.preprocess(
    emptyToNull,
    z.coerce.number().min(0).max(10_000_000).nullable().catch(null),
  ),
  min_price: z.preprocess(
    emptyToNull,
    z.coerce.number().min(0).max(10_000_000).nullable().catch(null),
  ),
  brand: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
  category: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
});
export const CompanionOfferSchema = z.object({
  kind: z.enum(OFFER_KINDS),
  title: z.string().trim().min(1).max(120),
  instruction: z.string().trim().min(1).max(800),
});
export const CompanionResponseSchema = z.object({
  answer: z.string().min(1).max(6000),
  context_used: z
    .preprocess(emptyToArray, z.array(z.preprocess(clipContextTag, z.string().max(200))).max(8))
    .default([])
    .catch([]),
  follow_up: z.string().max(500).nullable().optional().default(null),
  task_actions: z
    .preprocess((value) => {
      const arr = emptyToArray(value);
      if (!Array.isArray(arr)) return [];
      return arr.slice(0, MAX_NEW_TASKS).flatMap((item) => {
        const parsed = CompanionTaskActionSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
    }, z.array(CompanionTaskActionSchema).max(MAX_NEW_TASKS))
    .default([])
    .catch([]),
  offers: z.preprocess(emptyToArray, z.array(CompanionOfferSchema).max(3)).default([]).catch([]),
  search_actions: z
    .preprocess(emptyToArray, z.array(CompanionSearchActionSchema).max(2))
    .default([])
    .catch([]),
  person_facts: z
    .preprocess(emptyToArray, z.array(CompanionPersonFactSchema).max(8))
    .default([])
    .catch([]),
  self_facts: z
    .preprocess(emptyToArray, z.array(CompanionSelfFactSchema).max(6))
    .default([])
    .catch([]),
  goal_plan: z
    .preprocess(
      emptyToNull,
      z
        .object({
          goal_id: z.preprocess(emptyToNull, z.string().uuid().nullable().catch(null)),
          summary: z.preprocess(emptyToNull, z.string().trim().max(2000).nullable()),
          archive_task_ids: z
            .preprocess(emptyToArray, z.array(z.string().uuid()).max(12))
            .default([]),
        })
        .nullable(),
    )
    .optional()
    .default(null),
  mail_actions: z
    .preprocess(emptyToArray, z.array(CompanionMailActionSchema).max(5))
    .default([])
    .catch([]),
  goal_actions: z
    .preprocess(
      emptyToArray,
      z
        .array(
          z.object({
            op: z.enum(["create", "update"]),
            goal_id: z
              .preprocess(emptyToNull, z.string().uuid().nullable().catch(null))
              .optional()
              .default(null),
            title: z.preprocess(emptyToNull, z.string().trim().max(300).nullable()),
            description: z.preprocess(emptyToNull, z.string().trim().max(4000).nullable()),
            status: z
              .enum(["active", "paused", "completed", "cancelled"])
              .optional()
              .nullable(),
            horizon: z.enum(["short", "medium", "long"]).optional().nullable(),
            current_plan: z.preprocess(emptyToNull, z.string().trim().max(4000).nullable()),
            tasks: z
              .preprocess(
                emptyToArray,
                z
                  .array(
                    z.object({
                      title: z.string().trim().min(1).max(300),
                      due_at: z.preprocess(emptyToNull, z.string().trim().max(40).nullable()),
                      importance: z.number().int().min(1).max(5).optional().nullable(),
                      urgency: z.number().int().min(1).max(5).optional().nullable(),
                      assignee: z.enum(["user", "ealzy"]).optional().default("user"),
                    }),
                  )
                  .max(5),
              )
              .default([]),
          }),
        )
        .max(3),
    )
    .default([])
    .catch([]),
  settings: CompanionSettingsSchema,
});
export type CompanionTaskAction = z.infer<typeof CompanionTaskActionSchema>;
export type CompanionOffer = z.infer<typeof CompanionOfferSchema>;
export type CompanionResponse = z.infer<typeof CompanionResponseSchema> & {
  search_results: DiscoveryHit[];
};

export function parseCompanionResponse(raw: unknown) {
  const parsed = CompanionResponseSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const answer =
    raw && typeof raw === "object" && typeof (raw as { answer?: unknown }).answer === "string"
      ? (raw as { answer: string }).answer.trim()
      : "";
  if (answer) return CompanionResponseSchema.parse({ answer });
  throw parsed.error;
}
export type CompanionEntity = {
  type: "task" | "person" | "goal" | "mail" | "project";
  id: string;
  label: string;
  op?: "create" | "update" | "complete" | "start";
  due_at?: string | null;
};

export type CompanionReplyTo = {
  telegram_message_id?: number;
  role: "user" | "assistant" | "unknown";
  content: string;
  entity_labels?: string[];
};

export function readCompanionReplyTo(message: Pick<Message, "metadata">): CompanionReplyTo | null {
  const raw = message.metadata?.reply_to;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as {
    content?: unknown;
    role?: unknown;
    telegram_message_id?: unknown;
    entity_labels?: unknown;
  };
  const content = typeof row.content === "string" ? row.content.trim() : "";
  if (!content) return null;
  const labels = Array.isArray(row.entity_labels)
    ? row.entity_labels.map((item) => String(item).trim()).filter(Boolean)
    : [];
  return {
    telegram_message_id: Number(row.telegram_message_id) || undefined,
    role: row.role === "user" || row.role === "assistant" ? row.role : "unknown",
    content,
    ...(labels.length ? { entity_labels: labels } : {}),
  };
}

function replyFocusText(replyTo: CompanionReplyTo | null) {
  if (!replyTo) return "";
  return [replyTo.content, ...(replyTo.entity_labels ?? [])].filter(Boolean).join("\n");
}

const DUPLICATE_BURST_MS = 2 * 60 * 60 * 1000;
const TITLE_STOP = new Set([
  "для",
  "чтобы",
  "this",
  "that",
  "the",
  "and",
  "задача",
  "задачу",
  "задачи",
  "дело",
  "нужно",
  "надо",
  "ещё",
  "еще",
  "потом",
  "просто",
]);
const MONTH_NAMES =
  "январ\\w*|феврал\\w*|март\\w*|апрел\\w*|ма[йяею]|июн\\w*|июл\\w*|август\\w*|сентябр\\w*|октябр\\w*|ноябр\\w*|декабр\\w*|january|february|march|april|may|june|july|august|september|october|november|december";

const normalizeTitle = (value: string) => value.toLocaleLowerCase().trim();

export function dateKeyInZone(value: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function addCalendarDays(dateKey: string, days: number) {
  const next = new Date(`${dateKey}T12:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function endOfIsoWeek(dateKey: string, weeksAhead = 0) {
  const weekday = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
  const daysToSunday = (7 - weekday) % 7;
  return addCalendarDays(dateKey, daysToSunday + weeksAhead * 7);
}

function monthNumber(word: string) {
  const value = word.toLocaleLowerCase();
  if (/январ|^jan/.test(value)) return 1;
  if (/феврал|^feb/.test(value)) return 2;
  if (/март|^mar/.test(value)) return 3;
  if (/апрел|^apr/.test(value)) return 4;
  if (/^ма[йяею]$|^may$/.test(value)) return 5;
  if (/июн|^jun/.test(value)) return 6;
  if (/июл|^jul/.test(value)) return 7;
  if (/август|^aug/.test(value)) return 8;
  if (/сентябр|^sep/.test(value)) return 9;
  if (/октябр|^oct/.test(value)) return 10;
  if (/ноябр|^nov/.test(value)) return 11;
  if (/декабр|^dec/.test(value)) return 12;
  return null;
}

export function parseEstimateMinutes(blob: string): number | null {
  if (!blob.trim()) return null;
  if (/полтора\s*час/iu.test(blob)) return 90;
  if (/полчас|half[\s-]an[\s-]hour|half[\s-]hour/iu.test(blob)) return 30;
  const hoursAndMinutes = blob.match(
    /(\d+)\s*(?:час(?:а|ов)?|hours?|h)\s*(?:и\s*)?(\d+)\s*(?:мин(?:ут(?:ы|а)?)?|minutes?|min)/iu,
  );
  if (hoursAndMinutes?.[1] && hoursAndMinutes[2]) {
    return Number(hoursAndMinutes[1]) * 60 + Number(hoursAndMinutes[2]);
  }
  const hours = blob.match(/(\d+)\s*(?:час(?:а|ов)?|hours?)(?!\p{L})/iu);
  if (hours?.[1]) return Number(hours[1]) * 60;
  const minutes = blob.match(/(\d+)\s*(?:мин(?:ут(?:ы|а)?)?|minutes?|mins?)(?!\p{L})/iu);
  if (minutes?.[1]) {
    const value = Number(minutes[1]);
    if (value >= 1 && value <= 480) return value;
  }
  return null;
}

function parseRelativeDue(blob: string, todayKey: string) {
  if (!blob.trim()) return null;
  if (
    !/сегодня\s+(?:январ|феврал|март|апрел|ма[йяею]|июн|июл|август|сентябр|октябр|ноябр|декабр)/iu.test(
      blob,
    ) &&
    /сегодня|today|на сегодня/iu.test(blob)
  )
    return todayKey;
  if (/послезавтра|day after tomorrow/iu.test(blob)) return addCalendarDays(todayKey, 2);
  if (/завтра|tomorrow/iu.test(blob)) return addCalendarDays(todayKey, 1);
  if (/следующ\S*\s+недел|next week|конц\S*\s+следующ/iu.test(blob))
    return endOfIsoWeek(todayKey, 1);
  if (/(?:до\s+)?конц\S*\s+(?:этой\s+)?недел|this week|на этой неделе/iu.test(blob))
    return endOfIsoWeek(todayKey, 0);
  if (/через\s+недел|in a week/iu.test(blob)) return addCalendarDays(todayKey, 7);
  const dated = blob.match(new RegExp(`(\\d{1,2})\\s+(${MONTH_NAMES})`, "iu"));
  if (dated?.[1] && dated[2]) {
    const month = monthNumber(dated[2]);
    if (month) {
      const day = dated[1].padStart(2, "0");
      const monthKey = String(month).padStart(2, "0");
      const year = Number(todayKey.slice(0, 4));
      let key = `${year}-${monthKey}-${day}`;
      if (key < addCalendarDays(todayKey, -1)) key = `${year + 1}-${monthKey}-${day}`;
      return key;
    }
  }
  return null;
}

export function resolveCompanionDueAt(
  dueAt: string | null,
  timezone: string,
  userText: string,
  now = new Date(),
  recentUserTexts: string | string[] = "",
) {
  const todayKey = dateKeyInZone(now, timezone);
  const explicitTime =
    /(?:^|\s)(?:в|к|at)\s*\d{1,2}(?::\d{2})?(?:\s*(?:am|pm|утра|дня|вечера|ночи))?(?:\s|$|[.,!?])|(?:^|\s)на\s*\d{1,2}:\d{2}(?:\s|$|[.,!?])|полдень|полночь|noon|midnight/iu.test(
      userText,
    );
  if (explicitTime && dueAt) {
    const parsed = Date.parse(dueAt);
    if (!Number.isNaN(parsed)) {
      const key = dateKeyInZone(new Date(parsed), timezone);
      if (key >= addCalendarDays(todayKey, -1)) return new Date(parsed).toISOString();
    }
  }
  const recent = (Array.isArray(recentUserTexts) ? recentUserTexts : recentUserTexts.split("\n"))
    .map((item) => item.trim())
    .filter(Boolean);
  for (const text of [userText, ...recent]) {
    if (agendaQueryDay(text)) continue;
    const relative = parseRelativeDue(text, todayKey);
    if (relative) return localMidday(relative, timezone);
  }
  const fromDue = parseRelativeDue(dueAt ?? "", todayKey);
  if (fromDue) return localMidday(fromDue, timezone);

  if (dueAt && /^\d{4}-\d{2}-\d{2}$/.test(dueAt)) {
    if (dueAt < addCalendarDays(todayKey, -1)) return localMidday(todayKey, timezone);
    return localMidday(dueAt, timezone);
  }
  if (dueAt) {
    const parsed = Date.parse(dueAt);
    if (!Number.isNaN(parsed)) {
      const key = dateKeyInZone(new Date(parsed), timezone);
      if (key < addCalendarDays(todayKey, -1)) return localMidday(todayKey, timezone);
      return localMidday(key, timezone);
    }
  }
  return null;
}

function isBareStatusCheck(text: string) {
  return /^(?:сделал(?:а|и)?|сделано|готово|ок|хорошо|did you(?: do it)?|done|is it done)\s*\?*$/iu.test(
    text.trim(),
  );
}

function titleTokens(value: string) {
  return new Set(
    normalizeTitle(value)
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .split(/\s+/)
      .filter((token) => (token.length > 2 || /^\d+$/.test(token)) && !TITLE_STOP.has(token)),
  );
}

function tokensRelated(left: string, right: string) {
  if (left === right) return true;
  return (
    left.length >= 4 &&
    right.length >= 4 &&
    (left.startsWith(right.slice(0, 4)) || right.startsWith(left.slice(0, 4)))
  );
}

export function similarTaskTitles(left: string, right: string) {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (titleNumbersConflict(a, b)) return false;
  if (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a))) return true;
  const ta = titleTokens(left);
  const tb = titleTokens(right);
  if (ta.size < 2 || tb.size < 2) return false;
  let overlap = 0;
  for (const token of ta) {
    if ([...tb].some((other) => tokensRelated(token, other))) overlap += 1;
  }
  return overlap / Math.min(ta.size, tb.size) >= 0.7;
}

function isOpenTask(task: Task) {
  return task.status !== "done" && task.status !== "cancelled";
}

function similarOpenTasks(tasks: Task[], title: string, goalId?: string | null) {
  return tasks.filter((task) => {
    if (!isOpenTask(task) || !similarTaskTitles(task.title, title)) return false;
    if (goalId && task.goal_id && task.goal_id !== goalId) return false;
    return true;
  });
}

function pickKeptTask(matches: Task[]) {
  return [...matches].sort((a, b) => {
    if (Boolean(a.due_at) !== Boolean(b.due_at)) return a.due_at ? -1 : 1;
    return a.created_at.localeCompare(b.created_at);
  })[0]!;
}

const EXPLICIT_CAPTURE =
  /добав(?:ь|ьте)|постав(?:ь|ьте)|запиш(?:и|ите)|создай|перенес(?:и|ите)|add\b|create\b/iu;
const DESCRIPTION_EDIT_RE =
  /(?:добав(?:ь|ьте)|допис(?:ать|и)|запиш(?:и|ите)|впиши|дополн(?:и|ить)|пропиши|внес(?:и|ите)|обнов(?:и|ить)|поменя(?:й|йте)|исправ(?:ь|ьте)|вставь(?:те)?)\s+(?:это\s+)?(?:в\s+)?описани[еияю]?(?:\s+(?:этой\s+|текущей\s+|имеющейся\s+)?(?:задач[уиеа]|дел(?:а|о)))?|(?:^|[^\p{L}])в описани[еияю]\s+(?:этой\s+|текущей\s+|имеющейся\s+)?(?:задач|дел)|описани[ея]\s+(?:этой\s+|текущей\s+)?(?:задач[уиеа]|дел(?:а|о))|(?:добав(?:ь|ьте)|допис(?:ать|и))\s+(?:это\s+)?(?:к|в)\s+(?:этой\s+|текущей\s+)?(?:задач|дел)/iu;
const DESCRIPTION_TARGET_FRESH_MS = 6 * 60 * 60 * 1000;
const CAPTURE_PREFIX_RE =
  /(?:добавь(?:те)?|поставь(?:те)?|создай(?:те)?|запиши(?:те)?|add|create)\s+(?:мне\s+)?(?:ещ[её]\s+(?:одн[уо]\s+)?)?(?:задач[уиеа]|дел(?:о|а)|task|todo|встречу)?(?:\s+на\s+(?:сегодня|завтра|послезавтра|today|tomorrow|понедельник\S*|вторник\S*|сред\S*|четверг\S*|пятниц\S*|суббот\S*|воскресень\S*))?\s*[:.—\-–]?\s*/giu;
const NEED_PREFIX_RE =
  /^(?:слушай|короче|кстати|please|pls)?[,.]?\s*(?:надо(?:\s+бы)?|нужно(?:\s+бы)?|стоит|не\s+забудь|не\s+забыть)\s+/iu;
const ERRAND_VERB_SRC =
  "куп(?:ить|и)|позвон(?:ить|и)|записа(?:ться|ть)|отправ(?:ить|ь)|оплат(?:ить|и)|забр(?:ать|и)|напис(?:ать|и)|провер(?:ить|ь)|сход(?:ить|и)|заказ(?:ать|и)|отнес(?:ти|и)|заполн(?:ить|и)|подпис(?:ать|и)|скин(?:уть|ь)|перевод(?:ить|и)|сня(?:ть)|поменя(?:ть|й)|вызов(?:ать|и)|заеха(?:ть|й)|подготов(?:ить|ь)|согласов(?:ать)|закры(?:ть)|допис(?:ать|и)|сда(?:ть)|сдела(?:ть)|встрет(?:иться|ить)|заброн(?:ировать|ируй)|продл(?:ить|и)|почин(?:ить|и)|оформи(?:ть)|распечата(?:ть)|покорм(?:ить)|постир(?:ать)|убр(?:ать)|выкин(?:уть)|buy|call|send|pay|book|write|check|meet|pick(?:\\s+up)?";
const ERRAND_VERB_RE = new RegExp(`(?<=^|[^\\p{L}])(?:${ERRAND_VERB_SRC})`, "giu");
const WEAK_OBJECT = /^(?:это|то|так|его|её|ее|их|them|it|that|всё|все)$/iu;
const TIME_FILLER =
  /сегодня|завтра|послезавтра|today|tomorrow|конц\S*|следующ\S*|недел\S*|понедельник\S*|вторник\S*|сред\S*|четверг\S*|пятниц\S*|суббот\S*|воскресень\S*/iu;

export function isDescriptionEditIntent(text: string) {
  DESCRIPTION_EDIT_RE.lastIndex = 0;
  return DESCRIPTION_EDIT_RE.test(text);
}

function hasTaskCaptureIntent(text: string) {
  if (isDescriptionEditIntent(text)) return true;
  if (EXPLICIT_CAPTURE.test(text)) return true;
  const trimmed = text.trim();
  ERRAND_VERB_RE.lastIndex = 0;
  const hasVerb = ERRAND_VERB_RE.test(trimmed);
  if (/(?:надо|нужно|надо бы|нужно бы)/iu.test(trimmed) && hasVerb) return true;
  if (!hasVerb || trimmed.length > 140 || trimmed.includes("?")) return false;
  ERRAND_VERB_RE.lastIndex = 0;
  const at = trimmed.search(ERRAND_VERB_RE);
  return at >= 0 && at < 24;
}

function cleanCaptureTitle(value: string) {
  CAPTURE_PREFIX_RE.lastIndex = 0;
  return value
    .replace(CAPTURE_PREFIX_RE, "")
    .replace(NEED_PREFIX_RE, "")
    .replace(/\s+(?:потому что|т\.к\.|так как|because)\b.*$/iu, "")
    .replace(/[,\s]+(?:и|потом|ещё|еще|также|and then|and)\s*$/iu, "")
    .replace(/^[•\-–—]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/[,;:.\s!?]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function precededByPast(text: string, index: number) {
  const before = text.slice(Math.max(0, index - 48), index);
  return /(?:не\s+успел(?:а|и)?|уже\s+(?:сделал|купил|заехал|отправил)|вчера)\s+$/iu.test(before);
}

function titleHasObject(title: string) {
  const tokens = title
    .replace(new RegExp(ERRAND_VERB_SRC, "giu"), " ")
    .replace(TIME_FILLER, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !TITLE_STOP.has(token.toLocaleLowerCase()));
  return tokens.some((token) => !WEAK_OBJECT.test(token));
}

function looksLikeCapturedAction(title: string, explicitCapture: boolean) {
  if (title.length < 3 || title.length > 120 || title.includes("?")) return false;
  ERRAND_VERB_RE.lastIndex = 0;
  const hasVerb = ERRAND_VERB_RE.test(title);
  if (!hasVerb && !explicitCapture) return false;
  if (!titleHasObject(title)) return false;
  return true;
}

function splitListItems(text: string) {
  const lined = text
    .split(/\n+/)
    .map((line) => cleanCaptureTitle(line))
    .filter((line) => line.length >= 3);
  if (lined.length >= 2) return lined;
  const numbered = text
    .split(/(?:^|\s)(?:\d+[.)]|[•●])\s+/u)
    .map((item) => cleanCaptureTitle(item))
    .filter((item) => item.length >= 3);
  return numbered.length >= 2 ? numbered : [];
}

function extractErrandTitles(text: string, explicitCapture: boolean) {
  const titles: string[] = [];
  ERRAND_VERB_RE.lastIndex = 0;
  const matches = [...text.matchAll(ERRAND_VERB_RE)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const start = match.index ?? 0;
    if (precededByPast(text, start)) continue;
    const end = matches[index + 1]?.index ?? text.length;
    const title = cleanCaptureTitle(text.slice(start, end));
    if (!looksLikeCapturedAction(title, explicitCapture)) continue;
    if (titles.some((existing) => similarTaskTitles(existing, title))) continue;
    titles.push(title);
  }
  return titles;
}

function dueHint(chunk: string, whole: string) {
  if (/сегодня|today/iu.test(chunk)) return "today";
  if (/завтра|tomorrow/iu.test(chunk)) return "tomorrow";
  if (/сегодня|today/iu.test(whole)) return "today";
  if (/завтра|tomorrow/iu.test(whole)) return "tomorrow";
  return null;
}

function captureAction(title: string, text: string, chunk = title): CompanionTaskAction {
  const pretty = title.charAt(0).toLocaleUpperCase() + title.slice(1);
  return {
    op: "create",
    task_id: null,
    title: pretty,
    due_at: dueHint(chunk, text),
    estimate_minutes: parseEstimateMinutes(chunk) ?? parseEstimateMinutes(text),
    goal_id: null,
    project_id: null,
    kind: /встреч|meeting/iu.test(chunk) || /встреч|meeting/iu.test(text) ? "meeting" : "task",
    importance: null,
    urgency: null,
    assignee: "user",
  };
}

function completeAction(title: string): CompanionTaskAction {
  return {
    op: "complete",
    task_id: null,
    title,
    due_at: null,
    estimate_minutes: null,
    goal_id: null,
    project_id: null,
    kind: "task",
    importance: null,
    urgency: null,
    assignee: "user",
  };
}

const BARE_COMPLETE_RE =
  /^(?:готово|сделал[аи]?|выполнил[аи]?|сделано|отметь(?:те)?(?:\s+как)?\s+выполненн?[оыуюяе]?|complete|done|finish)\s*[.!]?$/iu;
const DUE_ONLY_RE =
  /^(?:перенес(?:и|ите)\s+)?(?:это\s+)?(?:на\s+)?(сегодня|завтра|послезавтра|today|tomorrow)\s*$/iu;

export function titleFromQuotedMessage(quoted: string) {
  const named = quoted.match(/[«"]([^»"]{3,120})[»"]/);
  if (named?.[1]) return named[1].trim();
  const recap = quoted.match(/(?:Дела|Tasks):\s*([^\n]+)/iu);
  if (recap?.[1]) {
    const first = recap[1]
      .split(/[;.]/)[0]
      ?.replace(/\s*\(.*\)\s*$/u, "")
      .trim();
    if (first && first.length >= 3) return first;
  }
  const heading = quoted.match(/\*\*([^*]{3,90})\*\*/);
  if (heading?.[1]) return heading[1].trim();
  return null;
}

export function inferCompanionTaskActions(
  text: string,
  context: { quoted?: string | null } = {},
): CompanionTaskAction[] {
  const trimmed = text.trim().slice(0, MAX_CAPTURE_CHARS);
  const quoted = context.quoted?.trim() || "";
  if (trimmed.length < 1) return [];
  if (BARE_COMPLETE_RE.test(trimmed) && quoted) {
    const title = titleFromQuotedMessage(quoted);
    if (title) return [completeAction(title)];
  }
  if (isBareStatusCheck(trimmed)) return [];
  if (trimmed.length < 3) return [];
  const complete = trimmed.match(
    /^(?:готово|сделал[аи]?|выполнил[аи]?|отметь(?:те)?(?:\s+как)?\s+выполненн?[оыуюяе]?|complete|done|finish)\s*[:—\-–]?\s*(.+)$/iu,
  );
  if (complete?.[1]?.trim()) {
    return [completeAction(complete[1].trim())];
  }
  if (quoted && DUE_ONLY_RE.test(trimmed)) {
    const title = titleFromQuotedMessage(quoted);
    if (title) {
      return [
        {
          ...captureAction(title, trimmed),
          op: "update",
          due_at: dueHint(trimmed, trimmed),
        },
      ];
    }
  }
  if (isDescriptionEditIntent(trimmed)) return [];
  const explicit = EXPLICIT_CAPTURE.test(trimmed);
  CAPTURE_PREFIX_RE.lastIndex = 0;
  const stripped = trimmed.replace(CAPTURE_PREFIX_RE, " ").replace(/\s+/g, " ").trim();
  const fromVerbs = extractErrandTitles(stripped || trimmed, explicit);
  if (fromVerbs.length) return fromVerbs.slice(0, MAX_NEW_TASKS).map((title) => captureAction(title, trimmed));
  const listed = splitListItems(stripped || trimmed).filter((item) =>
    looksLikeCapturedAction(item, explicit),
  );
  if (listed.length >= 2) {
    return listed.slice(0, MAX_NEW_TASKS).map((title) => captureAction(title, trimmed, title));
  }
  if (explicit) {
    const remainder = cleanCaptureTitle(trimmed);
    if (remainder.length >= 3 && remainder.length <= 300) {
      return [captureAction(remainder, trimmed)];
    }
  }
  return [];
}

function sameCaptureTitle(left: string, right: string) {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const ta = titleTokens(left);
  const tb = titleTokens(right);
  if (ta.size < 2 || tb.size < 2) return false;
  let overlap = 0;
  for (const token of ta) {
    if ([...tb].some((other) => tokensRelated(token, other))) overlap += 1;
  }
  return overlap / Math.min(ta.size, tb.size) >= 0.85 && Math.abs(ta.size - tb.size) <= 1;
}

export function mergeCompanionTaskActions(
  modelActions: CompanionTaskAction[],
  inferred: CompanionTaskAction[],
): CompanionTaskAction[] {
  const modelCreates = modelActions.filter((item) => item.op === "create" && item.title?.trim());
  const inferredCreates = inferred.filter((item) => item.op === "create" && item.title?.trim());
  const megaTitle = normalizeTitle(modelCreates[0]?.title ?? "");
  const splitBeatsMega =
    modelCreates.length === 1 &&
    inferredCreates.length >= 2 &&
    inferredCreates.filter((item) => megaTitle.includes(normalizeTitle(item.title ?? ""))).length >=
      2;
  const primary = splitBeatsMega
    ? [...modelActions.filter((item) => item.op !== "create"), ...inferredCreates]
    : modelActions;
  const extra = splitBeatsMega ? inferred.filter((item) => item.op !== "create") : inferred;
  const out: CompanionTaskAction[] = [];
  for (const action of [...primary, ...extra]) {
    if (action.op === "create" && !action.title?.trim()) continue;
    const duplicate = out.some(
      (existing) =>
        existing.op === action.op &&
        ((existing.task_id && action.task_id && existing.task_id === action.task_id) ||
          (existing.title && action.title && sameCaptureTitle(existing.title, action.title))),
    );
    if (duplicate) continue;
    out.push(action);
    if (out.length >= MAX_NEW_TASKS) break;
  }
  return out;
}

type DescriptionTaskRef = Pick<Task, "id" | "title" | "status" | "created_at">;

function looksLikeDescriptionInstruction(title: string) {
  const value = title.trim();
  return (
    /^(?:в\s+)?описани/iu.test(value) ||
    /описани[еияю]\s+(?:задач|дел)/iu.test(value) ||
    /(?:добав|допис).{0,24}описан/iu.test(value)
  );
}

function extractUserSuppliedDescription(text: string) {
  DESCRIPTION_EDIT_RE.lastIndex = 0;
  CAPTURE_PREFIX_RE.lastIndex = 0;
  const stripped = text
    .replace(DESCRIPTION_EDIT_RE, " ")
    .replace(CAPTURE_PREFIX_RE, " ")
    .replace(/^(?:задач[уиеа]|дел(?:о|а))\s+/iu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length < 8) return null;
  if (looksLikeDescriptionInstruction(stripped)) return null;
  if (
    /^(?:необходим|нужн(?:ые|о)|список|какие|какой|составь|собери|подбери)/iu.test(stripped) &&
    !/[•\n]/.test(text) &&
    !/:\s+\S/u.test(text)
  ) {
    return null;
  }
  return stripped.slice(0, 4000);
}

export function extractDescriptionFromAnswer(answer: string) {
  const blocks = answer.split(/\n\s*\n/);
  let best: string[] = [];
  for (const block of [answer, ...blocks]) {
    const items = block.split(/\n/).flatMap((line) => {
      const match = line.trim().match(/^(?:[-•*—–]+|\d+[.)])\s+(.+)/);
      const item = match?.[1]?.trim() ?? "";
      if (!item || item.length > 180) return [];
      if (/\s+[—–-]\s+(?:сегодня|завтра|срок|today|tomorrow)/iu.test(item)) return [];
      return [item.replace(/^[—–-]\s*/, "")];
    });
    if (items.length > best.length) best = items;
  }
  if (best.length < 2) return null;
  return best.map((item) => `• ${item}`).join("\n");
}

export function resolveDescriptionTarget(
  text: string,
  tasks: DescriptionTaskRef[],
  quoted = "",
) {
  const open = tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  if (!open.length) return null;
  const named = titleFromQuotedMessage(quoted);
  if (named) {
    const byName = open.find(
      (task) => similarTaskTitles(task.title, named) || normalizeTitle(named).includes(normalizeTitle(task.title)),
    );
    if (byName) return byName;
  }
  const hay = normalizeTitle(`${text}\n${quoted}`);
  const mentioned = open.filter((task) => {
    const title = normalizeTitle(task.title);
    return title.length >= 5 && hay.includes(title);
  });
  if (mentioned.length === 1) return mentioned[0]!;
  if (mentioned.length > 1) {
    return [...mentioned].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]!;
  }
  const newest = [...open].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]!;
  const age = Date.now() - Date.parse(newest.created_at);
  if (Number.isFinite(age) && age >= 0 && age < DESCRIPTION_TARGET_FRESH_MS) return newest;
  if (open.length === 1) return open[0]!;
  return null;
}

function descriptionUpdateAction(
  task: DescriptionTaskRef,
  description: string | null,
): CompanionTaskAction {
  return {
    op: "update",
    task_id: task.id,
    title: task.title,
    due_at: null,
    estimate_minutes: null,
    goal_id: null,
    project_id: null,
    kind: "task",
    importance: null,
    urgency: null,
    assignee: "user",
    description,
  };
}

export function normalizeDescriptionEdits(
  actions: CompanionTaskAction[],
  text: string,
  tasks: DescriptionTaskRef[],
  answer = "",
  quoted = "",
): CompanionTaskAction[] {
  if (!isDescriptionEditIntent(text)) return actions;
  const target = resolveDescriptionTarget(text, tasks, quoted);
  const fromModel = actions.map((item) => item.description?.trim()).find((item) => item);
  const fromAnswer = extractDescriptionFromAnswer(answer);
  const fromUser = extractUserSuppliedDescription(text);
  const description = fromModel || fromAnswer || fromUser || null;
  const remainder = cleanCaptureTitle(text);
  const filtered = actions.filter((action) => {
    if (action.op !== "create") return true;
    if (looksLikeDescriptionInstruction(action.title ?? "")) return false;
    if (target && similarTaskTitles(action.title ?? "", target.title)) return false;
    if (remainder && action.title && sameCaptureTitle(action.title, remainder)) return false;
    if (remainder && action.title && normalizeTitle(action.title) === normalizeTitle(remainder)) {
      return false;
    }
    return true;
  });
  if (!target) return filtered;
  const existingIdx = filtered.findIndex(
    (action) =>
      (action.op === "update" || action.op === "create") &&
      ((action.task_id && action.task_id === target.id) ||
        similarTaskTitles(action.title ?? "", target.title)),
  );
  if (existingIdx >= 0) {
    const current = filtered[existingIdx]!;
    const next = [...filtered];
    next[existingIdx] = {
      ...current,
      op: "update",
      task_id: target.id,
      title:
        current.title?.trim() && !looksLikeDescriptionInstruction(current.title)
          ? current.title
          : target.title,
      description: current.description?.trim() || description,
    };
    return next;
  }
  if (!description) return filtered;
  return [descriptionUpdateAction(target, description), ...filtered];
}

// «Приняла… это сохраню для подбора подарков» — а в базе ничего.
// Текст ответа генерируется отдельно от записи, поэтому обещание запомнить
// доезжает до человека даже тогда, когда запись не удалась или разбор не нашёл,
// к кому привязать факт. Здесь ответ приводится к тому, что действительно
// произошло: обещание не стирается молча, а превращается в честный вопрос.
// \b не используем: в JS это граница ASCII-слова, кириллицу она не видит.
const MEMORY_CLAIM_RU =
  /(?:^|[\s,.:;!?«"(—-])(?:запомн|сохран|приняла|принял\b|держу в голове|не забуду|буду помнить|учту на будущее)/iu;
const MEMORY_CLAIM_EN =
  /(?:^|[\s,.:;!?"(-])(?:i'?ll remember|i have remembered|remembered|noted that|saved that|keeping that in mind)/iu;

export function groundMemoryClaimAnswer(
  answer: string,
  options: { locale?: string | null; savedMemory: boolean },
) {
  if (options.savedMemory) return answer;
  const ru = languageOf(options.locale) !== "en";
  const claim = ru ? MEMORY_CLAIM_RU : MEMORY_CLAIM_EN;
  if (!claim.test(answer)) return answer;
  const honest = ru
    ? "Только я это пока не сохранила: не поняла, к кому привязать факт. Скажи, о ком речь — «про маму», «это Аня» — и запишу."
    : "One thing though: I haven't saved it yet — I couldn't tell who it's about. Tell me who (\"about my mum\", \"that's Anya\") and I'll write it down.";
  if (answer.includes(honest)) return answer;
  return `${answer.trim()}\n\n${honest}`;
}

export function groundDescriptionEditAnswer(
  answer: string,
  entities: CompanionEntity[],
  userText: string,
  locale?: string | null,
) {
  if (!isDescriptionEditIntent(userText)) return answer;
  const updated = entities.some((entity) => entity.type === "task" && entity.op === "update");
  if (updated) return answer;
  const ru = languageOf(locale) !== "en";
  const question = ru
    ? "В какую задачу дописать это в описание? Назови её — и я сразу внесу."
    : "Which task should I add that to? Name it and I’ll write it in.";
  if (/добав|обнов|запис|допис|описан|updated the description|added .*notes/iu.test(answer)) {
    return question;
  }
  if (!answer.includes("?") && answer.trim().length < 400) {
    return `${answer.trim()}\n\n${question}`;
  }
  return answer;
}

function mergeTaskDescription(existing: string | null, incoming: string, userText: string) {
  const next = incoming.trim();
  if (!next) return existing;
  const prev = existing?.trim() || "";
  if (!prev) return next;
  if (prev.includes(next)) return prev;
  if (next.includes(prev) && next.length >= prev.length) return next;
  if (isDescriptionEditIntent(userText) && /добав|допис|дополн|впиши|внес/iu.test(userText)) {
    return `${prev}\n\n${next}`;
  }
  return next;
}

function findTask(tasks: Task[], action: CompanionTaskAction) {
  if (action.task_id) {
    const byId = tasks.find((task) => task.id === action.task_id);
    if (byId) return byId;
  }
  const title = action.title?.trim();
  if (!title) return null;
  const matches = similarOpenTasks(tasks, title, action.goal_id);
  return matches.length ? pickKeptTask(matches) : null;
}

async function cancelBurstDuplicates(
  repository: AppRepository,
  ownerId: string,
  matches: Task[],
  kept: Task,
) {
  for (const extra of matches) {
    if (extra.id === kept.id || extra.status !== "todo") continue;
    if (Math.abs(Date.parse(extra.created_at) - Date.parse(kept.created_at)) > DUPLICATE_BURST_MS)
      continue;
    const cancelled = await repository.updateTask(ownerId, extra.id, { status: "cancelled" });
    if (cancelled) Object.assign(extra, cancelled);
  }
}

function taskEntity(task: Task, op: NonNullable<CompanionEntity["op"]>): CompanionEntity {
  return { type: "task", id: task.id, label: task.title, op, due_at: task.due_at };
}

export function omitEalzyQueueMutations<
  T extends { op: string; task_id?: string | null; title?: string | null },
>(
  actions: T[],
  tasks: { id?: string; title?: string; assignee?: string | null }[],
): T[] {
  const blocked = tasks.filter((task) => (task.assignee ?? "user") === "ealzy");
  if (!blocked.length) return actions;
  const personOwned = tasks.filter((task) => (task.assignee ?? "user") !== "ealzy");
  const sameWork = (
    action: T,
    task: { id?: string; title?: string },
  ) => {
    if (action.task_id && task.id && action.task_id === task.id) return true;
    const left = action.title?.trim().toLocaleLowerCase();
    const right = task.title?.trim().toLocaleLowerCase();
    if (!left || !right) return false;
    return left === right || left.includes(right) || right.includes(left);
  };
  return actions.filter((action) => {
    if (blocked.some((task) => sameWork(action, task))) return false;
    if (action.op !== "complete" && action.op !== "start") return true;
    return personOwned.some((task) => sameWork(action, task));
  });
}

const CAPTURE_INTENT =
  /добав(?:ь|ьте)|постав(?:ь|ьте)|запиш(?:и|ите)|создай|перенес(?:и|ите)|купи\b|надо\s+|нужно\s+|напомн|add\b|create\b/iu;

export function omitUnsolicitedPromiseCaptures<T extends { op: string }>(
  actions: T[],
  userText: string,
  promises: {
    last_checkin_status?: string | null;
    stats?: { last_checkin_status?: string | null };
  }[],
): T[] {
  if (hasTaskCaptureIntent(userText) || CAPTURE_INTENT.test(userText)) return actions;
  const broken = promises.some(
    (item) => (item.last_checkin_status ?? item.stats?.last_checkin_status) === "broken",
  );
  if (!broken && !/сорвал(?:ся|ась|ось)?|срыв/iu.test(userText)) return actions;
  return actions.filter((action) => action.op !== "create");
}

export function omitAgendaMutations<T>(actions: T[], userText: string): T[] {
  if (!agendaQueryDay(userText)) return actions;
  if (hasTaskCaptureIntent(userText)) return actions;
  return [];
}

/**
 * Дело, созданное в разговоре про конкретного человека, раньше оставалось
 * несвязанным: у всех дел person_id и goal_id были null, включая дело «купить
 * подарок маме», созданное в разговоре про маму. Из-за этого цель навсегда
 * оставалась с progress 0, «Ритм» в профиле — с 0%, а связка «дела + люди»,
 * ради которой продукт и существует, не собиралась даже внутри своих же данных.
 * Связываем только когда это однозначно: ровно один упомянутый человек и ровно
 * одна активная цель — угадывать при нескольких кандидатах хуже, чем не связать.
 */
async function inferTaskLinks(
  repository: AppRepository,
  ownerId: string,
  context: { userText: string; recentUserTexts?: string[] },
) {
  const haystack = [context.userText, ...(context.recentUserTexts ?? [])].join("\n");
  let personId: string | null = null;
  try {
    const mentioned = (await repository.listPeople(ownerId)).filter(
      (person) => !person.is_self && personMentionedIn(haystack, person),
    );
    if (mentioned.length === 1) personId = mentioned[0]!.id;
  } catch {
    // Связка — приятный бонус, её отсутствие не должно ронять создание дела.
  }
  // Цель намеренно НЕ подставляем. Продукт сознательно не привязывает
  // посторонние поручения к недавно обсуждённой цели — на это есть отдельные
  // тесты («купить молоко» не должно попасть в «Выучить французский»).
  return { personId };
}


export function capGoalNextSteps(
  actions: CompanionTaskAction[],
  userText: string,
): CompanionTaskAction[] {
  const cap = goalCheckInIntent(userText) ? 1 : goalDiscussIntent(userText) ? 3 : null;
  if (cap === null) return actions;
  let created = 0;
  return actions.filter((action) => {
    if (action.op !== "create") return true;
    created += 1;
    return created <= cap;
  });
}

export async function applyCompanionTaskActions(
  repository: AppRepository,
  ownerId: string,
  actions: CompanionTaskAction[],
  context: { timezone: string; userText: string; recentUserTexts?: string[]; now?: Date },
): Promise<CompanionEntity[]> {
  if (!actions.length) return [];
  const tasks = await repository.listTasks(ownerId);
  const entities: CompanionEntity[] = [];
  const now = context.now ?? new Date();
  const links = actions.some((action) => action.op === "create")
    ? await inferTaskLinks(repository, ownerId, context)
    : { personId: null };
  for (const action of actions) {
    if (action.op === "create" || action.op === "update") {
      const title = action.title?.trim();
      const matches = title ? similarOpenTasks(tasks, title, action.goal_id) : [];
      const kept = findTask(tasks, action) ?? (matches.length ? pickKeptTask(matches) : null);
      const dueAt = resolveCompanionDueAt(
        action.due_at,
        context.timezone,
        context.userText,
        now,
        context.recentUserTexts ?? [],
      );
      const estimateMinutes = action.estimate_minutes ?? parseEstimateMinutes(context.userText);
      if (kept) {
        await cancelBurstDuplicates(repository, ownerId, matches.length ? matches : [kept], kept);
        const patch: {
          due_at?: string | null;
          estimate_minutes?: number | null;
          goal_id?: string | null;
          importance?: number;
          urgency?: number;
          description?: string | null;
        } = {};
        if (dueAt && dueAt !== kept.due_at) patch.due_at = dueAt;
        if (estimateMinutes && estimateMinutes !== kept.estimate_minutes) {
          patch.estimate_minutes = estimateMinutes;
        }
        if (action.goal_id && !kept.goal_id && (await repository.getGoal(ownerId, action.goal_id))) {
          patch.goal_id = action.goal_id;
        }
        if (action.importance && action.importance !== kept.importance) {
          patch.importance = action.importance;
        }
        if (action.urgency && action.urgency !== kept.urgency) {
          patch.urgency = action.urgency;
        }
        const incomingDescription = action.description?.trim();
        if (incomingDescription) {
          const merged = mergeTaskDescription(
            kept.description,
            incomingDescription,
            context.userText,
          );
          if (merged && merged !== kept.description) patch.description = merged;
        }
        const updated = Object.keys(patch).length
          ? await repository.updateTask(ownerId, kept.id, patch)
          : kept;
        if (!updated) continue;
        Object.assign(kept, updated);
        const existingEntity = entities.find((entity) => entity.id === kept.id);
        if (existingEntity) {
          existingEntity.label = updated.title;
          existingEntity.due_at = updated.due_at;
          continue;
        }
        entities.push(taskEntity(updated, "update"));
        continue;
      }
      if (action.op === "update" || isBareStatusCheck(context.userText) || !title) continue;
      const assignee = action.assignee === "ealzy" ? "ealzy" : "user";
      const task = await repository.createTask(ownerId, {
        title,
        description: action.description?.trim() || null,
        due_at: dueAt ?? (assignee === "ealzy" ? now.toISOString() : null),
        estimate_minutes: estimateMinutes,
        assignee,
        kind: action.kind === "meeting" ? "meeting" : "task",
        importance: action.importance ?? 3,
        urgency: action.urgency ?? 3,
        person_id: links.personId,
        goal_id:
          action.goal_id && (await repository.getGoal(ownerId, action.goal_id))
            ? action.goal_id
            : null,
        project_id:
          action.project_id && (await repository.getProject(ownerId, action.project_id))
            ? action.project_id
            : null,
      });
      tasks.unshift(task);
      entities.push(taskEntity(task, "create"));
      continue;
    }
    const task = findTask(tasks, action);
    if (!task) continue;
    const updated = await repository.updateTask(ownerId, task.id, {
      status: action.op === "complete" ? "done" : "in_progress",
      completed_at: action.op === "complete" ? new Date().toISOString() : null,
    });
    if (!updated) continue;
    Object.assign(task, updated);
    entities.push(taskEntity(updated, action.op));
  }
  return entities;
}

const TASK_PROMISE =
  /я создам|я оформлю|я всё оформлю|подожди(?:те)?|i(?:['’]ll| will) create|wait a (?:bit|moment|second)/iu;
const TASK_CLAIMED_CREATE = /я создал|создал задачу|i created/iu;

function isAgendaDumpAnswer(answer: string) {
  const first = answer.trim().split(/\n/)[0]?.replace(/[*_#]/g, "").trim() ?? "";
  return /^(?:на сегодня|на завтра|today|tomorrow)\s*\.?$/iu.test(first);
}

// Илзи назвала в ответе дату («ставлю до 1 октября»), а в базу ушла другая
// (3 октября — сам день рождения). Текст и данные расходились молча: человек
// узнавал об этом, когда дело уже просрочено. Сравниваем день и месяц из
// ответа с тем, что реально записано, и при расхождении дописываем сводку с
// настоящими сроками. Относительные формулировки («завтра», «в субботу») не
// трогаем — здесь только явно названные даты.
const ANSWER_MONTHS: [RegExp, number][] = [
  [/январ/iu, 1],
  [/феврал/iu, 2],
  [/март/iu, 3],
  [/апрел/iu, 4],
  [/ма[йя]/iu, 5],
  [/июн/iu, 6],
  [/июл/iu, 7],
  [/август/iu, 8],
  [/сентябр/iu, 9],
  [/октябр/iu, 10],
  [/ноябр/iu, 11],
  [/декабр/iu, 12],
];

export function datesInAnswer(answer: string): { day: number; month: number }[] {
  const found: { day: number; month: number }[] = [];
  for (const match of answer.matchAll(/(\d{1,2})\s+(\p{L}{3,})/gu)) {
    const day = Number(match[1]);
    if (day < 1 || day > 31) continue;
    const month = ANSWER_MONTHS.find(([pattern]) => pattern.test(match[2]!))?.[1];
    if (month) found.push({ day, month });
  }
  for (const match of answer.matchAll(/\b(\d{1,2})[./](\d{1,2})(?:[./]\d{2,4})?(?!\d)/g)) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) found.push({ day, month });
  }
  return found;
}

export function dueDayMonth(dueAt: string, timezone: string) {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(dueAt));
  const [, month, day] = iso.split("-").map(Number);
  return { day: day ?? 0, month: month ?? 0 };
}


// Модель любит закончить разговорный ответ фразой «собрала план на неделю»,
// даже когда никакой записи не произошло: цель не создана, план не обновлён.
// Для продукта, который держится на доверии к своей памяти, это худший вид
// вранья — обещание работы, которой нет. Вырезаем ложное предложение и честно
// говорим, что это пока разговор.
const GOAL_WRITE_CLAIM_RU =
  /(?:^|[\s(«"„])(?:собрал|записал|обновил|сохранил|зафиксировал)\p{L}*\s+(?:план|цель|цели|плана)/iu;
const GOAL_WRITE_CLAIM_EN =
  /(?:^|[\s("])(?:saved|updated|wrote|set)\s+(?:the\s+)?(?:goal|plan|week plan)/iu;

export function groundRejectedGoalWriteAnswer(
  answer: string,
  entities: CompanionEntity[],
  options: { locale?: string | null },
) {
  if (entities.some((entity) => entity.type === "goal")) return answer;
  const ru = languageOf(options.locale) !== "en";
  const claim = ru ? GOAL_WRITE_CLAIM_RU : GOAL_WRITE_CLAIM_EN;
  if (!claim.test(answer)) return answer;
  const honest = ru
    ? "Это пока в разговоре — в цель и план недели не записывала."
    : "This stayed in the conversation — I didn't write it into the goal or the week plan.";
  const kept = (answer.match(/[^.!?]+[.!?]*/g) ?? [answer])
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !claim.test(sentence));
  return kept.length ? `${kept.join(" ")}\n\n${honest}` : honest;
}

export type GoalRecapKind = "plan" | "refine";

export function groundCompanionTaskAnswer(
  answer: string,
  entities: CompanionEntity[],
  options: { locale?: string | null; timezone: string; goalRecap?: GoalRecapKind },
) {
  const changed = entities.filter(
    (entity) => entity.type === "task" && (entity.op === "create" || entity.op === "update"),
  );
  const goals = entities.filter((entity) => entity.type === "goal");
  const promised = TASK_PROMISE.test(answer);
  const updated = changed.some((entity) => entity.op === "update");
  const claimedCreate = updated && TASK_CLAIMED_CREATE.test(answer);
  const ru = languageOf(options.locale) !== "en";
  if (changed.length && isAgendaDumpAnswer(answer)) {
    const recap = companionWriteRecap(entities, ru, options);
    if (recap) return recap;
  }
  const thin = answer.trim().length < 280;
  if (changed.length && (promised || claimedCreate) && thin) {
    if (changed.length > 1) {
      const recap = companionWriteRecap(entities, ru, options);
      return recap || answer;
    }
    const first = changed[0]!;
    const due = first.due_at ? formatDate(first.due_at, options.locale, options.timezone) : "";
    if (updated) {
      if (ru) {
        return due
          ? `Это то же дело: ${first.label}. Поставил срок — ${due}.`
          : `Это то же дело: ${first.label}. Оно уже записано.`;
      }
      return due
        ? `Same task: ${first.label}. Deadline set to ${due}.`
        : `Same task: ${first.label}. It's already on the list.`;
    }
    if (ru) {
      return due ? `Записал дело: ${first.label}. Срок — ${due}.` : `Записал дело: ${first.label}.`;
    }
    return due ? `Added the task: ${first.label}. Due ${due}.` : `Added the task: ${first.label}.`;
  }
  const recap = companionWriteRecap(entities, ru, options);
  if (!recap) return answer;
  if (answer.includes(recap)) return answer;
  const unnamedTasks = changed.filter((task) => !answer.includes(task.label));
  const saidDates = datesInAnswer(answer);
  const misdatedTasks = saidDates.length
    ? changed.filter((task) => {
        if (!task.due_at) return false;
        const actual = dueDayMonth(task.due_at, options.timezone);
        return !saidDates.some((said) => said.day === actual.day && said.month === actual.month);
      })
    : [];
  const unnamedGoals = goals.filter((goal) => !answer.includes(goal.label));
  const unnamedProjects = entities.filter(
    (entity) => entity.type === "project" && !answer.includes(entity.label),
  );
  if (!unnamedTasks.length && !unnamedGoals.length && !unnamedProjects.length && !misdatedTasks.length)
    return answer;
  return `${answer.trim()}\n\n${recap}`;
}

function agendaLine(
  task: { title: string; due_time: string | null; recurrence?: string | null },
  index: number,
  ru: boolean,
) {
  const time = task.due_time ? (ru ? ` — к ${task.due_time}` : ` — by ${task.due_time}`) : "";
  const repeating =
    task.recurrence === "daily"
      ? ru
        ? " — регулярно"
        : " — repeating"
      : "";
  return `${index}. ${task.title}${time}${repeating}`;
}

export function formatAgendaAnswer(
  tasks: {
    title: string;
    when: string;
    due_time: string | null;
    recurrence?: string | null;
    assignee?: string | null;
    status?: string;
  }[],
  day: "today" | "tomorrow",
  locale?: string | null,
) {
  const ru = languageOf(locale) !== "en";
  const open = tasks.filter(
    (task) =>
      task.status !== "done" &&
      task.status !== "cancelled" &&
      (task.assignee ?? "user") !== "ealzy",
  );
  const overdue = day === "today" ? open.filter((task) => task.when === "overdue") : [];
  const items = open.filter((task) => task.when === day);
  if (!items.length && !overdue.length) {
    if (ru) return day === "today" ? "На сегодня дел нет." : "На завтра дел нет.";
    return day === "today" ? "Nothing is scheduled for today." : "Nothing is scheduled for tomorrow.";
  }
  const lines: string[] = [];
  if (overdue.length) {
    lines.push(ru ? "**Просрочено**" : "**Overdue**");
    overdue.forEach((task, index) => lines.push(agendaLine(task, index + 1, ru)));
    lines.push("");
  }
  lines.push(ru ? (day === "today" ? "**На сегодня**" : "**На завтра**") : day === "today" ? "**Today**" : "**Tomorrow**");
  if (!items.length) {
    lines.push(ru ? "Запланированных дел нет." : "Nothing else is dated for that day.");
  } else {
    items.forEach((task, index) => lines.push(agendaLine(task, index + 1, ru)));
  }
  return lines.join("\n").trim();
}

export function groundCompanionAgendaAnswer(
  answer: string,
  tasks: Pick<Task, "title" | "due_at" | "status" | "assignee" | "recurrence_frequency">[],
  options: { locale?: string | null; timezone: string; userText: string; now?: Date },
) {
  if (hasTaskCaptureIntent(options.userText)) return answer;
  const day = agendaQueryDay(options.userText);
  if (!day) return answer;
  const today = companionClock(options.timezone, options.now).date;
  return formatAgendaAnswer(
    tasks.map((task) => ({
      title: task.title,
      ...packCompanionTaskDue(task.due_at, options.timezone, today),
      recurrence: task.recurrence_frequency ?? null,
      assignee: task.assignee ?? "user",
      status: task.status,
    })),
    day,
    options.locale,
  );
}

function companionWriteRecap(
  entities: CompanionEntity[],
  ru: boolean,
  options?: { locale?: string | null; timezone?: string; goalRecap?: GoalRecapKind },
) {
  const goals = entities.filter((entity) => entity.type === "goal");
  const projects = entities.filter((entity) => entity.type === "project");
  const tasks = entities.filter(
    (entity) => entity.type === "task" && (entity.op === "create" || entity.op === "update"),
  );
  if (!goals.length && !tasks.length && !projects.length) return "";
  const parts: string[] = [];
  if (projects.length) {
    parts.push(
      ru
        ? tasks.length
          ? `Проект: ${projects.map((item) => item.label).join(", ")}.`
          : `Записала проект: ${projects.map((item) => item.label).join(", ")}. Давай решим, что в него входит и что могу взять на себя.`
        : tasks.length
          ? `Project: ${projects.map((item) => item.label).join(", ")}.`
          : `Saved project: ${projects.map((item) => item.label).join(", ")}. Let's decide what belongs in it, and what I can take on.`,
    );
  }
  if (goals.length) {
    const created = goals.filter((goal) => goal.op === "create");
    const updated = goals.filter((goal) => goal.op !== "create");
    if (created.length) {
      parts.push(
        ru
          ? `Записала ${created.length > 1 ? "цели" : "цель"}: ${created.map((item) => item.label).join(", ")}.`
          : `Saved ${created.length > 1 ? "goals" : "goal"}: ${created.map((item) => item.label).join(", ")}.`,
      );
    }
    if (updated.length) {
      // Уточнение формулировки цели и пересборка недельного плана — разные
      // события. Говорить «обновила план», когда поменялось только название,
      // значит обещать работу, которой не было.
      const refine = options?.goalRecap === "refine";
      parts.push(
        ru
          ? refine
            ? `Уточнила цель: ${updated.map((item) => item.label).join(", ")}.`
            : `Обновила план: ${updated.map((item) => item.label).join(", ")}.`
          : refine
            ? `Refined the goal: ${updated.map((item) => item.label).join(", ")}.`
            : `Updated the plan: ${updated.map((item) => item.label).join(", ")}.`,
      );
    }
  }
  if (tasks.length) {
    // Срок в перечне обязателен. Илзи может сказать «ставлю на 1 октября», а в
    // базу уйти 3-е: без даты в сводке расхождение остаётся невидимым, и человек
    // узнаёт о нём, когда дело уже просрочено. Дата здесь — то, что реально
    // записано, поэтому любое расхождение с текстом видно сразу.
    const timezone = options?.timezone ?? "Europe/Moscow";
    const listed = tasks
      .map((item) => {
        const due = item.due_at ? formatDate(item.due_at, options?.locale, timezone) : "";
        return due ? `${item.label} — ${due}` : item.label;
      })
      .join("; ");
    parts.push(ru ? `Дела: ${listed}.` : `Tasks: ${listed}.`);
  }
  return parts.join(" ");
}

function mergeCompanionEntities(...lists: CompanionEntity[][]) {
  const map = new Map<string, CompanionEntity>();
  for (const entity of lists.flat()) {
    map.set(`${entity.type}:${entity.id}`, { ...map.get(`${entity.type}:${entity.id}`), ...entity });
  }
  return [...map.values()];
}

export { formatCompanionAnswer } from "./companion-format.js";

export function formatCompanionTelegramText(response: CompanionResponse, locale?: string | null) {
  const hits = response.search_results ?? [];
  const parts = [formatCompanionAnswer(response.answer)];
  if (hits.length && !hits.some((hit) => response.answer.includes(hit.url))) {
    parts.push(formatSearchResults(hits, locale));
  }
  if (response.offers.length) {
    const heading = languageOf(locale) === "en" ? "I can do this myself:" : "Могу сделать сам:";
    parts.push(`${heading}\n${response.offers.map((offer) => `• ${offer.title}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

const fallbackCompanionResponse = (): CompanionResponse => ({
  answer:
    "Сейчас не удалось связаться с AI. Я сохранил сообщение в общей истории — попробуйте ещё раз позже.",
  context_used: [],
  follow_up: null,
  task_actions: [],
  offers: [],
  search_actions: [],
  person_facts: [],
  self_facts: [],
  goal_plan: null,
  mail_actions: [],
  goal_actions: [],
  settings: null,
  search_results: [],
});

export function isAiUnavailableAssistant(
  message?: Pick<Message, "role" | "content" | "metadata"> | null,
) {
  if (!message || message.role !== "assistant") return false;
  if (message.metadata?.ai_unavailable === true) return true;
  const content = message.content.trim();
  return (
    content.includes("не удалось связаться с AI") || content.includes("Couldn't reach the AI")
  );
}

export function failedCompanionRetryTarget(messages: Message[]) {
  let index = messages.length - 1;
  while (index >= 0 && isAiUnavailableAssistant(messages[index])) index -= 1;
  const lastUser = index >= 0 ? messages[index] : undefined;
  if (!lastUser || lastUser.role !== "user") return null;
  const content = lastUser.content.trim();
  if (!content) return null;
  let keep = lastUser;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (!message || isAiUnavailableAssistant(message)) continue;
    if (message.role === "user" && message.content.trim() === content) {
      keep = message;
      continue;
    }
    break;
  }
  const keepIndex = messages.indexOf(keep);
  return {
    keep,
    remove: messages.slice(keepIndex + 1),
  };
}

export const ReflectionDraftSchema = z
  .object({
    wins: z.array(z.string().min(1).max(500)).max(8),
    improvements: z.array(z.string().min(1).max(500)).max(8),
    next_steps: z.array(z.string().min(1).max(500)).max(8),
  })
  .strict();

const byImportanceAndRecency = <T extends { importance: number; created_at: string }>(a: T, b: T) =>
  b.importance - a.importance || b.created_at.localeCompare(a.created_at);

export class PersonalContextBuilder {
  static readonly limits = {
    selfMemories: 12,
    goals: 10,
    projects: 8,
    tasks: 20,
    spaces: 6,
    messages: 24,
    personMemories: 8,
    feedback: 8,
    experiences: 8,
    people: 30,
    promises: 8,
    mail: 20,
  } as const;

  constructor(private readonly repository: AppRepository) {}

  async build(ownerId: string, query: string): Promise<PersonalContext> {
    const conversation = await this.repository.getPrimaryConversation(ownerId);
    const [
      profile,
      user,
      self,
      goals,
      promises,
      promiseCheckins,
      projects,
      tasks,
      spaces,
      recentMessages,
      feedback,
      people,
      experiences,
      mailAccounts,
      mailMessages,
      mailDrafts,
      mailPlaybooks,
    ] = await Promise.all([
      this.repository.getProfile(ownerId),
      this.repository.getUser(ownerId),
      this.repository.getSelfPerson(ownerId),
      this.repository.listGoals(ownerId),
      this.repository.listPromises(ownerId),
      this.repository.listPromiseCheckins(ownerId),
      this.repository.listProjects(ownerId),
      this.repository.listTasks(ownerId),
      this.repository.listSpaces(ownerId),
      this.repository.listMessages(
        ownerId,
        conversation.id,
        PersonalContextBuilder.limits.messages,
      ),
      this.repository.listRecommendationFeedback(ownerId, PersonalContextBuilder.limits.feedback),
      this.repository.listPeople(ownerId),
      this.repository.listExperiences(ownerId),
      this.repository.listMailAccounts(ownerId),
      this.repository.listMailMessages(ownerId, PersonalContextBuilder.limits.mail),
      this.repository.listMailDrafts(ownerId),
      this.repository.listMailPlaybooks(ownerId),
    ]);
    if (!profile || !self) throw new Error("Personal context is not provisioned");
    const selfMemories = selectSelfTheses(
      await this.repository.listMemories(ownerId, self.id),
      query,
      PersonalContextBuilder.limits.selfMemories,
    );
    const focused = selectFocusedPeople(people, query, recentMessages);
    const relevant_people = await Promise.all(
      focused.map(async (person) => ({
        ...person,
        memories: (await this.repository.listMemories(ownerId, person.id))
          .filter((x) => x.status === "active")
          .sort(byImportanceAndRecency)
          .slice(0, PersonalContextBuilder.limits.personMemories),
      })),
    );
    const timezone = profile.timezone || "Europe/Moscow";
    const clock = companionClock(timezone);
    const openTasks = tasks.filter((x) => x.status !== "done" && x.status !== "cancelled");
    const activeGoals = goals.filter((x) => x.status === "active");
    const activeProjects = projects.filter((x) => x.status === "active");
    const selfLocations = self.locations ?? [];
    const city = cityFromLocations(selfLocations) || cityForTimezone(timezone, profile.locale);
    const upcomingDates = await collectUpcomingDates(
      people,
      (personId) => this.repository.listMemories(ownerId, personId),
      timezone,
      new Date(),
      experiences,
    );
    const focusedGoal = focusedGoalFromConversation(query, recentMessages, activeGoals, openTasks);
    // Обычно цель с планом ближе к разговору. Но на синке по целям смысл
    // ровно обратный: сверять надо те, у которых плана на неделю ещё нет —
    // иначе они никогда не попадут в контекст и так и останутся без плана.
    const syncTurn = isGoalSyncTurn(query);
    const rankedGoals = rankByQuery(
      activeGoals,
      query,
      (goal) => `${goal.title} ${goal.description ?? ""} ${goal.current_plan ?? ""}`,
      (goal) => {
        const planned = Boolean(goal.current_plan?.trim());
        if (syncTurn) return planned ? 0 : 2;
        return planned ? 2 : 0;
      },
    );
    const selectedGoals = (
      focusedGoal
        ? [focusedGoal, ...rankedGoals.filter((goal) => goal.id !== focusedGoal.id)]
        : rankedGoals
    )
      .slice(0, PersonalContextBuilder.limits.goals)
      .map((goal) => withGoalStats(goal, tasks));
    const selectedGoalIds = new Set(selectedGoals.map((goal) => goal.id));
    const selectedProjects = rankByQuery(
      activeProjects,
      query,
      (project) => `${project.name} ${project.description ?? ""}`,
    ).slice(0, PersonalContextBuilder.limits.projects);
    const agendaDay = agendaQueryDay(query);
    const tomorrowKey = addCalendarDays(clock.date, 1);
    const rankedTasks = rankByQuery(
      openTasks,
      query,
      (task) => `${task.title} ${task.description ?? ""}`,
      (task) => {
        const linked = Boolean(task.goal_id && selectedGoalIds.has(task.goal_id));
        const dueKey = task.due_at ? dateKeyInZone(new Date(task.due_at), timezone) : null;
        let agendaBonus = 0;
        if (agendaDay === "today") {
          if (dueKey === clock.date) agendaBonus = 24;
          else if (dueKey && dueKey < clock.date) agendaBonus = 16;
          else if (dueKey === tomorrowKey) agendaBonus = -8;
        } else if (agendaDay === "tomorrow") {
          if (dueKey === tomorrowKey) agendaBonus = 24;
          else if (dueKey === clock.date) agendaBonus = 4;
        }
        return (isPushTask(task) ? 5 : 0) + (linked ? 3 : 0) + agendaBonus;
      },
    );
    const pinnedGoalTasks = focusedGoal
      ? openTasks.filter((task) => task.goal_id === focusedGoal.id).slice(0, 8)
      : [];
    const pinnedIds = new Set(pinnedGoalTasks.map((task) => task.id));
    const selectedTasks = [
      ...pinnedGoalTasks,
      ...rankedTasks.filter((task) => !pinnedIds.has(task.id)),
    ].slice(0, PersonalContextBuilder.limits.tasks);
    const selectedSpaces = spaces.slice(0, PersonalContextBuilder.limits.spaces);
    // Только просрочка, не попавшая в показанный модели список: иначе Илзи
    // сообщает «ещё 5 просроченных за пределами списка» про дела, которые видит.
    const selectedTaskIds = new Set(selectedTasks.map((task) => task.id));
    const overdueCount = openTasks.filter((task) => {
      const due = task.due_at;
      if (!due || selectedTaskIds.has(task.id)) return false;
      return companionClock(timezone, new Date(due)).date < clock.date;
    }).length;
    const knownPatterns = inferBehaviorPatterns({
      tasks: openTasks,
      promises: promises.map((item) => withPromiseStats(item, promiseCheckins)),
      timezone,
      locale: profile.locale,
    });
    return {
      profile: {
        bio: profile.bio,
        values: profile.values.slice(0, 12),
        communication_style: profile.communication_style,
        timezone,
        locale: profile.locale,
        last_goal_checkin_on: profile.last_goal_checkin_on,
        weekly_reflection_enabled: profile.weekly_reflection_enabled,
        morning_digest_enabled: profile.morning_digest_enabled,
        morning_digest_time: profile.morning_digest_time,
        weekly_digest_enabled: profile.weekly_digest_enabled,
        weekly_digest_time: profile.weekly_digest_time,
        evening_sync_enabled: profile.evening_sync_enabled,
        evening_sync_time: profile.evening_sync_time,
        reengagement_enabled: profile.reengagement_enabled,
        context_summary:
          composePortrait({
            bio: profile.bio,
            values: profile.values,
            memories: selfMemories,
            patterns: knownPatterns,
            locale: profile.locale,
          }) ||
          profile.context_summary ||
          null,
      },
      telegram_linked: Boolean(user?.telegram_id),
      known_patterns: knownPatterns,
      self_memories: selfMemories,
      self_gender: inferPersonGender({ name: self.name, relationship: self.relationship }),
      goals: selectedGoals,
      promises: rankByQuery(
        promises.filter((item) => item.status === "active"),
        query,
        (item) => `${item.title} ${item.description ?? ""}`,
        (item) => (withPromiseStats(item, promiseCheckins).stats?.due_for_checkin ? 6 : 0),
      )
        .slice(0, PersonalContextBuilder.limits.promises)
        .map((item) => withPromiseStats(item, promiseCheckins)),
      projects: selectedProjects,
      tasks: selectedTasks,
      goal_history_tasks: tasks
        .filter(
          (task) =>
            Boolean(task.goal_id) && task.status === "done" && selectedGoalIds.has(task.goal_id!),
        )
        .slice(0, 24),
      spaces: selectedSpaces,
      recent_messages: recentMessages,
      people_index: people
        .filter((person) => !person.is_self)
        .slice(0, PersonalContextBuilder.limits.people)
        .map((person) => ({
          id: person.id,
          name: person.name,
          relationship: person.relationship,
          city: cityFromLocations(person.locations),
          birthday: compactBirthday(person.dates),
        })),
      relevant_people,
      relevant_person: relevant_people[0] ?? null,
      self_locations: selfLocations,
      recommendation_feedback: feedback.slice(0, PersonalContextBuilder.limits.feedback),
      experiences: experiences
        .filter(
          (x) =>
            !relevant_people.length ||
            relevant_people.some((person) => x.participant_ids.includes(person.id)),
        )
        .slice(0, PersonalContextBuilder.limits.experiences),
      mail_accounts: mailAccounts,
      mail_messages: mailMessages.slice(0, PersonalContextBuilder.limits.mail),
      mail_drafts: mailDrafts.slice(0, 8),
      mail_playbooks: mailPlaybooks.slice(0, 8),
      upcoming_dates: upcomingDates,
      city,
      overflow: {
        extra_tasks: Math.max(0, openTasks.length - selectedTasks.length),
        extra_overdue: overdueCount,
        extra_goals: Math.max(0, activeGoals.length - selectedGoals.length),
        extra_projects: Math.max(0, activeProjects.length - selectedProjects.length),
        extra_spaces: Math.max(0, spaces.length - selectedSpaces.length),
      },
      discovery_results: [],
    };
  }
}

export class CompanionService {
  private readonly contextBuilder: PersonalContextBuilder;
  constructor(
    private readonly repository: AppRepository,
    private readonly ai?: AiProvider,
    private readonly discovery: DiscoveryClient = defaultDiscoveryClient,
  ) {
    this.contextBuilder = new PersonalContextBuilder(repository);
  }

  async send(
    ownerId: string,
    text: string,
    sourceChannel: SourceChannel,
    telegram?: { chatId: number; messageId: number },
    options?: { onAnswerDelta?: (answer: string) => void },
  ): Promise<{
    conversation_id: string;
    user_message: Message;
    assistant_message: Message;
    response: CompanionResponse;
    mail_confirm: MailConfirmKeyboard | null;
  }> {
    const conversation = await this.repository.getPrimaryConversation(ownerId);
    const userMessage = await this.repository.createMessage(ownerId, {
      conversation_id: conversation.id,
      telegram_chat_id: telegram?.chatId ?? null,
      telegram_message_id: telegram?.messageId ?? null,
      role: "user",
      content: text,
      intent: "companion",
      source_channel: sourceChannel,
      metadata: {},
    });
    if (!userMessage) throw Object.assign(new Error("Duplicate message"), { status: 409 });
    return this.respondToMessage(ownerId, text, sourceChannel, userMessage, options);
  }

  async retry(
    ownerId: string,
    sourceChannel: SourceChannel,
    options?: { onAnswerDelta?: (answer: string) => void },
  ): Promise<{
    conversation_id: string;
    user_message: Message;
    assistant_message: Message;
    response: CompanionResponse;
    mail_confirm: MailConfirmKeyboard | null;
  }> {
    const conversation = await this.repository.getPrimaryConversation(ownerId);
    const messages = await this.repository.listMessages(ownerId, conversation.id, 100);
    const target = failedCompanionRetryTarget(messages);
    if (!target) {
      throw Object.assign(new Error("No failed companion turn to retry"), {
        status: 400,
        code: "NOTHING_TO_RETRY",
      });
    }
    for (const message of target.remove) {
      await this.repository.deleteMessage(ownerId, message.id);
    }
    return this.respondToMessage(ownerId, target.keep.content, sourceChannel, target.keep, options);
  }

  async respondToMessage(
    ownerId: string,
    text: string,
    sourceChannel: SourceChannel,
    userMessage: Message,
    options?: { onAnswerDelta?: (answer: string) => void },
  ): Promise<{
    conversation_id: string;
    user_message: Message;
    assistant_message: Message;
    response: CompanionResponse;
    mail_confirm: MailConfirmKeyboard | null;
  }> {
    const conversation = await this.repository.getPrimaryConversation(ownerId);
    let settingsApplied: Record<string, unknown> | null = null;
    const persistAssistant = async (
      response: CompanionResponse,
      entities: CompanionEntity[],
      extras?: { ai_unavailable?: boolean },
    ) => {
      const metadata = {
        context_used: response.context_used,
        follow_up: response.follow_up,
        entities,
        offers: extras?.ai_unavailable ? [] : response.offers,
        search_results: response.search_results,
        settings: settingsApplied,
        ...(extras?.ai_unavailable ? { ai_unavailable: true } : {}),
      };
      if (extras?.ai_unavailable) {
        return {
          id: `unavailable-${userMessage.id}`,
          owner_id: ownerId,
          conversation_id: conversation.id,
          telegram_chat_id: null,
          telegram_message_id: null,
          role: "assistant" as const,
          content: response.answer,
          intent: "companion" as const,
          source_channel: sourceChannel,
          metadata,
          created_at: new Date().toISOString(),
        };
      }
      const assistantMessage = await this.repository.createMessage(ownerId, {
        conversation_id: conversation.id,
        telegram_chat_id: null,
        telegram_message_id: null,
        role: "assistant",
        content: response.answer,
        intent: "companion",
        source_channel: sourceChannel,
        metadata,
      });
      if (!assistantMessage) throw new Error("Could not persist assistant response");
      return assistantMessage;
    };
    try {
      const replyTo = readCompanionReplyTo(userMessage);
      const quoted = replyFocusText(replyTo);
      const context = await this.contextBuilder.build(
        ownerId,
        quoted ? `${text}\n${quoted}` : text,
      );
      const focus = context.relevant_person;
      const aboutPerson =
        Boolean(focus) &&
        (refersToFocusedPerson(text) ||
          (focus ? /подарк|ресторан|кафе|куда\s+сходить|доставк|адрес/iu.test(text) : false));
      const city =
        (aboutPerson ? cityFromLocations(focus?.locations) : null) ||
        context.city ||
        cityForTimezone(context.profile.timezone, context.profile.locale);
      const searchText = focusedSearchQuery(text, focus);
      const explicitDiscovery = isExplicitDiscoveryRequest(text);
      const searchPromise = explicitDiscovery && inferDiscoveryIntent(text, city)
        ? this.collectSearchHits(searchText, city, [], true, context.profile.locale)
        : Promise.resolve([] as DiscoveryHit[]);
      let usedAi = false;
      let response: CompanionResponse = fallbackCompanionResponse();
      const generate = this.ai?.companionStream ?? this.ai?.companion;
      if (generate) {
        try {
          const packed = {
            workspace: {
              ...toCompanionWorkspace(context),
              ...(replyTo
                ? {
                    replied_to: {
                      role: replyTo.role,
                      content: replyTo.content.slice(0, 1500),
                      ...(replyTo.entity_labels?.length
                        ? { entity_labels: replyTo.entity_labels.slice(0, 8) }
                        : {}),
                    },
                  }
                : {}),
            },
            conversation: conversationTurns(context.recent_messages, text, 12, replyTo),
          };
          const raw = this.ai?.companionStream
            ? await this.ai.companionStream(text, packed, options?.onAnswerDelta)
            : await this.ai!.companion!(text, packed);
          response = {
            ...parseCompanionResponse(raw),
            search_results: [],
          };
          usedAi = true;
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "companion_ai_failed",
              error: error instanceof Error ? error.message : String(error),
              name: error instanceof Error ? error.name : undefined,
              status:
                error && typeof error === "object" && "status" in error
                  ? (error as { status?: unknown }).status
                  : undefined,
            }),
          );
        }
      }
      const hits = await searchPromise;
      const extraHits = explicitDiscovery && response.search_actions.length
        ? await this.collectSearchHits(
            searchText,
            city,
            response.search_actions.map((action) => ({
              ...action,
              query: focusedSearchQuery(action.query || text, focus),
            })),
            false,
            context.profile.locale,
          )
        : [];
      const searchResults = dedupeHits([...hits, ...extraHits]);
      response.search_results = searchResults;
      if (searchResults.length) {
        response.answer = attachSearchAnswer(
          response.answer,
          searchResults,
          context.profile.locale,
        );
      }
      // Ealzy never searches on its own initiative: a topic mention (no explicit
      // "найди"/"подбери"/etc.) only ever produces a clickable offer, never a live
      // search. Only the user's own words, or a click on that offer, execute one.
      const offerContext = [
        text,
        ...response.task_actions.map((action) => action.title?.trim() ?? "").filter(Boolean),
      ].join("\n");
      const discoveryOffers: CapabilityOffer[] = [];
      if (!explicitDiscovery) {
        const candidateIntents: DiscoveryIntent[] = [];
        const inferred = inferDiscoveryIntent(offerContext, city);
        if (inferred) candidateIntents.push(inferred);
        for (const action of response.search_actions) {
          const intent = intentFromSearchAction(action, city);
          if (intent) candidateIntents.push(intent);
        }
        const seenIntents = new Set<string>();
        for (const intent of candidateIntents) {
          const key = `${intent.type}:${intent.query}`;
          if (seenIntents.has(key)) continue;
          seenIntents.add(key);
          discoveryOffers.push(discoverySearchOffer(intent, context.profile.locale));
        }
      }
      const recentOfferTitles = context.recent_messages.flatMap((message) => {
        const offers = message.metadata?.offers;
        if (!Array.isArray(offers)) return [];
        return offers
          .map((offer) =>
            offer && typeof offer === "object" && "title" in offer
              ? String((offer as { title?: unknown }).title ?? "")
              : "",
          )
          .filter(Boolean);
      });
      response.offers =
        usedAi || discoveryOffers.length
          ? mergeCapabilityOffers([...discoveryOffers, ...(usedAi ? response.offers : [])], {
              userText: offerContext,
              upcomingDates: context.upcoming_dates,
              recentOfferTitles,
              didSearch: searchResults.length > 0,
              locale: context.profile.locale,
              goalSyncDue: goalSyncDueOn(
                context.profile.last_goal_checkin_on,
                companionClock(context.profile.timezone).date,
              ),
              selfGender: context.self_gender,
              city,
              canDraftMail: context.mail_messages.some(
                (item) => item.is_important && !item.handled,
              ),
            })
          : [];
      if (isGoalSyncTurn(text)) {
        await this.repository.updateProfile(ownerId, {
          last_goal_checkin_on: companionClock(context.profile.timezone).date,
        });
      }
      const focusedNow = focusedGoalFromText(text, context.goals, context.tasks);
      const continuedGoal = focusedGoalFromConversation(
        text,
        context.recent_messages,
        context.goals,
        context.tasks,
      );
      const explicitWrite = isGoalSyncTurn(text) || explicitGoalWriteIntent(text);
      // «Она ещё актуальна и корректно сформулирована?» — это просьба поправить
      // формулировку, а не пересобрать недельный план. Разрешаем запись, но
      // только названия и горизонта: current_plan остаётся прежним.
      const refineTurn = goalRefineIntent(text);
      const allowGoalWrites =
        explicitWrite || refineTurn || (Boolean(continuedGoal) && continuedGoalWriteIntent(text));
      const allowGoalCreate = explicitWrite && !continuedGoal;
      let linkedFromGoals: Awaited<ReturnType<typeof applyGoalActions>> = {
        entities: [],
        linked_tasks: [],
      };
      try {
        linkedFromGoals = await applyGoalActions(
          this.repository,
          ownerId,
          allowGoalWrites ? response.goal_actions : [],
          {
            allowCreate: allowGoalCreate,
            allowMatchByTitle: allowGoalWrites,
            allowPlan: !refineTurn,
            allowHorizon: refineTurn,
          },
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "companion_goal_actions_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      const settingsPatch = mergeSettings(inferCompanionSettings(text), response.settings);
      const prepDraft = inferDatePrepProject(text);
      let prepEntities: CompanionEntity[] = [];
      let createdPrepProject: { id: string; name: string } | null = null;
      if (prepDraft) {
        try {
          const result = await applyDatePrepProject(
            this.repository,
            ownerId,
            text,
            await this.repository.listProjects(ownerId),
          );
          if (result) {
            createdPrepProject = { id: result.project.id, name: result.project.name };
            prepEntities.push({
              type: "project",
              id: result.project.id,
              label: result.project.name,
              op: result.created ? "create" : "update",
            });
          }
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "companion_date_prep_project_failed",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
      const talkOnlyFollowUp =
        Boolean(continuedGoal) &&
        !focusedNow &&
        !allowGoalWrites &&
        !hasTaskCaptureIntent(text) &&
        !settingsPatch;
      const inferredTasks = prepDraft
        ? []
        : talkOnlyFollowUp
          ? []
          : allowGoalCreate || allowGoalWrites || settingsPatch
            ? response.task_actions
            : mergeCompanionTaskActions(response.task_actions, [
                ...inferCompanionTaskActions(text, { quoted }),
                ...inferBirthdayReminders(text, context.upcoming_dates),
              ]);
      const writtenGoalIds = linkedFromGoals.entities
        .filter((entity) => entity.type === "goal")
        .map((entity) => entity.id);
      const rejectedGoalDump =
        !allowGoalWrites &&
        !focusedNow &&
        !writtenGoalIds.length &&
        (response.goal_actions?.length ?? 0) > 0;
      const extraTasks = inferredTasks.filter((action) => {
        if (rejectedGoalDump && action.op === "create" && !action.goal_id) return false;
        if (action.op !== "create" || !action.title) return true;
        return !linkedFromGoals.linked_tasks.some((task) =>
          similarTaskTitles(task.title, action.title ?? ""),
        );
      });
      const bindGoalId =
        writtenGoalIds.length === 1
          ? writtenGoalIds[0]!
          : focusedNow || allowGoalWrites
            ? (continuedGoal?.id ?? null)
            : null;
      const bindOrphans = Boolean(bindGoalId);
      const taskActions = normalizeDescriptionEdits(
        omitAgendaMutations(
          omitUnsolicitedPromiseCaptures(
            omitEalzyQueueMutations(
              [
                ...linkedFromGoals.linked_tasks.map((task) => ({
                  op: "create" as const,
                  task_id: null,
                  title: task.title,
                  due_at: task.due_at,
                  goal_id: task.goal_id,
                  project_id: null,
                  kind: "task" as const,
                  importance: task.importance,
                  urgency: task.urgency,
                  assignee: task.assignee,
                })),
                ...extraTasks.map((action) =>
                  bindOrphans && (action.op === "create" || action.op === "update") && !action.goal_id
                    ? { ...action, goal_id: bindGoalId }
                    : action,
                ),
              ],
              context.tasks,
            ),
            text,
            context.promises,
          ),
          text,
        ),
        text,
        context.tasks,
        response.answer,
        quoted,
      );
      // Чек-ин по цели просит ОДИН следующий шаг, обсуждение — не больше трёх.
      // Модель охотно накидывает пять, и цель превращается в свалку задач
      // вместо плана на неделю, который человек реально сделает.
      const cappedTaskActions = capGoalNextSteps(taskActions, text);
      const personFacts = response.person_facts.some((fact) => fact.person_name.trim())
        ? response.person_facts
        : inferCompanionPersonFacts(text);
      const extractedSelf = response.self_facts.filter(
        (fact) => fact.content?.trim() && !selfFactIsAboutSavedPerson(fact.content, personFacts),
      );
      const selfFacts = mergeSelfFacts(
        extractedSelf.length ? extractedSelf : inferCompanionSelfFacts(text),
        inferImplicitSelfFacts(text),
      );
      const goalEntities: CompanionEntity[] = linkedFromGoals.entities.map((entity) => ({
        type: entity.type,
        id: entity.id,
        label: entity.label,
        op: entity.op,
      }));
      let taskEntities: CompanionEntity[] = [];
      try {
        taskEntities = await applyCompanionTaskActions(this.repository, ownerId, cappedTaskActions, {
          timezone: context.profile.timezone || "Europe/Moscow",
          userText: text,
          recentUserTexts: [
            ...(quoted ? [quoted] : []),
            ...context.recent_messages
              .filter((message) => message.role === "user")
              .map((message) => message.content)
              .slice(-4)
              .reverse(),
          ],
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "companion_task_actions_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      let planEntities: CompanionEntity[] = [];
      try {
        const plan =
          response.goal_plan && !response.goal_plan.goal_id && writtenGoalIds.length === 1
            ? { ...response.goal_plan, goal_id: writtenGoalIds[0]! }
            : response.goal_plan;
        planEntities = await applyGoalPlan(
          this.repository,
          ownerId,
          allowGoalWrites ? plan : null,
          new Set(taskEntities.filter((entity) => entity.type === "task").map((entity) => entity.id)),
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "companion_goal_plan_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      let entities: CompanionEntity[] = mergeCompanionEntities(
        goalEntities,
        prepEntities,
        taskEntities,
        planEntities,
      );
      let savedSelfFacts = 0;
      try {
        entities = [
          ...entities,
          ...(await applyCompanionPersonFacts(
            this.repository,
            ownerId,
            personFacts,
            userMessage.id,
          )),
        ];
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "companion_person_facts_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      try {
        savedSelfFacts = await applyCompanionSelfFacts(
          this.repository,
          ownerId,
          selfFacts,
          userMessage.id,
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "companion_self_facts_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      if (!context.profile.communication_style && !settingsPatch?.communication_style) {
        const style = inferCommunicationStyle(text);
        if (style) {
          try {
            await this.repository.updateProfile(ownerId, { communication_style: style });
            context.profile.communication_style = style;
          } catch (error) {
            console.error(
              JSON.stringify({
                event: "companion_style_failed",
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        }
      }
      let settingsRecap = "";
      try {
        const result = await applyCompanionSettings(this.repository, ownerId, settingsPatch);
        if (Object.keys(result.applied).length) {
          settingsApplied = result.applied;
          settingsRecap = formatSettingsRecap(result.applied, {
            locale: result.profile?.locale ?? context.profile.locale,
            telegramLinked: context.telegram_linked,
          });
        }
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "companion_settings_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      let mailConfirm: MailConfirmKeyboard | null = null;
      try {
        const mailResult = await applyCompanionMailActions(
          this.repository,
          ownerId,
          response.mail_actions,
          {
            locale: context.profile.locale,
            telegramChatId: userMessage.telegram_chat_id,
          },
        );
        entities = [...entities, ...mailResult.entities];
        mailConfirm = mailResult.confirm;
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "companion_mail_actions_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      if (!usedAi && (entities.length || settingsRecap)) {
        const peopleNote = formatPersonSaveAnswer(
          personFacts,
          entities.filter(
            (entity): entity is CompanionEntity & { type: "person" } => entity.type === "person",
          ),
        );
        const selfNote = formatSelfSaveAnswer(selfFacts);
        const goalNote = entities
          .filter((entity) => entity.type === "goal")
          .map((entity) => `Записал цель: ${entity.label}.`)
          .join(" ");
        const taskNote = entities
          .filter((entity) => entity.type === "task")
          .map((entity) => `Записал дело: ${entity.label}.`)
          .join(" ");
        const mailNote = entities
          .filter((entity) => entity.type === "mail")
          .map((entity) => `Черновик: ${entity.label}.`)
          .join(" ");
        response = {
          ...response,
          answer:
            [peopleNote, selfNote, goalNote, taskNote, mailNote, settingsRecap]
              .filter(Boolean)
              .join(" ") || response.answer,
          task_actions: cappedTaskActions,
          person_facts: personFacts,
          self_facts: selfFacts,
          settings: settingsPatch,
        };
        if (searchResults.length) {
          response.answer = attachSearchAnswer(
            response.answer,
            searchResults,
            context.profile.locale,
          );
        }
      }
      if (createdPrepProject) {
        const follow = datePrepEalzyOffers(
          context.upcoming_dates,
          createdPrepProject,
          context.profile.locale,
          context.self_gender,
        );
        const rest = response.offers.filter(
          (offer) => !follow.some((item) => item.title === offer.title),
        );
        response.offers = [...follow, ...rest].slice(0, 3);
      }
      response.answer = groundCompanionTaskAnswer(response.answer, entities, {
        locale: context.profile.locale,
        timezone: context.profile.timezone || "Europe/Moscow",
        goalRecap: refineTurn ? "refine" : "plan",
      });
      response.answer = groundDescriptionEditAnswer(
        response.answer,
        entities,
        text,
        context.profile.locale,
      );
      if (usedAi) {
        response.answer = groundCompanionAgendaAnswer(response.answer, context.tasks, {
          locale: context.profile.locale,
          timezone: context.profile.timezone || "Europe/Moscow",
          userText: text,
        });
      }
      response.answer = groundRejectedGoalWriteAnswer(response.answer, entities, {
        locale: context.profile.locale,
      });
      response.answer = groundMemoryClaimAnswer(response.answer, {
        locale: context.profile.locale,
        savedMemory:
          savedSelfFacts > 0 ||
          entities.some((entity) => entity.type === "person") ||
          Boolean(settingsRecap),
      });
      if (settingsRecap && !response.answer.includes(settingsRecap)) {
        const times = [
          settingsApplied?.morning_digest_time,
          settingsApplied?.weekly_digest_time,
          settingsApplied?.evening_sync_time,
        ].filter((item): item is string => typeof item === "string");
        const covered = times.length > 0 && times.every((time) => response.answer.includes(time));
        if (!covered) response.answer = `${response.answer.trim()}\n\n${settingsRecap}`;
      }
      response.answer = formatCompanionAnswer(response.answer);
      const assistantMessage = await persistAssistant(response, entities, {
        ai_unavailable: !usedAi,
      });
      try {
        await refreshPortrait(this.repository, ownerId);
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "companion_portrait_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      const user = await this.repository.getUser(ownerId);
      if (user && Date.now() - Date.parse(user.created_at) >= 7 * 24 * 60 * 60 * 1000)
        await this.repository.trackBetaMetric(ownerId, "companion_week_2", {
          source_channel: sourceChannel,
        });
      return {
        conversation_id: conversation.id,
        user_message: userMessage,
        assistant_message: assistantMessage,
        response,
        mail_confirm: mailConfirm,
      };
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "companion_respond_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      const response = fallbackCompanionResponse();
      return {
        conversation_id: conversation.id,
        user_message: userMessage,
        assistant_message: await persistAssistant(response, [], { ai_unavailable: true }),
        response,
        mail_confirm: null,
      };
    }
  }

  private async collectSearchHits(
    text: string,
    city: string,
    actions: {
      type: "products" | "places" | "gifts" | "web" | "fx";
      query: string;
      city?: string | null;
      max_price?: number | null;
      min_price?: number | null;
      brand?: string | null;
      category?: string | null;
    }[],
    infer = true,
    locale?: string | null,
  ) {
    const intents: DiscoveryIntent[] = [];
    if (infer) {
      const inferred = inferDiscoveryIntent(text, city);
      if (inferred) intents.push({ ...inferred, locale });
    }
    for (const action of actions) {
      const intent = intentFromSearchAction(action, city);
      if (intent) intents.push({ ...intent, locale });
    }
    const unique = new Map<string, DiscoveryIntent>();
    for (const intent of intents) {
      unique.set(`${intent.type}:${intent.query}:${intent.maxPrice ?? ""}`, intent);
    }
    const hits = (
      await Promise.all(
        [...unique.values()].map(async (intent) => {
          try {
            return await this.discovery.search(intent);
          } catch {
            return [];
          }
        }),
      )
    ).flat();
    return dedupeHits(hits);
  }
}

function dedupeHits(hits: DiscoveryHit[]) {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (seen.has(hit.url)) return false;
    seen.add(hit.url);
    return true;
  });
}

export class ReflectionService {
  private readonly contextBuilder: PersonalContextBuilder;
  constructor(
    private readonly repository: AppRepository,
    private readonly ai?: AiProvider,
  ) {
    this.contextBuilder = new PersonalContextBuilder(repository);
  }

  async weekly(ownerId: string, at = new Date()): Promise<Reflection> {
    const periodEnd = at.toISOString();
    const periodStart = new Date(at.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const context = await this.contextBuilder.build(ownerId, "weekly reflection");
    const weeklyMessages = context.recent_messages.filter(
      (x) => x.created_at >= periodStart && x.created_at <= periodEnd,
    );
    const snapshot = {
      tasks: context.tasks,
      goals: context.goals,
      projects: context.projects,
      messages: weeklyMessages,
      experiences: context.experiences.filter(
        (experience) => !experience.occurred_at || experience.occurred_at >= periodStart,
      ),
    };
    let draft = {
      wins: [] as string[],
      improvements:
        weeklyMessages.length || context.tasks.length
          ? ["Выберите один незавершённый вопрос и определите следующий маленький шаг."]
          : ["За неделю пока недостаточно данных для содержательного обзора."],
      next_steps: context.tasks.slice(0, 3).map((x) => x.title),
    };
    if (this.ai?.reflect) {
      try {
        draft = ReflectionDraftSchema.parse(await this.ai.reflect(snapshot));
      } catch {
        // Deterministic reflection remains available during provider outages.
      }
    }
    const reflection = await this.repository.createReflection(ownerId, {
      period_start: periodStart,
      period_end: periodEnd,
      ...draft,
      source_snapshot: snapshot,
    });
    await this.repository.trackBetaMetric(ownerId, "reflection_completed");
    return reflection;
  }
}
