import { LIVE_REFRESH_MS } from "./live-refresh";
import type {
  Task,
  TaskActivityType,
  TaskAssignee,
  TaskKind,
  TaskRecurrenceFrequency,
  TaskStatus,
} from "./types";

export const TASK_CACHE_KEY = "ealzy.tasks.cache";
export const TASK_OUTBOX_KEY = "ealzy.tasks.outbox";
export const TASKS_CHANGED_EVENT = "ealzy:tasks-changed";
export const TASK_CREATED_EVENT = "ealzy:task-created";

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  person_id?: string | null;
  space_id?: string | null;
  goal_id?: string | null;
  project_id?: string | null;
  due_at?: string | null;
  sort_order?: number | null;
  kind?: TaskKind;
  activity_type?: TaskActivityType | null;
  value_score?: number | null;
  estimate_minutes?: number | null;
  importance?: number | null;
  urgency?: number | null;
  assignee?: TaskAssignee;
  status?: TaskStatus;
  recurrence_frequency?: TaskRecurrenceFrequency | null;
};

export type PatchTaskInput = Partial<
  Pick<
    Task,
    | "title"
    | "description"
    | "status"
    | "kind"
    | "activity_type"
    | "value_score"
    | "estimate_minutes"
    | "importance"
    | "urgency"
    | "person_id"
    | "space_id"
    | "goal_id"
    | "project_id"
    | "due_at"
    | "sort_order"
    | "assignee"
    | "recurrence_frequency"
  >
> & { recurrence_scope?: "instance" | "series" };

export type TaskTransport = {
  request<T>(path: string, init?: RequestInit, authenticated?: boolean): Promise<T>;
};

type OutboxCreate = { type: "create"; id: string; input: CreateTaskInput };
type OutboxPatch = { type: "patch"; id: string; input: PatchTaskInput };
export type OutboxItem = OutboxCreate | OutboxPatch;

let memoryCache: Task[] = [];
let memoryOutbox: OutboxItem[] = [];
let flushing: Promise<void> | null = null;

function newId() {
  return crypto.randomUUID();
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota should not block creating a task in-memory.
  }
}

function readCache(): Task[] {
  try {
    if (typeof localStorage === "undefined") return memoryCache;
    memoryCache = readJson<Task[]>(TASK_CACHE_KEY, memoryCache);
    return memoryCache;
  } catch {
    return memoryCache;
  }
}

function writeCache(tasks: Task[]) {
  memoryCache = tasks;
  writeJson(TASK_CACHE_KEY, tasks);
}

function readOutbox(): OutboxItem[] {
  try {
    if (typeof localStorage === "undefined") return memoryOutbox;
    memoryOutbox = readJson<OutboxItem[]>(TASK_OUTBOX_KEY, memoryOutbox);
    return memoryOutbox;
  } catch {
    return memoryOutbox;
  }
}

function writeOutbox(items: OutboxItem[]) {
  memoryOutbox = items;
  writeJson(TASK_OUTBOX_KEY, items);
}

function notify() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TASKS_CHANGED_EVENT));
}

function nowIso() {
  return new Date().toISOString();
}

function taskFromCreate(item: OutboxCreate): Task {
  return {
    id: item.id,
    title: item.input.title,
    description: item.input.description ?? null,
    status: item.input.status ?? "todo",
    person_id: item.input.person_id || null,
    space_id: item.input.space_id || null,
    goal_id: item.input.goal_id || null,
    project_id: item.input.project_id || null,
    due_at: item.input.due_at ?? null,
    sort_order: item.input.sort_order ?? null,
    kind: item.input.kind ?? "task",
    activity_type: item.input.activity_type ?? null,
    value_score: item.input.value_score ?? null,
    estimate_minutes: item.input.estimate_minutes ?? null,
    importance: item.input.importance ?? 3,
    urgency: item.input.urgency ?? 3,
    assignee: item.input.assignee ?? "user",
    recurrence_frequency: item.input.recurrence_frequency ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
    completed_at: item.input.status === "done" ? nowIso() : null,
    pending_sync: true,
  };
}

export function createPayload(id: string, input: CreateTaskInput) {
  return {
    id,
    title: input.title,
    description: input.description,
    person_id: input.person_id || undefined,
    space_id: input.space_id || undefined,
    goal_id: input.goal_id || undefined,
    project_id: input.project_id || undefined,
    due_at: input.due_at,
    sort_order: input.sort_order,
    kind: input.kind,
    activity_type: input.activity_type,
    value_score: input.value_score,
    estimate_minutes: input.estimate_minutes,
    importance: input.importance,
    urgency: input.urgency,
    assignee: input.assignee,
    status: input.status,
    recurrence_frequency: input.recurrence_frequency,
  };
}

export function errorStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

export function shouldQueueTaskMutation(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const status = errorStatus(error);
  if (status === undefined) return true;
  return status !== 400 && status !== 409 && status !== 422;
}

export function upsertTask(list: Task[], task: Task): Task[] {
  const index = list.findIndex((item) => item.id === task.id);
  if (index === -1) return [task, ...list];
  return list.map((item, itemIndex) => (itemIndex === index ? task : item));
}

export function snapshotTasks(): Task[] {
  const cache = readCache().map((task) => ({ ...task, pending_sync: false }));
  const outbox = readOutbox();
  const byId = new Map<string, Task>(cache.map((task) => [task.id, task]));
  for (const item of outbox) {
    if (item.type === "create") {
      if (!byId.has(item.id)) byId.set(item.id, taskFromCreate(item));
      continue;
    }
    const current = byId.get(item.id);
    if (!current) continue;
    const next = { ...current, ...item.input, pending_sync: true, updated_at: nowIso() };
    if (item.input.status === "done") next.completed_at = next.completed_at || next.updated_at;
    if (item.input.status && item.input.status !== "done") next.completed_at = null;
    byId.set(item.id, next);
  }
  const pendingCreates = outbox
    .filter((item): item is OutboxCreate => item.type === "create")
    .map((item) => byId.get(item.id)!)
    .filter(Boolean);
  const pendingIds = new Set(pendingCreates.map((task) => task.id));
  const rest = [...byId.values()].filter((task) => !pendingIds.has(task.id));
  return [...pendingCreates, ...rest];
}

export function visibleTasks(fetched?: Task[]): Task[] {
  const snapshot = snapshotTasks();
  return snapshot.length > 0 ? snapshot : (fetched ?? []);
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function preferCachedTask(cached: Task, remote: Task): boolean {
  const cachedAt = timestampMs(cached.updated_at);
  const remoteAt = timestampMs(remote.updated_at);
  if (!Number.isFinite(cachedAt)) return false;
  if (!Number.isFinite(remoteAt)) return true;
  return cachedAt > remoteAt;
}

export function applyRemoteTasks(remote: Task[]): Task[] {
  const cachedById = new Map(readCache().map((task) => [task.id, task]));
  const merged = remote.map((task) => {
    const cached = cachedById.get(task.id);
    if (cached && preferCachedTask(cached, task)) return cached;
    return task;
  });
  const ids = new Set(remote.map((task) => task.id));
  writeCache(merged);
  writeOutbox(
    readOutbox().filter((item) => {
      if (item.type === "create" && ids.has(item.id)) return false;
      return true;
    }),
  );
  const snapshot = snapshotTasks();
  notify();
  return snapshot;
}

export function enqueueCreate(input: CreateTaskInput): Task {
  const id = newId();
  writeOutbox([...readOutbox(), { type: "create", id, input }]);
  const snapshot = snapshotTasks();
  notify();
  return snapshot.find((task) => task.id === id) ?? taskFromCreate({ type: "create", id, input });
}

export function hasPendingCreate(id: string) {
  return readOutbox().some((item) => item.type === "create" && item.id === id);
}

export function enqueuePatch(id: string, input: PatchTaskInput): Task | null {
  const outbox = readOutbox();
  const create = outbox.find(
    (item): item is OutboxCreate => item.type === "create" && item.id === id,
  );
  if (create) {
    create.input = { ...create.input, ...input };
    writeOutbox(outbox);
  } else {
    const existing = outbox.find(
      (item): item is OutboxPatch => item.type === "patch" && item.id === id,
    );
    if (existing) existing.input = { ...existing.input, ...input };
    else outbox.push({ type: "patch", id, input });
    writeOutbox(outbox);
  }
  notify();
  return snapshotTasks().find((task) => task.id === id) ?? null;
}

export function completeCreate(id: string, serverTask: Task) {
  writeOutbox(readOutbox().filter((item) => !(item.type === "create" && item.id === id)));
  writeCache(
    upsertTask(
      readCache().filter((task) => task.id !== id),
      { ...serverTask, pending_sync: false },
    ),
  );
  notify();
}

export function completePatch(id: string, serverTask: Task) {
  writeOutbox(readOutbox().filter((item) => !(item.type === "patch" && item.id === id)));
  const cached = readCache().find((task) => task.id === id);
  writeCache(
    upsertTask(readCache(), {
      ...serverTask,
      pending_sync: false,
      updated_at: serverTask.updated_at || cached?.updated_at || nowIso(),
    }),
  );
  notify();
}

export function dropCreate(id: string) {
  writeOutbox(readOutbox().filter((item) => !(item.type === "create" && item.id === id)));
  notify();
}

export function dropPatch(id: string) {
  writeOutbox(readOutbox().filter((item) => !(item.type === "patch" && item.id === id)));
  notify();
}

export function resetTaskSync() {
  memoryCache = [];
  memoryOutbox = [];
  try {
    localStorage.removeItem(TASK_CACHE_KEY);
    localStorage.removeItem(TASK_OUTBOX_KEY);
  } catch {
    // Tests and private browsing should still be able to reset in-memory state.
  }
}

async function pushOutbox(transport: TaskTransport) {
  for (const item of readOutbox()) {
    if (item.type === "create") {
      try {
        const created = await transport.request<Task>("/api/tasks", {
          method: "POST",
          body: JSON.stringify(createPayload(item.id, item.input)),
        });
        completeCreate(item.id, created);
      } catch (error) {
        const status = errorStatus(error);
        if (status === 409) {
          completeCreate(item.id, {
            ...taskFromCreate(item),
            pending_sync: false,
          });
          continue;
        }
        if (shouldQueueTaskMutation(error)) return;
        dropCreate(item.id);
      }
      continue;
    }
    if (hasPendingCreate(item.id)) continue;
    try {
      const updated = await transport.request<Task>(`/api/tasks/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify(item.input),
      });
      completePatch(item.id, updated);
    } catch (error) {
      if (shouldQueueTaskMutation(error)) return;
      dropPatch(item.id);
    }
  }
}

export function queueTaskFlush(transport: TaskTransport, options: { refresh?: boolean } = {}) {
  const run = () => {
    if (readOutbox().length === 0 && !options.refresh) return;
    void flushTaskOutbox(transport, options);
  };
  if (flushing) void flushing.finally(run);
  else run();
}

export async function flushTaskOutbox(
  transport: TaskTransport,
  options: { refresh?: boolean } = {},
) {
  if (flushing) return flushing;
  flushing = (async () => {
    if (isOfflineNow()) return;
    const pending = readOutbox();
    if (pending.length) await pushOutbox(transport);
    if (options.refresh || pending.length) {
      try {
        applyRemoteTasks(await transport.request<Task[]>("/api/tasks"));
      } catch {
        notify();
      }
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export function startTaskSync(transport: TaskTransport): () => void {
  const pull = () => queueTaskFlush(transport, { refresh: true });
  const onOnline = () => pull();
  const onFocus = () => pull();
  const onVisible = () => {
    if (document.visibilityState === "visible") pull();
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisible);
  pull();
  const timer = window.setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    pull();
  }, LIVE_REFRESH_MS);
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}

export function subscribeTaskSnapshot(listener: (tasks: Task[]) => void) {
  const handler = () => listener(snapshotTasks());
  window.addEventListener(TASKS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(TASKS_CHANGED_EVENT, handler);
}

export function isOfflineNow() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
