import { useEffect, useState } from "react";
import { SESSION_KEY } from "../auth";
import { useI18n } from "../i18n";
import { startOAuth, OAUTH_PROVIDERS, type OAuthProvider } from "../supabase";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

const LABEL_KEY: Record<OAuthProvider, string> = {
  google: "auth.continueGoogle",
  apple: "auth.continueApple",
  yandex: "auth.continueYandex",
};

/**
 * Вход без Telegram на бэкенде работал давно — `/api/auth/oauth/:provider/start`
 * и `startOAuth` уже были написаны, — но ни одна кнопка их не вызывала: на
 * экране входа жил только Telegram. Для российского пользователя это ломало
 * главное обещание продукта («открывается без VPN») ровно в первой точке
 * воронки. Показываем только те способы, которые реально настроены в проде.
 */
export function useOAuthProviders(enabled = true) {
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    void fetch(`${API_BASE}/api/auth/oauth/providers`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { data?: Record<string, unknown> } | null) => {
        if (!active || !body?.data) return;
        setProviders(OAUTH_PROVIDERS.filter((provider) => body.data![provider] === true));
      })
      .catch(() => {
        // Нет ответа — просто не предлагаем альтернативу, Telegram остаётся.
      });
    return () => {
      active = false;
    };
  }, [enabled]);
  return providers;
}

function storedSessionToken(): string | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    const token = raw ? (JSON.parse(raw) as { token?: unknown }).token : null;
    return typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

/**
 * keepSession — для гостя: вход привязывается к текущей гостевой сессии, и всё,
 * что он успел завести, остаётся с ним. Без сессии это обычный вход.
 */
export function OAuthButtons({
  providers,
  keepSession,
  className = "mt-4 flex flex-col gap-2",
}: {
  providers: OAuthProvider[];
  keepSession?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  if (!providers.length) return null;
  return (
    <div className={className}>
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          className="button button-secondary"
          onClick={() => {
            const token = keepSession ? storedSessionToken() : null;
            if (token) startOAuth(provider, "link", token);
            else startOAuth(provider, "login");
          }}
        >
          {t(LABEL_KEY[provider])}
        </button>
      ))}
    </div>
  );
}
