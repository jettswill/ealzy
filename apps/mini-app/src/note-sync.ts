import type { Note } from "./types";
import {
  completeNoteMutation,
  failNoteMutation,
  getLocalNote,
  listPendingNoteMutations,
  markNoteSyncing,
  mergeRemoteNotes,
  resolveNoteConflict,
  subscribeNotes,
  type NoteMutation,
} from "./note-store";

export type NoteTransport = {
  request<T>(path: string, init?: RequestInit, authenticated?: boolean): Promise<T>;
};

let flushing: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

function statusOf(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const value = (error as { status?: unknown }).status;
  return typeof value === "number" ? value : undefined;
}

function conflictNoteOf(error: unknown): Note | null {
  if (!error || typeof error !== "object") return null;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const candidate =
    "note" in details
      ? (details as { note?: unknown }).note
      : "server_note" in details
        ? (details as { server_note?: unknown }).server_note
        : null;
  return candidate && typeof candidate === "object" && "id" in candidate
    ? (candidate as Note)
    : null;
}

function mutationRequest(mutation: NoteMutation): [string, RequestInit] {
  if (mutation.type === "delete") {
    return [
      `/api/notes/${mutation.note_id}`,
      {
        method: "DELETE",
        body: JSON.stringify({
          client_mutation_id: mutation.mutation_id,
          base_revision: mutation.base_revision,
        }),
      },
    ];
  }
  return [
    `/api/notes/${mutation.note_id}`,
    {
      method: "PUT",
      body: JSON.stringify({
        client_mutation_id: mutation.mutation_id,
        base_revision: mutation.base_revision,
        title: mutation.title,
        content: mutation.content,
        plain_text: mutation.plain_text,
      }),
    },
  ];
}

export async function flushNoteOutbox(
  userId: string,
  transport: NoteTransport,
  options: { pull?: boolean } = {},
) {
  if (flushing) return flushing;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  flushing = (async () => {
    const mutations = await listPendingNoteMutations(userId);
    for (const mutation of mutations) {
      const local = await getLocalNote(userId, mutation.note_id);
      if (!local) continue;
      await markNoteSyncing(userId, mutation.note_id);
      const [path, init] = mutationRequest(mutation);
      try {
        const remote = await transport.request<Note>(path, init);
        await completeNoteMutation(userId, mutation.mutation_id, remote);
        retryAttempt = 0;
      } catch (error) {
        const status = statusOf(error);
        const remote = status === 409 ? conflictNoteOf(error) : null;
        if (remote) {
          await resolveNoteConflict(userId, mutation.mutation_id, local, remote);
          continue;
        }
        await failNoteMutation(userId, mutation.note_id);
        if (
          status === 400 ||
          status === 401 ||
          status === 403 ||
          status === 404 ||
          status === 422
        ) {
          return;
        }
        scheduleRetry(userId, transport);
        return;
      }
    }
    if (options.pull || mutations.length) {
      try {
        await mergeRemoteNotes(userId, await transport.request<Note[]>("/api/notes"));
      } catch {
        // The durable local snapshot remains authoritative until the next retry.
      }
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

function scheduleRetry(userId: string, transport: NoteTransport) {
  if (retryTimer) clearTimeout(retryTimer);
  const delay = Math.min(30_000, 1_000 * 2 ** retryAttempt++);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushNoteOutbox(userId, transport, { pull: true });
  }, delay);
}

export function queueNoteFlush(userId: string, transport: NoteTransport, immediate = false) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(
    () => {
      flushTimer = null;
      void flushNoteOutbox(userId, transport);
    },
    immediate ? 0 : 650,
  );
}

export function startNoteSync(userId: string, transport: NoteTransport) {
  const onOnline = () => void flushNoteOutbox(userId, transport, { pull: true });
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      void flushNoteOutbox(userId, transport, { pull: true });
    }
  };
  const unsubscribe = subscribeNotes(() => queueNoteFlush(userId, transport));
  const onFocus = () => void flushNoteOutbox(userId, transport, { pull: true });
  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);
  void requestPersistentStorage();
  void flushNoteOutbox(userId, transport, { pull: true });
  return () => {
    unsubscribe();
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
    if (flushTimer) clearTimeout(flushTimer);
    if (retryTimer) clearTimeout(retryTimer);
    flushTimer = null;
    retryTimer = null;
  };
}

async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    // IndexedDB still works when persistence cannot be granted.
  }
}

export function resetNoteSyncState() {
  if (flushTimer) clearTimeout(flushTimer);
  if (retryTimer) clearTimeout(retryTimer);
  flushTimer = null;
  retryTimer = null;
  retryAttempt = 0;
  flushing = null;
}
