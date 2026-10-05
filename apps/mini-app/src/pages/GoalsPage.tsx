import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import type { Goal, GoalStatus } from "../types";
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
import { useOpenOnCreateIntent } from "../create-intent";
import { goalSyncPrompt } from "../direction-prompts";
import { useI18n } from "../i18n";

const statuses: GoalStatus[] = ["active", "paused", "completed", "cancelled"];
const horizonOrder = ["short", "long", "medium", ""] as const;

function horizonKey(goal: Goal) {
  return goal.horizon === "short" || goal.horizon === "long" || goal.horizon === "medium"
    ? goal.horizon
    : "";
}

export function GoalsPage() {
  const { api } = useAuth();
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const state = useAsyncData(() => api.goals(), [api], undefined, { live: true });
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  useOpenOnCreateIntent((open) => setEditing(open ? "new" : null));
  const [error, setError] = useState("");
  const visible = (state.data ?? []).filter((goal) => goal.status !== "cancelled");
  const talk = () =>
    navigate("/companion", {
      state: { draft: goalSyncPrompt(visible, language), autoSend: true },
    });
  const grouped = horizonOrder
    .map((key) => ({
      key,
      title:
        key === "short"
          ? t("goals.shortTitle")
          : key === "long"
            ? t("goals.longTitle")
            : key === "medium"
              ? t("goals.mediumTitle")
              : t("goals.unsetHorizon"),
      items: visible.filter((goal) => horizonKey(goal) === key),
    }))
    .filter((group) => group.items.length);
  return (
    <>
      <PageHeader
        eyebrow={t("goals.eyebrow")}
        title={t("goals.title")}
        description={t("goals.description")}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" onClick={talk}>
              {t("goals.sync")}
            </Button>
            <Button onClick={() => setEditing("new")}>{t("goalsPage.add")}</Button>
          </div>
        }
      />
      {error && (
        <p className="error-text mb-3" role="alert">
          {error}
        </p>
      )}
      {state.loading ? (
        <LoadingState label={t("goals.loading")} />
      ) : state.error ? (
        <ErrorState message={state.error} retry={state.reload} />
      ) : !visible.length ? (
        <EmptyState
          icon="◎"
          title={t("goals.empty")}
          description={t("goals.emptyText")}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" onClick={talk}>
                {t("goals.sync")}
              </Button>
              <Button variant="secondary" onClick={() => setEditing("new")}>
                {t("goals.create")}
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.key || "none"} aria-label={group.title}>
              <p className="eyebrow mb-2">{group.title}</p>
              <div className="space-y-3">
                {group.items.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    onEdit={() => setEditing(goal)}
                    onDelete={async () => {
                      if (!window.confirm(t("goalsPage.deleteConfirm"))) return;
                      try {
                        await api.deleteGoal(goal.id);
                        state.setData(
                          (current) => current?.filter((item) => item.id !== goal.id) ?? [],
                        );
                      } catch (cause) {
                        setError(
                          cause instanceof Error ? cause.message : t("goalsPage.deleteFailed"),
                        );
                      }
                    }}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {editing && (
        <GoalForm
          goal={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(goal) => {
            state.setData((current) =>
              editing === "new"
                ? [goal, ...(current ?? [])]
                : (current ?? []).map((item) =>
                    item.id === goal.id ? { ...item, ...goal } : item,
                  ),
            );
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function GoalCard({
  goal,
  onEdit,
  onDelete,
}: {
  goal: Goal;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t, formatDate } = useI18n();
  const stats = goal.stats;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <Link className="min-w-0 flex-1 text-left" to={`/goals/${goal.id}`}>
          <span className="tag">{t(`status.${goal.status}`)}</span>
          <h2 className="mt-2 font-bold">{goal.title}</h2>
          {goal.description && <p className="mt-1 text-sm text-muted">{goal.description}</p>}
          {stats && (
            <div className="mt-3">
              <div className="progress-track" aria-hidden="true">
                <div className="progress-fill" style={{ width: `${stats.progress}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {stats.task_count
                  ? t("goals.progress", { done: stats.done_count, total: stats.task_count })
                  : t("goals.noTasks")}
                {" · "}
                {t("goals.daysActive", { n: stats.days_active })}
              </p>
            </div>
          )}
          {goal.target_date && (
            <p className="mt-1 text-xs text-muted">
              {t("goals.target", { date: formatDate(goal.target_date) })}
            </p>
          )}
        </Link>
        <div className="flex gap-1">
          <button
            className="icon-button"
            aria-label={t("common.editNamed", { name: goal.title })}
            onClick={onEdit}
          >
            ✎
          </button>
          <button
            className="icon-button"
            aria-label={t("common.deleteNamed", { name: goal.title })}
            onClick={() => void onDelete()}
          >
            ×
          </button>
        </div>
      </div>
    </Card>
  );
}

export function GoalForm({
  goal,
  onClose,
  onSaved,
}: {
  goal?: Goal;
  onClose: () => void;
  onSaved: (goal: Goal) => void;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const input = {
      title: String(form.get("title")).trim(),
      description: String(form.get("description")).trim() || null,
      status: String(form.get("status")) as GoalStatus,
      horizon: String(form.get("horizon")).trim() || null,
      target_date: String(form.get("target_date")) || null,
      priority: Number(form.get("priority")) || undefined,
    };
    try {
      const saved = goal ? await api.updateGoal(goal.id, input) : await api.createGoal(input);
      onSaved(saved);
      if (!goal) navigate(`/goals/${saved.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("goalsPage.saveFailed"));
      setSaving(false);
    }
  };
  return (
    <Modal title={goal ? t("goals.edit") : t("goals.createTitle")} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("common.title")}>
          <input className="input" name="title" defaultValue={goal?.title} required autoFocus />
        </Field>
        <Field label={t("common.description")}>
          <textarea
            className="input min-h-24"
            name="description"
            defaultValue={goal?.description ?? ""}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.status")}>
            <select className="input" name="status" defaultValue={goal?.status ?? "active"}>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {t(`status.${status}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("common.horizon")}>
            <select className="input" name="horizon" defaultValue={goal?.horizon ?? "short"}>
              <option value="short">{t("common.short")}</option>
              <option value="medium">{t("common.medium")}</option>
              <option value="long">{t("common.long")}</option>
            </select>
          </Field>
        </div>
        <Field label={t("goals.target", { date: "" }).trim()}>
          <input
            className="input"
            type="date"
            name="target_date"
            defaultValue={goal?.target_date?.slice(0, 10) ?? ""}
          />
        </Field>
        <Field label={t("common.priority")} hint={t("common.priorityHint")}>
          <input
            className="input"
            type="number"
            min={1}
            max={5}
            name="priority"
            defaultValue={goal?.priority ?? 3}
          />
        </Field>
        {error && <p className="error-text">{error}</p>}
        <Button className="w-full" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("goalsPage.save")}
        </Button>
      </form>
    </Modal>
  );
}
