import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiClient, ApiError } from "./api";
import { startMailSync } from "./mail-sync";
import { startNoteSync } from "./note-sync";
import { startTaskSync } from "./task-sync";
import { rememberSignup, setAnalyticsApi, trackEvent, trackLifecycleVisits } from "./analytics";
import { detectTimeZone } from "./i18n/locale";
import { getTelegramInitData, waitForTelegramInitData } from "./telegram-init-data";
import { telegramLoginFromSearch } from "./telegram-login";
import { inTelegramWebView } from "./theme";

export const SESSION_KEY = "ealzy.session";

interface StoredSession {
  token: string;
  expires_at?: string;
}

interface AuthContextValue {
  api: ApiClient;
  ownerId: string | null;
  isGuest: boolean;
  status: "loading" | "unauthenticated" | "authenticated" | "error";
  error: string | null;
  retry: () => void;
  completeSession: (session: StoredSession) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const createApi = (getToken: () => string | null) => new ApiClient(getToken);

export function ownerIdFromToken(token: string | null): string | null {
  const payload = tokenPayload(token);
  if (!payload) return null;
  const ownerId = typeof payload.ownerId === "string" ? payload.ownerId : payload.sub;
  return typeof ownerId === "string" ? ownerId : null;
}

export function isGuestFromToken(token: string | null): boolean {
  return tokenPayload(token)?.isGuest === true;
}

function tokenPayload(
  token: string | null,
): { ownerId?: unknown; sub?: unknown; exp?: unknown; isGuest?: unknown } | null {
  if (!token) return null;
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const padded = segment
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(segment.length / 4) * 4, "=");
    return JSON.parse(
      decodeURIComponent(
        Array.from(atob(padded))
          .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
          .join(""),
      ),
    ) as { ownerId?: unknown; sub?: unknown; exp?: unknown; isGuest?: unknown };
  } catch {
    return null;
  }
}

export function expiryIsoFromToken(token: string | null): string | undefined {
  const exp = tokenPayload(token)?.exp;
  return typeof exp === "number" ? new Date(exp * 1000).toISOString() : undefined;
}

export function telegramSessionError(cause: unknown) {
  const english =
    typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("en");
  if (cause instanceof ApiError && cause.status === 401) {
    if (
      cause.code === "INVALID_TELEGRAM_LOGIN" ||
      cause.code === "EXPIRED_TELEGRAM_LOGIN" ||
      cause.code === "VALIDATION_ERROR"
    ) {
      return english ? "Telegram sign-in failed." : "Не удалось войти через Telegram.";
    }
    return english
      ? "Telegram could not verify this session. Reopen Ealzy from the bot."
      : "Telegram не подтвердил сессию. Откройте Ealzy из бота ещё раз.";
  }
  if (cause instanceof Error && cause.message) return cause.message;
  return english ? "Authentication failed." : "Не удалось войти.";
}

function readFrom(storage: Storage): StoredSession | null {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as StoredSession;
    if (!session.token) return null;
    const expires_at = session.expires_at ?? expiryIsoFromToken(session.token);
    if (expires_at && Date.parse(expires_at) <= Date.now()) {
      storage.removeItem(SESSION_KEY);
      return null;
    }
    return expires_at ? { ...session, expires_at } : session;
  } catch {
    storage.removeItem(SESSION_KEY);
    return null;
  }
}

export function readStoredSession(storage?: Storage): StoredSession | null {
  if (storage) return readFrom(storage);
  return readFrom(localStorage) ?? readFrom(sessionStorage);
}

export function persistSession(session: StoredSession) {
  const payload = JSON.stringify({
    token: session.token,
    expires_at: session.expires_at ?? expiryIsoFromToken(session.token),
  });
  try {
    localStorage.setItem(SESSION_KEY, payload);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    sessionStorage.setItem(SESSION_KEY, payload);
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
}

export function AuthProvider({
  children,
  apiFactory = createApi,
}: {
  children: ReactNode;
  apiFactory?: (getToken: () => string | null) => ApiClient;
}) {
  const [token, setToken] = useState(() => readStoredSession()?.token ?? null);
  const [status, setStatus] = useState<"loading" | "unauthenticated" | "authenticated" | "error">(
    () => {
      if (token) return "authenticated";
      if (telegramLoginFromSearch(window.location.search, window.location.hash)) {
        return "unauthenticated";
      }
      // No stored session and no pending Telegram login: we still resolve automatically,
      // either from Telegram init data or by opening a guest session.
      return "loading";
    },
  );
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const api = useMemo(() => apiFactory(() => token), [apiFactory, token]);
  const ownerId = useMemo(() => ownerIdFromToken(token), [token]);
  const isGuest = useMemo(() => isGuestFromToken(token), [token]);
  const refreshed = useRef(false);
  const clientContextSent = useRef(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    const stopTasks = startTaskSync(api);
    const stopMail = startMailSync(api);
    const stopNotes = ownerId ? startNoteSync(ownerId, api) : () => undefined;
    return () => {
      stopTasks();
      stopMail();
      stopNotes();
    };
  }, [api, ownerId, status]);

  useEffect(() => {
    if (!token) return;
    setAnalyticsApi(api);
    if (status === "authenticated") trackLifecycleVisits();
  }, [api, status, token]);

  // Вход через почту или OAuth приходит редиректом с готовым токеном: сервер
  // о часовом поясе браузера ничего не знает и ставит такому аккаунту UTC с
  // выключенной утренней сводкой. Отдаём пояс сразу после входа — иначе главный
  // механизм продукта у веб-пользователя молчит.
  useEffect(() => {
    if (import.meta.env.MODE === "test") return;
    if (status !== "authenticated" || clientContextSent.current) return;
    const timezone = detectTimeZone();
    if (!timezone) return;
    clientContextSent.current = true;
    void api.reportClientContext(timezone).catch(() => undefined);
  }, [api, status]);

  useEffect(() => {
    if (import.meta.env.MODE === "test") return;
    if (!token || refreshed.current) return;
    refreshed.current = true;
    let active = true;
    void api
      .refreshSession()
      .then((session) => {
        if (!active || !session.token) return;
        persistSession(session);
        setToken(session.token);
        setStatus("authenticated");
      })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) {
          clearSession();
          setToken(null);
          setStatus("unauthenticated");
        }
      });
    return () => {
      active = false;
    };
  }, [api, token]);

  useEffect(() => {
    if (token) return;
    const controller = new AbortController();
    const authenticate = async () => {
      if (telegramLoginFromSearch(window.location.search, window.location.hash)) {
        setStatus("unauthenticated");
        return;
      }
      let initData = getTelegramInitData();
      if (!initData && inTelegramWebView()) {
        setStatus("loading");
        initData = await waitForTelegramInitData();
      }
      setStatus("loading");
      setError(null);
      if (initData) {
        try {
          const session = await api.exchangeTelegram(initData, detectTimeZone());
          if (controller.signal.aborted) return;
          persistSession(session);
          setToken(session.token);
          setAnalyticsApi(api);
          rememberSignup();
          trackEvent("signup", { source: "telegram" });
          setStatus("authenticated");
        } catch (cause) {
          if (controller.signal.aborted) return;
          setStatus("unauthenticated");
          setError(telegramSessionError(cause));
        }
        return;
      }
      // No Telegram context at all (plain web visit): open a guest session so the
      // product is usable immediately. The user can link Telegram later to keep the data.
      try {
        const english =
          typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("en");
        const session = await api.exchangeGuest(detectTimeZone(), english ? "en" : "ru");
        if (controller.signal.aborted) return;
        persistSession(session);
        setToken(session.token);
        setAnalyticsApi(api);
        rememberSignup();
        trackEvent("signup", { source: "guest" });
        setStatus("authenticated");
      } catch (cause) {
        if (controller.signal.aborted) return;
        setStatus("unauthenticated");
        setError(telegramSessionError(cause));
      }
    };
    void authenticate();
    return () => controller.abort();
  }, [api, attempt, token]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const completeSession = useCallback((session: StoredSession) => {
    persistSession(session);
    setToken(session.token);
    setError(null);
    setStatus("authenticated");
  }, []);
  const value = useMemo(
    () => ({ api, ownerId, isGuest, status, error, retry, completeSession }),
    [api, ownerId, isGuest, status, error, retry, completeSession],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
