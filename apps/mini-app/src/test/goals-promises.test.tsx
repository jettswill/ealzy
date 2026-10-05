import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api";
import { App } from "../App";
import { AuthProvider, SESSION_KEY } from "../auth";

const api = new ApiClient(() => "test-token");
const factory = () => api;
const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider apiFactory={factory}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

describe("goals and promises", () => {
  beforeEach(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: "test-token" }));
    localStorage.removeItem("ealzy.language");
    vi.restoreAllMocks();
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "UTC",
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockResolvedValue([]);
    vi.spyOn(api, "dueExperienceFollowUps").mockResolvedValue([]);
  });

  it("groups short- and long-term goals and shows progress", async () => {
    vi.spyOn(api, "goals").mockResolvedValue([
      {
        id: "g1",
        title: "Finish the deck",
        status: "active",
        horizon: "short",
        stats: { task_count: 4, done_count: 2, open_count: 2, progress: 50, days_active: 8 },
      },
      {
        id: "g2",
        title: "Learn French",
        status: "active",
        horizon: "long",
        stats: { task_count: 1, done_count: 0, open_count: 1, progress: 0, days_active: 40 },
      },
    ]);
    renderAt("/goals");

    expect(await screen.findByRole("heading", { name: "Цели" })).toBeInTheDocument();
    expect(await screen.findByText("Краткосрочные")).toBeInTheDocument();
    expect(screen.getByText("Долгосрочные")).toBeInTheDocument();
    expect(screen.getByText(/2 из 4 дел/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Finish the deck/ })).toHaveAttribute(
      "href",
      "/goals/g1",
    );
  });

  it("opens a goal, links a task, and can ask Ealzy how it is going", async () => {
    vi.spyOn(api, "goal").mockResolvedValue({
      id: "g1",
      title: "Finish the deck",
      status: "active",
      horizon: "short",
      description: "Ship the slides",
      stats: { task_count: 1, done_count: 0, open_count: 1, progress: 0, days_active: 8 },
      tasks: [{ id: "t1", title: "Outline", status: "todo" }],
    });
    const send = vi.spyOn(api, "sendCompanionMessage").mockResolvedValue({
      assistant_message: { id: "m1", role: "assistant", content: "Начни с оглавления." },
    });
    renderAt("/goals/g1");

    expect(await screen.findByRole("heading", { name: "Finish the deck" })).toBeInTheDocument();
    expect(screen.getByText("Outline")).toBeInTheDocument();
    expect(screen.getByText("План действий")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Разложить на план" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Обсудить с Ealzy" }).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Как дела?" }));
    await screen.findByText("Начни с оглавления.");
    expect(send).toHaveBeenCalled();
    expect(String(send.mock.calls[0][0])).toContain("Finish the deck");
  });

  it("lets the user check in on a promise and talk it through if it slipped", async () => {
    const promise = {
      id: "p1",
      title: "Телефон после 21:00 не трогать",
      status: "active" as const,
      stats: {
        keeping_days: 12,
        keeping_count: 3,
        struggling_count: 0,
        broken_count: 0,
        last_checkin_at: null,
        last_checkin_status: null,
        due_for_checkin: true,
        praise_days: 7,
      },
    };
    vi.spyOn(api, "promises").mockResolvedValue([promise]);
    const checkIn = vi.spyOn(api, "checkInPromise").mockResolvedValue({
      checkin: {
        id: "c1",
        promise_id: "p1",
        status: "broken",
        created_at: "2026-08-27T12:00:00.000Z",
      },
      promise: {
        ...promise,
        stats: {
          ...promise.stats,
          last_checkin_status: "broken",
          keeping_days: 0,
          broken_count: 1,
        },
      },
    });
    const send = vi.spyOn(api, "sendCompanionMessage").mockResolvedValue({
      assistant_message: {
        id: "m2",
        role: "assistant",
        content: "Давайте без стыда разберём вечер.",
      },
    });
    renderAt("/promises");

    expect(await screen.findByRole("heading", { name: "Обещания себе" })).toBeInTheDocument();
    expect(
      await screen.findByText("Уже 7 дн. — это устойчивость, не случайность."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Сорвалось" }));
    expect(checkIn).toHaveBeenCalledWith("p1", { status: "broken" });
    await userEvent.click(screen.getByRole("button", { name: "Разобрать с психологом" }));
    expect(await screen.findByText("Давайте без стыда разберём вечер.")).toBeInTheDocument();
    expect(String(send.mock.calls[0][0])).toContain("Телефон после 21:00");
  });

  it("lets the user discuss a task with Ealzy and marks AI-owned work", async () => {
    vi.spyOn(api, "tasks").mockResolvedValue([
      {
        id: "t1",
        title: "Сравнить рейсы",
        status: "todo",
        assignee: "ealzy",
        description: "Москва — Сочи",
      },
    ]);
    const send = vi.spyOn(api, "sendCompanionMessage").mockResolvedValue({
      assistant_message: { id: "m3", role: "assistant", content: "Сначала сверю прямые рейсы." },
    });
    renderAt("/tasks");

    expect(await screen.findByRole("heading", { name: "Сравнить рейсы" })).toBeInTheDocument();
    expect(screen.getByText("ИИ")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Ealzy$/ }));
    expect(screen.getByRole("heading", { name: "Сравнить рейсы" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Обсудить с Ealzy" }));
    expect(await screen.findByText("Сначала сверю прямые рейсы.")).toBeInTheDocument();
    expect(String(send.mock.calls[0][0])).toContain("Сравнить рейсы");
    expect(String(send.mock.calls[0][0])).toContain("assignee ealzy");
  });

  it("lists goal action plans without a directory of other sections", async () => {
    vi.spyOn(api, "goals").mockResolvedValue([
      {
        id: "g1",
        title: "Finish the deck",
        status: "active",
        current_plan: "Сначала оглавление.",
      },
    ]);
    renderAt("/plan");

    expect(await screen.findByRole("heading", { name: "Планы" })).toBeInTheDocument();
    expect(await screen.findByText("Сначала оглавление.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Finish the deck/ })).toHaveAttribute(
      "href",
      "/goals/g1",
    );
    expect(screen.queryByRole("link", { name: "Пространства" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Рекомендации" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Проекты" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Встречи" })).not.toBeInTheDocument();
  });
});
