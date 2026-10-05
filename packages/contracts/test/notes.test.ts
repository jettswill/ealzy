import { describe, expect, it } from "vitest";
import {
  confirmNoteActionSchema,
  deleteNoteSchema,
  noteActionProposalSchema,
  noteMutationSchema,
  noteSchema,
} from "../src/index.js";

const id = "550e8400-e29b-41d4-a716-446655440000";
const timestamp = "2026-09-01T08:00:00.000Z";

describe("note contracts", () => {
  it("validates rich note state and versioned mutations", () => {
    expect(
      noteSchema.parse({
        id,
        owner_id: id,
        title: "Draft",
        content: { type: "doc", content: [] },
        plain_text: "Text",
        revision: 2,
        deleted_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      }).revision,
    ).toBe(2);
    expect(
      noteMutationSchema.parse({
        base_revision: 0,
        client_mutation_id: id,
        content: { type: "doc" },
        plain_text: "",
      }).title,
    ).toBe("");
    expect(deleteNoteSchema.safeParse({ base_revision: 0, client_mutation_id: id }).success).toBe(
      false,
    );
    expect(
      noteMutationSchema.safeParse({
        base_revision: 0,
        client_mutation_id: id,
        title: "x".repeat(301),
        content: {},
        plain_text: "",
      }).success,
    ).toBe(false);
  });

  it("accepts goal, tasks, and new-goal plan proposals", () => {
    expect(
      noteActionProposalSchema.parse({
        kind: "goal",
        goal: { title: "Launch", description: null },
      }).kind,
    ).toBe("goal");
    expect(
      noteActionProposalSchema.parse({
        kind: "tasks",
        tasks: [{ title: "Interview users", due_at: null }],
      }).kind,
    ).toBe("tasks");
    expect(
      noteActionProposalSchema.parse({
        kind: "plan",
        title: "Launch",
        description: null,
        current_plan: "Validate, then build",
        tasks: [],
      }).kind,
    ).toBe("plan");
    expect(
      confirmNoteActionSchema.safeParse({
        proposal: {
          kind: "tasks",
          tasks: [{ title: "Edited task", due_at: null }],
        },
      }).success,
    ).toBe(true);
  });
});
