const RETRY_KEY = "ealzy.boot.try";

function markStuck() {
  const boot = document.getElementById("ealzy-boot");
  if (boot && !boot.classList.contains("is-done")) boot.classList.add("is-stuck");
}

function reloadOnce() {
  try {
    const tries = Number(sessionStorage.getItem(RETRY_KEY) || "0");
    if (tries >= 1) {
      sessionStorage.removeItem(RETRY_KEY);
      markStuck();
      return;
    }
    sessionStorage.setItem(RETRY_KEY, String(tries + 1));
  } catch {
    // Private mode still allows a single navigation retry.
  }
  location.replace(`/?r=${Date.now()}`);
}

async function bootFromRelease() {
  if (window.__EALZY_BOOTED) {
    reloadOnce();
    return;
  }
  const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("version");
  const release = await response.json();
  if (release.css && !document.querySelector(`link[rel="stylesheet"][href^="${release.css}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = release.css;
    document.head.appendChild(link);
  }
  if (!release.entry) throw new Error("entry");
  try {
    sessionStorage.removeItem(RETRY_KEY);
  } catch {
    // Ignore storage failures.
  }
  await import(release.entry);
}

bootFromRelease().catch(() => {
  reloadOnce();
});
