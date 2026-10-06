import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import type { Person } from "../types";
import { formatLocationLine } from "../components/Locations";
import { birthdayOf, formatPersonDateLine } from "../components/Dates";
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  useAsyncData,
} from "../components/ui";
import { useOpenOnCreateIntent } from "../create-intent";
import { useI18n } from "../i18n";

export function PeoplePage() {
  const { api } = useAuth();
  const { t, locale } = useI18n();
  const { data, setData, loading, error, reload } = useAsyncData(() => api.people(), [api], undefined, {
    live: true,
  });
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  useOpenOnCreateIntent(setCreating);
  const people = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    // Сам пользователь — не «человек, который вам важен»: его карточка с
    // родством «self» в этом списке выглядела как мусор.
    const others = (data ?? []).filter((person) => !person.is_self);
    if (!term) return others;
    return others.filter((person) =>
      [
        person.name,
        person.relationship,
        ...(person.aliases ?? []),
        ...(person.locations ?? []).flatMap((location) => [
          location.city,
          location.address,
          location.label,
        ]),
      ].some((value) => value?.toLocaleLowerCase().includes(term)),
    );
  }, [data, query]);

  return (
    <>
      <PageHeader
        title={t("people.title")}
        description={t("people.description")}
        action={
          <Button onClick={() => setCreating(true)} aria-label={t("people.addAria")}>
            {t("people.add")}
          </Button>
        }
      />
      <label className="search-box">
        <span aria-hidden="true">⌕</span>
        <span className="sr-only">{t("people.search")}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("people.searchPlaceholder")}
        />
      </label>

      {loading ? (
        <LoadingState label={t("people.loading")} />
      ) : error ? (
        <ErrorState message={error} retry={reload} />
      ) : people.length === 0 ? (
        <EmptyState
          icon="◎"
          title={query ? t("people.noMatches") : t("people.empty")}
          description={query ? t("people.noMatchesText") : t("people.emptyText")}
          action={
            !query && <Button onClick={() => setCreating(true)}>{t("people.addManual")}</Button>
          }
        />
      ) : (
        <div className="list-stack mt-4">
          {people.map((person) => (
            <PersonCard key={person.id} person={person} locale={locale} />
          ))}
        </div>
      )}

      {creating && (
        <CreatePersonModal
          onClose={() => setCreating(false)}
          onCreated={(person) => {
            setData((current) => [person, ...(current ?? [])]);
            setQuery("");
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

function PersonCard({ person, locale }: { person: Person; locale: string }) {
  const { t } = useI18n();
  const birthday = birthdayOf(person.dates);
  return (
    <Link to={`/people/${person.id}`} className="list-row">
      <div className="avatar">{person.name.slice(0, 1).toLocaleUpperCase()}</div>
      <div className="list-row-body">
        <h2 className="list-row-title truncate">{person.name}</h2>
        <p className="list-row-text truncate">{person.relationship || t("common.person")}</p>
        {birthday && (
          <p className="mt-1 truncate text-sm text-muted">
            {formatPersonDateLine(birthday, t, locale)}
          </p>
        )}
        {person.locations?.[0] && (
          <p className="mt-1 truncate text-sm text-muted">
            {formatLocationLine(person.locations[0])}
          </p>
        )}
        {person.description && (
          <p className="mt-1 line-clamp-2 text-sm text-muted">{person.description}</p>
        )}
      </div>
    </Link>
  );
}

function CreatePersonModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (person: Person) => void;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      onCreated(
        await (async () => {
          const person = await api.createPerson({
            name: String(form.get("name")).trim(),
            relationship: String(form.get("relationship")).trim() || null,
            description: String(form.get("description")).trim() || null,
          });
          const birthday = String(form.get("birthday")).trim();
          let dates = person.dates ?? [];
          if (birthday) {
            const [year, month, day] = birthday.split("-").map(Number);
            if (month && day) {
              const saved = await api.createDate(person.id, {
                kind: "birthday",
                month,
                day,
                year: year || null,
              });
              dates = [saved];
            }
          }
          const city = String(form.get("city")).trim();
          if (!city) return { ...person, dates };
          const location = await api.createLocation(person.id, {
            city,
            address: String(form.get("address")).trim() || null,
            is_primary: true,
          });
          return { ...person, locations: [location], dates };
        })(),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("people.createFailed"));
      setSaving(false);
    }
  };
  return (
    <Modal title={t("people.modalTitle")} onClose={onClose}>
      <p className="mb-5 text-sm text-muted">{t("people.modalLead")}</p>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("people.name")}>
          <input className="input" name="name" required autoFocus />
        </Field>
        <Field label={t("people.relationship")}>
          <input
            className="input"
            name="relationship"
            placeholder={t("people.relationshipPlaceholder")}
          />
        </Field>
        <Field label={t("dates.kinds.birthday")} hint={t("locations.optionalHint")}>
          <input className="input" name="birthday" type="date" />
        </Field>
        <Field label={t("people.notes")}>
          <textarea className="input min-h-24 resize-y" name="description" />
        </Field>
        <Field label={t("locations.city")} hint={t("locations.optionalHint")}>
          <input className="input" name="city" placeholder={t("locations.cityPlaceholder")} />
        </Field>
        <Field label={t("locations.address")} hint={t("locations.optionalHint")}>
          <input className="input" name="address" placeholder={t("locations.addressPlaceholder")} />
        </Field>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t("common.saving") : t("people.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
