import {
  noteActionProposalSchema,
  type NoteActionPreview,
  type NoteActionProposal,
} from "@lifeos/contracts";
import type { AppRepository } from "../../repository.js";

export interface NoteActionAi {
  previewNoteAction?(
    note: { title: string; content: Record<string, unknown>; plain_text: string; revision: number },
    instruction: string,
  ): Promise<unknown>;
}

export class NoteActionService {
  constructor(
    private readonly repository: AppRepository,
    private readonly ai?: NoteActionAi,
  ) {}

  async preview(ownerId: string, noteId: string, instruction: string): Promise<NoteActionPreview> {
    const note = await this.repository.getNote(ownerId, noteId);
    if (!note || note.deleted_at)
      throw Object.assign(new Error("Note not found"), { status: 404, code: "NOT_FOUND" });
    if (!this.ai?.previewNoteAction)
      throw Object.assign(new Error("AI note actions are not configured"), {
        status: 503,
        code: "AI_UNAVAILABLE",
      });
    const proposal = noteActionProposalSchema.parse(
      await this.ai.previewNoteAction(
        {
          title: note.title,
          content: note.content,
          plain_text: note.plain_text,
          revision: note.revision,
        },
        instruction,
      ),
    );
    return this.repository.createNoteAction(ownerId, {
      note_id: note.id,
      note_revision: note.revision,
      instruction,
      proposal,
    });
  }

  async confirm(ownerId: string, actionId: string, proposal?: NoteActionProposal) {
    const validated = proposal ? noteActionProposalSchema.parse(proposal) : undefined;
    const action = await this.repository.confirmNoteAction(ownerId, actionId, validated);
    if (!action)
      throw Object.assign(new Error("Note action not found"), { status: 404, code: "NOT_FOUND" });
    return action;
  }
}
