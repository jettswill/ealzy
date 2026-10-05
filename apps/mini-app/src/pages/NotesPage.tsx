import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from "../components/ui";
import { useCreateIntent } from "../create-intent";
import { useI18n } from "../i18n";
import { useLiveRefresh } from "../live-refresh";
import { subscribeNotes } from "../note-store";
import type { Note } from "../types";

export function NotesPage() {
  const { api, ownerId } = useAuth();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const deletedFromNavigation = (location.state as { deletedNoteId?: string } | null)
    ?.deletedNoteId;
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletedId, setDeletedId] = useState<string | null>(deletedFromNavigation ?? null);

  const load = useCallback(async () => {
    if (!ownerId) return;
    try {
      setNotes(await api.notes(ownerId));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("notes.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [api, ownerId, t]);

  useEffect(() => {
    void load();
    return subscribeNotes(() => void load());
  }, [load]);
  useLiveRefresh(load, Boolean(ownerId));

  useEffect(() => {
    if (!deletedFromNavigation) return;
    navigate(".", { replace: true, state: {} });
  }, [deletedFromNavigation, navigate]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    if (!normalized) return notes;
    return notes.filter((note) =>
      `${note.title}\n${note.plain_text}`.toLocaleLowerCase(locale).includes(normalized),
    );
  }, [locale, notes, query]);

  const create = async () => {
    if (!ownerId) return;
    try {
      const note = await api.createNote(ownerId);
      navigate(`/notes/${note.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("notes.localSaveFailed"));
    }
  };
  useCreateIntent(() => void create());

  return (
    <>
      <PageHeader
        eyebrow={t("notes.eyebrow")}
        title={t("notes.title")}
        description={t("notes.description")}
        action={<Button onClick={() => void create()}>{t("notes.create")}</Button>}
      />
      {deletedId && (
        <div className="note-undo" role="status">
          <span>{t("notes.deleted")}</span>
          <button
            type="button"
            onClick={async () => {
              if (!ownerId) return;
              await api.restoreNote(ownerId, deletedId);
              setDeletedId(null);
            }}
          >
            {t("notes.undo")}
          </button>
        </div>
      )}
      <label className="search-box mb-4">
        <span aria-hidden="true">⌕</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("notes.search")}
          aria-label={t("notes.search")}
        />
      </label>
      {loading ? (
        <LoadingState label={t("notes.loading")} />
      ) : error ? (
        <ErrorState message={error} retry={load} />
      ) : filtered.length ? (
        <div className="notes-grid">
          {filtered.map((note) => (
            <article className="note-card" key={note.id}>
              <Link to={`/notes/${note.id}`} className="note-card-link">
                <strong>{note.title.trim() || t("notes.untitled")}</strong>
                <p>{note.plain_text.trim() || t("notes.emptyNote")}</p>
                <span>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(note.updated_at))}
                  {note.pending_sync ? ` · ${t("notes.local")}` : ""}
                </span>
              </Link>
              <button
                type="button"
                className="note-card-delete"
                aria-label={t("notes.deleteNamed", {
                  name: note.title.trim() || t("notes.untitled"),
                })}
                onClick={async () => {
                  if (!ownerId || !window.confirm(t("notes.deleteConfirm"))) return;
                  await api.deleteNote(ownerId, note.id);
                  setDeletedId(note.id);
                }}
              >
                ×
              </button>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="▤"
          title={query ? t("notes.noResults") : t("notes.empty")}
          description={query ? t("notes.noResultsText") : t("notes.emptyText")}
        />
      )}
    </>
  );
}
