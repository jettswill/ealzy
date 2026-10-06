import type { AppRepository } from "../../repository.js";
import type { MemoryCategory, PendingAction } from "../../types.js";
import { languageOf } from "../../locale.js";
import { MEMORY_CATEGORIES } from "./people.js";
import {
  addressFormOf,
  inferAddressForm,
  withAddressForm,
  type AddressForm,
} from "./personal-model.js";
import { trackFunnelEvent } from "../engagement/events.js";
import {
  applyOnboardingSignals,
  cancelBrainDump,
  ensureActivationGoal,
  finishOnboardingActivation,
} from "./first-session.js";

export const GUIDED_ONBOARDING_ACTION = "guided_onboarding";
export const ONBOARDING_MORE_CALLBACK = "onboarding_more";
const EXPIRY_HOURS = 24;

interface OnboardingPayload {
  step: number;
  facts: string[];
  phase?: "core" | "more";
}

// Приветствие не обращается ни на «ты», ни на «вы»: человек выбирает форму
// кнопками под ним, а следующие вопросы идут уже в выбранной. Пока выбора нет —
// на «вы», как и сама Илзи в разговоре.
const GREETING_RU =
  "Привет! Я Илзи.\n\nПомогаю меньше переживать и больше жить: напоминаю и веду дела, помогаю их обсудить, разобрать переживания и помню важное о близких. Задам пару вопросов, чтобы понять контекст — это приватно и конфиденциально. Не хочется сейчас — /skip, вернёмся к этому позже.\n\nКак удобнее общаться — на «ты» или на «вы»? Кнопки под сообщением.\n\nИ сразу первый вопрос, в паре предложений: работа или главное дело сейчас — и что сейчас важнее всего?";

const QUESTIONS_RU = [
  GREETING_RU,
  "Отлично. Какая одна цель на ближайшие недели для тебя главная — к чему идёшь?",
];

const QUESTIONS_RU_FORMAL = [
  GREETING_RU,
  "Отлично. Какая одна цель на ближайшие недели для вас главная — к чему идёте?",
];

const QUESTIONS_EN = [
  "Hi! I'm Ilzi.\n\nI'll help you worry less and live more: reminders, keeping track of things, talking them through with you, working through what's on your mind, and remembering what matters about the people close to you. A couple of questions to learn your context — it stays private and confidential. Not now? Send /skip, we'll come back to it later.\n\nIn a couple of sentences, tell me what you do and what matters to you right now?",
  "Great. What's the one goal for the next few weeks that actually matters — what are you aiming at?",
];

const EXTRA_QUESTIONS_RU = [
  "Какой у тебя ритм: жаворонок или сова? Когда лучше думается, а когда уже не стоит браться за сложное?",
  "Что обычно срывает день: хвосты, чужие встречи, или первое дело так и остаётся невыбранным?",
  "Как тебе удобнее, чтобы я говорила: коротко и по делу, или с разбором мотивов?",
];

const EXTRA_QUESTIONS_RU_FORMAL = [
  "Какой у вас ритм: жаворонок или сова? Когда лучше думается, а когда уже не стоит браться за сложное?",
  "Что обычно срывает день: хвосты, чужие встречи, или первое дело так и остаётся невыбранным?",
  "Как вам удобнее, чтобы я говорила: коротко и по делу, или с разбором мотивов?",
];

const EXTRA_QUESTIONS_EN = [
  "What's your rhythm: early bird or night owl? When do you think best, and when should we stop pushing hard work?",
  "What usually wrecks the day: leftovers, other people's meetings, or not picking the first task yourself?",
  "How should I talk with you: short and practical, or with more unpacking of motives?",
];

function payloadOf(raw: unknown): OnboardingPayload {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const step = typeof row.step === "number" ? row.step : 0;
  const facts = Array.isArray(row.facts)
    ? row.facts.filter((item): item is string => typeof item === "string")
    : [];
  const phase = row.phase === "more" ? "more" : "core";
  return { step, facts, phase };
}

function questionsFor(
  phase: "core" | "more",
  locale: string | null | undefined,
  informal = false,
) {
  const en = languageOf(locale) === "en";
  if (phase === "more") {
    if (en) return EXTRA_QUESTIONS_EN;
    return informal ? EXTRA_QUESTIONS_RU : EXTRA_QUESTIONS_RU_FORMAL;
  }
  if (en) return QUESTIONS_EN;
  return informal ? QUESTIONS_RU : QUESTIONS_RU_FORMAL;
}

async function prefersInformal(repository: AppRepository, ownerId: string) {
  const profile = await repository.getProfile(ownerId);
  return addressFormOf(profile?.communication_style) === "ты";
}

export const ONBOARDING_ADDRESS_CALLBACK = "onboarding_address:";

/** Кнопки «на ты / на вы» под приветствием. В английском выбора нет. */
export function onboardingAddressMarkup(locale: string | null | undefined) {
  if (languageOf(locale) === "en") return null;
  return {
    inline_keyboard: [
      [
        { text: "На «ты»", callback_data: `${ONBOARDING_ADDRESS_CALLBACK}ты` },
        { text: "На «вы»", callback_data: `${ONBOARDING_ADDRESS_CALLBACK}вы` },
      ],
    ],
  };
}

export function parseOnboardingAddress(data: string | null | undefined): AddressForm | null {
  if (!data?.startsWith(ONBOARDING_ADDRESS_CALLBACK)) return null;
  const form = data.slice(ONBOARDING_ADDRESS_CALLBACK.length);
  return form === "ты" || form === "вы" ? form : null;
}

/** Сохраняет выбранное обращение, не трогая остальной стиль общения. */
export async function saveAddressForm(
  repository: AppRepository,
  ownerId: string,
  form: AddressForm,
) {
  const profile = await repository.getProfile(ownerId);
  if (addressFormOf(profile?.communication_style) === form) return;
  await repository.updateProfile(ownerId, {
    communication_style: withAddressForm(profile?.communication_style, form),
  });
}

function firstQuestion(locale: string | null | undefined): string {
  return questionsFor("core", locale)[0] ?? QUESTIONS_RU[0]!;
}

function asMemoryCategory(value?: string): MemoryCategory {
  return MEMORY_CATEGORIES.includes(value as MemoryCategory)
    ? (value as MemoryCategory)
    : "interest";
}

function factWord(count: number, ru: boolean) {
  if (!ru) return count === 1 ? "fact" : "facts";
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "факт";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "факта";
  return "фактов";
}

function goalTitleFromText(text: string) {
  const trimmed = text.replace(/\s+/g, " ").trim().slice(0, 80);
  return trimmed || null;
}

function isGoalStep(phase: "core" | "more", step: number) {
  return phase === "core" && step === 1;
}

export function onboardingReplyMarkup(
  locale: string | null | undefined,
  miniAppUrl: string,
  offerMore: boolean,
) {
  const ru = languageOf(locale) !== "en";
  const rows: Record<string, unknown>[][] = [
    [
      {
        text: ru ? "Открыть сегодня" : "Open today",
        web_app: { url: miniAppUrl },
      },
    ],
  ];
  if (offerMore) {
    rows.push([
      {
        text: ru ? "Ещё 3 вопроса" : "3 more questions",
        callback_data: ONBOARDING_MORE_CALLBACK,
      },
    ]);
  }
  return { inline_keyboard: rows };
}

export async function startGuidedOnboarding(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
  locale: string | null | undefined,
): Promise<string> {
  const existing = await repository.findActivePendingAction(
    ownerId,
    telegramChatId,
    GUIDED_ONBOARDING_ACTION,
  );
  if (existing) {
    const payload = payloadOf(existing.payload);
    const informal = await prefersInformal(repository, ownerId);
    return (
      questionsFor(payload.phase ?? "core", locale, informal)[payload.step] ??
      firstQuestion(locale)
    );
  }

  await repository.createPendingAction(ownerId, {
    telegram_chat_id: telegramChatId,
    action: GUIDED_ONBOARDING_ACTION,
    payload: { step: 0, facts: [], phase: "core" } satisfies OnboardingPayload,
    expires_at: new Date(Date.now() + EXPIRY_HOURS * 3600_000).toISOString(),
  });

  return firstQuestion(locale);
}

export async function startOnboardingMore(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
  locale: string | null | undefined,
): Promise<string> {
  const existing = await repository.findActivePendingAction(
    ownerId,
    telegramChatId,
    GUIDED_ONBOARDING_ACTION,
  );
  if (existing) {
    const payload = payloadOf(existing.payload);
    const qs = questionsFor(
      payload.phase ?? "core",
      locale,
      await prefersInformal(repository, ownerId),
    );
    return qs[payload.step] ?? qs[0] ?? firstQuestion(locale);
  }

  await cancelBrainDump(repository, ownerId, telegramChatId);

  await repository.createPendingAction(ownerId, {
    telegram_chat_id: telegramChatId,
    action: GUIDED_ONBOARDING_ACTION,
    payload: { step: 0, facts: [], phase: "more" } satisfies OnboardingPayload,
    expires_at: new Date(Date.now() + EXPIRY_HOURS * 3600_000).toISOString(),
  });

  return (
    questionsFor("more", locale, await prefersInformal(repository, ownerId))[0] ??
    EXTRA_QUESTIONS_RU_FORMAL[0]!
  );
}

/**
 * Skips the guided onboarding without telling the profile it "completed" — the pending
 * action is cleared so the user isn't stuck, but onboarding_completed_at stays unset,
 * so a later /start naturally offers it again (mirrors the mini-app's skip semantics).
 */
export async function skipGuidedOnboarding(
  repository: AppRepository,
  ownerId: string,
  pending: PendingAction,
  locale: string | null | undefined,
): Promise<string> {
  await repository.consumePendingAction(ownerId, pending.id);
  await trackFunnelEvent(repository, ownerId, "onboarding_skipped", { channel: "telegram" });
  return finishOnboardingActivation(repository, ownerId, pending.telegram_chat_id, locale);
}

export interface OnboardingStepResult {
  reply: string;
  done: boolean;
  offerMore?: boolean;
}

export async function handleOnboardingReply(
  repository: AppRepository,
  ownerId: string,
  pending: PendingAction,
  userText: string,
  locale: string | null | undefined,
  extractFacts: (text: string, locale: string) => Promise<ExtractedFacts>,
): Promise<OnboardingStepResult> {
  const payload = payloadOf(pending.payload);
  const phase = payload.phase ?? "core";
  const step = payload.step;
  const ru = languageOf(locale) !== "en";
  // «…и давай на ты» прямо в ответе на вопрос — тоже выбор обращения.
  const saidForm = ru ? inferAddressForm(userText) : null;
  if (saidForm) {
    try {
      await saveAddressForm(repository, ownerId, saidForm);
    } catch {
      // Обращение не сохранилось — знакомство от этого не останавливается.
    }
  }
  const informal = await prefersInformal(repository, ownerId);
  const qs = questionsFor(phase, locale, informal);

  let extracted: ExtractedFacts;
  try {
    extracted = await extractFacts(userText, ru ? "ru" : "en");
  } catch {
    extracted = { memories: [], goals: [], people: [] };
  }

  for (const mem of extracted.memories) {
    try {
      const self = await repository.getSelfPerson(ownerId);
      if (self) {
        await repository.createMemory(ownerId, self.id, {
          content: mem.content,
          category: asMemoryCategory(mem.category),
          importance: 4,
          confidence: 0.8,
        });
      }
    } catch {
      // Skip duplicates or errors
    }
  }

  for (const goal of extracted.goals) {
    try {
      await repository.createGoal(ownerId, { title: goal, priority: 4 });
    } catch {
      // Skip
    }
  }

  for (const person of extracted.people) {
    try {
      await repository.createPerson(ownerId, { name: person, relationship: "friend" });
    } catch {
      // Skip
    }
  }

  await applyOnboardingSignals(repository, ownerId, userText);

  const ensured =
    isGoalStep(phase, step) || step + 1 >= qs.length
      ? await ensureActivationGoal(repository, ownerId, locale, goalTitleFromText(userText))
      : null;

  const allFacts = [
    ...payload.facts,
    ...extracted.memories.map((m) => m.content),
    ...extracted.goals,
    ...extracted.people,
    ...(ensured ? [ensured.title] : []),
  ].filter(Boolean);

  const nextStep = step + 1;
  await repository.consumePendingAction(ownerId, pending.id);
  await trackFunnelEvent(repository, ownerId, `onboarding_step_${nextStep}`, {
    channel: "telegram",
    phase,
  });

  if (nextStep < qs.length) {
    await repository.createPendingAction(ownerId, {
      telegram_chat_id: pending.telegram_chat_id,
      action: GUIDED_ONBOARDING_ACTION,
      payload: { step: nextStep, facts: allFacts, phase } satisfies OnboardingPayload,
      expires_at: new Date(Date.now() + EXPIRY_HOURS * 3600_000).toISOString(),
    });
    const ack = ru
      ? `Запомнила! (${allFacts.length} ${factWord(allFacts.length, true)} о ${informal ? "тебе" : "вас"})\n\n`
      : `Got it! (${allFacts.length} ${factWord(allFacts.length, false)} about you)\n\n`;
    return { reply: ack + qs[nextStep], done: false };
  }

  if (phase === "core") {
    await repository.updateProfile(ownerId, {
      onboarding_completed_at: new Date().toISOString(),
    });
    await trackFunnelEvent(repository, ownerId, "onboarding_complete", {
      channel: "telegram",
      facts: allFacts.length,
    });
    const finish = await finishOnboardingActivation(
      repository,
      ownerId,
      pending.telegram_chat_id,
      locale,
    );
    return { reply: finish, done: true, offerMore: true };
  }

  const finish = await finishOnboardingActivation(
    repository,
    ownerId,
    pending.telegram_chat_id,
    locale,
  );
  return { reply: finish, done: true, offerMore: false };
}

export interface ExtractedFacts {
  memories: { content: string; category?: string }[];
  goals: string[];
  people: string[];
}
