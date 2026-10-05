import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { inTelegramWebView } from "../theme";
import { telegramAuthUrl, telegramBotId, telegramBotUsername } from "../telegram-login";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export function TelegramLoginButton({
  label,
  compact,
}: {
  label: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [botId, setBotId] = useState(telegramBotId);
  const botUsername = telegramBotUsername();
  const inTelegram = inTelegramWebView();

  useEffect(() => {
    if (botId) return;
    let active = true;
    void fetch(`${API_BASE}/api/auth/telegram/config`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { data?: { bot_id?: unknown } } | null) => {
        const id = body?.data?.bot_id;
        if (active && typeof id === "string" && /^\d+$/.test(id)) setBotId(id);
      })
      .catch(() => {
        // The local button still works with the bot username fallback.
      });
    return () => {
      active = false;
    };
  }, [botId]);

  if (!botId && !botUsername) {
    return <p className="error-text">{t("auth.notConfigured")}</p>;
  }

  const href = botId ? telegramAuthUrl(botId) : `https://t.me/${botUsername}`;
  const appHref = botUsername ? `tg://resolve?domain=${botUsername}` : "";

  return (
    <div>
      <a className="button button-primary telegram-login-button" href={href}>
        {label}
      </a>
      {!inTelegram && !compact && (
        <>
          <p className="mt-3 text-sm leading-relaxed text-muted" role="note">
            {t("auth.telegramNeedsVpn")}
          </p>
          {appHref && (
            <p className="mt-2 text-sm">
              <a className="text-muted underline-offset-2 hover:underline" href={appHref}>
                {t("auth.openInTelegram")}
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
