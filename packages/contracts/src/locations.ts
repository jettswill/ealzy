import { z } from "zod";
import { entityIdSchema, isoDateTimeSchema, nonEmptyPatchSchema } from "./common.js";

const emptyToNull = (value: unknown) => (value === "" || value === undefined ? null : value);

export const PERSON_LOCATION_MAX = 10;

export const personLocationSchema = z
  .object({
    id: entityIdSchema,
    person_id: entityIdSchema,
    label: z.string().trim().min(1).max(80).nullable(),
    city: z.string().trim().min(1).max(120),
    address: z.string().trim().min(1).max(400).nullable(),
    is_primary: z.boolean(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

const locationWriteShape = {
  label: z.preprocess(emptyToNull, z.string().trim().min(1).max(80).nullable()),
  city: z.string().trim().min(1).max(120),
  address: z.preprocess(emptyToNull, z.string().trim().min(1).max(400).nullable()),
  is_primary: z.boolean(),
};

export const createPersonLocationSchema = z
  .object({
    label: locationWriteShape.label.optional(),
    city: locationWriteShape.city,
    address: locationWriteShape.address.optional(),
    is_primary: z.boolean().optional(),
  })
  .strict();

export const updatePersonLocationSchema = nonEmptyPatchSchema({
  label: locationWriteShape.label,
  city: locationWriteShape.city,
  address: locationWriteShape.address,
  is_primary: locationWriteShape.is_primary,
});

export type PersonLocation = z.infer<typeof personLocationSchema>;
export type CreatePersonLocationInput = z.input<typeof createPersonLocationSchema>;
export type NormalizedCreatePersonLocationInput = z.output<typeof createPersonLocationSchema>;
export type UpdatePersonLocationInput = z.infer<typeof updatePersonLocationSchema>;
