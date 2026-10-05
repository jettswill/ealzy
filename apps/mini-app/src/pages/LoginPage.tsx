import { useAuth } from "../auth";
import { EalzyWordmark } from "../components/EalzyLogo";
import { OAuthButtons, useOAuthProviders } from "../components/OAuthButtons";
import { TelegramLoginButton } from "../components/TelegramLogin";
import { Button } from "../components/ui";
import { LanguageSwitcher, useI18n } from "../i18n";

export function LoginPage() {
  const { error, retry } = useAuth();
  const { t } = useI18n();
  const providers = useOAuthProviders();

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="flex items-center justify-between gap-4">
          <EalzyWordmark className="auth-logo" />
          <LanguageSwitcher />
        </div>
        <h1 className="mt-8 text-[1.85rem] font-semibold leading-tight tracking-[-0.04em]">
          {t("auth.title")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t("auth.lead")}</p>
        <div className="mt-8">
          {/* Пока настроен хотя бы один альтернативный вход, совет «включите VPN»
              не нужен и прямо противоречит обещанию «работает без VPN» —
              вместо него ведём человека ко второй кнопке. */}
          <TelegramLoginButton
            label={t("auth.continueTitle")}
            compact={providers.length > 0}
          />
          {providers.length > 0 && (
            <>
              <p className="mt-4 text-center text-xs uppercase tracking-wide text-muted">
                {t("auth.orDivider")}
              </p>
              <OAuthButtons providers={providers} />
              <p className="mt-3 text-sm leading-relaxed text-muted" role="note">
                {t("auth.altHint")}
              </p>
            </>
          )}
        </div>
        {error && (
          <>
            <p className="error-text mt-4" role="alert">
              {error}
            </p>
            <Button className="mt-3" onClick={retry}>
              {t("app.tryAgain")}
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
