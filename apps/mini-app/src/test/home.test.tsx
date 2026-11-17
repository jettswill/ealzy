import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api";
import { App } from "../App";
import { AuthProvider, SESSION_KEY } from "../auth";
import {
  addCalendarDays,
  completionStreak,
  dateKeyInZone,
  HOME_ARCHIVE_LINGER_MS,
  HOME_SWIPE_DAYS,
  isEndOfWeek,
  laterDays,
  laterTasks,
  plannedLaterDays,
  middayIso,
  overdueTasks,
  pickTodayPrompt,
  planListReorder,
  shouldShowTomorrowPlan,
  shouldShowWeekSummary,
  sortTasks,
  streakMilestone,
  todayDiscussPrompt,
  todaysTasks,
  tomorrowDiscussPrompt,
  tomorrowsTasks,
  undatedTasks,
  weekStartKey,
  weekStats,
} from "../today-tasks";
import { LONG_PRESS_MS } from "../components/HomeTasks";
import { dueClock, formatEstimate, splitDue } from "../task-priority";
import { weatherEmoji } from "../weather";
import { resetTaskSync } from "../task-sync";

const api = new ApiClient(() => "test-token");
const originalMatchMedia = window.matchMedia;

function mockDesktop() {
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
}

function stubRect(
  node: Element,
  box: { left: number; top: number; width: number; height: number },
) {
  vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
    x: box.left,
    y: box.top,
    top: box.top,
    left: box.left,
    right: box.left + box.width,
    bottom: box.top + box.height,
    width: box.width,
    height: box.height,
    toJSON() {
      return "";
    },
  } as DOMRect);
}
const factory = () => api;
const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider apiFactory={factory}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

function stubHomeApis() {
  vi.spyOn(api, "me").mockResolvedValue({
    bio: null,
    values: [],
    communication_style: null,
    timezone: "UTC",
    primary_conversation_id: "c1",
    last_goal_checkin_on: new Date().toISOString().slice(0, 10),
  });
  vi.spyOn(api, "conversationMessages").mockResolvedValue([]);
  vi.spyOn(api, "dueExperienceFollowUps").mockResolvedValue([]);
  vi.spyOn(api, "promises").mockResolvedValue([]);
  vi.spyOn(api, "goals").mockResolvedValue([]);
  vi.spyOn(api, "projects").mockResolvedValue([]);
  vi.spyOn(api, "people").mockResolvedValue([]);
  vi.spyOn(api, "spaces").mockResolvedValue([]);
}

describe("authenticated home", () => {
  beforeEach(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: "test-token" }));
    localStorage.removeItem("ealzy.language");
    localStorage.setItem("ealzy.goal-sync-later", new Date().toISOString().slice(0, 10));
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_success: PositionCallback, error?: PositionErrorCallback) => {
          error?.({ code: 1, message: "denied", PERMISSION_DENIED: 1 } as GeolocationPositionError);
        },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("open-meteo.com")) {
          return new Response(
            JSON.stringify({ current: { temperature_2m: 18.4, weather_code: 2 } }),
          );
        }
        if (url.includes("reverse-geocode")) {
          return new Response(JSON.stringify({ city: "Москва" }));
        }
        return new Response("{}", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = originalMatchMedia;
    resetTaskSync();
  });

  it("lists today, tomorrow, later days, and undated work without a home composer", async () => {
    // Днём, а не вечером: после 20:00 главный экран сам листает на завтра.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-24T09:00:00.000Z"));
    stubHomeApis();
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Moscow",
      primary_conversation_id: "c1",
    });
    const zone = "Europe/Moscow";
    const today = dateKeyInZone(new Date(), zone);
    vi.spyOn(api, "tasks").mockResolvedValue([
      {
        id: "t1",
        title: "Позвонить в банк",
        status: "todo",
        description: "Уточнить лимит",
        due_at: middayIso(today),
      },
      { id: "t2", title: "Inbox without a date", status: "todo" },
      {
        id: "t3",
        title: "Flight",
        status: "todo",
        due_at: middayIso(addCalendarDays(today, 5)),
      },
    ]);
    vi.spyOn(api, "updateTask").mockResolvedValue({
      id: "t2",
      title: "Inbox without a date",
      status: "todo",
      due_at: middayIso(addCalendarDays(today, 1)),
    });
    renderAt("/");

    expect(await screen.findByRole("tab", { name: "Сегодня" })).toBeInTheDocument();
    const dayTabs = within(screen.getByRole("tablist", { name: "Запланировано" })).getAllByRole(
      "tab",
    );
    expect(dayTabs.length).toBeGreaterThanOrEqual(HOME_SWIPE_DAYS);
    expect(dayTabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Запланировано" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByRole("button", { name: "Позвонить в банк" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Отметить «Позвонить в банк» как готово/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Завтра" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flight" })).toBeInTheDocument();
    expect(screen.queryByText("Просрочено")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Без даты" }));
    expect(await screen.findByRole("button", { name: "Inbox without a date" })).toBeInTheDocument();
    expect(
      screen.getByText("Зажмите дело и перенесите на сегодня или завтра."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Запланировано" }));
    expect(screen.getByRole("button", { name: "Добавить на сегодня" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Открыть чат с Илзи" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Позвонить в банк" }));
    const card = await screen.findByRole("dialog", { name: "Изменить дело" });
    expect(within(card).getByDisplayValue("Уточнить лимит")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Обсудить с Илзи" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Сохранить" })).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Закрыть" }));

    await userEvent.click(screen.getByRole("button", { name: "Запланировать" }));
    const schedule = await screen.findByRole("dialog");
    expect(
      within(schedule).getByText(
        "Выберите дело без даты — оно попадёт на завтра. Или напишите Илзи.",
      ),
    ).toBeInTheDocument();
    expect(within(schedule).getByLabelText("Спросить Илзи про завтра…")).toBeInTheDocument();
    await userEvent.click(within(schedule).getByRole("button", { name: /Inbox without a date/ }));
    await waitFor(() => expect(api.updateTask).toHaveBeenCalled());
    expect(api.updateTask).toHaveBeenCalledWith("t2", {
      due_at: middayIso(addCalendarDays(today, 1)),
    });
  });

  it("swipes the planned pager to the next day without dragging a task", async () => {
    // Днём, а не вечером: после 20:00 главный экран сам листает на завтра.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-24T09:00:00.000Z"));
    stubHomeApis();
    const today = dateKeyInZone(new Date(), "UTC");
    vi.spyOn(api, "tasks").mockResolvedValue([
      { id: "t1", title: "Call bank", status: "todo", due_at: middayIso(today) },
    ]);
    const update = vi.spyOn(api, "updateTask");
    renderAt("/");

    const task = await screen.findByRole("button", { name: "Call bank" });
    const days = screen.getByRole("tablist", { name: "Запланировано" });
    const tomorrow = within(days).getByRole("tab", { name: "Завтра" });
    expect(tomorrow).toHaveAttribute("aria-selected", "false");

    const pager = document.querySelector(".home-pager");
    expect(pager).toBeTruthy();
    vi.spyOn(pager as HTMLDivElement, "clientWidth", "get").mockReturnValue(320);

    fireEvent.pointerDown(task, {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 280,
      clientY: 180,
    });
    fireEvent.pointerMove(task, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 40,
      clientY: 176,
    });
    fireEvent.pointerUp(task, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 40,
      clientY: 176,
    });
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Сделать сегодня/ })).not.toBeInTheDocument();
    expect(tomorrow).toHaveAttribute("aria-selected", "true");
  });

  it("drops a held unplanned task onto today", async () => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    stubHomeApis();
    const zone = "UTC";
    const today = dateKeyInZone(new Date(), zone);
    vi.spyOn(api, "tasks").mockResolvedValue([
      { id: "t2", title: "Inbox without a date", status: "todo" },
    ]);
    vi.spyOn(api, "updateTask").mockResolvedValue({
      id: "t2",
      title: "Inbox without a date",
      status: "todo",
      due_at: middayIso(today),
    });
    renderAt("/");

    await userEvent.click(await screen.findByRole("tab", { name: "Без даты" }));
    const task = await screen.findByRole("button", { name: "Inbox without a date" });
    fireEvent.pointerDown(task, { pointerId: 1, button: 0, clientX: 40, clientY: 180 });
    const todayZone = await screen.findByRole("button", { name: /Сделать сегодня/ });
    stubRect(todayZone, { left: 0, top: 0, width: 160, height: 90 });
    fireEvent.pointerMove(task, { pointerId: 1, clientX: 40, clientY: 20 });
    fireEvent.pointerUp(task, { pointerId: 1, clientX: 40, clientY: 20 });
    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(
        "t2",
        expect.objectContaining({ due_at: middayIso(today) }),
      ),
    );
  });

  it("shows planned and unplanned together on desktop and drags between them", async () => {
    stubHomeApis();
    mockDesktop();
    const today = dateKeyInZone(new Date(), "UTC");
    vi.spyOn(api, "tasks").mockResolvedValue([
      { id: "t1", title: "Call bank", status: "todo", due_at: middayIso(today) },
      { id: "t2", title: "Inbox without a date", status: "todo" },
    ]);
    vi.spyOn(api, "updateTask").mockImplementation(async (id, input) => ({
      id,
      title: id === "t1" ? "Call bank" : "Inbox without a date",
      status: "todo" as const,
      ...input,
    }));
    renderAt("/");

    const planned = await screen.findByRole("button", { name: "Call bank" });
    expect(planned).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inbox without a date" })).not.toBeInTheDocument();
    const unplannedToggle = screen.getByRole("button", { name: "Без даты" });
    expect(unplannedToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "Все" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Время и погода" })).not.toBeInTheDocument();

    await userEvent.click(unplannedToggle);
    const unplanned = await screen.findByRole("button", { name: "Inbox without a date" });
    expect(unplanned).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Без даты" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const unplannedList = screen.getByRole("region", { name: "Дела без даты" });
    expect(within(unplannedList).queryByText("Без даты")).not.toBeInTheDocument();
    stubRect(unplannedList, { left: 400, top: 80, width: 200, height: 240 });
    const dropBody = unplannedList.querySelector("[data-drop-body]") ?? unplannedList;
    stubRect(dropBody, { left: 400, top: 80, width: 200, height: 240 });

    fireEvent.pointerDown(planned, { pointerId: 1, button: 0, clientX: 40, clientY: 120 });
    fireEvent.pointerMove(planned, { pointerId: 1, clientX: 40, clientY: 90 });
    fireEvent.pointerMove(planned, { pointerId: 1, clientX: 480, clientY: 140 });
    fireEvent.pointerUp(planned, { pointerId: 1, clientX: 480, clientY: 140 });
    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith("t1", expect.objectContaining({ due_at: null })),
    );
  });

  it("adds a task for today from the empty card", async () => {
    stubHomeApis();
    mockDesktop();
    const today = dateKeyInZone(new Date(), "UTC");
    vi.spyOn(api, "tasks").mockResolvedValue([
      { id: "t2", title: "Inbox without a date", status: "todo" },
    ]);
    vi.spyOn(api, "createTask").mockResolvedValue({
      id: "t3",
      title: "Купить хлеб",
      status: "todo",
      due_at: middayIso(today),
    });
    renderAt("/");

    expect(await screen.findByText("На сегодня дел нет")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Добавьте дело, попросите Илзи подобрать по трудозатратам или перетащите из «Без даты».",
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Добавить на сегодня" }));
    const form = await screen.findByRole("dialog", { name: "Дело на сегодня" });
    await userEvent.type(within(form).getByLabelText("Название"), "Купить хлеб");
    await userEvent.click(within(form).getByRole("button", { name: "Создать дело" }));
    expect(await screen.findByRole("button", { name: /^Купить хлеб/ })).toBeInTheDocument();
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Купить хлеб", due_at: expect.any(String) }),
    );
  });

  it("dumps a head list onto today from the first-run card", async () => {
    stubHomeApis();
    mockDesktop();
    const today = dateKeyInZone(new Date(), "UTC");
    vi.spyOn(api, "tasks").mockResolvedValue([]);
    vi.spyOn(api, "goals").mockResolvedValue([
      { id: "g1", title: "Запустить лендинг", status: "active" },
    ]);
    const dump = vi.spyOn(api, "brainDump").mockResolvedValue({
      tasks: [
        {
          id: "t-dump",
          title: "Позвонить маме",
          status: "todo",
          due_at: middayIso(today),
          goal_id: "g1",
        },
      ],
      promise: null,
      skipped: false,
    });
    renderAt("/");

    expect(await screen.findByText("Сначала выгрузим голову")).toBeInTheDocument();
    expect(await screen.findByText("Цель: Запустить лендинг")).toBeInTheDocument();
    await userEvent.type(
      screen.getByPlaceholderText(/Три–семь дел/),
      "позвонить маме, оплатить счета",
    );
    await userEvent.click(screen.getByRole("button", { name: "Поставить на сегодня" }));
    expect(dump).toHaveBeenCalledWith("позвонить маме, оплатить счета");
    expect(await screen.findByRole("button", { name: /^Позвонить маме/ })).toBeInTheDocument();
  });

  it("asks Ilzi to pick today's work by effort from the empty card", async () => {
    stubHomeApis();
    mockDesktop();
    vi.spyOn(api, "tasks").mockResolvedValue([
      { id: "t2", title: "Inbox without a date", status: "todo" },
    ]);
    const send = vi.spyOn(api, "sendCompanionMessage").mockResolvedValue({
      assistant_message: {
        id: "m1",
        role: "assistant",
        content: "На сегодня хватит одного дела.",
      },
    });
    renderAt("/");

    expect(await screen.findByText("На сегодня дел нет")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Подобрать с Илзи" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(String(send.mock.calls[0][0])).toContain("Inbox without a date");
    expect(String(send.mock.calls[0][0])).toContain("трудозатрат");
    expect(await screen.findByText("На сегодня хватит одного дела.")).toBeInTheDocument();
  });

  it("drops an undated task onto the empty today card on desktop", async () => {
    stubHomeApis();
    mockDesktop();
    const today = dateKeyInZone(new Date(), "UTC");
    vi.spyOn(api, "tasks").mockResolvedValue([
      { id: "t2", title: "Inbox without a date", status: "todo" },
    ]);
    vi.spyOn(api, "updateTask").mockResolvedValue({
      id: "t2",
      title: "Inbox without a date",
      status: "todo",
      due_at: middayIso(today),
    });
    renderAt("/");

    await userEvent.click(await screen.findByRole("button", { name: "Без даты" }));
    const task = await screen.findByRole("button", { name: "Inbox without a date" });
    const todayList = screen.getByRole("region", { name: "Сегодня" });
    const dropBody = todayList.querySelector("[data-drop-body]") ?? todayList;
    stubRect(todayList, { left: 0, top: 80, width: 300, height: 240 });
    stubRect(dropBody, { left: 0, top: 80, width: 300, height: 240 });

    fireEvent.pointerDown(task, { pointerId: 1, button: 0, clientX: 420, clientY: 140 });
    fireEvent.pointerMove(task, { pointerId: 1, clientX: 420, clientY: 110 });
    fireEvent.pointerMove(task, { pointerId: 1, clientX: 80, clientY: 140 });
    fireEvent.pointerUp(task, { pointerId: 1, clientX: 80, clientY: 140 });
    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith(
        "t2",
        expect.objectContaining({ due_at: middayIso(today) }),
      ),
    );
  });

  it("shows due time, effort and value on the title line", async () => {
    stubHomeApis();
    vi.spyOn(api, "tasks").mockResolvedValue([
      {
        id: "t1",
        title: "Call bank",
        status: "todo",
        due_at: "2026-08-30T07:15:00.000Z",
        estimate_minutes: 20,
        value_score: 2,
      },
    ]);
    renderAt("/");

    expect(await screen.findByRole("button", { name: "Call bank" })).toBeInTheDocument();
    expect(screen.getByText("07:15")).toBeInTheDocument();
    expect(screen.getByText("20м")).toBeInTheDocument();
  });

  it("shows overdue as its own marked page and quick-add on every regular date", async () => {
    stubHomeApis();
    const today = dateKeyInZone(new Date(), "UTC");
    vi.spyOn(api, "tasks").mockResolvedValue([
      {
        id: "old",
        title: "Old task",
        status: "todo",
        due_at: middayIso(addCalendarDays(today, -1)),
      },
      { id: "today", title: "Today task", status: "todo", due_at: middayIso(today) },
    ]);
    renderAt("/");

    const overdueTab = await screen.findByRole("tab", { name: "Просрочено" });
    expect(overdueTab.querySelector(".home-day-tab-dot")).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Сегодня" }).querySelector(".home-day-tab-dot"),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Просрочено" })).getByText("Old task"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Сегодня" })).queryByText("Old task"),
    ).not.toBeInTheDocument();
    expect(document.querySelectorAll(".home-add-date").length).toBeGreaterThanOrEqual(
      HOME_SWIPE_DAYS,
    );
  });

  it("reorders today's tasks after a long press on mobile", async () => {
    stubHomeApis();
    const today = dateKeyInZone(new Date(), "UTC");
    const due = middayIso(today);
    vi.spyOn(api, "tasks").mockResolvedValue([
      { id: "a", title: "First", status: "todo", due_at: due },
      { id: "b", title: "Second", status: "todo", due_at: due },
    ]);
    vi.spyOn(api, "updateTask").mockImplementation(async (id, input) => ({
      id,
      title: id === "a" ? "First" : "Second",
      status: "todo" as const,
      due_at: due,
      ...input,
    }));
    renderAt("/");

    const first = await screen.findByRole("button", { name: "First" });
    const second = await screen.findByRole("button", { name: "Second" });
    const list = screen.getByRole("region", { name: "Сегодня" });
    const body = list.querySelector("[data-drop-body]") ?? list;
    stubRect(list, { left: 0, top: 0, width: 300, height: 400 });
    stubRect(body, { left: 0, top: 80, width: 300, height: 200 });
    stubRect(first.closest("[data-task-id]") ?? first, {
      left: 0,
      top: 80,
      width: 300,
      height: 48,
    });
    stubRect(second.closest("[data-task-id]") ?? second, {
      left: 0,
      top: 128,
      width: 300,
      height: 48,
    });

    fireEvent.pointerDown(first, { pointerId: 1, button: 0, clientX: 20, clientY: 90 });
    await new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 50));
    fireEvent.pointerMove(first, { pointerId: 1, clientX: 20, clientY: 150 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 20, clientY: 150 });
    await waitFor(() => expect(api.updateTask).toHaveBeenCalled());
    expect(api.updateTask).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ sort_order: expect.any(Number) }),
    );
  });

  it("reorders unplanned tasks by dragging on desktop", async () => {
    stubHomeApis();
    mockDesktop();
    vi.spyOn(api, "tasks").mockResolvedValue([
      { id: "a", title: "First inbox", status: "todo" },
      { id: "b", title: "Second inbox", status: "todo" },
    ]);
    vi.spyOn(api, "updateTask").mockImplementation(async (id, input) => ({
      id,
      title: id === "a" ? "First inbox" : "Second inbox",
      status: "todo" as const,
      ...input,
    }));
    renderAt("/");

    await userEvent.click(await screen.findByRole("button", { name: "Без даты" }));
    const first = await screen.findByRole("button", { name: "First inbox" });
    const second = await screen.findByRole("button", { name: "Second inbox" });
    const list = screen.getByRole("region", { name: "Дела без даты" });
    const body = list.querySelector("[data-drop-body]") ?? list;
    stubRect(body, { left: 0, top: 0, width: 300, height: 200 });
    stubRect(first.closest("[data-task-id]") ?? first, { left: 0, top: 0, width: 300, height: 48 });
    stubRect(second.closest("[data-task-id]") ?? second, {
      left: 0,
      top: 48,
      width: 300,
      height: 48,
    });

    fireEvent.pointerDown(first, { pointerId: 1, button: 0, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(first, { pointerId: 1, clientX: 20, clientY: 80 });
    fireEvent.pointerUp(first, { pointerId: 1, clientX: 20, clientY: 80 });
    await waitFor(() => expect(api.updateTask).toHaveBeenCalled());
    expect(api.updateTask).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({ sort_order: expect.any(Number) }),
    );
  });

  it("checks a task into the archive, keeps it struck through, then hides it after 5 seconds", async () => {
    stubHomeApis();
    const zone = "UTC";
    const today = dateKeyInZone(new Date(), zone);
    const task = {
      id: "t1",
      title: "Позвонить в банк",
      status: "todo" as const,
      due_at: middayIso(today),
    };
    vi.spyOn(api, "tasks").mockResolvedValue([task]);
    const setStatus = vi.spyOn(api, "setTaskStatus").mockResolvedValue({ ...task, status: "done" });
    renderAt("/");

    const checkbox = await screen.findByRole("button", {
      name: "Отметить «Позвонить в банк» как готово",
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.click(checkbox);
    expect(screen.getByText("Позвонить в банк")).toHaveClass("line-through");
    expect(
      screen.getByRole("button", { name: "Вернуть «Позвонить в банк» в дела" }),
    ).toHaveTextContent("✓");
    await Promise.resolve();
    expect(setStatus).toHaveBeenCalledWith("t1", "done");

    await vi.advanceTimersByTimeAsync(HOME_ARCHIVE_LINGER_MS);
    expect(screen.queryByText("Позвонить в банк")).not.toBeInTheDocument();
    expect(screen.getByText(/На сегодня дел нет|Неделя закрыта/)).toBeInTheDocument();
  });

  it("leaves a checked task in its original place on today", async () => {
    stubHomeApis();
    const today = dateKeyInZone(new Date(), "UTC");
    const due = middayIso(today);
    vi.spyOn(api, "tasks").mockResolvedValue([
      { id: "a", title: "First", status: "todo", due_at: due },
      { id: "b", title: "Second", status: "todo", due_at: due },
      { id: "c", title: "Third", status: "todo", due_at: due },
    ]);
    vi.spyOn(api, "setTaskStatus").mockResolvedValue({
      id: "b",
      title: "Second",
      status: "done",
      due_at: due,
    });
    renderAt("/");

    expect(await screen.findByRole("button", { name: "First" })).toBeInTheDocument();
    const todayList = screen.getByRole("region", { name: "Сегодня" });
    const titles = () =>
      within(todayList)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
        .filter((name): name is string =>
          Boolean(
            name &&
            !name.startsWith("Отметить") &&
            !name.startsWith("Вернуть") &&
            !name.startsWith("Добавить"),
          ),
        );

    expect(titles()).toEqual(["First", "Second", "Third"]);
    fireEvent.click(
      within(todayList).getByRole("button", { name: "Отметить «Second» как готово" }),
    );
    expect(screen.getByText("Second")).toHaveClass("line-through");
    expect(titles()).toEqual(["First", "Second", "Third"]);
  });

  it("keeps a just-checked task in the open group on the all-tasks page", async () => {
    stubHomeApis();
    vi.spyOn(api, "tasks").mockResolvedValue([
      { id: "t1", title: "Alpha", status: "todo" },
      { id: "t2", title: "Beta", status: "todo" },
      { id: "t3", title: "Old", status: "done" },
    ]);
    vi.spyOn(api, "setTaskStatus").mockResolvedValue({ id: "t2", title: "Beta", status: "done" });
    renderAt("/tasks");

    const open = await screen.findByRole("region", { name: "Открытые" });
    expect(within(open).getByRole("heading", { name: "Beta" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отметить «Beta» как готово" }));
    expect(screen.getByRole("heading", { name: "Beta" })).toHaveClass("line-through");
    expect(
      within(screen.getByRole("region", { name: "Открытые" })).getByRole("heading", {
        name: "Beta",
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Архив" })).queryByRole("heading", {
        name: "Beta",
      }),
    ).not.toBeInTheDocument();
  });

  it("drops a just-archived task from today as soon as you leave the tab", async () => {
    stubHomeApis();
    vi.spyOn(api, "people").mockResolvedValue([]);
    vi.spyOn(api, "goals").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([]);
    const zone = "UTC";
    const today = dateKeyInZone(new Date(), zone);
    const store: {
      id: string;
      title: string;
      status: "todo" | "in_progress" | "done" | "cancelled";
      due_at: string;
    }[] = [
      {
        id: "t1",
        title: "Позвонить в банк",
        status: "todo",
        due_at: middayIso(today),
      },
    ];
    vi.spyOn(api, "tasks").mockImplementation(async () => store.map((item) => ({ ...item })));
    vi.spyOn(api, "setTaskStatus").mockImplementation(async (id, status) => {
      const current = store.find((item) => item.id === id)!;
      current.status = status;
      return { ...current };
    });
    renderAt("/");

    await userEvent.click(
      await screen.findByRole("button", { name: "Отметить «Позвонить в банк» как готово" }),
    );
    expect(await screen.findByText("Позвонить в банк")).toHaveClass("line-through");

    const nav = screen.getByRole("navigation", { name: "Основная навигация" });
    await userEvent.click(within(nav).getByRole("link", { name: "Все дела" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Все дела" })).toBeInTheDocument();

    await userEvent.click(within(nav).getByRole("link", { name: "Сегодня" }));
    expect(await screen.findByRole("tab", { name: "Сегодня" })).toBeInTheDocument();
    expect(screen.queryByText("Позвонить в банк")).not.toBeInTheDocument();
  });

  it("opens the full list of open and archived tasks from today", async () => {
    stubHomeApis();
    const zone = "UTC";
    const today = dateKeyInZone(new Date(), zone);
    vi.spyOn(api, "tasks").mockResolvedValue([
      {
        id: "t1",
        title: "Позвонить в банк",
        status: "todo",
        due_at: middayIso(today),
      },
      { id: "t2", title: "Старое дело", status: "done" },
    ]);
    renderAt("/");

    await userEvent.click(await screen.findByRole("link", { name: "Все" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Все дела" })).toBeInTheDocument();
    expect(screen.getByText("Все дела — открытые и выполненные.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Дела" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Все" })).toHaveClass("chip-active");
    expect(screen.getByRole("heading", { name: "Открытые" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Позвонить в банк" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Архив" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Старое дело" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "← Дела" }));
    expect(await screen.findByRole("tab", { name: "Сегодня" })).toBeInTheDocument();
  });

  it("shows tomorrow's plan after 20:00 when today is clear, and can discuss it with Ealzy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-24T20:05:00.000Z"));
    stubHomeApis();
    vi.spyOn(api, "tasks").mockResolvedValue([
      { id: "today", title: "Finish report", status: "done", due_at: "2026-08-24T12:00:00.000Z" },
      { id: "tomorrow", title: "Pack bag", status: "todo", due_at: "2026-08-25T12:00:00.000Z" },
    ]);
    const send = vi.spyOn(api, "sendCompanionMessage").mockResolvedValue({
      assistant_message: {
        id: "m3",
        role: "assistant",
        content: "Давай сначала сборы, потом дорога.",
      },
    });
    renderAt("/");

    expect(await screen.findByRole("tab", { name: "Завтра" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Сегодня" })).toBeInTheDocument();
    expect(screen.queryByText("Сегодня закрыто")).not.toBeInTheDocument();
    expect(screen.queryByText("Вечер")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Pack bag" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Finish report/ })).not.toBeInTheDocument();
    const tomorrowPlan = screen.getByRole("region", { name: "План на завтра" });
    expect(within(tomorrowPlan).getByRole("button", { name: "Запланировать" })).toBeInTheDocument();

    await userEvent.click(within(tomorrowPlan).getByRole("button", { name: "Обсудить с Илзи" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toContain("Pack bag");
    expect(send.mock.calls[0][0]).toContain("приоритизировать");
    expect(await screen.findByText("Давай сначала сборы, потом дорога.")).toBeInTheDocument();
  });
});

describe("today tasks and weather helpers", () => {
  const tasks = [
    { id: "1", title: "Today", status: "todo" as const, due_at: "2026-08-24T12:00:00.000Z" },
    { id: "2", title: "Overdue", status: "todo" as const, due_at: "2026-08-20T12:00:00.000Z" },
    { id: "3", title: "Later", status: "todo" as const, due_at: "2026-08-30T12:00:00.000Z" },
    { id: "4", title: "Inbox", status: "todo" as const },
    { id: "5", title: "Done", status: "done" as const, due_at: "2026-08-24T12:00:00.000Z" },
    { id: "6", title: "Tomorrow", status: "todo" as const, due_at: "2026-08-25T09:00:00.000Z" },
  ];

  it("keeps only open work dated today on the home list", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    expect(todaysTasks(tasks, "UTC", now).map((task) => task.title)).toEqual(["Today"]);
    expect(todaysTasks(tasks, "UTC", now, new Set(["5"])).map((task) => task.title)).toEqual([
      "Today",
      "Done",
    ]);
    expect(tomorrowsTasks(tasks, "UTC", now).map((task) => task.title)).toEqual(["Tomorrow"]);
    expect(overdueTasks(tasks, "UTC", now).map((task) => task.title)).toEqual(["Overdue"]);
    expect(laterTasks(tasks, "UTC", now).map((task) => task.title)).toEqual(["Later"]);
    expect(laterDays(tasks, "UTC", now)).toEqual([{ dateKey: "2026-08-30", tasks: [tasks[2]] }]);
    expect(plannedLaterDays(tasks, "UTC", now).map((group) => group.dateKey)).toEqual([
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
    ]);
    expect(
      plannedLaterDays(tasks, "UTC", now)
        .at(-1)
        ?.tasks.map((task) => task.title),
    ).toEqual(["Later"]);
    expect(undatedTasks(tasks, "UTC").map((task) => task.title)).toEqual(["Inbox"]);
    expect(weatherEmoji(0)).toBe("☀️");
    expect(weatherEmoji(61)).toBe("🌧️");
    expect(dueClock("2026-08-24T07:15:00.000Z", "UTC")).toBe("07:15");
    expect(dueClock("2026-08-24T12:00:00.000Z", "UTC")).toBe("");
    expect(splitDue("2026-09-09T09:00:00.000Z", "Europe/Moscow")).toEqual({
      date: "2026-09-09",
      time: "",
    });
    expect(splitDue("2026-09-09T06:00:00.000Z", "Europe/Moscow")).toEqual({
      date: "2026-09-09",
      time: "09:00",
    });
    expect(formatEstimate(20, "ru")).toBe("20м");
    expect(formatEstimate(90, "ru")).toBe("1ч 30м");
    expect(formatEstimate(60, "en")).toBe("1h");
  });

  it("orders tasks by time, value, then sort_order and plans a gap when reordering", () => {
    const ordered = sortTasks([
      { id: "b", title: "B", status: "todo", sort_order: 2000 },
      { id: "a", title: "A", status: "todo", sort_order: 1000 },
    ]);
    expect(ordered.map((task) => task.id)).toEqual(["a", "b"]);
    expect(planListReorder(ordered, ordered[1], 0)).toEqual([{ id: "b", sort_order: 500 }]);
    expect(
      sortTasks([
        {
          id: "later",
          title: "Later",
          status: "todo",
          due_at: "2026-08-24T12:00:00.000Z",
          value_score: 2,
        },
        {
          id: "low",
          title: "Low",
          status: "todo",
          due_at: "2026-08-24T09:00:00.000Z",
          value_score: -1,
        },
        {
          id: "high",
          title: "High",
          status: "todo",
          due_at: "2026-08-24T09:00:00.000Z",
          value_score: 1,
        },
      ]).map((task) => task.id),
    ).toEqual(["high", "low", "later"]);
  });

  it("opens tomorrow's plan after 20:00 only when today is clear", () => {
    const evening = new Date("2026-08-24T20:05:00.000Z");
    const afternoon = new Date("2026-08-24T16:00:00.000Z");
    expect(shouldShowTomorrowPlan(tasks, "UTC", evening)).toBe(false);
    expect(
      shouldShowTomorrowPlan(
        tasks.map((task) => (task.id === "1" ? { ...task, status: "done" as const } : task)),
        "UTC",
        evening,
      ),
    ).toBe(true);
    expect(
      shouldShowTomorrowPlan(
        tasks.map((task) => (task.id === "1" ? { ...task, status: "done" as const } : task)),
        "UTC",
        afternoon,
      ),
    ).toBe(false);
  });

  it("builds a discussion prompt without the self-serve prefix", () => {
    const prompt = tomorrowDiscussPrompt(
      [{ id: "6", title: "Pack bag", status: "todo", due_at: "2026-08-25T09:00:00.000Z" }],
      "ru",
    );
    expect(prompt).toContain("Pack bag");
    expect(prompt.toLowerCase()).not.toMatch(/^сделай сам:/);
  });

  it("builds today's discussion prompt from overdue, dated, and undated work", () => {
    const prompt = todayDiscussPrompt(
      [{ id: "1", title: "Today", status: "todo", due_at: "2026-08-24T12:00:00.000Z" }],
      [{ id: "2", title: "Overdue", status: "todo", due_at: "2026-08-20T12:00:00.000Z" }],
      [{ id: "4", title: "Inbox", status: "todo" }],
      "ru",
    );
    expect(prompt).toContain("Today");
    expect(prompt).toContain("Overdue");
    expect(prompt).toContain("Inbox");
    expect(prompt.toLowerCase()).not.toMatch(/^сделай сам:/);
  });

  it("asks Ilzi to pick today's work by effort from undated tasks", () => {
    const prompt = pickTodayPrompt([{ id: "4", title: "Inbox", status: "todo" }], "ru");
    expect(prompt).toContain("Inbox");
    expect(prompt).toContain("трудозатрат");
    expect(prompt.toLowerCase()).not.toMatch(/^сделай сам:/);
  });
});

describe("offline home capture", () => {
  beforeEach(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: "test-token" }));
    localStorage.removeItem("ealzy.language");
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_success: PositionCallback, error?: PositionErrorCallback) => {
          error?.({ code: 1, message: "denied", PERMISSION_DENIED: 1 } as GeolocationPositionError);
        },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
  });

  afterEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    resetTaskSync();
  });

  it("adds a today task without internet and marks it as waiting to sync", async () => {
    stubHomeApis();
    vi.spyOn(api, "goals").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([]);
    vi.spyOn(api, "people").mockResolvedValue([]);
    vi.spyOn(api, "tasks").mockImplementation(async () => {
      const { snapshotTasks } = await import("../task-sync");
      return snapshotTasks();
    });
    renderAt("/");

    expect(await screen.findByRole("tab", { name: "Сегодня" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Добавить на сегодня" }));
    await userEvent.type(await screen.findByLabelText("Название"), "Купить хлеб");
    await userEvent.click(screen.getByRole("button", { name: "Создать дело" }));

    expect(screen.queryByRole("dialog", { name: "Новое дело" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /^Купить хлеб/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Добавить на сегодня" }));
    await userEvent.type(await screen.findByLabelText("Название"), "Забрать почту");
    await userEvent.click(screen.getByRole("button", { name: "Создать дело" }));

    expect(await screen.findByRole("button", { name: /^Забрать почту/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Купить хлеб/ })).toBeInTheDocument();
    expect(screen.getAllByText(/ждёт сеть/).length).toBeGreaterThan(0);
  });

  it("shows cached tasks even if the network never answers", async () => {
    const { enqueueCreate } = await import("../task-sync");
    enqueueCreate({ title: "Купить хлеб" });
    stubHomeApis();
    vi.spyOn(api, "tasks").mockImplementation(() => new Promise(() => undefined));
    renderAt("/");

    await userEvent.click(await screen.findByRole("tab", { name: "Без даты" }));
    expect(await screen.findByRole("button", { name: /^Купить хлеб/ })).toBeInTheDocument();
  });

  it("hides the waiting-to-sync caption when internet is available", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    const { enqueueCreate } = await import("../task-sync");
    enqueueCreate({ title: "Забронировать тур с Марком" });
    stubHomeApis();
    vi.spyOn(api, "tasks").mockImplementation(async () => {
      const { snapshotTasks } = await import("../task-sync");
      return snapshotTasks();
    });
    renderAt("/");

    await userEvent.click(await screen.findByRole("tab", { name: "Без даты" }));
    expect(
      await screen.findByRole("button", { name: /^Забронировать тур с Марком/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ждёт сеть/)).not.toBeInTheDocument();
  });

  it("invites a goals and plan sync when the last check-in is stale", async () => {
    localStorage.removeItem("ealzy.goal-sync-later");
    stubHomeApis();
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "UTC",
      primary_conversation_id: "c1",
      last_goal_checkin_on: "2026-01-01",
    });
    vi.spyOn(api, "goals").mockResolvedValue([
      {
        id: "g1",
        title: "Learn French",
        status: "active",
        stats: { task_count: 0, done_count: 0, open_count: 0, progress: 0, days_active: 20 },
      },
    ]);
    vi.spyOn(api, "sendCompanionMessage").mockResolvedValue({
      assistant_message: { id: "m1", role: "assistant", content: "Чего ты хочешь на самом деле?" },
    });
    renderAt("/");

    expect(await screen.findByRole("tablist", { name: "Запланировано" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Свериться по целям и плану" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText("Раз в неделю можно свериться по целям с Илзи."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Свериться" }));
    expect(await screen.findByRole("heading", { name: "Илзи" })).toBeInTheDocument();
  });

  it("shows a week summary with completed count and on-time stats at the weekend", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-06T15:00:00.000Z"));
    stubHomeApis();
    vi.spyOn(api, "tasks").mockResolvedValue([
      {
        id: "a",
        title: "On time",
        status: "done",
        due_at: "2026-09-02T12:00:00.000Z",
        completed_at: "2026-09-02T10:00:00.000Z",
      },
      {
        id: "b",
        title: "Late",
        status: "done",
        due_at: "2026-09-03T12:00:00.000Z",
        completed_at: "2026-09-04T10:00:00.000Z",
      },
    ]);
    renderAt("/");

    expect(await screen.findByRole("status", { name: "Итоги недели" })).toBeInTheDocument();
    expect(screen.getByText("Неделя закрыта — 2")).toBeInTheDocument();
    expect(screen.getByText("В срок 50% · 1 из 2")).toBeInTheDocument();
  });

  it("shows a compact week recap above remaining weekend tasks", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-05T15:00:00.000Z"));
    stubHomeApis();
    vi.spyOn(api, "tasks").mockResolvedValue([
      {
        id: "a",
        title: "Done earlier",
        status: "done",
        due_at: "2026-09-02T12:00:00.000Z",
        completed_at: "2026-09-02T10:00:00.000Z",
      },
      {
        id: "b",
        title: "Still today",
        status: "todo",
        due_at: middayIso("2026-09-05"),
      },
    ]);
    renderAt("/");

    expect(await screen.findByRole("button", { name: "Still today" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Итоги недели" })).toBeInTheDocument();
    expect(screen.getByText("1 дел за неделю")).toBeInTheDocument();
    expect(screen.getByText("В срок 100% · 1 из 1")).toBeInTheDocument();
  });
});

describe("completion streak", () => {
  it("counts consecutive done days and skips a quiet today", () => {
    const now = new Date("2026-09-04T15:00:00.000Z");
    const yesterday = "2026-09-03T18:00:00.000Z";
    const twoDaysAgo = "2026-09-02T18:00:00.000Z";
    const streak = completionStreak(
      [
        { id: "a", title: "A", status: "done", updated_at: yesterday },
        { id: "b", title: "B", status: "done", updated_at: twoDaysAgo },
        { id: "c", title: "C", status: "todo", updated_at: now.toISOString() },
      ] as never,
      "UTC",
      now,
    );
    expect(streak).toBe(2);
    expect(streakMilestone(7)).toBe(7);
    expect(streakMilestone(3)).toBeNull();
  });
});

describe("weekly recap", () => {
  it("starts the week on Monday and treats Friday evening as the wrap-up", () => {
    expect(weekStartKey(new Date("2026-09-06T15:00:00.000Z"), "UTC")).toBe("2026-08-31");
    expect(isEndOfWeek(new Date("2026-09-04T15:00:00.000Z"), "UTC")).toBe(false);
    expect(isEndOfWeek(new Date("2026-09-04T20:00:00.000Z"), "UTC")).toBe(true);
    expect(isEndOfWeek(new Date("2026-09-06T12:00:00.000Z"), "UTC")).toBe(true);
  });

  it("counts this week's completions and on-time dated work", () => {
    const now = new Date("2026-09-06T15:00:00.000Z");
    const stats = weekStats(
      [
        {
          id: "on-time",
          title: "On time",
          status: "done",
          due_at: "2026-09-02T12:00:00.000Z",
          completed_at: "2026-09-02T10:00:00.000Z",
        },
        {
          id: "late",
          title: "Late",
          status: "done",
          due_at: "2026-09-03T12:00:00.000Z",
          completed_at: "2026-09-04T10:00:00.000Z",
        },
        {
          id: "open",
          title: "Still open",
          status: "todo",
          due_at: "2026-09-04T12:00:00.000Z",
        },
        {
          id: "today",
          title: "Due today",
          status: "todo",
          due_at: "2026-09-06T12:00:00.000Z",
        },
        {
          id: "undated",
          title: "Undated done",
          status: "done",
          completed_at: "2026-09-05T10:00:00.000Z",
        },
        {
          id: "ai",
          title: "Ealzy work",
          status: "done",
          assignee: "ealzy",
          due_at: "2026-09-02T12:00:00.000Z",
          completed_at: "2026-09-02T09:00:00.000Z",
        },
      ],
      "UTC",
      now,
    );
    expect(stats).toEqual({
      completed: 3,
      on_time: 1,
      dated: 3,
      percent: 33,
    });
    expect(shouldShowWeekSummary(stats, now, "UTC")).toBe(true);
    expect(shouldShowWeekSummary(stats, new Date("2026-09-02T15:00:00.000Z"), "UTC")).toBe(false);
  });
});
