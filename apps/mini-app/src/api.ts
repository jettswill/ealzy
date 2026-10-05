import type {
  ApiEnvelope,
  CompanionReply,
  ConversationMessage,
  Experience,
  GuidedIntroReply,
  ExperienceStatus,
  Goal,
  Memory,
  MemoryCategory,
  Person,
  PersonDate,
  PersonDetail,
  PersonLocation,
  Project,
  Recommendation,
  RecommendationOutcome,
  Reflection,
  Session,
  SelfProfile,
  SelfPromise,
  SelfPromiseCheckin,
  SelfPromiseCheckinStatus,
  Space,
  Task,
  TaskStatus,
  MailAccount,
  MailDraft,
  MailMessage,
  MailPlaybook,
  Note,
  NoteActionDraft,
  NoteActionKind,
  NoteActionResult,
  CompletenessReport,
  ImportSession,
  UsageSummary,
} from "./types";
import {
  createLocalNote,
  deleteLocalNote,
  getLocalNote,
  listLocalNotes,
  restoreLocalNote,
  saveLocalNote,
} from "./note-store";
import { queueNoteFlush } from "./note-sync";
import {
  applyRemoteTasks,
  enqueueCreate,
  enqueuePatch,
  isOfflineNow,
  queueTaskFlush,
  snapshotTasks,
  type CreateTaskInput,
  type PatchTaskInput,
} from "./task-sync";
import { trackEventOnce } from "./analytics";

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
export const REQUEST_TIMEOUT_MS = 8_000;
export const COMPANION_TIMEOUT_MS = 90_000;
// Единственное место, где формулируется сетевая ошибка. Интерфейс русский —
// английская строка посреди него читалась как чужая техническая ошибка.
export const NETWORK_ERROR_MESSAGE = "Не получается связаться с Ealzy. Проверьте связь.";

type RequestOptions = RequestInit & { timeoutMs?: number };
export type CompanionAnswerDelta = (answer: string) => void;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Запрос отменил сам интерфейс (размонтировался экран, пришёл более свежий
 * запрос). Раньше это попадало в общий catch и превращалось в «Что-то пошло не
 * так» — приложение показывало ошибку сети на ровном месте, потому что само же
 * отменило свой дубликат. Такие ошибки экраны обязаны игнорировать.
 */
export class ApiAbortError extends ApiError {
  constructor() {
    super("Request aborted", 0, "ABORTED");
    this.name = "ApiAbortError";
  }
}

export function isAbortError(error: unknown) {
  return (
    error instanceof ApiAbortError ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function unwrap<T>(payload: ApiEnvelope<T>): T {
  return typeof payload === "object" && payload !== null && "data" in payload
    ? (payload as { data: T }).data
    : (payload as T);
}

async function parseError(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`;
  let code: string | undefined;
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await response.json()) as {
      error?: string | { message?: string; code?: string };
      message?: string;
      details?: Record<string, unknown>;
      note?: unknown;
      server_note?: unknown;
    };
    if (typeof body.error === "string") message = body.error;
    else if (body.error?.message) message = body.error.message;
    else if (body.message) message = body.message;
    code = typeof body.error === "object" ? body.error.code : undefined;
    details =
      body.details ??
      (typeof body.error === "object" && body.error && "details" in body.error
        ? (body.error as { details?: Record<string, unknown> }).details
        : undefined);
    if (!details && body.note && typeof body.note === "object") details = { note: body.note };
    if (!details && body.server_note && typeof body.server_note === "object") {
      details = { server_note: body.server_note };
    }
  } catch {
    // Keep the status-based fallback for non-JSON responses.
  }
  return new ApiError(message, response.status, code, details);
}

function applyCompanionSseFrame(
  frame: string,
  onAnswerDelta: CompanionAnswerDelta | undefined,
  state: { reply?: CompanionReply; error?: string },
) {
  const line = frame.split("\n").find((item) => item.startsWith("data:"));
  if (!line) return;
  let payload: {
    type?: string;
    answer?: string;
    data?: CompanionReply;
    error?: string;
  };
  try {
    payload = JSON.parse(line.replace(/^data:\s*/, "")) as typeof payload;
  } catch {
    return;
  }
  if (payload.type === "delta" && typeof payload.answer === "string") {
    onAnswerDelta?.(payload.answer);
  } else if (payload.type === "done" && payload.data) {
    state.reply = payload.data;
  } else if (payload.type === "error") {
    state.error = payload.error || "Stream failed";
  }
}

export async function consumeCompanionSse(
  response: Response,
  onAnswerDelta?: CompanionAnswerDelta,
): Promise<CompanionReply> {
  if (!response.body) throw new ApiError("Empty stream", 502);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state: { reply?: CompanionReply; error?: string } = {};
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      if (buffer.trim()) applyCompanionSseFrame(buffer, onAnswerDelta, state);
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) applyCompanionSseFrame(frame, onAnswerDelta, state);
  }
  if (state.error) throw new ApiError(state.error, 502);
  if (!state.reply) throw new ApiError("Stream ended without a reply", 502);
  return state.reply;
}

export class ApiClient {
  constructor(
    private readonly getToken: () => string | null,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  // Один переход по вкладкам поднимал по 4–6 одинаковых GET /api/me и /api/tasks:
  // их запрашивают и макет, и экран, и хуки. Лишние запросы тратят и батарею, и
  // лимиты, а отменённые дубликаты ещё и приводили к экрану ошибки. Пока
  // одинаковый GET в полёте — отдаём всем один и тот же промис.
  private readonly inflight = new Map<string, Promise<unknown>>();

  async request<T>(path: string, init: RequestOptions = {}, authenticated = true): Promise<T> {
    const method = (init.method ?? "GET").toUpperCase();
    const shareKey =
      method === "GET" && !init.signal && !init.body ? `${authenticated ? "a" : "p"}:${path}` : "";
    if (shareKey) {
      const running = this.inflight.get(shareKey) as Promise<T> | undefined;
      if (running) return running;
    }
    const run = this.performRequest<T>(path, init, authenticated);
    if (shareKey) {
      this.inflight.set(shareKey, run);
      const cleanup = () => {
        if (this.inflight.get(shareKey) === run) this.inflight.delete(shareKey);
      };
      run.then(cleanup, cleanup);
    }
    return run;
  }

  private async performRequest<T>(
    path: string,
    init: RequestOptions = {},
    authenticated = true,
  ): Promise<T> {
    const { timeoutMs = REQUEST_TIMEOUT_MS, signal: callerSignal, ...fetchInit } = init;
    const headers = new Headers(fetchInit.headers);
    headers.set("Accept", "application/json");
    if (fetchInit.body) headers.set("Content-Type", "application/json");
    if (authenticated) {
      const token = this.getToken();
      if (!token) throw new ApiError("Authentication required", 401, "NO_SESSION");
      headers.set("Authorization", `Bearer ${token}`);
    }

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      const run = typeof this.fetcher === "function" ? this.fetcher.bind(globalThis) : fetch;
      response = await run(`${API_BASE}${path}`, {
        ...fetchInit,
        headers,
        signal: controller.signal,
      });
    } catch {
      if (callerSignal?.aborted) throw new ApiAbortError();
      throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw await parseError(response);
    if (response.status === 204) return undefined as T;
    return unwrap((await response.json()) as ApiEnvelope<T>);
  }

  private async streamCompanion(
    path: string,
    body: unknown,
    onAnswerDelta?: CompanionAnswerDelta,
  ): Promise<CompanionReply> {
    const headers = new Headers();
    headers.set("Accept", "text/event-stream");
    headers.set("Content-Type", "application/json");
    const token = this.getToken();
    if (!token) throw new ApiError("Authentication required", 401, "NO_SESSION");
    headers.set("Authorization", `Bearer ${token}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COMPANION_TIMEOUT_MS);
    const jsonPath = path.replace(/\/stream$/, "");
    try {
      const run = typeof this.fetcher === "function" ? this.fetcher.bind(globalThis) : fetch;
      const response = await run(`${API_BASE}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 404 || response.status === 405) {
        const reply = await this.request<CompanionReply>(jsonPath, {
          method: "POST",
          body: JSON.stringify(body),
          timeoutMs: COMPANION_TIMEOUT_MS,
        });
        const text = reply.assistant_message?.content ?? reply.message?.content;
        if (onAnswerDelta && text) onAnswerDelta(text);
        return reply;
      }
      if (!response.ok) throw await parseError(response);
      const type = response.headers.get("content-type") ?? "";
      if (type.includes("application/json")) {
        const reply = unwrap((await response.json()) as ApiEnvelope<CompanionReply>);
        const text = reply.assistant_message?.content ?? reply.message?.content;
        if (onAnswerDelta && text) onAnswerDelta(text);
        return reply;
      }
      return await consumeCompanionSse(response, onAnswerDelta);
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
    } finally {
      clearTimeout(timeout);
    }
  }

  exchangeTelegram(initData: string, timezone?: string): Promise<Session> {
    return this.request<Session>(
      "/api/auth/telegram",
      { method: "POST", body: JSON.stringify({ initData, timezone }) },
      false,
    );
  }

  exchangeGuest(timezone?: string, locale?: string): Promise<Session> {
    return this.request<Session>(
      "/api/auth/guest",
      { method: "POST", body: JSON.stringify({ timezone, locale }) },
      false,
    );
  }

  loginWithTelegram(payload: Record<string, string | number>): Promise<Session> {
    return this.request<Session>(
      "/api/auth/telegram-login",
      { method: "POST", body: JSON.stringify(payload) },
      false,
    );
  }

  refreshSession(): Promise<Session> {
    return this.request<Session>("/api/auth/refresh", { method: "POST" });
  }

  dailyDigest(): Promise<{ kind: string; text: string; generated_at: string }> {
    return this.request("/api/digest/today");
  }

  exchangeEmail(accessToken: string, timezone?: string): Promise<Session> {
    return this.exchangeOAuth(accessToken, timezone);
  }

  exchangeOAuth(accessToken: string, timezone?: string): Promise<Session> {
    return this.request<Session>(
      "/api/auth/oauth/exchange",
      { method: "POST", body: JSON.stringify({ access_token: accessToken, timezone }) },
      false,
    );
  }

  reportClientContext(timezone: string): Promise<{ timezone: boolean; morning_digest: boolean }> {
    return this.request("/api/me/client-context", {
      method: "POST",
      body: JSON.stringify({ timezone }),
    });
  }

  linkEmail(accessToken: string): Promise<void> {
    return this.linkOAuth(accessToken);
  }

  linkOAuth(accessToken: string): Promise<void> {
    return this.request<void>("/api/auth/oauth/link", {
      method: "POST",
      body: JSON.stringify({ access_token: accessToken }),
    });
  }

  linkTelegram(payload: Record<string, string | number>): Promise<void> {
    return this.request<void>("/api/auth/telegram/link", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  people(search?: string): Promise<Person[]> {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    return this.request(`/api/people${query}`);
  }

  person(id: string): Promise<PersonDetail> {
    return this.request(`/api/people/${id}`);
  }

  createPerson(
    input: Pick<Person, "name"> & Partial<Pick<Person, "relationship" | "description">>,
  ) {
    return this.request<Person>("/api/people", { method: "POST", body: JSON.stringify(input) });
  }

  updatePerson(id: string, input: Partial<Pick<Person, "name" | "relationship" | "description">>) {
    return this.request<Person>(`/api/people/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deletePerson(id: string) {
    return this.request<void>(`/api/people/${id}`, { method: "DELETE" });
  }

  locations(personId: string): Promise<PersonLocation[]> {
    return this.request(`/api/people/${personId}/locations`);
  }

  createLocation(
    personId: string,
    input: Pick<PersonLocation, "city"> &
      Partial<Pick<PersonLocation, "label" | "address" | "is_primary">>,
  ) {
    return this.request<PersonLocation>(`/api/people/${personId}/locations`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateLocation(
    id: string,
    input: Partial<Pick<PersonLocation, "label" | "city" | "address" | "is_primary">>,
  ) {
    return this.request<PersonLocation>(`/api/locations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteLocation(id: string) {
    return this.request<void>(`/api/locations/${id}`, { method: "DELETE" });
  }

  dates(personId: string): Promise<PersonDate[]> {
    return this.request(`/api/people/${personId}/dates`);
  }

  createDate(
    personId: string,
    input: Pick<PersonDate, "kind" | "month" | "day"> &
      Partial<Pick<PersonDate, "label" | "year">>,
  ) {
    return this.request<PersonDate>(`/api/people/${personId}/dates`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateDate(
    id: string,
    input: Partial<Pick<PersonDate, "kind" | "label" | "month" | "day" | "year">>,
  ) {
    return this.request<PersonDate>(`/api/dates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteDate(id: string) {
    return this.request<void>(`/api/dates/${id}`, { method: "DELETE" });
  }

  createMemory(
    personId: string,
    input: { content: string; category: MemoryCategory; importance?: number; confidence?: number },
  ) {
    return this.request<Memory>(`/api/people/${personId}/memories`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateMemory(
    id: string,
    input: Partial<Pick<Memory, "content" | "category" | "importance" | "confidence">>,
  ) {
    return this.request<Memory>(`/api/memories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteMemory(id: string) {
    return this.request<void>(`/api/memories/${id}`, { method: "DELETE" });
  }

  async tasks(): Promise<Task[]> {
    if (isOfflineNow()) return snapshotTasks();
    try {
      return applyRemoteTasks(await this.request<Task[]>("/api/tasks"));
    } catch {
      return snapshotTasks();
    }
  }

  async createTask(input: CreateTaskInput) {
    const local = enqueueCreate(input);
    trackEventOnce("first_task", { source: "create" });
    queueTaskFlush(this);
    return local;
  }

  brainDump(text: string) {
    trackEventOnce("first_task", { source: "brain_dump" });
    return this.request<{ tasks: Task[]; promise: SelfPromise | null; skipped: boolean }>(
      "/api/me/brain-dump",
      { method: "POST", body: JSON.stringify({ text }) },
    );
  }

  async updateTask(id: string, input: PatchTaskInput) {
    const optimistic = enqueuePatch(id, input);
    queueTaskFlush(this);
    return optimistic ?? ({ id, ...input } as Task);
  }

  setTaskStatus(id: string, status: TaskStatus) {
    return this.updateTask(id, { status });
  }

  notes(userId: string, includeDeleted = false) {
    return listLocalNotes(userId, includeDeleted);
  }

  note(userId: string, id: string) {
    return getLocalNote(userId, id);
  }

  async createNote(userId: string) {
    const note = await createLocalNote(userId);
    queueNoteFlush(userId, this);
    return note;
  }

  async updateNote(userId: string, note: Note) {
    const saved = await saveLocalNote(userId, note);
    queueNoteFlush(userId, this);
    return saved;
  }

  async deleteNote(userId: string, id: string) {
    const deleted = await deleteLocalNote(userId, id);
    queueNoteFlush(userId, this, true);
    return deleted;
  }

  async restoreNote(userId: string, id: string) {
    const restored = await restoreLocalNote(userId, id);
    queueNoteFlush(userId, this, true);
    return restored;
  }

  async previewNoteAction(id: string, action: NoteActionKind) {
    const response = await this.request<{
      id: string;
      note_id: string;
      proposal: Record<string, unknown>;
      confirmed_at?: string | null;
    }>(`/api/notes/${id}/actions/preview`, {
      method: "POST",
      body: JSON.stringify({
        instruction:
          action === "plan"
            ? "Создай новый план по этой заметке"
            : action === "goal"
              ? "Создай цель по этой заметке"
              : "Создай задачи по этой заметке",
      }),
    });
    return noteActionDraftFromServer(response);
  }

  async confirmNoteAction(draft: NoteActionDraft): Promise<NoteActionResult> {
    const response = await this.request<{
      id: string;
      note_id: string;
      proposal: Record<string, unknown>;
      result?: Record<string, unknown> | null;
      confirmed_at?: string | null;
    }>(`/api/note-actions/${draft.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ proposal: noteActionProposalFromDraft(draft) }),
    });
    const confirmed = noteActionDraftFromServer(response);
    const result = response.result ?? {};
    const entities = [];
    if (typeof result.goal_id === "string" && confirmed.payload.goal) {
      entities.push({
        type: "goal" as const,
        id: result.goal_id,
        label: confirmed.payload.goal.title,
        url: `/goals/${result.goal_id}`,
      });
    }
    const taskIds = Array.isArray(result.task_ids)
      ? result.task_ids.filter((value): value is string => typeof value === "string")
      : [];
    taskIds.forEach((taskId, index) => {
      entities.push({
        type: "task" as const,
        id: taskId,
        label: confirmed.payload.tasks?.[index]?.title ?? "Task",
        url: "/tasks",
      });
    });
    return { draft: confirmed, entities };
  }

  spaces(): Promise<Space[]> {
    return this.request("/api/spaces");
  }

  space(id: string): Promise<Space> {
    return this.request(`/api/spaces/${id}`);
  }

  createSpace(input: { name: string; context?: string; type?: string }) {
    return this.request<Space>("/api/spaces", { method: "POST", body: JSON.stringify(input) });
  }

  updateSpace(id: string, input: Partial<Pick<Space, "name" | "context" | "type">>) {
    return this.request<Space>(`/api/spaces/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  addSpacePerson(spaceId: string, personId: string) {
    return this.request<void>(`/api/spaces/${spaceId}/people`, {
      method: "POST",
      body: JSON.stringify({ person_id: personId }),
    });
  }

  removeSpacePerson(spaceId: string, personId: string) {
    return this.request<void>(`/api/spaces/${spaceId}/people`, {
      method: "DELETE",
      body: JSON.stringify({ person_id: personId }),
    });
  }

  recommendations(): Promise<Recommendation[]> {
    return this.request("/api/recommendations");
  }

  recommendation(id: string): Promise<Recommendation> {
    return this.request(`/api/recommendations/${id}`);
  }

  me(): Promise<SelfProfile> {
    return this.request("/api/me");
  }

  updateMe(
    input: Partial<
      Pick<
        SelfProfile,
        | "bio"
        | "values"
        | "communication_style"
        | "timezone"
        | "locale"
        | "weekly_reflection_enabled"
        | "morning_digest_enabled"
        | "morning_digest_time"
        | "weekly_digest_enabled"
        | "weekly_digest_time"
        | "evening_sync_enabled"
        | "evening_sync_time"
        | "onboarding_completed_at"
      >
    >,
  ) {
    return this.request<SelfProfile>("/api/me", {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  trackEvents(events: { name: string; properties?: Record<string, unknown> }[]) {
    return this.request<{ tracked: number }>("/api/events", {
      method: "POST",
      body: JSON.stringify({ events }),
    });
  }

  profileCompleteness(): Promise<CompletenessReport> {
    return this.request("/api/profile/completeness");
  }

  billingUsage(): Promise<UsageSummary> {
    return this.request("/api/billing/usage");
  }

  importTodoistStatus(): Promise<{ oauth: boolean }> {
    return this.request("/api/import/todoist/status");
  }

  importTodoistStart(): Promise<{ url: string }> {
    return this.request("/api/import/todoist/start");
  }

  previewTodoistImport(token: string): Promise<ImportSession> {
    return this.request("/api/import/todoist/preview", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  previewTextImport(text: string): Promise<ImportSession> {
    return this.request("/api/import/text/preview", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  }

  importSession(id: string): Promise<ImportSession> {
    return this.request(`/api/import/${id}`);
  }

  confirmImport(id: string, skipIds: string[] = []): Promise<ImportSession> {
    return this.request(`/api/import/${id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ skip_ids: skipIds }),
    });
  }

  exportAccount(): Promise<Record<string, unknown>> {
    return this.request("/api/account/export");
  }

  deleteAccount(): Promise<void> {
    return this.request("/api/account", { method: "DELETE" });
  }

  selfMemories(): Promise<Memory[]> {
    return this.request("/api/me/memories");
  }

  createSelfMemory(
    input: Pick<Memory, "content" | "category"> &
      Partial<Pick<Memory, "importance" | "confidence">>,
  ) {
    return this.request<Memory>("/api/me/memories", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateSelfMemory(
    id: string,
    input: Partial<Pick<Memory, "content" | "category" | "importance" | "confidence">>,
  ) {
    return this.request<Memory>(`/api/me/memories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteSelfMemory(id: string) {
    return this.request<void>(`/api/me/memories/${id}`, { method: "DELETE" });
  }

  selfLocations(): Promise<PersonLocation[]> {
    return this.request("/api/me/locations");
  }

  createSelfLocation(
    input: Pick<PersonLocation, "city"> &
      Partial<Pick<PersonLocation, "label" | "address" | "is_primary">>,
  ) {
    return this.request<PersonLocation>("/api/me/locations", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateSelfLocation(
    id: string,
    input: Partial<Pick<PersonLocation, "label" | "city" | "address" | "is_primary">>,
  ) {
    return this.request<PersonLocation>(`/api/me/locations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteSelfLocation(id: string) {
    return this.request<void>(`/api/me/locations/${id}`, { method: "DELETE" });
  }

  conversationMessages(id: string): Promise<ConversationMessage[]> {
    return this.request(`/api/conversations/${id}/messages`);
  }

  async sendCompanionMessage(
    content: string,
    onAnswerDelta?: CompanionAnswerDelta,
  ): Promise<CompanionReply> {
    const reply = onAnswerDelta
      ? await this.streamCompanion(
          "/api/companion/messages/stream",
          { content, source_channel: "mini_app" },
          onAnswerDelta,
        )
      : await this.request<CompanionReply>("/api/companion/messages", {
          method: "POST",
          body: JSON.stringify({ content, source_channel: "mini_app" }),
          timeoutMs: COMPANION_TIMEOUT_MS,
        });
    trackEventOnce("first_companion", { source: "message" });
    return reply;
  }

  async retryCompanionMessage(onAnswerDelta?: CompanionAnswerDelta): Promise<CompanionReply> {
    if (onAnswerDelta) {
      return this.streamCompanion(
        "/api/companion/messages/retry/stream",
        { source_channel: "mini_app" },
        onAnswerDelta,
      );
    }
    return this.request<CompanionReply>("/api/companion/messages/retry", {
      method: "POST",
      body: JSON.stringify({ source_channel: "mini_app" }),
      timeoutMs: COMPANION_TIMEOUT_MS,
    });
  }

  async guidedIntro(answer?: string): Promise<GuidedIntroReply> {
    const result = await this.request<GuidedIntroReply>("/api/companion/guided-intro", {
      method: "POST",
      body: JSON.stringify(answer ? { answer } : {}),
      timeoutMs: COMPANION_TIMEOUT_MS,
    });
    if (answer) trackEventOnce("first_companion", { source: "guided_intro" });
    return result;
  }

  goals(): Promise<Goal[]> {
    return this.request("/api/goals");
  }

  goal(id: string): Promise<Goal> {
    return this.request(`/api/goals/${id}`);
  }

  createGoal(input: Pick<Goal, "title"> & Partial<Omit<Goal, "id" | "title">>) {
    return this.request<Goal>("/api/goals", { method: "POST", body: JSON.stringify(input) });
  }

  updateGoal(id: string, input: Partial<Omit<Goal, "id">>) {
    return this.request<Goal>(`/api/goals/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteGoal(id: string) {
    return this.request<void>(`/api/goals/${id}`, { method: "DELETE" });
  }

  promises(): Promise<SelfPromise[]> {
    return this.request("/api/promises");
  }

  createPromise(input: Pick<SelfPromise, "title"> & Partial<Omit<SelfPromise, "id" | "title">>) {
    return this.request<SelfPromise>("/api/promises", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updatePromise(id: string, input: Partial<Omit<SelfPromise, "id">>) {
    return this.request<SelfPromise>(`/api/promises/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deletePromise(id: string) {
    return this.request<void>(`/api/promises/${id}`, { method: "DELETE" });
  }

  checkInPromise(id: string, input: { status: SelfPromiseCheckinStatus; note?: string }) {
    return this.request<{ checkin: SelfPromiseCheckin; promise: SelfPromise }>(
      `/api/promises/${id}/checkins`,
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  projects(): Promise<Project[]> {
    return this.request("/api/projects");
  }

  createProject(input: Pick<Project, "name"> & Partial<Omit<Project, "id" | "name">>) {
    return this.request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateProject(id: string, input: Partial<Omit<Project, "id">>) {
    return this.request<Project>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteProject(id: string) {
    return this.request<void>(`/api/projects/${id}`, { method: "DELETE" });
  }

  sendRecommendationFeedback(
    id: string,
    itemIndex: number,
    outcome: RecommendationOutcome,
    note?: string,
  ) {
    return this.request<void>(`/api/recommendations/${id}/feedback`, {
      method: "POST",
      body: JSON.stringify({ item_index: itemIndex, outcome, note }),
    });
  }

  reflections(): Promise<Reflection[]> {
    return this.request("/api/reflections");
  }

  createWeeklyReflection(): Promise<Reflection> {
    return this.request("/api/reflections/weekly", { method: "POST" });
  }

  experiences(
    filters: { personId?: string; self?: boolean; limit?: number } = {},
  ): Promise<Experience[]> {
    const query = new URLSearchParams();
    if (filters.personId) query.set("person_id", filters.personId);
    if (filters.self) query.set("self", "true");
    if (filters.limit) query.set("limit", String(filters.limit));
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request(`/api/experiences${suffix}`);
  }

  experience(id: string): Promise<Experience> {
    return this.request(`/api/experiences/${id}`);
  }

  createExperience(
    input: Omit<Experience, "id" | "owner_id" | "created_at" | "updated_at" | "participants">,
  ) {
    return this.request<Experience>("/api/experiences", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateExperience(id: string, input: Partial<Omit<Experience, "id">>) {
    return this.request<Experience>(`/api/experiences/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteExperience(id: string) {
    return this.request<void>(`/api/experiences/${id}`, { method: "DELETE" });
  }

  followUpExperience(id: string, status: ExperienceStatus): Promise<Experience> {
    return this.updateExperience(id, { status });
  }

  dueExperienceFollowUps(): Promise<Experience[]> {
    return this.request("/api/experiences/follow-ups/due");
  }

  mailAccounts(): Promise<MailAccount[]> {
    return this.request("/api/mail/accounts");
  }

  connectMail(input: {
    email: string;
    password: string;
    provider?: MailAccount["provider"];
    username?: string;
    imap_host?: string;
    imap_port?: number;
    smtp_host?: string;
    smtp_port?: number;
  }) {
    return this.request<MailAccount>("/api/mail/accounts", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  syncMail(id: string) {
    return this.request<{ synced: number }>(`/api/mail/accounts/${id}/sync`, { method: "POST" });
  }

  syncMyMail() {
    return this.request<{ synced: number; failed: number; total: number }>("/api/mail/sync", {
      method: "POST",
    });
  }

  disconnectMail(id: string) {
    return this.request<void>(`/api/mail/accounts/${id}`, { method: "DELETE" });
  }

  mailMessages(): Promise<MailMessage[]> {
    return this.request("/api/mail/messages");
  }

  markMailHandled(id: string) {
    return this.request<MailMessage>(`/api/mail/messages/${id}/handled`, { method: "POST" });
  }

  draftMailReply(id: string, input: { body?: string; subject?: string } = {}) {
    return this.request<MailDraft>(`/api/mail/messages/${id}/draft`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  createMailTask(id: string) {
    return this.request<Task>(`/api/mail/messages/${id}/task`, { method: "POST" });
  }

  mailDrafts(): Promise<MailDraft[]> {
    return this.request("/api/mail/drafts");
  }

  updateMailDraft(id: string, input: Partial<Pick<MailDraft, "to_address" | "subject" | "body">>) {
    return this.request<MailDraft>(`/api/mail/drafts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  sendMailDraft(id: string) {
    return this.request<MailDraft>(`/api/mail/drafts/${id}/send`, { method: "POST" });
  }

  deleteMailDraft(id: string) {
    return this.request<void>(`/api/mail/drafts/${id}`, { method: "DELETE" });
  }

  mailPlaybooks(): Promise<MailPlaybook[]> {
    return this.request("/api/mail/playbooks");
  }

  createMailPlaybook(input: {
    name: string;
    trigger: MailPlaybook["trigger"];
    actions: MailPlaybook["actions"];
    prompt?: string | null;
    enabled?: boolean;
  }) {
    return this.request<MailPlaybook>("/api/mail/playbooks", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateMailPlaybook(
    id: string,
    input: Partial<Pick<MailPlaybook, "enabled" | "prompt" | "name" | "actions">>,
  ) {
    return this.request<MailPlaybook>(`/api/mail/playbooks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  }

  deleteMailPlaybook(id: string) {
    return this.request<void>(`/api/mail/playbooks/${id}`, { method: "DELETE" });
  }
}

function noteActionDraftFromServer(action: {
  id: string;
  note_id: string;
  proposal: Record<string, unknown>;
  confirmed_at?: string | null;
}): NoteActionDraft {
  const kind =
    action.proposal.kind === "plan" || action.proposal.kind === "goal"
      ? action.proposal.kind
      : "tasks";
  const goal =
    kind === "plan"
      ? {
          title: typeof action.proposal.title === "string" ? action.proposal.title : "",
          description:
            typeof action.proposal.description === "string" ? action.proposal.description : null,
          current_plan:
            typeof action.proposal.current_plan === "string" ? action.proposal.current_plan : "",
        }
      : action.proposal.goal && typeof action.proposal.goal === "object"
        ? (action.proposal.goal as NoteActionDraft["payload"]["goal"])
        : undefined;
  const tasks = Array.isArray(action.proposal.tasks)
    ? (action.proposal.tasks as NonNullable<NoteActionDraft["payload"]["tasks"]>)
    : undefined;
  return {
    id: action.id,
    note_id: action.note_id,
    action: kind,
    payload: { goal, tasks },
    confirmed_at: action.confirmed_at,
  };
}

function noteActionProposalFromDraft(draft: NoteActionDraft) {
  if (draft.action === "goal") return { kind: "goal", goal: draft.payload.goal };
  if (draft.action === "plan") {
    return {
      kind: "plan",
      title: draft.payload.goal?.title,
      description: draft.payload.goal?.description,
      current_plan: draft.payload.goal?.current_plan,
      tasks: draft.payload.tasks ?? [],
    };
  }
  return { kind: "tasks", tasks: draft.payload.tasks ?? [] };
}
