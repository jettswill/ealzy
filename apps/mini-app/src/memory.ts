import type { MemoryCategory } from "./types";

export const memoryCategoryKeys: Record<MemoryCategory, string> = {
  interest: "memory.interest",
  dislike: "memory.dislike",
  favorite_place: "memory.favorite_place",
  favorite_food: "memory.favorite_food",
  gift: "memory.gift",
  size: "memory.size",
  dream: "memory.dream",
  important_date: "memory.important_date",
  story: "memory.story",
  personality: "memory.personality",
  experience: "memory.experience",
  preference: "memory.preference",
  skill: "memory.skill",
  important_event: "memory.important_event",
  important_fact: "memory.important_fact",
  other: "memory.other",
};

/** @deprecated Use memoryCategoryKeys with t() */
export const memoryCategoryLabels: Record<MemoryCategory, string> = {
  interest: "Interests",
  dislike: "Dislikes",
  favorite_place: "Favorite places",
  favorite_food: "Favorite food",
  gift: "Gift ideas",
  size: "Sizes",
  dream: "Dreams",
  important_date: "Important dates",
  story: "Stories",
  personality: "Personality",
  experience: "Experiences",
  preference: "Preferences",
  skill: "Skills",
  important_event: "Important events",
  important_fact: "Important facts",
  other: "Other",
};

export function memorySourceLabel(source?: string | null, sourceMessageId?: string | null) {
  if (source) return source;
  if (sourceMessageId) return "Conversation";
  return "Manual";
}

export function isInferredBehaviorMemory(memory: { metadata?: Record<string, unknown> }) {
  return memory.metadata?.source === "behavior_inference";
}
