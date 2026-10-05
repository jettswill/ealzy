import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
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
import { promiseCheckInPrompt, promisePsychologistPrompt } from "../direction-prompts";
import { useI18n } from "../i18n";
import type { SelfPromise, SelfPromiseCheckinStatus, SelfPromiseStatus } from "../types";

const statuses: SelfPromiseStatus[] = ["active", "paused", "retired"];

export function PromisesPage() {
  const { api } = useAuth();
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const state = useAsyncData(() => api.promises(), [api], undefined, { live: true });
  const [editing, setEditing] = useState<SelfPromise | "new" | null>(null);
  useOpenOnCreateIntent((open) => setEditing(open ? "new" : null));
  const [error, setError] = useState("");
  const [discussBroken, setDiscussBroken] = useState<SelfPromise | null>(null);
  const checkIn = async (promise: SelfPromise, status: SelfPromiseCheckinStatus) => {
    setError("");
    try {
      const result = await api.checkInPromise(promise.id, { status });
      state.setData(
        (current) => current?.map((item) => (item.id === promise.id ? result.promise : item)) ?? [],
      );
      if (status === "broken") setDiscussBroken(result.promise);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("promises.checkFailed"));
    }
  };
  return (
    <>
      <PageHeader
        title={t("promises.title")}
        description={t("promises.description")}
        action={<Button onClick={() => setEditing("new")}>{t("promises.add")}</Button>}
      />
      {error && (
        <p className="error-text mb-3" role="alert">
          {error}
        </p>
      )}
      {state.loading ? (
        <LoadingState label={t("promises.loading")} />
      ) : state.error ? (
        <ErrorState message={state.error} retry={state.reload} />
      ) : !state.data?.length ? (
        <EmptyState
          icon="✧"
          title={t("promises.empty")}
          description={t("promises.emptyText")}
          action={
            <Button variant="secondary" onClick={() => setEditing("new")}>
              {t("promises.create")}
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="home-plan-actions">
            <Button
              variant="secondary"
              onClick={() =>
                navigate("/companion", {
                  state: {
                    draft: promiseCheckInPrompt(state.data ?? [], language),
                    autoSend: true,
                  },
                })
              }
            >
              {t("promises.discuss")}
            </Button>
          </div>
          {state.data.map((promise) => (
            <Card key={promise.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="tag">{t(`status.${promise.status}`)}</span>
                  <h2 className="mt-2 font-bold">{promise.title}</h2>
                  {promise.description && (
                    <p className="mt-1 text-sm text-muted">{promise.description}</p>
                  )}
                  <p className="mt-2 text-sm">
                    {promise.stats?.last_checkin_status === "broken"
                      ? t("promises.brokenNow")
                      : /* «Держу 0 дн.» в день, когда человек только что отчитался,
                           читается как провал, хотя счётчик считает прожитые дни,
                           а не отклики. В нулевой день говорим иначе. */
                        (promise.stats?.keeping_days ?? 0) === 0
                        ? t("promises.keepingToday")
                        : t("promises.keepingDays", { n: promise.stats?.keeping_days ?? 0 })}
                  </p>
                  {promise.stats?.praise_days ? (
                    <p className="mt-1 text-sm text-accent">
                      {t("promises.praise", { n: promise.stats.praise_days })}
                    </p>
                  ) : null}
                  {promise.stats && (
                    <p className="mt-1 text-xs text-muted">
                      {t("promises.checks", {
                        keeping: promise.stats.keeping_count,
                        struggling: promise.stats.struggling_count,
                        broken: promise.stats.broken_count,
                      })}
                    </p>
                  )}
                  {promise.status === "active" && (
                    <div className="chip-row mt-3" role="group" aria-label={promise.title}>
                      {(["keeping", "struggling", "broken"] as const).map((status) => (
                        <button
                          key={status}
                          type="button"
                          className="chip"
                          onClick={() => void checkIn(promise, status)}
                        >
                          {t(`promises.${status}`)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    className="icon-button"
                    aria-label={t("common.editNamed", { name: promise.title })}
                    onClick={() => setEditing(promise)}
                  >
                    ✎
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t("common.deleteNamed", { name: promise.title })}
                    onClick={async () => {
                      if (!window.confirm(t("promises.deleteConfirm"))) return;
                      try {
                        await api.deletePromise(promise.id);
                        state.setData(
                          (current) => current?.filter((item) => item.id !== promise.id) ?? [],
                        );
                      } catch (cause) {
                        setError(
                          cause instanceof Error ? cause.message : t("promises.deleteFailed"),
                        );
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <PromiseForm
          promise={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(promise) => {
            state.setData((current) =>
              editing === "new"
                ? [promise, ...(current ?? [])]
                : (current ?? []).map((item) => (item.id === promise.id ? promise : item)),
            );
            setEditing(null);
          }}
        />
      )}
      {discussBroken && (
        <Modal title={discussBroken.title} onClose={() => setDiscussBroken(null)}>
          <p className="text-sm text-muted">{t("promises.dueText")}</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => setDiscussBroken(null)}>
              {t("common.close")}
            </Button>
            <Button
              onClick={() => {
                navigate("/companion", {
                  state: {
                    draft: promisePsychologistPrompt(discussBroken, language),
                    autoSend: true,
                  },
                });
              }}
            >
              {t("promises.psychologist")}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function PromiseForm({
  promise,
  onClose,
  onSaved,
}: {
  promise?: SelfPromise;
  onClose: () => void;
  onSaved: (promise: SelfPromise) => void;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const input = {
      title: String(form.get("title")).trim(),
      description: String(form.get("description")).trim() || null,
      status: String(form.get("status")) as SelfPromiseStatus,
    };
    try {
      onSaved(
        promise ? await api.updatePromise(promise.id, input) : await api.createPromise(input),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("promises.saveFailed"));
      setSaving(false);
    }
  };
  return (
    <Modal title={promise ? t("promises.edit") : t("promises.createTitle")} onClose={onClose}>
      <p className="mb-5 text-sm text-muted">{t("promises.lead")}</p>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("common.title")}>
          <input className="input" name="title" defaultValue={promise?.title} required autoFocus />
        </Field>
        <Field label={t("common.description")}>
          <textarea
            className="input min-h-24"
            name="description"
            defaultValue={promise?.description ?? ""}
          />
        </Field>
        <Field label={t("common.status")}>
          <select className="input" name="status" defaultValue={promise?.status ?? "active"}>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`)}
              </option>
            ))}
          </select>
        </Field>
        {error && <p className="error-text">{error}</p>}
        <Button className="w-full" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("promises.save")}
        </Button>
      </form>
    </Modal>
  );
}
