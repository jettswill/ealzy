import { z } from "zod";
import { isoDateSchema, isoDateTimeSchema } from "./common.js";

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

export const usageMetricSchema = z.enum(USAGE_METRICS);

export const usageTotalsSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
    call_count: z.number().int().nonnegative(),
  })
  .strict();

export const usageBucketSchema = usageTotalsSchema.extend({
  by_metric: z.record(z.string(), usageTotalsSchema),
});

export const usageSummarySchema = z
  .object({
    as_of: isoDateTimeSchema,
    today: isoDateSchema,
    month_start: isoDateSchema,
    today_usage: usageBucketSchema,
    month_usage: usageBucketSchema,
  })
  .strict();

export type UsageMetric = z.infer<typeof usageMetricSchema>;
export type UsageTotals = z.infer<typeof usageTotalsSchema>;
export type UsageBucket = z.infer<typeof usageBucketSchema>;
export type UsageSummary = z.infer<typeof usageSummarySchema>;
