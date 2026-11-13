import OpenAI, { toFile } from "openai";
import type { AiProvider } from "../modules/assistant/index.js";
import { companionSystemPrompt } from "../modules/assistant/companion-prompt.js";
import { extractStreamingAnswer } from "../modules/assistant/companion-stream.js";
import {
  dedupeSources,
  stripInlineLinks,
  type WebResearch,
  type WebResearchContext,
} from "../modules/assistant/web-research.js";
import {
  metricForSchema,
  tokensFromCompletionUsage,
  tokensFromTranscriptionUsage,
  type AiTokenUsage,
} from "../modules/billing/usage.js";

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "person_query",
    "content",
    "category",
    "importance",
    "confidence",
    "occurred_at",
    "metadata",
    "title",
    "space_name",
  ],
  properties: {
    intent: {
      enum: [
        "remember",
        "recommend",
        "create_task",
        "create_space",
        "create_goal",
        "create_project",
        "query_memory",
        "organize_event",
        "other",
      ],
    },
    person_query: { type: ["string", "null"] },
    content: { type: ["string", "null"] },
    category: {
      enum: [
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
        null,
      ],
    },
    importance: { type: "integer", minimum: 1, maximum: 5 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    occurred_at: { type: ["string", "null"] },
    metadata: {
      type: "object",
      additionalProperties: false,
      required: ["event_kind", "notes"],
      properties: {
        event_kind: { enum: ["birthday", "celebration", null] },
        notes: { type: ["string", "null"] },
      },
    },
    title: { type: ["string", "null"] },
    space_name: { type: ["string", "null"] },
  },
};
const reflectionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["wins", "improvements", "next_steps"],
  properties: {
    wins: { type: "array", maxItems: 8, items: { type: "string" } },
    improvements: { type: "array", maxItems: 8, items: { type: "string" } },
    next_steps: { type: "array", maxItems: 8, items: { type: "string" } },
  },
};
const experienceExtractionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["experience"],
  properties: {
    experience: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: [
            "type",
            "title",
            "place",
            "participant_query",
            "positive_signals",
            "negative_signals",
            "emotions",
            "occurred_at",
          ],
          properties: {
            type: {
              enum: ["restaurant", "theater", "trip", "event", "gift", "activity", "other"],
            },
            title: { type: "string" },
            place: { type: ["string", "null"] },
            participant_query: { type: ["string", "null"] },
            positive_signals: { type: "array", maxItems: 20, items: { type: "string" } },
            negative_signals: { type: "array", maxItems: 20, items: { type: "string" } },
            emotions: { type: "array", maxItems: 20, items: { type: "string" } },
            occurred_at: { type: ["string", "null"] },
          },
        },
        { type: "null" },
      ],
    },
  },
};
const recommendationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "rationale", "memory_ids", "experience_ids", "is_generic"],
        properties: {
          title: { type: "string" },
          rationale: { type: "string" },
          memory_ids: { type: "array", items: { type: "string" } },
          experience_ids: { type: "array", items: { type: "string" } },
          is_generic: { type: "boolean" },
        },
      },
    },
  },
};

const onboardingExtractSchema = {
  type: "object",
  additionalProperties: false,
  required: ["memories", "goals", "people"],
  properties: {
    memories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["content"],
        properties: {
          content: { type: "string" },
          category: { type: "string" },
        },
      },
    },
    goals: { type: "array", items: { type: "string" } },
    people: { type: "array", items: { type: "string" } },
  },
};

const digestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    text: { type: "string" },
  },
};
const noteActionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "goal", "title", "description", "current_plan", "tasks"],
  properties: {
    kind: { enum: ["goal", "tasks", "plan"] },
    goal: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["title", "description"],
          properties: {
            title: { type: "string" },
            description: { type: ["string", "null"] },
          },
        },
        { type: "null" },
      ],
    },
    title: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    current_plan: { type: ["string", "null"] },
    tasks: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "due_at"],
        properties: {
          title: { type: "string" },
          description: { type: ["string", "null"] },
          due_at: { type: ["string", "null"] },
        },
      },
    },
  },
};

export function compactCompanionWorkspace(workspace: unknown) {
  if (!workspace || typeof workspace !== "object") return workspace ?? {};
  const row = { ...(workspace as Record<string, unknown>) };
  delete row.capabilities;
  if (Array.isArray(row.discovery_results) && row.discovery_results.length === 0) {
    delete row.discovery_results;
  }
  const mail = row.mail;
  if (mail && typeof mail === "object") {
    const sections = mail as Record<string, unknown>;
    const empty = ["accounts", "important", "meetings", "drafts", "playbooks"].every(
      (key) => !Array.isArray(sections[key]) || (sections[key] as unknown[]).length === 0,
    );
    if (empty) delete row.mail;
  }
  return row;
}

export function companionPayload(context: unknown) {
  const empty = {
    workspace: {} as unknown,
    conversation: [] as { role: "user" | "assistant"; content: string }[],
  };
  if (!context || typeof context !== "object") return empty;
  const row = context as {
    workspace?: unknown;
    conversation?: { role?: unknown; content?: unknown }[];
  };
  const rawWorkspace =
    "workspace" in row || "conversation" in row ? (row.workspace ?? {}) : context;
  const conversation = (row.conversation ?? [])
    .filter(
      (turn): turn is { role: "user" | "assistant"; content: string } =>
        (turn.role === "user" || turn.role === "assistant") &&
        typeof turn.content === "string" &&
        turn.content.trim().length > 0,
    )
    .slice(-COMPANION_CONVERSATION_TURNS)
    .map((turn) => ({
      role: turn.role,
      content:
        turn.content.length > COMPANION_CONVERSATION_CHARS
          ? `${turn.content.slice(0, COMPANION_CONVERSATION_CHARS)}…`
          : turn.content,
    }));
  return { workspace: compactCompanionWorkspace(rawWorkspace), conversation };
}

function overflowHint(workspace: unknown): string | null {
  if (!workspace || typeof workspace !== "object") return null;
  const overflow = (workspace as { overflow?: unknown }).overflow;
  if (!overflow || typeof overflow !== "object") return null;
  const extraTasks = Number((overflow as { extra_tasks?: unknown }).extra_tasks ?? 0);
  const extraOverdue = Number((overflow as { extra_overdue?: unknown }).extra_overdue ?? 0);
  if (extraTasks <= 0 && extraOverdue <= 0) return null;
  return `The visible task list is truncated: ${extraTasks} more open tasks and ${extraOverdue} more overdue are not listed (workspace.overflow). If this turn is about tasks, load, plan, agenda or priorities, you MUST mention that leftover volume and not treat the listed tasks as the complete load. If the turn is about something else, do not mention tasks or overdue work at all.`;
}

export const FAST_AI_TIMEOUT_MS = 12_000;
export const COMPANION_AI_TIMEOUT_MS = 20_000;
export const WEB_RESEARCH_TIMEOUT_MS = 25_000;
const WEB_QUERY_MODEL = "openai/gpt-4.1-mini";
export const COMPANION_AI_MAX_TOKENS = 1_800;
export const COMPANION_AI_TEMPERATURE = 0.6;
export const COMPANION_CONVERSATION_TURNS = 12;
export const COMPANION_CONVERSATION_CHARS = 1_200;

type ChatControls = {
  temperature?: number;
  reasoning_effort?: "none" | "minimal" | "low";
  max_tokens?: number;
  max_completion_tokens?: number;
};

export function usesSamplingTemperature(model: string): boolean {
  const id = model.replace(/^~/, "").toLowerCase();
  return !/(?:^|\/)(?:gpt-(?:5|6)|o[1-4](?:-|$)|gpt-chat-latest)/.test(id);
}

export function usesReasoningEffort(model: string): boolean {
  const id = model.replace(/^~/, "").toLowerCase();
  if (id.includes("-chat")) return false;
  return /(?:^|\/)(?:gpt-(?:5|6)|o[1-4](?:-|$))/.test(id);
}

export function requiresReasoning(model: string): boolean {
  const id = model.replace(/^~/, "").toLowerCase();
  return /(?:^|\/)gpt-6/.test(id);
}

export function chatCompletionControls(
  model: string,
  options: {
    maxTokens?: number;
    temperature?: number;
    reasoningEffort?: "none" | "minimal" | "low";
  } = {},
): ChatControls {
  const controls: ChatControls = {};
  if (usesSamplingTemperature(model)) controls.temperature = options.temperature ?? 0;
  if (usesReasoningEffort(model)) {
    const effort = options.reasoningEffort ?? "none";
    // Семейство gpt-6 у шлюза больше не принимает «none» («Reasoning is mandatory
    // for this endpoint»): чат молча уходил на запасную модель. Самый лёгкий
    // допустимый режим — minimal.
    controls.reasoning_effort = effort === "none" && requiresReasoning(model) ? "minimal" : effort;
  }
  if (options.maxTokens) {
    if (usesSamplingTemperature(model)) controls.max_tokens = options.maxTokens;
    else controls.max_completion_tokens = options.maxTokens;
  }
  return controls;
}

const COMPANION_JSON_HINT =
  'Reply with compact JSON only. Put "answer" first. Required: "answer" — a complete useful reply in workspace.now.locale, with \\n\\n between paragraphs, \\n between list items, and **bold** short headings. Do not shrink the answer to a one-liner. Put offers only when they match this turn and Ilzi can execute them well; omit generic web search when a specific helper exists (rates, pharmacies, tickets, weather, repair). Optional when needed: context_used, task_actions, goal_actions, self_facts, person_facts, offers, search_actions, mail_actions, settings, follow_up, goal_plan. One message may contain several independent requests — emit a task_actions item per errand, up to 8. To edit notes on an existing task, use op=update with task_id and description; never create a task whose title is the description request. If workspace.replied_to is set, the user is replying to that message — bind writes to it. Omit empty arrays. Never invent facts.';

// Счётчики модели чата с момента запуска процесса. Логи сервера не всегда под
// рукой, а знать, отвечает ли Илзи на своей модели или на запасной, нужно.
export const companionModelStats = {
  model: null as string | null,
  fallbackModel: null as string | null,
  calls: 0,
  fallbacks: 0,
  lastFallbackAt: null as string | null,
  lastFallbackError: null as string | null,
};

function researchWhereWhen(context: WebResearchContext) {
  const en = (context.locale ?? "").toLowerCase().startsWith("en");
  let today = context.now.slice(0, 10);
  try {
    today = new Intl.DateTimeFormat(en ? "en-GB" : "ru-RU", {
      timeZone: context.timezone || "Europe/Moscow",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(context.now));
  } catch {
    // неизвестный часовой пояс — остаётся дата ISO
  }
  if (en) return `${context.city ? `I am in ${context.city}. ` : ""}Today is ${today}.`;
  return `${context.city ? `Я сейчас в городе: ${context.city}. ` : ""}Сегодня ${today}.`;
}

export class OpenAiProvider implements AiProvider {
  private readonly client: OpenAI;
  private onUsage?: (usage: AiTokenUsage) => void;
  constructor(
    apiKey: string,
    private readonly model: string,
    baseURL = "https://api.zveno.ai/v1",
    private readonly transcriptionModel = "openai/gpt-4o-mini-transcribe",
    // Разговор с Илзи может идти на более сильной модели, чем фоновая работа
    // (сводки, разбор писем, импорт): качество нужно там, где человек его видит,
    // а платить за него в каждом фоновом вызове незачем.
    private readonly companionModel: string = model,
    // Поиск в интернете: Perplexity Sonar Pro ищет сам и отвечает за ~5 с за
    // несколько рублей. GPT с поиском по качеству близко, но думает 25–30 с.
    private readonly webModel = "perplexity/sonar-pro",
  ) {
    this.client = new OpenAI({ apiKey, baseURL, timeout: FAST_AI_TIMEOUT_MS, maxRetries: 1 });
    companionModelStats.model = companionModel;
    companionModelStats.fallbackModel = companionModel === model ? null : model;
  }
  bindUsage(sink: (usage: AiTokenUsage) => void) {
    this.onUsage = sink;
  }
  private report(metric: string, tokens: Omit<AiTokenUsage, "metric">) {
    this.onUsage?.({ metric, ...tokens });
  }
  private async structured(
    name: string,
    schema: Record<string, unknown>,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    timeout = FAST_AI_TIMEOUT_MS,
  ) {
    const result = await this.client.chat.completions.create(
      {
        model: this.model,
        ...chatCompletionControls(this.model),
        messages,
        response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      },
      { timeout },
    );
    this.report(metricForSchema(name), tokensFromCompletionUsage(result.usage));
    const content = result.choices[0]?.message.content;
    if (!content) throw new Error("OpenAI returned no structured content");
    return JSON.parse(content) as unknown;
  }
  private normalizeAssistantDecision(raw: unknown) {
    if (!raw || typeof raw !== "object") return raw;
    const decision = { ...(raw as Record<string, unknown>) };
    const metadata: Record<string, unknown> =
      decision.metadata && typeof decision.metadata === "object"
        ? { ...(decision.metadata as Record<string, unknown>) }
        : { event_kind: null, notes: null };
    const notes = typeof metadata.notes === "string" ? metadata.notes.trim() : "";
    if (!decision.content && notes) decision.content = notes;
    if (
      decision.intent === "query_memory" &&
      typeof decision.content === "string" &&
      /(?:куда|иде[яи]|подар|recommend|сходить|пойти|удивить)/iu.test(decision.content)
    ) {
      decision.intent = "recommend";
    }
    decision.metadata = metadata;
    return decision;
  }
  decide(text: string) {
    return this.structured("assistant_decision", decisionSchema, [
      {
        role: "system",
        content:
          "Classify a LifeOS request. Only explicit remember commands may use remember. Put the memory fact in content, not metadata.notes. Use recommend for gift/place/activity ideas (e.g. «куда сходить»). Extract person query and concise fields. For memories estimate importance 1-5 and confidence 0-1, preserve dates in occurred_at and optional extra context in metadata.notes. For organize_event set metadata.event_kind. Never invent data.",
      },
      { role: "user", content: text },
    ]).then((result) => this.normalizeAssistantDecision(result));
  }
  async recommend(
    query: string,
    person: { name: string } | null,
    memories: { id: string; content: string; category: string }[],
    context?: { experiences: unknown[]; feedback: unknown[] },
  ) {
    const result = await this.structured("recommendation_items", recommendationSchema, [
      {
        role: "system",
        content:
          "Return 3-5 novel practical ideas. Rationales may cite only supplied memory or experience IDs and taste signals. Prefer options similar in feeling to positive experiences but not exact repeats. If no evidence exists, explicitly say the idea is general.",
      },
      {
        role: "user",
        content: JSON.stringify({ query, person: person?.name ?? null, memories, ...context }),
      },
    ]);
    return (result as { items?: unknown }).items;
  }
  async companion(query: string, context: unknown) {
    return this.companionStream(query, context);
  }
  async companionStream(query: string, context: unknown, onAnswerDelta?: (answer: string) => void) {
    companionModelStats.calls += 1;
    if (this.companionModel === this.model) {
      return this.companionWith(this.model, query, context, onAnswerDelta);
    }
    let started = false;
    try {
      return await this.companionWith(this.companionModel, query, context, (answer) => {
        started = true;
        onAnswerDelta?.(answer);
      });
    } catch (error) {
      // Ответ уже пошёл человеку на экран — подменять его на полуслове нельзя.
      if (started) throw error;
      // Модель чата недоступна или не приняла запрос: Илзи не должна замолчать,
      // отвечаем основной моделью и оставляем след в логах.
      companionModelStats.fallbacks += 1;
      companionModelStats.lastFallbackAt = new Date().toISOString();
      companionModelStats.lastFallbackError = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 300);
      console.error(
        JSON.stringify({
          event: "companion_model_fallback",
          model: this.companionModel,
          fallback: this.model,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return this.companionWith(this.model, query, context, onAnswerDelta);
    }
  }
  private async companionWith(
    model: string,
    query: string,
    context: unknown,
    onAnswerDelta?: (answer: string) => void,
  ) {
    const packed = companionPayload(context);
    const truncated = overflowHint(packed.workspace);
    const stream = await this.client.chat.completions.create(
      {
        model,
        ...chatCompletionControls(model, {
          maxTokens: COMPANION_AI_MAX_TOKENS,
          temperature: COMPANION_AI_TEMPERATURE,
          reasoningEffort: "none",
        }),
        stream: true,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: companionSystemPrompt },
          { role: "system", content: COMPANION_JSON_HINT },
          ...(truncated ? [{ role: "system" as const, content: truncated }] : []),
          {
            role: "system",
            content: `Workspace JSON:\n${JSON.stringify(packed.workspace)}`,
          },
          ...packed.conversation,
          { role: "user", content: query },
        ],
      },
      { timeout: COMPANION_AI_TIMEOUT_MS, maxRetries: 0 },
    );
    let raw = "";
    let lastAnswer = "";
    let usage:
      { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
    for await (const chunk of stream) {
      const piece = chunk.choices[0]?.delta?.content ?? "";
      if (piece) {
        raw += piece;
        const answer = extractStreamingAnswer(raw);
        if (answer != null && answer !== lastAnswer) {
          lastAnswer = answer;
          onAnswerDelta?.(answer);
        }
      }
      if (chunk.usage) usage = chunk.usage;
    }
    this.report(metricForSchema("companion_response"), tokensFromCompletionUsage(usage));
    const trimmed = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    if (!trimmed) throw new Error("OpenAI returned no structured content");
    return JSON.parse(trimmed) as unknown;
  }
  // Короткий поиск в интернете перед ответом Илзи. Без JSON-режима: провайдер
  // не совмещает его с веб-поиском. С человеком разговаривает модель чата.
  // Поисковик ищет по одной строке: «Из Петербурга. А обратно?» без прошлых
  // сообщений ищет не то. Быстрая модель сначала собирает самодостаточный
  // запрос — откуда, куда, точные даты с годом, — или говорит, что искать нечего.
  private async researchQuery(query: string, context: WebResearchContext): Promise<string | null> {
    try {
      const result = await this.client.chat.completions.create(
        {
          model: WEB_QUERY_MODEL,
          ...chatCompletionControls(WEB_QUERY_MODEL, { maxTokens: 160 }),
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "web_query",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["search", "query"],
                properties: { search: { type: "boolean" }, query: { type: "string" } },
              },
            },
          },
          messages: [
            {
              role: "system",
              content: [
                "Turn the user's latest message into ONE self-contained web search query in their language.",
                "Resolve everything from the conversation: origin and destination cities (origin defaults to the user's city), exact dates with year instead of «в субботу» / «завтра», times of day, what is being looked for.",
                "search=false only when the message needs no fresh facts from the internet (a pure task to record, a feeling, a question about their own data).",
                researchWhereWhen(context),
              ].join(" "),
            },
            ...(context.recent.length
              ? [
                  {
                    role: "system" as const,
                    content: `Conversation so far:\n${context.recent.join("\n")}`,
                  },
                ]
              : []),
            { role: "user", content: query },
          ],
        },
        { timeout: FAST_AI_TIMEOUT_MS, maxRetries: 0 },
      );
      this.report("web_query", tokensFromCompletionUsage(result.usage));
      const parsed = JSON.parse(result.choices[0]?.message.content ?? "{}") as {
        search?: boolean;
        query?: string;
      };
      if (parsed.search === false) return null;
      return parsed.query?.trim() || query;
    } catch {
      // Не собрали запрос — ищем по самому сообщению: хуже, но лучше, чем ничего.
      return query;
    }
  }
  async research(userText: string, context: WebResearchContext): Promise<WebResearch | null> {
    const query = await this.researchQuery(userText, context);
    if (!query) return null;
    const result = await this.client.chat.completions.create(
      {
        model: this.webModel,
        ...chatCompletionControls(this.webModel, { maxTokens: 900 }),
        messages: [
          {
            role: "system",
            content: [
              "You are Ilzi's research step. Search the web and return a compact factual brief for the user's request.",
              "Concrete facts only: names, dates, times, prices with currency, addresses, durations. Say «от» / «примерно» for prices and that fares change. Prefer official and big sources (РЖД, Туту, Яндекс Расписания, Авиасейлс, Афиша, Яндекс Погода, official sites).",
              "No advice, no greetings, no questions, no offers to help further. If the web has nothing reliable, say so in one line.",
              `Write in the language of locale ${context.locale ?? "ru-RU"}. Max ~1500 characters.`,
              ...(context.recent.length
                ? [`Earlier in this conversation (context only):\n${context.recent.join("\n")}`]
                : []),
            ].join(" "),
          },
          // Поисковик опирается на само сообщение: без города и даты «поезда в
          // Москву в субботу» ищутся из Казани и не на те числа.
          { role: "user", content: `${query}\n\n(${researchWhereWhen(context)})` },
        ],
        // Perplexity ищет сам; остальным моделям нужен плагин шлюза.
        ...(this.webModel.startsWith("perplexity/")
          ? {}
          : ({ plugins: [{ id: "web", max_results: 5 }] } as Record<string, unknown>)),
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      { timeout: WEB_RESEARCH_TIMEOUT_MS, maxRetries: 0 },
    );
    this.report("web_research", tokensFromCompletionUsage(result.usage));
    const message = result.choices[0]?.message;
    const content = message?.content?.trim();
    if (!content) return null;
    const annotations = (message as { annotations?: unknown } | undefined)?.annotations;
    const cited = (Array.isArray(annotations) ? annotations : []).flatMap((note: unknown) => {
      const cite = (note as { url_citation?: { url?: unknown; title?: unknown } })?.url_citation;
      return typeof cite?.url === "string"
        ? [{ url: cite.url, title: typeof cite.title === "string" ? cite.title : "" }]
        : [];
    });
    const inline = [...content.matchAll(/\[([^\]]*)\]\((https?:[^)\s]+)\)/g)].map((match) => ({
      title: match[1] ?? "",
      url: match[2]!,
    }));
    return {
      fetched_at: new Date().toISOString(),
      query,
      summary: stripInlineLinks(content).slice(0, 2500),
      sources: dedupeSources([...cited, ...inline]),
    };
  }
  extractExperience(text: string, currentTime: string) {
    return this.structured("experience_extraction", experienceExtractionSchema, [
      {
        role: "system",
        content:
          "Extract a real past experience only when the message describes something that happened. Capture explicit participants, emotions, positive/negative taste signals and place without inventing details. Otherwise return null. Resolve relative dates using the supplied current time.",
      },
      { role: "user", content: JSON.stringify({ text, current_time: currentTime }) },
    ]);
  }
  async reflect(snapshot: Record<string, unknown>) {
    return this.structured("weekly_reflection", reflectionSchema, [
      {
        role: "system",
        content:
          "Create a grounded weekly reflection using only the snapshot. Empty data must produce no invented wins and should acknowledge limited evidence.",
      },
      { role: "user", content: JSON.stringify(snapshot) },
    ]);
  }
  async digest(
    kind: "morning_digest" | "weekly_digest" | "evening_sync",
    snapshot: Record<string, unknown>,
  ) {
    const role =
      kind === "evening_sync"
        ? "You are Ealzy: a calm time-management mentor and psychologist-style companion. Do not diagnose, lecture, or invent facts. Write 1-3 short paragraphs in the user's locale: acknowledge leftover today tasks from snapshot.leftover, name tomorrow's tasks, mention goal progress and due promise check-ins if present, praise keeping streaks, and ask one honest reflective question — if goals look stale or missing a plan, invite a short goals/plan sync without nagging. If snapshot.upcoming has dates in the next two weeks, treat them as a two-week heads-up: name the person/date and suggest a relevant next step that fits their gender and relationship (never flowers for a man). If gift_history exists, use it as format and budget without copying the same gift. Do not invent shops or URLs. If snapshot.self.theses exist, keep them in mind and mention one only when it helps the plan. If snapshot tasks have assignee ealzy, mention them as Ealzy's own calendar work."
        : kind === "weekly_digest"
          ? "Write a Monday weekly briefing using only the snapshot. Cover dated tasks and active goal progress so the person can stick to the plan. If promises are due for a check-in, ask how they are going. If a goal has no plan or looks stuck, invite a goals/plan sync. If snapshot.upcoming has dates in the next two weeks, give a two-week heads-up and suggest preparing an action that fits gender and relationship (gift, table, flowers only for a woman) — use gift_history when present, do not invent shops. Keep snapshot.self.theses in mind. Mark assignee ealzy items as Ealzy's work. Do not invent items. Be concise, practical, unobtrusive, and use the user's locale."
          : "Write Ealzy's morning brief from the snapshot only. Frame it as what must not be dropped today — across work and people — not as a list of everything. Never invent tasks, facts, shops or URLs. Follow this order and add nothing else: (1) one framing line — the weekday from snapshot.weekday in the user's language, then how dense the day is; (2) one line naming exactly ONE task as `**Title** — short meta`: the top of snapshot.push, else the oldest of snapshot.overdue, else the most important of snapshot.today; (3) if snapshot.mail is non-empty, one line on what arrived overnight plus at most two bullets, meetings first; (4) at most ONE personal item from snapshot.upcoming, and only when it is present: name the person and the date, suggest a concrete next step that fits gender and relationship (never flowers for a man), and lean on snapshot.upcoming[].tastes or gift_history as the remembered detail it came from — quoting back what the person once told you is the point of this block; (5) if snapshot.promises has items with stats.due_for_checkin, one short question about at most two of them; (6) one closing line with the number of remaining open items, or a bullet list of them when three or fewer. Hard limits: 8 lines at most, no headings, no goal-progress block, no streak praise, and no questions about mood or feelings — those belong to the evening sync. Skip any block whose data is missing instead of filling it with prose. If the snapshot has no tasks at all, replace blocks 2 and 6 with a single invitation to dump three things for today. Mark tasks with assignee ealzy as Ealzy's own work. Be concise and use the user's locale.";
    return this.structured("scheduled_digest", digestSchema, [
      { role: "system", content: role },
      { role: "user", content: JSON.stringify({ kind, snapshot }) },
    ]);
  }
  async extractOnboardingFacts(
    text: string,
    locale: string,
  ): Promise<{
    memories: { content: string; category?: string }[];
    goals: string[];
    people: string[];
  }> {
    const result = await this.structured("onboarding_extract", onboardingExtractSchema, [
      {
        role: "system",
        content: `Extract facts from a user's onboarding answer. Return structured JSON with:
- memories: array of {content, category} where category is one of: interest, preference, habit, skill, personality, belief, value, health, lifestyle, work, education, relationship, aspiration, cultural, financial, routine. Only include clearly stated facts.
- goals: array of goal title strings — only explicit goals or aspirations.
- people: array of people names — only when the user mentions real people.
Do not invent facts. If the text is vague, return empty arrays. Respond in ${locale}.`,
      },
      { role: "user", content: text },
    ]);
    return (result ?? { memories: [], goals: [], people: [] }) as {
      memories: { content: string; category?: string }[];
      goals: string[];
      people: string[];
    };
  }

  async previewNoteAction(
    note: { title: string; content: Record<string, unknown>; plain_text: string; revision: number },
    instruction: string,
  ) {
    const raw = (await this.structured("note_action", noteActionSchema, [
      {
        role: "system",
        content:
          "Preview one explicit manual action from a note. Return kind=goal to create one goal, kind=tasks to create standalone tasks, or kind=plan to create a new goal with title, optional description, current_plan and linked tasks. Do not invent dates. This is a preview: describe only the requested writes.",
      },
      { role: "user", content: JSON.stringify({ note, instruction }) },
    ])) as Record<string, unknown>;
    if (raw.kind === "goal") return { kind: "goal", goal: raw.goal };
    if (raw.kind === "plan")
      return {
        kind: "plan",
        title: raw.title,
        description: raw.description,
        current_plan: raw.current_plan,
        tasks: raw.tasks,
      };
    return { kind: "tasks", tasks: raw.tasks };
  }
  async transcribe(file: { bytes: Uint8Array; filename: string; mime: string }) {
    try {
      const audio = await toFile(file.bytes, file.filename, { type: file.mime });
      const result = await this.client.audio.transcriptions.create(
        { file: audio, model: this.transcriptionModel },
        { timeout: 60_000 },
      );
      const usage =
        result && typeof result === "object" && "usage" in result
          ? (result as { usage?: unknown }).usage
          : undefined;
      this.report("transcribe", tokensFromTranscriptionUsage(usage));
      const text = typeof result === "string" ? result : result.text;
      return text?.trim() ? text.trim() : null;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "audio_transcription_failed",
          mime: file.mime,
          bytes: file.bytes.byteLength,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return null;
    }
  }
}
