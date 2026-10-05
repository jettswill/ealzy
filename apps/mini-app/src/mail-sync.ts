import type { ApiClient } from "./api";
import type { MailAccount, MailDraft, MailMessage, MailPlaybook } from "./types";

export const MAIL_CACHE_KEY = "ealzy.mail.cache";
export const MAIL_CHANGED_EVENT = "ealzy:mail-changed";
export const MAIL_SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000;
export const MAIL_SYNC_ON_OPEN_MIN_AGE_MS = 2 * 60 * 1000;

export type MailSnapshot = {
  accounts: MailAccount[];
  messages: MailMessage[];
  drafts: MailDraft[];
  playbooks: MailPlaybook[];
  saved_at?: number;
};

type MailTransport = Pick<
  ApiClient,
  "mailAccounts" | "mailMessages" | "mailDrafts" | "mailPlaybooks" | "syncMyMail"
>;

let memoryCache: MailSnapshot | null = null;
let running: Promise<void> | null = null;

function emptySnapshot(): MailSnapshot {
  return { accounts: [], messages: [], drafts: [], playbooks: [] };
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
    // Private mode or a full quota should not block showing mail.
  }
}

function isSnapshot(value: unknown): value is MailSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as MailSnapshot;
  return (
    Array.isArray(item.accounts) &&
    Array.isArray(item.messages) &&
    Array.isArray(item.drafts) &&
    Array.isArray(item.playbooks)
  );
}

export function readMailCache(): MailSnapshot | null {
  if (typeof localStorage === "undefined") return memoryCache;
  const stored = readJson<unknown>(MAIL_CACHE_KEY, null);
  if (!isSnapshot(stored)) return memoryCache;
  memoryCache = stored;
  return stored;
}

export function writeMailCache(snapshot: MailSnapshot) {
  memoryCache = { ...snapshot, saved_at: snapshot.saved_at ?? Date.now() };
  if (typeof localStorage !== "undefined") writeJson(MAIL_CACHE_KEY, memoryCache);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MAIL_CHANGED_EVENT));
}

export function snapshotMail(): MailSnapshot {
  return readMailCache() ?? emptySnapshot();
}

export function isMailSyncStale(
  account: Pick<MailAccount, "status" | "last_synced_at">,
  now = Date.now(),
  minAgeMs = MAIL_SYNC_ON_OPEN_MIN_AGE_MS,
) {
  if (account.status === "disabled") return false;
  if (account.status === "error" || !account.last_synced_at) return true;
  const syncedAt = Date.parse(account.last_synced_at);
  return !Number.isFinite(syncedAt) || syncedAt <= now - minAgeMs;
}

export async function loadMailSnapshot(api: MailTransport): Promise<MailSnapshot> {
  const [accounts, messages, drafts, playbooks] = await Promise.all([
    api.mailAccounts(),
    api.mailMessages(),
    api.mailDrafts(),
    api.mailPlaybooks(),
  ]);
  const snapshot = { accounts, messages, drafts, playbooks, saved_at: Date.now() };
  writeMailCache(snapshot);
  return snapshot;
}

export async function syncMailNow(api: MailTransport) {
  const cached = readMailCache();
  const accounts = cached?.accounts ?? (await api.mailAccounts().catch(() => []));
  if (!accounts.some((account) => isMailSyncStale(account))) return cached ?? snapshotMail();
  await api.syncMyMail();
  return loadMailSnapshot(api);
}

export function startMailSync(api: MailTransport): () => void {
  const run = () => {
    if (running) return running;
    running = syncMailNow(api)
      .catch(() => undefined)
      .then(() => undefined)
      .finally(() => {
        running = null;
      });
    return running;
  };

  const onOnline = () => void run();
  const onVisible = () => {
    if (document.visibilityState === "visible") void run();
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(() => void run(), MAIL_SYNC_INTERVAL_MS);
  void run();
  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}

export function subscribeMailSnapshot(listener: (snapshot: MailSnapshot) => void) {
  const handler = () => listener(snapshotMail());
  window.addEventListener(MAIL_CHANGED_EVENT, handler);
  return () => window.removeEventListener(MAIL_CHANGED_EVENT, handler);
}

export function resetMailSync() {
  memoryCache = null;
  running = null;
  try {
    localStorage.removeItem(MAIL_CACHE_KEY);
  } catch {
    // Ignore missing storage in tests.
  }
}
