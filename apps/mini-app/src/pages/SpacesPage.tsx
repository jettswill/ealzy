import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import type { Space } from "../types";
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

export function SpacesPage() {
  const { api } = useAuth();
  const { t } = useI18n();
  const { data, setData, loading, error, reload } = useAsyncData(() => api.spaces(), [api], undefined, {
    live: true,
  });
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Link className="back-link" to="/">
        {t("common.back")}
      </Link>
      <PageHeader
        eyebrow={t("spaces.eyebrow")}
        title={t("spaces.title")}
        description={t("spaces.description")}
        action={<Button onClick={() => setCreating(true)}>{t("spacesPage.add")}</Button>}
      />
      {loading ? (
        <LoadingState label={t("spaces.loading")} />
      ) : error ? (
        <ErrorState message={error} retry={reload} />
      ) : !data?.length ? (
        <EmptyState
          icon="◇"
          title={t("spaces.empty")}
          description={t("spaces.emptyText")}
          action={
            <Button variant="secondary" onClick={() => setCreating(true)}>
              {t("spacesPage.createManual")}
            </Button>
          }
        />
      ) : (
        <div className="list-stack">
          {data.map((space) => {
            const people = space.people ?? space.participants ?? [];
            const peopleLabel =
              people.length === 1
                ? t("common.personCount", { n: people.length })
                : t("common.peopleCount", { n: people.length });
            const taskLabel = t("common.taskCount", { n: space.tasks?.length ?? 0 });
            return (
              <Link key={space.id} to={`/spaces/${space.id}`} className="list-row">
                <Card>
                  <div className="flex items-center gap-3">
                    <span className="space-icon">◇</span>
                    <div className="min-w-0 flex-1">
                      <h2 className="list-row-title">{space.name}</h2>
                      <p className="list-row-text line-clamp-2">
                        {space.context || t("common.sharedContext")}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {t("spacesPage.count", { people: peopleLabel, tasks: taskLabel })}
                      </p>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
      {creating && (
        <CreateSpaceModal
          onClose={() => setCreating(false)}
          onCreated={(space) => {
            setData((current) => [space, ...(current ?? [])]);
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

function CreateSpaceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (space: Space) => void;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      onCreated(
        await api.createSpace({
          name: String(form.get("name")).trim(),
          context: String(form.get("context")).trim() || undefined,
          type: String(form.get("type")),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveFailed"));
      setSaving(false);
    }
  };
  return (
    <Modal title={t("spaces.create")} onClose={onClose}>
      <p className="mb-5 text-sm text-muted">{t("spacesPage.createLead")}</p>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("common.name")}>
          <input
            className="input"
            name="name"
            required
            autoFocus
            placeholder={t("spacesPage.namePlaceholder")}
          />
        </Field>
        <Field label={t("common.type")}>
          <select className="input" name="type" defaultValue="other">
            <option value="relationship">{t("common.relationship")}</option>
            <option value="trip">{t("common.trip")}</option>
            <option value="event">{t("common.event")}</option>
            <option value="other">{t("memory.other")}</option>
          </select>
        </Field>
        <Field label={t("common.context")}>
          <textarea
            className="input min-h-24"
            name="context"
            placeholder={t("spacesPage.contextPlaceholder")}
          />
        </Field>
        {error && <p className="error-text">{error}</p>}
        <Button className="w-full" type="submit" disabled={saving}>
          {saving ? t("common.creating") : t("spaces.create")}
        </Button>
      </form>
    </Modal>
  );
}
