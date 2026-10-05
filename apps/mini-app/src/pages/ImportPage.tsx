import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { Button, Card, Field, PageHeader } from "../components/ui";
import { useI18n } from "../i18n";
import type { ImportItem, ImportSession } from "../types";

type Tab = "text" | "todoist";

function formatDue(value: string | null, formatDate: (iso: string) => string) {
  return value ? formatDate(value) : "—";
}

export function ImportPage() {
  const { api } = useAuth();
  const { t, formatDate } = useI18n();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get("session") ? "todoist" : "text");
  const [text, setText] = useState("");
  const [token, setToken] = useState("");
  const [oauth, setOauth] = useState(false);
  const [session, setSession] = useState<ImportSession | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get("error") ?? "");

  useEffect(() => {
    void api.importTodoistStatus().then((status) => setOauth(status.oauth)).catch(() => undefined);
  }, [api]);

  useEffect(() => {
    const id = params.get("session");
    if (!id) return;
    setTab("todoist");
    void api
      .importSession(id)
      .then((loaded) => {
        setSession(loaded);
        setSkip(new Set(loaded.items.filter((item) => item.duplicate).map((item) => item.id)));
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : t("import.failed"));
      });
  }, [api, params, t]);

  const selectedCount = useMemo(() => {
    if (!session) return 0;
    return session.items.filter((item) => !skip.has(item.id) && !item.duplicate).length;
  }, [session, skip]);

  const runPreview = async () => {
    setBusy(true);
    setError("");
    try {
      const next =
        tab === "text"
          ? await api.previewTextImport(text)
          : await api.previewTodoistImport(token);
      setSession(next);
      setSkip(new Set(next.items.filter((item) => item.duplicate).map((item) => item.id)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("import.failed"));
    } finally {
      setBusy(false);
    }
  };

  const connectTodoist = async () => {
    setBusy(true);
    setError("");
    try {
      const { url } = await api.importTodoistStart();
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("import.oauthMissing"));
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const next = await api.confirmImport(session.id, [...skip]);
      setSession(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("import.failed"));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (item: ImportItem) => {
    setSkip((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  return (
    <>
      <PageHeader title={t("import.title")} description={t("import.description")} />
      <div className="chip-row mb-4" role="tablist" aria-label={t("import.title")}>
        <button
          type="button"
          className={`chip ${tab === "text" ? "chip-active" : ""}`}
          onClick={() => setTab("text")}
        >
          {t("import.textTab")}
        </button>
        <button
          type="button"
          className={`chip ${tab === "todoist" ? "chip-active" : ""}`}
          onClick={() => setTab("todoist")}
        >
          {t("import.todoistTab")}
        </button>
      </div>
      {error && (
        <p className="error-text mb-4" role="alert">
          {error}
        </p>
      )}
      {!session && tab === "text" && (
        <Card>
          <Field label={t("import.textLabel")} hint={t("import.textHint")}>
            <textarea
              className="input min-h-40"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={"Купить молоко\nПозвонить маме завтра\nОтчёт 15.09"}
            />
          </Field>
          <Button className="mt-3" disabled={busy || !text.trim()} onClick={() => void runPreview()}>
            {busy ? t("import.previewing") : t("import.preview")}
          </Button>
        </Card>
      )}
      {!session && tab === "todoist" && (
        <Card>
          <p className="text-sm text-muted">{t("import.todoistHint")}</p>
          {oauth && (
            <Button className="mt-3" disabled={busy} onClick={() => void connectTodoist()}>
              {t("import.connect")}
            </Button>
          )}
          <Field label={t("import.tokenLabel")} hint={t("import.tokenHint")}>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </Field>
          <Button
            className="mt-3"
            variant={oauth ? "secondary" : "primary"}
            disabled={busy || token.trim().length < 8}
            onClick={() => void runPreview()}
          >
            {busy ? t("import.previewing") : t("import.preview")}
          </Button>
        </Card>
      )}
      {session && (
        <Card>
          {session.status === "confirmed" ? (
            <>
              <p className="font-bold">{t("import.done")}</p>
              <p className="mt-1 text-sm text-muted">
                {t("import.doneText", {
                  tasks: Number(session.log.created_tasks ?? 0),
                  projects: Number(session.log.created_projects ?? 0),
                  skipped: Number(session.log.skipped_duplicates ?? 0),
                })}
              </p>
              <div className="home-plan-actions mt-3">
                <Link className="chip chip-active" to="/">
                  {t("nav.home")}
                </Link>
                <Link className="chip" to="/tasks">
                  {t("nav.allTasks")}
                </Link>
              </div>
            </>
          ) : (
            <>
              <p className="font-bold">{t("import.previewTitle")}</p>
              <p className="mt-1 text-sm text-muted">
                {t("import.previewText", { count: selectedCount })}
              </p>
              <ul className="import-list">
                {session.items.map((item) => (
                  <li key={item.id}>
                    <label className={`import-row ${item.duplicate ? "import-row-dup" : ""}`}>
                      <input
                        type="checkbox"
                        checked={!skip.has(item.id)}
                        onChange={() => toggle(item)}
                      />
                      <span>
                        <span className="import-kind">
                          {item.kind === "project" ? t("import.project") : t("import.task")}
                        </span>
                        <span className="font-bold">{item.title}</span>
                        {item.project_title && (
                          <span className="text-muted"> · {item.project_title}</span>
                        )}
                        {item.kind === "task" && (
                          <span className="text-muted"> · {formatDue(item.due_at, formatDate)}</span>
                        )}
                        {item.duplicate && (
                          <span className="import-dup"> {t("import.duplicate")}</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="home-plan-actions mt-3">
                <Button disabled={busy || selectedCount === 0} onClick={() => void confirm()}>
                  {busy ? t("import.importing") : t("import.confirm")}
                </Button>
                <Button variant="secondary" onClick={() => setSession(null)}>
                  {t("common.back")}
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </>
  );
}
