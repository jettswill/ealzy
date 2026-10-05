import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import type { Experience, ExperienceStatus, ExperienceType } from "../types";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  useAsyncData,
} from "../components/ui";
import { useI18n } from "../i18n";
import { useOpenOnCreateIntent } from "../create-intent";

const splitList = (value: FormDataEntryValue | null) =>
  String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const formDateToIso = (value: FormDataEntryValue | null) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const experienceTypes = [
  "restaurant",
  "theater",
  "trip",
  "event",
  "gift",
  "activity",
  "other",
] as const;

export function ExperiencesPage() {
  const { api } = useAuth();
  const { t, formatDate } = useI18n();
  const state = useAsyncData(() => api.experiences(), [api], undefined, { live: true });
  const followUps = useAsyncData(() => api.dueExperienceFollowUps(), [api], undefined, {
    live: true,
  });
  const [creating, setCreating] = useState(false);
  useOpenOnCreateIntent(setCreating);
  return (
    <>
      <Link className="back-link" to="/">
        {t("common.back")}
      </Link>
      <PageHeader
        eyebrow={t("experiences.eyebrow")}
        title={t("experiences.title")}
        description={t("experiences.description")}
        action={<Button onClick={() => setCreating(true)}>{t("spacesPage.add")}</Button>}
      />
      {!!followUps.data?.length && (
        <Card className="mb-4 border-accent/30 bg-accent/5">
          <p className="text-sm font-bold">{t("experiences.followUpDue")}</p>
          <p className="mt-1 text-sm text-muted">{t("experiences.followUpDueText")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {followUps.data.map((experience) => (
              <Link
                className="tag tag-link"
                key={experience.id}
                to={`/experiences/${experience.id}`}
              >
                ◌ {experience.title}
              </Link>
            ))}
          </div>
        </Card>
      )}
      {state.loading ? (
        <LoadingState label={t("experiences.loading")} />
      ) : state.error ? (
        <ErrorState message={state.error} retry={state.reload} />
      ) : !state.data?.length ? (
        <EmptyState
          icon="◌"
          title={t("experiences.empty")}
          description={t("experiences.emptyText")}
          action={
            <Button variant="secondary" onClick={() => setCreating(true)}>
              {t("experiences.add")}
            </Button>
          }
        />
      ) : (
        <div className="list-stack">
          {state.data.map((experience) => (
            <Link key={experience.id} to={`/experiences/${experience.id}`} className="list-row">
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{experience.title}</h2>
                    <p className="mt-1 text-sm text-muted">
                      {experience.place || t("common.noPlace")}
                      {experience.occurred_at ? ` · ${formatDate(experience.occurred_at)}` : ""}
                    </p>
                  </div>
                  <span className="tag">{t(`status.${experience.status}`)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {experience.emotions.map((emotion) => (
                    <span className="tag" key={emotion}>
                      {emotion}
                    </span>
                  ))}
                  {(experience.participants ?? []).map((participant) => (
                    <span className="tag" key={participant.id}>
                      ◉ {participant.name}
                    </span>
                  ))}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {creating && (
        <ExperienceForm
          onClose={() => setCreating(false)}
          onSaved={(experience) => {
            state.setData((current) => [experience, ...(current ?? [])]);
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

export function ExperienceForm({
  experience,
  onClose,
  onSaved,
}: {
  experience?: Experience;
  onClose: () => void;
  onSaved: (experience: Experience) => void;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const lookups = useAsyncData(async () => {
    const [people, tasks, spaces] = await Promise.all([api.people(), api.tasks(), api.spaces()]);
    return { people, tasks, spaces };
  }, [api]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const input = {
      type: String(form.get("type")) as ExperienceType,
      title: String(form.get("title")).trim(),
      description: String(form.get("description")).trim() || null,
      occurred_at: formDateToIso(form.get("occurred_at")),
      place: String(form.get("place")).trim() || null,
      emotions: splitList(form.get("emotions")),
      positive_signals: splitList(form.get("positive_signals")),
      negative_signals: splitList(form.get("negative_signals")),
      outcome: String(form.get("outcome")).trim() || null,
      participant_ids: form.getAll("participants").map(String),
      planned_task_id: String(form.get("task_id")) || null,
      planned_space_id: String(form.get("space_id")) || null,
      follow_up_at: formDateToIso(form.get("follow_up_at")),
      status: String(form.get("status")) as ExperienceStatus,
    };
    try {
      onSaved(
        experience
          ? await api.updateExperience(experience.id, input)
          : await api.createExperience(input),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveFailed"));
      setSaving(false);
    }
  };
  return (
    <Modal title={experience ? t("experiences.edit") : t("experiences.addTitle")} onClose={onClose}>
      {lookups.loading ? (
        <LoadingState label={t("common.loadingOptions")} />
      ) : lookups.error ? (
        <ErrorState message={lookups.error} retry={lookups.reload} />
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <Field label={t("common.title")}>
            <input
              className="input"
              name="title"
              defaultValue={experience?.title}
              required
              autoFocus
            />
          </Field>
          <Field label={t("common.type")}>
            <select className="input" name="type" defaultValue={experience?.type ?? "other"}>
              {experienceTypes.map((type) => (
                <option key={type} value={type}>
                  {t(`experiences.types.${type}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("common.participants")}>
            <div className="grid gap-2 rounded-2xl border border-border p-3">
              {lookups.data?.people.length ? (
                lookups.data.people.map((person) => (
                  <label className="flex items-center gap-2 text-sm" key={person.id}>
                    <input
                      type="checkbox"
                      name="participants"
                      value={person.id}
                      defaultChecked={experience?.participant_ids.includes(person.id)}
                    />
                    {person.name}
                  </label>
                ))
              ) : (
                <span className="text-sm text-muted">{t("experiences.noPeople")}</span>
              )}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("common.time")}>
              <input
                className="input"
                type="datetime-local"
                name="occurred_at"
                defaultValue={experience?.occurred_at?.slice(0, 16) ?? ""}
              />
            </Field>
            <Field label={t("common.place")}>
              <input className="input" name="place" defaultValue={experience?.place ?? ""} />
            </Field>
          </div>
          <Field label={t("common.whatHappened")}>
            <textarea
              className="input min-h-24"
              name="description"
              defaultValue={experience?.description ?? ""}
            />
          </Field>
          <details
            className="form-more"
            open={Boolean(
              experience &&
              (experience.emotions.length ||
                experience.positive_signals.length ||
                experience.negative_signals.length ||
                experience.outcome ||
                experience.planned_task_id ||
                experience.planned_space_id ||
                experience.follow_up_at),
            )}
          >
            <summary className="mb-3">{t("experiences.more")}</summary>
            <div className="space-y-4">
              <Field label={t("experiences.emotions")} hint={t("common.emotionsHint")}>
                <input
                  className="input"
                  name="emotions"
                  defaultValue={experience?.emotions.join(", ")}
                  placeholder={t("experiences.emotionsPlaceholder")}
                />
              </Field>
              <Field label={t("experiences.positive")} hint={t("common.whatWorked")}>
                <textarea
                  className="input min-h-20"
                  name="positive_signals"
                  defaultValue={experience?.positive_signals.join(", ")}
                />
              </Field>
              <Field label={t("experiences.negative")} hint={t("common.whatOff")}>
                <textarea
                  className="input min-h-20"
                  name="negative_signals"
                  defaultValue={experience?.negative_signals.join(", ")}
                />
              </Field>
              <Field label={t("common.outcome")}>
                <textarea
                  className="input min-h-20"
                  name="outcome"
                  defaultValue={experience?.outcome ?? ""}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("experiences.linkedTask")}>
                  <select
                    className="input"
                    name="task_id"
                    defaultValue={experience?.planned_task_id ?? ""}
                  >
                    <option value="">{t("common.none")}</option>
                    {lookups.data?.tasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("experiences.linkedSpace")}>
                  <select
                    className="input"
                    name="space_id"
                    defaultValue={experience?.planned_space_id ?? ""}
                  >
                    <option value="">{t("common.none")}</option>
                    {lookups.data?.spaces.map((space) => (
                      <option key={space.id} value={space.id}>
                        {space.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("common.status")}>
                  <select
                    className="input"
                    name="status"
                    defaultValue={experience?.status ?? "completed"}
                  >
                    {(["planned", "completed", "follow_up_due"] as const).map((status) => (
                      <option key={status} value={status}>
                        {t(`status.${status}`)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("common.followUpTime")}>
                  <input
                    className="input"
                    type="datetime-local"
                    name="follow_up_at"
                    defaultValue={experience?.follow_up_at?.slice(0, 16) ?? ""}
                  />
                </Field>
              </div>
            </div>
          </details>
          {error && <p className="error-text">{error}</p>}
          <Button className="w-full" type="submit" disabled={saving}>
            {saving ? t("common.saving") : t("experiences.save")}
          </Button>
        </form>
      )}
    </Modal>
  );
}
