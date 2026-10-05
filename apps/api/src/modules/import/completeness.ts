export type CompletenessId = "telegram" | "portrait" | "timezone" | "goals" | "digests";

export type CompletenessItem = {
  id: CompletenessId;
  weight: number;
  done: boolean;
  href: string;
};

export type CompletenessReport = {
  percent: number;
  items: CompletenessItem[];
};

const WEIGHTS: { id: CompletenessId; weight: number; href: string }[] = [
  { id: "telegram", weight: 25, href: "/profile#loop" },
  { id: "portrait", weight: 25, href: "/companion" },
  { id: "timezone", weight: 20, href: "/profile#loop" },
  { id: "goals", weight: 20, href: "/goals" },
  { id: "digests", weight: 10, href: "/profile#loop" },
];

export function profileCompleteness(input: {
  telegramLinked: boolean;
  hasPortrait: boolean;
  timezone: string | null | undefined;
  hasGoals: boolean;
  hasDigests: boolean;
}): CompletenessReport {
  const done: Record<CompletenessId, boolean> = {
    telegram: input.telegramLinked,
    portrait: input.hasPortrait,
    timezone: Boolean(input.timezone?.trim()),
    goals: input.hasGoals,
    digests: input.hasDigests,
  };
  const items = WEIGHTS.map((item) => ({ ...item, done: done[item.id] }));
  const earned = items.reduce((sum, item) => sum + (item.done ? item.weight : 0), 0);
  return { percent: earned, items };
}
