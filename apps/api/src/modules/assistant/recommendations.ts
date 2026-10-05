import type { Experience, Memory, RecommendationItem } from "../../types.js";

export interface RawRecommendationItem {
  title: string;
  rationale: string;
  memory_ids?: string[];
  experience_ids?: string[];
  is_generic?: boolean;
}

export function enrichRecommendationItems(
  items: RawRecommendationItem[],
  memories: Memory[],
  experiences: Experience[],
): RecommendationItem[] {
  const memoryById = new Map(memories.map((memory) => [memory.id, memory]));
  const experienceById = new Map(experiences.map((experience) => [experience.id, experience]));

  return items.map((item) => {
    const memoryIds = item.memory_ids ?? [];
    const experienceIds = item.experience_ids ?? [];
    const isGeneric = item.is_generic ?? (memoryIds.length === 0 && experienceIds.length === 0);
    const provenance = [
      ...memoryIds.flatMap((id) => {
        const memory = memoryById.get(id);
        return memory
          ? [
              {
                type: "memory" as const,
                id,
                label: memory.content.slice(0, 120),
                detail: memory.category,
              },
            ]
          : [];
      }),
      ...experienceIds.flatMap((id) => {
        const experience = experienceById.get(id);
        return experience
          ? [
              {
                type: "experience" as const,
                id,
                label: experience.title,
                detail: experience.place ?? experience.type,
              },
            ]
          : [];
      }),
    ];
    return {
      title: item.title,
      rationale: item.rationale,
      memory_ids: memoryIds,
      experience_ids: experienceIds,
      is_generic: isGeneric,
      provenance,
    };
  });
}

export const generalIdeas = (): RecommendationItem[] =>
  enrichRecommendationItems(
    [
      {
        title: "Совместная прогулка",
        rationale: "Нейтральная идея, потому что сохраненных предпочтений пока нет.",
        is_generic: true,
      },
      {
        title: "Небольшой персональный сюрприз",
        rationale: "Можно уточнить интересы и адаптировать подарок.",
        is_generic: true,
      },
      {
        title: "Ужин и разговор",
        rationale: "Безопасный общий вариант, не опирающийся на неизвестные факты.",
        is_generic: true,
      },
    ],
    [],
    [],
  );
