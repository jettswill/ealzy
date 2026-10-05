import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { telegramSessionError, useAuth } from "../auth";
import { Button, ErrorState, LoadingState } from "../components/ui";
import { useI18n } from "../i18n";
import { telegramLoginFromSearch } from "../telegram-login";

export function TelegramCallbackPage() {
  const { api, completeSession, status } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    const payload = telegramLoginFromSearch(window.location.search, window.location.hash);
    if (!payload) {
      if (status === "loading") return;
      setError(t("auth.invalid"));
      return;
    }
    started.current = true;
    const linking = status === "authenticated";
    let unmounted = false;
    const run = linking
      ? api
          .linkTelegram(payload)
          .then(() => api.refreshSession())
          .then((session) => {
            completeSession(session);
            return "/profile";
          })
      : api.loginWithTelegram(payload).then((session) => {
          completeSession(session);
          return "/";
        });
    void run
      .then((path) => {
        navigate(path, { replace: true });
      })
      .catch((cause: unknown) => {
        if (unmounted) return;
        started.current = false;
        setError(telegramSessionError(cause));
      });
    return () => {
      unmounted = true;
    };
  }, [api, completeSession, navigate, status, t]);

  if (error) {
    return (
      <main className="auth-shell">
        <div className="auth-panel">
          <ErrorState message={error} />
          <Button className="mx-auto mt-4 block" onClick={() => navigate("/", { replace: true })}>
            {t("auth.backToSignIn")}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <LoadingState label={t("auth.finishing")} />
    </main>
  );
}
