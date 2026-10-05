export const TASK_VALUE_SCORES = [-1, 0, 1, 2, 3] as const;
export const TASK_VALUE_EMOJIS = ["🧊", "😐", "👍🏻", "🔥", "❤️‍🔥"] as const;

export function taskValueIndex(score: number) {
  return score + 1;
}

export function TaskValueBadge({ score }: { score: number }) {
  const index = taskValueIndex(score);
  const emoji = TASK_VALUE_EMOJIS[index];
  if (!emoji) return null;
  return (
    <span className="task-value" aria-hidden="true">
      {emoji}
    </span>
  );
}

export function TaskTitleContent({
  title,
  timeLabel,
  estimateLabel,
  valueScore,
}: {
  title: string;
  timeLabel?: string | null;
  estimateLabel?: string | null;
  valueScore?: number | null;
}) {
  const hasMeta = Boolean(timeLabel || estimateLabel || valueScore != null);
  if (!hasMeta) return title;
  return (
    <>
      {title}
      <span className="task-title-value-tail" aria-hidden="true">
        {timeLabel ? <span className="task-due-clock">{timeLabel}</span> : null}
        {estimateLabel ? <span className="task-estimate">{estimateLabel}</span> : null}
        {valueScore != null ? <TaskValueBadge score={valueScore} /> : null}
      </span>
    </>
  );
}
