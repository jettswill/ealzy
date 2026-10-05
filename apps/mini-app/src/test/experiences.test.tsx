import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api";
import { App } from "../App";
import { AuthProvider, SESSION_KEY } from "../auth";
import type { Experience } from "../types";

const api = new ApiClient(() => "test-token");
const factory = () => api;
const sample: Experience = {
  id: "e1",
  type: "restaurant",
  title: "Coffee with Masha",
  description: "A candid catch-up",
  occurred_at: "2026-07-08T10:00:00Z",
  place: "Corner café",
  emotions: ["connected", "hopeful"],
  positive_signals: ["Easy conversation"],
  negative_signals: ["Ran out of time"],
  participant_ids: ["p1"],
  participants: [{ id: "p1", name: "Masha" }],
  planned_task_id: "t1",
  planned_space_id: "s1",
  follow_up_at: "2026-07-10T10:00:00Z",
  status: "follow_up_due",
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider apiFactory={factory}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("experiences", () => {
  beforeEach(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: "test-token" }));
    vi.restoreAllMocks();
    localStorage.setItem("ealzy.language", "en");
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Berlin",
      locale: "en",
    });
    vi.spyOn(api, "dueExperienceFollowUps").mockResolvedValue([]);
  });

  it("renders experience signals, context, participants, and follow-up action", async () => {
    vi.spyOn(api, "experience").mockResolvedValue(sample);
    const followUp = vi
      .spyOn(api, "followUpExperience")
      .mockResolvedValue({ ...sample, status: "completed" });
    renderAt("/experiences/e1");

    expect(await screen.findByRole("heading", { name: "Coffee with Masha" })).toBeInTheDocument();
    expect(screen.getByText(/Easy conversation/)).toBeInTheDocument();
    expect(screen.getByText(/Ran out of time/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Masha/ })).toHaveAttribute("href", "/people/p1");
    expect(screen.getByRole("link", { name: /Linked space/ })).toHaveAttribute(
      "href",
      "/spaces/s1",
    );

    await userEvent.selectOptions(screen.getByLabelText("Experience status"), "completed");
    expect(followUp).toHaveBeenCalledWith("e1", "completed");
  });

  it("creates a detailed experience from the Plan section", async () => {
    vi.spyOn(api, "experiences").mockResolvedValue([]);
    vi.spyOn(api, "people").mockResolvedValue([
      { id: "p1", name: "Masha", relationship: "Friend", description: null },
    ]);
    vi.spyOn(api, "tasks").mockResolvedValue([{ id: "t1", title: "Follow up", status: "todo" }]);
    vi.spyOn(api, "spaces").mockResolvedValue([{ id: "s1", name: "Friends", context: null }]);
    const create = vi.spyOn(api, "createExperience").mockResolvedValue(sample);
    renderAt("/experiences");

    await userEvent.click(await screen.findByRole("button", { name: "Add experience" }));
    await userEvent.type(await screen.findByLabelText("Title"), "Coffee with Masha");
    await userEvent.click(screen.getByLabelText("Masha"));
    await userEvent.click(screen.getByText("More fields"));
    await userEvent.type(screen.getByLabelText(/Emotions/), "connected, hopeful");
    await userEvent.type(screen.getByLabelText(/Positive signals/), "Easy conversation");
    await userEvent.type(screen.getByLabelText(/Negative signals/), "Ran out of time");
    await userEvent.selectOptions(screen.getByLabelText("Linked task"), "t1");
    await userEvent.selectOptions(screen.getByLabelText("Linked space"), "s1");
    await userEvent.click(screen.getByRole("button", { name: "Save experience" }));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Coffee with Masha",
        type: "other",
        emotions: ["connected", "hopeful"],
        participant_ids: ["p1"],
        planned_task_id: "t1",
        planned_space_id: "s1",
      }),
    );
    expect(create.mock.calls[0][0]).not.toHaveProperty("source_message_id");
  });

  it("shows experience provenance on recommendation detail", async () => {
    vi.spyOn(api, "recommendation").mockResolvedValue({
      id: "r1",
      query: "What should we do next?",
      items: [
        {
          title: "Meet somewhere quiet",
          rationale: "Your last catch-up felt rushed.",
          provenance: [{ type: "experience", id: "e1", label: "Coffee with Masha" }],
        },
      ],
    });
    renderAt("/recommendations/r1");

    expect(await screen.findByText("Why this fits")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Coffee with Masha/ })).toHaveAttribute(
      "href",
      "/experiences/e1",
    );
  });
});
