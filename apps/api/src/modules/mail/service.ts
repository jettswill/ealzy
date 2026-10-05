import type { AppRepository, MailAccountInput, MailDraftInput } from "../../repository.js";
import type {
  MailAccount,
  MailAccountPublic,
  MailDraft,
  MailMessage,
  MailPlaybook,
} from "../../types.js";
import { languageOf } from "../../locale.js";
import { decryptSecret, encryptSecret } from "./crypto.js";
import { classifyMail, mailSnippet, meetingTaskTitle } from "./classify.js";
import type { MailConnection, MailGateway } from "./gateway.js";
import { inferMailProvider, resolveMailServers, type MailProviderId } from "./providers.js";
import { DEFAULT_MAIL_PLAYBOOKS, playbookMatches } from "./playbooks.js";

export const MAIL_ACCOUNT_LIMIT = 5;
export const MAIL_SYNC_LIMIT = 30;
export const MAIL_SYNC_SINCE_MS = 36 * 60 * 60_000;
export const MAIL_SYNC_INTERVAL_MS = 2 * 60 * 60_000;
export const MAIL_SYNC_ON_OPEN_MIN_AGE_MS = 2 * 60_000;

export function isMailDueForSync(
  account: Pick<MailAccount, "status" | "last_synced_at">,
  now = Date.now(),
  intervalMs = MAIL_SYNC_INTERVAL_MS,
) {
  if (account.status === "disabled") return false;
  if (account.status === "error" || !account.last_synced_at) return true;
  const syncedAt = Date.parse(account.last_synced_at);
  return !Number.isFinite(syncedAt) || syncedAt <= now - intervalMs;
}

export function toPublicMailAccount(account: MailAccount): MailAccountPublic {
  const { secret_cipher: _secret, ...rest } = account;
  return rest;
}

export class MailService {
  constructor(
    private readonly repository: AppRepository,
    private readonly gateway: MailGateway,
    private readonly encryptionSecret: string,
  ) {}

  async connect(
    ownerId: string,
    input: {
      email: string;
      password: string;
      provider?: MailProviderId;
      username?: string;
      imap_host?: string;
      imap_port?: number;
      smtp_host?: string;
      smtp_port?: number;
    },
  ) {
    const email = input.email.trim().toLowerCase();
    if (!email.includes("@")) throw Object.assign(new Error("Invalid email"), { status: 400 });
    const existing = await this.repository.listMailAccounts(ownerId);
    if (existing.length >= MAIL_ACCOUNT_LIMIT)
      throw Object.assign(new Error("Mail account limit reached"), { status: 400 });
    const provider = input.provider ?? inferMailProvider(email);
    const servers = resolveMailServers(provider, input);
    const username = (input.username?.trim() || email).toLowerCase();
    const connection: MailConnection = {
      email,
      username,
      password: input.password,
      ...servers,
    };
    try {
      await this.gateway.testConnection(connection);
    } catch {
      throw Object.assign(
        new Error("Could not connect. Check the app password and IMAP/SMTP settings."),
        { status: 400, code: "MAIL_CONNECT_FAILED" },
      );
    }
    const account = await this.repository.createMailAccount(ownerId, {
      email,
      provider,
      username,
      imap_host: servers.imap_host,
      imap_port: servers.imap_port,
      smtp_host: servers.smtp_host,
      smtp_port: servers.smtp_port,
      secret_cipher: encryptSecret(input.password, this.encryptionSecret),
      status: "active",
      last_error: null,
    });
    for (const playbook of DEFAULT_MAIL_PLAYBOOKS) {
      await this.repository.createMailPlaybook(ownerId, {
        account_id: account.id,
        name: playbook.name,
        trigger: playbook.trigger,
        actions: playbook.actions,
        prompt: playbook.prompt,
        enabled: true,
      });
    }
    await this.syncAccount(ownerId, account.id).catch(() => undefined);
    return toPublicMailAccount(account);
  }

  async disconnect(ownerId: string, accountId: string) {
    return this.repository.deleteMailAccount(ownerId, accountId);
  }

  async syncDue(now = Date.now()) {
    return this.syncAccounts(
      (await this.repository.listMailAccountsDueForSync()).filter((account) =>
        isMailDueForSync(account, now),
      ),
    );
  }

  async syncOwner(ownerId: string, now = Date.now()) {
    return this.syncAccounts(
      (await this.repository.listMailAccountsDueForSync())
        .filter((account) => account.owner_id === ownerId)
        .filter((account) => isMailDueForSync(account, now, MAIL_SYNC_ON_OPEN_MIN_AGE_MS)),
    );
  }

  private async syncAccounts(accounts: MailAccount[]) {
    let synced = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        await this.syncAccount(account.owner_id, account.id, account);
        synced += 1;
      } catch {
        failed += 1;
      }
    }
    return { synced, failed, total: accounts.length };
  }

  async syncAccount(ownerId: string, accountId: string, loaded?: MailAccount) {
    const account = loaded ?? (await this.repository.getMailAccountSecret(ownerId, accountId));
    if (!account) throw Object.assign(new Error("Mail account not found"), { status: 404 });
    const connection = this.connectionOf(account);
    try {
      const fetched = await this.gateway.fetchRecent(connection, {
        sinceMs: MAIL_SYNC_SINCE_MS,
        limit: MAIL_SYNC_LIMIT,
      });
      const playbooks = await this.repository.listMailPlaybooks(ownerId);
      const tasks = await this.repository.listTasks(ownerId);
      const stored: MailMessage[] = [];
      for (const item of fetched) {
        const classified = classifyMail({
          from_address: item.from_address,
          subject: item.subject,
          snippet: item.snippet,
          has_calendar_invite: item.has_calendar_invite,
        });
        const message = await this.repository.upsertMailMessage(ownerId, {
          account_id: account.id,
          provider_uid: item.provider_uid,
          from_address: item.from_address || "unknown",
          from_name: item.from_name,
          to_address: item.to_address,
          subject: item.subject,
          snippet: mailSnippet(item.snippet),
          received_at: item.received_at,
          is_important: classified.is_important,
          is_meeting: classified.is_meeting,
          meeting_at: classified.meeting_at,
          has_calendar_invite: item.has_calendar_invite,
        });
        stored.push(message);
        if (message.handled) continue;
        const matching = playbooks.filter((playbook) => playbookMatches(playbook, message));
        if (matching.some((playbook) => playbook.actions.includes("create_task")) && message.is_meeting) {
          const title = meetingTaskTitle(message.subject, message.from_name);
          const duplicate = tasks.some(
            (task) =>
              task.status !== "done" &&
              task.status !== "cancelled" &&
              task.title === title,
          );
          if (!duplicate) {
            const task = await this.repository.createTask(ownerId, {
              title,
              description: message.snippet.slice(0, 400) || null,
              due_at: message.meeting_at,
            });
            tasks.unshift(task);
          }
          await this.repository.updateMailMessage(ownerId, message.id, { handled: true });
          message.handled = true;
        }
      }
      await this.repository.updateMailAccount(ownerId, account.id, {
        status: "active",
        last_error: null,
        last_synced_at: new Date().toISOString(),
      });
      return stored;
    } catch (error) {
      await this.repository.updateMailAccount(ownerId, account.id, {
        status: "error",
        last_error: "Could not sync mailbox.",
      });
      throw error;
    }
  }

  async sendDraft(ownerId: string, draftId: string) {
    const draft = await this.repository.getMailDraft(ownerId, draftId);
    if (!draft) throw Object.assign(new Error("Draft not found"), { status: 404 });
    if (draft.status === "sent") return draft;
    const account = await this.repository.getMailAccountSecret(ownerId, draft.account_id);
    if (!account) throw Object.assign(new Error("Mail account not found"), { status: 404 });
    try {
      await this.gateway.send(this.connectionOf(account), {
        from: account.email,
        to: draft.to_address,
        subject: draft.subject,
        text: draft.body,
      });
      const sent = await this.repository.updateMailDraft(ownerId, draft.id, {
        status: "sent",
        error: null,
        sent_at: new Date().toISOString(),
      });
      if (draft.message_id) {
        await this.repository.updateMailMessage(ownerId, draft.message_id, { handled: true });
      }
      return sent ?? draft;
    } catch {
      const failed = await this.repository.updateMailDraft(ownerId, draft.id, {
        status: "failed",
        error: "Could not send. Check SMTP settings.",
      });
      throw Object.assign(new Error("Could not send the message."), {
        status: 502,
        draft: failed ?? draft,
      });
    }
  }

  async prepareReply(
    ownerId: string,
    messageId: string,
    input?: { body?: string; subject?: string },
  ) {
    const message = await this.repository.getMailMessage(ownerId, messageId);
    if (!message) throw Object.assign(new Error("Mail not found"), { status: 404 });
    const locale = (await this.repository.getProfile(ownerId))?.locale;
    const ru = languageOf(locale) !== "en";
    const subject = input?.subject?.trim() || replySubject(message.subject);
    const body =
      input?.body?.trim() ||
      (ru
        ? `Здравствуйте${message.from_name ? `, ${message.from_name}` : ""}!\n\nСпасибо за письмо. Вернусь с ответом чуть позже.\n\n`
        : `Hello${message.from_name ? ` ${message.from_name}` : ""},\n\nThanks for the note — I will follow up shortly.\n\n`);
    return this.repository.createMailDraft(ownerId, {
      account_id: message.account_id,
      message_id: message.id,
      to_address: message.from_address,
      subject,
      body,
      status: "draft",
    });
  }

  private connectionOf(account: MailAccount): MailConnection {
    return {
      email: account.email,
      username: account.username,
      password: decryptSecret(account.secret_cipher, this.encryptionSecret),
      imap_host: account.imap_host,
      imap_port: account.imap_port,
      smtp_host: account.smtp_host,
      smtp_port: account.smtp_port,
    };
  }
}

function replySubject(subject: string) {
  return /^(re|на)\s*:/iu.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim() || "Hello"}`;
}

export type { MailAccountInput, MailDraftInput, MailPlaybook };
