import { z } from "zod";
import { entityIdSchema, isoDateSchema, isoDateTimeSchema, nonEmptyPatchSchema } from "./common.js";

export const GOAL_STATUSES = ["active", "paused", "completed", "archived"] as const;
export const GOAL_HORIZONS = ["short_term", "medium_term", "long_term", "ongoing"] as const;
export const PROJECT_STATUSES = ["planned", "active", "paused", "completed", "archived"] as const;

export const goalStatusSchema = z.enum(GOAL_STATUSES);
export const goalHorizonSchema = z.enum(GOAL_HORIZONS);
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export const goalPrioritySchema = z.number().int().min(1).max(5);

export const goalSchema = z
  .object({
    id: entityIdSchema,
    owner_id: entityIdSchema,
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(4000).nullable(),
    status: goalStatusSchema,
    horizon: goalHorizonSchema,
    priority: goalPrioritySchema,
    target_date: isoDateSchema.nullable(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

const goalWriteShape = {
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).nullable(),
  status: goalStatusSchema,
  horizon: goalHorizonSchema,
  priority: goalPrioritySchema,
  target_date: isoDateSchema.nullable(),
};

export const createGoalSchema = z
  .object({
    ...goalWriteShape,
    description: goalWriteShape.description.default(null),
    status: goalStatusSchema.default("active"),
    horizon: goalHorizonSchema.default("medium_term"),
    priority: goalPrioritySchema.default(3),
    target_date: isoDateSchema.nullable().default(null),
  })
  .strict();

export const updateGoalSchema = nonEmptyPatchSchema(goalWriteShape);

export const projectSchema = z
  .object({
    id: entityIdSchema,
    owner_id: entityIdSchema,
    goal_id: entityIdSchema.nullable(),
    space_id: entityIdSchema.nullable(),
    name: z.string().trim().min(1).max(300),
    description: z.string().trim().max(4000).nullable(),
    status: projectStatusSchema,
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

const projectWriteShape = {
  goal_id: entityIdSchema.nullable(),
  space_id: entityIdSchema.nullable(),
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(4000).nullable(),
  status: projectStatusSchema,
};

export const createProjectSchema = z
  .object({
    ...projectWriteShape,
    goal_id: entityIdSchema.nullable().default(null),
    space_id: entityIdSchema.nullable().default(null),
    description: projectWriteShape.description.default(null),
    status: projectStatusSchema.default("planned"),
  })
  .strict();

export const updateProjectSchema = nonEmptyPatchSchema(projectWriteShape);

export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type GoalHorizon = z.infer<typeof goalHorizonSchema>;
export type GoalPriority = z.infer<typeof goalPrioritySchema>;
export type Goal = z.infer<typeof goalSchema>;
export type CreateGoalInput = z.input<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type Project = z.infer<typeof projectSchema>;
export type CreateProjectInput = z.input<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
