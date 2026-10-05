import { AsyncLocalStorage } from "node:async_hooks";
import type { AppRepository } from "../../repository.js";
import type { UsageCounter } from "../../types.js";

export const USAGE_METRICS = [
  "companion",
  "decide",
  "recommend",
  "experience",
  "reflect",
  "digest",
  "onboarding",
  "note_action",
  "transcribe",
] as const;

export type UsageMetric = (typeof USAGE_METRICS)[number];

export type AiTokenUsage = {
  metric: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type UsageTotals = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  call_count: number;
};

export type UsageBucket = UsageTotals & {
  by_metric: Record<string, UsageTotals>;
};

export type UsageSummary = {
  as_of: string;
  today: string;
  month_start: string;
  today_usage: UsageBucket;
  month_usage: UsageBucket;
};

const ownerStore = new AsyncLocalStorage<string>();

export function runWithUsageOwner<T>(ownerId: string, fn: () => T): T {
  return ownerStore.run(ownerId, fn);
}

export function currentUsageOwner(): string | null {
  return ownerStore.getStore() ?? null;
}

export function utcDate(at = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function utcMonthStart(at = new Date()): string {
  return `${at.toISOString().slice(0, 7)}-01`;
}

const emptyTotals = (): UsageTotals => ({
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  call_count: 0,
});

function addTotals(into: UsageTotals, row: Pick<UsageCounter, keyof UsageTotals>) {
  into.prompt_tokens += row.prompt_tokens;
  into.completion_tokens += row.completion_tokens;
  into.total_tokens += row.total_tokens;
  into.call_count += row.call_count;
}

export function summarizeUsage(rows: UsageCounter[], at = new Date()): UsageSummary {
  const today = utcDate(at);
  const month_start = utcMonthStart(at);
  const today_usage: UsageBucket = { ...emptyTotals(), by_metric: {} };
  const month_usage: UsageBucket = { ...emptyTotals(), by_metric: {} };
  for (const row of rows) {
    if (row.used_on < month_start || row.used_on > today) continue;
    addTotals(month_usage, row);
    const monthMetric = (month_usage.by_metric[row.metric] ??= emptyTotals());
    addTotals(monthMetric, row);
    if (row.used_on !== today) continue;
    addTotals(today_usage, row);
    const todayMetric = (today_usage.by_metric[row.metric] ??= emptyTotals());
    addTotals(todayMetric, row);
  }
  return {
    as_of: at.toISOString(),
    today,
    month_start,
    today_usage,
    month_usage,
  };
}

export async function loadUsageSummary(
  repository: AppRepository,
  ownerId: string,
  at = new Date(),
): Promise<UsageSummary> {
  const rows = await repository.listUsageCounters(ownerId, utcMonthStart(at), utcDate(at));
  return summarizeUsage(rows, at);
}

export function attachUsageSink(ai: unknown, repository: AppRepository) {
  const candidate = ai as { bindUsage?: (sink: (usage: AiTokenUsage) => void) => void } | undefined;
  candidate?.bindUsage?.((usage) => {
    const ownerId = currentUsageOwner();
    if (!ownerId) return;
    void repository.incrementUsage(ownerId, usage).catch((error) => {
      console.error(
        JSON.stringify({
          event: "usage_record_failed",
          owner_id: ownerId,
          metric: usage.metric,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  });
}

const SCHEMA_METRIC: Record<string, UsageMetric> = {
  assistant_decision: "decide",
  recommendation_items: "recommend",
  companion_response: "companion",
  experience_extraction: "experience",
  weekly_reflection: "reflect",
  scheduled_digest: "digest",
  onboarding_extract: "onboarding",
  note_action: "note_action",
};

export function metricForSchema(name: string): string {
  const mapped = SCHEMA_METRIC[name];
  if (mapped) return mapped;
  const cleaned = name.replace(/[^a-z0-9_]/gi, "_").slice(0, 40);
  return cleaned || "other";
}

export function tokensFromCompletionUsage(usage: {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
} | null | undefined): Omit<AiTokenUsage, "metric"> {
  const prompt_tokens = Math.max(0, Math.trunc(usage?.prompt_tokens ?? 0));
  const completion_tokens = Math.max(0, Math.trunc(usage?.completion_tokens ?? 0));
  const total_tokens = Math.max(
    0,
    Math.trunc(usage?.total_tokens ?? prompt_tokens + completion_tokens),
  );
  return { prompt_tokens, completion_tokens, total_tokens };
}

export function tokensFromTranscriptionUsage(usage: unknown): Omit<AiTokenUsage, "metric"> {
  if (!usage || typeof usage !== "object") {
    return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }
  const row = usage as {
    type?: string;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  if (typeof row.input_tokens === "number" || typeof row.output_tokens === "number") {
    const prompt_tokens = Math.max(0, Math.trunc(row.input_tokens ?? 0));
    const completion_tokens = Math.max(0, Math.trunc(row.output_tokens ?? 0));
    const total_tokens = Math.max(
      0,
      Math.trunc(row.total_tokens ?? prompt_tokens + completion_tokens),
    );
    return { prompt_tokens, completion_tokens, total_tokens };
  }
  return tokensFromCompletionUsage(row);
}
