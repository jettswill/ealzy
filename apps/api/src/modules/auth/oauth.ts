import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import type { AppRepository } from "../../repository.js";
import { HttpError } from "../../middleware.js";
import { createSession, verifySession } from "./index.js";

export const OAUTH_PROVIDERS = ["google", "apple", "yandex"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export type OAuthEnv = {
  TELEGRAM_MINI_APP_URL: string;
  SESSION_SECRET: string;
  SESSION_TTL_SECONDS: number;
  PUBLIC_APP_URL?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  APPLE_OAUTH_CLIENT_ID?: string;
  APPLE_OAUTH_CLIENT_SECRET?: string;
  APPLE_OAUTH_REDIRECT_URI?: string;
  YANDEX_OAUTH_CLIENT_ID?: string;
  YANDEX_OAUTH_CLIENT_SECRET?: string;
  YANDEX_OAUTH_REDIRECT_URI?: string;
};

/** Куда вернуть человека после входа: сайт или iOS-приложение (ealzy://). */
export const OAUTH_CLIENTS = ["web", "ios"] as const;
export type OAuthClient = (typeof OAUTH_CLIENTS)[number];
export const IOS_APP_CALLBACK = "ealzy://auth/callback";

const stateSchema = z.object({
  provider: z.enum(OAUTH_PROVIDERS),
  intent: z.enum(["login", "link"]),
  ownerId: z.string().uuid().optional(),
  client: z.enum(OAUTH_CLIENTS).optional(),
});

function appUrl(env: OAuthEnv) {
  return (env.PUBLIC_APP_URL || env.TELEGRAM_MINI_APP_URL).replace(/\/$/, "");
}

function key(secret: string) {
  return new TextEncoder().encode(secret);
}

export function oauthIdentityId(provider: string, subject: string) {
  const hex = createHash("sha256").update(`ealzy:${provider}:${subject}`).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

export function configuredOAuthProviders(env: OAuthEnv): Record<OAuthProvider, boolean> {
  return {
    google: Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
    apple: Boolean(env.APPLE_OAUTH_CLIENT_ID && env.APPLE_OAUTH_CLIENT_SECRET),
    yandex: Boolean(env.YANDEX_OAUTH_CLIENT_ID && env.YANDEX_OAUTH_CLIENT_SECRET),
  };
}

function providerConfig(env: OAuthEnv, provider: OAuthProvider) {
  const origin = appUrl(env);
  const configs = {
    google: {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI || `${origin}/api/integrations/google/callback`,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scope: "openid email profile",
      extraAuthorize: { access_type: "online", prompt: "select_account" },
    },
    apple: {
      clientId: env.APPLE_OAUTH_CLIENT_ID,
      clientSecret: env.APPLE_OAUTH_CLIENT_SECRET,
      redirectUri: env.APPLE_OAUTH_REDIRECT_URI || `${origin}/api/auth/oauth/apple/callback`,
      authorizeUrl: "https://appleid.apple.com/auth/authorize",
      tokenUrl: "https://appleid.apple.com/auth/token",
      scope: "name email",
      extraAuthorize: { response_mode: "form_post" },
    },
    yandex: {
      clientId: env.YANDEX_OAUTH_CLIENT_ID,
      clientSecret: env.YANDEX_OAUTH_CLIENT_SECRET,
      redirectUri: env.YANDEX_OAUTH_REDIRECT_URI || `${origin}/api/auth/oauth/yandex/callback`,
      authorizeUrl: "https://oauth.yandex.com/authorize",
      tokenUrl: "https://oauth.yandex.com/token",
      scope: "login:email login:info",
      extraAuthorize: { force_confirm: "yes" },
    },
  } as const;
  const config = configs[provider];
  if (!config.clientId || !config.clientSecret) {
    throw new HttpError(400, "OAUTH_NOT_CONFIGURED", `${provider} sign-in is not configured`);
  }
  return { ...config, clientId: config.clientId, clientSecret: config.clientSecret };
}

export async function startOAuthUrl(
  env: OAuthEnv,
  provider: OAuthProvider,
  intent: "login" | "link",
  sessionToken?: string,
  client: OAuthClient = "web",
) {
  const config = providerConfig(env, provider);
  let ownerId: string | undefined;
  if (intent === "link") {
    if (!sessionToken) throw new HttpError(401, "AUTH_REQUIRED", "Authentication required");
    ownerId = await verifySession(sessionToken, env.SESSION_SECRET);
  }
  const state = await new SignJWT({ provider, intent, ownerId, ...(client === "web" ? {} : { client }) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key(env.SESSION_SECRET));
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  for (const [name, value] of Object.entries(config.extraAuthorize)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

/** Клиент из state без проверки остального — чтобы даже ошибку вернуть в нужное приложение. */
export async function oauthClientFromState(env: OAuthEnv, state: unknown): Promise<OAuthClient> {
  if (typeof state !== "string") return "web";
  try {
    return (await readState(env, state)).client ?? "web";
  } catch {
    return "web";
  }
}

async function readState(env: OAuthEnv, state: string) {
  try {
    const { payload } = await jwtVerify(state, key(env.SESSION_SECRET), { algorithms: ["HS256"] });
    return stateSchema.parse(payload);
  } catch {
    throw new HttpError(401, "INVALID_OAUTH_STATE", "Sign-in expired. Try again.");
  }
}

async function formRequest(url: string, body: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new HttpError(401, "OAUTH_TOKEN_FAILED", "Could not complete sign-in");
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new HttpError(401, "OAUTH_TOKEN_FAILED", "Could not complete sign-in");
  }
}

function decodeJwtPayload(token: string) {
  const part = token.split(".")[1];
  if (!part) return {};
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function fetchIdentity(
  provider: OAuthProvider,
  env: OAuthEnv,
  code: string,
): Promise<{ subject: string; email?: string; name: string }> {
  const config = providerConfig(env, provider);
  const token = await formRequest(config.tokenUrl, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });
  const accessToken = z.string().min(1).parse(token.access_token);
  if (provider === "google") {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const profile = (await response.json()) as {
      sub?: string;
      email?: string;
      name?: string;
    };
    if (!response.ok || !profile.sub) {
      throw new HttpError(401, "OAUTH_PROFILE_FAILED", "Could not read Google profile");
    }
    return {
      subject: profile.sub,
      email: profile.email,
      name: profile.name?.trim() || profile.email?.split("@")[0] || "Google user",
    };
  }
  if (provider === "yandex") {
    const response = await fetch("https://login.yandex.ru/info?format=json", {
      headers: { authorization: `OAuth ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const profile = (await response.json()) as {
      id?: string;
      default_email?: string;
      real_name?: string;
      display_name?: string;
      login?: string;
    };
    if (!response.ok || !profile.id) {
      throw new HttpError(401, "OAUTH_PROFILE_FAILED", "Could not read Yandex profile");
    }
    return {
      subject: String(profile.id),
      email: profile.default_email,
      name:
        profile.real_name?.trim() ||
        profile.display_name?.trim() ||
        profile.login?.trim() ||
        "Yandex user",
    };
  }
  const idToken = z.string().min(1).optional().parse(token.id_token);
  const claims = idToken ? decodeJwtPayload(idToken) : {};
  const subject = z.string().min(1).parse(claims.sub);
  const email = typeof claims.email === "string" ? claims.email : undefined;
  return {
    subject,
    email,
    name: email?.split("@")[0] || "Apple user",
  };
}

export async function completeOAuth(
  repository: AppRepository,
  env: OAuthEnv,
  input: { provider: OAuthProvider; code?: string; state?: string; error?: string },
) {
  if (input.error) {
    throw new HttpError(401, "OAUTH_DENIED", "Sign-in was cancelled");
  }
  if (!input.code || !input.state) {
    throw new HttpError(400, "OAUTH_INVALID_CALLBACK", "Missing sign-in data");
  }
  const state = await readState(env, input.state);
  if (state.provider !== input.provider) {
    throw new HttpError(401, "INVALID_OAUTH_STATE", "Sign-in expired. Try again.");
  }
  const identity = await fetchIdentity(input.provider, env, input.code);
  const authUserId = oauthIdentityId(input.provider, identity.subject);
  if (state.intent === "link") {
    if (!state.ownerId) throw new HttpError(401, "AUTH_REQUIRED", "Authentication required");
    const owner = await repository.getUser(state.ownerId);
    const result = await repository.linkAuthUser(state.ownerId, authUserId, identity.email ?? null);
    if (result.status === "not_found") throw new HttpError(404, "USER_NOT_FOUND", "User not found");
    // Гость, который нажал «Продолжить с Google» в баннере. Если вход свободен —
    // гость становится обычным аккаунтом и сохраняет всё, что успел завести.
    // Если этим входом уже пользуется другой аккаунт — человек вернулся на новом
    // устройстве: пускаем его в свой аккаунт, а не показываем ошибку привязки.
    // В обоих случаях нужен новый токен: в старом зашита пометка гостя.
    if (owner?.is_guest === true && (result.status === "linked" || result.status === "auth_conflict")) {
      const user = await repository.upsertOAuthUser({
        auth_user_id: authUserId,
        email: identity.email ?? null,
        name: identity.name,
      });
      return {
        kind: "session" as const,
        token: await createSession(user.id, env.SESSION_SECRET, env.SESSION_TTL_SECONDS),
      };
    }
    if (result.status !== "linked") {
      throw new HttpError(
        409,
        "OAUTH_LINK_CONFLICT",
        "This sign-in is already used by another account",
      );
    }
    return { kind: "linked" as const };
  }
  const user = await repository.upsertOAuthUser({
    auth_user_id: authUserId,
    email: identity.email ?? null,
    name: identity.name,
  });
  return {
    kind: "session" as const,
    token: await createSession(user.id, env.SESSION_SECRET, env.SESSION_TTL_SECONDS),
  };
}

export function oauthAppRedirect(
  env: OAuthEnv,
  result: Awaited<ReturnType<typeof completeOAuth>> | { kind: "error"; message: string },
  client: OAuthClient = "web",
) {
  if (client === "ios") {
    if (result.kind === "linked") return `${IOS_APP_CALLBACK}#linked=1`;
    if (result.kind === "session") return `${IOS_APP_CALLBACK}#token=${encodeURIComponent(result.token)}`;
    return `${IOS_APP_CALLBACK}#error=${encodeURIComponent(result.message)}`;
  }
  const origin = appUrl(env);
  if (result.kind === "linked") return `${origin}/auth/callback#linked=1`;
  if (result.kind === "session") return `${origin}/auth/callback#token=${encodeURIComponent(result.token)}`;
  return `${origin}/auth/callback#error=${encodeURIComponent(result.message)}`;
}
