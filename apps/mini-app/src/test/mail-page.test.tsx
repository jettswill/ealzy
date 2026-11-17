import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api";
import { App } from "../App";
import { AuthProvider, SESSION_KEY } from "../auth";
import { writeMailCache } from "../mail-sync";

const api = new ApiClient(() => "test-token");
const factory = () => api;

describe("mail page cache", () => {
  beforeEach(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: "test-token" }));
    vi.restoreAllMocks();
    writeMailCache({
      accounts: [
        {
          id: "acc-1",
          email: "me@gmail.com",
          provider: "gmail",
          username: "me@gmail.com",
          imap_host: "imap.gmail.com",
          imap_port: 993,
          smtp_host: "smtp.gmail.com",
          smtp_port: 465,
          status: "active",
          last_error: null,
          last_synced_at: "2026-08-30T08:00:00.000Z",
        },
      ],
      messages: [
        {
          id: "m1",
          account_id: "acc-1",
          from_address: "boss@corp.com",
          from_name: "Босс",
          to_address: "me@gmail.com",
          subject: "Встреча завтра",
          snippet: "Zoom в 12:00",
          received_at: "2026-08-30T09:00:00.000Z",
          is_important: true,
          is_meeting: true,
          meeting_at: "2026-08-31T09:00:00.000Z",
          has_calendar_invite: true,
          handled: false,
        },
      ],
      drafts: [],
      playbooks: [],
      saved_at: Date.now(),
    });
  });

  it("shows the last mailbox even if the network never answers", async () => {
    vi.spyOn(api, "mailAccounts").mockRejectedValue(new Error("offline"));
    vi.spyOn(api, "mailMessages").mockRejectedValue(new Error("offline"));
    vi.spyOn(api, "mailDrafts").mockRejectedValue(new Error("offline"));
    vi.spyOn(api, "mailPlaybooks").mockRejectedValue(new Error("offline"));
    vi.spyOn(api, "syncMyMail").mockRejectedValue(new Error("offline"));

    render(
      <MemoryRouter initialEntries={["/mail"]}>
        <AuthProvider apiFactory={factory}>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("me@gmail.com")).toBeInTheDocument();
    expect(screen.getByText("Встреча завтра")).toBeInTheDocument();
    expect(screen.getByText(/Босс/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Сегодня" })).not.toHaveClass("nav-item-active");
    expect(screen.getByRole("link", { name: "Все дела" })).not.toHaveClass("nav-item-active");
  });
});
