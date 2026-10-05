import { useEffect, useRef, useState } from "react";
import { HOME_ARCHIVE_LINGER_MS } from "./today-tasks";
import type { Task } from "./types";

export function useArchiveLinger() {
  const [lingeringIds, setLingeringIds] = useState<ReadonlySet<string>>(() => new Set());
  const lingerTimers = useRef(new Map<string, number>());

  const clearLinger = (id: string) => {
    const timer = lingerTimers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      lingerTimers.current.delete(id);
    }
    setLingeringIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const lingerArchived = (id: string) => {
    setLingeringIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
    if (lingerTimers.current.has(id)) return;
    lingerTimers.current.set(
      id,
      window.setTimeout(() => {
        lingerTimers.current.delete(id);
        setLingeringIds((current) => {
          if (!current.has(id)) return current;
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, HOME_ARCHIVE_LINGER_MS),
    );
  };

  useEffect(
    () => () => {
      lingerTimers.current.forEach((timer) => window.clearTimeout(timer));
      lingerTimers.current.clear();
    },
    [],
  );

  const rememberArchiveState = (task: Task) => {
    if (task.status === "done" || task.status === "cancelled") lingerArchived(task.id);
    else clearLinger(task.id);
  };

  return { lingeringIds, rememberArchiveState };
}
