import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { DailyDigest } from "../components/DailyDigest";
import { Link, useNavigate } from "react-router-dom";
import { useArchiveLinger } from "../archive-linger";
import { useAuth } from "../auth";
import { ComposerBar } from "../components/Composer";
import {
  HomeTaskButton,
  TaskDragGhost,
  UnplannedList,
  useDaySwipe,
  useTaskDrag,
  type DropListId,
} from "../components/HomeTasks";
import { Button, Card, ErrorState, LoadingState, Modal, useAsyncData } from "../components/ui";
import { DayCelebration } from "../components/DayCelebration";
import { WeekSummary } from "../components/WeekSummary";
import { useCreateIntent } from "../create-intent";
import { reopenOnboarding, wasOnboardingSkipped } from "../hooks/useOnboardingGate";
import { useI18n } from "../i18n";
import { useDesktopNav } from "../media";
import {
  isOfflineNow,
  snapshotTasks,
  subscribeTaskSnapshot,
  TASK_CREATED_EVENT,
  upsertTask,
  visibleTasks,
} from "../task-sync";
import {
  addCalendarDays,
  completedTodayTasks,
  completionStreak,
  dateKeyInZone,
  plannedLaterDays,
  middayIso,
  overdueTasks,
  pickTodayPrompt,
  planListReorder,
  scheduleTomorrowPrompt,
  todaysTasks,
  shouldShowTomorrowPlan,
  shouldShowWeekSummary,
  streakMilestone,
  tomorrowDiscussPrompt,
  tomorrowsTasks,
  undatedTasks,
  weekStats,
} from "../today-tasks";
import {
  promiseCheckInPrompt,
  promisePsychologistPrompt,
  goalSyncPrompt,
  goalSyncInviteDue,
  markGoalSyncDismissed,
} from "../direction-prompts";
import { dueClock, isPushTask } from "../task-priority";
import type { Goal, SelfPromise, SelfPromiseCheckinStatus, Task, TaskStatus } from "../types";

const TaskCardModal = lazy(async () => {
  const mod = await import("../components/TaskForm");
  return { default: mod.TaskCardModal };
});
const TaskFormModal = lazy(async () => {
  const mod = await import("../components/TaskForm");
  return { default: mod.TaskFormModal };
});

type HomeTab = "planned" | "unplanned";

function useOfflineNow() {
  const [offline, setOffline] = useState(isOfflineNow);
  useEffect(() => {
    const sync = () => setOffline(isOfflineNow());
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return offline;
}

export function HomePage() {
  const { api } = useAuth();
  const offline = useOfflineNow();
  const { t, timezone, language, locale, formatDate, formatTime } = useI18n();
  const navigate = useNavigate();
  const desktop = useDesktopNav();
  const screen = useAsyncData(
    async () => {
      const fallbackProfile = {
        bio: null,
        values: [] as string[],
        communication_style: null,
        timezone,
        telegram_id: null as number | null,
        morning_digest_enabled: false,
        last_goal_checkin_on: dateKeyInZone(new Date(), timezone),
      };
      const [profile, fetchedTasks, promises, goals] = await Promise.all([
        api.me().catch(() => fallbackProfile),
        api.tasks().catch(() => snapshotTasks()),
        api.promises().catch(() => []),
        api.goals().catch(() => []),
      ]);
      return {
        profile: profile ?? fallbackProfile,
        tasks: visibleTasks(fetchedTasks),
        promises,
        goals,
      };
    },
    [api, timezone],
    () => ({
      profile: {
        bio: null,
        values: [] as string[],
        communication_style: null,
        timezone,
        telegram_id: null as number | null,
        morning_digest_enabled: false,
        last_goal_checkin_on: dateKeyInZone(new Date(), timezone),
      },
      tasks: snapshotTasks(),
      promises: [] as SelfPromise[],
      goals: [] as Goal[],
    }),
    { live: true },
  );
  const zone = screen.data?.profile.timezone || timezone;
  const [now, setNow] = useState(() => new Date());
  const [selected, setSelected] = useState<Task | null>(null);
  const [addingDate, setAddingDate] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleAsk, setScheduleAsk] = useState("");
  const [discussBroken, setDiscussBroken] = useState<SelfPromise | null>(null);
  const [dumpDraft, setDumpDraft] = useState("");
  const [dumpSaving, setDumpSaving] = useState(false);
  const [dumpError, setDumpError] = useState("");
  const [tab, setTab] = useState<HomeTab>("planned");
  const [pageIndex, setPageIndex] = useState(0);
  const [unplannedOpen, setUnplannedOpen] = useState(false);
  const pagerRef = useRef<HTMLDivElement>(null);
  const dayTabsRef = useRef<HTMLDivElement>(null);
  const { lingeringIds, rememberArchiveState } = useArchiveLinger();
  useEffect(() => {
    return subscribeTaskSnapshot((tasks) => {
      screen.setData((current) =>
        current
          ? { ...current, tasks }
          : {
              profile: {
                bio: null,
                values: [],
                communication_style: null,
                timezone,
                last_goal_checkin_on: dateKeyInZone(new Date(), timezone),
              },
              tasks,
              promises: [],
              goals: [],
            },
      );
    });
  }, [screen.setData, timezone]);
  useEffect(() => {
    const onCreated = (event: Event) => {
      const task = (event as CustomEvent<Task>).detail;
      if (task && !task.due_at) {
        setTab("unplanned");
        setPageIndex(0);
        setUnplannedOpen(true);
      }
    };
    window.addEventListener(TASK_CREATED_EVENT, onCreated);
    return () => window.removeEventListener(TASK_CREATED_EVENT, onCreated);
  }, []);
  const duePromises = (screen.data?.promises ?? []).filter(
    (item) => item.status === "active" && item.stats?.due_for_checkin,
  );
  const goals = screen.data?.goals ?? [];
  const [goalSyncHidden, setGoalSyncHidden] = useState(false);
  const showGoalSync =
    !goalSyncHidden &&
    !screen.loading &&
    goalSyncInviteDue(screen.data?.profile.last_goal_checkin_on, zone, now);

  const startGoalSync = () => {
    markGoalSyncDismissed(zone, now);
    setGoalSyncHidden(true);
    navigate("/companion", {
      state: { draft: goalSyncPrompt(goals, language), autoSend: true },
    });
  };

  const laterGoalSync = () => {
    markGoalSyncDismissed(zone, now);
    setGoalSyncHidden(true);
  };

  const checkInPromise = async (promise: SelfPromise, status: SelfPromiseCheckinStatus) => {
    const previous = screen.data;
    if (!previous) return;
    try {
      const result = await api.checkInPromise(promise.id, { status });
      screen.setData({
        ...previous,
        promises: previous.promises.map((item) => (item.id === promise.id ? result.promise : item)),
      });
      if (status === "broken") setDiscussBroken(result.promise);
    } catch {
      // Keep the home list usable if a check-in fails.
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const tasks = screen.data?.tasks ?? [];
  const todayItems = useMemo(
    () => todaysTasks(tasks, zone, now, lingeringIds),
    [lingeringIds, now, tasks, zone],
  );
  const completedToday = useMemo(() => completedTodayTasks(tasks, zone, now), [now, tasks, zone]);
  const dayStreak = useMemo(() => completionStreak(tasks, zone, now), [now, tasks, zone]);
  const dayMilestone = streakMilestone(dayStreak);
  const week = useMemo(() => weekStats(tasks, zone, now), [now, tasks, zone]);
  const weekRecap = shouldShowWeekSummary(week, now, zone);
  const tomorrowItems = useMemo(
    () => tomorrowsTasks(tasks, zone, now, lingeringIds),
    [lingeringIds, now, tasks, zone],
  );
  const overdueItems = useMemo(
    () => overdueTasks(tasks, zone, now, lingeringIds),
    [lingeringIds, now, tasks, zone],
  );
  const laterDayGroups = useMemo(
    () => plannedLaterDays(tasks, zone, now, lingeringIds),
    [lingeringIds, now, tasks, zone],
  );
  const undatedItems = useMemo(
    () => undatedTasks(tasks, zone, lingeringIds),
    [lingeringIds, tasks, zone],
  );
  const todayKey = dateKeyInZone(now, zone);
  useCreateIntent(() => setAddingDate(todayKey));
  const tomorrowKey = addCalendarDays(todayKey, 1);
  const hasTodayWork = todayItems.length > 0;
  const isFirstRun = tasks.length === 0 && !screen.loading;
  const firstGoal = goals.find((goal) => goal.status === "active");
  const eveningPlanMode = useMemo(
    () => shouldShowTomorrowPlan(tasks, zone, now),
    [tasks, zone, now],
  );
  const dayPages = useMemo(
    () => [
      ...(overdueItems.length
        ? [
            {
              id: "overdue",
              label: t("home.overdue"),
              short: t("home.overdue"),
              hasTasks: true,
            },
          ]
        : []),
      {
        id: "today",
        label: t("home.today"),
        short: t("home.today"),
        hasTasks: todayItems.length > 0,
      },
      {
        id: "tomorrow",
        label: t("home.tomorrowTitle"),
        short: t("home.tomorrowQuiet"),
        hasTasks: tomorrowItems.length > 0,
      },
      ...laterDayGroups.map((group) => ({
        id: group.dateKey,
        label: formatDate(middayIso(group.dateKey)),
        short: new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "short",
          timeZone: zone,
        }).format(new Date(middayIso(group.dateKey))),
        hasTasks: group.tasks.length > 0,
      })),
    ],
    [
      formatDate,
      laterDayGroups,
      locale,
      overdueItems.length,
      t,
      todayItems.length,
      tomorrowItems.length,
      zone,
    ],
  );

  const addCreatedTask = (task: Task) => {
    screen.setData((current) => {
      const base = current ?? {
        profile: {
          bio: null,
          values: [],
          communication_style: null,
          timezone,
          last_goal_checkin_on: dateKeyInZone(new Date(), timezone),
        },
        tasks: [],
        promises: [],
        goals: [],
      };
      return { ...base, tasks: upsertTask(base.tasks, task) };
    });
  };

  const changeStatus = async (task: Task, status: TaskStatus) => {
    const previous = screen.data;
    if (!previous) return;
    const stamp = new Date().toISOString();
    const optimistic = {
      ...task,
      status,
      updated_at: stamp,
      completed_at:
        status === "done"
          ? stamp
          : status === "todo" || status === "in_progress"
            ? null
            : task.completed_at,
    };
    addCreatedTask(optimistic);
    rememberArchiveState(optimistic);
    try {
      const updated = await api.setTaskStatus(task.id, status);
      addCreatedTask(updated);
      rememberArchiveState(updated);
    } catch {
      screen.setData(previous);
      rememberArchiveState(task);
    }
  };

  const listsFor = (id: DropListId): Task[] => {
    if (id === "unplanned") return undatedItems;
    if (id === "overdue") return overdueItems;
    if (id === "today") return todayItems;
    if (id === "tomorrow") return tomorrowItems;
    return laterDayGroups.find((group) => group.dateKey === id.slice(4))?.tasks ?? [];
  };

  const dueAtForList = (id: DropListId, task: Task): string | null => {
    if (id === "unplanned") return null;
    if (id === "overdue") return task.due_at ?? task.due_date ?? null;
    if (id === "today") {
      return middayIso(todayKey);
    }
    if (id === "tomorrow") return middayIso(tomorrowKey);
    return middayIso(id.slice(4));
  };

  const applyDrop = async (task: Task, target: DropListId, index: number) => {
    const destination = listsFor(target);
    const dueAt = dueAtForList(target, task);
    const recurrenceScope =
      task.recurrence_series_id || task.recurrence_frequency
        ? window.confirm(t("tasks.moveSeriesConfirm"))
          ? ("series" as const)
          : ("instance" as const)
        : undefined;
    const recurrenceFrequency =
      target === "unplanned" && recurrenceScope === "series" ? null : task.recurrence_frequency;
    const patches = planListReorder(destination, { ...task, due_at: dueAt }, index);
    const previous = screen.data;
    const byId = new Map((previous?.tasks ?? tasks).map((item) => [item.id, item]));
    for (const patch of patches) {
      const item = byId.get(patch.id) ?? task;
      addCreatedTask({
        ...item,
        due_at: item.id === task.id ? dueAt : item.due_at,
        recurrence_frequency: item.id === task.id ? recurrenceFrequency : item.recurrence_frequency,
        sort_order: patch.sort_order,
      });
    }
    try {
      for (const patch of patches) {
        const updated = await api.updateTask(
          patch.id,
          patch.id === task.id
            ? {
                due_at: dueAt,
                sort_order: patch.sort_order,
                recurrence_scope: recurrenceScope,
                recurrence_frequency: recurrenceFrequency,
              }
            : { sort_order: patch.sort_order },
        );
        addCreatedTask(updated);
      }
    } catch {
      if (previous) screen.setData(previous);
    }
  };

  const { drag, bindTask, holdingFrom, draggingRef } = useTaskDrag({
    desktop,
    onDrop: (task, target, index) => void applyDrop(task, target, index),
  });
  const scrollToPage = (index: number) => {
    const pager = pagerRef.current;
    if (pager) {
      const left = index * pager.clientWidth;
      if (typeof pager.scrollTo === "function") {
        pager.scrollTo({ left, behavior: "smooth" });
      } else {
        pager.scrollLeft = left;
      }
    }
    setPageIndex(index);
  };
  useDaySwipe({
    enabled:
      !desktop && tab === "planned" && !selected && !addingDate && !scheduling && !discussBroken,
    draggingRef,
    pageCount: dayPages.length,
    pagerRef,
    onIndex: scrollToPage,
  });
  useEffect(() => {
    if (drag?.over === "unplanned") setUnplannedOpen(true);
  }, [drag?.over]);
  useEffect(() => {
    const active = dayTabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [pageIndex]);
  const eveningScrolled = useRef(false);
  useEffect(() => {
    if (!eveningPlanMode || eveningScrolled.current) return;
    const tomorrowIdx = dayPages.findIndex((p) => p.id === "tomorrow");
    if (tomorrowIdx > 0) {
      eveningScrolled.current = true;
      scrollToPage(tomorrowIdx);
    }
  }, [eveningPlanMode, dayPages, scrollToPage]);

  const taskButton = (task: Task, dueLabel: string | null, list: DropListId, index: number) => {
    const due = task.due_at ?? task.due_date;
    const timeLabel = due && dueClock(due, zone) ? formatTime(due) : null;
    return (
      <HomeTaskButton
        key={task.id}
        task={task}
        aiTag={t("tasks.aiTag")}
        dueLabel={dueLabel}
        timeLabel={timeLabel}
        meetingLabel={task.kind === "meeting" ? t("tasks.kind.meeting") : null}
        pushLabel={isPushTask(task) ? t("tasks.pushTag") : null}
        pendingLabel={task.pending_sync && offline ? t("tasks.pendingSync") : null}
        insertBefore={drag?.over === list && drag.task.id !== task.id && drag.index === index}
        onSelect={setSelected}
        onComplete={(item) => void changeStatus(item, item.status === "done" ? "todo" : "done")}
        hold={{ ...bindTask(list), active: drag?.task.id === task.id }}
      />
    );
  };

  const addOnDate = (dateKey: string) => {
    const dateLabel = formatDate(middayIso(dateKey));
    return (
      <button
        type="button"
        className="home-add-date"
        onClick={() => setAddingDate(dateKey)}
        aria-label={
          dateKey === todayKey ? t("home.addToday") : t("home.addOnDateAria", { date: dateLabel })
        }
      >
        <span aria-hidden="true">＋</span>
        <span>{t("home.addOnDate")}</span>
      </button>
    );
  };

  const discussTomorrow = () => {
    navigate("/companion", {
      state: {
        draft: tomorrowDiscussPrompt(tomorrowItems, language),
        autoSend: true,
      },
    });
  };

  const pickToday = () => {
    navigate("/companion", {
      state: {
        draft: pickTodayPrompt(undatedItems, language),
        autoSend: true,
      },
    });
  };

  const scheduleOnDate = async (task: Task, dateKey: string) => {
    const previous = screen.data;
    const optimistic = { ...task, due_at: middayIso(dateKey) };
    addCreatedTask(optimistic);
    try {
      const updated = await api.updateTask(task.id, { due_at: middayIso(dateKey) });
      addCreatedTask(updated);
    } catch {
      if (previous) screen.setData(previous);
    }
  };

  const scheduleForTomorrow = async (task: Task) => {
    await scheduleOnDate(task, tomorrowKey);
  };

  const askIlziToSchedule = () => {
    const typed = scheduleAsk.trim();
    const context = scheduleTomorrowPrompt(undatedItems, tomorrowItems, language);
    setScheduling(false);
    setScheduleAsk("");
    navigate("/companion", {
      state: {
        draft: typed ? `${typed}\n\n${context}` : context,
        autoSend: true,
      },
    });
  };

  const weekSummaryShared = {
    completed: week.completed,
    percent: week.percent,
    onTime: week.on_time,
    dated: week.dated,
    text: t("home.weekSummaryText"),
    onTimeLabel: t("home.weekOnTime", {
      percent: week.percent,
      onTime: week.on_time,
      dated: week.dated,
    }),
    emptyOnTimeLabel: t("home.weekOnTimeEmpty"),
    ariaLabel: t("home.weekSummaryAria"),
  };

  const unplannedHeading = desktop ? (
    <div className="home-unplanned-heading">
      <button
        type="button"
        className={`home-day-tab home-unplanned-toggle ${
          unplannedOpen ? "home-day-tab-active" : ""
        } ${drag?.over === "unplanned" ? "home-day-tab-drop" : ""}`}
        aria-expanded={unplannedOpen}
        aria-controls="home-unplanned"
        data-drop-list={unplannedOpen ? undefined : "unplanned"}
        onClick={() => setUnplannedOpen((open) => !open)}
      >
        {t("home.unplanned")}
      </button>
      <Link className="back-link" to="/tasks">
        {t("common.all")}
      </Link>
    </div>
  ) : null;

  return (
    <div className="home-screen">
      <DailyDigest
        telegramLinked={Boolean(screen.data?.profile.telegram_id)}
        enabled={screen.data?.profile.morning_digest_enabled !== false}
      />
      {duePromises.length > 0 && (
        <section className="promise-checkin" aria-label={t("home.promisesAria")}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">{t("promises.eyebrow")}</p>
              <h2 className="text-lg font-bold leading-tight">{t("promises.dueTitle")}</h2>
            </div>
            <Link className="back-link" to="/promises">
              {t("common.all")}
            </Link>
          </div>
          <p className="mb-3 text-sm text-muted">{t("promises.dueText")}</p>
          {duePromises.slice(0, 3).map((promise) => (
            <Card key={promise.id} className="mb-2">
              <p className="font-bold">{promise.title}</p>
              <p className="mt-1 text-xs text-muted">
                {(promise.stats?.keeping_days ?? 0) === 0
                  ? t("promises.keepingToday")
                  : t("promises.keepingDays", { n: promise.stats?.keeping_days ?? 0 })}
              </p>
              {promise.stats?.praise_days ? (
                <p className="mt-1 text-sm text-accent">
                  {t("promises.praise", { n: promise.stats.praise_days })}
                </p>
              ) : null}
              <div className="chip-row mt-3">
                {(["keeping", "struggling", "broken"] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className="chip"
                    onClick={() => void checkInPromise(promise, status)}
                  >
                    {t(`promises.${status}`)}
                  </button>
                ))}
              </div>
            </Card>
          ))}
          <Button
            variant="secondary"
            className="mt-1 w-full"
            onClick={() =>
              navigate("/companion", {
                state: { draft: promiseCheckInPrompt(duePromises, language), autoSend: true },
              })
            }
          >
            {t("promises.discuss")}
          </Button>
        </section>
      )}

      {!desktop && (
        <div className="home-toolbar">
          <div className="home-segments" role="tablist" aria-label={t("nav.home")}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "planned"}
              className={`home-segment ${tab === "planned" ? "home-segment-active" : ""}`}
              onClick={() => setTab("planned")}
            >
              {t("home.scheduled")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "unplanned"}
              className={`home-segment ${tab === "unplanned" ? "home-segment-active" : ""}`}
              onClick={() => setTab("unplanned")}
            >
              {t("home.unplanned")}
            </button>
          </div>
          <Link className="back-link" to="/tasks">
            {t("common.all")}
          </Link>
        </div>
      )}

      <div
        className={`home-board ${desktop ? "home-board-split" : ""} ${
          desktop && unplannedOpen ? "home-board-split-open" : ""
        }`}
      >
        {desktop && unplannedHeading}
        {(desktop || tab === "planned") && (
          <>
            <div className="home-day-bar">
              <div
                ref={dayTabsRef}
                className="home-day-tabs"
                role="tablist"
                aria-label={t("home.scheduled")}
              >
                {dayPages.map((page, index) => {
                  const list: DropListId =
                    page.id === "overdue" || page.id === "today" || page.id === "tomorrow"
                      ? page.id
                      : `day:${page.id}`;
                  return (
                    <button
                      key={page.id}
                      type="button"
                      role="tab"
                      data-drop-list={list}
                      aria-selected={pageIndex === index}
                      className={`home-day-tab ${pageIndex === index ? "home-day-tab-active" : ""} ${
                        drag?.over === list ? "home-day-tab-drop" : ""
                      }`}
                      onClick={() => scrollToPage(index)}
                    >
                      <span>{page.short}</span>
                      {page.hasTasks ? (
                        <span className="home-day-tab-dot" aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <div
              ref={pagerRef}
              className="home-pager"
              onScroll={(event) => {
                const node = event.currentTarget;
                const width = node.clientWidth;
                if (!width) return;
                setPageIndex(Math.round(node.scrollLeft / width));
              }}
            >
              {overdueItems.length > 0 && (
                <section
                  className={`home-page home-drop-list ${
                    drag?.over === "overdue" ? "home-drop-list-active" : ""
                  }`}
                  aria-label={t("home.overdue")}
                  data-drop-list="overdue"
                >
                  <div className="home-task-list" data-drop-list="overdue" data-drop-body>
                    {overdueItems.map((task, index) =>
                      taskButton(
                        task,
                        (task.due_at ?? task.due_date)
                          ? formatDate(task.due_at ?? task.due_date!)
                          : null,
                        "overdue",
                        index,
                      ),
                    )}
                  </div>
                </section>
              )}

              <section
                className={`home-page home-drop-list ${drag?.over === "today" ? "home-drop-list-active" : ""}`}
                aria-label={t("home.todayAria")}
                data-drop-list="today"
              >
                {screen.loading && tasks.length === 0 ? (
                  <LoadingState label={t("home.loadingTasks")} />
                ) : screen.error && tasks.length === 0 ? (
                  <ErrorState message={screen.error} retry={screen.reload} />
                ) : !hasTodayWork ? (
                  <Card
                    className={`home-empty-card ${drag?.over === "today" ? "home-empty-drop" : ""}`}
                    data-drop-list="today"
                    data-drop-body
                  >
                    {drag && drag.from !== "today" ? (
                      <>
                        <p className="font-bold">{t("home.dropToday")}</p>
                        <p className="mt-1 text-sm text-muted">{t("home.dropHint")}</p>
                      </>
                    ) : weekRecap ? (
                      <WeekSummary
                        {...weekSummaryShared}
                        title={t("home.weekSummaryTitle", { count: week.completed })}
                        primaryLabel={eveningPlanMode ? t("home.discuss") : t("home.pickToday")}
                        secondaryLabel={t("home.schedule")}
                        onPrimary={eveningPlanMode ? discussTomorrow : pickToday}
                        onSecondary={() => setScheduling(true)}
                      />
                    ) : eveningPlanMode ? (
                      <>
                        <p className="font-bold">{t("home.eveningTitle")}</p>
                        <p className="mt-1 text-sm text-muted">{t("home.eveningText")}</p>
                        <div className="home-plan-actions">
                          <Button onClick={discussTomorrow}>{t("home.discuss")}</Button>
                          <Button variant="secondary" onClick={() => setScheduling(true)}>
                            {t("home.schedule")}
                          </Button>
                        </div>
                      </>
                    ) : completedToday.length > 0 ? (
                      <DayCelebration
                        count={completedToday.length}
                        streak={dayStreak}
                        milestone={dayMilestone}
                        title={t("home.celebrationTitle", { count: completedToday.length })}
                        text={t("home.celebrationText")}
                        streakLabel={t("home.streakLabel", { count: dayStreak })}
                        primaryLabel={t("home.pickToday")}
                        secondaryLabel={t("home.schedule")}
                        onPrimary={pickToday}
                        onSecondary={() => setScheduling(true)}
                      />
                    ) : isFirstRun ? (
                      <>
                        <p className="font-bold">{t("home.firstRunTitle")}</p>
                        <p className="mt-2 text-sm leading-relaxed text-muted">
                          {t("home.firstRunText")}
                        </p>
                        {firstGoal ? (
                          <p className="mt-2 text-sm">
                            {t("home.firstRunGoal", { title: firstGoal.title })}
                          </p>
                        ) : null}
                        <label className="mt-4 block">
                          <span className="mb-1.5 block text-sm font-semibold">
                            {t("home.firstRunDump")}
                          </span>
                          <textarea
                            className="input min-h-24"
                            value={dumpDraft}
                            onChange={(event) => setDumpDraft(event.target.value)}
                            placeholder={t("home.firstRunDumpHint")}
                          />
                        </label>
                        {dumpError ? (
                          <p className="error-text mt-2" role="alert">
                            {dumpError}
                          </p>
                        ) : null}
                        <div className="home-plan-actions mt-3">
                          <Button
                            disabled={dumpSaving || !dumpDraft.trim()}
                            onClick={async () => {
                              setDumpSaving(true);
                              setDumpError("");
                              try {
                                const result = await api.brainDump(dumpDraft);
                                if (result.skipped) {
                                  setDumpDraft("");
                                  return;
                                }
                                for (const task of result.tasks) addCreatedTask(task);
                                if (result.promise) {
                                  screen.setData((current) =>
                                    current
                                      ? {
                                          ...current,
                                          promises: [result.promise!, ...current.promises],
                                        }
                                      : current,
                                  );
                                }
                                setDumpDraft("");
                              } catch (cause) {
                                setDumpError(
                                  cause instanceof Error ? cause.message : t("common.saveFailed"),
                                );
                              } finally {
                                setDumpSaving(false);
                              }
                            }}
                          >
                            {dumpSaving ? t("common.saving") : t("home.firstRunDumpSubmit")}
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() => setAddingDate(dateKeyInZone(now, zone))}
                          >
                            {t("home.firstRunTask")}
                          </Button>
                        </div>
                        <div className="home-plan-actions mt-2">
                          <Button variant="secondary" onClick={() => navigate("/companion")}>
                            {t("home.firstRunTalk")}
                          </Button>
                          <Button variant="secondary" onClick={() => navigate("/import")}>
                            {t("home.firstRunImport")}
                          </Button>
                        </div>
                        {wasOnboardingSkipped() && (
                          <div className="home-plan-actions mt-2">
                            <Button variant="secondary" onClick={reopenOnboarding}>
                              {t("home.firstRunReopenOnboarding")}
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="font-bold">{t("home.emptyTitle")}</p>
                        <p className="mt-1 text-sm text-muted">{t("home.emptyText")}</p>
                        <div className="home-plan-actions">
                          <Button onClick={pickToday}>{t("home.pickToday")}</Button>
                        </div>
                      </>
                    )}
                  </Card>
                ) : (
                  <>
                    {weekRecap ? (
                      <WeekSummary
                        compact
                        {...weekSummaryShared}
                        title={t("home.weekSummaryCompactTitle", { count: week.completed })}
                      />
                    ) : null}
                    <div className="home-task-list" data-drop-list="today" data-drop-body>
                      {todayItems.map((task, index) => taskButton(task, null, "today", index))}
                    </div>
                  </>
                )}
                {addOnDate(todayKey)}
              </section>

              <section
                className={`home-page home-drop-list ${drag?.over === "tomorrow" ? "home-drop-list-active" : ""}`}
                aria-label={t("home.tomorrowAria")}
                data-drop-list="tomorrow"
              >
                {tomorrowItems.length === 0 ? (
                  <Card className="home-empty-card" data-drop-list="tomorrow" data-drop-body>
                    <p className="font-bold">{t("home.tomorrowEmpty")}</p>
                    <p className="mt-1 text-sm text-muted">{t("home.tomorrowEmptyText")}</p>
                  </Card>
                ) : (
                  <div className="home-task-list" data-drop-list="tomorrow" data-drop-body>
                    {tomorrowItems.map((task, index) => taskButton(task, null, "tomorrow", index))}
                  </div>
                )}
                <div className="home-plan-actions">
                  <Button variant="secondary" onClick={() => setScheduling(true)}>
                    {t("home.schedule")}
                  </Button>
                  <Button onClick={discussTomorrow}>{t("home.discuss")}</Button>
                </div>
                {addOnDate(tomorrowKey)}
              </section>

              {laterDayGroups.map((group) => {
                const list: DropListId = `day:${group.dateKey}`;
                return (
                  <section
                    key={group.dateKey}
                    className={`home-page home-drop-list ${drag?.over === list ? "home-drop-list-active" : ""}`}
                    aria-label={formatDate(middayIso(group.dateKey))}
                    data-drop-list={list}
                  >
                    {group.tasks.length === 0 ? (
                      <Card
                        className={`home-empty-card ${drag?.over === list ? "home-empty-drop" : ""}`}
                        data-drop-list={list}
                        data-drop-body
                      >
                        {drag && drag.from !== list ? (
                          <>
                            <p className="font-bold">{t("home.dropHint")}</p>
                            <p className="mt-1 text-sm text-muted">{t("home.laterEmptyText")}</p>
                          </>
                        ) : (
                          <>
                            <p className="font-bold">{t("home.laterEmpty")}</p>
                            <p className="mt-1 text-sm text-muted">{t("home.laterEmptyText")}</p>
                          </>
                        )}
                      </Card>
                    ) : (
                      <div className="home-task-list" data-drop-list={list} data-drop-body>
                        {group.tasks.map((task, index) =>
                          taskButton(
                            task,
                            (task.due_at ?? task.due_date)
                              ? formatDate(task.due_at ?? task.due_date!)
                              : null,
                            list,
                            index,
                          ),
                        )}
                      </div>
                    )}
                    {addOnDate(group.dateKey)}
                  </section>
                );
              })}
            </div>
          </>
        )}

        {(desktop || tab === "unplanned") &&
          (screen.loading && tasks.length === 0 && !desktop ? (
            <LoadingState label={t("home.loadingTasks")} />
          ) : !desktop || unplannedOpen ? (
            <UnplannedList
              tasks={undatedItems}
              empty={undatedItems.length === 0}
              aiTag={t("tasks.aiTag")}
              desktop={desktop}
              drag={drag}
              holdingFrom={holdingFrom}
              hold={bindTask("unplanned")}
              meetingLabel={(task) => (task.kind === "meeting" ? t("tasks.kind.meeting") : null)}
              pushLabel={(task) => (isPushTask(task) ? t("tasks.pushTag") : null)}
              pendingLabel={(task) =>
                task.pending_sync && offline ? t("tasks.pendingSync") : null
              }
              onSelect={setSelected}
              onComplete={(item) =>
                void changeStatus(item, item.status === "done" ? "todo" : "done")
              }
            />
          ) : null)}
      </div>
      {showGoalSync && (
        <p className="home-goal-hint" role="note" aria-label={t("home.goalSyncAria")}>
          <span>{t("home.goalSyncHint")}</span>
          <span className="home-goal-hint-actions">
            <button type="button" className="back-link" onClick={startGoalSync}>
              {t("home.goalSyncTalk")}
            </button>
            <button type="button" className="back-link" onClick={laterGoalSync}>
              {t("home.goalSyncLater")}
            </button>
          </span>
        </p>
      )}
      <TaskDragGhost drag={drag} />

      <Suspense fallback={null}>
        {selected && (
          <TaskCardModal
            task={selected}
            onClose={() => setSelected(null)}
            onUpdated={(task) => {
              addCreatedTask(task);
              rememberArchiveState(task);
              setSelected(task);
            }}
          />
        )}
        {addingDate && (
          <TaskFormModal
            defaultDueDate={addingDate}
            title={
              addingDate === todayKey
                ? t("home.addTodayTitle")
                : t("home.addDateTitle", { date: formatDate(middayIso(addingDate)) })
            }
            lead={addingDate === todayKey ? t("home.addTodayLead") : t("home.addDateLead")}
            onClose={() => setAddingDate(null)}
            onSaved={(task) => {
              addCreatedTask(task);
              setAddingDate(null);
            }}
          />
        )}
      </Suspense>
      {discussBroken && (
        <Modal title={discussBroken.title} onClose={() => setDiscussBroken(null)}>
          <p className="text-sm text-muted">{t("promises.dueText")}</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => setDiscussBroken(null)}>
              {t("common.close")}
            </Button>
            <Button
              onClick={() =>
                navigate("/companion", {
                  state: {
                    draft: promisePsychologistPrompt(discussBroken, language),
                    autoSend: true,
                  },
                })
              }
            >
              {t("promises.psychologist")}
            </Button>
          </div>
        </Modal>
      )}
      {scheduling && (
        <Modal title={t("home.scheduleTitle")} onClose={() => setScheduling(false)}>
          <p className="text-sm text-muted">{t("home.scheduleLead")}</p>
          {undatedItems.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t("home.scheduleEmpty")}</p>
          ) : (
            <div className="home-task-list mt-4">
              {undatedItems.map((task) => (
                <HomeTaskButton
                  key={task.id}
                  task={task}
                  aiTag={t("tasks.aiTag")}
                  dueLabel={null}
                  meetingLabel={task.kind === "meeting" ? t("tasks.kind.meeting") : null}
                  pushLabel={isPushTask(task) ? t("tasks.pushTag") : null}
                  pendingLabel={task.pending_sync && offline ? t("tasks.pendingSync") : null}
                  onSelect={(item) => void scheduleForTomorrow(item)}
                />
              ))}
            </div>
          )}
          <div className="mt-4">
            <ComposerBar
              docked={false}
              inputId="schedule-message"
              value={scheduleAsk}
              onChange={setScheduleAsk}
              onSubmit={askIlziToSchedule}
              placeholder={t("home.scheduleAsk")}
              label={t("home.scheduleAsk")}
              allowEmpty
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
