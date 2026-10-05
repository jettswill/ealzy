import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api";
import { App } from "../App";
import { AuthProvider, SESSION_KEY } from "../auth";

const api = new ApiClient(() => "test-token");
const factory = () => api;

describe("key screens", () => {
  beforeEach(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: "test-token" }));
    localStorage.removeItem("ealzy.language");
    vi.restoreAllMocks();
  });

  it("renders people and the four-section navigation", async () => {
    vi.spyOn(api, "people").mockResolvedValue([
      { id: "p1", name: "Masha", relationship: "Friend", description: "Loves the outdoors" },
    ]);
    vi.spyOn(api, "goals").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={["/people"]}>
        <AuthProvider apiFactory={factory}>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Masha" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Основная навигация" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Добавить дело/ })).toHaveClass("nav-add-join");
    expect(screen.getByRole("link", { name: "Дела" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Илзи" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Контекст" })).toHaveClass("nav-item-active");
    expect(screen.getByRole("link", { name: "Профиль" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ещё" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Цели" })).not.toBeInTheDocument();
  });

  it("lists desktop context sections on mobile and hides privacy until profile", async () => {
    vi.spyOn(api, "people").mockResolvedValue([]);
    vi.spyOn(api, "goals").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={["/more"]}>
        <AuthProvider apiFactory={factory}>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Контекст" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Заметки/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Цели/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Планы/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Обещания/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Люди/ })).toBeInTheDocument();
    expect(screen.queryByText("Приватность и данные")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Добавить дело/ })).toHaveClass("nav-add-join");
  });

  it("opens privacy controls from a nested profile page", async () => {
    render(
      <MemoryRouter initialEntries={["/profile/privacy"]}>
        <AuthProvider apiFactory={factory}>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Приватность и данные" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Профиль" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Экспорт данных" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Удалить аккаунт" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Профиль" })).toHaveClass("nav-item-active");
    expect(screen.getByRole("button", { name: /Добавить дело/ })).not.toHaveClass("nav-add-join");
  });

  it("shows contextual add buttons on desktop navigation", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("min-width: 860px"),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    vi.spyOn(api, "people").mockResolvedValue([]);
    vi.spyOn(api, "goals").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([]);
    vi.spyOn(api, "spaces").mockResolvedValue([]);
    try {
      render(
        <MemoryRouter initialEntries={["/people"]}>
          <AuthProvider apiFactory={factory}>
            <App />
          </AuthProvider>
        </MemoryRouter>,
      );

      expect(
        await screen.findByRole("navigation", { name: "Основная навигация" }),
      ).toBeInTheDocument();
      const nav = screen.getByRole("navigation", { name: "Основная навигация" });
      expect(screen.getByRole("link", { name: "Дела" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Все дела" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Цели" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Илзи" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Люди" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Планы" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Обещания" })).toBeInTheDocument();
      expect(within(nav).getByText("Контекст")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Рекомендации" })).not.toBeInTheDocument();
      const labels = within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent?.replace(/\s+/g, " ").trim());
      expect(labels.at(-1)).toBe("Профиль");
      expect(screen.queryByRole("link", { name: "Почта" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Ещё" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Добавить дело" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Добавить в «Дела»" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Добавить в «Все дела»" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Добавить в «Заметки»" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Добавить в «Цели»" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Добавить в «Обещания»" })).toBeInTheDocument();
      const addPerson = screen.getByRole("button", { name: "Добавить в «Люди»" });
      expect(addPerson.querySelector(".nav-add-plus")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Добавить в «Планы»" })).not.toBeInTheDocument();
      await userEvent.click(addPerson);
      expect(await screen.findByRole("dialog", { name: "Добавить человека" })).toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("opens a new task form from the centered nav button", async () => {
    vi.spyOn(api, "people").mockResolvedValue([]);
    vi.spyOn(api, "goals").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([]);
    vi.spyOn(api, "spaces").mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={["/people"]}>
        <AuthProvider apiFactory={factory}>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Добавить дело/ }));
    expect(await screen.findByRole("dialog", { name: "Новое дело" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Встреча" })).toBeInTheDocument();
    expect(screen.getByLabelText("Цель")).toBeInTheDocument();
    expect(screen.getByLabelText("Проект")).toBeInTheDocument();
  });

  it("renders recommendation rationale and an external link", async () => {
    vi.spyOn(api, "recommendation").mockResolvedValue({
      id: "r1",
      query: "How can I surprise Masha?",
      items: [
        {
          title: "Sunrise hike",
          rationale: "Masha enjoys hiking and quiet mornings.",
          url: "https://example.com/hike",
        },
      ],
    });
    render(
      <MemoryRouter initialEntries={["/recommendations/r1"]}>
        <AuthProvider apiFactory={factory}>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "Sunrise hike" })).toBeInTheDocument();
    expect(screen.getByText("Masha enjoys hiking and quiet mornings.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /открыть ссылку/i })).toHaveAttribute(
      "href",
      "https://example.com/hike",
    );
  });
});
