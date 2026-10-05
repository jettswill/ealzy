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
  refreshSession,
  type SupabaseAuthVerifier,
} from "./modules/auth/index.js";
import {
  completeOAuth,
  configuredOAuthProviders,
  oauthAppRedirect,
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
async function mePayload(repository: AppRepository, ownerId: string) {
  const [user, profile, self, conversation, tasks, cohort] = await Promise.all([
    repository.getUser(ownerId),
    repository.getProfile(ownerId),
    repository.getSelfPerson(ownerId),
    repository.getPrimaryConversation(ownerId),
    repository.listTasks(ownerId),
    repository.listReliabilityCohort(),
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
    community: summarizeAchievementHolders(cohort),
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
  >;
  supabaseAuth?: SupabaseAuthVerifier;
  telegram: TelegramGateway;
  ai?: AiProvider;
  discovery?: DiscoveryClient;
  mail?: MailGateway;
  todoist?: TodoistGateway;
}

export function createApp(deps: AppDependencies): Express {
  const { repository, env } = deps;
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
  const scheduled = new ScheduledMessageService(repository, deps.telegram, deps.ai);
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
      const sessionToken =
        typeof req.query.session === "string"
          ? req.query.session
          : (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "") || undefined;
      res.redirect(await startOAuthUrl(env, provider as OAuthProvider, intent, sessionToken));
    }),
  );
  const handleOAuthCallback = (provider: OAuthProvider) =>
    asyncHandler(async (req, res) => {
      const params = { ...(req.query as Record<string, unknown>), ...(req.body as object) };
      try {
        const result = await completeOAuth(repository, env, {
          provider,
          code: typeof params.code === "string" ? params.code : undefined,
          state: typeof params.state === "string" ? params.state : undefined,
          error: typeof params.error === "string" ? params.error : undefined,
        });
        res.redirect(oauthAppRedirect(env, result));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not complete sign-in";
        res.redirect(oauthAppRedirect(env, { kind: "error", message }));
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
      const owned = (await repository.listDates(ownerId, self.id)).some((item) => item.id === dateId);
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
      const owned = (await repository.listDates(ownerId, self.id)).some((item) => item.id === dateId);
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
