import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { AppRepository } from "../../repository.js";
import { HttpError } from "../../middleware.js";
import type { ImportItem, ImportSession, Task } from "../../types.js";
import { profileCompleteness, type CompletenessReport } from "./completeness.js";
import { parseTaskText } from "./text.js";
import {
  createTodoistGateway,
  todoistConfigured,
  todoistDueAt,
  todoistImportance,
  todoistRedirectUri,
  type TodoistGateway,
  type TodoistOAuthEnv,
  type TodoistProject,
  type TodoistTask,
} from "./todoist.js";

function key(secret: string) {
  return new TextEncoder().encode(secret);
}

function normalizeTitle(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function dueKey(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 10);
}

export function publicImportSession(session: ImportSession) {
  const { access_token: _token, ...rest } = session;
  return rest;
}

export function markDuplicates(
  items: ImportItem[],
  existingTasks: Task[],
  existingProjectNames: Set<string>,
): ImportItem[] {
  const seen = new Set(
    existingTasks.map((task) => `${normalizeTitle(task.title)}|${dueKey(task.due_at)}`),
  );
  return items.map((item) => {
    if (item.kind === "project") {
      return { ...item, duplicate: existingProjectNames.has(normalizeTitle(item.title)) };
    }
    const stamp = `${normalizeTitle(item.title)}|${dueKey(item.due_at)}`;
    return { ...item, duplicate: seen.has(stamp) };
  });
}

export function itemsFromText(text: string, now: Date, timeZone: string): ImportItem[] {
  return parseTaskText(text, now, timeZone).map((task) => ({
    id: randomUUID(),
    kind: "task" as const,
    title: task.title,
    due_at: task.due_at,
    importance: task.importance,
    project_title: null,
    source_id: null,
    duplicate: false,
  }));
}

export function itemsFromTodoist(projects: TodoistProject[], tasks: TodoistTask[]): ImportItem[] {
  const projectName = new Map(projects.map((project) => [project.id, project.name]));
  const projectItems: ImportItem[] = projects
    .filter((project) => !project.is_inbox_project)
    .map((project) => ({
      id: randomUUID(),
      kind: "project" as const,
      title: project.name,
      due_at: null,
      importance: null,
      project_title: null,
      source_id: project.id,
      duplicate: false,
    }));
  const taskItems: ImportItem[] = tasks
    .filter((task) => !task.is_completed)
    .map((task) => {
      const parent = task.project_id ? projectName.get(task.project_id) : null;
      const inbox = projects.find((project) => project.id === task.project_id)?.is_inbox_project;
      return {
        id: randomUUID(),
        kind: "task" as const,
        title: task.content,
        due_at: todoistDueAt(task),
        importance: todoistImportance(task.priority),
        project_title: inbox ? null : (parent ?? null),
        source_id: task.id,
        duplicate: false,
      };
    });
  return [...projectItems, ...taskItems];
}

export async function previewTextImport(
  repository: AppRepository,
  ownerId: string,
  text: string,
  timeZone: string,
  now = new Date(),
) {
  const existing = await repository.listTasks(ownerId);
  const items = markDuplicates(itemsFromText(text, now, timeZone), existing, new Set());
  if (!items.length) throw new HttpError(400, "EMPTY_IMPORT", "Nothing to import");
  return repository.createImportSession(ownerId, {
    source: "text",
    items,
  });
}

export async function previewTodoistImport(
  repository: AppRepository,
  ownerId: string,
  token: string,
  todoist: TodoistGateway = createTodoistGateway(),
) {
  const [projects, tasks, existingTasks, existingProjects] = await Promise.all([
    todoist.listProjects(token),
    todoist.listTasks(token),
    repository.listTasks(ownerId),
    repository.listProjects(ownerId),
  ]);
  const items = markDuplicates(
    itemsFromTodoist(projects, tasks),
    existingTasks,
    new Set(existingProjects.map((project) => normalizeTitle(project.name))),
  );
  if (!items.length) throw new HttpError(400, "EMPTY_IMPORT", "Nothing to import");
  return repository.createImportSession(ownerId, {
    source: "todoist",
    items,
    access_token: token,
  });
}

export async function confirmImport(
  repository: AppRepository,
  ownerId: string,
  sessionId: string,
  skipIds: string[] = [],
) {
  const session = await repository.getImportSession(ownerId, sessionId);
  if (!session) throw new HttpError(404, "NOT_FOUND", "Import not found");
  if (session.status !== "preview") {
    throw new HttpError(409, "IMPORT_ALREADY_CONFIRMED", "This import was already confirmed");
  }
  const skip = new Set(skipIds);
  const existingTasks = await repository.listTasks(ownerId);
  const existingProjects = await repository.listProjects(ownerId);
  const projectIds = new Map(
    existingProjects.map((project) => [normalizeTitle(project.name), project.id]),
  );
  let created_projects = 0;
  let created_tasks = 0;
  let skipped_duplicates = 0;

  for (const item of session.items) {
    if (item.kind !== "project" || skip.has(item.id)) continue;
    if (item.duplicate || projectIds.has(normalizeTitle(item.title))) {
      skipped_duplicates += 1;
      continue;
    }
    const created = await repository.createProject(ownerId, { name: item.title });
    projectIds.set(normalizeTitle(item.title), created.id);
    created_projects += 1;
  }

  for (const item of session.items) {
    if (item.kind !== "task" || skip.has(item.id)) continue;
    if (item.duplicate) {
      skipped_duplicates += 1;
      continue;
    }
    const stamp = `${normalizeTitle(item.title)}|${dueKey(item.due_at)}`;
    if (
      existingTasks.some((task) => `${normalizeTitle(task.title)}|${dueKey(task.due_at)}` === stamp)
    ) {
      skipped_duplicates += 1;
      continue;
    }
    const project_id = item.project_title
      ? (projectIds.get(normalizeTitle(item.project_title)) ?? null)
      : null;
    await repository.createTask(ownerId, {
      title: item.title,
      due_at: item.due_at,
      importance: item.importance ?? undefined,
      project_id,
    });
    created_tasks += 1;
  }

  const log = { created_projects, created_tasks, skipped_duplicates };
  return repository.updateImportSession(ownerId, sessionId, {
    status: "confirmed",
    access_token: null,
    log,
    confirmed_at: new Date().toISOString(),
  });
}

export async function todoistAuthorizeUrl(env: TodoistOAuthEnv, ownerId: string) {
  if (!todoistConfigured(env) || !env.TODOIST_CLIENT_ID) {
    throw new HttpError(501, "TODOIST_NOT_CONFIGURED", "Todoist OAuth is not configured");
  }
  const state = await new SignJWT({ ownerId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(key(env.SESSION_SECRET));
  const url = new URL("https://todoist.com/oauth/authorize");
  url.searchParams.set("client_id", env.TODOIST_CLIENT_ID);
  url.searchParams.set("scope", "data:read");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", todoistRedirectUri(env));
  return url.toString();
}

export async function todoistOwnerFromState(env: TodoistOAuthEnv, state: string) {
  try {
    const { payload } = await jwtVerify(state, key(env.SESSION_SECRET), { algorithms: ["HS256"] });
    const ownerId = typeof payload.ownerId === "string" ? payload.ownerId : "";
    if (!ownerId) throw new Error("missing owner");
    return ownerId;
  } catch {
    throw new HttpError(401, "INVALID_OAUTH_STATE", "Todoist sign-in expired. Try again.");
  }
}

export function importAppRedirect(env: TodoistOAuthEnv, query: Record<string, string>) {
  const origin = (env.PUBLIC_APP_URL || env.TELEGRAM_MINI_APP_URL).replace(/\/$/, "");
  const url = new URL(`${origin}/import`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return url.toString();
}

export async function buildCompleteness(
  repository: AppRepository,
  ownerId: string,
): Promise<CompletenessReport> {
  const [profile, user, goals] = await Promise.all([
    repository.getProfile(ownerId),
    repository.getUser(ownerId),
    repository.listGoals(ownerId),
  ]);
  return profileCompleteness({
    telegramLinked: Boolean(user?.telegram_id),
    hasPortrait: Boolean(profile?.context_summary?.trim()),
    timezone: profile?.timezone,
    hasGoals: goals.some((goal) => goal.status === "active"),
    hasDigests: Boolean(
      profile?.morning_digest_enabled ||
      profile?.weekly_digest_enabled ||
      profile?.evening_sync_enabled,
    ),
  });
}

export { todoistConfigured, createTodoistGateway };
export type { TodoistGateway, TodoistOAuthEnv };
