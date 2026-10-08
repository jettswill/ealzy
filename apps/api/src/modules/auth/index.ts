import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import type { AppRepository } from "../../repository.js";
import { HttpError } from "../../middleware.js";
import { localeFromLanguageCode } from "../../locale.js";

const TelegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().min(2).max(16).optional(),
});
export type TelegramUser = z.infer<typeof TelegramUserSchema>;

async function applySignupLocale(
  repository: AppRepository,
  ownerId: string,
  createdAt: string,
  languageCode?: string,
) {
  if (!languageCode) return;
  if (Date.now() - Date.parse(createdAt) > 15_000) return;
  const profile = await repository.getProfile(ownerId);
  if (!profile || profile.locale !== "ru") return;
  await repository.updateProfile(ownerId, { locale: localeFromLanguageCode(languageCode) });
}

export function isUsableTimezone(timezone: string | null | undefined): timezone is string {
  if (!timezone) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

async function applyClientTimezone(
  repository: AppRepository,
  ownerId: string,
  createdAt: string,
  timezone?: string,
) {
  if (!isUsableTimezone(timezone)) return;
  if (Date.now() - Date.parse(createdAt) > 15_000) return;
  const profile = await repository.getProfile(ownerId);
  if (!profile) return;
  if (profile.timezone && profile.timezone !== "UTC" && profile.timezone !== "Europe/Moscow") return;
  if (profile.timezone === timezone) return;
  await repository.updateProfile(ownerId, { timezone });
}

/**
 * Веб-вход не проходит через Telegram, поэтому настоящий часовой пояс известен
 * только браузеру. Провижининг ставит таким аккаунтам UTC и выключенные сводки —
 * то есть утренняя сводка у веб-пользователя не работает вообще. Здесь мы
 * забираем пояс из браузера и, если аккаунт ещё ни разу не настраивали,
 * включаем утреннюю сводку: без неё главный механизм продукта до человека
 * не доходит.
 *
 * Пояс перезаписываем только пока он равен провижининговому UTC — это значит
 * «мы его ещё не узнали». Как только записан настоящий пояс, повторные входы
 * ничего не меняют, и выключенную человеком сводку мы обратно не включаем.
 */
export async function applyWebClientContext(
  repository: AppRepository,
  ownerId: string,
  timezone?: string,
): Promise<{ timezone: boolean; morning_digest: boolean }> {
  const applied = { timezone: false, morning_digest: false };
  if (!isUsableTimezone(timezone)) return applied;
  const profile = await repository.getProfile(ownerId);
  if (!profile) return applied;
  if (profile.timezone && profile.timezone !== "UTC") return applied;
  if (profile.timezone !== timezone) {
    await repository.updateProfile(ownerId, { timezone });
    applied.timezone = true;
  }
  const user = await repository.getUser(ownerId);
  if (!user || user.telegram_id) return applied;
  const fresh = Date.now() - Date.parse(user.created_at) <= 60_000;
  if (!profile.morning_digest_enabled && (applied.timezone || fresh)) {
    await repository.updateProfile(ownerId, { morning_digest_enabled: true });
    applied.morning_digest = true;
  }
  return applied;
}

const emptyToUndef = (value: unknown) => (value === "" || value == null ? undefined : value);

const TelegramLoginSchema = TelegramUserSchema.extend({
  auth_date: z.coerce.number().int().positive(),
  hash: z.string().regex(/^[a-f0-9]{64}$/i),
  photo_url: z.preprocess(emptyToUndef, z.string().min(1).optional()),
});
export type TelegramLogin = z.input<typeof TelegramLoginSchema>;

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): TelegramUser {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash))
    throw new HttpError(401, "INVALID_INIT_DATA", "Invalid Telegram signature");
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  const actual = Buffer.from(hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new HttpError(401, "INVALID_INIT_DATA", "Invalid Telegram signature");
  const authDate = Number(params.get("auth_date"));
  if (
    !Number.isInteger(authDate) ||
    authDate > nowSeconds + 30 ||
    nowSeconds - authDate > maxAgeSeconds
  )
    throw new HttpError(401, "EXPIRED_INIT_DATA", "Telegram init data expired");
  try {
    return TelegramUserSchema.parse(JSON.parse(params.get("user") ?? ""));
  } catch {
    throw new HttpError(401, "INVALID_INIT_DATA", "Invalid Telegram user");
  }
}

function telegramLoginCheckString(values: Record<string, unknown>) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join("\n");
}

export function verifyTelegramLogin(
  input: TelegramLogin,
  botToken: string,
  maxAgeSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): TelegramUser {
  const login = TelegramLoginSchema.parse(input);
  const received = { ...(input as Record<string, unknown>) };
  delete received.hash;
  const withoutPhoto = { ...received };
  delete withoutPhoto.photo_url;
  const secret = createHash("sha256").update(botToken).digest();
  const actual = Buffer.from(login.hash, "hex");
  const matched = [received, withoutPhoto].some((values) => {
    const expected = createHmac("sha256", secret)
      .update(telegramLoginCheckString(values))
      .digest();
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!matched) throw new HttpError(401, "INVALID_TELEGRAM_LOGIN", "Invalid Telegram signature");
  if (login.auth_date > nowSeconds + 30 || nowSeconds - login.auth_date > maxAgeSeconds)
    throw new HttpError(401, "EXPIRED_TELEGRAM_LOGIN", "Telegram login expired");
  return TelegramUserSchema.parse(login);
}

const key = (secret: string) => new TextEncoder().encode(secret);
export async function createSession(
  ownerId: string,
  secret: string,
  ttlSeconds: number,
  extra: { isGuest?: boolean } = {},
) {
  return new SignJWT({ ownerId, ...(extra.isGuest ? { isGuest: true } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(ownerId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(secret));
}
export async function verifySession(token: string, secret: string) {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ["HS256"] });
    return z.string().uuid().parse(payload.ownerId);
  } catch {
    throw new HttpError(401, "INVALID_SESSION", "Invalid or expired session");
  }
}

declare global {
  namespace Express {
    interface Request {
      ownerId?: string;
    }
  }
}
export const authMiddleware =
  (sessionSecret: string) => async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const [scheme, token] = (req.header("authorization") ?? "").split(" ");
      if (scheme !== "Bearer" || !token)
        throw new HttpError(401, "AUTH_REQUIRED", "Authentication required");
      req.ownerId = await verifySession(token, sessionSecret);
      next();
    } catch (error) {
      next(error);
    }
  };

export async function exchangeInitData(
  repository: AppRepository,
  initData: string,
  config: {
    botToken: string;
    maxAgeSeconds: number;
    sessionSecret: string;
    sessionTtlSeconds: number;
    clientTimezone?: string;
  },
) {
  const identity = verifyTelegramInitData(initData, config.botToken, config.maxAgeSeconds);
  const user = await repository.upsertTelegramUser({
    telegram_id: identity.id,
    name: [identity.first_name, identity.last_name].filter(Boolean).join(" "),
    username: identity.username ?? null,
  });
  await applySignupLocale(repository, user.id, user.created_at, identity.language_code);
  await applyClientTimezone(repository, user.id, user.created_at, config.clientTimezone);
  return {
    token: await createSession(user.id, config.sessionSecret, config.sessionTtlSeconds),
    expires_at: new Date(Date.now() + config.sessionTtlSeconds * 1000).toISOString(),
    user,
  };
}

export async function refreshSession(
  repository: AppRepository,
  ownerId: string,
  config: SessionConfig,
) {
  return sessionForUser(await repository.getUser(ownerId), config);
}

type SessionConfig = {
  sessionSecret: string;
  sessionTtlSeconds: number;
};

async function sessionForUser(
  user: Awaited<ReturnType<AppRepository["getUser"]>>,
  config: SessionConfig,
) {
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  return {
    token: await createSession(user.id, config.sessionSecret, config.sessionTtlSeconds, {
      isGuest: user.is_guest === true,
    }),
    expires_at: new Date(Date.now() + config.sessionTtlSeconds * 1000).toISOString(),
    user,
  };
}

export async function exchangeGuestUser(
  repository: AppRepository,
  config: SessionConfig & { timezone?: string; locale?: string },
) {
  const ru = (config.locale ?? "ru") !== "en";
  const user = await repository.createGuestUser({ name: ru ? "Гость" : "Guest" });
  await applyClientTimezone(repository, user.id, user.created_at, config.timezone);
  return sessionForUser(user, config);
}

export async function exchangeTelegramLogin(
  repository: AppRepository,
  input: TelegramLogin,
  config: SessionConfig & {
    botToken: string;
    maxAgeSeconds: number;
  },
) {
  const identity = verifyTelegramLogin(input, config.botToken, config.maxAgeSeconds);
  const user = await repository.upsertTelegramUser({
    telegram_id: identity.id,
    name: [identity.first_name, identity.last_name].filter(Boolean).join(" "),
    username: identity.username ?? null,
  });
  await applySignupLocale(repository, user.id, user.created_at, identity.language_code);
  return sessionForUser(user, config);
}

export interface SupabaseAuthUser {
  id: string;
  email?: string;
  name?: string;
  user_metadata?: { full_name?: string; name?: string };
}

export interface SupabaseAuthVerifier {
  getUser(accessToken: string): Promise<{
    data: { user: SupabaseAuthUser | null };
    error: unknown;
  }>;
}

function displayName(user: SupabaseAuthUser): string {
  const fromMetadata = user.user_metadata?.full_name?.trim() || user.user_metadata?.name?.trim();
  const fromEmail = user.email?.split("@")[0]?.trim();
  return user.name?.trim() || fromMetadata || fromEmail || "User";
}

export async function verifySupabaseUser(
  auth: SupabaseAuthVerifier,
  accessToken: string,
): Promise<Required<Pick<SupabaseAuthUser, "id">> & { email?: string; name: string }> {
  const { data, error } = await auth.getUser(accessToken);
  if (error || !data.user)
    throw new HttpError(401, "INVALID_SUPABASE_TOKEN", "Invalid sign-in token");
  return {
    id: z.string().uuid().parse(data.user.id),
    email: data.user.email ? z.string().email().parse(data.user.email) : undefined,
    name: displayName(data.user),
  };
}

export async function exchangeOAuthUser(
  repository: AppRepository,
  auth: SupabaseAuthVerifier,
  accessToken: string,
  config: SessionConfig & { timezone?: string },
) {
  const identity = await verifySupabaseUser(auth, accessToken);
  const user = await repository.upsertOAuthUser({
    auth_user_id: identity.id,
    email: identity.email ?? null,
    name: identity.name,
  });
  await applyWebClientContext(repository, user.id, config.timezone);
  return sessionForUser(user, config);
}

export async function exchangeEmailUser(
  repository: AppRepository,
  auth: SupabaseAuthVerifier,
  accessToken: string,
  config: SessionConfig & { timezone?: string },
) {
  return exchangeOAuthUser(repository, auth, accessToken, config);
}

export async function linkOAuthUser(
  repository: AppRepository,
  auth: SupabaseAuthVerifier,
  ownerId: string,
  accessToken: string,
) {
  const identity = await verifySupabaseUser(auth, accessToken);
  const result = await repository.linkAuthUser(ownerId, identity.id, identity.email ?? null);
  if (result.status === "not_found") throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  if (result.status === "owner_conflict")
    throw new HttpError(
      409,
      "OAUTH_LINK_CONFLICT",
      "This account is already linked to another sign-in",
    );
  if (result.status !== "linked")
    throw new HttpError(
      409,
      "OAUTH_LINK_CONFLICT",
      "This sign-in is already used by another account",
    );
  return result.user;
}

export async function linkEmailUser(
  repository: AppRepository,
  auth: SupabaseAuthVerifier,
  ownerId: string,
  accessToken: string,
) {
  return linkOAuthUser(repository, auth, ownerId, accessToken);
}

export async function linkTelegramLogin(
  repository: AppRepository,
  ownerId: string,
  input: TelegramLogin,
  config: { botToken: string; maxAgeSeconds: number },
) {
  const identity = verifyTelegramLogin(input, config.botToken, config.maxAgeSeconds);
  const result = await repository.linkTelegramUser(ownerId, {
    telegram_id: identity.id,
    name: [identity.first_name, identity.last_name].filter(Boolean).join(" "),
    username: identity.username ?? null,
  });
  if (result.status === "not_found") throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  if (result.status === "owner_conflict")
    throw new HttpError(
      409,
      "TELEGRAM_LINK_CONFLICT",
      "This account already has a Telegram identity",
    );
  if (result.status !== "linked")
    throw new HttpError(409, "TELEGRAM_LINK_CONFLICT", "This Telegram account is already in use");
  // Привязали Telegram к веб-аккаунту — утренняя сводка должна начать приходить
  // туда сама. Раньше она включалась только у тех, кто начинал с бота.
  const profile = await repository.getProfile(ownerId);
  if (profile && !profile.morning_digest_enabled && !profile.last_morning_digest_on) {
    await repository.updateProfile(ownerId, { morning_digest_enabled: true });
  }
  return result.user;
}
