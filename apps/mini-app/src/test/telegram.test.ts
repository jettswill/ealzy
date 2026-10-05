import { beforeEach, describe, expect, it, vi } from "vitest";

function method() {
  const fn = vi.fn();
  return Object.assign(fn, { isAvailable: vi.fn(() => true) });
}

const ready = method();
const miniAppMount = method();
const viewportMount = method();
const bindCssVars = method();
const expand = method();
const themeMount = method();
const setBackgroundColor = method();
const setHeaderColor = method();
const setBottomBarColor = method();
const init = vi.fn();
const stableHeight = vi.fn(() => 0);

vi.mock("@telegram-apps/sdk-react", () => ({
  init,
  miniApp: {
    mount: miniAppMount,
    ready,
    isDark: () => false,
    setBackgroundColor,
    setHeaderColor,
    setBottomBarColor,
  },
  themeParams: { mount: themeMount },
  viewport: {
    mount: viewportMount,
    bindCssVars,
    expand,
    stableHeight,
  },
}));

describe("Telegram Mini App startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ready.isAvailable.mockReturnValue(true);
    viewportMount.isAvailable.mockReturnValue(true);
    window.Telegram = { WebApp: { ready: vi.fn(), expand: vi.fn() } };
  });

  it("calls ready before a hanging viewport mount can block the phone", async () => {
    vi.useFakeTimers();
    viewportMount.mockReturnValue(new Promise(() => undefined));
    const { initializeTelegram } = await import("../telegram");
    const pending = initializeTelegram();
    expect(ready).toHaveBeenCalled();
    expect(window.Telegram?.WebApp?.ready).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_300);
    await pending;
    vi.useRealTimers();
    expect(document.documentElement.classList.contains("is-telegram")).toBe(true);
  });

  it("does not shrink the app below the visible viewport height", async () => {
    stableHeight.mockReturnValue(520);
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 780 });
    const { initializeTelegram } = await import("../telegram");
    await initializeTelegram();
    expect(document.documentElement.style.getPropertyValue("--app-height")).toBe("780px");
  });
});
