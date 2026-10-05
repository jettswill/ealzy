import { useState, type FormEvent } from "react";
import { personDateKinds, type PersonDate, type PersonDateKind } from "../types";
import { useI18n, pluralWord } from "../i18n";
import { Button, Card, EmptyState, Field, IconButton, Modal } from "./ui";

const pad = (value: number) => String(value).padStart(2, "0");
const kindRank = (kind: PersonDateKind) =>
  ({ birthday: 0, wedding: 1, met: 2, anniversary: 3, other: 4 })[kind];

export function birthdayOf(dates: PersonDate[] | null | undefined) {
  return (dates ?? []).find((date) => date.kind === "birthday") ?? null;
}

export function personAge(date: Pick<PersonDate, "month" | "day" | "year">, now = new Date()) {
  if (date.year == null) return null;
  let age = now.getFullYear() - date.year;
  const past =
    now.getMonth() + 1 > date.month ||
    (now.getMonth() + 1 === date.month && now.getDate() >= date.day);
  if (!past) age -= 1;
  return age >= 0 ? age : null;
}

export function formatPersonDate(
  date: Pick<PersonDate, "month" | "day" | "year">,
  locale: string,
) {
  const year = date.year ?? 2000;
  const value = new Date(Date.UTC(year, date.month - 1, date.day));
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: date.year ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(value);
}

export function formatPersonDateLine(
  date: Pick<PersonDate, "kind" | "label" | "month" | "day" | "year">,
  t: (key: string) => string,
  locale: string,
) {
  return `${date.label?.trim() || t(`dates.kinds.${date.kind}`)} · ${formatPersonDate(date, locale)}`;
}

type DateDraft = Pick<PersonDate, "kind" | "month" | "day"> &
  Partial<Pick<PersonDate, "label" | "year">>;

export function DatesSection({
  dates,
  onCreate,
  onUpdate,
  onDelete,
  className = "mt-6",
}: {
  dates: PersonDate[];
  onCreate: (input: DateDraft) => Promise<PersonDate>;
  onUpdate: (id: string, input: DateDraft) => Promise<PersonDate>;
  onDelete: (id: string) => Promise<void>;
  className?: string;
}) {
  const { t, language, locale } = useI18n();
  const ordered = [...dates].sort(
    (a, b) =>
      kindRank(a.kind) - kindRank(b.kind) || a.month - b.month || a.day - b.day,
  );
  const [editing, setEditing] = useState<PersonDate | "new" | null>(null);
  const [error, setError] = useState("");

  const remove = async (date: PersonDate) => {
    if (!window.confirm(t("dates.deleteConfirm"))) return;
    setError("");
    try {
      await onDelete(date.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("dates.deleteFailed"));
    }
  };

  return (
    <section className={className} aria-labelledby="dates-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">{t("dates.eyebrow")}</p>
          <h2 id="dates-title" className="text-xl font-bold">
            {t("dates.title")}
          </h2>
        </div>
        {dates.length > 0 && (
          <Button variant="secondary" onClick={() => setEditing("new")}>
            {t("dates.add")}
          </Button>
        )}
      </div>
      <p className="mb-3 text-sm text-muted">{t("dates.description")}</p>
      {error && (
        <p className="error-text mb-3" role="alert">
          {error}
        </p>
      )}
      {!dates.length ? (
        <EmptyState
          icon="◎"
          title={t("dates.empty")}
          description={t("dates.emptyText")}
          action={
            <Button variant="secondary" onClick={() => setEditing("new")}>
              {t("dates.add")}
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {ordered.map((date) => {
            const age = date.kind === "birthday" ? personAge(date) : null;
            return (
              <Card key={date.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{formatPersonDateLine(date, t, locale)}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="tag">{t(`dates.kinds.${date.kind}`)}</span>
                    {age != null && (
                      <span className="tag">
                        {t("dates.age", {
                          n: age,
                          word: pluralWord(language, age, {
                            one: t("dates.yearOne"),
                            few: t("dates.yearFew"),
                            many: t("dates.yearMany"),
                          }),
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <IconButton label={t("dates.edit")} onClick={() => setEditing(date)}>
                    ✎
                  </IconButton>
                  <IconButton label={t("dates.delete")} onClick={() => void remove(date)}>
                    ×
                  </IconButton>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {editing && (
        <DateForm
          date={editing === "new" ? undefined : editing}
          takenKinds={dates
            .filter((item) => editing === "new" || item.id !== editing.id)
            .map((item) => item.kind)}
          onClose={() => setEditing(null)}
          onSaved={async (input) => {
            if (editing === "new") await onCreate(input);
            else await onUpdate(editing.id, input);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function DateForm({
  date,
  takenKinds,
  onClose,
  onSaved,
}: {
  date?: PersonDate;
  takenKinds: PersonDateKind[];
  onClose: () => void;
  onSaved: (input: DateDraft) => Promise<void>;
}) {
  const { t } = useI18n();
  const uniqueKinds: PersonDateKind[] = ["birthday", "met", "wedding"];
  const defaultKind =
    date?.kind ??
    personDateKinds.find((item) => !uniqueKinds.includes(item) || !takenKinds.includes(item)) ??
    "other";
  const [kind, setKind] = useState<PersonDateKind>(defaultKind);
  const [yearUnknown, setYearUnknown] = useState(date ? date.year == null : false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const defaultDate = date
    ? `${date.year ?? new Date().getFullYear()}-${pad(date.month)}-${pad(date.day)}`
    : "";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = String(form.get("occurred_on") ?? "");
    const [year, month, day] = raw.split("-").map(Number);
    if (!month || !day) {
      setError(t("dates.saveFailed"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSaved({
        kind,
        label: String(form.get("label") ?? "").trim() || null,
        month,
        day,
        year: yearUnknown || !year ? null : year,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("dates.saveFailed"));
      setSaving(false);
    }
  };
  return (
    <Modal title={date ? t("dates.editTitle") : t("dates.addTitle")} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("dates.kind")}>
          <select
            className="input"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as PersonDateKind)}
          >
            {personDateKinds.map((item) => (
              <option
                key={item}
                value={item}
                disabled={uniqueKinds.includes(item) && takenKinds.includes(item)}
              >
                {t(`dates.kinds.${item}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("dates.on")}>
          <input className="input" name="occurred_on" type="date" defaultValue={defaultDate} required />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <input
            className="mt-1"
            type="checkbox"
            name="year_unknown"
            checked={yearUnknown}
            onChange={(event) => setYearUnknown(event.target.checked)}
          />
          <span>
            {t("dates.yearUnknown")}
            <span className="mt-0.5 block text-xs text-muted">{t("dates.yearUnknownHint")}</span>
          </span>
        </label>
        {(kind === "other" || kind === "anniversary") && (
          <Field label={t("dates.label")} hint={kind === "other" ? undefined : t("dates.labelHint")}>
            <input
              className="input"
              name="label"
              defaultValue={date?.label ?? ""}
              required={kind === "other"}
              placeholder={t("dates.labelPlaceholder")}
            />
          </Field>
        )}
        {error && <p className="error-text">{error}</p>}
        <Button className="w-full" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("dates.save")}
        </Button>
      </form>
    </Modal>
  );
}
