import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api";
import { App } from "../App";
import { AuthProvider, SESSION_KEY } from "../auth";

const api = new ApiClient(() => "test-token");
const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider apiFactory={() => api}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

describe("import and completeness", () => {
  beforeEach(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: "test-token" }));
    localStorage.removeItem("ealzy.language");
    vi.restoreAllMocks();
    vi.spyOn(api, "mailAccounts").mockResolvedValue([]);
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "UTC",
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "tasks").mockResolvedValue([]);
    vi.spyOn(api, "promises").mockResolvedValue([]);
    vi.spyOn(api, "goals").mockResolvedValue([]);
    vi.spyOn(api, "selfMemories").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([]);
    vi.spyOn(api, "reflections").mockResolvedValue([]);
    vi.spyOn(api, "experiences").mockResolvedValue([]);
    vi.spyOn(api, "profileCompleteness").mockResolvedValue({
      percent: 40,
      items: [
        { id: "telegram", weight: 25, done: false, href: "/profile#loop" },
        { id: "portrait", weight: 25, done: false, href: "/companion" },
        { id: "timezone", weight: 20, done: true, href: "/profile#loop" },
        { id: "goals", weight: 20, done: true, href: "/goals" },
        { id: "digests", weight: 10, done: false, href: "/profile#loop" },
      ],
    });
  });

  it("shows a next-step completeness link on profile, not a second progress bar", async () => {
    const { unmount } = renderAt("/");
    expect(await screen.findByRole("tab", { name: "Сегодня" })).toBeInTheDocument();
    expect(screen.queryByText("40%")).not.toBeInTheDocument();
    expect(screen.queryByText("Контекст Илзи")).not.toBeInTheDocument();
    unmount();

    renderAt("/profile");
    expect(await screen.findByRole("link", { name: "Привязать Telegram" })).toHaveAttribute(
      "href",
      "/profile#loop",
    );
    expect(screen.getByText(/Чтобы советы стали ближе/)).toBeInTheDocument();
    expect(screen.queryByText("40%")).not.toBeInTheDocument();
    expect(screen.queryByText("Контекст Илзи")).not.toBeInTheDocument();
  });

  it("previews pasted tasks and confirms the import", async () => {
    vi.spyOn(api, "importTodoistStatus").mockResolvedValue({ oauth: false });
    const preview = vi.spyOn(api, "previewTextImport").mockResolvedValue({
      id: "imp-1",
      source: "text",
      status: "preview",
      items: [
        {
          id: "i1",
          kind: "task",
          title: "Купить молоко",
          due_at: null,
          importance: null,
          project_title: null,
          source_id: null,
          duplicate: false,
        },
      ],
      log: {},
      created_at: "2026-09-04T12:00:00.000Z",
      confirmed_at: null,
    });
    const confirm = vi.spyOn(api, "confirmImport").mockResolvedValue({
      id: "imp-1",
      source: "text",
      status: "confirmed",
      items: [],
      log: { created_tasks: 1, created_projects: 0, skipped_duplicates: 0 },
      created_at: "2026-09-04T12:00:00.000Z",
      confirmed_at: "2026-09-04T12:01:00.000Z",
    });
    renderAt("/import");

    await userEvent.type(await screen.findByRole("textbox"), "Купить молоко");
    await userEvent.click(screen.getByRole("button", { name: "Показать превью" }));
    expect(preview).toHaveBeenCalledWith("Купить молоко");
    expect(await screen.findByText("Купить молоко")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Перенести" }));
    expect(confirm).toHaveBeenCalledWith("imp-1", []);
    expect(await screen.findByText("Готово")).toBeInTheDocument();
  });
});
