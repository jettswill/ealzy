import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAsyncData } from "../components/ui";
import { cachedOnboardingStatus, ONBOARDING_DONE_KEY } from "../hooks/useOnboardingGate";

afterEach(() => {
  localStorage.removeItem(ONBOARDING_DONE_KEY);
});

describe("onboarding cache", () => {
  it("lets returning users skip the gate", () => {
    expect(cachedOnboardingStatus()).toBe("completed");
    localStorage.setItem(ONBOARDING_DONE_KEY, "0");
    expect(cachedOnboardingStatus()).toBe("needed");
    localStorage.setItem(ONBOARDING_DONE_KEY, "1");
    expect(cachedOnboardingStatus()).toBe("completed");
  });
});

function Probe({
  loader,
  live,
}: {
  loader: () => Promise<string>;
  live?: boolean;
}) {
  const state = useAsyncData(loader, [], "cached", { live });
  return (
    <div>
      <span data-testid="value">{state.data}</span>
      <span data-testid="loading">{String(state.loading)}</span>
    </div>
  );
}

describe("silent live refresh", () => {
  it("updates cached data in the background without a loading flash", async () => {
    let current = "cached";
    const loader = vi.fn(async () => current);
    render(<Probe loader={loader} live />);
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("loading").textContent).toBe("false");

    current = "from telegram";
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("from telegram"));
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });
});
