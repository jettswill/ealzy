import { cachedAreaGeocoder, type GeoArea } from "./modules/assistant/web-places.js";
import { assertCloudQuota } from "./modules/billing/quota.js";
import type { PushGateway } from "./infrastructure/apns.js";
import express, { type Express, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import {
  companionRequestSchema,
  messageSourceChannelSchema,
  confirmNoteActionSchema,
  createMemorySchema,
  createPersonDateSchema,
  createRecommendationFeedbackSchema,
  deleteNoteSchema,
  noteMutationSchema,
  previewNoteActionSchema,
  updateMemorySchema,
  updatePersonDateSchema,
  updateUserProfileSchema,
} from "@lifeos/contracts";
import type { Env } from "./config.js";
import type { AppRepository } from "./repository.js";
import { withGoalStats, withPromiseStats } from "./direction.js";
import { errorHandler, HttpError, notFound, requestId, asyncHandler } from "./middleware.js";
import { loadActivityCatalog, surpriseActivity } from "./modules/assistant/activities.js";
import { spinWheel, WheelError, wheelStatus } from "./modules/assistant/wheel.js";
import {
  createPlaceSearch,
  distanceMeters,
  type PlaceSearch,
} from "./modules/assistant/place-search.js";
import {
  collectTasteEvidence,
  inferenceFromLocal,
  learnFromVisit,
  localTasteCatalog,
  localTasteFacts,
  refreshTastes,
  tasteFor,
  tasteIndex,
  visitSignal,
} from "./modules/assistant/tastes.js";
import { cityForTimezone } from "./modules/assistant/discovery.js";
import { getMeetingNote, saveMeetingNote } from "./modules/assistant/meeting-notes.js";
import { roundCoordinate } from "./modules/assistant/whereabouts.js";
import {
  applyWebClientContext,
  authMiddleware,
  exchangeEmailUser,
  exchangeGuestUser,
  exchangeInitData,
  exchangeOAuthUser,
  exchangeTelegramLogin,
  linkEmailUser,
  linkOAuthUser,
  linkTelegramLogin,
  pollAppLogin,
  refreshSession,
  startAppLogin,
  type SupabaseAuthVerifier,
} from "./modules/auth/index.js";
import {
  completeOAuth,
  configuredOAuthProviders,
  oauthAppRedirect,
  oauthClientFromState,
  OAUTH_CLIENTS,
  startOAuthUrl,
  type OAuthProvider,
} from "./modules/auth/oauth.js";
import {
  AssistantOrchestrator,
  CompanionService,
  ReflectionService,
  ScheduledMessageService,
  AiWorkService,
  createExperienceFollowUpPending,
  NoteActionService,
  composePortrait,
  computeReliability,
  summarizeAchievementHolders,
  isInferredBehaviorMemory,
  visibleSelfMemories,
} from "./modules/assistant/index.js";
import {
  assertWebhookSecret,
  startTelegramPolling,
  TelegramUpdateHandler,
  type TelegramGateway,
} from "./infrastructure/telegram.js";
import { companionModelStats } from "./infrastructure/openai.js";
import type { AiProvider } from "./modules/assistant/index.js";
import type { DiscoveryClient } from "./modules/assistant/discovery.js";
import { MailService } from "./modules/mail/service.js";
import { ImapSmtpGateway, type MailGateway } from "./modules/mail/gateway.js";
import { continueGuidedIntro, startOrResumeGuidedIntro } from "./modules/assistant/guided-intro.js";
import { beginCompanionSse, writeSse } from "./modules/assistant/companion-stream.js";
import { applyBrainDump, finishOnboardingActivation } from "./modules/assistant/first-session.js";
import { composeDigestText, zonedParts } from "./modules/assistant/scheduled-messages.js";
import { touchLastActive } from "./modules/engagement/reengagement.js";
import { attachUsageSink, loadUsageSummary, runWithUsageOwner } from "./modules/billing/usage.js";
import { loadQuota } from "./modules/billing/quota.js";
import {
  buildCompleteness,
  confirmImport,
  createTodoistGateway,
  importAppRedirect,
  previewTextImport,
  previewTodoistImport,
  publicImportSession,
  todoistAuthorizeUrl,
  todoistConfigured,
  todoistOwnerFromState,
  type TodoistGateway,
} from "./modules/import/service.js";

const id = z.string().uuid();
const personInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    relationship: z.string().trim().max(120).nullable().optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  })
  .strict();
const emptyToNull = (value: unknown) => (value === "" || value === undefined ? null : value);
const locationInput = z
  .object({
    label: z.preprocess(emptyToNull, z.string().trim().min(1).max(80).nullable()).optional(),
    city: z.string().trim().min(1).max(120),
    address: z.preprocess(emptyToNull, z.string().trim().min(1).max(400).nullable()).optional(),
    is_primary: z.boolean().optional(),
  })
  .strict();
const category = z.enum([
  "interest",
  "dislike",
  "favorite_place",
  "favorite_food",
  "gift",
  "dream",
  "size",
  "important_date",
  "story",
  "personality",
  "preference",
  "skill",
  "important_event",
  "important_fact",
  "experience",
  "other",
]);
const memoryInput = z
  .object({
    content: z.string().trim().min(1).max(4000),
    category,
    importance: z.number().int().min(1).max(5).optional(),
    confidence: z.number().min(0).max(1).optional(),
    status: z.enum(["active", "archived"]).optional(),
    occurred_at: z.string().datetime().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const spaceInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.string().trim().min(1).max(80).optional(),
    context: z.string().trim().max(4000).nullable().optional(),
    person_ids: z.array(id).optional(),
  })
  .strict();
const taskInput = z
  .object({
    id: id.optional(),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(["todo", "in_progress", "done", "cancelled"]).optional(),
    person_id: id.nullable().optional(),
    space_id: id.nullable().optional(),
    goal_id: id.nullable().optional(),
    project_id: id.nullable().optional(),
    due_at: z.string().datetime().nullable().optional(),
    estimate_minutes: z.number().int().min(1).max(480).nullable().optional(),
    completed_at: z.string().datetime().nullable().optional(),
    sort_order: z.number().int().nullable().optional(),
    recurrence_frequency: z.enum(["daily", "weekly", "monthly"]).nullable().optional(),
    recurrence_scope: z.enum(["instance", "series"]).optional(),
    kind: z.enum(["task", "meeting"]).optional(),
    activity_type: z
      .enum(["development", "routine", "entertainment", "household", "degradation"])
      .nullable()
      .optional(),
    value_score: z.number().int().min(-1).max(3).nullable().optional(),
    importance: z.number().int().min(1).max(5).optional(),
    urgency: z.number().int().min(1).max(5).optional(),
    assignee: z.enum(["user", "ealzy"]).optional(),
  })
  .strict();
const mailConnectInput = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(1).max(200),
    provider: z.enum(["gmail", "yandex", "mailru", "outlook", "custom"]).optional(),
    username: z.string().trim().max(320).optional(),
    imap_host: z.string().trim().max(200).optional(),
    imap_port: z.number().int().min(1).max(65_535).optional(),
    smtp_host: z.string().trim().max(200).optional(),
    smtp_port: z.number().int().min(1).max(65_535).optional(),
  })
  .strict();
const mailDraftInput = z
  .object({
    to_address: z.string().trim().min(1).max(320).optional(),
    subject: z.string().trim().max(300).optional(),
    body: z.string().trim().max(8000).optional(),
  })
  .strict();
const mailPlaybookInput = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    trigger: z.enum(["important", "meeting", "unread", "custom"]).optional(),
    actions: z
      .array(z.enum(["summarize", "create_task", "draft_reply"]))
      .max(4)
      .optional(),
    prompt: z.string().trim().max(2000).nullable().optional(),
    enabled: z.boolean().optional(),
    account_id: id.nullable().optional(),
  })
  .strict();
const goalInput = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(["active", "completed", "paused", "cancelled"]).optional(),
    horizon: z.enum(["short", "medium", "long"]).nullable().optional(),
    priority: z.number().int().min(1).max(5).optional(),
    target_date: z.string().date().nullable().optional(),
  })
  .strict();
const promiseInput = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(["active", "paused", "retired"]).optional(),
  })
  .strict();
const promiseCheckinInput = z
  .object({
    status: z.enum(["keeping", "struggling", "broken"]),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
const projectInput = z
  .object({
    name: z.string().trim().min(1).max(300),
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(["active", "completed", "paused", "cancelled"]).optional(),
    goal_id: id.nullable().optional(),
    space_id: id.nullable().optional(),
  })
  .strict();
const experienceInput = z
  .object({
    type: z.enum(["restaurant", "theater", "trip", "event", "gift", "activity", "other"]),
    title: z.string().trim().min(1).max(300),
    place: z.string().trim().max(500).nullable().optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    occurred_at: z.string().datetime().nullable().optional(),
    positive_signals: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
    negative_signals: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
    emotions: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    outcome: z.string().trim().max(2000).nullable().optional(),
    planned_task_id: id.nullable().optional(),
    planned_space_id: id.nullable().optional(),
    follow_up_at: z.string().datetime().nullable().optional(),
    status: z.enum(["planned", "completed", "follow_up_due"]).optional(),
    participant_ids: z.array(id).max(30).optional(),
    source_message_id: id.nullable().optional(),
  })
  .strict();
const partial = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema.partial().refine((v) => Object.keys(v).length > 0, "At least one field is required");
const owner = (req: express.Request) => req.ownerId!;
const found = <T>(value: T | null) => {
  if (!value) throw new HttpError(404, "NOT_FOUND", "Resource not found");
  return value;
};
async function goalsPayload(repository: AppRepository, ownerId: string) {
  const [goals, tasks] = await Promise.all([
    repository.listGoals(ownerId),
    repository.listTasks(ownerId),
  ]);
  return { goals: goals.map((goal) => withGoalStats(goal, tasks)), tasks };
}
async function promisesPayload(repository: AppRepository, ownerId: string) {
  const [promises, checkins] = await Promise.all([
    repository.listPromises(ownerId),
    repository.listPromiseCheckins(ownerId),
  ]);
  return promises.map((item) => withPromiseStats(item, checkins));
}
// «Сколько людей держат этот знак» считается по всем аккаунтам и всем делам со
// сроком. /api/me зовётся на каждом переходе по приложению, поэтому без кэша
// каждый переход читал всю таблицу дел целиком. Цифра сообщества не обязана
// быть свежей до секунды — держим её десять минут на процесс.
const COMMUNITY_TTL_MS = 10 * 60 * 1000;
const communityCache = new WeakMap<
  AppRepository,
  { at: number; value: Promise<ReturnType<typeof summarizeAchievementHolders>> }
>();

function achievementCommunity(repository: AppRepository, now = Date.now()) {
  const cached = communityCache.get(repository);
  if (cached && now - cached.at < COMMUNITY_TTL_MS) return cached.value;
  const value = repository
    .listReliabilityCohort()
    .then((cohort) => summarizeAchievementHolders(cohort));
  communityCache.set(repository, { at: now, value });
  // Сбой чтения не должен застрять в кэше на десять минут.
  value.catch(() => {
    if (communityCache.get(repository)?.value === value) communityCache.delete(repository);
  });
  return value;
}

async function mePayload(repository: AppRepository, ownerId: string) {
  const [user, profile, self, conversation, tasks, community] = await Promise.all([
    repository.getUser(ownerId),
    repository.getProfile(ownerId),
    repository.getSelfPerson(ownerId),
    repository.getPrimaryConversation(ownerId),
    repository.listTasks(ownerId),
    achievementCommunity(repository),
  ]);
  const validUser = found(user);
  const validProfile = found(profile);
  const validSelf = found(self);
  const storedMemories = await repository.listMemories(ownerId, validSelf.id);
  for (const memory of storedMemories.filter(isInferredBehaviorMemory)) {
    await repository.deleteMemory(ownerId, memory.id);
  }
  const memories = visibleSelfMemories(storedMemories);
  const reliability = {
    ...computeReliability(tasks, validProfile.timezone || "UTC"),
    community,
  };
  const portrait = composePortrait({
    bio: validProfile.bio,
    values: validProfile.values,
    memories,
    locale: validProfile.locale,
  });
  return {
    ...validProfile,
    context_summary: portrait || validProfile.context_summary,
    first_name: validUser.name,
    username: validUser.username,
    telegram_id: validUser.telegram_id,
    auth_user_id: validUser.auth_user_id,
    email: validUser.email,
    primary_conversation_id: conversation.id,
    reliability,
    user: validUser,
    profile: validProfile,
    self: {
      ...validSelf,
      memories,
    },
    locations: validSelf.locations ?? [],
    dates: validSelf.dates ?? [],
  };
}

export interface AppDependencies {
  repository: AppRepository;
  env: Pick<
    Env,
    | "CORS_ORIGIN"
    | "TELEGRAM_BOT_TOKEN"
    | "TELEGRAM_WEBHOOK_SECRET"
    | "TELEGRAM_MINI_APP_URL"
    | "TELEGRAM_POLLING"
    | "TELEGRAM_BOT_USERNAME"
    | "VITE_TELEGRAM_BOT_USERNAME"
    | "TELEGRAM_INIT_DATA_MAX_AGE_SECONDS"
    | "TELEGRAM_LOGIN_MAX_AGE_SECONDS"
    | "SESSION_SECRET"
    | "SESSION_TTL_SECONDS"
    | "CRON_SECRET"
    | "PUBLIC_APP_URL"
    | "GOOGLE_OAUTH_CLIENT_ID"
    | "GOOGLE_OAUTH_CLIENT_SECRET"
    | "GOOGLE_OAUTH_REDIRECT_URI"
    | "APPLE_OAUTH_CLIENT_ID"
    | "APPLE_OAUTH_CLIENT_SECRET"
    | "APPLE_OAUTH_REDIRECT_URI"
    | "YANDEX_OAUTH_CLIENT_ID"
    | "YANDEX_OAUTH_CLIENT_SECRET"
    | "YANDEX_OAUTH_REDIRECT_URI"
    | "MAIL_ENCRYPTION_KEY"
    | "TODOIST_CLIENT_ID"
    | "TODOIST_CLIENT_SECRET"
    | "TODOIST_REDIRECT_URI"
    | "DGIS_API_KEY"
  >;
  supabaseAuth?: SupabaseAuthVerifier;
  telegram: TelegramGateway;
  ai?: AiProvider;
  discovery?: DiscoveryClient;
  mail?: MailGateway;
  todoist?: TodoistGateway;
  push?: PushGateway;
  /** Поиск мест рядом; по умолчанию — OpenStreetMap. */
  placeSearch?: PlaceSearch;
  /** Район словами → точка; по умолчанию Nominatim. */
  placeGeocoder?: (text: string, city: string | null) => Promise<GeoArea | null>;
}

/** Где искать: точка (геолокация или на карте) и радиус. */
const areaSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    radius_m: z.number().int().min(300).max(40_000),
    label: z.string().trim().max(80).nullable().optional(),
  })
  .strict();

export function createApp(deps: AppDependencies): Express {
  const { repository, env } = deps;
  const placeSearch =
    deps.placeSearch ??
    createPlaceSearch({
      dgisKey: env.DGIS_API_KEY,
      // Редкое, чего нет на картах, Илзи ищет в интернете.
      web: deps.ai?.findPlacesOnWeb ? (query) => deps.ai!.findPlacesOnWeb!(query) : null,
    });
  const placeGeocoder = deps.placeGeocoder ?? cachedAreaGeocoder();
  attachUsageSink(deps.ai, repository);
  const supabaseAuth: SupabaseAuthVerifier = deps.supabaseAuth ?? {
    async getUser() {
      return { data: { user: null }, error: new Error("Supabase auth is not configured") };
    },
  };
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(requestId);
  app.use((req, res, next) => {
    res.setHeader("access-control-allow-origin", env.CORS_ORIGIN);
    res.setHeader(
      "access-control-allow-headers",
      "content-type, authorization, x-request-id, x-telegram-bot-api-secret-token",
    );
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "lifeos-api" });
  });

  const assistant = new AssistantOrchestrator(repository, deps.ai);
  const companion = new CompanionService(repository, deps.ai, deps.discovery);
  const reflections = new ReflectionService(repository, deps.ai);
  const mail = new MailService(
    repository,
    deps.mail ?? new ImapSmtpGateway(),
    env.MAIL_ENCRYPTION_KEY || env.SESSION_SECRET,
  );
  const scheduled = new ScheduledMessageService(repository, deps.telegram, deps.ai, deps.push);
  const aiWork = new AiWorkService(repository, companion, deps.telegram);
  const noteActions = new NoteActionService(repository, deps.ai);
  const webhook = new TelegramUpdateHandler(
    repository,
    assistant,
    companion,
    reflections,
    deps.telegram,
    env.TELEGRAM_MINI_APP_URL,
    deps.ai,
    mail,
  );
  if (env.TELEGRAM_POLLING !== "false" && deps.telegram.getUpdates) {
    void startTelegramPolling(webhook, deps.telegram);
  }
  app.post(
    "/webhooks/telegram/:secret",
    rateLimit({
      windowMs: 60_000,
      limit: 180,
      standardHeaders: true,
      legacyHeaders: false,
    }),
    asyncHandler(async (req, res) => {
      assertWebhookSecret(
        z.string().parse(req.params.secret),
        req.header("x-telegram-bot-api-secret-token"),
        env.TELEGRAM_WEBHOOK_SECRET,
      );
      const result = await webhook.handle(req.body);
      res.json({ ok: true, ...result });
    }),
  );
  app.post(
    "/internal/experience-follow-ups",
    asyncHandler(async (req, res) => {
      if (!env.CRON_SECRET || req.header("x-cron-secret") !== env.CRON_SECRET)
        throw new HttpError(401, "INVALID_CRON_SECRET", "Invalid cron secret");
      const due = await repository.findDueExperienceFollowUps();
      for (const experience of due) {
        const user = await repository.getUser(experience.owner_id);
        if (!user?.telegram_id) continue;
        await deps.telegram.sendMessage(
          user.telegram_id,
          `Как вам ${experience.title}? Что понравилось, а что нет?`,
        );
        await repository.updateExperience(experience.owner_id, experience.id, {
          status: "follow_up_due",
        });
        await createExperienceFollowUpPending(
          repository,
          experience.owner_id,
          user.telegram_id,
          experience.id,
        );
      }
      res.json({ data: { triggered: due.length } });
    }),
  );
  app.post(
    "/internal/scheduled-messages",
    asyncHandler(async (req, res) => {
      if (!env.CRON_SECRET || req.header("x-cron-secret") !== env.CRON_SECRET)
        throw new HttpError(401, "INVALID_CRON_SECRET", "Invalid cron secret");
      res.json({ data: await scheduled.run() });
    }),
  );
  app.post(
    "/internal/ai-work",
    asyncHandler(async (req, res) => {
      if (!env.CRON_SECRET || req.header("x-cron-secret") !== env.CRON_SECRET)
        throw new HttpError(401, "INVALID_CRON_SECRET", "Invalid cron secret");
      res.json({ data: await aiWork.processOne() });
    }),
  );
  app.post(
    "/internal/mail-sync",
    asyncHandler(async (req, res) => {
      if (!env.CRON_SECRET || req.header("x-cron-secret") !== env.CRON_SECRET)
        throw new HttpError(401, "INVALID_CRON_SECRET", "Invalid cron secret");
      res.json({ data: await mail.syncDue() });
    }),
  );

  const api = Router();
  api.post(
    "/auth/telegram",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 60,
      standardHeaders: true,
      legacyHeaders: false,
    }),
    asyncHandler(async (req, res) => {
      const { initData, timezone } = z
        .object({ initData: z.string().min(1), timezone: z.string().min(1).optional() })
        .parse(req.body);
      const data = await exchangeInitData(repository, initData, {
        botToken: env.TELEGRAM_BOT_TOKEN,
        maxAgeSeconds: env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS,
        sessionSecret: env.SESSION_SECRET,
        sessionTtlSeconds: env.SESSION_TTL_SECONDS,
        clientTimezone: timezone,
      });
      res.json({ data });
    }),
  );
  api.post(
    "/auth/telegram-login",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 60,
      standardHeaders: true,
      legacyHeaders: false,
    }),
    asyncHandler(async (req, res) => {
      const data = await exchangeTelegramLogin(repository, req.body, {
        botToken: env.TELEGRAM_BOT_TOKEN,
        maxAgeSeconds: env.TELEGRAM_LOGIN_MAX_AGE_SECONDS,
        sessionSecret: env.SESSION_SECRET,
        sessionTtlSeconds: env.SESSION_TTL_SECONDS,
      });
      res.json({ data });
    }),
  );
  api.post(
    "/auth/app-login/start",
    rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }),
    asyncHandler(async (_req, res) => {
      res.status(201).json({
        data: await startAppLogin(
          repository,
          env.TELEGRAM_BOT_USERNAME ?? env.VITE_TELEGRAM_BOT_USERNAME,
        ),
      });
    }),
  );
  api.post(
    "/auth/app-login/poll",
    rateLimit({ windowMs: 15 * 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }),
    asyncHandler(async (req, res) => {
      const { nonce } = z.object({ nonce: z.string().min(1).max(64) }).parse(req.body);
      res.json({
        data: await pollAppLogin(repository, nonce, {
          sessionSecret: env.SESSION_SECRET,
          sessionTtlSeconds: env.SESSION_TTL_SECONDS,
        }),
      });
    }),
  );
  api.get("/auth/telegram/config", (_req, res) => {
    res.json({
      data: {
        bot_id: env.TELEGRAM_BOT_TOKEN.split(":")[0],
      },
    });
  });
  api.post(
    "/auth/guest",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 30,
      standardHeaders: true,
      legacyHeaders: false,
    }),
    asyncHandler(async (req, res) => {
      const { timezone, locale } = z
        .object({
          timezone: z.string().min(1).max(64).optional(),
          locale: z.string().min(2).max(8).optional(),
        })
        .parse(req.body ?? {});
      const data = await exchangeGuestUser(repository, {
        sessionSecret: env.SESSION_SECRET,
        sessionTtlSeconds: env.SESSION_TTL_SECONDS,
        timezone,
        locale,
      });
      res.json({ data });
    }),
  );
  api.get("/auth/oauth/providers", (_req, res) => {
    res.json({ data: configuredOAuthProviders(env) });
  });
  api.get(
    "/auth/oauth/:provider/start",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 60,
      standardHeaders: true,
      legacyHeaders: false,
    }),
    asyncHandler(async (req, res) => {
      const provider = z.enum(["google", "apple", "yandex"]).parse(req.params.provider);
      const intent = z.enum(["login", "link"]).catch("login").parse(req.query.intent);
      const client = z.enum(OAUTH_CLIENTS).catch("web").parse(req.query.client);
      const sessionToken =
        typeof req.query.session === "string"
          ? req.query.session
          : (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "") || undefined;
      res.redirect(
        await startOAuthUrl(env, provider as OAuthProvider, intent, sessionToken, client),
      );
    }),
  );
  const handleOAuthCallback = (provider: OAuthProvider) =>
    asyncHandler(async (req, res) => {
      const params = { ...(req.query as Record<string, unknown>), ...(req.body as object) };
      const client = await oauthClientFromState(env, params.state);
      try {
        const result = await completeOAuth(repository, env, {
          provider,
          code: typeof params.code === "string" ? params.code : undefined,
          state: typeof params.state === "string" ? params.state : undefined,
          error: typeof params.error === "string" ? params.error : undefined,
        });
        res.redirect(oauthAppRedirect(env, result, client));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not complete sign-in";
        res.redirect(oauthAppRedirect(env, { kind: "error", message }, client));
      }
    });
  api.get("/auth/oauth/:provider/callback", (req, res, next) => {
    const parsed = z.enum(["google", "apple", "yandex"]).safeParse(req.params.provider);
    if (!parsed.success) return next();
    return handleOAuthCallback(parsed.data)(req, res, next);
  });
  api.post("/auth/oauth/:provider/callback", (req, res, next) => {
    const parsed = z.enum(["google", "apple", "yandex"]).safeParse(req.params.provider);
    if (!parsed.success) return next();
    return handleOAuthCallback(parsed.data)(req, res, next);
  });
  api.get("/integrations/google/callback", handleOAuthCallback("google"));
  api.post("/integrations/google/callback", handleOAuthCallback("google"));
  api.get(
    "/import/todoist/callback",
    asyncHandler(async (req, res) => {
      const params = req.query as Record<string, unknown>;
      const todoist = deps.todoist ?? createTodoistGateway();
      try {
        if (typeof params.error === "string") {
          throw new HttpError(401, "TODOIST_DENIED", "Todoist access was denied");
        }
        const state = typeof params.state === "string" ? params.state : "";
        const code = typeof params.code === "string" ? params.code : "";
        if (!state || !code) throw new HttpError(400, "TODOIST_CALLBACK", "Missing OAuth code");
        const ownerId = await todoistOwnerFromState(env, state);
        if (!todoist.exchangeCode) {
          throw new HttpError(501, "TODOIST_NOT_CONFIGURED", "Todoist OAuth is not configured");
        }
        const token = await todoist.exchangeCode(code, env);
        const session = await previewTodoistImport(repository, ownerId, token, todoist);
        res.redirect(importAppRedirect(env, { session: session.id }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Todoist import failed";
        res.redirect(importAppRedirect(env, { error: message.slice(0, 180) }));
      }
    }),
  );
  api.post(
    "/auth/oauth/exchange",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 60,
      standardHeaders: true,
      legacyHeaders: false,
    }),
    asyncHandler(async (req, res) => {
      const { access_token, timezone } = z
        .object({ access_token: z.string().min(1), timezone: z.string().min(1).max(64).optional() })
        .strict()
        .parse(req.body);
      const data = await exchangeOAuthUser(repository, supabaseAuth, access_token, {
        sessionSecret: env.SESSION_SECRET,
        sessionTtlSeconds: env.SESSION_TTL_SECONDS,
        timezone,
      });
      res.json({ data });
    }),
  );
  api.post(
    "/auth/email/exchange",
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 60,
      standardHeaders: true,
      legacyHeaders: false,
    }),
    asyncHandler(async (req, res) => {
      const { access_token, timezone } = z
        .object({ access_token: z.string().min(1), timezone: z.string().min(1).max(64).optional() })
        .strict()
        .parse(req.body);
      const data = await exchangeEmailUser(repository, supabaseAuth, access_token, {
        sessionSecret: env.SESSION_SECRET,
        sessionTtlSeconds: env.SESSION_TTL_SECONDS,
        timezone,
      });
      res.json({ data });
    }),
  );
  api.use(authMiddleware(env.SESSION_SECRET));
  api.use((req, _res, next) => runWithUsageOwner(owner(req), () => next()));
  api.use((req, _res, next) => {
    void touchLastActive(repository, owner(req)).catch(() => undefined);
    next();
  });
  api.post(
    "/auth/refresh",
    asyncHandler(async (req, res) => {
      res.json({
        data: await refreshSession(repository, owner(req), {
          sessionSecret: env.SESSION_SECRET,
          sessionTtlSeconds: env.SESSION_TTL_SECONDS,
        }),
      });
    }),
  );
  api.post(
    "/auth/oauth/link",
    asyncHandler(async (req, res) => {
      const { access_token } = z
        .object({ access_token: z.string().min(1) })
        .strict()
        .parse(req.body);
      res.json({
        data: await linkOAuthUser(repository, supabaseAuth, owner(req), access_token),
      });
    }),
  );
  api.post(
    "/auth/email/link",
    asyncHandler(async (req, res) => {
      const { access_token } = z
        .object({ access_token: z.string().min(1) })
        .strict()
        .parse(req.body);
      res.json({
        data: await linkEmailUser(repository, supabaseAuth, owner(req), access_token),
      });
    }),
  );
  api.post(
    "/auth/telegram/link",
    asyncHandler(async (req, res) => {
      res.json({
        data: await linkTelegramLogin(repository, owner(req), req.body, {
          botToken: env.TELEGRAM_BOT_TOKEN,
          maxAgeSeconds: env.TELEGRAM_LOGIN_MAX_AGE_SECONDS,
        }),
      });
    }),
  );
  // Календарь телефона: приложение присылает окно целиком и заменяет прошлую копию.
  api.put(
    "/calendar/events",
    asyncHandler(async (req, res) => {
      const iso = z.string().datetime({ offset: true });
      const input = z
        .object({
          source: z.literal("ios"),
          from: iso,
          to: iso,
          events: z
            .array(
              z
                .object({
                  external_id: z.string().trim().min(1).max(300),
                  title: z.string().trim().min(1).max(300),
                  starts_at: iso,
                  ends_at: iso,
                  all_day: z.boolean().default(false),
                  location: z.string().trim().max(300).nullable().optional(),
                  calendar_title: z.string().trim().max(120).nullable().optional(),
                })
                .strict(),
            )
            .max(500),
        })
        .strict()
        .parse(req.body);
      if (
        Date.parse(input.to) - Date.parse(input.from) > 35 * 24 * 3600_000 ||
        input.to <= input.from
      )
        throw new HttpError(400, "CALENDAR_RANGE", "Calendar window must be 1–35 days");
      const stored = await repository.replaceCalendarEvents(owner(req), {
        source: input.source,
        from: new Date(input.from).toISOString(),
        to: new Date(input.to).toISOString(),
        events: input.events.map((event) => ({
          external_id: event.external_id,
          title: event.title,
          starts_at: new Date(event.starts_at).toISOString(),
          ends_at: new Date(event.ends_at).toISOString(),
          all_day: event.all_day,
          location: event.location || null,
          calendar_title: event.calendar_title || null,
        })),
      });
      res.json({ data: { stored } });
    }),
  );
  api.get(
    "/calendar/events",
    asyncHandler(async (req, res) => {
      const from = new Date();
      const to = new Date(from.getTime() + 7 * 24 * 3600_000);
      res.json({
        data: await repository.listCalendarEvents(owner(req), from.toISOString(), to.toISOString()),
      });
    }),
  );
  // Где я сейчас: город и погоду присылает телефон (iOS), сервер ведёт историю поездок.
  api.put(
    "/me/whereabouts",
    asyncHandler(async (req, res) => {
      const input = z
        .object({
          city: z.string().trim().min(1).max(120),
          country: z.string().trim().max(120).nullable().optional(),
          lat: z.number().min(-90).max(90).nullable().optional(),
          lon: z.number().min(-180).max(180).nullable().optional(),
          timezone: z.string().trim().max(64).nullable().optional(),
          weather: z
            .object({
              temp: z.number().min(-90).max(70),
              code: z.number().int().min(0).max(99),
              at: z.string().datetime({ offset: true }),
            })
            .strict()
            .nullable()
            .optional(),
        })
        .strict()
        .parse(req.body);
      const place = await repository.recordWhereabouts(owner(req), {
        city: input.city,
        country: input.country || null,
        lat: roundCoordinate(input.lat),
        lon: roundCoordinate(input.lon),
        timezone: input.timezone || null,
        weather_temp: input.weather?.temp ?? null,
        weather_code: input.weather?.code ?? null,
        weather_at: input.weather ? new Date(input.weather.at).toISOString() : null,
      });
      res.json({
        data: { city: place.city, country: place.country, arrived_at: place.arrived_at },
      });
    }),
  );
  // Заметки со встречи: открыл встречу в приложении — пишешь, что обсудили.
  api.get(
    "/calendar/meeting-note",
    asyncHandler(async (req, res) => {
      const input = z
        .object({
          external_id: z.string().trim().min(1).max(300),
          starts_at: z.string().datetime({ offset: true }),
        })
        .parse(req.query);
      res.json({
        data: await getMeetingNote(
          repository,
          owner(req),
          input.external_id,
          new Date(input.starts_at).toISOString(),
        ),
      });
    }),
  );
  api.put(
    "/calendar/meeting-note",
    asyncHandler(async (req, res) => {
      const iso = z.string().datetime({ offset: true });
      const input = z
        .object({
          external_id: z.string().trim().min(1).max(300),
          starts_at: iso,
          ends_at: iso,
          title: z.string().trim().min(1).max(300),
          body: z.string().max(50_000),
          client_mutation_id: z.string().uuid(),
        })
        .strict()
        .parse(req.body);
      const profile = await repository.getProfile(owner(req));
      res.json({
        data: await saveMeetingNote(
          repository,
          owner(req),
          {
            external_id: input.external_id,
            starts_at: input.starts_at,
            ends_at: input.ends_at,
            title: input.title,
          },
          input.body,
          input.client_mutation_id,
          profile?.timezone || "Europe/Moscow",
        ),
      });
    }),
  );
  // Справочник «чем заняться» и места под него.
  const outingCity = async (ownerId: string, raw: unknown) => {
    const asked = typeof raw === "string" ? raw.trim().slice(0, 80) : "";
    if (asked) return asked;
    const [self, profile] = await Promise.all([
      repository.getSelfPerson(ownerId),
      repository.getProfile(ownerId),
    ]);
    const withCity = (self?.locations ?? []).filter((l) => l.city);
    const located = (withCity.find((l) => l.is_primary) ?? withCity[0])?.city;
    return located || cityForTimezone(profile?.timezone, profile?.locale);
  };
  api.get(
    "/activities",
    asyncHandler(async (_req, res) => {
      res.json({ data: await loadActivityCatalog(repository) });
    }),
  );
  // Кнопка «Удиви меня»: случайный тип (можно сузить категорией) и места, где ещё не был.
  api.get(
    "/activities/surprise",
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          category: z.string().trim().max(60).optional(),
          type: z.string().trim().max(80).optional(),
          city: z.string().trim().max(80).optional(),
        })
        .parse(req.query);
      const profile = await repository.getProfile(owner(req));
      const surprise = await surpriseActivity(repository, owner(req), {
        category: query.category || null,
        typeId: query.type || null,
        city: await outingCity(owner(req), query.city),
        timezone: profile?.timezone || "Europe/Moscow",
      });
      res.json({ data: found(surprise) });
    }),
  );
  // Колесо «Удиви меня»: сколько вращений осталось сегодня и что уже выпадало.
  api.get(
    "/activities/wheel",
    asyncHandler(async (req, res) => {
      const profile = await repository.getProfile(owner(req));
      // Колесо открыли — если появились новые факты, пересоберём гипотезы о
      // вкусах в фоне; к следующему вращению они уже будут учтены.
      if (deps.ai?.inferActivityTastes) {
        const ownerId = owner(req);
        void loadActivityCatalog(repository)
          .then((catalog) => refreshTastes(repository, deps.ai, ownerId, { catalog }))
          .catch(() => undefined);
      }
      res.json({
        data: await wheelStatus(repository, owner(req), profile?.timezone || "Europe/Moscow"),
      });
    }),
  );
  api.post(
    "/activities/wheel",
    asyncHandler(async (req, res) => {
      const input = z
        .object({
          mood: z.enum(["calm", "active", "any"]).default("any"),
          want: z.string().trim().max(120).nullable().optional(),
          when: z.enum(["now", "today", "weekend"]).default("today"),
          company: z.enum(["solo", "pair", "friends", "kids"]).default("solo"),
          city: z.string().trim().max(80).nullable().optional(),
          only_new: z.boolean().default(false),
          feedback: z.string().trim().max(500).nullable().optional(),
          area: areaSchema.nullable().optional(),
        })
        .strict()
        .parse(req.body);
      const profile = await repository.getProfile(owner(req));
      const city = await outingCity(owner(req), input.city);
      try {
        const result = await spinWheel(
          repository,
          owner(req),
          {
            mood: input.mood,
            want: input.want || null,
            when: input.when,
            company: input.company,
            city,
            only_new: input.only_new,
            feedback: input.feedback || null,
          },
          { timezone: profile?.timezone || "Europe/Moscow", city, area: input.area ?? null },
        );
        res.status(201).json({ data: result });
      } catch (error) {
        if (error instanceof WheelError)
          throw new HttpError(error.status, error.code, error.message);
        throw error;
      }
    }),
  );
  api.get(
    "/places",
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          type: z.string().trim().max(80).optional(),
          city: z.string().trim().max(80).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        })
        .parse(req.query);
      res.json({
        data: await repository.listPlaces({
          typeIds: query.type ? [query.type] : undefined,
          city: await outingCity(owner(req), query.city),
          limit: query.limit ?? 50,
        }),
      });
    }),
  );
  api.get(
    "/places/visits",
    asyncHandler(async (req, res) => {
      res.json({ data: await repository.listPlaceVisits(owner(req)) });
    }),
  );
  const visitFields = {
    activity_type_id: z.string().trim().max(80).nullable().optional(),
    city: z.string().trim().max(80).nullable().optional(),
    status: z.enum(["visited", "want", "skip"]).default("visited"),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    emotion: z.enum(["wow", "good", "meh", "bad"]).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    visited_on: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  };
  type VisitFields = {
    activity_type_id?: string | null;
    city?: string | null;
    status: "visited" | "want" | "skip";
    rating?: number | null;
    emotion?: "wow" | "good" | "meh" | "bad" | null;
    note?: string | null;
    visited_on?: string | null;
  };
  // Запись дневника плюс урок для вкусов: оценка и впечатление после визита
  // сдвигают вес этого типа (и слегка — его категории).
  const recordVisit = async (
    ownerId: string,
    input: VisitFields & { place_id: string | null; title: string | null },
  ) => {
    const catalog = await loadActivityCatalog(repository);
    const type = input.activity_type_id
      ? catalog.types.find((t) => t.id === input.activity_type_id)
      : undefined;
    if (input.activity_type_id && !type)
      throw new HttpError(400, "UNKNOWN_ACTIVITY_TYPE", "Unknown activity type");
    const visit = await repository.savePlaceVisit(ownerId, {
      place_id: input.place_id,
      activity_type_id: type?.id ?? null,
      title: input.title,
      city: input.city || null,
      status: input.status,
      rating: input.rating ?? null,
      emotion: input.emotion ?? null,
      note: input.note || null,
      visited_on: input.visited_on ?? null,
    });
    const signal = input.status === "visited" ? visitSignal(input.rating, input.emotion) : null;
    if (type && signal != null) await learnFromVisit(repository, ownerId, type, signal);
    return visit;
  };
  api.post(
    "/places/visits",
    asyncHandler(async (req, res) => {
      const input = z
        .object({
          place_id: z.string().uuid().nullable().optional(),
          title: z.string().trim().min(1).max(300).nullable().optional(),
          ...visitFields,
        })
        .strict()
        .refine((v) => Boolean(v.place_id || v.title), "place_id or title is required")
        .parse(req.body);
      const visit = await recordVisit(owner(req), {
        ...input,
        place_id: input.place_id ?? null,
        title: input.title || null,
      });
      res.status(201).json({ data: visit });
    }),
  );
  // Место из поиска рядом попадает в общую базу только сейчас — когда человек
  // сказал «хочу» или «был». Дальше оно видно и другим под этот тип.
  api.post(
    "/places/save",
    asyncHandler(async (req, res) => {
      const input = z
        .object({
          candidate: z
            .object({
              source: z.enum(["2gis", "osm", "web"]),
              source_id: z.string().trim().min(1).max(120),
              name: z.string().trim().min(1).max(300),
              address: z.string().trim().max(300).nullable(),
              city: z.string().trim().max(80).nullable(),
              lat: z.number().min(-90).max(90).nullable(),
              lon: z.number().min(-180).max(180).nullable(),
              rating: z.number().min(0).max(5).nullable(),
              rating_count: z.number().int().min(0).nullable(),
              image_url: z.string().url().max(1000).nullable(),
              photos: z.array(z.string().url().max(1000)).max(10),
              phone: z.string().trim().max(80).nullable(),
              website: z.string().trim().max(300).nullable(),
              hours: z.string().trim().max(300).nullable(),
              twogis_url: z.string().url().max(300).nullable(),
              note: z.string().trim().max(300).nullable().optional(),
            })
            .passthrough(),
          ...visitFields,
          activity_type_id: z.string().trim().max(80),
        })
        .strict()
        .parse(req.body);
      const catalog = await loadActivityCatalog(repository);
      if (!catalog.types.some((t) => t.id === input.activity_type_id))
        throw new HttpError(400, "UNKNOWN_ACTIVITY_TYPE", "Unknown activity type");
      const c = input.candidate;
      const place = await repository.upsertPlace(
        {
          source: c.source,
          source_id: c.source_id,
          name: c.name,
          address: c.address,
          city: c.city,
          lat: c.lat,
          lon: c.lon,
          rating: c.rating,
          rating_count: c.rating_count,
          image_url: c.image_url,
          photos: c.photos,
          phone: c.phone,
          website: c.website,
          hours: c.hours,
          twogis_url: c.twogis_url,
          note: c.note ?? null,
        },
        input.activity_type_id,
      );
      const visit = await recordVisit(owner(req), {
        ...input,
        place_id: place.id,
        title: null,
        city: input.city ?? c.city,
      });
      res.status(201).json({ data: { place, visit } });
    }),
  );
  // Места под тип рядом с человеком: сначала уже известные Ealzy (с ними кто-то
  // что-то делал), потом найденные в каталоге — без записи в базу.
  // Район, метро или адрес словами → точка для поиска «где-то здесь».
  api.get(
    "/places/geocode",
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          q: z.string().trim().min(2).max(120),
          city: z.string().trim().max(80).optional(),
        })
        .parse(req.query);
      const city = await outingCity(owner(req), query.city);
      const area = await placeGeocoder(query.q, city);
      if (!area)
        throw new HttpError(404, "PLACE_NOT_FOUND", "Не нашли такое место — попробуй иначе");
      res.json({ data: { ...area, city } });
    }),
  );
  api.get(
    "/places/nearby",
    asyncHandler(async (req, res) => {
      const query = z
        .object({
          type: z.string().trim().min(1).max(80),
          lat: z.coerce.number().min(-90).max(90).optional(),
          lon: z.coerce.number().min(-180).max(180).optional(),
          city: z.string().trim().max(80).optional(),
          radius: z.coerce.number().int().min(300).max(40_000).optional(),
          near: z.string().trim().max(80).optional(),
        })
        .parse(req.query);
      const catalog = await loadActivityCatalog(repository);
      const type = found(catalog.types.find((t) => t.id === query.type) ?? null);
      const city = await outingCity(owner(req), query.city);
      const point =
        query.lat != null && query.lon != null ? { lat: query.lat, lon: query.lon } : null;
      // Веб-поиск облачный: при исчерпанном лимите — только карты.
      const allowWeb = await assertCloudQuota(repository, owner(req)).then(
        () => true,
        () => false,
      );
      const [known, visits, found_] = await Promise.all([
        repository.listPlaces({ typeIds: [type.id], city: point ? null : city, limit: 200 }),
        repository.listPlaceVisits(owner(req)),
        placeSearch.nearby({
          type,
          lat: point?.lat ?? null,
          lon: point?.lon ?? null,
          city,
          radiusM: query.radius,
          limit: 10,
          allowWeb,
          near: query.near || null,
        }),
      ]);
      const radius = query.radius ?? 15_000;
      const status = new Map(
        visits.filter((v) => v.place_id).map((v) => [v.place_id!, v.status] as const),
      );
      const saved = known
        .map((place) => ({
          ...place,
          distance_m:
            point && place.lat != null && place.lon != null
              ? distanceMeters(point.lat, point.lon, place.lat, place.lon)
              : null,
          my_status: status.get(place.id) ?? null,
        }))
        .filter((place) => !point || place.distance_m == null || place.distance_m <= radius)
        .sort((a, b) => (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9))
        .slice(0, 10);
      const knownKeys = new Set(
        known.map((p) => `${p.source}:${(p as { source_id?: string }).source_id ?? ""}`),
      );
      const knownNames = new Set(known.map((p) => p.name.toLocaleLowerCase()));
      res.json({
        data: {
          type,
          city,
          saved,
          found: found_.filter(
            (c) =>
              !knownKeys.has(`${c.source}:${c.source_id}`) &&
              !knownNames.has(c.name.toLocaleLowerCase()),
          ),
          source: env.DGIS_API_KEY ? "2gis" : "osm",
          web: found_.some((c) => c.source === "web"),
        },
      });
    }),
  );
  // Вкусы: «нравится» / «никогда» от человека, следы визитов и гипотезы нейросети.
  const tastesPayload = async (ownerId: string) => {
    const [catalog, prefs, profile] = await Promise.all([
      loadActivityCatalog(repository),
      repository.listActivityPreferences(ownerId),
      repository.getTasteProfile(ownerId),
    ]);
    const types = new Map(catalog.types.map((t) => [t.id, t]));
    const categories = new Map(catalog.categories.map((c) => [c.id, c]));
    const index = tasteIndex(prefs);
    const items = prefs
      .map((pref) => {
        const target =
          pref.target_kind === "type" ? types.get(pref.target_id) : categories.get(pref.target_id);
        if (!target) return null;
        const score =
          pref.target_kind === "type"
            ? tasteFor(target as (typeof catalog.types)[number], index).score
            : Math.max(-1, Math.min(1, pref.visit_affinity + 0.6 * pref.ai_affinity));
        return {
          target_kind: pref.target_kind,
          target_id: pref.target_id,
          name: target.name,
          emoji: target.emoji,
          verdict: pref.verdict,
          score: Math.round(score * 100) / 100,
          reason: pref.ai_reason,
          source: pref.verdict ? "you" : pref.visit_affinity !== 0 ? "visits" : "ai",
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item) => item.verdict || Math.abs(item.score) >= 0.15)
      .sort((a, b) => b.score - a.score);
    return {
      summary: profile?.summary ?? null,
      refreshed_at: profile?.refreshed_at ?? null,
      ai_available: Boolean(deps.ai?.inferActivityTastes),
      items,
    };
  };
  api.get(
    "/activities/tastes",
    asyncHandler(async (req, res) => {
      res.json({ data: await tastesPayload(owner(req)) });
    }),
  );
  api.put(
    "/activities/tastes",
    asyncHandler(async (req, res) => {
      const input = z
        .object({
          target_kind: z.enum(["type", "category"]),
          target_id: z.string().trim().min(1).max(80),
          verdict: z.enum(["like", "never"]).nullable(),
        })
        .strict()
        .parse(req.body);
      const catalog = await loadActivityCatalog(repository);
      const exists =
        input.target_kind === "type"
          ? catalog.types.some((t) => t.id === input.target_id)
          : catalog.categories.some((c) => c.id === input.target_id);
      if (!exists) throw new HttpError(400, "UNKNOWN_ACTIVITY_TYPE", "Unknown activity type");
      await repository.patchActivityPreference(owner(req), input);
      res.json({ data: await tastesPayload(owner(req)) });
    }),
  );
  api.post(
    "/activities/tastes/refresh",
    asyncHandler(async (req, res) => {
      if (!deps.ai?.inferActivityTastes)
        throw new HttpError(503, "AI_UNAVAILABLE", "AI is not configured");
      const catalog = await loadActivityCatalog(repository);
      await refreshTastes(repository, deps.ai, owner(req), { force: true, catalog });
      res.json({ data: await tastesPayload(owner(req)) });
    }),
  );
  // Гипотезы о вкусах строит модель на iPhone: бесплатно и без облачного лимита.
  // Телефон забирает факты и справочник, считает у себя и присылает итог.
  api.get(
    "/activities/tastes/evidence",
    asyncHandler(async (req, res) => {
      const catalog = await loadActivityCatalog(repository);
      const { evidence } = await collectTasteEvidence(repository, owner(req), catalog);
      res.json({
        data: { facts: localTasteFacts(evidence), catalog: localTasteCatalog(catalog) },
      });
    }),
  );
  api.post(
    "/activities/tastes/local",
    asyncHandler(async (req, res) => {
      const input = z
        .object({
          summary: z.string().trim().max(600).nullable().optional(),
          hypotheses: z
            .array(
              z
                .object({
                  name: z.string().trim().max(120).optional(),
                  kind: z.enum(["type", "category"]).optional(),
                  target_id: z.string().trim().max(80).optional(),
                  affinity: z.number().min(-1).max(1),
                  reason: z.string().trim().max(300).nullable().optional(),
                })
                .strict(),
            )
            .max(40),
        })
        .strict()
        .parse(req.body);
      const catalog = await loadActivityCatalog(repository);
      const inference = inferenceFromLocal(input, catalog);
      if (inference) {
        await repository.replaceAiPreferences(
          owner(req),
          inference.hypotheses.map((h) => ({
            target_kind: h.target_kind,
            target_id: h.target_id,
            ai_affinity: h.affinity,
            ai_reason: h.reason || null,
          })),
        );
        await repository.saveTasteProfile(owner(req), {
          summary: inference.summary || null,
          refreshed_at: new Date().toISOString(),
        });
      }
      res.json({ data: await tastesPayload(owner(req)) });
    }),
  );
  api.delete(
    "/places/visits/:id",
    asyncHandler(async (req, res) => {
      const id = z.string().uuid().parse(req.params.id);
      found((await repository.deletePlaceVisit(owner(req), id)) || null);
      res.status(204).end();
    }),
  );
  api.post(
    "/devices",
    asyncHandler(async (req, res) => {
      const input = z
        .object({
          platform: z.literal("ios"),
          push_token: z.string().trim().min(16).max(512),
          environment: z.enum(["sandbox", "production"]).default("production"),
          app_version: z.string().trim().max(40).nullable().optional(),
        })
        .strict()
        .parse(req.body);
      res.status(201).json({ data: await repository.upsertDevice(owner(req), input) });
    }),
  );
  api.delete(
    "/devices",
    asyncHandler(async (req, res) => {
      const { push_token } = z
        .object({ push_token: z.string().trim().min(16).max(512) })
        .parse(req.body);
      await repository.deleteDevice(owner(req), push_token);
      res.status(204).end();
    }),
  );
  api.post(
    "/events",
    asyncHandler(async (req, res) => {
      const { events } = z
        .object({
          events: z
            .array(
              z.object({
                name: z.string().min(1).max(100),
                properties: z.record(z.string(), z.unknown()).optional(),
              }),
            )
            .min(1)
            .max(50),
        })
        .parse(req.body);
      await repository.trackEvents(owner(req), events);
      res.json({ data: { tracked: events.length } });
    }),
  );
  api.get(
    "/account/export",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const conversation = await repository.getPrimaryConversation(ownerId);
      const [
        user,
        profile,
        people,
        spaces,
        tasks,
        goals,
        promises,
        promise_checkins,
        projects,
        recommendations,
        feedback,
        reflections,
        experiences,
        messages,
        mail_accounts,
        mail_messages,
        mail_drafts,
        mail_playbooks,
        notes,
        note_revisions,
        note_actions,
      ] = await Promise.all([
        repository.getUser(ownerId),
        repository.getProfile(ownerId),
        repository.listPeople(ownerId),
        repository.listSpaces(ownerId),
        repository.listTasks(ownerId),
        repository.listGoals(ownerId),
        repository.listPromises(ownerId),
        repository.listPromiseCheckins(ownerId),
        repository.listProjects(ownerId),
        repository.listRecommendations(ownerId),
        repository.listRecommendationFeedback(ownerId, 1000),
        repository.listReflections(ownerId),
        repository.listExperiences(ownerId),
        repository.listMessages(ownerId, conversation.id, 1000),
        repository.listMailAccounts(ownerId),
        repository.listMailMessages(ownerId, 200),
        repository.listMailDrafts(ownerId),
        repository.listMailPlaybooks(ownerId),
        repository.listNotes(ownerId),
        repository.listNoteRevisions(ownerId),
        repository.listNoteActions(ownerId),
      ]);
      const peopleWithMemories = await Promise.all(
        people.map(async (person) => ({
          ...person,
          memories: await repository.listMemories(ownerId, person.id),
        })),
      );
      res.json({
        data: {
          exported_at: new Date().toISOString(),
          user,
          profile,
          people: peopleWithMemories,
          spaces,
          tasks,
          goals,
          promises,
          promise_checkins,
          projects,
          recommendations,
          recommendation_feedback: feedback,
          reflections,
          experiences,
          conversation,
          messages,
          mail_accounts,
          mail_messages,
          mail_drafts,
          mail_playbooks,
          notes,
          note_revisions,
          note_actions,
        },
      });
    }),
  );
  api.delete(
    "/account",
    asyncHandler(async (req, res) => {
      await repository.deleteAccount(owner(req));
      res.sendStatus(204);
    }),
  );
  api.get(
    "/notes",
    asyncHandler(async (req, res) => {
      res.json({ data: await repository.listNotes(owner(req)) });
    }),
  );
  api.put(
    "/notes/:id",
    asyncHandler(async (req, res) => {
      const result = await repository.mutateNote(
        owner(req),
        id.parse(req.params.id),
        noteMutationSchema.parse(req.body),
      );
      if (result.status === "not_found") throw new HttpError(404, "NOT_FOUND", "Note not found");
      if (result.status === "conflict") {
        res.status(409).json({
          error: {
            code: "REVISION_CONFLICT",
            message: "Note revision is stale",
            requestId: String(res.getHeader("x-request-id")),
            details: { server_note: result.note },
          },
        });
        return;
      }
      res.status(result.note.revision === 1 ? 201 : 200).json({ data: result.note });
    }),
  );
  api.delete(
    "/notes/:id",
    asyncHandler(async (req, res) => {
      const input = deleteNoteSchema.parse(req.body);
      const result = await repository.mutateNote(
        owner(req),
        id.parse(req.params.id),
        { ...input, title: "", content: {}, plain_text: "" },
        true,
      );
      if (result.status === "not_found") throw new HttpError(404, "NOT_FOUND", "Note not found");
      if (result.status === "conflict") {
        res.status(409).json({
          error: {
            code: "REVISION_CONFLICT",
            message: "Note revision is stale",
            requestId: String(res.getHeader("x-request-id")),
            details: { server_note: result.note },
          },
        });
        return;
      }
      res.json({ data: result.note });
    }),
  );
  api.post(
    "/notes/:id/actions/preview",
    asyncHandler(async (req, res) => {
      const { instruction } = previewNoteActionSchema.parse(req.body);
      res.status(201).json({
        data: await noteActions.preview(owner(req), id.parse(req.params.id), instruction),
      });
    }),
  );
  api.post(
    "/note-actions/:id/confirm",
    asyncHandler(async (req, res) => {
      const { proposal } = confirmNoteActionSchema.parse(req.body ?? {});
      res.json({
        data: await noteActions.confirm(owner(req), id.parse(req.params.id), proposal),
      });
    }),
  );
  api.get(
    "/people",
    asyncHandler(async (req, res) =>
      res.json({
        data: await repository.listPeople(
          owner(req),
          z
            .string()
            .optional()
            .parse(req.query.q ?? req.query.search),
        ),
      }),
    ),
  );
  api.post(
    "/people",
    asyncHandler(async (req, res) =>
      res
        .status(201)
        .json({ data: await repository.createPerson(owner(req), personInput.parse(req.body)) }),
    ),
  );
  api.get(
    "/people/:id",
    asyncHandler(async (req, res) => {
      const person = found(await repository.getPerson(owner(req), id.parse(req.params.id)));
      res.json({
        data: { ...person, memories: await repository.listMemories(owner(req), person.id) },
      });
    }),
  );
  api.patch(
    "/people/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(
          await repository.updatePerson(
            owner(req),
            id.parse(req.params.id),
            partial(personInput).parse(req.body),
          ),
        ),
      }),
    ),
  );
  api.delete(
    "/people/:id",
    asyncHandler(async (req, res) => {
      if (!(await repository.deletePerson(owner(req), id.parse(req.params.id))))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  api.get(
    "/me",
    asyncHandler(async (req, res) => {
      res.json({ data: await mePayload(repository, owner(req)) });
    }),
  );
  // Какая модель отвечает в чате и срабатывала ли запасная — без доступа к логам.
  api.get("/diagnostics/ai", (_req, res) => {
    res.json({ data: companionModelStats });
  });
  api.patch(
    "/me",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const before = await repository.getProfile(ownerId);
      const saved = found(
        await repository.updateProfile(ownerId, updateUserProfileSchema.parse(req.body)),
      );
      if (!before?.onboarding_completed_at && saved.onboarding_completed_at) {
        await finishOnboardingActivation(repository, ownerId, null, saved.locale);
      }
      res.json({ data: await mePayload(repository, ownerId) });
    }),
  );
  // Веб-пользователь без Telegram не получал от Ealzy ни одного проактивного
  // сообщения: и утро, и вечер, и понедельник отправляются только в чат бота.
  // Сводку он теперь может хотя бы увидеть при входе — тот же текст, что ушёл
  // бы в Telegram, собранный без обращения к модели.
  api.post(
    "/me/client-context",
    asyncHandler(async (req, res) => {
      // Веб-вход приходит редиректом с токеном, часовой пояс знает только браузер.
      // Пока его нет, у не-Telegram аккаунта пояс UTC и выключенная утренняя сводка.
      const { timezone } = z
        .object({ timezone: z.string().min(1).max(64) })
        .strict()
        .parse(req.body);
      const applied = await applyWebClientContext(repository, owner(req), timezone);
      res.json({ data: applied });
    }),
  );
  api.get(
    "/digest/today",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const profile = found(await repository.getProfile(ownerId));
      const now = new Date();
      const kind =
        zonedParts(profile.timezone, now).minutes >= 18 * 60
          ? "evening_sync"
          : ("morning_digest" as const);
      res.json({
        data: {
          kind,
          text: await composeDigestText(repository, profile, kind, now),
          generated_at: now.toISOString(),
        },
      });
    }),
  );
  api.post(
    "/me/brain-dump",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).parse(req.body);
      const result = await applyBrainDump(repository, ownerId, text);
      if (result.empty && !result.skipped) {
        throw new HttpError(400, "EMPTY_DUMP", "Could not parse a task list");
      }
      res.status(201).json({
        data: {
          tasks: result.tasks,
          promise: result.promise,
          skipped: result.skipped,
        },
      });
    }),
  );
  api.get(
    "/me/memories",
    asyncHandler(async (req, res) => {
      const self = found(await repository.getSelfPerson(owner(req)));
      res.json({
        data: visibleSelfMemories(await repository.listMemories(owner(req), self.id)),
      });
    }),
  );
  api.post(
    "/me/memories",
    asyncHandler(async (req, res) => {
      const self = found(await repository.getSelfPerson(owner(req)));
      const result = await repository.createMemory(
        owner(req),
        self.id,
        createMemorySchema.parse(req.body),
      );
      if (!result.duplicate && (await repository.listMemories(owner(req), self.id)).length === 1)
        await repository.trackBetaMetric(owner(req), "first_self_fact", {
          source: "mini_app",
        });
      res
        .status(result.duplicate ? 200 : 201)
        .json({ data: result.memory, duplicate: result.duplicate });
    }),
  );
  api.patch(
    "/me/memories/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(
          await repository.updateMemory(
            owner(req),
            id.parse(req.params.id),
            updateMemorySchema.parse(req.body),
          ),
        ),
      }),
    ),
  );
  api.delete(
    "/me/memories/:id",
    asyncHandler(async (req, res) => {
      if (!(await repository.deleteMemory(owner(req), id.parse(req.params.id))))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  api.get(
    "/me/locations",
    asyncHandler(async (req, res) => {
      const self = found(await repository.getSelfPerson(owner(req)));
      res.json({ data: await repository.listLocations(owner(req), self.id) });
    }),
  );
  api.post(
    "/me/locations",
    asyncHandler(async (req, res) => {
      const self = found(await repository.getSelfPerson(owner(req)));
      res.status(201).json({
        data: await repository.createLocation(owner(req), self.id, locationInput.parse(req.body)),
      });
    }),
  );
  api.patch(
    "/me/locations/:id",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const self = found(await repository.getSelfPerson(ownerId));
      const locationId = id.parse(req.params.id);
      const owned = (await repository.listLocations(ownerId, self.id)).some(
        (item) => item.id === locationId,
      );
      if (!owned) throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.json({
        data: found(
          await repository.updateLocation(
            ownerId,
            locationId,
            partial(locationInput).parse(req.body),
          ),
        ),
      });
    }),
  );
  api.delete(
    "/me/locations/:id",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const self = found(await repository.getSelfPerson(ownerId));
      const locationId = id.parse(req.params.id);
      const owned = (await repository.listLocations(ownerId, self.id)).some(
        (item) => item.id === locationId,
      );
      if (!owned) throw new HttpError(404, "NOT_FOUND", "Resource not found");
      if (!(await repository.deleteLocation(ownerId, locationId)))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  api.get(
    "/me/dates",
    asyncHandler(async (req, res) => {
      const self = found(await repository.getSelfPerson(owner(req)));
      res.json({ data: await repository.listDates(owner(req), self.id) });
    }),
  );
  api.post(
    "/me/dates",
    asyncHandler(async (req, res) => {
      const self = found(await repository.getSelfPerson(owner(req)));
      res.status(201).json({
        data: await repository.createDate(
          owner(req),
          self.id,
          createPersonDateSchema.parse(req.body),
        ),
      });
    }),
  );
  api.patch(
    "/me/dates/:id",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const self = found(await repository.getSelfPerson(ownerId));
      const dateId = id.parse(req.params.id);
      const owned = (await repository.listDates(ownerId, self.id)).some(
        (item) => item.id === dateId,
      );
      if (!owned) throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.json({
        data: found(
          await repository.updateDate(ownerId, dateId, updatePersonDateSchema.parse(req.body)),
        ),
      });
    }),
  );
  api.delete(
    "/me/dates/:id",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const self = found(await repository.getSelfPerson(ownerId));
      const dateId = id.parse(req.params.id);
      const owned = (await repository.listDates(ownerId, self.id)).some(
        (item) => item.id === dateId,
      );
      if (!owned) throw new HttpError(404, "NOT_FOUND", "Resource not found");
      if (!(await repository.deleteDate(ownerId, dateId)))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  api.get(
    "/people/:id/memories",
    asyncHandler(async (req, res) => {
      const personId = id.parse(req.params.id);
      found(await repository.getPerson(owner(req), personId));
      res.json({ data: await repository.listMemories(owner(req), personId) });
    }),
  );
  api.post(
    "/people/:id/memories",
    asyncHandler(async (req, res) => {
      const result = await repository.createMemory(
        owner(req),
        id.parse(req.params.id),
        memoryInput.parse(req.body),
      );
      res
        .status(result.duplicate ? 200 : 201)
        .json({ data: result.memory, duplicate: result.duplicate });
    }),
  );
  api.get(
    "/people/:id/locations",
    asyncHandler(async (req, res) => {
      const personId = id.parse(req.params.id);
      found(await repository.getPerson(owner(req), personId));
      res.json({ data: await repository.listLocations(owner(req), personId) });
    }),
  );
  api.post(
    "/people/:id/locations",
    asyncHandler(async (req, res) =>
      res.status(201).json({
        data: await repository.createLocation(
          owner(req),
          id.parse(req.params.id),
          locationInput.parse(req.body),
        ),
      }),
    ),
  );
  api.get(
    "/people/:id/dates",
    asyncHandler(async (req, res) => {
      const personId = id.parse(req.params.id);
      found(await repository.getPerson(owner(req), personId));
      res.json({ data: await repository.listDates(owner(req), personId) });
    }),
  );
  api.post(
    "/people/:id/dates",
    asyncHandler(async (req, res) =>
      res.status(201).json({
        data: await repository.createDate(
          owner(req),
          id.parse(req.params.id),
          createPersonDateSchema.parse(req.body),
        ),
      }),
    ),
  );
  api.patch(
    "/dates/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(
          await repository.updateDate(
            owner(req),
            id.parse(req.params.id),
            updatePersonDateSchema.parse(req.body),
          ),
        ),
      }),
    ),
  );
  api.delete(
    "/dates/:id",
    asyncHandler(async (req, res) => {
      if (!(await repository.deleteDate(owner(req), id.parse(req.params.id))))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  api.patch(
    "/locations/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(
          await repository.updateLocation(
            owner(req),
            id.parse(req.params.id),
            partial(locationInput).parse(req.body),
          ),
        ),
      }),
    ),
  );
  api.delete(
    "/locations/:id",
    asyncHandler(async (req, res) => {
      if (!(await repository.deleteLocation(owner(req), id.parse(req.params.id))))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  api.patch(
    "/memories/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(
          await repository.updateMemory(
            owner(req),
            id.parse(req.params.id),
            updateMemorySchema.parse(req.body),
          ),
        ),
      }),
    ),
  );
  api.get(
    "/goals",
    asyncHandler(async (req, res) => {
      const { goals } = await goalsPayload(repository, owner(req));
      res.json({ data: goals });
    }),
  );
  api.get(
    "/goals/:id",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const { goals, tasks } = await goalsPayload(repository, ownerId);
      const goal = found(goals.find((item) => item.id === id.parse(req.params.id)) ?? null);
      res.json({
        data: {
          ...goal,
          tasks: tasks.filter((task) => task.goal_id === goal.id),
        },
      });
    }),
  );
  api.post(
    "/goals",
    asyncHandler(async (req, res) =>
      res
        .status(201)
        .json({ data: await repository.createGoal(owner(req), goalInput.parse(req.body)) }),
    ),
  );
  api.patch(
    "/goals/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(
          await repository.updateGoal(
            owner(req),
            id.parse(req.params.id),
            partial(goalInput).parse(req.body),
          ),
        ),
      }),
    ),
  );
  api.delete(
    "/goals/:id",
    asyncHandler(async (req, res) => {
      if (!(await repository.deleteGoal(owner(req), id.parse(req.params.id))))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  api.get(
    "/promises",
    asyncHandler(async (req, res) =>
      res.json({ data: await promisesPayload(repository, owner(req)) }),
    ),
  );
  api.post(
    "/promises",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const created = await repository.createPromise(ownerId, promiseInput.parse(req.body));
      const checkins = await repository.listPromiseCheckins(ownerId, created.id);
      res.status(201).json({ data: withPromiseStats(created, checkins) });
    }),
  );
  api.get(
    "/promises/:id",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const promiseId = id.parse(req.params.id);
      const [promise, checkins] = await Promise.all([
        repository.getPromise(ownerId, promiseId),
        repository.listPromiseCheckins(ownerId, promiseId),
      ]);
      res.json({ data: withPromiseStats(found(promise), checkins) });
    }),
  );
  api.patch(
    "/promises/:id",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const promiseId = id.parse(req.params.id);
      const updated = found(
        await repository.updatePromise(ownerId, promiseId, partial(promiseInput).parse(req.body)),
      );
      const checkins = await repository.listPromiseCheckins(ownerId, promiseId);
      res.json({ data: withPromiseStats(updated, checkins) });
    }),
  );
  api.delete(
    "/promises/:id",
    asyncHandler(async (req, res) => {
      if (!(await repository.deletePromise(owner(req), id.parse(req.params.id))))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  api.post(
    "/promises/:id/checkins",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const promiseId = id.parse(req.params.id);
      const checkin = await repository.createPromiseCheckin(
        ownerId,
        promiseId,
        promiseCheckinInput.parse(req.body),
      );
      const [promise, checkins] = await Promise.all([
        repository.getPromise(ownerId, promiseId),
        repository.listPromiseCheckins(ownerId, promiseId),
      ]);
      res.status(201).json({
        data: {
          checkin,
          promise: withPromiseStats(found(promise), checkins),
        },
      });
    }),
  );
  api.get(
    "/projects",
    asyncHandler(async (req, res) => res.json({ data: await repository.listProjects(owner(req)) })),
  );
  api.post(
    "/projects",
    asyncHandler(async (req, res) =>
      res
        .status(201)
        .json({ data: await repository.createProject(owner(req), projectInput.parse(req.body)) }),
    ),
  );
  api.patch(
    "/projects/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(
          await repository.updateProject(
            owner(req),
            id.parse(req.params.id),
            partial(projectInput).parse(req.body),
          ),
        ),
      }),
    ),
  );
  api.delete(
    "/projects/:id",
    asyncHandler(async (req, res) => {
      if (!(await repository.deleteProject(owner(req), id.parse(req.params.id))))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  api.get(
    "/experiences",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const requestedPersonId = z.string().uuid().optional().parse(req.query.person_id);
      const selfOnly = z.coerce.boolean().default(false).parse(req.query.self);
      const limit = z.coerce.number().int().min(1).max(100).default(25).parse(req.query.limit);
      const self = selfOnly ? found(await repository.getSelfPerson(ownerId)) : null;
      const data = await repository.listExperiences(ownerId, requestedPersonId ?? self?.id);
      res.json({ data: data.slice(0, limit) });
    }),
  );
  api.post(
    "/experiences",
    asyncHandler(async (req, res) =>
      res.status(201).json({
        data: await repository.createExperience(owner(req), experienceInput.parse(req.body)),
      }),
    ),
  );
  api.get(
    "/experiences/follow-ups/due",
    asyncHandler(async (req, res) =>
      res.json({ data: await repository.findDueExperienceFollowUps(undefined, owner(req)) }),
    ),
  );
  api.get(
    "/experiences/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(await repository.getExperience(owner(req), id.parse(req.params.id))),
      }),
    ),
  );
  api.patch(
    "/experiences/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(
          await repository.updateExperience(
            owner(req),
            id.parse(req.params.id),
            partial(experienceInput).parse(req.body),
          ),
        ),
      }),
    ),
  );
  api.delete(
    "/experiences/:id",
    asyncHandler(async (req, res) => {
      if (!(await repository.deleteExperience(owner(req), id.parse(req.params.id))))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  api.delete(
    "/memories/:id",
    asyncHandler(async (req, res) => {
      if (!(await repository.deleteMemory(owner(req), id.parse(req.params.id))))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  api.get(
    "/spaces",
    asyncHandler(async (req, res) => res.json({ data: await repository.listSpaces(owner(req)) })),
  );
  api.post(
    "/recommendations/:id/feedback",
    asyncHandler(async (req, res) => {
      const input = createRecommendationFeedbackSchema.parse(req.body);
      res.status(201).json({
        data: await repository.createRecommendationFeedback(
          owner(req),
          id.parse(req.params.id),
          input,
        ),
      });
    }),
  );
  api.get(
    "/conversations/primary",
    asyncHandler(async (req, res) =>
      res.json({ data: await repository.getPrimaryConversation(owner(req)) }),
    ),
  );
  api.get(
    "/conversations/:id/messages",
    asyncHandler(async (req, res) => {
      const conversation = await repository.getPrimaryConversation(owner(req));
      if (conversation.id !== id.parse(req.params.id))
        throw new HttpError(404, "NOT_FOUND", "Conversation not found");
      const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
      res.json({ data: await repository.listMessages(owner(req), conversation.id, limit) });
    }),
  );
  api.post(
    "/companion/messages",
    asyncHandler(async (req, res) => {
      const body = companionRequestSchema.parse(req.body);
      res.status(201).json({
        data: await companion.send(owner(req), body.content, body.source_channel),
      });
    }),
  );
  api.post("/companion/messages/stream", (req, res, next) => {
    void (async () => {
      try {
        const body = companionRequestSchema.parse(req.body);
        beginCompanionSse(res);
        const data = await companion.send(
          owner(req),
          body.content,
          body.source_channel,
          undefined,
          { onAnswerDelta: (answer) => writeSse(res, { type: "delta", answer }) },
        );
        writeSse(res, { type: "done", data });
        res.end();
      } catch (error) {
        if (res.headersSent) {
          writeSse(res, {
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          });
          res.end();
          return;
        }
        next(error);
      }
    })();
  });
  api.post(
    "/companion/messages/retry",
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          source_channel: messageSourceChannelSchema.exclude(["system"]).default("mini_app"),
        })
        .strict()
        .parse(req.body ?? {});
      res.status(201).json({
        data: await companion.retry(owner(req), body.source_channel),
      });
    }),
  );
  api.post("/companion/messages/retry/stream", (req, res, next) => {
    void (async () => {
      try {
        const body = z
          .object({
            source_channel: messageSourceChannelSchema.exclude(["system"]).default("mini_app"),
          })
          .strict()
          .parse(req.body ?? {});
        beginCompanionSse(res);
        const data = await companion.retry(owner(req), body.source_channel, {
          onAnswerDelta: (answer) => writeSse(res, { type: "delta", answer }),
        });
        writeSse(res, { type: "done", data });
        res.end();
      } catch (error) {
        if (res.headersSent) {
          writeSse(res, {
            type: "error",
            error: error instanceof Error ? error.message : String(error),
          });
          res.end();
          return;
        }
        next(error);
      }
    })();
  });
  api.post(
    "/companion/guided-intro",
    asyncHandler(async (req, res) => {
      const { answer } = z
        .object({ answer: z.string().trim().min(1).max(4000).optional() })
        .parse(req.body ?? {});
      const ownerId = owner(req);
      const profile = await repository.getProfile(ownerId);
      const extract = async (text: string, locale: string) =>
        deps.ai?.extractOnboardingFacts?.(text, locale) ?? {
          memories: [],
          goals: [],
          people: [],
        };
      const data = answer
        ? await continueGuidedIntro(repository, ownerId, answer, profile?.locale, extract)
        : await startOrResumeGuidedIntro(repository, ownerId, profile?.locale);
      res.json({ data });
    }),
  );
  api.get("/import/todoist/status", (_req, res) => {
    res.json({ data: { oauth: todoistConfigured(env) } });
  });
  api.get(
    "/import/todoist/start",
    asyncHandler(async (req, res) => {
      res.json({ data: { url: await todoistAuthorizeUrl(env, owner(req)) } });
    }),
  );
  api.post(
    "/import/todoist/preview",
    asyncHandler(async (req, res) => {
      const { token } = z.object({ token: z.string().trim().min(8).max(200) }).parse(req.body);
      const todoist = deps.todoist ?? createTodoistGateway();
      const session = await previewTodoistImport(repository, owner(req), token, todoist);
      res.status(201).json({ data: publicImportSession(session) });
    }),
  );
  api.post(
    "/import/text/preview",
    asyncHandler(async (req, res) => {
      const { text } = z.object({ text: z.string().trim().min(1).max(20_000) }).parse(req.body);
      const profile = await repository.getProfile(owner(req));
      const session = await previewTextImport(
        repository,
        owner(req),
        text,
        profile?.timezone || "UTC",
      );
      res.status(201).json({ data: publicImportSession(session) });
    }),
  );
  api.get(
    "/import/:id",
    asyncHandler(async (req, res) => {
      res.json({
        data: publicImportSession(
          found(await repository.getImportSession(owner(req), id.parse(req.params.id))),
        ),
      });
    }),
  );
  api.post(
    "/import/:id/confirm",
    asyncHandler(async (req, res) => {
      const { skip_ids } = z
        .object({ skip_ids: z.array(id).max(500).optional() })
        .parse(req.body ?? {});
      const session = await confirmImport(
        repository,
        owner(req),
        id.parse(req.params.id),
        skip_ids ?? [],
      );
      await repository.trackEvents(owner(req), [
        {
          name: "import_confirmed",
          properties: { source: session?.source, ...(session?.log ?? {}) },
        },
      ]);
      res.json({ data: publicImportSession(found(session)) });
    }),
  );
  api.get(
    "/profile/completeness",
    asyncHandler(async (req, res) => {
      res.json({ data: await buildCompleteness(repository, owner(req)) });
    }),
  );
  api.get(
    "/billing/quota",
    asyncHandler(async (req, res) => {
      res.json({ data: await loadQuota(repository, owner(req)) });
    }),
  );
  const requireAdmin = async (ownerId: string) => {
    if (!(await repository.isAdmin(ownerId)))
      throw new HttpError(403, "FORBIDDEN", "Только для администратора");
  };
  const adminView = async () => ({
    enforced: await repository.getQuotaEnforced(),
    plans: await repository.listQuotaPlans(),
  });
  api.get(
    "/admin/quota",
    asyncHandler(async (req, res) => {
      const ownerId = owner(req);
      const isAdmin = await repository.isAdmin(ownerId);
      res.json({ data: { is_admin: isAdmin, ...(isAdmin ? await adminView() : {}) } });
    }),
  );
  api.post(
    "/admin/claim",
    asyncHandler(async (req, res) => {
      const ok = await repository.claimFirstAdmin(owner(req));
      if (!ok) throw new HttpError(403, "FORBIDDEN", "Администратор уже назначен");
      res.json({ data: { is_admin: true, ...(await adminView()) } });
    }),
  );
  api.put(
    "/admin/quota",
    asyncHandler(async (req, res) => {
      await requireAdmin(owner(req));
      const body = z
        .object({
          enforced: z.boolean().optional(),
          plans: z
            .array(
              z
                .object({
                  plan: z.string().min(1).max(31),
                  period: z.enum(["week", "month"]).optional(),
                  period_tokens: z.number().int().min(0).max(1_000_000_000).optional(),
                  window_hours: z.number().int().min(1).max(168).optional(),
                  window_tokens: z.number().int().min(0).max(1_000_000_000).optional(),
                })
                .strict(),
            )
            .max(10)
            .optional(),
        })
        .strict()
        .parse(req.body ?? {});
      if (body.enforced !== undefined) await repository.setQuotaEnforced(body.enforced);
      for (const { plan, ...patch } of body.plans ?? []) {
        if (!(await repository.updateQuotaPlan(plan, patch)))
          throw new HttpError(404, "NOT_FOUND", `Нет тарифа ${plan}`);
      }
      res.json({ data: { is_admin: true, ...(await adminView()) } });
    }),
  );
  api.get(
    "/admin/users/:handle/quota",
    asyncHandler(async (req, res) => {
      await requireAdmin(owner(req));
      const user = await repository.findUserByHandle(String(req.params.handle));
      if (!user) throw new HttpError(404, "NOT_FOUND", "Пользователь не найден");
      res.json({
        data: {
          user: { id: user.id, name: user.name, username: user.username, email: user.email },
          quota: await loadQuota(repository, user.id),
        },
      });
    }),
  );
  api.put(
    "/admin/users/:handle/plan",
    asyncHandler(async (req, res) => {
      await requireAdmin(owner(req));
      const body = z
        .object({
          plan: z.string().min(1).max(31),
          until: z.string().datetime().nullable().optional(),
        })
        .strict()
        .parse(req.body ?? {});
      const user = await repository.findUserByHandle(String(req.params.handle));
      if (!user) throw new HttpError(404, "NOT_FOUND", "Пользователь не найден");
      const plans = await repository.listQuotaPlans();
      if (!plans.some((p) => p.plan === body.plan))
        throw new HttpError(400, "INVALID_VALUE", `Нет тарифа ${body.plan}`);
      await repository.setUserPlan(user.id, body.plan, body.until ?? null);
      res.json({
        data: {
          user: { id: user.id, name: user.name, username: user.username, email: user.email },
          quota: await loadQuota(repository, user.id),
        },
      });
    }),
  );
  api.get(
    "/billing/usage",
    asyncHandler(async (req, res) => {
      res.json({ data: await loadUsageSummary(repository, owner(req)) });
    }),
  );
  api.get(
    "/reflections",
    asyncHandler(async (req, res) =>
      res.json({ data: await repository.listReflections(owner(req)) }),
    ),
  );
  api.post(
    "/reflections/weekly",
    asyncHandler(async (req, res) =>
      res.status(201).json({ data: await reflections.weekly(owner(req)) }),
    ),
  );
  api.post(
    "/spaces",
    asyncHandler(async (req, res) =>
      res
        .status(201)
        .json({ data: await repository.createSpace(owner(req), spaceInput.parse(req.body)) }),
    ),
  );
  api.get(
    "/spaces/:id",
    asyncHandler(async (req, res) =>
      res.json({ data: found(await repository.getSpace(owner(req), id.parse(req.params.id))) }),
    ),
  );
  api.patch(
    "/spaces/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(
          await repository.updateSpace(
            owner(req),
            id.parse(req.params.id),
            partial(spaceInput).parse(req.body),
          ),
        ),
      }),
    ),
  );
  api.post(
    "/spaces/:id/people",
    asyncHandler(async (req, res) => {
      const { person_id } = z.object({ person_id: id }).strict().parse(req.body);
      if (!(await repository.setSpacePerson(owner(req), id.parse(req.params.id), person_id, true)))
        throw new HttpError(404, "NOT_FOUND", "Space or person not found");
      res.status(201).json({ data: { person_id } });
    }),
  );
  api.delete(
    "/spaces/:id/people",
    asyncHandler(async (req, res) => {
      const { person_id } = z.object({ person_id: id }).parse(req.body);
      if (!(await repository.setSpacePerson(owner(req), id.parse(req.params.id), person_id, false)))
        throw new HttpError(404, "NOT_FOUND", "Space or person not found");
      res.sendStatus(204);
    }),
  );
  api.get(
    "/tasks",
    asyncHandler(async (req, res) => res.json({ data: await repository.listTasks(owner(req)) })),
  );
  api.post(
    "/tasks",
    asyncHandler(async (req, res) =>
      res
        .status(201)
        .json({ data: await repository.createTask(owner(req), taskInput.parse(req.body)) }),
    ),
  );
  api.patch(
    "/tasks/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(
          await repository.updateTask(
            owner(req),
            id.parse(req.params.id),
            partial(taskInput).parse(req.body),
          ),
        ),
      }),
    ),
  );
  api.get(
    "/recommendations",
    asyncHandler(async (req, res) =>
      res.json({ data: await repository.listRecommendations(owner(req)) }),
    ),
  );
  api.get(
    "/recommendations/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(await repository.getRecommendation(owner(req), id.parse(req.params.id))),
      }),
    ),
  );
  api.get(
    "/mail/accounts",
    asyncHandler(async (req, res) =>
      res.json({ data: await repository.listMailAccounts(owner(req)) }),
    ),
  );
  api.post(
    "/mail/sync",
    asyncHandler(async (req, res) => res.json({ data: await mail.syncOwner(owner(req)) })),
  );
  api.post(
    "/mail/accounts",
    rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }),
    asyncHandler(async (req, res) => {
      const created = await mail.connect(owner(req), mailConnectInput.parse(req.body));
      res.status(201).json({ data: created });
    }),
  );
  api.post(
    "/mail/accounts/:id/sync",
    asyncHandler(async (req, res) => {
      const items = await mail.syncAccount(owner(req), id.parse(req.params.id));
      res.json({ data: { synced: items.length } });
    }),
  );
  api.delete(
    "/mail/accounts/:id",
    asyncHandler(async (req, res) => {
      if (!(await mail.disconnect(owner(req), id.parse(req.params.id))))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  api.get(
    "/mail/messages",
    asyncHandler(async (req, res) =>
      res.json({ data: await repository.listMailMessages(owner(req)) }),
    ),
  );
  api.post(
    "/mail/messages/:id/handled",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(
          await repository.updateMailMessage(owner(req), id.parse(req.params.id), {
            handled: true,
          }),
        ),
      }),
    ),
  );
  api.post(
    "/mail/messages/:id/draft",
    asyncHandler(async (req, res) => {
      const draft = await mail.prepareReply(
        owner(req),
        id.parse(req.params.id),
        mailDraftInput.parse(req.body ?? {}),
      );
      res.status(201).json({ data: draft });
    }),
  );
  api.post(
    "/mail/messages/:id/task",
    asyncHandler(async (req, res) => {
      const message = found(await repository.getMailMessage(owner(req), id.parse(req.params.id)));
      const { meetingTaskTitle } = await import("./modules/mail/classify.js");
      const task = await repository.createTask(owner(req), {
        title: meetingTaskTitle(message.subject, message.from_name),
        description: message.snippet.slice(0, 400) || null,
        due_at: message.meeting_at,
      });
      await repository.updateMailMessage(owner(req), message.id, { handled: true });
      res.status(201).json({ data: task });
    }),
  );
  api.get(
    "/mail/drafts",
    asyncHandler(async (req, res) =>
      res.json({ data: await repository.listMailDrafts(owner(req)) }),
    ),
  );
  api.patch(
    "/mail/drafts/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(
          await repository.updateMailDraft(
            owner(req),
            id.parse(req.params.id),
            mailDraftInput.parse(req.body),
          ),
        ),
      }),
    ),
  );
  api.post(
    "/mail/drafts/:id/send",
    asyncHandler(async (req, res) => {
      const sent = await mail.sendDraft(owner(req), id.parse(req.params.id));
      res.json({ data: sent });
    }),
  );
  api.delete(
    "/mail/drafts/:id",
    asyncHandler(async (req, res) => {
      if (!(await repository.deleteMailDraft(owner(req), id.parse(req.params.id))))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  api.get(
    "/mail/playbooks",
    asyncHandler(async (req, res) =>
      res.json({ data: await repository.listMailPlaybooks(owner(req)) }),
    ),
  );
  api.post(
    "/mail/playbooks",
    asyncHandler(async (req, res) => {
      const input = mailPlaybookInput.parse(req.body);
      if (!input.name || !input.trigger || !input.actions?.length)
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Playbook name, trigger and actions are required",
        );
      res.status(201).json({
        data: await repository.createMailPlaybook(owner(req), {
          name: input.name,
          trigger: input.trigger,
          actions: input.actions,
          prompt: input.prompt ?? null,
          enabled: input.enabled ?? true,
          account_id: input.account_id ?? null,
        }),
      });
    }),
  );
  api.patch(
    "/mail/playbooks/:id",
    asyncHandler(async (req, res) =>
      res.json({
        data: found(
          await repository.updateMailPlaybook(
            owner(req),
            id.parse(req.params.id),
            mailPlaybookInput.parse(req.body),
          ),
        ),
      }),
    ),
  );
  api.delete(
    "/mail/playbooks/:id",
    asyncHandler(async (req, res) => {
      if (!(await repository.deleteMailPlaybook(owner(req), id.parse(req.params.id))))
        throw new HttpError(404, "NOT_FOUND", "Resource not found");
      res.sendStatus(204);
    }),
  );
  app.use("/api", api);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
