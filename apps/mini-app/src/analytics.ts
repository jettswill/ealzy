import type { ApiClient } from "./api";

const QUEUE: { name: string; properties?: Record<string, unknown> }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let apiRef: Pick<ApiClient, "trackEvents"> | null = null;

const FLUSH_DELAY = 2000;
const MAX_BATCH = 50;

export const SIGNUP_AT_KEY = "ealzy.signup_at";
export const EVENT_ONCE_KEY = (name: string) => `ealzy.event.${name}`;
export const D1_MS = 86_400_000;
export const D7_MS = 7 * D1_MS;

export function setAnalyticsApi(api: Pick<ApiClient, "trackEvents"> | null) {
  apiRef = api;
}

export function resetAnalyticsForTests() {
  QUEUE.length = 0;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  apiRef = null;
}

export function trackEvent(name: string, properties?: Record<string, unknown>) {
  QUEUE.push({ name, properties });
  if (QUEUE.length >= MAX_BATCH) {
    void flush();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => void flush(), FLUSH_DELAY);
  }
}

export function trackEventOnce(name: string, properties?: Record<string, unknown>) {
  try {
    if (localStorage.getItem(EVENT_ONCE_KEY(name))) return;
    localStorage.setItem(EVENT_ONCE_KEY(name), "1");
  } catch {
    // Keep going even if storage is unavailable.
  }
  trackEvent(name, properties);
}

export function rememberSignup(at = Date.now()) {
  try {
    if (!localStorage.getItem(SIGNUP_AT_KEY)) localStorage.setItem(SIGNUP_AT_KEY, String(at));
  } catch {
    // Ignore storage failures.
  }
}

export function trackLifecycleVisits(now = Date.now()) {
  try {
    const raw = localStorage.getItem(SIGNUP_AT_KEY);
    if (!raw) {
      localStorage.setItem(SIGNUP_AT_KEY, String(now));
      return;
    }
    const started = Number(raw);
    if (!Number.isFinite(started)) return;
    const age = now - started;
    if (age >= D1_MS) trackEventOnce("d1_visit");
    if (age >= D7_MS) trackEventOnce("d7_visit");
  } catch {
    // Ignore storage failures.
  }
}

async function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!QUEUE.length || !apiRef) return;
  const batch = QUEUE.splice(0, MAX_BATCH);
  try {
    await apiRef.trackEvents(batch);
  } catch {
    // Re-queue on failure (drop if too large to avoid infinite growth).
    if (QUEUE.length < MAX_BATCH * 2) {
      QUEUE.unshift(...batch);
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  window.addEventListener("beforeunload", () => void flush());
}
