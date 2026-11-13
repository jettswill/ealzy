import { z } from "zod";
import type { AppRepository } from "../../repository.js";
import type {
  AssistantIntent,
  Memory,
  MemoryCategory,
  Person,
  RecommendationItem,
  Experience,
  ScheduledNotificationKind,
} from "../../types.js";
import { ExperienceService, type ExtractedExperience } from "./experience.js";
import type { WebResearch, WebResearchContext } from "./web-research.js";
import {
  enrichRecommendationItems,
  generalIdeas,
  type RawRecommendationItem,
} from "./recommendations.js";
import { eventBundleLabels, parseOrganizeEventRequest, type EventKind } from "./organize-event.js";
import { resolvePerson } from "./people.js";

export { parseOrganizeEventRequest, eventBundleLabels } from "./organize-event.js";

export {
  CompanionService,
  PersonalContextBuilder,
  ReflectionService,
  applyCompanionTaskActions,
  omitEalzyQueueMutations,
  omitUnsolicitedPromiseCaptures,
  omitAgendaMutations,
  conversationTurns,
  failedCompanionRetryTarget,
  focusedSearchQuery,
  formatCompanionAnswer,
  formatCompanionTelegramText,
  inferCompanionTaskActions,
  mergeCompanionTaskActions,
  isAiUnavailableAssistant,
  toCompanionWorkspace,
} from "./companion.js";
export { extractStreamingAnswer } from "./companion-stream.js";
export {
  applyCompanionSettings,
  inferCompanionSettings,
  workspaceSettings,
} from "./settings.js";
export {
  composePortrait,
  inferBehaviorPatterns,
  inferCommunicationStyle,
  inferImplicitSelfFacts,
  mergeSelfFacts,
  refreshPortrait,
} from "./personal-model.js";
export {
  computeReliability,
  RELIABILITY_ACHIEVEMENTS,
  summarizeAchievementHolders,
  type AchievementCommunity,
  type ReliabilityStats,
} from "./reliability.js";
export { isInferredBehaviorMemory, visibleSelfMemories } from "./self-context.js";
export {
  applyBrainDump,
  BRAIN_DUMP_ACTION,
  composeFirstMove,
  finishOnboardingActivation,
  handleBrainDumpReply,
  parseBrainDump,
} from "./first-session.js";
export { ScheduledMessageService } from "./scheduled-messages.js";
export { AiWorkService } from "./ai-work.js";
export { NoteActionService } from "./note-actions.js";
export {
  AI_WORK_MAX_ATTEMPTS,
  AI_WORK_STALE_MS,
  aiWorkInstruction,
  pickNextAiWork,
} from "./ai-work-queue.js";
export {
  CAPABILITY_HINTS,
  DATE_PREP_DAYS,
  datePrepOffers,
  inferDiscoveryIntent,
  upcomingImportantDates,
  type DiscoveryClient,
  type DiscoveryHit,
} from "./discovery.js";
export { ExperienceService, extractExperience } from "./experience.js";
export {
  createDayClosePending,
  createExperienceFollowUpPending,
  createExperienceParticipantDisambiguation,
  createGoalCheckInPending,
  createMailSendPending,
  createPersonDisambiguation,
  dayCloseActionKeyboard,
  dayCloseCallbackData,
  dayCloseDiscussInstruction,
  dayCloseListKeyboard,
  dayCloseMenuPrompt,
  goalCheckInCallbackData,
  mailSendCallbackData,
  parseDayCloseCallback,
  parseGoalCheckInCallback,
  parseMailSendCallback,
  parsePendingCallback,
  pendingCallbackData,
  resumeDayClose,
  resumeGoalCheckIn,
  resumeMailSend,
  resumePendingAction,
  completeExperienceFollowUpPending,
} from "./pending-actions.js";
export {
  applyGoalActions,
  applyGoalPlan,
  archiveGoalLinkedWork,
  explicitGoalWriteIntent,
  continuedGoalWriteIntent,
  shouldReplaceGoalTitle,
  goalRefineIntent,
  focusedGoalFromText,
  goalPlanInstruction,
  goalSyncInstruction,
  goalSyncAllowsCreate,
  isGoalSyncTurn,
  pickGoalCheckIn,
} from "./goal-plan.js";
export { enrichRecommendationItems, generalIdeas } from "./recommendations.js";
export {
  applyCompanionPersonFacts,
  inferCompanionPersonFacts,
  personMentionedIn,
  personNameKeys,
  resolvePerson,
} from "./people.js";
export {
  applyCompanionSelfFacts,
  inferCompanionSelfFacts,
  selectSelfTheses,
  toSelfThesis,
  findRelatedSelfMemory,
} from "./self-context.js";

export const AssistantDecisionSchema = z.object({
  intent: z.enum([
    "remember",
    "recommend",
    "create_task",
    "create_space",
    "create_goal",
    "create_project",
    "query_memory",
    "organize_event",
    "other",
  ]),
  person_query: z.string().min(1).nullable(),
  content: z.string().min(1).nullable(),
  category: z
    .enum([
      "interest",
      "dislike",
      "favorite_place",
      "favorite_food",
      "gift",
      "size",
      "dream",
      "important_date",
      "story",
      "personality",
      "experience",
      "preference",
      "skill",
      "important_event",
      "important_fact",
      "other",
    ])
    .nullable(),
  importance: z.number().int().min(1).max(5).optional().default(3),
  confidence: z.number().min(0).max(1).optional().default(0.8),
  occurred_at: z.string().datetime().nullable().optional().default(null),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
  title: z.string().min(1).nullable(),
  space_name: z.string().min(1).nullable(),
});
export type AssistantDecision = z.infer<typeof AssistantDecisionSchema>;

export const RecommendationItemsSchema = z
  .array(
    z
      .object({
        title: z.string().min(1).max(200),
        rationale: z.string().min(1).max(600),
        memory_ids: z.array(z.string().uuid()).max(10).optional().default([]),
        experience_ids: z.array(z.string().uuid()).max(10).optional().default([]),
        is_generic: z.boolean().optional().default(false),
      })
      .strict(),
  )
  .min(3)
  .max(5);

export interface AssistantHandleResult {
  text: string;
  intent: AssistantIntent;
  disambiguation?: {
    decision?: AssistantDecision;
    candidates: Pick<Person, "id" | "name">[];
    kind?: "resolve_person" | "resolve_experience_participant";
    experience?: ExtractedExperience;
    sourceMessageId?: string;
  };
}

export interface AiProvider {
  decide(text: string): Promise<unknown>;
  recommend(
    query: string,
    person: Person | null,
    memories: { id: string; content: string; category: string }[],
    context?: {
      experiences: { id: string; title: string; positive_signals: string[] }[];
      feedback: unknown[];
    },
  ): Promise<unknown>;
  companion?(query: string, context: unknown): Promise<unknown>;
  companionStream?(
    query: string,
    context: unknown,
    onAnswerDelta?: (answer: string) => void,
  ): Promise<unknown>;
  research?(query: string, context: WebResearchContext): Promise<WebResearch | null>;
  reflect?(snapshot: Record<string, unknown>): Promise<unknown>;
  extractExperience?(text: string, currentTime: string): Promise<unknown>;
  digest?(kind: ScheduledNotificationKind, snapshot: Record<string, unknown>): Promise<unknown>;
  transcribe?(file: { bytes: Uint8Array; filename: string; mime: string }): Promise<string | null>;
  previewNoteAction?(
    note: { title: string; content: Record<string, unknown>; plain_text: string; revision: number },
    instruction: string,
  ): Promise<unknown>;
  extractOnboardingFacts?(
    text: string,
    locale: string,
  ): Promise<{ memories: { content: string; category?: string }[]; goals: string[]; people: string[] }>;
}

const textFromDecision = (decision: AssistantDecision) =>
  decision.content ?? decision.title ?? decision.person_query ?? "";
export function fallbackDecision(text: string): AssistantDecision {
  const t = text.trim();
  const possessive = t.match(/^у\s+([\p{L}-]+)\s+(.+)$/iu);
  if (possessive) {
    const content = possessive[2]!;
    const normalized = content.toLocaleLowerCase();
    const category: MemoryCategory = normalized.includes("не любит")
      ? "dislike"
      : normalized.includes("любит")
        ? "interest"
        : normalized.includes("мечта") || normalized.includes("хочет")
          ? "dream"
          : normalized.includes("размер")
            ? "size"
            : "important_fact";
    return {
      intent: "remember",
      person_query: possessive[1]!,
      content,
      category,
      importance: 3,
      confidence: 0.9,
      occurred_at: null,
      metadata: {},
      title: null,
      space_name: null,
    };
  }
  const remember = t.match(/^(?:запомни|remember)\s*:?\s*(?:что\s+)?(.+)$/iu);
  if (remember) {
    const body = remember[1]!;
    const match = body.match(
      /^(.+?)\s+(любит|не любит|мечтает о|хочет|носит размер|размер|была? в|был в)\s+(.+)$/iu,
    );
    const marker = match?.[2]?.toLocaleLowerCase() ?? "";
    const category: MemoryCategory =
      marker === "любит"
        ? "interest"
        : marker === "не любит"
          ? "dislike"
          : marker.includes("мечта") || marker === "хочет"
            ? "dream"
            : marker.includes("размер")
              ? "size"
              : marker.includes("был")
                ? "experience"
                : "important_fact";
    return {
      intent: "remember",
      person_query: match?.[1]?.trim() ?? null,
      content: match ? `${match[2]} ${match[3]}` : body,
      category,
      importance: 3,
      confidence: 0.9,
      occurred_at: null,
      metadata: {},
      title: null,
      space_name: null,
    };
  }
  const goal = t.match(/^(?:создай цель|цель|goal)\s*:?\s*(.+)$/iu);
  if (goal)
    return {
      intent: "create_goal",
      person_query: null,
      content: null,
      category: null,
      importance: 3,
      confidence: 0.8,
      occurred_at: null,
      metadata: {},
      title: goal[1]!,
      space_name: null,
    };
  const project = t.match(/^(?:создай проект|проект|project)\s*:?\s*(.+)$/iu);
  if (project)
    return {
      intent: "create_project",
      person_query: null,
      content: null,
      category: null,
      importance: 3,
      confidence: 0.8,
      occurred_at: null,
      metadata: {},
      title: project[1]!,
      space_name: null,
    };
  if (/^(?:нужно|надо|задача|создай задачу|task)\b/iu.test(t))
    return {
      intent: "create_task",
      person_query: t.match(/(?:для|подарок)\s+([\p{L}-]+)/iu)?.[1] ?? null,
      content: null,
      category: null,
      importance: 3,
      confidence: 0.8,
      occurred_at: null,
      metadata: {},
      title: t.replace(/^(?:создай задачу|задача)\s*:?\s*/iu, ""),
      space_name: null,
    };
  const organize = parseOrganizeEventRequest(t);
  if (organize)
    return {
      intent: "organize_event",
      person_query: organize.person_query,
      content: t,
      category: null,
      importance: 4,
      confidence: 0.85,
      occurred_at: null,
      metadata: { event_kind: organize.event_kind },
      title: null,
      space_name: null,
    };
  if (/(?:хочу удивить|куда (?:сходить|пойти)|иде[яи]|recommend|подар)/iu.test(t)) {
    const person = t.match(/(?:удивить|с|для|подарок)\s+([\p{L}-]+)/iu)?.[1] ?? null;
    return {
      intent: "recommend",
      person_query: person,
      content: t,
      category: null,
      importance: 3,
      confidence: 0.8,
      occurred_at: null,
      metadata: {},
      title: null,
      space_name: null,
    };
  }
  const space = t.match(/^(?:создай пространство|create space)\s+(.+)$/iu);
  if (space) {
    const parts = space[1]!.match(/^(.+?)\s+с\s+([\p{L}-]+)$/iu);
    return {
      intent: "create_space",
      person_query: parts?.[2] ?? null,
      content: null,
      category: null,
      importance: 3,
      confidence: 0.8,
      occurred_at: null,
      metadata: {},
      title: null,
      space_name: (parts?.[1] ?? space[1]!).trim(),
    };
  }
  const query = t.match(/^(?:что (?:любит|не любит|знаешь о)|покажи память)\s+([\p{L}-]+)/iu);
  if (query)
    return {
      intent: "query_memory",
      person_query: query[1]!,
      content: t,
      category: null,
      importance: 3,
      confidence: 0.8,
      occurred_at: null,
      metadata: {},
      title: null,
      space_name: null,
    };
  return {
    intent: "other",
    person_query: null,
    content: t,
    category: null,
    importance: 3,
    confidence: 0.8,
    occurred_at: null,
    metadata: {},
    title: null,
    space_name: null,
  };
}

export class AssistantOrchestrator {
  readonly experiences: ExperienceService;
  constructor(
    private readonly repository: AppRepository,
    private readonly ai?: AiProvider,
  ) {
    this.experiences = new ExperienceService(repository, ai);
  }
  async decide(text: string) {
    if (this.ai) {
      try {
        return AssistantDecisionSchema.parse(await this.ai.decide(text));
      } catch {
        /* deterministic fallback */
      }
    }
    return fallbackDecision(text);
  }
  async handle(
    ownerId: string,
    text: string,
    sourceMessageId?: string,
  ): Promise<AssistantHandleResult> {
    if (sourceMessageId) {
      const captured = await this.experiences.capture(ownerId, text, sourceMessageId);
      if (captured && "disambiguation" in captured)
        return {
          intent: "experience",
          text: captured.text,
          disambiguation: {
            kind: "resolve_experience_participant",
            candidates: captured.disambiguation.candidates,
            experience: captured.disambiguation.extracted,
            sourceMessageId: captured.disambiguation.sourceMessageId,
          },
        };
      if (captured) return { intent: "experience", text: captured.text };
    }
    const decision = await this.decide(text);
    return this.executeDecision(ownerId, decision, text, sourceMessageId);
  }

  async resumeWithPerson(
    ownerId: string,
    decision: AssistantDecision,
    personId: string,
    sourceMessageId?: string,
  ): Promise<AssistantHandleResult> {
    const person = await this.repository.getPerson(ownerId, personId);
    if (!person) return { intent: decision.intent, text: "Не нашёл выбранного человека." };
    return this.executeDecision(
      ownerId,
      { ...decision, person_query: person.name },
      textFromDecision(decision),
      sourceMessageId,
      person,
    );
  }

  private async buildRecommendationItems(
    ownerId: string,
    text: string,
    person: Person | null,
    memories: Memory[],
    experiences: Experience[],
  ): Promise<RecommendationItem[]> {
    let rawItems: RawRecommendationItem[] = generalIdeas().map((item) => ({
      title: item.title,
      rationale: item.rationale,
      is_generic: true,
    }));
    if (this.ai) {
      try {
        rawItems = RecommendationItemsSchema.parse(
          await this.ai.recommend(
            text,
            person,
            memories.map((memory) => ({
              id: memory.id,
              content: memory.content,
              category: memory.category,
            })),
            {
              experiences: experiences.map((experience) => ({
                id: experience.id,
                title: experience.title,
                positive_signals: experience.positive_signals,
              })),
              feedback: await this.repository.listRecommendationFeedback(ownerId, 8),
            },
          ),
        );
      } catch {
        /* honest fallback */
      }
    }
    return enrichRecommendationItems(rawItems, memories, experiences);
  }

  private async organizeEvent(
    ownerId: string,
    decision: AssistantDecision,
    text: string,
    _sourceMessageId?: string,
    forcedPerson?: Person,
  ): Promise<AssistantHandleResult> {
    if (!decision.person_query && !forcedPerson)
      return {
        intent: "organize_event",
        text: "Для кого организуем? Например: «Помоги организовать день рождения мамы».",
      };

    const person =
      forcedPerson ??
      (await (async () => {
        const resolved = await resolvePerson(this.repository, ownerId, decision.person_query!);
        if (resolved.status === "not_found") {
          return this.repository.createPerson(ownerId, { name: decision.person_query! });
        }
        if (resolved.status === "ambiguous") return { ambiguous: resolved.people } as const;
        return resolved.person;
      })());

    if (typeof person === "object" && "ambiguous" in person)
      return {
        intent: "organize_event",
        text: "Выберите человека:",
        disambiguation: { decision, candidates: person.ambiguous, kind: "resolve_person" },
      };

    const eventKind = (decision.metadata.event_kind as EventKind | undefined) ?? "birthday";
    const labels = eventBundleLabels(eventKind, person.name);
    const space = await this.repository.createSpace(ownerId, {
      name: decision.space_name ?? labels.spaceName,
      type: "event",
      context: text,
      person_ids: [person.id],
    });
    const task = await this.repository.createTask(ownerId, {
      title: decision.title ?? labels.taskTitle,
      person_id: person.id,
      space_id: space.id,
    });
    const memories = (await this.repository.listMemories(ownerId, person.id)).filter(
      (memory) => memory.status === "active",
    );
    const experiences = await this.repository.listExperiences(ownerId, person.id);
    const items = await this.buildRecommendationItems(
      ownerId,
      labels.recommendQuery,
      person,
      memories,
      experiences,
    );
    const saved = await this.repository.createRecommendation(ownerId, {
      person_id: person.id,
      space_id: space.id,
      task_id: task.id,
      query: text,
      items,
      memory_ids: memories.map((memory) => memory.id),
      experience_ids: experiences.map((experience) => experience.id),
    });
    if (memories.length || experiences.length)
      await this.repository.trackBetaMetric(ownerId, "personal_recommendation", {
        recommendation_id: saved.id,
      });
    return {
      intent: "organize_event",
      text: [
        `Собрал план для ${person.name}:`,
        `• Пространство: ${space.name}`,
        `• Задача: ${task.title}`,
        items.map((item, index) => `${index + 1}. ${item.title} — ${item.rationale}`).join("\n"),
        `Рекомендация ${saved.id}`,
      ].join("\n"),
    };
  }

  private async executeDecision(
    ownerId: string,
    decision: AssistantDecision,
    text: string,
    sourceMessageId?: string,
    forcedPerson?: Person,
  ): Promise<AssistantHandleResult> {
    if (decision.intent === "remember") {
      if (!decision.person_query || !decision.content || !decision.category)
        return {
          intent: "remember",
          text: "Уточните факт: «Запомни: мне важно ложиться до 23:30».",
        };
      if (forcedPerson) {
        const result = await this.repository.createMemory(ownerId, forcedPerson.id, {
          content: decision.content,
          category: decision.category,
          source_message_id: sourceMessageId ?? null,
          importance: decision.importance,
          confidence: decision.confidence,
          occurred_at: decision.occurred_at,
          metadata: decision.metadata,
        });
        return {
          intent: "remember",
          text: result.duplicate
            ? "Этот факт уже сохранён."
            : `Запомнил для ${forcedPerson.name}: ${decision.content}.`,
        };
      }
      const resolved = await resolvePerson(this.repository, ownerId, decision.person_query);
      if (resolved.status === "not_found") {
        const person = await this.repository.createPerson(ownerId, { name: decision.person_query });
        const result = await this.repository.createMemory(ownerId, person.id, {
          content: decision.content,
          category: decision.category,
          source_message_id: sourceMessageId ?? null,
          importance: decision.importance,
          confidence: decision.confidence,
          occurred_at: decision.occurred_at,
          metadata: decision.metadata,
        });
        return {
          intent: "remember",
          text: result.duplicate
            ? "Этот факт уже сохранён."
            : `Создал профиль ${person.name} и запомнил: ${result.memory.content}.`,
        };
      }
      if (resolved.status === "ambiguous")
        return {
          intent: "remember",
          text: "Выберите человека:",
          disambiguation: { decision, candidates: resolved.people, kind: "resolve_person" },
        };
      const result = await this.repository.createMemory(ownerId, resolved.person.id, {
        content: decision.content,
        category: decision.category,
        source_message_id: sourceMessageId ?? null,
        importance: decision.importance,
        confidence: decision.confidence,
        occurred_at: decision.occurred_at,
        metadata: decision.metadata,
      });
      return {
        intent: "remember",
        text: result.duplicate
          ? "Этот факт уже сохранён."
          : `Запомнил для ${resolved.person.name}: ${decision.content}.`,
      };
    }
    if (decision.intent === "recommend") {
      const resolved = forcedPerson
        ? { status: "unique" as const, person: forcedPerson }
        : decision.person_query
          ? await resolvePerson(this.repository, ownerId, decision.person_query)
          : null;
      if (resolved?.status === "ambiguous")
        return {
          intent: "recommend",
          text: "Выберите человека:",
          disambiguation: { decision, candidates: resolved.people, kind: "resolve_person" },
        };
      if (resolved?.status === "not_found")
        return { intent: "recommend", text: `Не нашёл профиль «${decision.person_query}».` };
      const person = resolved?.status === "unique" ? resolved.person : null;
      const memories = person
        ? (await this.repository.listMemories(ownerId, person.id)).filter(
            (m) => m.status === "active",
          )
        : [];
      const experiences = await this.repository.listExperiences(ownerId, person?.id);
      const items = await this.buildRecommendationItems(
        ownerId,
        text,
        person,
        memories,
        experiences,
      );
      const saved = await this.repository.createRecommendation(ownerId, {
        person_id: person?.id,
        query: text,
        items,
        memory_ids: memories.map((m) => m.id),
        experience_ids: experiences.map((experience) => experience.id),
      });
      if (person && (memories.length || experiences.length))
        await this.repository.trackBetaMetric(ownerId, "personal_recommendation", {
          recommendation_id: saved.id,
        });
      return {
        intent: "recommend",
        text: `${items.map((x, i) => `${i + 1}. ${x.title} — ${x.rationale}`).join("\n")}\n\nРекомендация ${saved.id}`,
      };
    }
    if (decision.intent === "create_task" && decision.title) {
      const resolved = decision.person_query
        ? await resolvePerson(this.repository, ownerId, decision.person_query)
        : null;
      const task = await this.repository.createTask(ownerId, {
        title: decision.title,
        person_id: resolved?.status === "unique" ? resolved.person.id : null,
      });
      if (resolved?.status === "unique") {
        const memories = (await this.repository.listMemories(ownerId, resolved.person.id)).filter(
          (m) => m.status === "active",
        );
        const experiences = await this.repository.listExperiences(ownerId, resolved.person.id);
        const items = await this.buildRecommendationItems(
          ownerId,
          text,
          resolved.person,
          memories,
          experiences,
        );
        const saved = await this.repository.createRecommendation(ownerId, {
          person_id: resolved.person.id,
          task_id: task.id,
          query: text,
          items,
          memory_ids: memories.map((m) => m.id),
          experience_ids: experiences.map((experience) => experience.id),
        });
        if (memories.length || experiences.length)
          await this.repository.trackBetaMetric(ownerId, "personal_recommendation", {
            recommendation_id: saved.id,
          });
        return {
          intent: "create_task",
          text: `Задача создана: ${task.title}.\n${items.map((x, i) => `${i + 1}. ${x.title} — ${x.rationale}`).join("\n")}`,
        };
      }
      return { intent: "create_task", text: `Задача создана: ${task.title}.` };
    }
    if (decision.intent === "organize_event") {
      return this.organizeEvent(ownerId, decision, text, sourceMessageId, forcedPerson);
    }
    if (decision.intent === "create_goal" && decision.title) {
      const goal = await this.repository.createGoal(ownerId, { title: decision.title });
      return { intent: "create_goal", text: `Цель создана: ${goal.title}.` };
    }
    if (decision.intent === "create_project" && decision.title) {
      const project = await this.repository.createProject(ownerId, { name: decision.title });
      return { intent: "create_project", text: `Проект создан: ${project.name}.` };
    }
    if (decision.intent === "create_space" && decision.space_name) {
      const space = await this.repository.createSpace(ownerId, { name: decision.space_name });
      if (decision.person_query) {
        const resolved = await resolvePerson(this.repository, ownerId, decision.person_query);
        if (resolved.status === "unique") {
          await this.repository.setSpacePerson(ownerId, space.id, resolved.person.id, true);
          return {
            intent: "create_space",
            text: `Пространство создано: ${space.name}. Добавил ${resolved.person.name}.`,
          };
        }
      }
      return { intent: "create_space", text: `Пространство создано: ${space.name}.` };
    }
    if (decision.intent === "query_memory" && decision.person_query) {
      if (forcedPerson) {
        const memories = (await this.repository.listMemories(ownerId, forcedPerson.id)).filter(
          (m) => m.status === "active",
        );
        return {
          intent: "query_memory",
          text: memories.length
            ? memories.map((m) => `• ${m.content}`).join("\n")
            : `Для ${forcedPerson.name} пока нет сохранённых фактов.`,
        };
      }
      const resolved = await resolvePerson(this.repository, ownerId, decision.person_query);
      if (resolved.status === "ambiguous")
        return {
          intent: "query_memory",
          text: "Выберите человека:",
          disambiguation: { decision, candidates: resolved.people, kind: "resolve_person" },
        };
      if (resolved.status !== "unique")
        return {
          intent: "query_memory",
          text: `Не нашёл профиль «${decision.person_query}».`,
        };
      const memories = (await this.repository.listMemories(ownerId, resolved.person.id)).filter(
        (m) => m.status === "active",
      );
      return {
        intent: "query_memory",
        text: memories.length
          ? memories.map((m) => `• ${m.content}`).join("\n")
          : `Для ${resolved.person.name} пока нет сохранённых фактов.`,
      };
    }
    return {
      intent: decision.intent,
      text: "Я могу запоминать факты, предлагать идеи, создавать задачи и пространства.",
    };
  }
}
