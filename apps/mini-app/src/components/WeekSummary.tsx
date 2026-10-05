import { Button } from "./ui";

export function WeekSummary({
  compact = false,
  completed,
  dated,
  title,
  text,
  onTimeLabel,
  emptyOnTimeLabel,
  ariaLabel,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
}: {
  compact?: boolean;
  completed: number;
  percent?: number;
  onTime?: number;
  dated: number;
  title: string;
  text: string;
  onTimeLabel: string;
  emptyOnTimeLabel: string;
  ariaLabel: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
}) {
  const onTimeLine = dated > 0 ? onTimeLabel : emptyOnTimeLabel;
  if (compact) {
    return (
      <div className="card week-summary week-summary-compact" role="status" aria-label={ariaLabel}>
        <p className="font-bold">{title}</p>
        <p className="mt-1 text-sm text-muted">{onTimeLine}</p>
      </div>
    );
  }
  return (
    <div className="week-summary" role="status" aria-label={ariaLabel}>
      <p className="week-summary-mark" aria-hidden="true">
        ✦
      </p>
      <p className="font-bold">{title}</p>
      <p className="mt-1 text-sm text-muted">{text}</p>
      <p className="week-summary-on-time">{onTimeLine}</p>
      {primaryLabel && secondaryLabel && onPrimary && onSecondary ? (
        <div className="home-plan-actions">
          <Button onClick={onPrimary}>{primaryLabel}</Button>
          <Button variant="secondary" onClick={onSecondary}>
            {secondaryLabel}
          </Button>
        </div>
      ) : null}
      <span className="sr-only">{completed}</span>
    </div>
  );
}
