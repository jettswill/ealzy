import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { detectTimeZone } from "../i18n/locale";
import { trackEvent } from "../analytics";
import { Button, Field } from "./ui";
import { EalzyMark } from "./EalzyLogo";

// Часовой пояс больше не спрашиваем отдельным шагом: он определяется по
// браузеру и сохраняется вместе с первым ответом, а поменять его можно в профиле.
const STEPS = ["work", "goal"] as const;

export function OnboardingFlow({
  onComplete,
  onSkip,
}: {
  onComplete: () => void;
  onSkip: () => void;
}) {
  const { api } = useAuth();
  const { t, locale, setAddress } = useI18n();
  const [showIntro, setShowIntro] = useState(true);
  // «Ты» или «вы» человек выбирает сам на первом экране; от выбора зависят
  // вопросы знакомства и то, как Илзи обращается дальше. В английском выбора нет.
  const russian = locale.toLowerCase().startsWith("ru");
  const [formal, setFormal] = useState(false);
  const start = (address?: "ты" | "вы") => {
    if (address) {
      setFormal(address === "вы");
      setAddress(address);
      void api.updateMe({ communication_style: `на ${address}` }).catch(() => {
        // Не сохранилось — Илзи спросит об этом в разговоре.
      });
      trackEvent("onboarding_address", { address });
    }
    setShowIntro(false);
  };
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const detected = detectTimeZone();

  const stepLabels = [t("profile.stepWork"), t("profile.stepGoal")];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const current = STEPS[step];
      if (current === "work") {
        const text = String(form.get("work")).trim();
        if (text) {
          await api.updateMe({ bio: text, timezone: detected });
          await api.createSelfMemory({
            content: text,
            category: "important_fact",
            importance: 4,
            confidence: 1,
          });
        }
      } else if (current === "goal") {
        const title = String(form.get("goal")).trim();
        if (title) {
          await api.createGoal({ title, priority: 4 });
        }
      }
      trackEvent(`onboarding_step_${step + 1}`, { step: STEPS[step] });
      if (step < STEPS.length - 1) {
        setStep(step + 1);
        setSaving(false);
      } else {
        await api.updateMe({
          onboarding_completed_at: new Date().toISOString(),
        });
        trackEvent("onboarding_complete", { skipped: false });
        onComplete();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveFailed"));
      setSaving(false);
    }
  };

  // Skipping (from the intro or from any step) never tells the server onboarding
  // finished — it just stops blocking this session, so the empty tasks page can
  // still offer to pick it back up later (see reopenOnboarding).
  const skip = (fromStep: "intro" | (typeof STEPS)[number]) => {
    trackEvent("onboarding_skipped", { step: fromStep });
    onSkip();
  };

  if (showIntro) {
    return (
      <main className="onboarding-flow">
        <div className="onboarding-container">
          <EalzyMark className="onboarding-logo" />
          <h1 className="onboarding-title">{t("onboarding.introTitle")}</h1>
          <p className="onboarding-lead">{t("onboarding.introPitch")}</p>
          {russian && <p className="onboarding-lead">{t("onboarding.introAddress")}</p>}
          <div className="onboarding-actions">
            {russian ? (
              <>
                <Button className="w-full" type="button" onClick={() => start("ты")}>
                  {t("onboarding.introInformal")}
                </Button>
                <Button
                  className="w-full"
                  variant="secondary"
                  type="button"
                  onClick={() => start("вы")}
                >
                  {t("onboarding.introFormal")}
                </Button>
              </>
            ) : (
              <Button className="w-full" type="button" onClick={() => start()}>
                {t("onboarding.introStart")}
              </Button>
            )}
            <button type="button" className="onboarding-skip" onClick={() => skip("intro")}>
              {t("onboarding.introSkip")}
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="onboarding-flow">
      <div className="onboarding-container">
        <EalzyMark className="onboarding-logo" />
        <h1 className="onboarding-title">
          {t("onboarding.title", { step: step + 1, total: STEPS.length })}
        </h1>
        <p className="onboarding-lead">{t(formal ? "onboarding.leadFormal" : "onboarding.lead")}</p>

        <div className="chip-row onboarding-steps">
          {stepLabels.map((label, index) => (
            <span
              key={label}
              className={`chip ${index === step ? "chip-active" : index < step ? "chip-done" : ""}`}
            >
              {label}
            </span>
          ))}
        </div>

        <form className="onboarding-form" onSubmit={submit}>
          {STEPS[step] === "work" && (
            <Field label={t(formal ? "profile.oneWorkFormal" : "profile.oneWork")}>
              <textarea className="input min-h-24" name="work" required autoFocus />
            </Field>
          )}

          {STEPS[step] === "goal" && (
            <Field label={t(formal ? "profile.oneGoal" : "profile.oneGoalInformal")}>
              <input className="input" name="goal" required autoFocus />
            </Field>
          )}

          {error && <p className="error-text">{error}</p>}

          <div className="onboarding-actions">
            <Button className="w-full" type="submit" disabled={saving}>
              {saving
                ? t("common.saving")
                : step === STEPS.length - 1
                  ? t("profile.finishOnboarding")
                  : t("profile.continue")}
            </Button>
            <button
              type="button"
              className="onboarding-skip"
              onClick={() => skip(STEPS[step])}
              disabled={saving}
            >
              {t("onboarding.skip")}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
