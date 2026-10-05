const NOREPLY =
  /no[-_.]?reply|donotreply|mailer-daemon|notifications?@|newsletter|noreply@/iu;
const MARKETING =
  /unsubscribe|view in browser|you(?:'|’)re receiving this|рекламн|рассылк|промокод|open in app/iu;
const IMPORTANT =
  /срочн|asap|action required|invoice|сч[её]т\b|договор|оплат|подтверд|verify|security|парол|password reset|rsvp|приглашен/iu;
const MEETING =
  /встреч|meeting|call\b|звонок|zoom|google meet|teams\.microsoft|календар|calendar invite|ics|приглашение на/iu;

export interface ClassifiedMail {
  is_important: boolean;
  is_meeting: boolean;
  meeting_at: string | null;
}

export function stripMailText(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();
}

export function mailSnippet(value: string, max = 500) {
  const text = stripMailText(value);
  return text.length <= max ? text : `${text.slice(0, max - 1).trim()}…`;
}

function parseLooseDate(value: string, now = new Date()) {
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
  if (iso) {
    const stamp = Date.parse(`${iso[1]}T${iso[2] ?? "12:00"}:00.000Z`);
    if (!Number.isNaN(stamp)) return new Date(stamp).toISOString();
  }
  const dotted = value.match(/\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    const year = Number(dotted[3]) < 100 ? 2000 + Number(dotted[3]) : Number(dotted[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return `${isoDate}T12:00:00.000Z`;
    }
  }
  if (/сегодня|today/iu.test(value)) {
    return `${now.toISOString().slice(0, 10)}T12:00:00.000Z`;
  }
  if (/завтра|tomorrow/iu.test(value)) {
    const next = new Date(now);
    next.setUTCDate(next.getUTCDate() + 1);
    return `${next.toISOString().slice(0, 10)}T12:00:00.000Z`;
  }
  return null;
}

export function classifyMail(input: {
  from_address: string;
  subject: string;
  snippet: string;
  has_calendar_invite?: boolean;
  now?: Date;
}): ClassifiedMail {
  const from = input.from_address.trim();
  const haystack = `${input.subject} ${input.snippet}`;
  const newsletter = NOREPLY.test(from) || MARKETING.test(haystack);
  const conversational = /^(re|fw|fwd)\s*:/iu.test(input.subject.trim());
  const is_meeting = Boolean(input.has_calendar_invite) || MEETING.test(haystack);
  const is_important =
    is_meeting || IMPORTANT.test(haystack) || (conversational && !newsletter && !NOREPLY.test(from));
  return {
    is_important,
    is_meeting,
    meeting_at: is_meeting ? parseLooseDate(haystack, input.now) : null,
  };
}

export function meetingTaskTitle(subject: string, fromName?: string | null) {
  const clean = subject.replace(/^(re|fw|fwd|тема)\s*:\s*/iu, "").trim() || "Встреча";
  return fromName ? `Встреча: ${clean} (${fromName})` : `Встреча: ${clean}`;
}
