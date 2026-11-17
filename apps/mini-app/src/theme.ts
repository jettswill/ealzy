export type Appearance = "dark" | "light";
/** Что выбрал человек: «Как в системе» (по умолчанию), «Светлая» или «Тёмная» — как в iOS. */
export type AppearanceChoice = "system" | Appearance;

/** «Лампа»: тёплая темнота и газетная бумага днём — те же цвета, что в iOS-приложении. */
export const LAMP_DARK_BG = "#191714";
export const LAMP_LIGHT_BG = "#ECEAE4";

const CHOICE_KEY = "ealzy.appearance";

export function deviceAppearance(): Appearance {
  try {
    if (typeof window.matchMedia !== "function") return "dark";
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  } catch {
    // Private mode and older webviews may throw.
  }
  return "dark";
}

export function appearanceChoice(): AppearanceChoice {
  try {
    const value = localStorage.getItem(CHOICE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Хранилище может быть недоступно — тогда как в системе.
  }
  return "system";
}

export function setAppearanceChoice(choice: AppearanceChoice) {
  try {
    if (choice === "system") localStorage.removeItem(CHOICE_KEY);
    else localStorage.setItem(CHOICE_KEY, choice);
  } catch {
    // Не сохранилось — всё равно применим на этот раз.
  }
  applyAppearance(resolveAppearance(choice));
  window.dispatchEvent(new CustomEvent("ealzy:appearance"));
}

/** Выбор человека важнее системы; «как в системе» — тема устройства (или Telegram). */
export function resolveAppearance(
  choice: AppearanceChoice = appearanceChoice(),
  system: Appearance = deviceAppearance(),
): Appearance {
  return choice === "system" ? system : choice;
}

export function inTelegramWebView(): boolean {
  try {
    const telegram = window as Window & {
      Telegram?: { WebApp?: { initData?: string } };
      TelegramWebviewProxy?: unknown;
    };
    if (telegram.Telegram?.WebApp?.initData) return true;
    if (telegram.TelegramWebviewProxy) return true;
    const from = `${window.location.hash} ${window.location.search}`;
    return from.includes("tgWebAppData");
  } catch {
    return false;
  }
}

export function themeBackground(theme: Appearance) {
  return theme === "dark" ? LAMP_DARK_BG : LAMP_LIGHT_BG;
}

export function applyAppearance(theme: Appearance) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.setAttribute("content", theme);
  const color = document.querySelector('meta[name="theme-color"]:not([media])');
  if (color) color.setAttribute("content", themeBackground(theme));
}

export function currentAppearance(): Appearance {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Пока выбрано «как в системе», тема меняется вместе с устройством. */
export function watchSystemAppearance() {
  try {
    const light = window.matchMedia?.("(prefers-color-scheme: light)");
    const sync = () => {
      if (appearanceChoice() === "system") applyAppearance(deviceAppearance());
    };
    if (typeof light?.addEventListener === "function") light.addEventListener("change", sync);
    else light?.addListener?.(sync);
  } catch {
    // matchMedia is optional.
  }
}
