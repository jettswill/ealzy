export const OAUTH_PROVIDERS = ["google", "apple", "yandex"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

const apiBase = () =>
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export function oauthStartUrl(
  provider: OAuthProvider,
  intent: "login" | "link",
  sessionToken?: string | null,
) {
  const url = new URL(`${apiBase()}/api/auth/oauth/${provider}/start`, window.location.origin);
  url.searchParams.set("intent", intent);
  if (intent === "link" && sessionToken) url.searchParams.set("session", sessionToken);
  return url.toString();
}

export function startOAuth(
  provider: OAuthProvider,
  intent: "login" | "link",
  sessionToken?: string | null,
) {
  window.location.assign(oauthStartUrl(provider, intent, sessionToken));
}

export function readOAuthCallback() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  return {
    token: hash.get("token") || query.get("token"),
    linked: hash.get("linked") === "1" || query.get("linked") === "1",
    error: hash.get("error") || query.get("error"),
  };
}
