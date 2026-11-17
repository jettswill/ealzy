import { lazy, Suspense, useLayoutEffect, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { hideBootLoader } from "./boot";
import { useOnboardingGate } from "./hooks/useOnboardingGate";
import { LocaleProvider, useI18n } from "./i18n";
import { Layout } from "./components/Layout";
import { EalzyMark } from "./components/EalzyLogo";
import { LoadingState } from "./components/ui";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { LoginPage } from "./pages/LoginPage";
import { TelegramCallbackPage } from "./pages/TelegramCallbackPage";
import { HomePage } from "./pages/HomePage";
import { AdminPage } from "./pages/AdminPage";
import { applyAppearance, deviceAppearance } from "./theme";

const CHUNK_RELOAD_KEY = "ealzy.chunk_reload";

function sessionFlag(key: string) {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function setSessionFlag(key: string, value: boolean) {
  try {
    if (value) sessionStorage.setItem(key, "1");
    else sessionStorage.removeItem(key);
  } catch {
    // Приватный режим и заблокированное хранилище — не повод падать.
  }
}

function lazyNamed(loader: () => Promise<Record<string, unknown>>, name: string) {
  return lazy(async () => {
    let module: Record<string, unknown>;
    try {
      module = await loader();
    } catch {
      // Чанк маршрута не догрузился — сорванная сеть или устаревший шелл-кэш.
      // React.lazy запоминает отклонённый промис навсегда: экран уходит в
      // «Что-то пошло не так», и кнопка «Повторить» повторяет уже провалившийся
      // импорт. Пробуем ещё раз, и только потом перезагружаем страницу — один
      // раз за сессию, чтобы не зациклиться на действительно битой сборке.
      await new Promise((resolve) => setTimeout(resolve, 400));
      try {
        module = await loader();
      } catch (retryError) {
        if (!sessionFlag(CHUNK_RELOAD_KEY)) {
          setSessionFlag(CHUNK_RELOAD_KEY, true);
          window.location.reload();
          // Держим Suspense до перезагрузки, чтобы экран ошибки не успел мигнуть.
          await new Promise<never>(() => undefined);
        }
        throw retryError;
      }
    }
    if (sessionFlag(CHUNK_RELOAD_KEY)) setSessionFlag(CHUNK_RELOAD_KEY, false);
    return { default: module[name] as ComponentType<Record<string, unknown>> };
  });
}

const OnboardingFlow = lazyNamed(() => import("./components/OnboardingFlow"), "OnboardingFlow");
const CompanionPage = lazyNamed(() => import("./pages/CompanionPage"), "CompanionPage");
const PeoplePage = lazyNamed(() => import("./pages/PeoplePage"), "PeoplePage");
const PersonPage = lazyNamed(() => import("./pages/PersonPage"), "PersonPage");
const TasksPage = lazyNamed(() => import("./pages/TasksPage"), "TasksPage");
const NotesPage = lazyNamed(() => import("./pages/NotesPage"), "NotesPage");
const NotePage = lazyNamed(() => import("./pages/NotePage"), "NotePage");
const SpacesPage = lazyNamed(() => import("./pages/SpacesPage"), "SpacesPage");
const SpacePage = lazyNamed(() => import("./pages/SpacePage"), "SpacePage");
const PlanPage = lazyNamed(() => import("./pages/PlanPage"), "PlanPage");
const GoalsPage = lazyNamed(() => import("./pages/GoalsPage"), "GoalsPage");
const GoalPage = lazyNamed(() => import("./pages/GoalPage"), "GoalPage");
const PromisesPage = lazyNamed(() => import("./pages/PromisesPage"), "PromisesPage");
const ProjectsPage = lazyNamed(() => import("./pages/ProjectsPage"), "ProjectsPage");
const ExperiencesPage = lazyNamed(() => import("./pages/ExperiencesPage"), "ExperiencesPage");
const ExperiencePage = lazyNamed(() => import("./pages/ExperiencePage"), "ExperiencePage");
const MorePage = lazyNamed(() => import("./pages/MorePage"), "MorePage");
const PrivacyPage = lazyNamed(() => import("./pages/MorePage"), "PrivacyPage");
const ImportPage = lazyNamed(() => import("./pages/ImportPage"), "ImportPage");
const ProfilePage = lazyNamed(() => import("./pages/ProfilePage"), "ProfilePage");
const MailPage = lazyNamed(() => import("./pages/MailPage"), "MailPage");
const RecommendationsPage = lazyNamed(
  () => import("./pages/RecommendationsPage"),
  "RecommendationsPage",
);
const RecommendationPage = lazyNamed(
  () => import("./pages/RecommendationPage"),
  "RecommendationPage",
);

export function App() {
  return (
    <LocaleProvider>
      <AppShell />
    </LocaleProvider>
  );
}

function AppShell() {
  const { status } = useAuth();
  const { t } = useI18n();
  const { onboarding, markCompleted, markSkipped } = useOnboardingGate();

  useLayoutEffect(() => {
    applyAppearance(deviceAppearance());
    hideBootLoader();
    try {
      window.Telegram?.WebApp?.ready?.();
      window.Telegram?.WebApp?.expand?.();
    } catch {
      // Telegram keeps its own splash until ready().
    }
  }, [status]);

  if (status === "loading") {
    return (
      <main className="boot-screen" role="status">
        <div>
          <EalzyMark className="splash-mark" />
          <p className="mt-4 text-sm text-muted">{t("app.opening")}…</p>
        </div>
      </main>
    );
  }
  if (status === "error" || status === "unauthenticated") {
    return (
      <Routes>
        <Route path="auth/callback" element={<AuthCallbackPage />} />
        <Route path="auth/telegram" element={<TelegramCallbackPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  if (onboarding === "needed") {
    return (
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route path="auth/callback" element={<AuthCallbackPage />} />
          <Route path="auth/telegram" element={<TelegramCallbackPage />} />
          <Route
            path="*"
            element={<OnboardingFlow onComplete={markCompleted} onSkip={markSkipped} />}
          />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Routes>
      <Route path="auth/callback" element={<AuthCallbackPage />} />
      <Route path="auth/telegram" element={<TelegramCallbackPage />} />
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="companion" element={<CompanionPage />} />
        <Route path="people" element={<PeoplePage />} />
        <Route path="people/:id" element={<PersonPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="notes/:id" element={<NotePage />} />
        <Route path="spaces" element={<SpacesPage />} />
        <Route path="spaces/:id" element={<SpacePage />} />
        <Route path="plan" element={<PlanPage />} />
        <Route path="goals" element={<GoalsPage />} />
        <Route path="goals/:id" element={<GoalPage />} />
        <Route path="promises" element={<PromisesPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="experiences" element={<ExperiencesPage />} />
        <Route path="experiences/:id" element={<ExperiencePage />} />
        <Route path="more" element={<MorePage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="profile/privacy" element={<PrivacyPage />} />
        <Route path="mail" element={<MailPage />} />
        <Route path="recommendations" element={<RecommendationsPage />} />
        <Route path="recommendations/:id" element={<RecommendationPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
