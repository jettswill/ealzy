import { z } from "zod";

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGIN: z.string().default("*"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[\w-]+$/),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16),
  TELEGRAM_MINI_APP_URL: z.string().url(),
  TELEGRAM_POLLING: z.enum(["true", "false"]).optional(),
  // Имя бота для ссылки входа в iOS-приложение; берётся из того же .env, что и сайт.
  TELEGRAM_BOT_USERNAME: z.string().min(1).optional(),
  VITE_TELEGRAM_BOT_USERNAME: z.string().min(1).optional(),
  // HTTPS-прокси к Bot API вместо api.telegram.org; не задан — ходим напрямую.
  TELEGRAM_API_BASE_URL: z.string().url().optional(),
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86_400),
  TELEGRAM_LOGIN_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86_400),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(7_776_000).default(2_592_000),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.string().url().default("https://api.zveno.ai/v1"),
  OPENAI_MODEL: z.string().default("openai/gpt-4.1"),
  // Модель для разговора с Илзи; не задана — используется OPENAI_MODEL.
  OPENAI_COMPANION_MODEL: z.string().min(1).optional(),
  OPENAI_WEB_MODEL: z.string().min(1).optional(),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default("openai/gpt-4o-mini-transcribe"),
  CRON_SECRET: z.string().min(16).optional(),
  PUBLIC_APP_URL: z.string().url().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  APPLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  APPLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  APPLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  YANDEX_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  YANDEX_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  YANDEX_OAUTH_REDIRECT_URI: z.string().url().optional(),
  MAIL_ENCRYPTION_KEY: z.string().min(32).optional(),
  // Push в iOS-приложение (ключ .p8 из Apple Developer). Без них push просто выключен.
  APNS_KEY_ID: z.string().min(1).optional(),
  APNS_TEAM_ID: z.string().min(1).optional(),
  APNS_PRIVATE_KEY: z.string().min(1).optional(),
  APNS_BUNDLE_ID: z.string().min(1).optional(),
  TODOIST_CLIENT_ID: z.string().min(1).optional(),
  TODOIST_CLIENT_SECRET: z.string().min(1).optional(),
  TODOIST_REDIRECT_URI: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const normalized = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, value === "" ? undefined : value]),
  );
  const parsed = EnvSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
