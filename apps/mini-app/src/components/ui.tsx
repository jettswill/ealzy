import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveRefresh } from "../live-refresh";
import { useI18nOptional } from "../i18n";
import { isAbortError } from "../api";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="mt-1.5 max-w-xl text-sm text-muted">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  return <button {...props} className={`button button-${variant} ${className}`} />;
}

export function IconButton({
  label,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const i18n = useI18nOptional();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="modal-panel"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id="modal-title" className="text-lg font-semibold tracking-[-0.02em]">
            {title}
          </h2>
          <IconButton label={i18n?.t("common.close") ?? "Close"} onClick={onClose}>
            ×
          </IconButton>
        </div>
        {children}
      </section>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="block">
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">{label}</span>
        {children}
      </label>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="text-3xl" aria-hidden="true">
        {icon}
      </span>
      <h2 className="mt-3 font-bold">{title}</h2>
      <p className="mt-1 max-w-xs text-sm text-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ label }: { label?: string }) {
  const i18n = useI18nOptional();
  const text = label ?? i18n?.t("common.loading") ?? "Loading";
  return (
    <div className="empty-state" role="status">
      <span className="spinner" aria-hidden="true" />
      <p className="mt-3 text-sm text-muted">{text}…</p>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  const i18n = useI18nOptional();
  return (
    <div className="empty-state" role="alert">
      <span className="text-3xl" aria-hidden="true">
        ↻
      </span>
      <h2 className="mt-3 font-bold">{i18n?.t("common.errorTitle") ?? "Something went wrong"}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>
      {retry && (
        <Button className="mt-4" onClick={retry}>
          {i18n?.t("common.retry") ?? "Try again"}
        </Button>
      )}
    </div>
  );
}

export function useAsyncData<T>(
  loader: () => Promise<T>,
  dependencies: unknown[] = [],
  initial?: T | (() => T),
  options?: { live?: boolean },
) {
  const [data, setData] = useState<T | null>(() =>
    initial === undefined ? null : typeof initial === "function" ? (initial as () => T)() : initial,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(data == null);
  const [version, setVersion] = useState(0);
  const dataRef = useRef(data);
  dataRef.current = data;
  const reload = useCallback((mode?: { silent?: boolean }) => {
    if (!mode?.silent) {
      setError(null);
      setLoading(true);
    }
    setVersion((value) => value + 1);
  }, []);
  useLiveRefresh(() => reload({ silent: true }), Boolean(options?.live));

  useEffect(() => {
    let active = true;
    loader()
      .then((value) => {
        if (!active) return;
        setData(value);
        setError(null);
      })
      .catch((cause: unknown) => {
        // Отменённый запрос — это наш собственный дубликат, а не сбой связи.
        if (!active || dataRef.current != null || isAbortError(cause)) return;
        setError(cause instanceof Error ? cause.message : "Request failed");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // Callers provide the values that make their loader change.
  }, [...dependencies, version]);

  return { data, setData, error, loading, reload };
}

export function formatDate(value?: string): string {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
