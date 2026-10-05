import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth";
import { hideBootLoader, markBootStuck } from "./boot";
import { registerAppShell } from "./offline";
import { enableStandaloneApp } from "./standalone";
import { inTelegramWebView } from "./theme";
import "./styles.css";

try {
  window.Telegram?.WebApp?.setHeaderColor?.("#212121");
  window.Telegram?.WebApp?.setBackgroundColor?.("#212121");
  window.Telegram?.WebApp?.ready?.();
  window.Telegram?.WebApp?.expand?.();
} catch {
  // Native ready() is best-effort; the SDK path still runs below.
}

enableStandaloneApp();

if (inTelegramWebView()) {
  document.documentElement.classList.add("is-telegram");
}

const root = document.getElementById("root");
if (!root) {
  markBootStuck();
} else {
  try {
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </React.StrictMode>,
    );
    hideBootLoader();
  } catch {
    markBootStuck();
  }
}

registerAppShell();

if (inTelegramWebView()) {
  void import("./telegram")
    .then((mod) => mod.initializeTelegram())
    .catch(() => {
      try {
        window.Telegram?.WebApp?.ready?.();
        window.Telegram?.WebApp?.expand?.();
      } catch {
        // Mini App still renders if the SDK chunk fails to load.
      }
    });
}
