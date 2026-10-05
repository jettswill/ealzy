import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import type { Goal, Project, ProjectStatus, Space } from "../types";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  useAsyncData,
} from "../components/ui";
import { useI18n } from "../i18n";

const statuses: ProjectStatus[] = ["active", "paused", "completed", "cancelled"];

export function ProjectsPage() {
  const { api } = useAuth();
  const { t } = useI18n();
  const state = useAsyncData(
    async () => {
      const [projects, goals, spaces] = await Promise.all([
        api.projects(),
        api.goals(),
        api.spaces(),
      ]);
      return { projects, goals, spaces };
    },
    [api],
    undefined,
    { live: true },
  );
  const [editing, setEditing] = useState<Project | "new" | null>(null);
  const [error, setError] = useState("");
  const projects = state.data?.projects ?? [];
  return (
    <>
      <Link className="back-link" to="/">
        {t("common.back")}
      </Link>
      <PageHeader
        eyebrow={t("projects.eyebrow")}
        title={t("projects.title")}
        description={t("projects.description")}
        action={<Button onClick={() => setEditing("new")}>{t("projectsPage.add")}</Button>}
      />
      {error && (
        <p className="error-text mb-3" role="alert">
          {error}
        </p>
      )}
      {state.loading ? (
        <LoadingState label={t("projects.loading")} />
      ) : state.error ? (
        <ErrorState message={state.error} retry={state.reload} />
      ) : !projects.length ? (
        <EmptyState
          icon="▦"
          title={t("projects.empty")}
          description={t("projects.emptyText")}
          action={
            <Button variant="secondary" onClick={() => setEditing("new")}>
              {t("projects.create")}
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {projects.map((project) => (
            <Card key={project.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="tag">{t(`status.${project.status}`)}</span>
                  <h2 className="mt-2 font-bold">{project.name}</h2>
                  {project.description && (
                    <p className="mt-1 text-sm text-muted">{project.description}</p>
                  )}
                  {project.goal && <span className="tag mt-3">◎ {project.goal.title}</span>}
                  {project.space && (
                    <Link
                      className="tag tag-link mt-3 inline-flex"
                      to={`/spaces/${project.space.id}`}
                    >
                      ◇ {project.space.name}
                    </Link>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    className="icon-button"
                    aria-label={t("common.editNamed", { name: project.name })}
                    onClick={() => setEditing(project)}
                  >
                    ✎
                  </button>
                  <button
                    className="icon-button"
                    aria-label={t("common.deleteNamed", { name: project.name })}
                    onClick={async () => {
                      if (!window.confirm(t("projectsPage.deleteConfirm"))) return;
                      try {
                        await api.deleteProject(project.id);
                        state.setData((current) =>
                          current
                            ? {
                                ...current,
                                projects: current.projects.filter((item) => item.id !== project.id),
                              }
                            : current,
                        );
                      } catch (cause) {
                        setError(
                          cause instanceof Error ? cause.message : t("projectsPage.deleteFailed"),
                        );
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <ProjectForm
          project={editing === "new" ? undefined : editing}
          goals={state.data?.goals ?? []}
          spaces={state.data?.spaces ?? []}
          onClose={() => setEditing(null)}
          onSaved={(project) => {
            state.setData((current) =>
              current
                ? {
                    ...current,
                    projects:
                      editing === "new"
                        ? [project, ...current.projects]
                        : current.projects.map((item) => (item.id === project.id ? project : item)),
                  }
                : current,
            );
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function ProjectForm({
  project,
  goals,
  spaces,
  onClose,
  onSaved,
}: {
  project?: Project;
  goals: Goal[];
  spaces: Space[];
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const input = {
      name: String(form.get("name")).trim(),
      description: String(form.get("description")).trim() || null,
      status: String(form.get("status")) as ProjectStatus,
      goal_id: String(form.get("goal_id")) || null,
      space_id: String(form.get("space_id")) || null,
    };
    try {
      onSaved(
        project ? await api.updateProject(project.id, input) : await api.createProject(input),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("projectsPage.saveFailed"));
      setSaving(false);
    }
  };
  return (
    <Modal title={project ? t("projects.edit") : t("projects.create")} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("common.name")}>
          <input className="input" name="name" defaultValue={project?.name} required autoFocus />
        </Field>
        <Field label={t("common.description")}>
          <textarea
            className="input min-h-24"
            name="description"
            defaultValue={project?.description ?? ""}
          />
        </Field>
        <Field label={t("plan.goals")}>
          <select className="input" name="goal_id" defaultValue={project?.goal_id ?? ""}>
            <option value="">{t("common.noGoal")}</option>
            {goals.map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("plan.spaces")}>
          <select className="input" name="space_id" defaultValue={project?.space_id ?? ""}>
            <option value="">{t("common.noSpace")}</option>
            {spaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("common.status")}>
          <select className="input" name="status" defaultValue={project?.status ?? "active"}>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {t(`status.${status}`)}
              </option>
            ))}
          </select>
        </Field>
        {error && <p className="error-text">{error}</p>}
        <Button className="w-full" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("projectsPage.save")}
        </Button>
      </form>
    </Modal>
  );
}
