import { useState, type FormEvent } from "react";
import type { PersonLocation } from "../types";
import { useI18n } from "../i18n";
import { Button, Card, EmptyState, Field, IconButton, Modal } from "./ui";

export function formatLocationLine(location: Pick<PersonLocation, "city" | "address" | "label">) {
  const place = [location.city, location.address].filter(Boolean).join(", ");
  return location.label ? `${location.label}: ${place}` : place;
}

type LocationDraft = Pick<PersonLocation, "city"> &
  Partial<Pick<PersonLocation, "label" | "address" | "is_primary">>;

export function LocationsSection({
  locations,
  onCreate,
  onUpdate,
  onDelete,
  className = "mt-6",
}: {
  locations: PersonLocation[];
  onCreate: (input: LocationDraft) => Promise<PersonLocation>;
  onUpdate: (id: string, input: LocationDraft) => Promise<PersonLocation>;
  onDelete: (id: string) => Promise<void>;
  className?: string;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<PersonLocation | "new" | null>(null);
  const [error, setError] = useState("");

  const remove = async (location: PersonLocation) => {
    if (!window.confirm(t("locations.deleteConfirm"))) return;
    setError("");
    try {
      await onDelete(location.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("locations.deleteFailed"));
    }
  };

  return (
    <section className={className} aria-labelledby="locations-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">{t("locations.eyebrow")}</p>
          <h2 id="locations-title" className="text-xl font-bold">
            {t("locations.title")}
          </h2>
        </div>
        <Button variant="secondary" onClick={() => setEditing("new")}>
          {t("locations.add")}
        </Button>
      </div>
      <p className="mb-3 text-sm text-muted">{t("locations.description")}</p>
      {error && (
        <p className="error-text mb-3" role="alert">
          {error}
        </p>
      )}
      {!locations.length ? (
        <EmptyState
          icon="⌖"
          title={t("locations.empty")}
          description={t("locations.emptyText")}
          action={
            <Button variant="secondary" onClick={() => setEditing("new")}>
              {t("locations.add")}
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {locations.map((location) => (
            <Card key={location.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{formatLocationLine(location)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {location.is_primary && <span className="tag">{t("locations.primary")}</span>}
                  {location.label && !location.is_primary && (
                    <span className="tag">{location.label}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                <IconButton label={t("locations.edit")} onClick={() => setEditing(location)}>
                  ✎
                </IconButton>
                <IconButton label={t("locations.delete")} onClick={() => void remove(location)}>
                  ×
                </IconButton>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <LocationForm
          location={editing === "new" ? undefined : editing}
          allowPrimary={locations.length > 0}
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

function LocationForm({
  location,
  allowPrimary,
  onClose,
  onSaved,
}: {
  location?: PersonLocation;
  allowPrimary: boolean;
  onClose: () => void;
  onSaved: (input: LocationDraft) => Promise<void>;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      await onSaved({
        city: String(form.get("city")).trim(),
        address: String(form.get("address")).trim() || null,
        label: String(form.get("label")).trim() || null,
        is_primary: form.get("is_primary") === "on" || (!location && !allowPrimary),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("locations.saveFailed"));
      setSaving(false);
    }
  };
  return (
    <Modal title={location ? t("locations.editTitle") : t("locations.addTitle")} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("locations.city")} hint={t("locations.cityHint")}>
          <input
            className="input"
            name="city"
            defaultValue={location?.city ?? ""}
            placeholder={t("locations.cityPlaceholder")}
            required
            autoFocus
          />
        </Field>
        <Field label={t("locations.address")} hint={t("locations.addressHint")}>
          <input
            className="input"
            name="address"
            defaultValue={location?.address ?? ""}
            placeholder={t("locations.addressPlaceholder")}
          />
        </Field>
        <Field label={t("locations.label")} hint={t("locations.labelHint")}>
          <input
            className="input"
            name="label"
            defaultValue={location?.label ?? ""}
            placeholder={t("locations.labelPlaceholder")}
          />
        </Field>
        {(allowPrimary || location) && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_primary"
              defaultChecked={location?.is_primary ?? false}
            />
            {t("locations.primaryHint")}
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        <Button className="w-full" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("locations.save")}
        </Button>
      </form>
    </Modal>
  );
}
