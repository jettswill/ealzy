import { z } from "zod";
import { entityIdSchema, isoDateTimeSchema, nonEmptyPatchSchema } from "./common.js";

const emptyToNull = (value: unknown) => (value === "" || value === undefined ? null : value);

export const PERSON_DATE_MAX = 20;
export const PERSON_DATE_KINDS = ["birthday", "met", "wedding", "anniversary", "other"] as const;
export const UNIQUE_PERSON_DATE_KINDS = ["birthday", "met", "wedding"] as const;

export const personDateKindSchema = z.enum(PERSON_DATE_KINDS);

export function isValidCalendarDay(month: number, day: number, year: number | null | undefined) {
  const y = year ?? 2000;
  const date = new Date(Date.UTC(y, month - 1, day));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const calendarDateShape = {
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  year: z.preprocess(
    emptyToNull,
    z.number().int().min(1800).max(2100).nullable(),
  ),
};

function withCalendarDay<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict().superRefine((value, ctx) => {
    const month = "month" in value ? (value.month as number | undefined) : undefined;
    const day = "day" in value ? (value.day as number | undefined) : undefined;
    const year = "year" in value ? ((value.year as number | null | undefined) ?? null) : null;
    if (month == null || day == null) return;
    if (!isValidCalendarDay(month, day, year)) {
      ctx.addIssue({ code: "custom", message: "Invalid calendar date", path: ["day"] });
    }
  });
}

export const personDateSchema = z
  .object({
    id: entityIdSchema,
    person_id: entityIdSchema,
    kind: personDateKindSchema,
    label: z.string().trim().min(1).max(80).nullable(),
    month: calendarDateShape.month,
    day: calendarDateShape.day,
    year: z.number().int().min(1800).max(2100).nullable(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

const dateWriteShape = {
  kind: personDateKindSchema,
  label: z.preprocess(emptyToNull, z.string().trim().min(1).max(80).nullable()),
  month: calendarDateShape.month,
  day: calendarDateShape.day,
  year: calendarDateShape.year,
};

export const createPersonDateSchema = withCalendarDay({
  kind: dateWriteShape.kind,
  label: dateWriteShape.label.optional(),
  month: dateWriteShape.month,
  day: dateWriteShape.day,
  year: dateWriteShape.year.optional(),
}).superRefine((value, ctx) => {
  if (value.kind === "other" && !value.label) {
    ctx.addIssue({ code: "custom", message: "Label required", path: ["label"] });
  }
});

export const updatePersonDateSchema = nonEmptyPatchSchema({
  kind: dateWriteShape.kind,
  label: dateWriteShape.label,
  month: dateWriteShape.month,
  day: dateWriteShape.day,
  year: dateWriteShape.year,
}).superRefine((value, ctx) => {
  if (value.kind === "other" && value.label === null) {
    ctx.addIssue({ code: "custom", message: "Label required", path: ["label"] });
  }
  if (value.month != null && value.day != null && !isValidCalendarDay(value.month, value.day, value.year ?? null)) {
    ctx.addIssue({ code: "custom", message: "Invalid calendar date", path: ["day"] });
  }
});

export type PersonDateKind = z.infer<typeof personDateKindSchema>;
export type PersonDate = z.infer<typeof personDateSchema>;
export type CreatePersonDateInput = z.input<typeof createPersonDateSchema>;
export type NormalizedCreatePersonDateInput = z.output<typeof createPersonDateSchema>;
export type UpdatePersonDateInput = z.infer<typeof updatePersonDateSchema>;
