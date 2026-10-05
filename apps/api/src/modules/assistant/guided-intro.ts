import type { AppRepository } from "../../repository.js";
import type { MemoryCategory, Message } from "../../types.js";
import { languageOf } from "../../locale.js";
import type { ExtractedFacts } from "./guided-onboarding.js";
import {
  applyOnboardingSignals,
  ensureActivationGoal,
  finishOnboardingActivation,
  MINI_APP_PENDING_CHAT,
} from "./first-session.js";

export const GUIDED_INTRO_ACTION = "guided_intro";
export { MINI_APP_PENDING_CHAT };
const EXPIRY_HOURS = 24;

export const GUIDED_INTRO_QUESTIONS_RU = [
  "Давай коротко. Чем ты занимаешься и что сейчас для тебя важно?",
  "Какая одна цель на ближайшие недели для тебя главная?",
];

export const GUIDED_INTRO_QUESTIONS_EN = [
  "Let's keep this short. What do you do, and what matters to you right now?",
  "What's the one goal for the next few weeks that actually matters?",
];

const CATEGORIES: MemoryCategory[] = [
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
];

interface IntroPayload {
  step: number;
  facts: string[];
}

function introPayload(raw: Record<string, unknown> | undefined): IntroPayload {
  const step = typeof raw?.step === "number" ? raw.step : 0;
  const facts = Array.isArray(raw?.facts)
    ? raw.facts.filter((item): item is string => typeof item === "string")
    : [];
  return { step, facts };
}

export function guidedIntroQuestions(locale: string | null | undefined) {
  return languageOf(locale) === "en" ? GUIDED_INTRO_QUESTIONS_EN : GUIDED_INTRO_QUESTIONS_RU;
}

function asCategory(value?: string): MemoryCategory {
  return CATEGORIES.includes(value as MemoryCategory) ? (value as MemoryCategory) : "interest";
}

function factWord(count: number, ru: boolean) {
  if (!ru) return count === 1 ? "fact" : "facts";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "факт";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "факта";
  return "фактов";
}

async function persistAssistant(repository: AppRepository, ownerId: string, content: string) {
  const conversation = await repository.getPrimaryConversation(ownerId);
  return repository.createMessage(ownerId, {
    conversation_id: conversation.id,
    telegram_chat_id: null,
    telegram_message_id: null,
    role: "assistant",
    content,
    intent: "companion",
    source_channel: "mini_app",
    metadata: { guided_intro: true },
  });
}

async function persistUser(repository: AppRepository, ownerId: string, content: string) {
  const conversation = await repository.getPrimaryConversation(ownerId);
  return repository.createMessage(ownerId, {
    conversation_id: conversation.id,
    telegram_chat_id: null,
    telegram_message_id: null,
    role: "user",
    content,
    intent: "companion",
    source_channel: "mini_app",
    metadata: { guided_intro: true },
  });
}

export interface GuidedIntroState {
  question: string;
  step: number;
  total: number;
  facts_count: number;
  done: boolean;
  user_message: Message | null;
  assistant_message: Message | null;
}

export async function startOrResumeGuidedIntro(
  repository: AppRepository,
  ownerId: string,
  locale: string | null | undefined,
): Promise<GuidedIntroState> {
  const questions = guidedIntroQuestions(locale);
  const existing = await repository.findActivePendingAction(
    ownerId,
    MINI_APP_PENDING_CHAT,
    GUIDED_INTRO_ACTION,
  );
  const resumed = existing ? introPayload(existing.payload) : { step: 0, facts: [] };
  const step = resumed.step;
  const facts = resumed.facts;
  if (!existing) {
    await repository.createPendingAction(ownerId, {
      telegram_chat_id: MINI_APP_PENDING_CHAT,
      action: GUIDED_INTRO_ACTION,
      payload: { step: 0, facts: [] } satisfies IntroPayload,
      expires_at: new Date(Date.now() + EXPIRY_HOURS * 3600_000).toISOString(),
    });
  }
  const question = questions[step]!;
  const assistant_message = existing
    ? null
    : await persistAssistant(repository, ownerId, question);
  return {
    question,
    step,
    total: questions.length,
    facts_count: facts.length,
    done: false,
    user_message: null,
    assistant_message,
  };
}

export async function continueGuidedIntro(
  repository: AppRepository,
  ownerId: string,
  answer: string,
  locale: string | null | undefined,
  extractFacts: (text: string, locale: string) => Promise<ExtractedFacts>,
): Promise<GuidedIntroState> {
  const questions = guidedIntroQuestions(locale);
  const ru = languageOf(locale) !== "en";
  let pending = await repository.findActivePendingAction(
    ownerId,
    MINI_APP_PENDING_CHAT,
    GUIDED_INTRO_ACTION,
  );
  if (!pending) {
    await startOrResumeGuidedIntro(repository, ownerId, locale);
    pending = await repository.findActivePendingAction(
      ownerId,
      MINI_APP_PENDING_CHAT,
      GUIDED_INTRO_ACTION,
    );
  }
  const payload = introPayload(pending?.payload);
  const user_message = await persistUser(repository, ownerId, answer);

  let extracted: ExtractedFacts;
  try {
    extracted = await extractFacts(answer, ru ? "ru" : "en");
  } catch {
    extracted = { memories: [], goals: [], people: [] };
  }

  const self = await repository.getSelfPerson(ownerId);
  for (const mem of extracted.memories) {
    if (!self || !mem.content.trim()) continue;
    try {
      await repository.createMemory(ownerId, self.id, {
        content: mem.content.trim(),
        category: asCategory(mem.category),
        importance: 4,
        confidence: 0.85,
      });
    } catch {
      // skip duplicates
    }
  }
  for (const goal of extracted.goals) {
    if (!goal.trim()) continue;
    try {
      await repository.createGoal(ownerId, { title: goal.trim(), priority: 4 });
    } catch {
      // skip
    }
  }
  for (const person of extracted.people) {
    if (!person.trim()) continue;
    try {
      await repository.createPerson(ownerId, { name: person.trim(), relationship: "friend" });
    } catch {
      // skip
    }
  }

  await applyOnboardingSignals(repository, ownerId, answer);

  const allFacts = [
    ...payload.facts,
    ...extracted.memories.map((item) => item.content),
    ...extracted.goals,
    ...extracted.people,
  ].filter(Boolean);
  const nextStep = payload.step + 1;
  if (pending) await repository.consumePendingAction(ownerId, pending.id);

  if (nextStep < questions.length) {
    await repository.createPendingAction(ownerId, {
      telegram_chat_id: MINI_APP_PENDING_CHAT,
      action: GUIDED_INTRO_ACTION,
      payload: { step: nextStep, facts: allFacts } satisfies IntroPayload,
      expires_at: new Date(Date.now() + EXPIRY_HOURS * 3600_000).toISOString(),
    });
    const ack = ru
      ? `Запомнил. Илзи знает ${allFacts.length} ${factWord(allFacts.length, true)} о тебе.`
      : `Got it. Ilzi knows ${allFacts.length} ${factWord(allFacts.length, false)} about you.`;
    const question = `${ack}\n\n${questions[nextStep]}`;
    const assistant_message = await persistAssistant(repository, ownerId, question);
    return {
      question,
      step: nextStep,
      total: questions.length,
      facts_count: allFacts.length,
      done: false,
      user_message,
      assistant_message,
    };
  }

  await ensureActivationGoal(
    repository,
    ownerId,
    locale,
    extracted.goals[0] ?? answer.replace(/\s+/g, " ").trim().slice(0, 80),
  );
  const profile = await repository.getProfile(ownerId);
  if (!profile?.onboarding_completed_at) {
    await repository.updateProfile(ownerId, {
      onboarding_completed_at: new Date().toISOString(),
    });
  }
  const finish = await finishOnboardingActivation(repository, ownerId, null, locale);
  const assistant_message = await persistAssistant(repository, ownerId, finish);
  return {
    question: finish,
    step: questions.length,
    total: questions.length,
    facts_count: allFacts.length,
    done: true,
    user_message,
    assistant_message,
  };
}
