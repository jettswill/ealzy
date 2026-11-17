import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Task } from "../types";
import { useI18n } from "../i18n";
import { Modal } from "./ui";

const PIN_PREFIX = "ealzy.main.";

/** «Вторник, 17 ноября» — с заглавной только первая буква, как в iOS. */
export function homeDayTitle(now: Date, locale: string, timeZone: string) {
  let text: string;
  try {
    text = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone,
    }).format(now);
  } catch {
    text = now.toDateString();
  }
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

function pinnedId(dateKey: string) {
  try {
    return localStorage.getItem(PIN_PREFIX + dateKey);
  } catch {
    return null;
  }
}

export function pinMainTask(dateKey: string, taskId: string) {
  try {
    // Закреп живёт один день: старые дни подчищаем.
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(PIN_PREFIX) && key !== PIN_PREFIX + dateKey) localStorage.removeItem(key);
    }
    localStorage.setItem(PIN_PREFIX + dateKey, taskId);
  } catch {
    // Без хранилища главным остаётся первое дело дня.
  }
}

/** Главное — закреплённое на сегодня, иначе первое открытое дело дня. */
export function pickMainTask(open: Task[], dateKey: string): Task | null {
  if (open.length === 0) return null;
  const pinned = pinnedId(dateKey);
  return open.find((task) => task.id === pinned) ?? open[0];
}

/** То, что в «ёлочках», — курсивом и золотом, как в iOS. */
export function lampTitle(title: string): ReactNode {
  const open = title.indexOf("«");
  const close = open >= 0 ? title.indexOf("»", open) : -1;
  if (open < 0 || close < 0) return title;
  return (
    <>
      {title.slice(0, open)}
      <em className="lamp-quote">{title.slice(open, close + 1)}</em>
      {title.slice(close + 1)}
    </>
  );
}

export function HomeMainTask({
  task,
  aiTag,
  timeLabel,
  canChange,
  onOpen,
  onDone,
  onChange,
  hold,
}: {
  task: Task;
  aiTag: string;
  hold?: {
    active: boolean;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>, task: Task) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  timeLabel: string | null;
  canChange: boolean;
  onOpen: (task: Task) => void;
  onDone: (task: Task) => void;
  onChange: () => void;
}) {
  const { t } = useI18n();
  const name = task.assignee === "ealzy" ? `${aiTag} · ${task.title}` : task.title;
  // Главное можно, как и строки дня, зажать и перенести на другой день или ниже по списку.
  const skipClick = useRef(false);
  const holdProps = hold
    ? {
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => hold.onPointerDown(event, task),
        onPointerMove: hold.onPointerMove,
        onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
          if (hold.active) skipClick.current = true;
          hold.onPointerUp(event);
        },
        onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => hold.onPointerUp(event),
      }
    : {};
  return (
    <article className={`home-main ${hold?.active ? "home-task-held" : ""}`} data-task-id={task.id}>
      <p className="home-main-eyebrow">
        {t("home.mainEyebrow")}
        {timeLabel ? <span className="home-main-time"> · {timeLabel}</span> : null}
      </p>
      <button
        type="button"
        className="home-main-title"
        aria-label={name}
        onClick={() => {
          if (skipClick.current) {
            skipClick.current = false;
            return;
          }
          onOpen(task);
        }}
        {...holdProps}
      >
        {lampTitle(task.title)}
      </button>
      <div className="home-main-actions">
        <button
          type="button"
          className="button button-primary home-main-done"
          aria-label={t("tasks.markDone", { title: task.title })}
          onClick={() => onDone(task)}
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M4.5 10.5l3.5 3.5 7.5-8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t("home.mainDone")}
        </button>
        {canChange ? (
          <button type="button" className="button button-ghost" onClick={onChange}>
            {t("home.mainChange")}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function MainTaskPicker({
  tasks,
  currentId,
  aiTag,
  onPick,
  onClose,
}: {
  tasks: Task[];
  currentId: string | null;
  aiTag: string;
  onPick: (task: Task) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal title={t("home.mainPickTitle")} onClose={onClose}>
      <p className="text-sm text-muted">{t("home.mainPickLead")}</p>
      <div className="main-picker mt-4" role="radiogroup" aria-label={t("home.mainPickTitle")}>
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            role="radio"
            aria-checked={task.id === currentId}
            className={`main-picker-row ${task.id === currentId ? "main-picker-row-active" : ""}`}
            onClick={() => onPick(task)}
          >
            <span className="main-picker-dot" aria-hidden="true" />
            <span>{task.assignee === "ealzy" ? `${aiTag} · ${task.title}` : task.title}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
