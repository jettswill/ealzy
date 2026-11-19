import { randomUUID } from "node:crypto";
import type { AppRepository } from "../../repository.js";
import type { MeetingNoteContext, Note } from "../../types.js";

// Заметки со встреч. Человек открывает встречу из календаря телефона и пишет,
// что обсудили. Текст ложится в обычную заметку (видна в «Заметках» на сайте),
// а привязка к событию — в meeting_notes, чтобы при следующем открытии той же
// встречи заметка нашлась, и чтобы Илзи видела её рядом с календарём.

export interface MeetingRef {
  external_id: string;
  starts_at: string;
  ends_at: string;
  title: string;
}

export interface MeetingNoteView {
  note_id: string;
  body: string;
  revision: number;
  updated_at: string;
}

const MAX_BODY = 50_000;

function dayLabel(iso: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      timeZone: timezone,
    })
      .format(new Date(iso))
      .replace(".", "");
  } catch {
    return iso.slice(0, 10);
  }
}

export function meetingNoteTitle(title: string, startsAt: string, timezone: string) {
  return `Встреча: ${title}`.slice(0, 280) + ` · ${dayLabel(startsAt, timezone)}`;
}

/** Тот же формат, что у редактора заметок на сайте: абзацы по строкам. */
export function meetingNoteDocument(body: string) {
  const lines = body.split("\n");
  return {
    type: "doc",
    content: lines.map((line) =>
      line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph" },
    ),
  };
}

function view(note: Note): MeetingNoteView {
  return {
    note_id: note.id,
    body: note.deleted_at ? "" : note.plain_text,
    revision: note.revision,
    updated_at: note.updated_at,
  };
}

export async function getMeetingNote(
  repository: AppRepository,
  ownerId: string,
  externalId: string,
  startsAt: string,
): Promise<MeetingNoteView | null> {
  const link = await repository.getMeetingNoteLink(ownerId, externalId, startsAt);
  if (!link) return null;
  const note = await repository.getNote(ownerId, link.note_id);
  if (!note || note.deleted_at) return null;
  return view(note);
}

/**
 * Сохраняет текст заметки со встречи. Последнее слово — за экраном встречи:
 * если заметку параллельно правили на сайте, перечитываем ревизию и пишем поверх.
 */
export async function saveMeetingNote(
  repository: AppRepository,
  ownerId: string,
  meeting: MeetingRef,
  rawBody: string,
  clientMutationId: string,
  timezone: string,
): Promise<MeetingNoteView> {
  const body = rawBody.replace(/\r\n?/g, "\n").slice(0, MAX_BODY);
  const startsAt = new Date(meeting.starts_at).toISOString();
  const endsAt = new Date(meeting.ends_at).toISOString();
  const link = await repository.getMeetingNoteLink(ownerId, meeting.external_id, startsAt);
  const noteId = link?.note_id ?? randomUUID();
  const title = meetingNoteTitle(meeting.title, startsAt, timezone);
  let mutationId = clientMutationId;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = link || attempt > 0 ? await repository.getNote(ownerId, noteId) : null;
    const result = await repository.mutateNote(ownerId, noteId, {
      base_revision: current?.revision ?? 0,
      client_mutation_id: mutationId,
      title,
      content: meetingNoteDocument(body),
      plain_text: body,
    });
    if (result.status === "ok") {
      await repository.saveMeetingNoteLink(ownerId, {
        note_id: noteId,
        event_external_id: meeting.external_id,
        event_starts_at: startsAt,
        event_ends_at: endsAt,
        event_title: meeting.title,
      });
      return view(result.note);
    }
    // Ревизия устарела — повторяем с новым id правки, иначе сервер вернёт старый ответ.
    mutationId = randomUUID();
  }
  throw Object.assign(new Error("Meeting note is busy, try again"), {
    status: 409,
    code: "REVISION_CONFLICT",
  });
}

/** Свежие заметки со встреч для Илзи: последние две недели, коротко. */
export async function recentMeetingNotes(
  repository: AppRepository,
  ownerId: string,
  { limit = 6, days = 14, chars = 900 } = {},
): Promise<MeetingNoteContext[]> {
  const links = await repository.listMeetingNoteLinks(ownerId, limit * 2);
  const since = Date.now() - days * 24 * 3600_000;
  const fresh = links.filter((link) => Date.parse(link.updated_at) >= since);
  const notes = await Promise.all(
    fresh.map(async (link) => ({ link, note: await repository.getNote(ownerId, link.note_id) })),
  );
  return notes
    .filter(({ note }) => note && !note.deleted_at && note.plain_text.trim())
    .slice(0, limit)
    .map(({ link, note }) => {
      const text = note!.plain_text.trim();
      return {
        title: link.event_title,
        starts_at: link.event_starts_at,
        ends_at: link.event_ends_at,
        notes: text.length > chars ? `${text.slice(0, chars)}…` : text,
        updated_at: note!.updated_at,
      };
    });
}
