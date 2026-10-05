import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  useAsyncData,
} from "../components/ui";
import { useI18n } from "../i18n";

export function SpacePage() {
  const { id = "" } = useParams();
  const { api } = useAuth();
  const { t } = useI18n();
  const {
    data: space,
    setData,
    loading,
    error,
    reload,
  } = useAsyncData(() => api.space(id), [api, id], undefined, { live: true });
  const [adding, setAdding] = useState(false);
  const people = space?.people ?? space?.participants ?? [];

  if (loading) return <LoadingState label={t("spaces.loadingOne")} />;
  if (error || !space)
    return <ErrorState message={error ?? t("spacesPage.missing")} retry={reload} />;

  const removePerson = async (personId: string) => {
    try {
      await api.removeSpacePerson(space.id, personId);
      const next = people.filter((person) => person.id !== personId);
      setData({ ...space, people: next, participants: next });
    } catch {
      reload();
    }
  };

  return (
    <>
      <Link className="back-link" to="/spaces">
        {t("spacesPage.back")}
      </Link>
      <header className="mb-7 mt-4">
        <div className="space-icon mb-4">◇</div>
        <p className="eyebrow">{space.type || t("spaces.space")}</p>
        <h1 className="text-3xl font-bold tracking-tight">{space.name}</h1>
        {space.context && <p className="mt-2 max-w-xl text-muted">{space.context}</p>}
      </header>

      <section className="mb-7" aria-labelledby="participants-title">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="participants-title" className="text-lg font-bold">
            {t("spacesPage.peopleTitle")}
          </h2>
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {t("spacesPage.add")}
          </Button>
        </div>
        {!people.length ? (
          <EmptyState
            icon="◎"
            title={t("spaces.noPeople")}
            description={t("spacesPage.addFromList")}
          />
        ) : (
          <Card className="divide-y divide-border p-0">
            {people.map((person) => (
              <div key={person.id} className="flex items-center gap-3 p-4">
                <div className="avatar avatar-small">{person.name.slice(0, 1)}</div>
                <Link className="min-w-0 flex-1 font-semibold" to={`/people/${person.id}`}>
                  {person.name}
                </Link>
                <button
                  className="text-sm text-muted hover:text-danger"
                  onClick={() => void removePerson(person.id)}
                >
                  {t("common.remove")}
                </button>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section aria-labelledby="space-tasks-title">
        <h2 id="space-tasks-title" className="mb-3 text-lg font-bold">
          {t("spacesPage.tasksTitle")}
        </h2>
        {!space.tasks?.length ? (
          <EmptyState icon="✓" title={t("spaces.noTasks")} description={t("spacesPage.tasksHint")} />
        ) : (
          <Card className="divide-y divide-border p-0">
            {space.tasks.map((task) => (
              <div className="flex items-center gap-3 p-4" key={task.id}>
                <span className={`task-dot task-dot-${task.status}`} />
                <span className="min-w-0 flex-1 font-medium">{task.title}</span>
                <span className="tag">{t(`status.${task.status}`)}</span>
              </div>
            ))}
          </Card>
        )}
      </section>

      {adding && (
        <AddPersonModal
          existingIds={people.map((person) => person.id)}
          onClose={() => setAdding(false)}
          onAdd={async (personId) => {
            await api.addSpacePerson(space.id, personId);
            setAdding(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function AddPersonModal({
  existingIds,
  onClose,
  onAdd,
}: {
  existingIds: string[];
  onClose: () => void;
  onAdd: (personId: string) => Promise<void>;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const { data, loading, error } = useAsyncData(() => api.people(), [api]);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState("");
  const available = useMemo(
    () =>
      (data ?? []).filter(
        (person) =>
          !existingIds.includes(person.id) &&
          person.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ),
    [data, existingIds, query],
  );
  return (
    <Modal title={t("spaces.addPerson")} onClose={onClose}>
      <input
        className="input mb-3"
        type="search"
        placeholder={t("people.search")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} />
      ) : !available.length ? (
        <p className="py-8 text-center text-sm text-muted">{t("spacesPage.noAvailable")}</p>
      ) : (
        <div className="divide-y divide-border">
          {available.map((person) => (
            <button
              className="flex w-full items-center gap-3 py-3 text-left"
              key={person.id}
              disabled={Boolean(saving)}
              onClick={async () => {
                setSaving(person.id);
                await onAdd(person.id);
              }}
            >
              <span className="avatar avatar-small">{person.name.slice(0, 1)}</span>
              <span className="flex-1 font-semibold">{person.name}</span>
              <span className="text-sm text-accent">
                {saving === person.id ? t("common.adding") : t("common.add")}
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
