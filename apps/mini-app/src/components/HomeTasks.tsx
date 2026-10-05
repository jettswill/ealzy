import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Card } from "./ui";
import { useI18n } from "../i18n";
import { formatEstimate } from "../task-priority";
import type { Task } from "../types";
import { TaskTitleContent } from "./TaskValue";

export const LONG_PRESS_MS = 420;
export const DAY_SWIPE_LOCK_PX = 12;
const MOVE_CANCEL_PX = 24;

export type DropListId = "unplanned" | "overdue" | "today" | "tomorrow" | `day:${string}`;

export type TaskDragState = {
  task: Task;
  from: DropListId;
  x: number;
  y: number;
  over: DropListId | null;
  index: number;
};

export function HomeTaskButton({
  task,
  aiTag,
  dueLabel,
  timeLabel = null,
  meetingLabel = null,
  pushLabel = null,
  pendingLabel,
  insertBefore = false,
  onSelect,
  onComplete,
  hold,
}: {
  task: Task;
  aiTag: string;
  dueLabel: string | null;
  timeLabel?: string | null;
  meetingLabel?: string | null;
  pushLabel?: string | null;
  pendingLabel: string | null;
  insertBefore?: boolean;
  onSelect: (task: Task) => void;
  onComplete?: (task: Task) => void;
  hold?: {
    active: boolean;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>, task: Task) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}) {
  const { t, language } = useI18n();
  const done = task.status === "done";
  const archived = done || task.status === "cancelled";
  const activityLabel = task.activity_type ? t(`tasks.activityTypes.${task.activity_type}`) : null;
  const estimateLabel =
    task.estimate_minutes != null ? formatEstimate(task.estimate_minutes, language) : null;
  const meta = [meetingLabel, pushLabel, dueLabel, pendingLabel]
    .filter(Boolean)
    .join(" · ");
  const skipClick = useRef(false);
  const title = (
    <>
      <span className={`task-title ${archived ? "text-muted line-through" : ""}`}>
        <TaskTitleContent
          title={`${task.assignee === "ealzy" ? `${aiTag} · ` : ""}${task.title}`}
          timeLabel={timeLabel}
          estimateLabel={estimateLabel}
          valueScore={task.value_score}
        />
      </span>
      {activityLabel ? <span className="task-secondary">{activityLabel}</span> : null}
      {meta && <span className="mt-0.5 block text-xs text-muted">{meta}</span>}
    </>
  );
  const open = () => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    onSelect(task);
  };
  const holdProps = hold
    ? {
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => hold.onPointerDown(event, task),
        onPointerMove: hold.onPointerMove,
        onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
          if (hold.active) skipClick.current = true;
          hold.onPointerUp(event);
        },
        onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => hold.onPointerUp(event),
        onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
      }
    : {};
  const insertClass = insertBefore ? "home-drop-before" : "";
  if (!onComplete) {
    return (
      <button
        type="button"
        data-task-id={task.id}
        className={`home-task ${hold?.active ? "home-task-held" : ""} ${insertClass}`}
        onClick={open}
        {...holdProps}
      >
        <span className={`task-dot task-dot-${task.status}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 text-left">{title}</span>
      </button>
    );
  }
  return (
    <div
      data-task-id={task.id}
      className={`home-task ${archived ? "home-task-archived" : ""} ${hold?.active ? "home-task-held" : ""} ${insertClass}`}
    >
      <button
        type="button"
        className={`task-check ${done ? "task-check-done" : ""}`}
        aria-label={
          done
            ? t("tasks.markTodo", { title: task.title })
            : t("tasks.markDone", { title: task.title })
        }
        onClick={() => onComplete(task)}
      >
        {done ? "✓" : ""}
      </button>
      <button
        type="button"
        className="home-task-main"
        aria-label={task.assignee === "ealzy" ? `${aiTag} · ${task.title}` : task.title}
        onClick={open}
        {...holdProps}
      >
        <span className="home-task-grip" aria-hidden="true">
          ⠿
        </span>
        <span className="min-w-0 flex-1">{title}</span>
      </button>
    </div>
  );
}

function indexInList(list: DropListId, y: number, draggedId?: string) {
  const root = document.querySelector<HTMLElement>(
    `[data-drop-list="${cssEscape(list)}"][data-drop-body]`,
  );
  if (!root) return 0;
  const items = [...root.querySelectorAll<HTMLElement>("[data-task-id]")];
  if (!items.length) return 0;
  let index = items.length;
  for (let i = 0; i < items.length; i += 1) {
    const box = items[i].getBoundingClientRect();
    if (y < box.top + box.height / 2) {
      index = i;
      break;
    }
  }
  if (draggedId) {
    const from = items.findIndex((node) => node.dataset.taskId === draggedId);
    if (from !== -1 && from < index) index -= 1;
  }
  return index;
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/"/g, '\\"');
}

function hitTarget(
  x: number,
  y: number,
  draggedId?: string,
): { list: DropListId; index: number } | null {
  const nodes = document.querySelectorAll<HTMLElement>("[data-drop-list]");
  let found: { list: DropListId; index: number; area: number; body: boolean } | null = null;
  for (const node of nodes) {
    const box = node.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
    const list = node.dataset.dropList as DropListId | undefined;
    if (!list) continue;
    const area = Math.max(1, box.width * box.height);
    const body = node.hasAttribute("data-drop-body");
    const index = body
      ? indexInList(list, y, draggedId)
      : indexInList(list, Number.POSITIVE_INFINITY, draggedId);
    const better = !found || (body && !found.body) || (body === found.body && area < found.area);
    if (better) found = { list, index, area, body };
  }
  return found ? { list: found.list, index: found.index } : null;
}

export function useTaskDrag({
  desktop,
  onDrop,
}: {
  desktop: boolean;
  onDrop: (task: Task, target: DropListId, index: number) => void;
}) {
  const [drag, setDrag] = useState<TaskDragState | null>(null);
  const [holdingFrom, setHoldingFrom] = useState<DropListId | null>(null);
  const dragRef = useRef(drag);
  const draggingRef = useRef(false);
  const press = useRef<{
    pointerId: number;
    task: Task;
    from: DropListId;
    x: number;
    y: number;
    target: HTMLElement;
    timer: number | ReturnType<typeof setTimeout> | null;
  } | null>(null);
  dragRef.current = drag;

  const clearPress = () => {
    if (press.current?.timer != null) clearTimeout(press.current.timer);
    if (press.current) press.current.timer = null;
  };

  const capture = (node: HTMLElement, pointerId: number) => {
    try {
      node.setPointerCapture(pointerId);
    } catch {
      // jsdom and some WebViews omit pointer capture.
    }
  };

  const beginDrag = (start: NonNullable<typeof press.current>) => {
    capture(start.target, start.pointerId);
    try {
      navigator.vibrate?.(12);
    } catch {
      // Vibration is optional.
    }
    const next: TaskDragState = {
      task: start.task,
      from: start.from,
      x: start.x,
      y: start.y,
      over: start.from,
      index: 0,
    };
    draggingRef.current = true;
    dragRef.current = next;
    if (!desktop) setHoldingFrom(start.from);
    setDrag(next);
  };

  const endDrag = (
    event: {
      clientX: number;
      clientY: number;
      pointerId?: number;
      currentTarget?: EventTarget | null;
    },
    drop: boolean,
  ) => {
    const current = dragRef.current;
    const pointerId = press.current?.pointerId ?? event.pointerId;
    if (typeof pointerId === "number") {
      try {
        (event.currentTarget as HTMLElement | undefined)?.releasePointerCapture?.(pointerId);
      } catch {
        // Capture may already be released.
      }
    }
    clearPress();
    press.current = null;
    draggingRef.current = false;
    setHoldingFrom(null);
    if (current && drop) {
      const target = hitTarget(event.clientX, event.clientY, current.task.id);
      if (target) onDrop(current.task, target.list, target.index);
    }
    setDrag(null);
  };

  useEffect(() => () => clearPress(), []);

  const bindTask = (from: DropListId) => ({
    active: false as boolean,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>, item: Task) => {
      if (event.button !== undefined && event.button !== 0) return;
      clearPress();
      const pointerId = event.pointerId;
      if (desktop) capture(event.currentTarget, pointerId);
      press.current = {
        pointerId,
        task: item,
        from,
        x: event.clientX,
        y: event.clientY,
        target: event.currentTarget,
        timer: desktop
          ? null
          : setTimeout(() => {
              const start = press.current;
              if (!start || start.task.id !== item.id) return;
              beginDrag(start);
            }, LONG_PRESS_MS),
      };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const start = press.current;
      if (!start || event.pointerId !== start.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!dragRef.current) {
        if (Math.hypot(dx, dy) <= MOVE_CANCEL_PX) return;
        if (!desktop) {
          clearPress();
          press.current = null;
          return;
        }
        beginDrag({ ...start, x: event.clientX, y: event.clientY });
        return;
      }
      const over = hitTarget(event.clientX, event.clientY, start.task.id);
      setDrag({
        task: start.task,
        from: start.from,
        x: event.clientX,
        y: event.clientY,
        over: over?.list ?? null,
        index: over?.index ?? 0,
      });
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      if (press.current && event.pointerId !== press.current.pointerId && !dragRef.current) {
        return;
      }
      endDrag(event, Boolean(dragRef.current));
    },
  });

  return { drag, bindTask, holdingFrom, draggingRef };
}

export function UnplannedList({
  tasks,
  empty,
  aiTag,
  desktop,
  drag,
  holdingFrom,
  hold,
  heading,
  meetingLabel,
  pushLabel,
  pendingLabel,
  onSelect,
  onComplete,
}: {
  tasks: Task[];
  empty: boolean;
  aiTag: string;
  desktop: boolean;
  drag: TaskDragState | null;
  holdingFrom?: DropListId | null;
  hold: ReturnType<typeof useTaskDrag>["bindTask"] extends (list: DropListId) => infer R
    ? R
    : never;
  heading?: ReactNode;
  meetingLabel: (task: Task) => string | null;
  pushLabel: (task: Task) => string | null;
  pendingLabel: (task: Task) => string | null;
  onSelect: (task: Task) => void;
  onComplete: (task: Task) => void;
}) {
  const { t } = useI18n();
  const showZones = Boolean(
    !desktop && (drag?.from === "unplanned" || holdingFrom === "unplanned"),
  );

  return (
    <section
      id="home-unplanned"
      className={`home-unplanned home-drop-list ${drag?.over === "unplanned" ? "home-drop-list-active" : ""}`}
      aria-label={t("home.unplannedAria")}
      data-drop-list="unplanned"
    >
      {heading}
      {showZones && (
        <div className="home-drop-row">
          <button
            type="button"
            data-drop-list="today"
            aria-label={t("home.dropToday")}
            className={`home-drop-zone ${drag?.over === "today" ? "home-drop-zone-active" : ""}`}
          >
            <span className="home-drop-zone-title">{t("home.dropToday")}</span>
            <span className="home-drop-zone-hint">{t("home.dropHint")}</span>
          </button>
          <button
            type="button"
            data-drop-list="tomorrow"
            aria-label={t("home.dropTomorrow")}
            className={`home-drop-zone ${drag?.over === "tomorrow" ? "home-drop-zone-active" : ""}`}
          >
            <span className="home-drop-zone-title">{t("home.dropTomorrow")}</span>
            <span className="home-drop-zone-hint">{t("home.dropHint")}</span>
          </button>
        </div>
      )}
      <p className="home-unplanned-hint">
        {desktop ? t("home.unplannedHintDesktop") : t("home.unplannedHint")}
      </p>
      {empty ? (
        <Card className="home-empty-card" data-drop-list="unplanned" data-drop-body>
          <p className="font-bold">{t("home.unplannedEmptyTitle")}</p>
          <p className="mt-1 text-sm text-muted">{t("home.unplannedEmptyText")}</p>
        </Card>
      ) : (
        <div className="home-task-list" data-drop-list="unplanned" data-drop-body>
          {tasks.map((task, index) => (
            <HomeTaskButton
              key={task.id}
              task={task}
              aiTag={aiTag}
              dueLabel={null}
              meetingLabel={meetingLabel(task)}
              pushLabel={pushLabel(task)}
              pendingLabel={pendingLabel(task)}
              insertBefore={
                drag?.over === "unplanned" && drag.task.id !== task.id && drag.index === index
              }
              onSelect={onSelect}
              onComplete={onComplete}
              hold={{ ...hold, active: drag?.task.id === task.id }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function useDaySwipe({
  enabled,
  draggingRef,
  pageCount,
  pagerRef,
  onIndex,
}: {
  enabled: boolean;
  draggingRef: RefObject<boolean>;
  pageCount: number;
  pagerRef: RefObject<HTMLDivElement | null>;
  onIndex: (index: number) => void;
}) {
  const onIndexRef = useRef(onIndex);
  const pageCountRef = useRef(pageCount);
  onIndexRef.current = onIndex;
  pageCountRef.current = pageCount;

  useEffect(() => {
    const pager = pagerRef.current;
    if (!pager || !enabled) return;
    const swipe = {
      pointerId: -1,
      x: 0,
      y: 0,
      left: 0,
      axis: null as "x" | "y" | null,
    };

    const reset = () => {
      swipe.pointerId = -1;
      swipe.axis = null;
      pager.classList.remove("home-pager-swiping");
    };

    const onDown = (event: PointerEvent) => {
      if (draggingRef.current) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      swipe.pointerId = event.pointerId;
      swipe.x = event.clientX;
      swipe.y = event.clientY;
      swipe.left = pager.scrollLeft;
      swipe.axis = null;
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== swipe.pointerId || draggingRef.current) return;
      const dx = event.clientX - swipe.x;
      const dy = event.clientY - swipe.y;
      if (!swipe.axis) {
        if (Math.hypot(dx, dy) < DAY_SWIPE_LOCK_PX) return;
        swipe.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (swipe.axis === "x") {
          pager.classList.add("home-pager-swiping");
          try {
            pager.setPointerCapture(event.pointerId);
          } catch {
            // jsdom and some WebViews omit pointer capture.
          }
        }
      }
      if (swipe.axis !== "x") return;
      pager.scrollLeft = swipe.left - dx;
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== swipe.pointerId) return;
      if (swipe.axis === "x") {
        const width = pager.clientWidth || 1;
        const index = Math.round(pager.scrollLeft / width);
        onIndexRef.current(Math.max(0, Math.min(pageCountRef.current - 1, index)));
      }
      reset();
    };

    pager.addEventListener("pointerdown", onDown);
    pager.addEventListener("pointermove", onMove);
    pager.addEventListener("pointerup", onUp);
    pager.addEventListener("pointercancel", onUp);
    return () => {
      pager.removeEventListener("pointerdown", onDown);
      pager.removeEventListener("pointermove", onMove);
      pager.removeEventListener("pointerup", onUp);
      pager.removeEventListener("pointercancel", onUp);
      reset();
    };
  }, [enabled, pagerRef]);
}

export function TaskDragGhost({ drag }: { drag: TaskDragState | null }) {
  if (!drag) return null;
  return (
    <div className="home-drag-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
      <span className="task-title truncate">{drag.task.title}</span>
    </div>
  );
}
