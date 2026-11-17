import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useArchiveLinger } from "../archive-linger";
import { useAuth } from "../auth";
import { TaskCardModal, TaskFormModal } from "../components/TaskForm";
import { TaskTitleContent } from "../components/TaskValue";
import { MoreLink } from "../components/MoreLink";
import type { Task, TaskStatus } from "../types";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  useAsyncData,
} from "../components/ui";
import { taskDiscussPrompt } from "../direction-prompts";
import { useOpenOnCreateIntent } from "../create-intent";
import { useI18n } from "../i18n";
import { dueClock, formatEstimate, isPushTask } from "../task-priority";
import { snapshotTasks, subscribeTaskSnapshot, visibleTasks } from "../task-sync";
import { isArchivedTask, isOpenTask, sortTasks } from "../today-tasks";

type TaskFilter = "all" | "active" | "ealzy" | TaskStatus;

export function TasksPage() {
  const { api } = useAuth();
  const { t, language, formatDate } = useI18n();
  const navigate = useNavigate();
  const statusLabels: Record<TaskStatus, string> = {
    todo: t("tasks.todo"),
    in_progress: t("tasks.in_progress"),
    done: t("tasks.done"),
    cancelled: t("tasks.cancelled"),
  };
  const { data, setData, loading, error, reload } = useAsyncData(
    () =>
      api
        .tasks()
        .then((tasks) => visibleTasks(tasks))
        .catch(() => snapshotTasks()),
    [api],
    snapshotTasks,
    { live: true },
  );
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [creating, setCreating] = useState(false);
  useOpenOnCreateIntent(setCreating);
  const [selected, setSelected] = useState<Task | null>(null);
  const { lingeringIds, rememberArchiveState } = useArchiveLinger();
  useEffect(() => subscribeTaskSnapshot(setData), [setData]);
  const tasks = useMemo(
    () =>
      sortTasks(
        (data ?? []).filter((task) => {
          if (filter === "all") return true;
          if (filter === "ealzy") return task.assignee === "ealzy" && isOpenTask(task);
          if (filter === "active") return isOpenTask(task);
          return task.status === filter;
        }),
      ),
    [data, filter],
  );
  const openItems = useMemo(
    () => tasks.filter((task) => isOpenTask(task) || lingeringIds.has(task.id)),
    [lingeringIds, tasks],
  );
  const archivedItems = useMemo(
    () => tasks.filter((task) => isArchivedTask(task) && !lingeringIds.has(task.id)),
    [lingeringIds, tasks],
  );
  const talk = (task: Task) =>
    navigate("/companion", { state: { draft: taskDiscussPrompt(task, language), autoSend: true } });

  const changeStatus = async (task: Task, status: TaskStatus) => {
    const previous = data ?? [];
    const optimistic = { ...task, status };
    setData(previous.map((item) => (item.id === task.id ? optimistic : item)));
    rememberArchiveState(optimistic);
    try {
      const updated = await api.setTaskStatus(task.id, status);
      setData((current) => (current ?? []).map((item) => (item.id === task.id ? updated : item)));
      rememberArchiveState(updated);
    } catch {
      setData(previous);
      rememberArchiveState(task);
    }
  };

  const renderTask = (task: Task) => (
    <TaskRow
      key={task.id}
      task={task}
      statusLabels={statusLabels}
      formatDate={formatDate}
      onSelect={setSelected}
      onStatus={changeStatus}
      onTalk={talk}
    />
  );

  return (
    <>
      <Link className="back-link back-link-desktop mb-3 inline-flex" to="/">
        {t("tasks.back")}
      </Link>
      <PageHeader
        title={t("tasks.title")}
        description={t("tasks.description")}
        action={
          <div className="page-header-actions">
            <Button onClick={() => setCreating(true)}>{t("people.add")}</Button>
            <MoreLink />
          </div>
        }
      />
      <div className="chip-row" role="group" aria-label={t("tasks.filter")}>
        {(["all", "active", "ealzy", "todo", "in_progress", "done", "cancelled"] as const).map(
          (status) => (
            <button
              key={status}
              className={`chip ${filter === status ? "chip-active" : ""}`}
              onClick={() => setFilter(status)}
            >
              {status === "all"
                ? t("tasks.all")
                : status === "active"
                  ? t("tasks.active")
                  : status === "ealzy"
                    ? t("tasks.ealzy")
                    : status === "done"
                      ? t("tasks.archive")
                      : statusLabels[status]}
            </button>
          ),
        )}
      </div>

      {loading && tasks.length === 0 ? (
        <LoadingState label={t("tasks.loading")} />
      ) : error && tasks.length === 0 ? (
        <ErrorState message={error} retry={reload} />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon="✓"
          title={t("tasks.empty")}
          description={t("tasks.emptyText")}
          action={
            <Button variant="secondary" onClick={() => setCreating(true)}>
              {t("tasks.addTask")}
            </Button>
          }
        />
      ) : filter === "all" ? (
        <div className="mt-4 space-y-6">
          {openItems.length > 0 && (
            <section aria-label={t("tasks.open")}>
              <h2 className="home-section-title">{t("tasks.open")}</h2>
              <div className="space-y-3">{openItems.map(renderTask)}</div>
            </section>
          )}
          {archivedItems.length > 0 && (
            <section aria-label={t("tasks.archive")}>
              <h2 className="home-section-title">{t("tasks.archive")}</h2>
              <div className="space-y-3">{archivedItems.map(renderTask)}</div>
            </section>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">{tasks.map(renderTask)}</div>
      )}
      {creating && (
        <TaskFormModal
          onClose={() => setCreating(false)}
          onSaved={(task) => {
            setData((current) => [task, ...(current ?? []).filter((item) => item.id !== task.id)]);
            setCreating(false);
          }}
        />
      )}
      {selected && (
        <TaskCardModal
          task={selected}
          onClose={() => setSelected(null)}
          onUpdated={(task) => {
            setData((current) =>
              (current ?? []).map((item) => (item.id === task.id ? task : item)),
            );
            setSelected(task);
          }}
        />
      )}
    </>
  );
}

function TaskRow({
  task,
  statusLabels,
  formatDate,
  onSelect,
  onStatus,
  onTalk,
}: {
  task: Task;
  statusLabels: Record<TaskStatus, string>;
  formatDate: (value?: string | Date | null) => string;
  onSelect: (task: Task) => void;
  onStatus: (task: Task, status: TaskStatus) => void;
  onTalk: (task: Task) => void;
}) {
  const { t, language, timezone, formatTime } = useI18n();
  const archived = isArchivedTask(task);
  const due = task.due_at ?? task.due_date;
  const timeLabel = due && dueClock(due, timezone) ? formatTime(due) : null;
  const estimateLabel =
    task.estimate_minutes != null ? formatEstimate(task.estimate_minutes, language) : null;
  return (
    <Card className="flex gap-3">
      <button
        className={`task-check ${task.status === "done" ? "task-check-done" : ""}`}
        aria-label={
          task.status === "done"
            ? t("tasks.markTodo", { title: task.title })
            : t("tasks.markDone", { title: task.title })
        }
        onClick={() => void onStatus(task, task.status === "done" ? "todo" : "done")}
      >
        {task.status === "done" ? "✓" : ""}
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" className="w-full text-left" onClick={() => onSelect(task)}>
          <h2 className={`task-title ${archived ? "text-muted line-through" : ""}`}>
            <TaskTitleContent
              title={task.title}
              timeLabel={timeLabel}
              estimateLabel={estimateLabel}
              valueScore={task.value_score}
            />
          </h2>
          {task.description && <p className="mt-1 text-sm text-muted">{task.description}</p>}
        </button>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(task.due_at ?? task.due_date) && (
            <span className="tag">
              {t("tasks.due", { date: formatDate(task.due_at ?? task.due_date!) })}
            </span>
          )}
          {task.activity_type && (
            <span className="tag">{t(`tasks.activityTypes.${task.activity_type}`)}</span>
          )}
          <span className="tag">
            {t(`tasks.kind.${task.kind === "meeting" ? "meeting" : "task"}`)}
          </span>
          {task.assignee === "ealzy" && <span className="tag">{t("tasks.aiTag")}</span>}
          {isPushTask(task) && <span className="tag tag-push">{t("tasks.pushTag")}</span>}
          {task.person && (
            <Link className="tag tag-link" to={`/people/${task.person.id}`}>
              ◉ {task.person.name}
            </Link>
          )}
          {task.space && (
            <Link className="tag tag-link" to={`/spaces/${task.space.id}`}>
              ◇ {task.space.name}
            </Link>
          )}
          {task.goal && (
            <Link className="tag tag-link" to={`/goals/${task.goal.id}`}>
              ◎ {task.goal.title}
            </Link>
          )}
          {task.project && (
            <Link className="tag tag-link" to="/projects">
              ▣ {task.project.name}
            </Link>
          )}
          <select
            className="status-select"
            aria-label={t("tasks.statusFor", { title: task.title })}
            value={task.status}
            onChange={(event) => void onStatus(task, event.target.value as TaskStatus)}
          >
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button type="button" className="back-link" onClick={() => onTalk(task)}>
            {t("tasks.discuss")}
          </button>
        </div>
      </div>
    </Card>
  );
}
