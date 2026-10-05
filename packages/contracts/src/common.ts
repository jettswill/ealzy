import { z } from "zod";

export const entityIdSchema = z.string().uuid();
export const isoDateSchema = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export const nullableIsoDateTimeSchema = isoDateTimeSchema.nullable();
export const metadataSchema = z.record(z.string(), z.unknown());

export const apiErrorCodeSchema = z.string().trim().min(1).max(100);
export const apiErrorSchema = z
  .object({
    code: apiErrorCodeSchema,
    message: z.string().trim().min(1),
    requestId: z.string().trim().min(1).max(128).optional(),
    details: z.unknown().optional(),
  })
  .strict();

export const apiErrorEnvelopeSchema = z.object({ error: apiErrorSchema }).strict();

export const paginationSchema = z
  .object({
    cursor: z.string().min(1).nullable(),
    has_more: z.boolean(),
  })
  .strict();

export const apiSuccessEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z
    .object({
      data,
      pagination: paginationSchema.optional(),
    })
    .strict();

export const apiEnvelopeSchema = <T extends z.ZodType>(data: T) =>
  z.union([apiSuccessEnvelopeSchema(data), apiErrorEnvelopeSchema]);

export const nonEmptyPatchSchema = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .strict()
    .partial()
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field is required",
    });

export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type ApiSuccessEnvelope<T> = {
  data: T;
  pagination?: Pagination;
};
export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;
