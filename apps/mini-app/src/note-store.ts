import type { Note, RichTextDocument } from "./types";

const DB_NAME = "ealzy-notes";
const DB_VERSION = 1;
export const NOTES_CHANGED_EVENT = "ealzy:notes-changed";

export type NoteMutation =
  | {
      mutation_id: string;
      user_id: string;
      note_id: string;
      type: "upsert";
      base_revision: number;
      title: string;
      content: RichTextDocument;
      plain_text: string;
      created_at: string;
    }
  | {
      mutation_id: string;
      user_id: string;
      note_id: string;
      type: "delete";
      base_revision: number;
      created_at: string;
    };

type StoredNote = Note & { user_id: string };

let database: Promise<IDBDatabase> | null = null;

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });

export function openNoteDatabase() {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser cannot store notes offline"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("notes")) {
        const notes = db.createObjectStore("notes", { keyPath: ["user_id", "id"] });
        notes.createIndex("by_user", "user_id");
      }
      if (!db.objectStoreNames.contains("outbox")) {
        const outbox = db.createObjectStore("outbox", { keyPath: "mutation_id" });
        outbox.createIndex("by_user", "user_id");
        outbox.createIndex("by_user_note", ["user_id", "note_id"]);
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open note storage"));
    request.onblocked = () => reject(new Error("Note storage upgrade is blocked by another tab"));
  });
  return database;
}

function notifyNotesChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
}

export const emptyNoteDocument = (): RichTextDocument => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});

export async function listLocalNotes(userId: string, includeDeleted = false): Promise<Note[]> {
  const db = await openNoteDatabase();
  const transaction = db.transaction("notes", "readonly");
  const stored = await requestResult(
    transaction.objectStore("notes").index("by_user").getAll(IDBKeyRange.only(userId)),
  );
  await transactionDone(transaction);
  return (stored as StoredNote[])
    .filter((note) => includeDeleted || !note.deleted_at)
    .map(({ user_id: _userId, ...note }) => note)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

export async function getLocalNote(userId: string, noteId: string): Promise<Note | null> {
  const db = await openNoteDatabase();
  const transaction = db.transaction("notes", "readonly");
  const stored = (await requestResult(transaction.objectStore("notes").get([userId, noteId]))) as
    StoredNote | undefined;
  await transactionDone(transaction);
  if (!stored) return null;
  const { user_id, ...note } = stored;
  void user_id;
  return note;
}

async function replacePendingMutation(
  outbox: IDBObjectStore,
  userId: string,
  noteId: string,
  mutation: NoteMutation,
) {
  const index = outbox.index("by_user_note");
  const pending = (await requestResult(index.getAll([userId, noteId]))) as NoteMutation[];
  for (const item of pending) outbox.delete(item.mutation_id);
  outbox.put(mutation);
}

export async function createLocalNote(userId: string): Promise<Note> {
  const timestamp = new Date().toISOString();
  const note: Note = {
    id: crypto.randomUUID(),
    title: "",
    content: emptyNoteDocument(),
    plain_text: "",
    revision: 0,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    pending_sync: true,
    sync_status: "local",
  };
  await saveLocalNote(userId, note);
  return note;
}

export async function saveLocalNote(userId: string, note: Note): Promise<Note> {
  const db = await openNoteDatabase();
  const timestamp = new Date().toISOString();
  const next: Note = {
    ...note,
    deleted_at: null,
    updated_at: timestamp,
    pending_sync: true,
    sync_status: "local",
  };
  const mutation: NoteMutation = {
    mutation_id: crypto.randomUUID(),
    user_id: userId,
    note_id: next.id,
    type: "upsert",
    base_revision: next.revision,
    title: next.title,
    content: next.content,
    plain_text: next.plain_text,
    created_at: timestamp,
  };
  const transaction = db.transaction(["notes", "outbox"], "readwrite");
  transaction.objectStore("notes").put({ ...next, user_id: userId } satisfies StoredNote);
  await replacePendingMutation(transaction.objectStore("outbox"), userId, note.id, mutation);
  await transactionDone(transaction);
  notifyNotesChanged();
  return next;
}

export async function deleteLocalNote(userId: string, noteId: string): Promise<Note | null> {
  const current = await getLocalNote(userId, noteId);
  if (!current) return null;
  const db = await openNoteDatabase();
  const timestamp = new Date().toISOString();
  const next: Note = {
    ...current,
    deleted_at: timestamp,
    updated_at: timestamp,
    pending_sync: true,
    sync_status: "local",
  };
  const mutation: NoteMutation = {
    mutation_id: crypto.randomUUID(),
    user_id: userId,
    note_id: noteId,
    type: "delete",
    base_revision: current.revision,
    created_at: timestamp,
  };
  const transaction = db.transaction(["notes", "outbox"], "readwrite");
  transaction.objectStore("notes").put({ ...next, user_id: userId } satisfies StoredNote);
  const outbox = transaction.objectStore("outbox");
  if (current.revision === 0) {
    const pending = (await requestResult(
      outbox.index("by_user_note").getAll([userId, noteId]),
    )) as NoteMutation[];
    for (const item of pending) outbox.delete(item.mutation_id);
  } else {
    await replacePendingMutation(outbox, userId, noteId, mutation);
  }
  await transactionDone(transaction);
  notifyNotesChanged();
  return next;
}

export async function restoreLocalNote(userId: string, noteId: string): Promise<Note | null> {
  const current = await getLocalNote(userId, noteId);
  if (!current) return null;
  return saveLocalNote(userId, { ...current, deleted_at: null });
}

export async function listPendingNoteMutations(userId: string): Promise<NoteMutation[]> {
  const db = await openNoteDatabase();
  const transaction = db.transaction("outbox", "readonly");
  const values = (await requestResult(
    transaction.objectStore("outbox").index("by_user").getAll(IDBKeyRange.only(userId)),
  )) as NoteMutation[];
  await transactionDone(transaction);
  return values.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function markNoteSyncing(userId: string, noteId: string) {
  await patchStoredNote(userId, noteId, { sync_status: "syncing" });
}

export async function completeNoteMutation(userId: string, mutationId: string, remote: Note) {
  const db = await openNoteDatabase();
  const transaction = db.transaction(["notes", "outbox"], "readwrite");
  const outbox = transaction.objectStore("outbox");
  const mutation = (await requestResult(outbox.get(mutationId))) as NoteMutation | undefined;
  if (mutation) outbox.delete(mutationId);
  const newer = (await requestResult(
    outbox.index("by_user_note").getAll([userId, remote.id]),
  )) as NoteMutation[];
  const notes = transaction.objectStore("notes");
  if (newer.length) {
    const current = (await requestResult(notes.get([userId, remote.id]))) as StoredNote | undefined;
    for (const pending of newer) {
      outbox.put({ ...pending, base_revision: remote.revision });
    }
    notes.put({
      ...(current ?? { ...remote, user_id: userId }),
      revision: remote.revision,
      pending_sync: true,
      sync_status: "local",
    } satisfies StoredNote);
  } else {
    notes.put({
      ...remote,
      user_id: userId,
      pending_sync: false,
      sync_status: "synced",
    } satisfies StoredNote);
  }
  await transactionDone(transaction);
  notifyNotesChanged();
}

export async function failNoteMutation(userId: string, noteId: string) {
  await patchStoredNote(userId, noteId, { sync_status: "error", pending_sync: true });
}

export async function resolveNoteConflict(
  userId: string,
  mutationId: string,
  local: Note,
  remote: Note,
) {
  const db = await openNoteDatabase();
  const transaction = db.transaction(["notes", "outbox"], "readwrite");
  const outbox = transaction.objectStore("outbox");
  const notes = transaction.objectStore("notes");
  outbox.delete(mutationId);
  const pending = (await requestResult(
    outbox.index("by_user_note").getAll([userId, local.id]),
  )) as NoteMutation[];
  for (const item of pending) outbox.delete(item.mutation_id);
  const newest = (await requestResult(notes.get([userId, local.id]))) as StoredNote | undefined;
  notes.put({
    ...remote,
    user_id: userId,
    pending_sync: false,
    sync_status: "synced",
  } satisfies StoredNote);
  const timestamp = new Date().toISOString();
  const copy: Note = {
    ...(newest ?? local),
    id: crypto.randomUUID(),
    title: `${local.title || "Untitled"} (conflict copy)`,
    revision: 0,
    deleted_at: null,
    created_at: timestamp,
    updated_at: timestamp,
    pending_sync: true,
    sync_status: "conflict",
  };
  const copyMutation: NoteMutation = {
    mutation_id: crypto.randomUUID(),
    user_id: userId,
    note_id: copy.id,
    type: "upsert",
    base_revision: 0,
    title: copy.title,
    content: copy.content,
    plain_text: copy.plain_text,
    created_at: timestamp,
  };
  notes.put({ ...copy, user_id: userId } satisfies StoredNote);
  outbox.put(copyMutation);
  await transactionDone(transaction);
  notifyNotesChanged();
}

export async function mergeRemoteNotes(userId: string, remote: Note[]) {
  const db = await openNoteDatabase();
  const transaction = db.transaction(["notes", "outbox"], "readwrite");
  const outbox = transaction.objectStore("outbox");
  for (const note of remote) {
    const pending = (await requestResult(
      outbox.index("by_user_note").getAll([userId, note.id]),
    )) as NoteMutation[];
    if (pending.length) continue;
    transaction.objectStore("notes").put({
      ...note,
      user_id: userId,
      pending_sync: false,
      sync_status: "synced",
    } satisfies StoredNote);
  }
  await transactionDone(transaction);
  notifyNotesChanged();
}

async function patchStoredNote(userId: string, noteId: string, patch: Partial<Note>) {
  const db = await openNoteDatabase();
  const transaction = db.transaction("notes", "readwrite");
  const store = transaction.objectStore("notes");
  const current = (await requestResult(store.get([userId, noteId]))) as StoredNote | undefined;
  if (current) store.put({ ...current, ...patch });
  await transactionDone(transaction);
  notifyNotesChanged();
}

export function subscribeNotes(listener: () => void) {
  const handler = () => listener();
  window.addEventListener(NOTES_CHANGED_EVENT, handler);
  return () => window.removeEventListener(NOTES_CHANGED_EVENT, handler);
}

export async function resetNoteStore() {
  if (database) {
    const db = await database.catch(() => null);
    db?.close();
    database = null;
  }
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
