import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { EalzyMark } from "../components/EalzyLogo";
import { Button, ErrorState, LoadingState } from "../components/ui";
import { useI18n } from "../i18n";
import { readOAuthCallback } from "../supabase";

export function AuthCallbackPage() {
  const { completeSession, status } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [state, setState] = useState<"working" | "linked" | "error">("working");
  const [error, setError] = useState("");

  useEffect(() => {
    const callback = readOAuthCallback();
    if (callback.linked) {
      setState("linked");
      return;
    }
    if (callback.error) {
      setError(callback.error);
      setState("error");
      return;
    }
    if (callback.token) {
      completeSession({ token: callback.token });
      navigate("/", { replace: true });
      return;
    }
    setError(t("auth.invalid"));
    setState("error");
  }, [completeSession, navigate, t]);

  if (state === "linked") {
    return (
      <main className="auth-shell">
        <div className="auth-panel text-center">
          <div className="brand-mark mx-auto">
            <EalzyMark />
          </div>
          <h1 className="mt-4 text-2xl font-bold">{t("auth.linkedTitle")}</h1>
          <p className="mt-2 text-muted">{t("auth.linkedLead")}</p>
          <Button className="mt-6" onClick={() => navigate("/profile", { replace: true })}>
            {t("auth.returnProfile")}
          </Button>
        </div>
      </main>
    );
  }

  if (state === "error") {
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

  if (status === "error") return <Navigate to="/" replace />;
  return (
    <main className="auth-shell">
      <LoadingState label={t("auth.finishing")} />
    </main>
  );
}
