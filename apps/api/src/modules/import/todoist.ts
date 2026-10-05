export type TodoistProject = {
  id: string;
  name: string;
  is_inbox_project?: boolean;
};

export type TodoistTask = {
  id: string;
  content: string;
  description?: string | null;
  project_id?: string | null;
  due?: { date?: string | null; datetime?: string | null } | null;
  priority?: number | null;
  is_completed?: boolean;
};

export interface TodoistGateway {
  exchangeCode?(code: string, env: TodoistOAuthEnv): Promise<string>;
  listProjects(token: string): Promise<TodoistProject[]>;
  listTasks(token: string): Promise<TodoistTask[]>;
}

export type TodoistOAuthEnv = {
  TODOIST_CLIENT_ID?: string;
  TODOIST_CLIENT_SECRET?: string;
  TODOIST_REDIRECT_URI?: string;
  TELEGRAM_MINI_APP_URL: string;
  PUBLIC_APP_URL?: string;
  SESSION_SECRET: string;
};

type FetchLike = typeof fetch;

const REST = "https://api.todoist.com/rest/v2";

async function readJson(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Todoist request failed (${response.status})`);
  }
  return text ? (JSON.parse(text) as unknown) : null;
}

export function todoistConfigured(env: TodoistOAuthEnv) {
  return Boolean(env.TODOIST_CLIENT_ID && env.TODOIST_CLIENT_SECRET);
}

export function todoistRedirectUri(env: TodoistOAuthEnv) {
  const origin = (env.PUBLIC_APP_URL || env.TELEGRAM_MINI_APP_URL).replace(/\/$/, "");
  return env.TODOIST_REDIRECT_URI || `${origin}/api/import/todoist/callback`;
}

export function createTodoistGateway(http: FetchLike = fetch): TodoistGateway {
  return {
    async exchangeCode(code, env) {
      const response = await http("https://todoist.com/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          client_id: env.TODOIST_CLIENT_ID ?? "",
          client_secret: env.TODOIST_CLIENT_SECRET ?? "",
          code,
        }).toString(),
      });
      const payload = (await readJson(response)) as { access_token?: string } | null;
      if (!payload?.access_token) throw new Error("Todoist did not return an access token");
      return payload.access_token;
    },
    async listProjects(token) {
      const response = await http(`${REST}/projects`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      return (await readJson(response)) as TodoistProject[];
    },
    async listTasks(token) {
      const response = await http(`${REST}/tasks`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      return (await readJson(response)) as TodoistTask[];
    },
  };
}

export function todoistImportance(priority?: number | null) {
  if (!priority) return 3;
  return Math.min(5, Math.max(1, priority + 1));
}

export function todoistDueAt(task: TodoistTask) {
  if (task.due?.datetime) {
    const parsed = new Date(task.due.datetime);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (task.due?.date) return `${task.due.date}T12:00:00.000Z`;
  return null;
}
