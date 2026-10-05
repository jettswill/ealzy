import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { taskDiscussPrompt } from "../direction-prompts";
import { useI18n } from "../i18n";
import { readDesktopNav } from "../media";
import { dueIso, splitDue, ESTIMATE_PRESETS, formatEstimate } from "../task-priority";
import { TASK_CREATED_EVENT } from "../task-sync";
import type {
  Goal,
  Project,
  Space,
  Task,
  TaskActivityType,
  TaskKind,
  TaskRecurrenceFrequency,
  TaskStatus,
} from "../types";
import { TASK_VALUE_EMOJIS, TASK_VALUE_SCORES, taskValueIndex } from "./TaskValue";
import { Button, Field, Modal, useAsyncData } from "./ui";

const NEW = "__new__";
const scale = [1, 2, 3, 4, 5] as const;
const activityTypes: TaskActivityType[] = [
  "development",
  "routine",
  "entertainment",
  "household",
  "degradation",
];
const statuses = ["todo", "in_progress", "done", "cancelled"] as const;

export function TaskFormModal({
  task,
  defaultDueDate,
  defaultGoalId,
  defaultProjectId,
  title,
  lead,
  onClose,
  onSaved,
}: {
  task?: Task | null;
  defaultDueDate?: string;
  defaultGoalId?: string;
  defaultProjectId?: string;
  title?: string;
  lead?: string;
  onClose: () => void;
  onSaved: (task: Task) => void;
}) {
  const { api } = useAuth();
  const { t, language, timezone } = useI18n();
  const navigate = useNavigate();
  const links = useAsyncData(
    () =>
      Promise.all([
        api.goals().catch(() => [] as Goal[]),
        api.projects().catch(() => [] as Project[]),
        api.people().catch(() => []),
        api.spaces().catch(() => [] as Space[]),
      ]),
    [api],
  );
  const due = splitDue(task?.due_at ?? task?.due_date, timezone);
  const [kind, setKind] = useState<TaskKind>(task?.kind === "meeting" ? "meeting" : "task");
  const [activityType, setActivityType] = useState<TaskActivityType | null>(
    task?.activity_type ?? null,
  );
  const [valueScore, setValueScore] = useState<number | null>(task?.value_score ?? null);
  const [estimateMinutes, setEstimateMinutes] = useState<number | null>(
    task?.estimate_minutes ?? null,
  );
  const [importance, setImportance] = useState(task?.importance ?? 3);
  const [urgency, setUrgency] = useState(task?.urgency ?? 3);
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "todo");
  const [recurrence, setRecurrence] = useState<TaskRecurrenceFrequency | "">(
    task?.recurrence_frequency ?? "",
  );
  const [goalChoice, setGoalChoice] = useState(task?.goal_id || defaultGoalId || "");
  const [projectChoice, setProjectChoice] = useState(task?.project_id || defaultProjectId || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [goals, projects, people, spaces] = links.data ?? [[], [], [], []];
  const editing = Boolean(task);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const forEalzy = form.get("assignee") === "ealzy";
    const date = String(form.get("due_date"));
    const time = String(form.get("due_time"));
    if (recurrence && !date) {
      setError(t("tasks.recurrenceNeedsDate"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      const goalId = await resolveGoal(goalChoice, String(form.get("new_goal")).trim(), goals);
      const projectId = await resolveProject(
        projectChoice,
        String(form.get("new_project")).trim(),
        projects,
      );
      const personId = String(form.get("person_id")) || undefined;
      const spaceId = String(form.get("space_id")) || undefined;
      const payload = {
        title: String(form.get("title")).trim(),
        description: String(form.get("description")).trim() || null,
        kind,
        activity_type: activityType,
        value_score: valueScore,
        estimate_minutes: estimateMinutes,
        importance,
        urgency,
        due_at: dueIso(date, time) ?? (forEalzy && !editing ? new Date().toISOString() : null),
        recurrence_frequency: recurrence || null,
        assignee: forEalzy ? ("ealzy" as const) : ("user" as const),
      };
      const recurrenceScope =
        task?.recurrence_series_id || task?.recurrence_frequency
          ? window.confirm(t("tasks.editSeriesConfirm"))
            ? ("series" as const)
            : ("instance" as const)
          : undefined;
      const saved = task
        ? await api.updateTask(task.id, {
            ...payload,
            recurrence_scope: recurrenceScope,
            status,
            person_id: personId || null,
            space_id: spaceId || null,
            goal_id: goalId || null,
            project_id: projectId || null,
          })
        : await api.createTask({
            ...payload,
            person_id: personId,
            space_id: spaceId,
            goal_id: goalId,
            project_id: projectId,
          });
      const person = personId ? people.find((item) => item.id === personId) : null;
      const space = spaceId ? spaces.find((item) => item.id === spaceId) : null;
      const goal = goalId ? goals.find((item) => item.id === goalId) : null;
      const project = projectId ? projects.find((item) => item.id === projectId) : null;
      onSaved({
        ...saved,
        kind,
        activity_type: activityType,
        value_score: valueScore,
        estimate_minutes: estimateMinutes,
        importance,
        urgency,
        status: task ? status : saved.status,
        person: person ? { id: person.id, name: person.name } : saved.person,
        space: space ? { id: space.id, name: space.name } : saved.space,
        goal: goal ? { id: goal.id, title: goal.title } : saved.goal,
        project: project ? { id: project.id, name: project.name } : saved.project,
      });
      if (!editing) {
        window.dispatchEvent(new CustomEvent(TASK_CREATED_EVENT, { detail: saved }));
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : editing
            ? t("common.saveFailed")
            : t("tasks.createFailed"),
      );
      setSaving(false);
    }
  };

  const resolveGoal = async (choice: string, name: string, current: Goal[]) => {
    if (choice && choice !== NEW) return choice;
    if (choice !== NEW || !name) return undefined;
    const created = await api.createGoal({ title: name, status: "active" });
    current.push(created);
    return created.id;
  };

  const resolveProject = async (choice: string, name: string, current: Project[]) => {
    if (choice && choice !== NEW) return choice;
    if (choice !== NEW || !name) return undefined;
    const created = await api.createProject({
      name,
      status: "active",
      goal_id: goalChoice && goalChoice !== NEW ? goalChoice : null,
    });
    current.push(created);
    return created.id;
  };

  return (
    <Modal
      title={title ?? (editing ? t("tasks.editTitle") : t("tasks.modalTitle"))}
      onClose={onClose}
    >
      <p className="mb-3 text-sm text-muted">{lead ?? t("tasks.modalLead")}</p>
      {editing && (
        <button
          type="button"
          className="back-link mb-5"
          onClick={() =>
            navigate("/companion", {
              state: { draft: taskDiscussPrompt(task!, language), autoSend: true },
            })
          }
        >
          {t("tasks.discuss")}
        </button>
      )}
      <form className="task-form" onSubmit={submit}>
        <div className="task-form-fields space-y-4">
          <Field label={t("tasks.fieldTitle")}>
            <input
              className="input"
              name="title"
              required
              autoFocus={!editing && readDesktopNav()}
              defaultValue={task?.title ?? ""}
            />
          </Field>
          <Field label={t("common.description")} hint={t("tasks.descriptionHint")}>
            <textarea
              className="input min-h-24"
              name="description"
              placeholder={t("tasks.descriptionPlaceholder")}
              defaultValue={task?.description ?? ""}
            />
          </Field>
          <Field label={t("common.type")}>
            <div className="chip-row" role="group">
              {(["task", "meeting"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`chip ${kind === value ? "chip-active" : ""}`}
                  onClick={() => setKind(value)}
                >
                  {t(`tasks.kind.${value}`)}
                </button>
              ))}
            </div>
          </Field>
          {editing && (
            <Field label={t("common.status")}>
              <select
                className="input"
                value={status}
                onChange={(event) => setStatus(event.target.value as TaskStatus)}
              >
                {statuses.map((value) => (
                  <option key={value} value={value}>
                    {t(`tasks.${value}`)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="form-grid form-grid-2">
            <Field label={kind === "meeting" ? t("tasks.meetingDate") : t("tasks.dueDate")}>
              <input
                className="input"
                type="date"
                name="due_date"
                defaultValue={due.date || defaultDueDate || ""}
              />
            </Field>
            <Field label={t("common.time")}>
              <input className="input" type="time" name="due_time" defaultValue={due.time} />
            </Field>
          </div>
          {/* Пятнадцать полей в один экран — ровно та сложность, от которой
              целевой сегмент и бежит: он пришёл выгрузить дело из головы, а не
              заполнять карточку. Наверху остаётся то, что нужно почти всегда;
              остальное — под раскрытием, ничего не удалено. */}
          <details className="form-more">
            <summary>{t("tasks.moreFields")}</summary>
            <div className="space-y-4 pt-4">
            <div className="form-grid form-grid-2">
              <Field label={t("tasks.activityType")}>
                <div className="chip-row" role="group" aria-label={t("tasks.activityType")}>
                  {activityTypes.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`chip ${activityType === value ? "chip-active" : ""}`}
                      onClick={() => setActivityType(activityType === value ? null : value)}
                    >
                      {t(`tasks.activityTypes.${value}`)}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label={t("tasks.value")}>
                <div className="scale-pills" role="group" aria-label={t("tasks.value")}>
                  {TASK_VALUE_SCORES.map((score) => (
                    <button
                      key={score}
                      type="button"
                      className={`scale-pill scale-pill-emoji ${valueScore === score ? "scale-pill-active" : ""}`}
                      onClick={() => setValueScore(valueScore === score ? null : score)}
                    >
                      {TASK_VALUE_EMOJIS[taskValueIndex(score)]}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <Field label={t("tasks.estimate")}>
              <div className="scale-pills" role="group" aria-label={t("tasks.estimate")}>
                {ESTIMATE_PRESETS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className={`scale-pill ${estimateMinutes === minutes ? "scale-pill-active" : ""}`}
                    onClick={() =>
                      setEstimateMinutes(estimateMinutes === minutes ? null : minutes)
                    }
                  >
                    {formatEstimate(minutes, language)}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={t("tasks.recurrence")}>
              <select
                className="input"
                value={recurrence}
                onChange={(event) =>
                  setRecurrence(event.target.value as TaskRecurrenceFrequency | "")
                }
              >
                <option value="">{t("tasks.recurrenceNone")}</option>
                <option value="daily">{t("tasks.recurrenceDaily")}</option>
                <option value="weekly">{t("tasks.recurrenceWeekly")}</option>
                <option value="monthly">{t("tasks.recurrenceMonthly")}</option>
              </select>
            </Field>
            <div className="form-grid form-grid-2">
              <ScaleField
                label={t("common.importance")}
                hint={t("tasks.importanceHint")}
                value={importance}
                onChange={setImportance}
              />
              <ScaleField
                label={t("tasks.urgency")}
                hint={t("tasks.urgencyHint")}
                value={urgency}
                onChange={setUrgency}
              />
            </div>
            <div className="form-grid form-grid-2">
              <Field label={t("tasks.goal")}>
                <select
                  className="input"
                  name="goal_id"
                  value={goalChoice}
                  onChange={(event) => setGoalChoice(event.target.value)}
                >
                  <option value="">{t("common.none")}</option>
                  {goals.map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {goal.title}
                    </option>
                  ))}
                  <option value={NEW}>{t("tasks.newGoal")}</option>
                </select>
                {goalChoice === NEW && (
                  <input
                    className="input mt-2"
                    name="new_goal"
                    placeholder={t("tasks.newGoalPlaceholder")}
                  />
                )}
              </Field>
              <Field label={t("tasks.project")}>
                <select
                  className="input"
                  name="project_id"
                  value={projectChoice}
                  onChange={(event) => setProjectChoice(event.target.value)}
                >
                  <option value="">{t("common.none")}</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                  <option value={NEW}>{t("tasks.newProject")}</option>
                </select>
                {projectChoice === NEW && (
                  <input
                    className="input mt-2"
                    name="new_project"
                    placeholder={t("tasks.newProjectPlaceholder")}
                  />
                )}
              </Field>
            </div>
            <Field label={t("spaces.space")}>
              <select className="input" name="space_id" defaultValue={task?.space_id ?? ""}>
                <option value="">{t("common.none")}</option>
                {spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </select>
            </Field>
            </div>
          </details>
          <Field label={t("tasks.person")}>
            <select className="input" name="person_id" defaultValue={task?.person_id ?? ""}>
              <option value="">{t("common.none")}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              name="assignee"
              value="ealzy"
              defaultChecked={task?.assignee === "ealzy"}
            />
            <span>
              <span className="font-bold">{t("tasks.forEalzy")}</span>
              <span className="mt-0.5 block text-muted">{t("tasks.forEalzyHint")}</span>
            </span>
          </label>
        </div>
        <div className="task-form-footer">
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <Button className="w-full" type="submit" disabled={saving}>
            {saving
              ? editing
                ? t("common.saving")
                : t("tasks.creating")
              : editing
                ? t("common.save")
                : t("tasks.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ScaleField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <div className="scale-pills" role="group" aria-label={label}>
        {scale.map((n) => (
          <button
            key={n}
            type="button"
            className={`scale-pill ${value === n ? "scale-pill-active" : ""}`}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </Field>
  );
}

export function TaskCardModal({
  task,
  onClose,
  onUpdated,
}: {
  task: Task;
  onClose: () => void;
  onUpdated: (task: Task) => void;
}) {
  return (
    <TaskFormModal
      task={task}
      onClose={onClose}
      onSaved={(updated) => {
        onUpdated(updated);
        onClose();
      }}
    />
  );
}
