import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { NoteEditor } from "../components/NoteEditor";
import { Button, ErrorState, LoadingState, Modal } from "../components/ui";
import { useI18n } from "../i18n";
import { flushNoteOutbox } from "../note-sync";
import { subscribeNotes } from "../note-store";
import type { Note, NoteActionDraft, NoteActionKind, RichTextDocument } from "../types";

export function NotePage() {
  const { id = "" } = useParams();
  const { api, ownerId } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [action, setAction] = useState<NoteActionKind | null>(null);
  const [draft, setDraft] = useState<NoteActionDraft | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false,
  );
  const saveChain = useRef(Promise.resolve());
  const noteRef = useRef<Note | null>(null);
  const saveVersion = useRef(0);

  const load = useCallback(async () => {
    if (!ownerId) return;
    try {
      const value = await api.note(ownerId, id);
      noteRef.current = value;
      setNote(value);
      setLoadError(value ? "" : t("notes.notFound"));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : t("notes.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [api, id, ownerId, t]);

  useEffect(() => {
    void load();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeNotes(() => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        const pendingSaves = saveChain.current;
        void pendingSaves.then(load);
      }, 2_000);
    });
    return () => {
      unsubscribe();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [load]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const persist = (next: Note) => {
    const version = ++saveVersion.current;
    const optimistic = { ...next, pending_sync: true, sync_status: "local" as const };
    noteRef.current = optimistic;
    setNote(optimistic);
    setSaveError("");
    if (!ownerId) return;
    saveChain.current = saveChain.current
      .then(async () => {
        const saved = await api.updateNote(ownerId, next);
        setNote((current) => {
          if (saveVersion.current !== version) return current;
          noteRef.current = saved;
          return saved;
        });
      })
      .catch((cause) => {
        setSaveError(cause instanceof Error ? cause.message : t("notes.localSaveFailed"));
      });
  };

  const updateContent = (content: RichTextDocument, plainText: string) => {
    const current = noteRef.current;
    if (!current) return;
    persist({ ...current, content, plain_text: plainText, updated_at: new Date().toISOString() });
  };

  const previewAction = async (kind: NoteActionKind) => {
    if (!ownerId || !note || navigator.onLine === false) return;
    setAction(kind);
    setDraft(null);
    setActionError("");
    setActionBusy(true);
    try {
      await saveChain.current;
      await flushNoteOutbox(ownerId, api);
      setDraft(await api.previewNoteAction(note.id, kind));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : t("notes.actionFailed"));
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) return <LoadingState label={t("notes.loading")} />;
  if (loadError || !note) return <ErrorState message={loadError || t("notes.notFound")} />;

  return (
    <div className="note-page">
      <header className="note-page-header">
        <Link className="back-link" to="/notes">
          {t("notes.back")}
        </Link>
        <div className="note-header-actions">
          <span
            className={`note-save-status ${saveError ? "note-save-status-error" : ""}`}
            role="status"
          >
            {saveError || saveStatus(note, online, t)}
          </span>
          <Button
            variant="danger"
            onClick={async () => {
              if (!ownerId || !window.confirm(t("notes.deleteConfirm"))) return;
              await api.deleteNote(ownerId, note.id);
              navigate("/notes", { replace: true, state: { deletedNoteId: note.id } });
            }}
          >
            {t("common.delete")}
          </Button>
        </div>
      </header>

      <input
        className="note-title-input"
        value={note.title}
        onChange={(event) => {
          const current = noteRef.current;
          if (current) {
            persist({
              ...current,
              title: event.target.value,
              updated_at: new Date().toISOString(),
            });
          }
        }}
        placeholder={t("notes.untitled")}
        aria-label={t("notes.noteTitle")}
      />

      <div className="note-action-row">
        <Button
          variant="secondary"
          disabled={!online}
          title={!online ? t("notes.actionsOnline") : undefined}
          onClick={() =>
            navigate("/companion", {
              state: {
                draft: `${t("notes.discussPrompt")}\n\n${note.title}\n${note.plain_text}`.trim(),
                autoSend: true,
              },
            })
          }
        >
          {t("notes.discuss")}
        </Button>
        {(["plan", "goal", "tasks"] as const).map((kind) => (
          <Button
            key={kind}
            variant="secondary"
            disabled={!online}
            title={!online ? t("notes.actionsOnline") : undefined}
            onClick={() => void previewAction(kind)}
          >
            {t(`notes.action.${kind}`)}
          </Button>
        ))}
      </div>

      {!online && <p className="note-offline-hint">{t("notes.offlineHint")}</p>}
      <NoteEditor content={note.content} onChange={updateContent} />

      {action && (
        <NoteActionModal
          action={action}
          draft={draft}
          busy={actionBusy}
          error={actionError}
          onDraft={setDraft}
          onClose={() => {
            setAction(null);
            setDraft(null);
          }}
          onConfirm={async () => {
            if (!draft) return;
            setActionBusy(true);
            setActionError("");
            try {
              const result = await api.confirmNoteAction(draft);
              setAction(null);
              setDraft(null);
              const entity = result.entities[0];
              if (entity?.url) navigate(entity.url);
            } catch (cause) {
              setActionError(cause instanceof Error ? cause.message : t("notes.actionFailed"));
            } finally {
              setActionBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function saveStatus(
  note: Note,
  online: boolean,
  t: (key: string, values?: Record<string, string | number>) => string,
) {
  if (!online) return t("notes.savedOnDevice");
  if (note.sync_status === "error") return t("notes.syncError");
  if (note.sync_status === "conflict") return t("notes.conflictCopy");
  if (note.pending_sync || note.sync_status === "local" || note.sync_status === "syncing") {
    return t("notes.syncing");
  }
  return t("notes.saved");
}

function NoteActionModal({
  action,
  draft,
  busy,
  error,
  onDraft,
  onClose,
  onConfirm,
}: {
  action: NoteActionKind;
  draft: NoteActionDraft | null;
  busy: boolean;
  error: string;
  onDraft: (draft: NoteActionDraft) => void;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <Modal title={t(`notes.preview.${action}`)} onClose={onClose}>
      {busy && !draft ? (
        <LoadingState label={t("notes.preparing")} />
      ) : draft ? (
        <div className="note-action-preview">
          {draft.payload.goal && (
            <>
              <label className="field-label" htmlFor="note-action-title">
                {t("common.title")}
              </label>
              <input
                id="note-action-title"
                className="input"
                value={draft.payload.goal.title}
                onChange={(event) =>
                  onDraft({
                    ...draft,
                    payload: {
                      ...draft.payload,
                      goal: { ...draft.payload.goal!, title: event.target.value },
                    },
                  })
                }
              />
              <label className="field-label mt-3 block" htmlFor="note-action-description">
                {action === "plan" ? t("notes.plan") : t("common.description")}
              </label>
              <textarea
                id="note-action-description"
                className="input min-h-32"
                value={
                  action === "plan"
                    ? (draft.payload.goal.current_plan ?? "")
                    : (draft.payload.goal.description ?? "")
                }
                onChange={(event) =>
                  onDraft({
                    ...draft,
                    payload: {
                      ...draft.payload,
                      goal: {
                        ...draft.payload.goal!,
                        ...(action === "plan"
                          ? { current_plan: event.target.value }
                          : { description: event.target.value }),
                      },
                    },
                  })
                }
              />
            </>
          )}
          {!!draft.payload.tasks?.length && (
            <div className="mt-4">
              <p className="field-label">{t("notes.tasks")}</p>
              {draft.payload.tasks.map((task, index) => (
                <input
                  key={index}
                  className="input mt-2"
                  value={task.title}
                  onChange={(event) => {
                    const tasks = [...(draft.payload.tasks ?? [])];
                    tasks[index] = { ...task, title: event.target.value };
                    onDraft({ ...draft, payload: { ...draft.payload, tasks } });
                  }}
                />
              ))}
            </div>
          )}
          {error && <p className="error-text mt-3">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button disabled={busy} onClick={() => void onConfirm()}>
              {busy ? t("common.creating") : t("notes.confirmCreate")}
            </Button>
          </div>
        </div>
      ) : (
        <ErrorState message={error || t("notes.actionFailed")} />
      )}
    </Modal>
  );
}
