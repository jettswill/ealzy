import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  D1_MS,
  D7_MS,
  EVENT_ONCE_KEY,
  SIGNUP_AT_KEY,
  rememberSignup,
  resetAnalyticsForTests,
  setAnalyticsApi,
  trackEventOnce,
  trackLifecycleVisits,
} from "../analytics";

const names: string[] = [];
const mockApi = {
  trackEvents: async (events: { name: string; properties?: Record<string, unknown> }[]) => {
    names.push(...events.map((event) => event.name));
    return { tracked: events.length };
  },
};

describe("analytics funnel helpers", () => {
  beforeEach(() => {
    names.length = 0;
    localStorage.clear();
    vi.useFakeTimers();
    setAnalyticsApi(mockApi);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetAnalyticsForTests();
    localStorage.clear();
  });

  it("fires first_* events only once", async () => {
    trackEventOnce("first_task");
    trackEventOnce("first_task");
    trackEventOnce("first_companion");
    await vi.advanceTimersByTimeAsync(2000);
    expect(names).toEqual(["first_task", "first_companion"]);
    expect(localStorage.getItem(EVENT_ONCE_KEY("first_task"))).toBe("1");
  });

  it("emits d1_visit and d7_visit from account age", async () => {
    rememberSignup(1_000);
    trackLifecycleVisits(1_000 + D1_MS);
    trackLifecycleVisits(1_000 + D1_MS);
    trackLifecycleVisits(1_000 + D7_MS);
    await vi.advanceTimersByTimeAsync(2000);
    expect(names).toEqual(["d1_visit", "d7_visit"]);
    expect(localStorage.getItem(SIGNUP_AT_KEY)).toBe("1000");
  });
});
