import { Button } from "./ui";

export function DayCelebration({
  count,
  streak,
  milestone,
  title,
  text,
  streakLabel,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: {
  count: number;
  streak: number;
  milestone: number | null;
  title: string;
  text: string;
  streakLabel: string;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <div className="day-celebration" role="status">
      <p className="day-celebration-mark" aria-hidden="true">
        ✦
      </p>
      <p className="font-bold">{title}</p>
      <p className="mt-1 text-sm text-muted">{text}</p>
      {streak > 1 && (
        <p className="day-celebration-streak">
          {streakLabel}
          {milestone ? ` · ${milestone}` : ""}
        </p>
      )}
      <div className="home-plan-actions">
        <Button onClick={onPrimary}>{primaryLabel}</Button>
        <Button variant="secondary" onClick={onSecondary}>
          {secondaryLabel}
        </Button>
      </div>
      <span className="sr-only">{count}</span>
    </div>
  );
}
