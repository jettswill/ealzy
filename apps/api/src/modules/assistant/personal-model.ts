import { withPromiseStats } from "../../direction.js";
import { languageOf } from "../../locale.js";
import type { AppRepository } from "../../repository.js";
import type { Memory, SelfPromise, Task } from "../../types.js";
import { companionClock } from "./companion-workspace.js";
import {
  isInferredBehaviorMemory,
  visibleSelfMemories,
  type CompanionSelfFact,
} from "./self-context.js";
import { isPushTask } from "./task-priority.js";

export const PORTRAIT_MAX = 1200;

export type KnownPatternKind =
  | "postpones"
  | "undated_backlog"
  | "overdue_cluster"
  | "keeps_promises"
  | "broken_promise"
  | "push_ignored";

export type KnownPattern = {
  kind: KnownPatternKind;
  detail: string;
};

type TaskLike = Pick<
  Task,
  "status" | "due_at" | "title" | "assignee" | "importance" | "urgency"
>;

type PromiseLike = Pick<SelfPromise, "title" | "status"> & {
  stats?: {
    last_checkin_status?: string | null;
    keeping_days?: number;
    broken_count?: number;
  } | null;
};

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function isUserTask(task: TaskLike) {
  return (task.assignee ?? "user") !== "ealzy";
}

function isOpen(task: TaskLike) {
  return task.status === "todo" || task.status === "in_progress";
}

export function inferBehaviorPatterns(input: {
  tasks: TaskLike[];
  promises?: PromiseLike[];
  timezone: string;
  now?: Date;
  locale?: string;
}): KnownPattern[] {
  const ru = languageOf(input.locale) !== "en";
  const clock = companionClock(input.timezone, input.now);
  const open = input.tasks.filter((task) => isOpen(task) && isUserTask(task));
  const overdue = open.filter((task) => {
    if (!task.due_at) return false;
    return companionClock(input.timezone, new Date(task.due_at)).date < clock.date;
  });
  const undated = open.filter((task) => !task.due_at);
  const overduePush = overdue.filter((task) => isPushTask(task));
  const patterns: KnownPattern[] = [];

  if (overdue.length >= 3) {
    const sample = overdue
      .slice(0, 3)
      .map((task) => task.title)
      .join(ru ? ", " : ", ");
    patterns.push({
      kind: "overdue_cluster",
      detail: ru
        ? `часто копит просрочку (${overdue.length}): ${sample}`
        : `often lets work go overdue (${overdue.length}): ${sample}`,
    });
  }

  if (undated.length >= 6) {
    patterns.push({
      kind: "undated_backlog",
      detail: ru
        ? `держит много дел без даты (${undated.length})`
        : `keeps a large undated backlog (${undated.length})`,
    });
  }

  const postponeRatio = open.length ? overdue.length / open.length : 0;
  if (
    (overdue.length >= 3 && (undated.length >= 4 || postponeRatio >= 0.4)) ||
    overduePush.length >= 2
  ) {
    patterns.push({
      kind: "postpones",
      detail: ru
        ? "склонен откладывать, пока хвосты не становятся срочными"
        : "tends to postpone until leftover work becomes urgent",
    });
  }

  if (overduePush.length >= 1) {
    const sample = overduePush[0]?.title ?? "";
    patterns.push({
      kind: "push_ignored",
      detail: ru
        ? `срочное важное дело висит: ${sample}`
        : `urgent important work is still open: ${sample}`,
    });
  }

  const activePromises = (input.promises ?? []).filter((item) => item.status === "active");
  const keeping = activePromises.filter(
    (item) => (item.stats?.keeping_days ?? 0) >= 7 && item.stats?.last_checkin_status !== "broken",
  );
  if (keeping.length) {
    const titles = keeping
      .slice(0, 2)
      .map((item) => item.title)
      .join(ru ? ", " : ", ");
    patterns.push({
      kind: "keeps_promises",
      detail: ru
        ? `обычно держит обещания себе (${titles})`
        : `usually keeps self-promises (${titles})`,
    });
  }

  const broken = activePromises.filter(
    (item) => item.stats?.last_checkin_status === "broken" || (item.stats?.broken_count ?? 0) >= 1,
  );
  if (broken.length) {
    const titles = broken
      .slice(0, 2)
      .map((item) => item.title)
      .join(ru ? ", " : ", ");
    patterns.push({
      kind: "broken_promise",
      detail: ru
        ? `бывают срывы обещаний: ${titles}`
        : `self-promises sometimes break: ${titles}`,
    });
  }

  return patterns;
}

const MOOD_ONLY =
  /^(?:я\s+)?(?:сегодня\s+)?(?:просто\s+)?(?:очень\s+)?(?:устал[аи]?|устала|задолбался|задолбалась|не хочется|тяжёл[ыйоая]+ день|плохой день)\.?$/iu;

export function inferImplicitSelfFacts(text: string): CompanionSelfFact[] {
  const t = text.trim();
  if (!t || MOOD_ONLY.test(t)) return [];
  const facts: CompanionSelfFact[] = [];

  if (
    /(?:опять|снова|вечно|как всегда|постоянно)\s+(?:отклад|отлож|перенес|не успел|забыл)/iu.test(t) ||
    /я\s+(?:вечно|всегда|постоянно)\s+откладыва/iu.test(t)
  ) {
    facts.push({
      memory_id: null,
      content: "часто откладываю дела",
      category: "personality",
      occurred_at: null,
    });
  }

  if (
    /(?:^|[^\p{L}])(?:я\s+)?сова(?:[^\p{L}]|$)/iu.test(t) ||
    /лучше\s+(?:работаю|думаю)\s+ночью/iu.test(t)
  ) {
    facts.push({
      memory_id: null,
      content: "я сова, лучше думаю вечером и ночью",
      category: "preference",
      occurred_at: null,
    });
  } else if (
    /(?:^|[^\p{L}])(?:я\s+)?жаворонок(?:[^\p{L}]|$)/iu.test(t) ||
    /лучше\s+(?:работаю|думаю)\s+утром/iu.test(t)
  ) {
    facts.push({
      memory_id: null,
      content: "я жаворонок, лучше думаю утром",
      category: "preference",
      occurred_at: null,
    });
  }

  if (
    /после обеда\s+(?:туплю|не могу|нет сил|выключаюсь)/iu.test(t) ||
    /днём\s+нет сил/iu.test(t)
  ) {
    facts.push({
      memory_id: null,
      content: "после обеда падает энергия",
      category: "preference",
      occurred_at: null,
    });
  }

  if (
    /(?:говори|пиши|отвечай|давай)\s+(?:короче|по делу|без воды|кратко)/iu.test(t) ||
    /мне\s+(?:нужны|нужен|нужно)\s+коротки/iu.test(t) ||
    (/без\s+воды/iu.test(t) && /пожалуйста|давай|говори|пиши/iu.test(t)) ||
    /keep it (?:short|brief)|be (?:short|brief|direct)|no fluff/iu.test(t)
  ) {
    facts.push({
      memory_id: null,
      content: "предпочитаю короткие ответы без воды",
      category: "preference",
      occurred_at: null,
    });
  }

  const unique: CompanionSelfFact[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    const key = normalize(fact.content ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(fact);
  }
  return unique.slice(0, 4);
}

export function inferCommunicationStyle(text: string): string | null {
  if (
    /(?:говори|пиши|отвечай|давай)\s+(?:короче|по делу|без воды|кратко)/iu.test(text) ||
    /мне\s+(?:нужны|нужен|нужно)\s+коротки/iu.test(text) ||
    (/без\s+воды/iu.test(text) && /пожалуйста|давай|говори|пиши/iu.test(text)) ||
    /коротко и по делу/iu.test(text) ||
    /short and practical/iu.test(text)
  ) {
    return /short and practical/iu.test(text) ? "short and direct" : "коротко и по делу";
  }
  if (/разбор(?:ом)? мотив|unpacking of motives/iu.test(text)) {
    return /unpacking of motives/iu.test(text) ? "with more unpacking of motives" : "с разбором мотивов";
  }
  if (/keep it (?:short|brief)|be (?:short|brief|direct)|no fluff/iu.test(text)) {
    return "short and direct";
  }
  return null;
}

export function mergeSelfFacts(...lists: CompanionSelfFact[][]): CompanionSelfFact[] {
  const unique: CompanionSelfFact[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const fact of list) {
      const key = normalize(fact.content ?? "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(fact);
    }
  }
  return unique.slice(0, 8);
}

function clip(text: string, max: number) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trim();
}

const POSITIVE_PATTERN_KINDS = new Set<KnownPatternKind>(["keeps_promises"]);

export function composePortrait(input: {
  bio?: string | null;
  values?: string[];
  memories?: Pick<Memory, "content" | "category">[];
  patterns?: KnownPattern[];
  locale?: string | null;
}): string {
  const ru = languageOf(input.locale) !== "en";
  const parts: string[] = [];
  const bio = input.bio?.trim();
  if (bio) parts.push(clip(bio, 220));
  const values = (input.values ?? []).map((value) => value.trim()).filter(Boolean);
  if (values.length) {
    parts.push(ru ? `Ценности: ${values.slice(0, 8).join(", ")}.` : `Values: ${values.slice(0, 8).join(", ")}.`);
  }
  const patternText = new Set(
    (input.patterns ?? []).map((pattern) => normalize(pattern.detail)),
  );
  // Текст онбординга сохраняется и в bio, и как факт о себе, поэтому портрет
  // склеивал «<био>. Из памяти: <то же био>.» — двойные токены в каждом вызове
  // модели и запутанный контекст. Отбрасываем всё, что уже сказано в био.
  const bioKey = normalize(bio ?? "");
  const memories = (input.memories ?? [])
    .map((memory) => memory.content.trim())
    .filter(Boolean)
    .filter((content) => {
      const key = normalize(content);
      if (bioKey && key.length > 12 && (bioKey.includes(key) || key.includes(bioKey))) return false;
      for (const detail of patternText) {
        if (key.includes(detail.slice(0, 18)) || detail.includes(key.slice(0, 18))) return false;
      }
      return true;
    })
    .slice(0, 8);
  if (memories.length) {
    parts.push(ru ? `Из памяти: ${memories.join("; ")}.` : `From memory: ${memories.join("; ")}.`);
  }
  const patterns = (input.patterns ?? [])
    .filter((pattern) => POSITIVE_PATTERN_KINDS.has(pattern.kind))
    .map((pattern) => pattern.detail)
    .filter(Boolean);
  if (patterns.length) {
    parts.push(ru ? `Как действует: ${patterns.join("; ")}.` : `How they work: ${patterns.join("; ")}.`);
  }
  return clip(parts.join(" "), PORTRAIT_MAX);
}

export async function refreshPortrait(repository: AppRepository, ownerId: string, now = new Date()) {
  const [profile, self, tasks, promises, checkins] = await Promise.all([
    repository.getProfile(ownerId),
    repository.getSelfPerson(ownerId),
    repository.listTasks(ownerId),
    repository.listPromises(ownerId),
    repository.listPromiseCheckins(ownerId),
  ]);
  if (!profile || !self) return null;
  const memories = await repository.listMemories(ownerId, self.id);
  for (const memory of memories.filter(isInferredBehaviorMemory)) {
    await repository.deleteMemory(ownerId, memory.id);
  }
  const timezone = profile.timezone || "Europe/Moscow";
  const patterns = inferBehaviorPatterns({
    tasks,
    promises: promises.map((item) => withPromiseStats(item, checkins, now)),
    timezone,
    now,
    locale: profile.locale,
  });
  const portrait = composePortrait({
    bio: profile.bio,
    values: profile.values,
    memories: visibleSelfMemories(memories).slice(0, 12),
    patterns,
    locale: profile.locale,
  });
  const next = portrait || null;
  if ((profile.context_summary ?? null) === next) return next;
  await repository.updateProfile(ownerId, { context_summary: next });
  return next;
}
