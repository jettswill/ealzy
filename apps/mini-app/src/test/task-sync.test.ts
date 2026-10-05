import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyRemoteTasks,
  completePatch,
  enqueueCreate,
  enqueuePatch,
  flushTaskOutbox,
  resetTaskSync,
  snapshotTasks,
  startTaskSync,
  upsertTask,
  type TaskTransport,
} from "../task-sync";
import type { Task } from "../types";

function jsonTask(id: string, title: string): Task {
  return {
    id,
    title,
    status: "todo",
    description: null,
    created_at: "2026-08-27T10:00:00.000Z",
    updated_at: "2026-08-27T10:00:00.000Z",
  };
}

afterEach(() => {
  resetTaskSync();
  vi.unstubAllGlobals();
});

describe("offline task queue", () => {
  it("keeps created tasks in the local snapshot until they sync", () => {
    const local = enqueueCreate({ title: "Buy bread", due_at: "2026-08-28T12:00:00.000Z" });
    expect(local.pending_sync).toBe(true);
    expect(snapshotTasks().map((task) => task.title)).toEqual(["Buy bread"]);

    applyRemoteTasks([jsonTask("server-1", "Existing")]);
    expect(snapshotTasks().map((task) => task.title)).toEqual(["Buy bread", "Existing"]);
  });

  it("folds a status change into a pending create instead of a separate patch", async () => {
    const local = enqueueCreate({ title: "Call bank" });
    enqueuePatch(local.id, { status: "done" });
    expect(snapshotTasks()[0]?.completed_at).toBeTruthy();
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/tasks" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { id: string; title: string; status: string };
        expect(body.id).toBe(local.id);
        expect(body.status).toBe("done");
        return jsonTask(body.id, body.title);
      }
      if (path === "/api/tasks") return [jsonTask(local.id, "Call bank")];
      throw new Error(`unexpected ${path}`);
    });

    await flushTaskOutbox({ request: request as unknown as TaskTransport["request"] });
    expect(request).toHaveBeenCalled();
    expect(snapshotTasks()[0]?.pending_sync).toBeFalsy();
    expect(
      request.mock.calls.some(
        ([path, init]) => path.startsWith("/api/tasks/") && init?.method === "PATCH",
      ),
    ).toBe(false);
  });

  it("pushes queued creates when the browser comes online", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const local = enqueueCreate({ title: "Pack bag" });
    const created = jsonTask(local.id, "Pack bag");
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/tasks" && init?.method === "POST") return created;
      if (path === "/api/tasks") return [created];
      throw new Error(`unexpected ${path}`);
    });
    const stop = startTaskSync({ request: request as unknown as TaskTransport["request"] });
    expect(request).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      id: local.id,
      title: "Pack bag",
    });
    stop();
  });

  it("keeps a local create when the server answers 403", async () => {
    const local = enqueueCreate({ title: "Stay local" });
    const request = vi.fn(async () => {
      throw Object.assign(new Error("forbidden"), { status: 403 });
    });
    await flushTaskOutbox({ request: request as unknown as TaskTransport["request"] });
    expect(snapshotTasks().map((task) => task.title)).toEqual(["Stay local"]);
    expect(snapshotTasks()[0]?.id).toBe(local.id);
  });

  it("pulls remote tasks when starting with an empty outbox", async () => {
    const remote = jsonTask("r1", "From telegram");
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/tasks" && !init?.method) return [remote];
      throw new Error(`unexpected ${path}`);
    });
    const stop = startTaskSync({ request: request as unknown as TaskTransport["request"] });
    await vi.waitFor(() => expect(snapshotTasks().map((task) => task.title)).toEqual(["From telegram"]));
    stop();
  });

  it("refreshes tasks when the tab becomes visible", async () => {
    let remote = jsonTask("r1", "First");
    const request = vi.fn(async (path: string) => {
      if (path === "/api/tasks") return [remote];
      throw new Error(`unexpected ${path}`);
    });
    const stop = startTaskSync({ request: request as unknown as TaskTransport["request"] });
    await vi.waitFor(() => expect(snapshotTasks()[0]?.title).toBe("First"));
    remote = jsonTask("r2", "From telegram");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(snapshotTasks()[0]?.title).toBe("From telegram"));
    stop();
  });
});

describe("stale remote merge", () => {
  it("does not reopen a completed task when a slower list fetch arrives late", () => {
    const original = jsonTask("t1", "Buy milk");
    applyRemoteTasks([original]);
    enqueuePatch("t1", { status: "done" });
    completePatch("t1", {
      ...original,
      status: "done",
      completed_at: "2026-09-21T12:00:00.000Z",
      updated_at: "2026-09-21T12:00:00.000Z",
    });

    applyRemoteTasks([original]);

    expect(snapshotTasks()[0]).toMatchObject({ id: "t1", status: "done" });
  });

  it("does not move a rescheduled task back when a stale list arrives", () => {
    const original = { ...jsonTask("t1", "Call dentist"), due_at: "2026-09-21T12:00:00.000Z" };
    applyRemoteTasks([original]);
    enqueuePatch("t1", { due_at: "2026-09-22T12:00:00.000Z" });
    completePatch("t1", {
      ...original,
      due_at: "2026-09-22T12:00:00.000Z",
      updated_at: "2026-09-21T15:00:00.000Z",
    });

    applyRemoteTasks([original]);

    expect(snapshotTasks()[0]?.due_at).toBe("2026-09-22T12:00:00.000Z");
  });

  it("still accepts a newer remote edit from another device", () => {
    applyRemoteTasks([jsonTask("t1", "Buy milk")]);
    applyRemoteTasks([
      {
        ...jsonTask("t1", "Buy milk and bread"),
        updated_at: "2026-09-21T16:00:00.000Z",
      },
    ]);

    expect(snapshotTasks()[0]?.title).toBe("Buy milk and bread");
  });

  it("keeps a completed patch after flush even if the follow-up list is stale", async () => {
    const original = jsonTask("t1", "Buy milk");
    applyRemoteTasks([original]);
    enqueuePatch("t1", { status: "done" });
    const patched = {
      ...original,
      status: "done" as const,
      completed_at: "2026-09-21T12:00:00.000Z",
      updated_at: "2026-09-21T12:00:00.000Z",
    };
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === "/api/tasks/t1" && init?.method === "PATCH") return patched;
      if (path === "/api/tasks") return [original];
      throw new Error(`unexpected ${path}`);
    });

    await flushTaskOutbox({ request: request as unknown as TaskTransport["request"] });
    expect(snapshotTasks()[0]).toMatchObject({ id: "t1", status: "done" });
  });
});

describe("upsertTask", () => {
  it("updates an existing task without moving it", () => {
    const first = jsonTask("1", "First");
    const second = jsonTask("2", "Second");
    const third = jsonTask("3", "Third");
    expect(
      upsertTask([first, second, third], { ...second, status: "done" }).map((task) => task.title),
    ).toEqual(["First", "Second", "Third"]);
  });
});
