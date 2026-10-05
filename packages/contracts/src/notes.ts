import { z } from "zod";
import { entityIdSchema, isoDateTimeSchema } from "./common.js";
import type { ApiSuccessEnvelope } from "./common.js";

export const noteContentSchema = z.record(z.string(), z.unknown());

export const noteSchema = z
  .object({
    id: entityIdSchema,
    owner_id: entityIdSchema,
    title: z.string().max(300),
    content: noteContentSchema,
    plain_text: z.string(),
    revision: z.number().int().positive(),
    deleted_at: isoDateTimeSchema.nullable(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const noteRevisionSchema = z
  .object({
    id: entityIdSchema,
    note_id: entityIdSchema,
    owner_id: entityIdSchema,
    revision: z.number().int().positive(),
    title: z.string().max(300),
    content: noteContentSchema,
    plain_text: z.string(),
    deleted_at: isoDateTimeSchema.nullable(),
    client_mutation_id: entityIdSchema,
    created_at: isoDateTimeSchema,
  })
  .strict();

export const noteMutationSchema = z
  .object({
    base_revision: z.number().int().nonnegative(),
    client_mutation_id: entityIdSchema,
    title: z.string().max(300).default(""),
    content: noteContentSchema,
    plain_text: z.string().max(1_000_000),
  })
  .strict();

export const deleteNoteSchema = z
  .object({
    base_revision: z.number().int().positive(),
    client_mutation_id: entityIdSchema,
  })
  .strict();

const actionTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(4000).nullable().optional(),
    due_at: isoDateTimeSchema.nullable().optional(),
  })
  .strict();

export const noteActionProposalSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("goal"),
      goal: z
        .object({
          title: z.string().trim().min(1).max(300),
          description: z.string().trim().max(4000).nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tasks"),
      tasks: z.array(actionTaskSchema).min(1).max(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal("plan"),
      title: z.string().trim().min(1).max(300),
      description: z.string().trim().max(4000).nullable().optional(),
      current_plan: z.string().trim().min(1).max(20_000),
      tasks: z.array(actionTaskSchema).max(20),
    })
    .strict(),
]);

export const previewNoteActionSchema = z
  .object({
    instruction: z.string().trim().min(1).max(4000),
  })
  .strict();

export const noteActionPreviewSchema = z
  .object({
    id: entityIdSchema,
    owner_id: entityIdSchema,
    note_id: entityIdSchema,
    note_revision: z.number().int().positive(),
    instruction: z.string(),
    proposal: noteActionProposalSchema,
    status: z.enum(["pending", "confirmed"]),
    confirmed_at: isoDateTimeSchema.nullable(),
    result: z.record(z.string(), z.unknown()).nullable(),
    created_at: isoDateTimeSchema,
  })
  .strict();

export const confirmNoteActionSchema = z
  .object({
    proposal: noteActionProposalSchema.optional(),
  })
  .strict();

export type NoteContent = z.infer<typeof noteContentSchema>;
export type Note = z.infer<typeof noteSchema>;
export type NoteRevision = z.infer<typeof noteRevisionSchema>;
export type NoteMutation = z.infer<typeof noteMutationSchema>;
export type DeleteNote = z.infer<typeof deleteNoteSchema>;
export type NoteActionProposal = z.infer<typeof noteActionProposalSchema>;
export type NoteActionPreview = z.infer<typeof noteActionPreviewSchema>;
export type PreviewNoteAction = z.infer<typeof previewNoteActionSchema>;
export type ConfirmNoteAction = z.infer<typeof confirmNoteActionSchema>;
export type NotesListResponse = ApiSuccessEnvelope<Note[]>;
export type NoteMutationResponse = ApiSuccessEnvelope<Note>;
export type NoteActionResponse = ApiSuccessEnvelope<NoteActionPreview>;
