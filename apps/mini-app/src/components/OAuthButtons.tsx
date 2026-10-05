import { useEffect, useState } from "react";
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
export function useOAuthProviders() {
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  useEffect(() => {
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
  }, []);
  return providers;
}

export function OAuthButtons({ providers }: { providers: OAuthProvider[] }) {
  const { t } = useI18n();
  if (!providers.length) return null;
  return (
    <div className="mt-4 flex flex-col gap-2">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          className="button button-secondary"
          onClick={() => startOAuth(provider, "login")}
        >
          {t(LABEL_KEY[provider])}
        </button>
      ))}
    </div>
  );
}
