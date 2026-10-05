const BOOT_ID = "ealzy-boot";
const RETRY_KEYS = ["ealzy.boot.try", "ealzy.boot.reload"] as const;

declare global {
  interface Window {
    __EALZY_BOOTED?: boolean;
  }
}

function clearBootRetries() {
  try {
    for (const key of RETRY_KEYS) sessionStorage.removeItem(key);
  } catch {
    // Private mode and older webviews may block storage.
  }
}

export function hideBootLoader() {
  window.__EALZY_BOOTED = true;
  clearBootRetries();
  document.getElementById(BOOT_ID)?.classList.add("is-done");
  document.documentElement.classList.add("is-booted");
}

export function markBootStuck() {
  const boot = document.getElementById(BOOT_ID);
  if (boot && !boot.classList.contains("is-done")) boot.classList.add("is-stuck");
}
