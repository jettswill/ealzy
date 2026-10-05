import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, COMPANION_TIMEOUT_MS, REQUEST_TIMEOUT_MS, consumeCompanionSse } from "../api";
import type { ApiError } from "../api";
import { resetTaskSync } from "../task-sync";

afterEach(() => {
  resetTaskSync();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("ApiClient", () => {
  it("exchanges Telegram init data without a bearer token", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { token: "session-token" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const api = new ApiClient(() => null, fetcher);

    await expect(api.exchangeTelegram("query_id=123")).resolves.toEqual({ token: "session-token" });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/auth/telegram",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ initData: "query_id=123" }),
      }),
    );
    const headers = fetcher.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.has("Authorization")).toBe(false);
  });

  it("adds the bearer session to authenticated requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const api = new ApiClient(() => "abc", fetcher);
    await api.people("Masha");

    const headers = fetcher.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer abc");
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/people?search=Masha");
  });

  it("surfaces the server error envelope", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Not allowed", code: "FORBIDDEN" } }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const api = new ApiClient(() => "abc", fetcher);

    await expect(api.people()).rejects.toMatchObject({
      name: "ApiError",
      message: "Not allowed",
      status: 403,
      code: "FORBIDDEN",
    } satisfies Partial<ApiError>);
  });

  it("queues a create when the network is down and keeps it after a failed list", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const api = new ApiClient(() => "abc", fetcher);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

    const created = await api.createTask({ title: "Offline note" });
    expect(created.title).toBe("Offline note");
    expect(created.pending_sync).toBe(true);
    await expect(api.tasks()).resolves.toEqual([
      expect.objectContaining({ id: created.id, title: "Offline note" }),
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns cached tasks when the list endpoint is forbidden", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Not allowed", code: "FORBIDDEN" } }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const api = new ApiClient(() => "abc", fetcher);
    const created = await api.createTask({ title: "Keep me" });
    await expect(api.tasks()).resolves.toEqual([
      expect.objectContaining({ id: created.id, title: "Keep me" }),
    ]);
  });

  it("keeps the local task immediately and syncs the client id in the background", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "kept", title: "Gift", status: "todo" } }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const api = new ApiClient(() => "abc", fetcher);
    const created = await api.createTask({ title: "Gift" });

    expect(created.title).toBe("Gift");
    expect(created.pending_sync).toBe(true);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as {
      id: string;
      title: string;
    };
    expect(body.title).toBe("Gift");
    expect(body.id).toBe(created.id);
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("uses experience filters and updates follow-up state", async () => {
    const experience = {
      id: "e1",
      type: "restaurant" as const,
      title: "Coffee with Masha",
      emotions: ["happy"],
      positive_signals: [],
      negative_signals: [],
      participant_ids: [],
      participants: [],
      status: "follow_up_due" as const,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [experience] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ...experience, status: "completed" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const api = new ApiClient(() => "abc", fetcher);

    await api.experiences({ personId: "p1", limit: 3 });
    await api.followUpExperience("e1", "completed");

    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/experiences?person_id=p1&limit=3");
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/experiences/e1");
    expect(fetcher.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      }),
    );
  });

  it("saves optional locations for self and people", async () => {
    const location = {
      id: "loc1",
      person_id: "p1",
      city: "Kazan",
      address: "Bauman 12",
      label: "home",
      is_primary: true,
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: location }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const api = new ApiClient(() => "abc", fetcher);
    await api.createSelfLocation({ city: "Kazan", address: "Bauman 12" });
    await api.createLocation("p1", { city: "Sochi" });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/me/locations");
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/people/p1/locations");
  });

  it("saves dates for people", async () => {
    const saved = {
      id: "d1",
      person_id: "p1",
      kind: "birthday",
      label: null,
      month: 3,
      day: 29,
      year: 1994,
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: saved }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const api = new ApiClient(() => "abc", fetcher);
    await api.createDate("p1", { kind: "birthday", month: 3, day: 29, year: 1994 });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/people/p1/dates");
  });

  it("maps editable note action previews to the confirm API contract", async () => {
    const serverAction = {
      id: "22222222-2222-4222-8222-222222222222",
      note_id: "11111111-1111-4111-8111-111111111111",
      proposal: {
        kind: "plan",
        title: "Launch",
        description: "Validate the idea",
        current_plan: "Interview users",
        tasks: [{ title: "Book interviews" }],
      },
      confirmed_at: null,
      result: null,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: serverAction }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              ...serverAction,
              confirmed_at: new Date().toISOString(),
              result: { goal_id: "33333333-3333-4333-8333-333333333333" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const api = new ApiClient(() => "abc", fetcher);

    const draft = await api.previewNoteAction(serverAction.note_id, "plan");
    expect(draft.payload.goal).toMatchObject({
      title: "Launch",
      current_plan: "Interview users",
    });
    draft.payload.goal!.current_plan = "Edited plan";
    const confirmed = await api.confirmNoteAction(draft);

    expect(fetcher.mock.calls[1]?.[0]).toBe(`/api/note-actions/${serverAction.id}/confirm`);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      proposal: {
        kind: "plan",
        title: "Launch",
        description: "Validate the idea",
        current_plan: "Edited plan",
        tasks: [{ title: "Book interviews" }],
      },
    });
    expect(confirmed.entities[0]).toMatchObject({
      type: "goal",
      id: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("gives companion replies more time than ordinary requests", async () => {
    vi.useFakeTimers();
    const hanging = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          const fail = () => reject(new DOMException("Aborted", "AbortError"));
          if (signal.aborted) fail();
          else signal.addEventListener("abort", fail, { once: true });
        }),
    );
    const api = new ApiClient(() => "abc", hanging);

    try {
      const people = api.people();
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
      await expect(
        Promise.race([
          people.then(
            () => "settled",
            () => "settled",
          ),
          Promise.resolve("pending"),
        ]),
      ).resolves.toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      await expect(people).rejects.toMatchObject({ status: 0 });

      const send = api.sendCompanionMessage("I need advice");
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await expect(
        Promise.race([
          send.then(
            () => "settled",
            () => "settled",
          ),
          Promise.resolve("pending"),
        ]),
      ).resolves.toBe("pending");
      await vi.advanceTimersByTimeAsync(COMPANION_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
      await expect(send).rejects.toMatchObject({ status: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads companion SSE deltas then the done payload", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(":\n\n"));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "delta", answer: "Hi" })}\n\n`),
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "done",
              data: { assistant_message: { content: "Hi there" } },
            })}\n\n`,
          ),
        );
        controller.close();
      },
    });
    const deltas: string[] = [];
    await expect(
      consumeCompanionSse(
        new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
        (answer) => deltas.push(answer),
      ),
    ).resolves.toEqual({ assistant_message: { content: "Hi there" } });
    expect(deltas).toEqual(["Hi"]);
  });

  it("streams companion replies and falls back to JSON if the stream route is missing", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).includes("/stream")) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ data: { assistant_message: { content: "Whole reply" } } }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });
    const api = new ApiClient(() => "abc", fetcher);
    const deltas: string[] = [];
    await expect(api.sendCompanionMessage("hi", (answer) => deltas.push(answer))).resolves.toEqual({
      assistant_message: { content: "Whole reply" },
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/companion/messages/stream");
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/companion/messages");
    expect(deltas).toEqual(["Whole reply"]);
  });
});
