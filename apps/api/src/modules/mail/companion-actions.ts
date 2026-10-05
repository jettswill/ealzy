import { z } from "zod";
import type { AppRepository } from "../../repository.js";
import type { MailDraft, MailMessage } from "../../types.js";
import { languageOf } from "../../locale.js";
import { meetingTaskTitle } from "./classify.js";

export type MailActionEntity = { type: "task" | "mail"; id: string; label: string };

const emptyToNull = (value: unknown) => (value === "" || value === undefined ? null : value);
const emptyToArray = (value: unknown) => (value == null ? [] : value);

export const CompanionMailActionSchema = z.object({
  op: z.enum(["draft_reply", "send", "create_meeting_task", "mark_handled"]),
  message_id: z.preprocess(emptyToNull, z.string().uuid().nullable().catch(null)),
  draft_id: z.preprocess(emptyToNull, z.string().uuid().nullable().catch(null)),
  account_id: z.preprocess(emptyToNull, z.string().uuid().nullable().catch(null)),
  to: z.preprocess(emptyToNull, z.string().trim().max(320).nullable()),
  subject: z.preprocess(emptyToNull, z.string().trim().max(300).nullable()),
  body: z.preprocess(emptyToNull, z.string().trim().max(4000).nullable()),
  title: z.preprocess(emptyToNull, z.string().trim().max(300).nullable()),
  due_at: z.preprocess(emptyToNull, z.string().trim().max(40).nullable()),
});

export type CompanionMailAction = z.infer<typeof CompanionMailActionSchema>;
export const CompanionMailActionsSchema = z
  .preprocess(emptyToArray, z.array(CompanionMailActionSchema).max(5))
  .default([]);

export interface MailConfirmKeyboard {
  draft_id: string;
  keyboard: { text: string; callback_data: string }[][];
}

export async function applyCompanionMailActions(
  repository: AppRepository,
  ownerId: string,
  actions: CompanionMailAction[],
  context: { locale?: string | null; telegramChatId?: number | null },
): Promise<{ entities: MailActionEntity[]; confirm: MailConfirmKeyboard | null }> {
  if (!actions.length) return { entities: [], confirm: null };
  const entities: MailActionEntity[] = [];
  let confirm: MailConfirmKeyboard | null = null;
  const messages = await repository.listMailMessages(ownerId);
  const drafts = await repository.listMailDrafts(ownerId);
  const accounts = await repository.listMailAccounts(ownerId);
  for (const action of actions) {
    if (action.op === "mark_handled") {
      const message = findMessage(messages, action.message_id, action.subject);
      if (!message) continue;
      const updated = await repository.updateMailMessage(ownerId, message.id, { handled: true });
      if (updated) entities.push({ type: "mail", id: updated.id, label: updated.subject || updated.from_address });
      continue;
    }
    if (action.op === "create_meeting_task") {
      const message = findMessage(messages, action.message_id, action.subject);
      const title =
        action.title?.trim() ||
        (message ? meetingTaskTitle(message.subject, message.from_name) : null);
      if (!title) continue;
      const task = await repository.createTask(ownerId, {
        title,
        due_at: action.due_at || message?.meeting_at || null,
        description: message?.snippet ?? null,
      });
      if (message) await repository.updateMailMessage(ownerId, message.id, { handled: true });
      entities.push({ type: "task", id: task.id, label: task.title });
      continue;
    }
    if (action.op === "draft_reply") {
      const message = findMessage(messages, action.message_id, action.subject);
      const accountId = action.account_id || message?.account_id || accounts[0]?.id;
      if (!accountId) continue;
      const to = action.to?.trim() || message?.from_address;
      if (!to) continue;
      const draft = await repository.createMailDraft(ownerId, {
        account_id: accountId,
        message_id: message?.id ?? null,
        to_address: to,
        subject: action.subject?.trim() || (message ? `Re: ${message.subject}` : "Hello"),
        body: action.body?.trim() || "",
        status: "draft",
      });
      drafts.unshift(draft);
      entities.push({ type: "mail", id: draft.id, label: draft.subject });
      continue;
    }
    if (action.op === "send") {
      let draft: MailDraft | null = action.draft_id
        ? drafts.find((item) => item.id === action.draft_id) ?? null
        : null;
      if (!draft && (action.body || action.to)) {
        const message = findMessage(messages, action.message_id, action.subject);
        const accountId = action.account_id || message?.account_id || accounts[0]?.id;
        const to = action.to?.trim() || message?.from_address;
        if (!accountId || !to) continue;
        draft = await repository.createMailDraft(ownerId, {
          account_id: accountId,
          message_id: message?.id ?? null,
          to_address: to,
          subject: action.subject?.trim() || (message ? `Re: ${message.subject}` : "Hello"),
          body: action.body?.trim() || "",
          status: "draft",
        });
        drafts.unshift(draft);
      }
      if (!draft) continue;
      entities.push({ type: "mail", id: draft.id, label: draft.subject });
      if (context.telegramChatId) {
        confirm = await createMailSendConfirm(
          repository,
          ownerId,
          context.telegramChatId,
          draft,
          context.locale,
        );
      }
    }
  }
  return { entities, confirm };
}

function findMessage(messages: MailMessage[], id: string | null, subject: string | null) {
  if (id) return messages.find((item) => item.id === id) ?? null;
  const title = subject?.trim().toLocaleLowerCase();
  if (!title) return null;
  const matches = messages.filter((item) => item.subject.toLocaleLowerCase().includes(title));
  return matches.length === 1 ? matches[0] : null;
}

async function createMailSendConfirm(
  repository: AppRepository,
  ownerId: string,
  telegramChatId: number,
  draft: MailDraft,
  locale?: string | null,
) {
  const { createMailSendPending } = await import("../assistant/pending-actions.js");
  const { keyboard } = await createMailSendPending(
    repository,
    ownerId,
    telegramChatId,
    draft.id,
    locale,
  );
  return { draft_id: draft.id, keyboard };
}

export function mailSendHint(locale?: string | null) {
  const ru = languageOf(locale) !== "en";
  return ru
    ? "Письмо не отправлено. Подтвердите в Telegram или нажмите «Отправить» в Ealzy."
    : "Nothing was sent yet. Confirm in Telegram or tap Send in Ealzy.";
}
