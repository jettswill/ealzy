import { z } from "zod";
import type { AppRepository } from "../../repository.js";
import type { Memory, MemoryCategory } from "../../types.js";
import { MEMORY_CATEGORIES } from "./people.js";

const emptyToNull = (value: unknown) => (value === "" || value === undefined ? null : value);

export const THESIS_MAX = 180;

export const CompanionSelfFactSchema = z.object({
  memory_id: z.preprocess(emptyToNull, z.string().uuid().nullable().catch(null)),
  content: z.preprocess(emptyToNull, z.string().trim().max(400).nullable()),
  category: z.preprocess(emptyToNull, z.enum(MEMORY_CATEGORIES).nullable().catch(null)),
  occurred_at: z.preprocess(emptyToNull, z.string().trim().max(40).nullable()),
});
export type CompanionSelfFact = z.infer<typeof CompanionSelfFactSchema>;

const TASKISH =
  /сегодня|завтра|на этой неделе|нужно|надо|сдела(ть|ю|ем)|куп(ить|лю)|позвон|запиши дело|создай/iu;
const PERSON_INTRO =
  /у меня есть\s+(?:друг|подруга|брат|сестра|мама|папа|жена|муж|коллега|сын|дочь)\b/iu;
const STOP = new Set(["что", "это", "как", "для", "или", "the", "and", "не", "мне", "я"]);

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function toSelfThesis(content: string) {
  const cleaned = content
    .replace(/^(?:запомни|remember)\s*:?\s*(?:что\s+)?/iu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= THESIS_MAX) return cleaned;
  const cut = cleaned.slice(0, THESIS_MAX);
  const space = cut.lastIndexOf(" ");
  return (space > 80 ? cut.slice(0, space) : cut).trim();
}

function thesisImportance(category: MemoryCategory | null | undefined) {
  if (
    category === "personality" ||
    category === "preference" ||
    category === "dream" ||
    category === "important_fact"
  )
    return 5;
  if (category === "skill" || category === "dislike" || category === "interest") return 4;
  return 3;
}

function pushFact(facts: CompanionSelfFact[], fact: CompanionSelfFact) {
  const content = fact.content?.trim();
  if (!content || TASKISH.test(content)) return;
  facts.push({
    ...fact,
    memory_id: fact.memory_id ?? null,
    content: toSelfThesis(content),
    category: fact.category ?? "important_fact",
  });
}

export function inferCompanionSelfFacts(text: string): CompanionSelfFact[] {
  const t = text.trim();
  if (!t || PERSON_INTRO.test(t)) return [];
  const facts: CompanionSelfFact[] = [];

  const remember = t.match(/^(?:запомни|remember)\s*,?\s*:?\s*(?:что\s+)?я\s+(.+)$/iu);
  if (remember?.[1]) {
    pushFact(facts, {
      memory_id: null,
      content: `я ${remember[1].trim()}`,
      category: "important_fact",
      occurred_at: null,
    });
    return facts.slice(0, 6);
  }

  const like = t.match(
    /(?:^|[^\p{L}])я\s+(не\s+)?(люблю|ненавижу|предпочитаю)\s+([^.!?\n]+)/iu,
  );
  if (like?.[3]) {
    const negated = Boolean(like[1]);
    const verb = normalize(like[2] ?? "");
    const category: MemoryCategory =
      negated || verb.includes("ненавиж")
        ? "dislike"
        : verb.includes("предпочит")
          ? "preference"
          : "interest";
    const prefix =
      category === "dislike" ? "не люблю" : category === "preference" ? "предпочитаю" : "люблю";
    pushFact(facts, {
      memory_id: null,
      content: `${prefix} ${like[3].trim()}`,
      category,
      occurred_at: null,
    });
  }

  const value = t.match(/(?:^|[^\p{L}])мне\s+важно\s+([^.!?\n]+)/iu);
  if (value?.[1]) {
    pushFact(facts, {
      memory_id: null,
      content: `важно ${value[1].trim()}`,
      category: "preference",
      occurred_at: null,
    });
  }

  const setup = t.match(
    /(?:^|[^\p{L}])я\s+(работаю|живу|встаю|лучше думаю|не ем|ем)\s+([^.!?\n]+)/iu,
  );
  if (setup?.[2] && !TASKISH.test(t)) {
    pushFact(facts, {
      memory_id: null,
      content: `я ${setup[1]} ${setup[2].trim()}`,
      category: setup[1] === "лучше думаю" || setup[1] === "встаю" ? "preference" : "important_fact",
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
  return unique.slice(0, 6);
}

function occurredAt(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function thesisTokens(content: string) {
  return normalize(content)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 2 && !STOP.has(token));
}

function thesisSlot(content: string) {
  const text = normalize(content);
  if (/утр|вечер|ноч|полдн/.test(text)) return "daypart";
  if (/работа|офис|удален|из дома/.test(text)) return "work";
  if (/ем |еда|мясо|вегетар|глатен/.test(text)) return "diet";
  if (/энерг|уста|сил/.test(text)) return "energy";
  if (/живу|квартир|город/.test(text)) return "home";
  if (/семь|дет|реб/.test(text)) return "family";
  if (/важно|ценност/.test(text)) return "values";
  if (/отклад|просроч|без даты|postpone|overdue/.test(text)) return "backlog";
  return null;
}

function tokenOverlap(left: string, right: string) {
  const other = new Set(thesisTokens(right));
  return thesisTokens(left).filter((token) => other.has(token)).length;
}

export function findRelatedSelfMemory(
  memories: Memory[],
  fact: { content: string; category: MemoryCategory },
) {
  let best: Memory | null = null;
  let bestScore = 0;
  const slot = thesisSlot(fact.content);
  for (const memory of memories) {
    if (memory.status !== "active") continue;
    const overlap = tokenOverlap(memory.content, fact.content);
    const sameSlot = Boolean(slot && slot === thesisSlot(memory.content));
    const sameCategory = memory.category === fact.category;
    if (overlap < 2 && !(sameSlot && overlap >= 1 && sameCategory)) continue;
    const score = overlap * 2 + (sameCategory ? 1 : 0) + (sameSlot ? 2 : 0);
    if (score > bestScore) {
      best = memory;
      bestScore = score;
    }
  }
  return best;
}

export async function applyCompanionSelfFacts(
  repository: AppRepository,
  ownerId: string,
  facts: CompanionSelfFact[],
  sourceMessageId?: string,
  options?: { source?: string },
) {
  const self = await repository.getSelfPerson(ownerId);
  if (!self) return 0;
  const existing = (await repository.listMemories(ownerId, self.id)).filter(
    (memory) => memory.status === "active",
  );
  const source = options?.source ?? "companion_self";
  // Считаем реально записанное: ответ Илзи про «запомнила» должен опираться
  // на факт записи, а не на намерение записать.
  let written = 0;
  for (const fact of facts) {
    const content = toSelfThesis(fact.content ?? "");
    if (!content) continue;
    const category = fact.category ?? "important_fact";
    const patch = {
      content,
      category,
      source_message_id: sourceMessageId ?? null,
      importance: source === "behavior_inference" ? 3 : thesisImportance(category),
      confidence: source === "behavior_inference" ? 0.7 : 0.85,
      occurred_at: occurredAt(fact.occurred_at),
      metadata: { source },
    };
    const byId = fact.memory_id
      ? existing.find((memory) => memory.id === fact.memory_id)
      : undefined;
    const related = byId ?? findRelatedSelfMemory(existing, { content, category });
    if (related) {
      const keepSource =
        related.metadata?.source === "companion_self" ? "companion_self" : source;
      const updated = await repository.updateMemory(ownerId, related.id, {
        ...patch,
        metadata: { source: keepSource },
      });
      if (updated) {
        Object.assign(related, updated);
        written += 1;
      }
      continue;
    }
    const created = await repository.createMemory(ownerId, self.id, patch);
    existing.push(created.memory);
    written += 1;
  }
  return written;
}

export function formatSelfSaveAnswer(facts: CompanionSelfFact[]) {
  const lines = facts
    .map((fact) => fact.content?.trim())
    .filter((content): content is string => Boolean(content))
    .slice(0, 3);
  if (!lines.length) return "";
  return `Записала в память: ${lines.join("; ")}.`;
}

function overlapScore(content: string, query: string) {
  const hay = normalize(content);
  const tokens = normalize(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 3);
  if (!tokens.length) return 0;
  return tokens.reduce((score, token) => score + (hay.includes(token) ? 1 : 0), 0);
}

export function isInferredBehaviorMemory(memory: Pick<Memory, "metadata">) {
  return memory.metadata?.source === "behavior_inference";
}

export function visibleSelfMemories(memories: Memory[]) {
  return memories.filter(
    (memory) => memory.status === "active" && !isInferredBehaviorMemory(memory),
  );
}

export function selectSelfTheses(memories: Memory[], query: string, limit: number) {
  const active = visibleSelfMemories(memories);
  return [...active]
    .sort((a, b) => {
      const byScore =
        b.importance * 3 +
        overlapScore(`${b.content} ${b.category}`, query) * 4 -
        (a.importance * 3 + overlapScore(`${a.content} ${a.category}`, query) * 4);
      if (byScore) return byScore;
      return b.created_at.localeCompare(a.created_at);
    })
    .slice(0, limit)
    .map((memory) => ({
      ...memory,
      content: toSelfThesis(memory.content),
    }));
}
