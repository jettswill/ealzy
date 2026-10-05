import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth";

export type OnboardingStatus = "loading" | "needed" | "completed";
export const ONBOARDING_DONE_KEY = "ealzy.onboarding.done";
export const ONBOARDING_SKIPPED_KEY = "ealzy.onboarding.skipped";

export function cachedOnboardingStatus(): OnboardingStatus {
  try {
    const raw = localStorage.getItem(ONBOARDING_DONE_KEY);
    if (raw === "1") return "completed";
    if (raw === "0") return "needed";
  } catch {
    // Private mode should still open Home immediately.
  }
  return "completed";
}

export function wasOnboardingSkipped(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_SKIPPED_KEY) === "1";
  } catch {
    return false;
  }
}

function persistOnboardingStatus(status: Exclude<OnboardingStatus, "loading">) {
  try {
    localStorage.setItem(ONBOARDING_DONE_KEY, status === "completed" ? "1" : "0");
  } catch {
    // Ignore quota / private-mode failures.
  }
}

/**
 * Re-opens the guided onboarding after it was skipped (not finished). There is no
 * shared client state between HomePage and the router gate, so the simplest reliable
 * way to force the mandatory flow back on is to mark it "needed" locally and reload —
 * this is a deliberate, infrequent action, not a hot path.
 */
export function reopenOnboarding() {
  try {
    localStorage.setItem(ONBOARDING_DONE_KEY, "0");
    localStorage.removeItem(ONBOARDING_SKIPPED_KEY);
  } catch {
    // If storage is unavailable there is nothing to persist; still reload.
  }
  window.location.reload();
}

export function useOnboardingGate() {
  const { api, status } = useAuth();
  const [onboarding, setOnboarding] = useState<OnboardingStatus>(() => {
    if (import.meta.env.MODE === "test") return "completed";
    return cachedOnboardingStatus();
  });

  useEffect(() => {
    if (status !== "authenticated") return;
    if (import.meta.env.MODE === "test") {
      setOnboarding("completed");
      return;
    }
    let active = true;
    api
      .me()
      .then((profile) => {
        if (!active) return;
        const next: OnboardingStatus = profile.onboarding_completed_at ? "completed" : "needed";
        persistOnboardingStatus(next);
        setOnboarding(next);
      })
      .catch(() => {
        if (!active) return;
        persistOnboardingStatus("completed");
        setOnboarding("completed");
      });
    return () => {
      active = false;
    };
  }, [api, status]);

  const markCompleted = useCallback(() => {
    persistOnboardingStatus("completed");
    try {
      localStorage.removeItem(ONBOARDING_SKIPPED_KEY);
    } catch {
      // Ignore.
    }
    setOnboarding("completed");
  }, []);

  // Skipping stops the mandatory flow from blocking again, but — unlike markCompleted —
  // never tells the server onboarding_completed_at happened, so we can still offer to
  // pick it back up later (see reopenOnboarding, surfaced from the empty tasks page).
  const markSkipped = useCallback(() => {
    persistOnboardingStatus("completed");
    try {
      localStorage.setItem(ONBOARDING_SKIPPED_KEY, "1");
    } catch {
      // Ignore.
    }
    setOnboarding("completed");
  }, []);

  return { onboarding, markCompleted, markSkipped };
}
