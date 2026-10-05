import { z } from "zod";
import { entityIdSchema, isoDateTimeSchema, metadataSchema } from "./common.js";

export const CONVERSATION_KINDS = ["companion", "system"] as const;
export const CONVERSATION_MODES = ["command", "companion"] as const;
export const MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export const MESSAGE_SOURCE_CHANNELS = ["telegram", "mini_app", "system"] as const;
export const ASSISTANT_INTENTS = [
  "remember",
  "recommend",
  "create_task",
  "create_space",
  "create_goal",
  "create_project",
  "query_memory",
  "organize_event",
  "companion",
  "reflection",
  "other",
] as const;

export const conversationKindSchema = z.enum(CONVERSATION_KINDS);
export const conversationModeSchema = z.enum(CONVERSATION_MODES);
export const messageRoleSchema = z.enum(MESSAGE_ROLES);
export const messageSourceChannelSchema = z.enum(MESSAGE_SOURCE_CHANNELS);
export const assistantIntentSchema = z.enum(ASSISTANT_INTENTS);

export const conversationSchema = z
  .object({
    id: entityIdSchema,
    owner_id: entityIdSchema,
    kind: conversationKindSchema,
    mode: conversationModeSchema,
    title: z.string().trim().min(1).max(300).nullable(),
    summary: z.string().trim().max(10000).nullable(),
    last_message_at: isoDateTimeSchema.nullable(),
    created_at: isoDateTimeSchema,
    updated_at: isoDateTimeSchema,
  })
  .strict();

export const messageSchema = z
  .object({
    id: entityIdSchema,
    owner_id: entityIdSchema,
    conversation_id: entityIdSchema,
    telegram_chat_id: z.number().int().nullable(),
    telegram_message_id: z.number().int().nullable(),
    role: messageRoleSchema,
    content: z.string().trim().min(1).max(10000),
    intent: assistantIntentSchema.nullable(),
    source_channel: messageSourceChannelSchema,
    metadata: metadataSchema,
    created_at: isoDateTimeSchema,
  })
  .strict();

export const conversationMessagesSchema = z
  .object({
    conversation: conversationSchema,
    messages: z.array(messageSchema),
  })
  .strict();

export type ConversationKind = z.infer<typeof conversationKindSchema>;
export type ConversationMode = z.infer<typeof conversationModeSchema>;
export type MessageRole = z.infer<typeof messageRoleSchema>;
export type MessageSourceChannel = z.infer<typeof messageSourceChannelSchema>;
export type AssistantIntent = z.infer<typeof assistantIntentSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type Message = z.infer<typeof messageSchema>;
export type ConversationMessages = z.infer<typeof conversationMessagesSchema>;
