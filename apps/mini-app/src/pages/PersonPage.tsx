import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { LocationsSection } from "../components/Locations";
import { DatesSection, birthdayOf, formatPersonDateLine, personAge } from "../components/Dates";
import { memoryCategoryKeys } from "../memory";
import { memoryCategories, type Memory, type MemoryCategory, type PersonDetail } from "../types";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  LoadingState,
  Modal,
  useAsyncData,
} from "../components/ui";
import { useI18n, pluralWord } from "../i18n";

function memorySourceText(
  t: (key: string) => string,
  source?: string | null,
  sourceMessageId?: string | null,
) {
  if (source) return source;
  if (sourceMessageId) return t("memory.conversation");
  return t("memory.manual");
}

export function PersonPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { api } = useAuth();
  const { t, language, locale } = useI18n();
  const {
    data: person,
    setData,
    loading,
    error,
    reload,
  } = useAsyncData(() => api.person(id), [api, id], undefined, { live: true });
  const recentExperiences = useAsyncData(
    () => api.experiences({ personId: id, limit: 3 }),
    [api, id],
    undefined,
    { live: true },
  );
  const [editingPerson, setEditingPerson] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | "new" | null>(null);
  const [actionError, setActionError] = useState("");

  if (loading) return <LoadingState label={t("person.loading")} />;
  if (error || !person) return <ErrorState message={error ?? t("person.missing")} retry={reload} />;

  const birthday = birthdayOf(person.dates);
  const age = birthday ? personAge(birthday) : null;

  const removePerson = async () => {
    if (!window.confirm(t("person.deleteConfirm", { name: person.name }))) return;
    try {
      await api.deletePerson(person.id);
      navigate("/people", { replace: true });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t("person.deleteFailed"));
    }
  };

  const removeMemory = async (memory: Memory) => {
    if (!window.confirm(t("person.deleteMemoryConfirm"))) return;
    try {
      await api.deleteMemory(memory.id);
      setData({ ...person, memories: person.memories.filter((item) => item.id !== memory.id) });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t("common.deleteFailed"));
    }
  };

  return (
    <>
      <Link className="back-link" to="/people">
        {t("person.back")}
      </Link>
      <header className="mb-6 mt-3 flex items-start gap-4">
        <div className="avatar avatar-large">{person.name.slice(0, 1).toLocaleUpperCase()}</div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{person.name}</h1>
          <p className="text-sm text-muted">{person.relationship || t("common.person")}</p>
          {birthday && (
            <p className="mt-1 text-sm text-muted">
              {formatPersonDateLine(birthday, t, locale)}
              {age != null
                ? ` · ${t("dates.age", {
                    n: age,
                    word: pluralWord(language, age, {
                      one: t("dates.yearOne"),
                      few: t("dates.yearFew"),
                      many: t("dates.yearMany"),
                    }),
                  })}`
                : ""}
            </p>
          )}
          {person.description && <p className="mt-2 text-sm">{person.description}</p>}
        </div>
        <IconButton label={t("person.edit")} onClick={() => setEditingPerson(true)}>
          ✎
        </IconButton>
      </header>

      <LocationsSection
        className="mb-6 mt-0"
        locations={person.locations ?? []}
        onCreate={async (input) => {
          const saved = await api.createLocation(person.id, input);
          const current = person.locations ?? [];
          setData({
            ...person,
            locations: saved.is_primary
              ? [saved, ...current.map((item) => ({ ...item, is_primary: false }))]
              : [saved, ...current],
          });
          return saved;
        }}
        onUpdate={async (id, input) => {
          const saved = await api.updateLocation(id, input);
          const current = person.locations ?? [];
          setData({
            ...person,
            locations: current.map((item) =>
              item.id === saved.id
                ? saved
                : saved.is_primary
                  ? { ...item, is_primary: false }
                  : item,
            ),
          });
          return saved;
        }}
        onDelete={async (id) => {
          await api.deleteLocation(id);
          setData({
            ...person,
            locations: (person.locations ?? []).filter((item) => item.id !== id),
          });
        }}
      />

      <DatesSection
        className="mb-6 mt-0"
        dates={person.dates ?? []}
        onCreate={async (input) => {
          const saved = await api.createDate(person.id, input);
          setData({
            ...person,
            dates: [...(person.dates ?? []).filter((item) => item.id !== saved.id), saved],
          });
          return saved;
        }}
        onUpdate={async (id, input) => {
          const saved = await api.updateDate(id, input);
          setData({
            ...person,
            dates: (person.dates ?? []).map((item) => (item.id === saved.id ? saved : item)),
          });
          return saved;
        }}
        onDelete={async (id) => {
          await api.deleteDate(id);
          setData({
            ...person,
            dates: (person.dates ?? []).filter((item) => item.id !== id),
          });
        }}
      />

      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="eyebrow">{t("person.memory")}</p>
          <h2 className="text-xl font-bold">
            {t("person.savedFacts", {
              n: person.memories.length,
              word: pluralWord(language, person.memories.length, {
                one: t("person.factOne"),
                few: t("person.factFew"),
                many: t("person.factMany"),
              }),
            })}
          </h2>
        </div>
        {person.memories.length > 0 && (
          <Button variant="secondary" onClick={() => setEditingMemory("new")}>
            {t("profile.addFact")}
          </Button>
        )}
      </div>
      {actionError && (
        <p className="error-text mb-3" role="alert">
          {actionError}
        </p>
      )}

      {person.memories.length === 0 ? (
        <EmptyState
          icon="✦"
          title={t("person.empty")}
          description={t("person.emptyText", { name: person.name })}
          action={
            <Button variant="secondary" onClick={() => setEditingMemory("new")}>
              {t("person.addFact")}
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          {memoryCategories.map((category) => {
            const memories = person.memories.filter((memory) => memory.category === category);
            if (!memories.length) return null;
            return (
              <section key={category} aria-labelledby={`category-${category}`}>
                <h2 id={`category-${category}`} className="mb-2 text-sm font-bold text-muted">
                  {t(memoryCategoryKeys[category])}
                </h2>
                <Card className="divide-y divide-border p-0">
                  {memories.map((memory) => (
                    <div key={memory.id} className="flex items-start gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-relaxed">{memory.content}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="tag">★ {memory.importance ?? 3}/5</span>
                          <span className="tag">
                            {t("common.sure", { n: Math.round((memory.confidence ?? 1) * 100) })}
                          </span>
                          {(() => {
                            const source = memorySourceText(
                              t,
                              memory.source,
                              memory.source_message_id,
                            );
                            return source !== t("memory.manual") ? (
                              <span className="tag">{source}</span>
                            ) : null;
                          })()}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <IconButton
                          label={t("person.editMemory")}
                          onClick={() => setEditingMemory(memory)}
                        >
                          ✎
                        </IconButton>
                        <IconButton
                          label={t("person.deleteMemory")}
                          onClick={() => void removeMemory(memory)}
                        >
                          ×
                        </IconButton>
                      </div>
                    </div>
                  ))}
                </Card>
              </section>
            );
          })}
        </div>
      )}

      {!!recentExperiences.data?.length && (
        <section className="mt-7" aria-labelledby="shared-experiences-title">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="shared-experiences-title" className="text-xl font-bold">
              {t("person.recent")}
            </h2>
            <Link className="back-link" to="/experiences">
              {t("profile.viewAll")}
            </Link>
          </div>
          <div className="space-y-2">
            {recentExperiences.data.map((experience) => (
              <Link key={experience.id} to={`/experiences/${experience.id}`} className="block">
                <Card>
                  <h3 className="font-bold">{experience.title}</h3>
                  <p className="mt-1 text-sm text-muted">
                    {experience.emotions.join(" · ") ||
                      experience.place ||
                      t("profile.sharedExperience")}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mt-8 border-t border-border pt-5">
        <Button variant="danger" onClick={() => void removePerson()}>
          {t("person.delete")}
        </Button>
      </div>

      {editingPerson && (
        <PersonForm
          person={person}
          onClose={() => setEditingPerson(false)}
          onSaved={(updated) => {
            setData({ ...person, ...updated });
            setEditingPerson(false);
          }}
        />
      )}
      {editingMemory && (
        <MemoryForm
          personId={person.id}
          memory={editingMemory === "new" ? undefined : editingMemory}
          onClose={() => setEditingMemory(null)}
          onSaved={(saved) => {
            const exists = person.memories.some((memory) => memory.id === saved.id);
            setData({
              ...person,
              memories: exists
                ? person.memories.map((memory) => (memory.id === saved.id ? saved : memory))
                : [saved, ...person.memories],
            });
            setEditingMemory(null);
          }}
        />
      )}
    </>
  );
}

function PersonForm({
  person,
  onClose,
  onSaved,
}: {
  person: PersonDetail;
  onClose: () => void;
  onSaved: (person: PersonDetail) => void;
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
      const updated = await api.updatePerson(person.id, {
        name: String(form.get("name")).trim(),
        relationship: String(form.get("relationship")).trim() || null,
        description: String(form.get("description")).trim() || null,
      });
      onSaved({ ...person, ...updated });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("common.saveFailed"));
      setSaving(false);
    }
  };
  return (
    <Modal title={t("person.editTitle")} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("people.name")}>
          <input className="input" name="name" defaultValue={person.name} required />
        </Field>
        <Field label={t("people.relationship")}>
          <input className="input" name="relationship" defaultValue={person.relationship ?? ""} />
        </Field>
        <Field label={t("people.notes")}>
          <textarea
            className="input min-h-24"
            name="description"
            defaultValue={person.description ?? ""}
          />
        </Field>
        {error && <p className="error-text">{error}</p>}
        <Button className="w-full" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("profile.saveChanges")}
        </Button>
      </form>
    </Modal>
  );
}

function MemoryForm({
  personId,
  memory,
  onClose,
  onSaved,
}: {
  personId: string;
  memory?: Memory;
  onClose: () => void;
  onSaved: (memory: Memory) => void;
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
      content: String(form.get("content")).trim(),
      category: String(form.get("category")) as MemoryCategory,
      importance: Number(form.get("importance")),
      confidence: Number(form.get("confidence")) / 100,
    };
    try {
      onSaved(
        memory ? await api.updateMemory(memory.id, input) : await api.createMemory(personId, input),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("profile.saveMemoryFailed"));
      setSaving(false);
    }
  };
  return (
    <Modal title={memory ? t("person.editMemory") : t("person.addTitle")} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("profile.category")}>
          <select
            className="input"
            name="category"
            defaultValue={memory?.category ?? "important_fact"}
          >
            {memoryCategories.map((category) => (
              <option key={category} value={category}>
                {t(memoryCategoryKeys[category])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("profile.fact")} hint={t("common.factHint")}>
          <textarea
            className="input min-h-28"
            name="content"
            defaultValue={memory?.content}
            required
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.importance")} hint={t("common.importanceHint")}>
            <input
              className="input"
              name="importance"
              type="number"
              min="1"
              max="5"
              defaultValue={memory?.importance ?? 3}
            />
          </Field>
          <Field label={t("common.confidence")} hint={t("common.confidenceHint")}>
            <input
              className="input"
              name="confidence"
              type="number"
              min="0"
              max="100"
              defaultValue={Math.round((memory?.confidence ?? 1) * 100)}
            />
          </Field>
        </div>
        {memory && (
          <p className="text-xs text-muted">
            {t("person.sourceLabel", {
              source: memorySourceText(t, memory.source, memory.source_message_id),
            })}
          </p>
        )}
        {error && <p className="error-text">{error}</p>}
        <Button className="w-full" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("profile.saveFact")}
        </Button>
      </form>
    </Modal>
  );
}
