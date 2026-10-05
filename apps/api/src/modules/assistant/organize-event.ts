export type EventKind = "birthday" | "celebration";

export interface OrganizeEventRequest {
  person_query: string | null;
  event_kind: EventKind;
}

export function parseOrganizeEventRequest(text: string): OrganizeEventRequest | null {
  const trimmed = text.trim();
  if (!/(?:организ|спланиру|plan|organize)/iu.test(trimmed)) return null;
  if (!/(?:день\s*рожд|birthday|праздник|юбилей|celebration)/iu.test(trimmed)) return null;

  const event_kind: EventKind = /(?:день\s*рожд|birthday)/iu.test(trimmed)
    ? "birthday"
    : "celebration";
  const person_query =
    trimmed.match(/(?:для|у|for|of)\s+([\p{L}-]+)/iu)?.[1] ??
    trimmed.match(
      /(?:день\s*рождения|birthday|праздник|юбилей|celebration)\s+(?:у\s+)?([\p{L}-]+)/iu,
    )?.[1] ??
    trimmed.match(
      /(?:организ(?:овать|уй)|спланируй|plan|organize)\s+(?:день\s*рождения|birthday|праздник|юбилей|celebration)\s+([\p{L}-]+)/iu,
    )?.[1] ??
    null;

  return { person_query, event_kind };
}

export function eventBundleLabels(kind: EventKind, personName: string) {
  if (kind === "birthday") {
    return {
      spaceName: `День рождения ${personName}`,
      taskTitle: `Организовать день рождения ${personName}`,
      recommendQuery: `Идеи подарка и места для дня рождения ${personName}`,
    };
  }
  return {
    spaceName: `Праздник ${personName}`,
    taskTitle: `Организовать праздник для ${personName}`,
    recommendQuery: `Идеи для праздника с ${personName}`,
  };
}
