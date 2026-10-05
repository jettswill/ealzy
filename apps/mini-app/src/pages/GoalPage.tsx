import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth";
import { TaskCardModal, TaskFormModal } from "../components/TaskForm";
import { Button, Card, ErrorState, LoadingState, useAsyncData } from "../components/ui";
import {
  goalCheckInPrompt,
  goalDiscussPrompt,
  goalPlanPrompt,
  goalRelevancePrompt,
  taskDiscussPrompt,
} from "../direction-prompts";
import { useI18n } from "../i18n";
import type { Task, TaskStatus } from "../types";
import { GoalForm } from "./GoalsPage";

export function GoalPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { api } = useAuth();
  const { t, language, formatDate } = useI18n();
  const state = useAsyncData(() => api.goal(id), [api, id], undefined, { live: true });
  const [editing, setEditing] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  if (state.loading) return <LoadingState label={t("goalsPage.loadingOne")} />;
  if (state.error || !state.data)
    return <ErrorState message={state.error ?? t("goalsPage.missing")} retry={state.reload} />;
  const goal = state.data;
  const stats = goal.stats;
  const tasks = goal.tasks ?? [];
  const talk = (draft: string) => navigate("/companion", { state: { draft, autoSend: true } });
  return (
    <>
      <Link className="back-link" to="/goals">
        {t("goals.backList")}
      </Link>
      <header className="my-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{t("goals.title")}</p>
            <h1 className="text-2xl font-bold">{goal.title}</h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="tag">{t(`status.${goal.status}`)}</span>
              {goal.horizon && (
                <span className="tag">
                  {goal.horizon === "long"
                    ? t("goals.longTitle")
                    : goal.horizon === "medium"
                      ? t("goals.mediumTitle")
                      : t("goals.shortTitle")}
                </span>
              )}
            </div>
          </div>
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {t("common.edit")}
          </Button>
        </div>
        {goal.description && <p className="mt-4 leading-relaxed">{goal.description}</p>}
      </header>
      <Card className="mb-4">
        <p className="eyebrow">{t("goals.planTitle")}</p>
        <p className="mt-2 whitespace-pre-wrap leading-relaxed">
          {goal.current_plan?.trim() ? goal.current_plan : t("goals.planEmpty")}
        </p>
      </Card>
      <Card className="mb-4">
        {stats && (
          <>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${stats.progress}%` }} />
            </div>
            <p className="mt-2 text-sm">
              {stats.task_count
                ? t("goals.progress", { done: stats.done_count, total: stats.task_count })
                : t("goals.noTasks")}
              {" · "}
              {t("goals.daysActive", { n: stats.days_active })}
            </p>
          </>
        )}
        {goal.target_date && (
          <p className="mt-1 text-sm text-muted">
            {t("goals.target", { date: formatDate(goal.target_date) })}
          </p>
        )}
        <div className="home-plan-actions mt-4">
          <Button variant="secondary" onClick={() => talk(goalCheckInPrompt(goal, language))}>
            {t("goals.checkIn")}
          </Button>
          <Button variant="secondary" onClick={() => talk(goalRelevancePrompt(goal, language))}>
            {t("goals.relevance")}
          </Button>
          <Button variant="secondary" onClick={() => talk(goalPlanPrompt(goal, language))}>
            {t("goals.plan")}
          </Button>
          <Button onClick={() => talk(goalDiscussPrompt(goal, language))}>
            {t("goals.discuss")}
          </Button>
        </div>
      </Card>
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-bold">{t("goals.tasksTitle")}</h2>
          <Button variant="secondary" onClick={() => setAddingTask(true)}>
            {t("goals.addTask")}
          </Button>
        </div>
        {tasks.length ? (
          <div className="space-y-2">
            {tasks.map((task) => (
              <Card key={task.id}>
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setSelectedTask(task)}
                  >
                    <p className="task-title">{task.title}</p>
                    <p className="text-xs text-muted">
                      {t(`tasks.${task.status as TaskStatus}`)}
                      {task.assignee === "ealzy" ? ` · ${t("tasks.aiTag")}` : ""}
                    </p>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      type="button"
                      className="back-link"
                      onClick={() => talk(taskDiscussPrompt(task, language))}
                    >
                      {t("tasks.discuss")}
                    </button>
                    <Link className="back-link" to="/tasks">
                      {t("common.all")}
                    </Link>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">{t("goals.noTasks")}</p>
        )}
      </section>
      {editing && (
        <GoalForm
          goal={goal}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            state.setData({ ...goal, ...updated, tasks, stats });
            setEditing(false);
          }}
        />
      )}
      {addingTask && (
        <TaskFormModal
          defaultGoalId={goal.id}
          title={t("goals.addTask")}
          onClose={() => setAddingTask(false)}
          onSaved={(task) => {
            const next = [task, ...tasks];
            const counted = next.filter((item) => item.status !== "cancelled").length;
            const done = next.filter((item) => item.status === "done").length;
            state.setData({
              ...goal,
              tasks: next,
              stats: {
                task_count: counted,
                done_count: done,
                open_count: next.filter(
                  (item) => item.status === "todo" || item.status === "in_progress",
                ).length,
                progress: counted ? Math.round((done / counted) * 100) : 0,
                days_active: stats?.days_active ?? 0,
              },
            });
            setAddingTask(false);
          }}
        />
      )}
      {selectedTask && (
        <TaskCardModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdated={(task) => {
            state.setData({
              ...goal,
              tasks: tasks.map((item) => (item.id === task.id ? task : item)),
            });
            setSelectedTask(task);
          }}
        />
      )}
    </>
  );
}
