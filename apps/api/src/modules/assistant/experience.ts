import { z } from "zod";
import type { AppRepository } from "../../repository.js";
import type { Experience, ExperienceType, Person } from "../../types.js";
import { resolvePerson } from "./index.js";

export interface ExtractedExperience {
  type: ExperienceType;
  title: string;
  place: string | null;
  participant_query: string | null;
  positive_signals: string[];
  negative_signals: string[];
  emotions: string[];
  occurred_at: string | null;
}

export const ExperienceExtractionSchema = z.object({
  experience: z
    .object({
      type: z.enum(["restaurant", "theater", "trip", "event", "gift", "activity", "other"]),
      title: z.string().min(1).max(300),
      place: z.string().max(500).nullable(),
      participant_query: z.string().max(120).nullable(),
      positive_signals: z.array(z.string().min(1).max(500)).max(20),
      negative_signals: z.array(z.string().min(1).max(500)).max(20),
      emotions: z.array(z.string().min(1).max(100)).max(20),
      occurred_at: z.string().datetime().nullable(),
    })
    .strict()
    .nullable(),
});

export interface ExperienceExtractor {
  extractExperience?(text: string, currentTime: string): Promise<unknown>;
}

export type CaptureResult =
  | { text: string; experience: Experience }
  | {
      text: string;
      experience: null;
      disambiguation: {
        candidates: Person[];
        extracted: ExtractedExperience;
        sourceMessageId: string;
      };
    }
  | { text: string; experience: null };

export function extractExperience(text: string, now = new Date()): ExtractedExperience | null {
  const match = text.match(
    /(?:вчера|сегодня|на выходных|недавно)\s+(?:мы\s+)?(?:были|ходили|ездили)(?:\s+с\s+([\p{L}-]+))?\s+(?:в|на)\s+(.+)/iu,
  );
  if (!match) return null;
  const rest = match[2]!.trim();
  const lower = rest.toLocaleLowerCase();
  const type: ExperienceType = /ресторан|кафе|бар/.test(lower)
    ? "restaurant"
    : /театр|спектак/.test(lower)
      ? "theater"
      : /поезд|путеше|отпуск/.test(lower)
        ? "trip"
        : /концерт|фестивал|выстав/.test(lower)
          ? "event"
          : /подар/.test(lower)
            ? "gift"
            : /занимал|играл|катал|гулял/.test(lower)
              ? "activity"
              : "other";
  const negative = /не понрав|плох|скучн|шумн|невкусн|разочар/iu.test(rest);
  const positive = !negative && /понрав|любим|класс|здоров|вкусн|уютн|в восторге/iu.test(rest);
  const place =
    rest
      .replace(/[,.;].*$/u, "")
      .replace(/^(?:ресторане|кафе|баре|театре|на концерте)\s+/iu, "")
      .trim() || null;
  const occurred = new Date(now);
  if (/вчера/iu.test(text)) occurred.setUTCDate(occurred.getUTCDate() - 1);
  return {
    type,
    title: place
      ? `${type === "restaurant" ? "Ресторан" : type === "theater" ? "Театр" : "Опыт"}: ${place}`
      : rest.slice(0, 120),
    place,
    participant_query: match[1] ?? null,
    positive_signals: positive ? [rest.slice(0, 300)] : [],
    negative_signals: negative ? [rest.slice(0, 300)] : [],
    emotions: /в восторге|радост/iu.test(rest)
      ? ["joy"]
      : /разочар/iu.test(rest)
        ? ["disappointment"]
        : [],
    occurred_at: occurred.toISOString(),
  };
}

export class ExperienceService {
  constructor(
    private readonly repository: AppRepository,
    private readonly extractor?: ExperienceExtractor,
  ) {}

  async completeFollowUp(
    ownerId: string,
    experienceId: string,
    text: string,
    _sourceMessageId?: string,
  ) {
    const experience = await this.repository.getExperience(ownerId, experienceId);
    if (!experience) return { text: "Не нашёл опыт для follow-up.", experience: null };
    const positive = /понрав|класс|здоров|вкусн|уютн|в восторге|отличн|супер/iu.test(text);
    const negative = /не понрав|плох|скучн|шумн|невкусн|разочар/iu.test(text);
    const signals = positive
      ? [text.slice(0, 300)]
      : negative
        ? [text.slice(0, 300)]
        : [text.slice(0, 300)];
    const updated = await this.repository.updateExperience(ownerId, experienceId, {
      status: "completed",
      description: experience.description ?? text,
      outcome: positive ? "positive" : negative ? "negative" : experience.outcome,
      positive_signals: positive
        ? [...new Set([...experience.positive_signals, ...signals])]
        : experience.positive_signals,
      negative_signals: negative
        ? [...new Set([...experience.negative_signals, ...signals])]
        : experience.negative_signals,
    });
    if (!updated) return { text: "Не удалось обновить опыт.", experience: null };
    return {
      text: `Спасибо за отзыв о «${updated.title}». Запомнил ваши впечатления.`,
      experience: updated,
    };
  }

  private async persistExperience(
    ownerId: string,
    extracted: ExtractedExperience,
    participantIds: string[],
    sourceMessageId: string,
    text: string,
    participant: { id: string; name: string } | null,
  ) {
    const experience = await this.repository.createExperience(ownerId, {
      ...extracted,
      participant_ids: participantIds,
      source_message_id: sourceMessageId,
      status: "completed",
      description: text,
      outcome: extracted.positive_signals.length
        ? "positive"
        : extracted.negative_signals.length
          ? "negative"
          : null,
    });
    const self = await this.repository.getSelfPerson(ownerId);
    const signal = extracted.positive_signals[0] ?? extracted.negative_signals[0];
    const participantStem = participant?.name.toLocaleLowerCase().slice(0, 3);
    const explicitlyParticipantTaste =
      !!participantStem &&
      text.toLocaleLowerCase().includes(participantStem) &&
      /(?:ей|ему|её|его|[\p{L}-]+)\s+(?:не\s+)?понрав/iu.test(text);
    const memoryPerson = explicitlyParticipantTaste ? participant : self;
    if (memoryPerson && signal) {
      const memory = await this.repository.createMemory(ownerId, memoryPerson.id, {
        content: `${extracted.positive_signals.length ? "Понравился" : "Не понравился"} опыт: ${extracted.place ?? extracted.title}`,
        category: extracted.positive_signals.length ? "preference" : "dislike",
        importance: 3,
        confidence: 0.95,
        source_message_id: sourceMessageId,
        occurred_at: extracted.occurred_at,
        metadata: { experience_id: experience.id, signal },
      });
      await this.repository.linkExperienceMemory(
        ownerId,
        experience.id,
        memory.memory.id,
        extracted.positive_signals.length ? "positive" : "negative",
      );
    }
    return {
      text: `Сохранил опыт «${experience.title}»${participantIds.length ? " с участником" : ""}.`,
      experience,
    };
  }

  async capture(
    ownerId: string,
    text: string,
    sourceMessageId: string,
  ): Promise<CaptureResult | null> {
    if (!/(?:вчера|сегодня|недавно|были|ходили|ездили|понравил|не понрав)/iu.test(text))
      return null;
    let extracted: ExtractedExperience | null = null;
    if (this.extractor?.extractExperience) {
      try {
        extracted =
          ExperienceExtractionSchema.parse(
            await this.extractor.extractExperience(text, new Date().toISOString()),
          ).experience ?? null;
      } catch {
        // Keep experience capture available when structured extraction fails.
      }
    }
    extracted ??= extractExperience(text);
    if (!extracted) return null;
    let participantIds: string[] = [];
    let participant: { id: string; name: string } | null = null;
    if (extracted.participant_query) {
      const resolution = await resolvePerson(this.repository, ownerId, extracted.participant_query);
      if (resolution.status === "ambiguous")
        return {
          text: "Выберите участника:",
          experience: null,
          disambiguation: { candidates: resolution.people, extracted, sourceMessageId },
        };
      if (resolution.status === "not_found")
        return {
          text: `Не нашёл участника «${extracted.participant_query}». Опыт пока не сохранён.`,
          experience: null,
        };
      participantIds = [resolution.person.id];
      participant = resolution.person;
    }
    return this.persistExperience(
      ownerId,
      extracted,
      participantIds,
      sourceMessageId,
      text,
      participant,
    );
  }

  async captureWithParticipant(
    ownerId: string,
    extracted: ExtractedExperience,
    personId: string,
    sourceMessageId: string,
    text: string,
  ) {
    const person = await this.repository.getPerson(ownerId, personId);
    if (!person) return { text: "Не нашёл выбранного участника.", experience: null };
    return this.persistExperience(ownerId, extracted, [person.id], sourceMessageId, text, person);
  }
}
