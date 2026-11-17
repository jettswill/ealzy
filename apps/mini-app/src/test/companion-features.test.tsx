import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "../api";
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

function installSpeechRecognition() {
  const instances: FakeSpeechRecognition[] = [];
  class FakeSpeechRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onresult: ((event: { resultIndex: number; results: unknown }) => void) | null = null;
    onerror: ((event: { error?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();

    constructor() {
      instances.push(this);
    }

    emit(transcript: string, isFinal = true) {
      const result = {
        isFinal,
        length: 1,
        0: { transcript },
      };
      this.onresult?.({
        resultIndex: 0,
        results: { length: 1, 0: result },
      });
    }
  }
  Object.defineProperty(window, "SpeechRecognition", {
    configurable: true,
    writable: true,
    value: FakeSpeechRecognition,
  });
  Object.defineProperty(window, "webkitSpeechRecognition", {
    configurable: true,
    writable: true,
    value: FakeSpeechRecognition,
  });
  return {
    get latest() {
      return instances.at(-1);
    },
  };
}

describe("personal companion features", () => {
  beforeEach(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: "test-token" }));
    localStorage.removeItem("ealzy.language");
    vi.restoreAllMocks();
    vi.spyOn(api, "mailAccounts").mockResolvedValue([]);
    vi.spyOn(api, "goals").mockResolvedValue([]);
    Reflect.deleteProperty(window, "SpeechRecognition");
    Reflect.deleteProperty(window, "webkitSpeechRecognition");
  });

  it("loads shared history and sends a companion message", async () => {
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockResolvedValue([
      { id: "m1", role: "assistant", content: "How can I help?", conversation_id: "c1" },
    ]);
    const send = vi.spyOn(api, "sendCompanionMessage").mockResolvedValue({
      assistant_message: {
        id: "m3",
        role: "assistant",
        content: "Let’s break it down.",
        entities: [
          { id: "g1", type: "goal", label: "Build confidence" },
          { id: "t1", type: "task", label: "Anki вечером" },
        ],
      },
    });
    renderAt("/companion");

    expect(await screen.findByText("How can I help?")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Сообщение Илзи"), "I need advice");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(send).toHaveBeenCalledWith("I need advice", expect.any(Function));
    expect(await screen.findByText("Let’s break it down.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Цель · Build confidence" })).toHaveAttribute(
      "href",
      "/goals/g1",
    );
    expect(screen.getByRole("link", { name: "Дело · Anki вечером" })).toHaveAttribute(
      "href",
      "/tasks",
    );
  });

  it("paints Ilzi's reply as it streams", async () => {
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockResolvedValue([
      { id: "m1", role: "assistant", content: "How can I help?", conversation_id: "c1" },
    ]);
    let finish!: (reply: {
      assistant_message: { id: string; role: "assistant"; content: string };
    }) => void;
    vi.spyOn(api, "sendCompanionMessage").mockImplementation((_content, onDelta) => {
      onDelta?.("Let’s break");
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    renderAt("/companion");

    expect(await screen.findByText("How can I help?")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Сообщение Илзи"), "I need advice");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(await screen.findByText("Let’s break")).toBeInTheDocument();
    expect(screen.queryByText("Думаю…")).not.toBeInTheDocument();

    await act(async () => {
      finish({
        assistant_message: {
          id: "m3",
          role: "assistant",
          content: "Let’s break it down.",
        },
      });
    });
    expect(await screen.findByText("Let’s break it down.")).toBeInTheDocument();
  });

  it("runs the five-minute intro from an empty companion", async () => {
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockResolvedValue([]);
    vi.spyOn(api, "dueExperienceFollowUps").mockResolvedValue([]);
    const intro = vi
      .spyOn(api, "guidedIntro")
      .mockResolvedValueOnce({
        question: "Чем ты занимаешься и что сейчас для тебя важно?",
        step: 0,
        total: 2,
        facts_count: 0,
        done: false,
        user_message: null,
        assistant_message: {
          id: "g1",
          role: "assistant",
          content: "Чем ты занимаешься и что сейчас для тебя важно?",
        },
      })
      .mockResolvedValueOnce({
        question: "Запомнил. Какая одна цель на ближайшие недели для тебя главная?",
        step: 1,
        total: 2,
        facts_count: 2,
        done: false,
        user_message: { id: "u1", role: "user", content: "Я дизайнер" },
        assistant_message: {
          id: "g2",
          role: "assistant",
          content: "Запомнил. Какая одна цель на ближайшие недели для тебя главная?",
        },
      });
    renderAt("/companion");

    await userEvent.click(await screen.findByRole("button", { name: "Два вопроса — и к делам" }));
    expect(await screen.findByText(/Чем ты занимаешься/)).toBeInTheDocument();
    expect(screen.getByText(/шаг 1 из 2/)).toBeInTheDocument();
    expect(intro).toHaveBeenCalledWith();

    await userEvent.type(screen.getByLabelText("Сообщение Илзи"), "Я дизайнер");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(intro).toHaveBeenLastCalledWith("Я дизайнер");
    expect(await screen.findByText(/одна цель на ближайшие недели/)).toBeInTheDocument();
    expect(screen.getByText(/Илзи знает 2 факт/)).toBeInTheDocument();
  });

  it("keeps a reply that landed after the send connection dropped", async () => {
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    const history = [
      { id: "m1", role: "assistant" as const, content: "How can I help?", conversation_id: "c1" },
      { id: "m2", role: "user" as const, content: "I need advice", conversation_id: "c1" },
      {
        id: "m3",
        role: "assistant" as const,
        content: "Let’s break it down.",
        conversation_id: "c1",
      },
    ];
    vi.spyOn(api, "conversationMessages")
      .mockResolvedValueOnce([history[0]!])
      .mockResolvedValue(history);
    vi.spyOn(api, "sendCompanionMessage").mockRejectedValue(
      new ApiError("Could not connect to Ealzy. Check your connection and try again.", 0),
    );
    renderAt("/companion");

    expect(await screen.findByText("How can I help?")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Сообщение Илзи"), "I need advice");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(await screen.findByText("Let’s break it down.")).toBeInTheDocument();
    expect(screen.queryByText(/Нет связи с Ealzy/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Сообщение Илзи")).toHaveValue("");
  });

  it("shows a reply from history if the send request hangs", async () => {
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    const history = [
      { id: "m1", role: "assistant" as const, content: "How can I help?", conversation_id: "c1" },
      { id: "m2", role: "user" as const, content: "I need advice", conversation_id: "c1" },
      {
        id: "m3",
        role: "assistant" as const,
        content: "Let’s break it down.",
        conversation_id: "c1",
      },
    ];
    vi.spyOn(api, "conversationMessages")
      .mockResolvedValueOnce([history[0]!])
      .mockResolvedValue(history);
    vi.spyOn(api, "sendCompanionMessage").mockReturnValue(new Promise(() => undefined));
    renderAt("/companion");

    expect(await screen.findByText("How can I help?")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Сообщение Илзи"), "I need advice");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(await screen.findByText("Let’s break it down.")).toBeInTheDocument();
    expect(screen.queryByText(/Нет связи с Ealzy/)).not.toBeInTheDocument();
  });

  it("shows the chat without a back link or companion header", async () => {
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockResolvedValue([]);
    vi.spyOn(api, "dueExperienceFollowUps").mockResolvedValue([]);
    renderAt("/companion");

    expect(await screen.findByLabelText("Сообщение Илзи")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Голосовой ввод" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "← Дела" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Помощник" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Илзи" })).toHaveClass("sr-only");
  });

  it("keeps the composer while the conversation is loading", async () => {
    let release: (value: []) => void = () => undefined;
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    vi.spyOn(api, "dueExperienceFollowUps").mockResolvedValue([]);
    renderAt("/companion");

    expect(await screen.findByPlaceholderText("Спросить что угодно…")).toHaveClass(
      "composer-input",
    );
    expect(screen.getByText("Загрузка разговора…")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Сообщение Илзи" }).closest("form")).toHaveClass(
      "composer-dock",
    );
    await act(async () => release([]));
  });

  it("dictates on-device speech into the composer without sending it", async () => {
    const recognition = installSpeechRecognition();
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockResolvedValue([]);
    vi.spyOn(api, "dueExperienceFollowUps").mockResolvedValue([]);
    const send = vi.spyOn(api, "sendCompanionMessage");
    renderAt("/companion");

    await waitFor(() => {
      expect(screen.getByLabelText("Сообщение Илзи")).toBeEnabled();
    });
    await userEvent.click(screen.getByRole("button", { name: "Голосовой ввод" }));
    expect(recognition.latest?.start).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Остановить запись" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    act(() => {
      recognition.latest?.emit("напомни купить хлеб", true);
    });

    expect(screen.getByLabelText("Сообщение Илзи")).toHaveValue("напомни купить хлеб");
    expect(send).not.toHaveBeenCalled();
  });

  it("renders assistant Markdown as formatted text without visible markers", async () => {
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockResolvedValue([
      {
        id: "m1",
        role: "assistant",
        content: "**Задача:** проверить *сегодня* и **очень _внимательно_**.",
        conversation_id: "c1",
      },
    ]);
    renderAt("/companion");

    const message = await screen.findByLabelText("assistant message");
    expect(message).toHaveTextContent("Задача: проверить сегодня и очень внимательно.");
    expect(message).not.toHaveTextContent("*");
    expect(message.querySelector("strong")).toHaveTextContent("Задача:");
    expect(message.querySelector("em")).toHaveTextContent("сегодня");
    expect(message.querySelector("strong em")).toHaveTextContent("внимательно");
  });

  it("renders a numbered task list as separate items", async () => {
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockResolvedValue([
      {
        id: "m1",
        role: "assistant",
        content: [
          "На данный момент у тебя есть следующие просроченные задачи:",
          "",
          "1. Составить план обучения продажам.",
          "2. Построить план работ по лоцен.",
          "",
          "Сними просрочку первой.",
        ].join("\n"),
        conversation_id: "c1",
      },
    ]);
    renderAt("/companion");

    const message = await screen.findByLabelText("assistant message");
    const items = message.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Составить план обучения продажам.");
    expect(items[1]).toHaveTextContent("Построить план работ по лоцен.");
    expect(message).toHaveTextContent(/просроченные задачи/);
    expect(message).toHaveTextContent("Сними просрочку первой.");
  });

  it("lets the user retry the last request after an AI outage", async () => {
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockResolvedValue([
      { id: "m1", role: "user", content: "какие дела на сегодня?", conversation_id: "c1" },
      {
        id: "m2",
        role: "assistant",
        content:
          "Сейчас не удалось связаться с AI. Я сохранил сообщение в общей истории — попробуйте ещё раз позже.",
        conversation_id: "c1",
        metadata: {
          ai_unavailable: true,
          offers: [
            {
              kind: "remind",
              title: "Напомнить о праздниках",
              instruction: "Посмотри ближайшие праздники",
            },
          ],
        },
      },
      { id: "m3", role: "user", content: "какие дела на сегодня?", conversation_id: "c1" },
      {
        id: "m4",
        role: "assistant",
        content:
          "Сейчас не удалось связаться с AI. Я сохранил сообщение в общей истории — попробуйте ещё раз позже.",
        conversation_id: "c1",
        metadata: { ai_unavailable: true },
      },
    ]);
    vi.spyOn(api, "dueExperienceFollowUps").mockResolvedValue([]);
    const send = vi.spyOn(api, "sendCompanionMessage");
    const retry = vi.spyOn(api, "retryCompanionMessage").mockResolvedValue({
      user_message: { id: "m1", role: "user", content: "какие дела на сегодня?" },
      assistant_message: { id: "m5", role: "assistant", content: "Сегодня три дела." },
    });
    renderAt("/companion");

    expect(await screen.findByText("какие дела на сегодня?")).toBeInTheDocument();
    expect(screen.getAllByLabelText("user message")).toHaveLength(1);
    expect(screen.queryByText(/не удалось связаться с AI/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Напомнить о праздниках" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Повторить запрос" }));
    expect(send).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Сегодня три дела.")).toBeInTheDocument();
    expect(screen.getAllByLabelText("user message")).toHaveLength(1);
    expect(screen.queryByText(/не удалось связаться с AI/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Повторить запрос" })).not.toBeInTheDocument();
  });

  it("lets the user retry after a send error", async () => {
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockResolvedValue([
      { id: "m1", role: "assistant", content: "How can I help?", conversation_id: "c1" },
    ]);
    const send = vi
      .spyOn(api, "sendCompanionMessage")
      .mockRejectedValueOnce(new ApiError("offline", 401))
      .mockResolvedValueOnce({
        assistant_message: { id: "m3", role: "assistant", content: "Сегодня три дела." },
      });
    renderAt("/companion");

    expect(await screen.findByText("How can I help?")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Сообщение Илзи")).toBeEnabled());
    await userEvent.type(screen.getByLabelText("Сообщение Илзи"), "какие дела на сегодня?");
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText("Сессия истекла — обновите страницу.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Повторить запрос" }));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith("какие дела на сегодня?", expect.any(Function));
    expect(await screen.findByText("Сегодня три дела.")).toBeInTheDocument();
  });

  it("lets the user tap an AI self-serve offer", async () => {
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockResolvedValue([
      {
        id: "m2",
        role: "assistant",
        content: "Могу набросать план разговора.",
        metadata: {
          offers: [
            {
              kind: "plan",
              title: "Набросать план",
              instruction: "Составь короткий план разговора с банком",
            },
          ],
        },
      },
    ]);
    const send = vi.spyOn(api, "sendCompanionMessage").mockResolvedValue({
      assistant_message: { id: "m4", role: "assistant", content: "1. Позвонить до 12." },
    });
    renderAt("/companion");
    await userEvent.click(await screen.findByRole("button", { name: "Набросать план" }));
    expect(send).toHaveBeenCalledWith(
      "Сделай сам: Составь короткий план разговора с банком",
      expect.any(Function),
    );
  });

  it("hides companion protocol internals from the chat bubble", async () => {
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockResolvedValue([
      {
        id: "m2",
        role: "assistant",
        content: "Готово — добавила дело.",
        metadata: {
          context_used: ["task"],
          follow_up: "Сделай сам: уточни срок",
        },
      },
    ]);
    renderAt("/companion");
    expect(await screen.findByText("Готово — добавила дело.")).toBeInTheDocument();
    expect(screen.queryByText(/Использовано/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Продолжение/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Сделай сам/)).not.toBeInTheDocument();
  });

  it("renders live search results as links", async () => {
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: null,
      primary_conversation_id: "c1",
    });
    vi.spyOn(api, "conversationMessages").mockResolvedValue([
      {
        id: "m5",
        role: "assistant",
        content: "Нашла наушники.\n\nВот что нашлось:\n• Sony — https://example.com/sony",
        metadata: {
          search_results: [
            {
              kind: "product",
              title: "Sony WH-1000XM5",
              subtitle: "наушники",
              url: "https://example.com/sony",
              price: "7990 ₽",
              source: "test",
            },
          ],
        },
      },
    ]);
    renderAt("/companion");
    expect(await screen.findByRole("link", { name: /Sony WH-1000XM5/ })).toHaveAttribute(
      "href",
      "https://example.com/sony",
    );
    expect(screen.queryByText(/Вот что нашлось/)).not.toBeInTheDocument();
  });

  it("renders profile portrait, values, and reflection history", async () => {
    localStorage.setItem("ealzy.language", "en");
    vi.spyOn(api, "me").mockResolvedValue({
      first_name: "Alex",
      bio: "Designer and founder",
      values: ["Curiosity", "Kindness"],
      communication_style: "Direct and warm",
      timezone: "Europe/Berlin",
      locale: "en",
      telegram_id: 42,
      context_summary: "Night owl. Prefers short answers. Often lets admin go overdue.",
    });
    vi.spyOn(api, "selfMemories").mockResolvedValue([]);
    vi.spyOn(api, "reflections").mockResolvedValue([
      {
        id: "r1",
        period_start: "2026-07-01",
        period_end: "2026-07-07",
        wins: ["Shipped onboarding"],
        improvements: [],
        next_steps: ["Interview users"],
      },
    ]);
    renderAt("/profile");

    expect(await screen.findByRole("heading", { name: "Alex" })).toBeInTheDocument();
    expect(screen.getByText("Curiosity")).toBeInTheDocument();
    expect(screen.getByText("Kindness")).toBeInTheDocument();
    expect(screen.queryByText("Direct and warm")).not.toBeInTheDocument();
    expect(screen.getByText("Europe/Berlin")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Personalization" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "On-time tasks" })).toBeInTheDocument();
    expect(screen.queryByText("What Ilzi already knows")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "That's not right" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Night owl/)).not.toBeInTheDocument();
    expect(screen.getByText(/Shipped onboarding/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Mail" })).not.toBeInTheDocument();
    expect(screen.queryByText("What are you interested in lately?")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Messages" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What matters now" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Message Ilzi" })).toHaveAttribute(
      "href",
      "/companion",
    );
    expect(screen.getByRole("link", { name: "Open tasks" })).toHaveAttribute("href", "/");
  });

  it("saves telegram notification preferences", async () => {
    localStorage.setItem("ealzy.language", "en");
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Moscow",
      locale: "en",
      telegram_id: 42,
      morning_digest_enabled: false,
      morning_digest_time: "08:00",
      weekly_digest_enabled: false,
      weekly_digest_time: "09:00",
      evening_sync_enabled: false,
      evening_sync_time: "21:00",
    });
    vi.spyOn(api, "selfMemories").mockResolvedValue([]);
    vi.spyOn(api, "goals").mockResolvedValue([]);
    vi.spyOn(api, "projects").mockResolvedValue([]);
    vi.spyOn(api, "reflections").mockResolvedValue([]);
    const update = vi.spyOn(api, "updateMe").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Moscow",
      locale: "en",
      morning_digest_enabled: true,
      morning_digest_time: "08:00",
      weekly_digest_enabled: false,
      weekly_digest_time: "09:00",
      evening_sync_enabled: false,
      evening_sync_time: "21:00",
    });
    renderAt("/profile");
    expect(await screen.findByRole("heading", { name: "Messages" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: /Morning summary/ }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ morning_digest_enabled: true, morning_digest_time: "08:00" }),
    );
    expect(screen.getByRole("checkbox", { name: /Morning summary/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue with Telegram" }),
    ).not.toBeInTheDocument();
  });

  it("shows on-time scale instead of inferred negative traits", async () => {
    localStorage.setItem("ealzy.language", "en");
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Moscow",
      locale: "en",
      telegram_id: 42,
      context_summary: "On-time tasks: 92%. Almost everything lands on time — rare precision.",
      reliability: {
        percent: 92,
        on_time: 11,
        dated: 12,
        current_streak: 8,
        best_streak: 8,
        achievements: [7],
        praise: "excellent",
        community: {
          users: 11,
          holders: { 7: 2, 30: 1, 60: 0, 100: 0, 360: 0 },
        },
      },
    });
    vi.spyOn(api, "selfMemories").mockResolvedValue([
      {
        id: "m1",
        person_id: "self",
        content: "tends to postpone work",
        category: "personality",
        metadata: { source: "behavior_inference" },
      },
      {
        id: "m2",
        person_id: "self",
        content: "I think better in the evening",
        category: "preference",
        metadata: { source: "companion_self" },
      },
    ]);
    vi.spyOn(api, "reflections").mockResolvedValue([]);
    renderAt("/profile");
    expect(await screen.findByText("On-time tasks")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    expect(screen.getAllByText(/Almost everything lands on time/).length).toBeGreaterThan(0);
    expect(screen.getByText("Week")).toBeInTheDocument();
    expect(screen.getByText("I think better in the evening")).toBeInTheDocument();
    expect(screen.queryByText("tends to postpone work")).not.toBeInTheDocument();
    expect(screen.queryByText("On-time tasks: 92%")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Marks" })).toBeInTheDocument();
    expect(screen.getByText(/We count consecutive days when 90% or more/)).toBeInTheDocument();
    expect(screen.getByText("To the Month mark")).toBeInTheDocument();
    expect(screen.getByText("8 of 30")).toBeInTheDocument();
    expect(screen.getByText("A week of almost everything on time")).toBeInTheDocument();
    expect(screen.getByText("Held by 18% of people")).toBeInTheDocument();
    expect(screen.getByText("Held by 9% of people")).toBeInTheDocument();
    expect(screen.getAllByText("Held by 0% of people").length).toBeGreaterThan(0);
    expect(screen.getByText("Ilzi already uses this in conversation.")).toBeInTheDocument();
  });

  it("opens a personalization prompt with a useful placeholder", async () => {
    localStorage.setItem("ealzy.language", "en");
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Moscow",
      locale: "en",
    });
    vi.spyOn(api, "selfMemories").mockResolvedValue([]);
    vi.spyOn(api, "reflections").mockResolvedValue([]);
    const create = vi.spyOn(api, "createSelfMemory").mockResolvedValue({
      id: "m-new",
      person_id: "self",
      content: "I think better in the evening",
      category: "preference",
    });
    renderAt("/profile");
    await userEvent.click(await screen.findByRole("button", { name: "How I work" }));
    expect(screen.getByPlaceholderText("I think and work better when…")).toBeInTheDocument();
    await userEvent.type(
      screen.getByPlaceholderText("I think and work better when…"),
      "I think better in the evening",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save fact" }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "I think better in the evening",
        category: "preference",
      }),
    );
  });

  it("points a zero on-time scale at tasks without judging", async () => {
    localStorage.setItem("ealzy.language", "en");
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Moscow",
      locale: "en",
      reliability: {
        percent: 0,
        on_time: 0,
        dated: 6,
        current_streak: 0,
        best_streak: 0,
        achievements: [],
        praise: "none",
      },
    });
    vi.spyOn(api, "selfMemories").mockResolvedValue([]);
    vi.spyOn(api, "reflections").mockResolvedValue([]);
    renderAt("/profile");
    expect(await screen.findByText("0 of 6")).toBeInTheDocument();
    expect(
      screen.getByText(/Closing dated tasks on time will raise the scale/),
    ).toBeInTheDocument();
    expect(screen.getByText("To the Week mark")).toBeInTheDocument();
    expect(screen.getByText("0 of 7")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open tasks" })).toHaveAttribute("href", "/");
    expect(screen.queryByText(/postpone/i)).not.toBeInTheDocument();
  });

  it("lets the user add an optional city on the profile", async () => {
    localStorage.setItem("ealzy.language", "en");
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Moscow",
      locale: "en",
      locations: [],
    });
    vi.spyOn(api, "selfMemories").mockResolvedValue([]);
    vi.spyOn(api, "reflections").mockResolvedValue([]);
    vi.spyOn(api, "updateMe").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Moscow",
      locale: "en",
      locations: [],
    });
    const create = vi.spyOn(api, "createSelfLocation").mockResolvedValue({
      id: "loc1",
      person_id: "self",
      city: "Kazan",
      address: null,
      label: null,
      is_primary: true,
    });
    renderAt("/profile");
    await userEvent.click(await screen.findByRole("button", { name: "Name, city, and values" }));
    await userEvent.type(screen.getByPlaceholderText("Moscow"), "Kazan");
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(create).toHaveBeenCalledWith({
      city: "Kazan",
      is_primary: true,
    });
    expect(await screen.findByText("Kazan")).toBeInTheDocument();
  });

  it("groups rich people memories and exposes provenance in edit view", async () => {
    localStorage.setItem("ealzy.language", "en");
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Berlin",
      locale: "en",
    });
    vi.spyOn(api, "person").mockResolvedValue({
      id: "p1",
      name: "Masha",
      relationship: "Friend",
      description: null,
      locations: [
        {
          id: "l1",
          person_id: "p1",
          city: "Sochi",
          address: null,
          label: "home",
          is_primary: true,
        },
      ],
      dates: [
        {
          id: "d1",
          person_id: "p1",
          kind: "birthday",
          label: null,
          month: 9,
          day: 1,
          year: 1994,
        },
      ],
      memories: [
        {
          id: "m1",
          person_id: "p1",
          content: "Loves ramen",
          category: "favorite_food",
          importance: 5,
          confidence: 0.8,
          source_message_id: "source-1",
        },
      ],
    });
    renderAt("/people/p1");

    expect(await screen.findByRole("heading", { name: "Dates" })).toBeInTheDocument();
    expect(screen.getAllByText(/Birthday · /).length).toBeGreaterThan(0);
    expect(await screen.findByRole("heading", { name: "Favorite food" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit memory" }));
    expect(screen.getByLabelText(/Importance/)).toHaveValue(5);
    expect(screen.getByLabelText(/Confidence/)).toHaveValue(80);
    expect(screen.getByText("Source: Conversation")).toBeInTheDocument();
  });

  it("lets the user add a birthday and a shared date on a person", async () => {
    localStorage.setItem("ealzy.language", "en");
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Berlin",
      locale: "en",
    });
    vi.spyOn(api, "person").mockResolvedValue({
      id: "p1",
      name: "Masha",
      relationship: "Friend",
      description: null,
      locations: [],
      dates: [],
      memories: [],
    });
    vi.spyOn(api, "experiences").mockResolvedValue([]);
    const create = vi.spyOn(api, "createDate").mockResolvedValue({
      id: "d1",
      person_id: "p1",
      kind: "birthday",
      label: null,
      month: 3,
      day: 29,
      year: 1994,
    });
    renderAt("/people/p1");
    await userEvent.click(await screen.findByRole("button", { name: "＋ Date" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "1994-03-29" } });
    await userEvent.click(screen.getByRole("button", { name: "Save date" }));
    expect(create).toHaveBeenCalledWith("p1", {
      kind: "birthday",
      label: null,
      month: 3,
      day: 29,
      year: 1994,
    });
    expect(await screen.findAllByText(/Birthday · /)).not.toHaveLength(0);
  });

  it("saves recommendation feedback and shows reflection history on profile", async () => {
    localStorage.setItem("ealzy.language", "en");
    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Berlin",
      locale: "en",
    });
    vi.spyOn(api, "recommendation").mockResolvedValue({
      id: "rec1",
      query: "A thoughtful gift",
      items: [{ title: "Sketchbook", rationale: "Matches their creative interests." }],
    });
    const feedback = vi.spyOn(api, "sendRecommendationFeedback").mockResolvedValue();
    const view = renderAt("/recommendations/rec1");
    await userEvent.click(await screen.findByRole("button", { name: "Helpful" }));
    expect(feedback).toHaveBeenCalledWith("rec1", 0, "liked");
    view.unmount();

    vi.spyOn(api, "me").mockResolvedValue({
      bio: null,
      values: [],
      communication_style: null,
      timezone: "Europe/Berlin",
      locale: "en",
    });
    vi.spyOn(api, "selfMemories").mockResolvedValue([]);
    vi.spyOn(api, "reflections").mockResolvedValue([
      {
        id: "reflection-1",
        period_start: "2026-07-01",
        period_end: "2026-07-07",
        wins: ["Made time to think"],
        improvements: [],
        next_steps: [],
      },
    ]);
    renderAt("/profile");
    expect(await screen.findByText(/Made time to think/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reflect now" })).not.toBeInTheDocument();
  });
});

describe("website sign-in", () => {
  it("shows Telegram sign-in without contacting telegram.org", async () => {
    sessionStorage.clear();
    localStorage.removeItem("ealzy.language");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    render(
      <MemoryRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Добро пожаловать" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ealzy" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Продолжить в Telegram" })).toHaveAttribute(
      "href",
      expect.stringContaining("oauth.telegram.org/auth"),
    );
    expect(screen.getByRole("link", { name: "Открыть бота в Telegram" })).toHaveAttribute(
      "href",
      "tg://resolve?domain=ealzy_bot",
    );
    expect(screen.getByRole("note")).toHaveTextContent(/VPN/);
    expect(document.querySelector('script[src*="telegram-widget"]')).toBeNull();
    expect(fetchSpy.mock.calls.every(([input]) => !String(input).includes("telegram.org"))).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Apple" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Yandex" })).not.toBeInTheDocument();
  });
});
