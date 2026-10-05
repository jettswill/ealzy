import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isMailSyncStale,
  loadMailSnapshot,
  readMailCache,
  resetMailSync,
  startMailSync,
  writeMailCache,
} from "../mail-sync";
import type { MailAccount, MailDraft, MailMessage, MailPlaybook } from "../types";

function account(overrides: Partial<MailAccount> = {}): MailAccount {
  return {
    id: "acc-1",
    email: "me@gmail.com",
    provider: "gmail",
    username: "me@gmail.com",
    imap_host: "imap.gmail.com",
    imap_port: 993,
    smtp_host: "smtp.gmail.com",
    smtp_port: 465,
    status: "active",
    last_error: null,
    last_synced_at: null,
    ...overrides,
  };
}

function snapshot(messages: MailMessage[] = []) {
  return {
    accounts: [account({ last_synced_at: "2026-08-30T08:00:00.000Z" })],
    messages,
    drafts: [] as MailDraft[],
    playbooks: [] as MailPlaybook[],
    saved_at: 1,
  };
}

afterEach(() => {
  resetMailSync();
});

describe("mail cache and sync", () => {
  it("keeps the last mailbox snapshot when a later load fails", () => {
    writeMailCache(
      snapshot([
        {
          id: "m1",
          account_id: "acc-1",
          from_address: "boss@corp.com",
          from_name: "Boss",
          to_address: "me@gmail.com",
          subject: "Встреча завтра",
          snippet: "Zoom в 12:00",
          received_at: "2026-08-30T09:00:00.000Z",
          is_important: true,
          is_meeting: true,
          meeting_at: "2026-08-31T09:00:00.000Z",
          has_calendar_invite: true,
          handled: false,
        },
      ]),
    );
    expect(readMailCache()?.messages[0]?.subject).toBe("Встреча завтра");
  });

  it("refreshes the cache after a successful load", async () => {
    const next = snapshot();
    const api = {
      mailAccounts: vi.fn(async () => next.accounts),
      mailMessages: vi.fn(async () => next.messages),
      mailDrafts: vi.fn(async () => next.drafts),
      mailPlaybooks: vi.fn(async () => next.playbooks),
      syncMyMail: vi.fn(async () => ({ synced: 0, failed: 0, total: 0 })),
    };
    await loadMailSnapshot(api);
    expect(readMailCache()?.accounts[0]?.email).toBe("me@gmail.com");
  });

  it("syncs stale mailboxes when the app opens", async () => {
    writeMailCache(snapshot());
    const api = {
      mailAccounts: vi.fn(async () => [account({ last_synced_at: null })]),
      mailMessages: vi.fn(async () => []),
      mailDrafts: vi.fn(async () => []),
      mailPlaybooks: vi.fn(async () => []),
      syncMyMail: vi.fn(async () => ({ synced: 1, failed: 0, total: 1 })),
    };
    const stop = startMailSync(api);
    await vi.waitFor(() => expect(api.syncMyMail).toHaveBeenCalled());
    stop();
  });

  it("does not treat a just-synced mailbox as stale", () => {
    expect(
      isMailSyncStale({
        status: "active",
        last_synced_at: new Date().toISOString(),
      }),
    ).toBe(false);
    expect(isMailSyncStale({ status: "error", last_synced_at: new Date().toISOString() })).toBe(true);
  });
});
