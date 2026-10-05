import { describe, expect, it, vi } from "vitest";
import {
  createLocalNote,
  getLocalNote,
  listLocalNotes,
  listPendingNoteMutations,
  saveLocalNote,
} from "../note-store";
import { flushNoteOutbox, type NoteTransport } from "../note-sync";
import type { Note } from "../types";

const userId = "11111111-1111-4111-8111-111111111111";

describe("offline note storage and sync", () => {
  it("stores a new note and its outbox mutation transactionally", async () => {
    const note = await createLocalNote(userId);
    expect((await listLocalNotes(userId)).map((item) => item.id)).toEqual([note.id]);
    const mutations = await listPendingNoteMutations(userId);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({ note_id: note.id, type: "upsert", base_revision: 0 });
  });

  it("coalesces frequent edits without dropping the latest content", async () => {
    const note = await createLocalNote(userId);
    await saveLocalNote(userId, { ...note, title: "First" });
    await saveLocalNote(userId, { ...note, title: "Latest", plain_text: "durable text" });
    expect(await listPendingNoteMutations(userId)).toHaveLength(1);
    expect(await getLocalNote(userId, note.id)).toMatchObject({
      title: "Latest",
      plain_text: "durable text",
      pending_sync: true,
    });
  });

  it("keeps edits locally while offline and flushes them after reconnect", async () => {
    const note = await createLocalNote(userId);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const request = vi.fn();
    await flushNoteOutbox(userId, {
      request: request as unknown as NoteTransport["request"],
    });
    expect(request).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    request.mockImplementation(async (path: string) => {
      if (path === "/api/notes") return [];
      return {
        ...note,
        revision: 1,
        pending_sync: false,
        sync_status: "synced",
      } satisfies Note;
    });
    await flushNoteOutbox(userId, {
      request: request as unknown as NoteTransport["request"],
    });
    expect(await listPendingNoteMutations(userId)).toEqual([]);
    expect(await getLocalNote(userId, note.id)).toMatchObject({
      revision: 1,
      pending_sync: false,
      sync_status: "synced",
    });
  });

  it("preserves a conflicting local edit as a separate note", async () => {
    const note = await createLocalNote(userId);
    await saveLocalNote(userId, { ...note, title: "My offline edit", plain_text: "Never lose me" });
    const remote: Note = {
      ...note,
      title: "Edited elsewhere",
      revision: 2,
      pending_sync: false,
      sync_status: "synced",
    };
    const request = vi.fn(async <T>(path: string): Promise<T> => {
      if (path === "/api/notes") return [remote] as T;
      throw Object.assign(new Error("Conflict"), {
        status: 409,
        details: { note: remote },
      });
    });
    await flushNoteOutbox(userId, {
      request: request as unknown as NoteTransport["request"],
    });
    const notes = await listLocalNotes(userId);
    expect(notes).toHaveLength(2);
    expect(notes.some((item) => item.title === "Edited elsewhere")).toBe(true);
    expect(notes.some((item) => item.plain_text === "Never lose me")).toBe(true);
  });

  it("does not overwrite typing that happens while an older save is in flight", async () => {
    const note = await createLocalNote(userId);
    let release!: (note: Note) => void;
    const response = new Promise<Note>((resolve) => {
      release = resolve;
    });
    const request = vi.fn((path: string) =>
      path === "/api/notes" ? Promise.resolve([]) : response,
    );
    const flushing = flushNoteOutbox(userId, { request: request as never });
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    await saveLocalNote(userId, {
      ...note,
      title: "Typed while syncing",
      plain_text: "Latest local text",
    });
    release({ ...note, revision: 1, pending_sync: false, sync_status: "synced" });
    await flushing;

    expect(await getLocalNote(userId, note.id)).toMatchObject({
      title: "Typed while syncing",
      plain_text: "Latest local text",
      revision: 1,
      pending_sync: true,
    });
    expect(await listPendingNoteMutations(userId)).toEqual([
      expect.objectContaining({ note_id: note.id, base_revision: 1 }),
    ]);
  });
});
