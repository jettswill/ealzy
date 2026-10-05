import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import type { ExperienceStatus } from "../types";
import { Button, Card, ErrorState, LoadingState, useAsyncData } from "../components/ui";
import { useI18n } from "../i18n";
import { ExperienceForm } from "./ExperiencesPage";

export function ExperiencePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { api } = useAuth();
  const { t, formatDate } = useI18n();
  const state = useAsyncData(() => api.experience(id), [api, id], undefined, { live: true });
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState("");
  if (state.loading) return <LoadingState label={t("experiences.loadingOne")} />;
  if (state.error || !state.data)
    return <ErrorState message={state.error ?? t("experiences.missing")} retry={state.reload} />;
  const experience = state.data;
  const updateFollowUp = async (status: ExperienceStatus) => {
    setActionError("");
    try {
      state.setData(await api.followUpExperience(experience.id, status));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t("common.saveFailed"));
    }
  };
  return (
    <>
      <Link className="back-link" to="/experiences">
        {t("experiences.back")}
      </Link>
      <header className="my-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{t("plan.experiences")}</p>
            <h1 className="text-2xl font-bold">{experience.title}</h1>
          </div>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t("common.edit")}
          </Button>
        </div>
        <p className="mt-2 text-sm text-muted">
          {experience.place || t("common.noPlace")}
          {experience.occurred_at ? ` · ${formatDate(experience.occurred_at)}` : ""}
        </p>
        {experience.description && <p className="mt-4 leading-relaxed">{experience.description}</p>}
      </header>
      {actionError && (
        <p className="error-text mb-3" role="alert">
          {actionError}
        </p>
      )}
      <section className="grid gap-3 sm:grid-cols-2">
        <Card>
          <h2 className="font-bold">{t("experiences.positive")}</h2>
          {experience.positive_signals.length ? (
            experience.positive_signals.map((signal) => (
              <p className="mt-2 text-sm" key={signal}>
                ＋ {signal}
              </p>
            ))
          ) : (
            <p className="mt-2 text-sm text-muted">{t("common.noneCaptured")}</p>
          )}
        </Card>
        <Card>
          <h2 className="font-bold">{t("experiences.negative")}</h2>
          {experience.negative_signals.length ? (
            experience.negative_signals.map((signal) => (
              <p className="mt-2 text-sm" key={signal}>
                − {signal}
              </p>
            ))
          ) : (
            <p className="mt-2 text-sm text-muted">{t("common.noneCaptured")}</p>
          )}
        </Card>
      </section>
      <Card className="mt-3">
        <h2 className="font-bold">{t("experiences.peopleEmotions")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(experience.participants ?? []).map((participant) => (
            <Link className="tag tag-link" to={`/people/${participant.id}`} key={participant.id}>
              ◉ {participant.name}
            </Link>
          ))}
          {experience.emotions.map((emotion) => (
            <span className="tag" key={emotion}>
              {emotion}
            </span>
          ))}
        </div>
      </Card>
      <Card className="mt-3">
        <h2 className="font-bold">{t("common.context")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {experience.planned_task_id && (
            <Link className="tag tag-link" to="/tasks">
              ✓ {t("experiences.linkedTask")}
            </Link>
          )}
          {experience.planned_space_id && (
            <Link className="tag tag-link" to={`/spaces/${experience.planned_space_id}`}>
              ◇ {t("experiences.linkedSpace")}
            </Link>
          )}
        </div>
        {!experience.planned_task_id && !experience.planned_space_id && (
          <p className="mt-2 text-sm text-muted">{t("common.noLinked")}</p>
        )}
      </Card>
      <Card className="mt-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold">{t("common.followUp")}</h2>
            <p className="mt-1 text-sm text-muted">
              {experience.follow_up_at
                ? t("common.scheduled", { date: formatDate(experience.follow_up_at) })
                : t("common.chooseState")}
            </p>
          </div>
          <select
            className="status-select"
            aria-label={t("experiences.status")}
            value={experience.status}
            onChange={(event) => void updateFollowUp(event.target.value as ExperienceStatus)}
          >
            {(["planned", "completed", "follow_up_due"] as const).map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`)}
              </option>
            ))}
          </select>
        </div>
      </Card>
      <div className="mt-6 border-t border-border pt-5">
        <Button
          variant="danger"
          onClick={async () => {
            if (!window.confirm(t("common.deleteConfirm"))) return;
            try {
              await api.deleteExperience(experience.id);
              navigate("/experiences", { replace: true });
            } catch (cause) {
              setActionError(cause instanceof Error ? cause.message : t("common.deleteFailed"));
            }
          }}
        >
          {t("experiences.deleteExperience")}
        </Button>
      </div>
      {editing && (
        <ExperienceForm
          experience={experience}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            state.setData(saved);
            setEditing(false);
          }}
        />
      )}
    </>
  );
}
