import { lookup } from "node:dns/promises";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

export interface MailConnection {
  email: string;
  username: string;
  password: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
}

export interface FetchedMail {
  provider_uid: string;
  from_address: string;
  from_name: string | null;
  to_address: string | null;
  subject: string;
  snippet: string;
  received_at: string | null;
  has_calendar_invite: boolean;
}

export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface MailGateway {
  testConnection(connection: MailConnection): Promise<void>;
  fetchRecent(connection: MailConnection, options?: { sinceMs?: number; limit?: number }): Promise<FetchedMail[]>;
  send(connection: MailConnection, message: OutgoingMail): Promise<void>;
}

export class MemoryMailGateway implements MailGateway {
  inbox: FetchedMail[] = [];
  sent: OutgoingMail[] = [];
  failConnect = false;
  failSend = false;

  async testConnection() {
    if (this.failConnect) throw new Error("IMAP connection failed");
  }

  async fetchRecent() {
    if (this.failConnect) throw new Error("IMAP fetch failed");
    return this.inbox;
  }

  async send(_connection: MailConnection, message: OutgoingMail) {
    if (this.failSend) throw new Error("SMTP send failed");
    this.sent.push(message);
  }
}

const FETCH_SINCE_MS = 36 * 60 * 60_000;
const FETCH_LIMIT = 30;

async function ipv4Of(host: string) {
  const { address } = await lookup(host, { family: 4 });
  return address;
}

function addressOf(value: { address?: string | null; name?: string | null } | undefined) {
  return value?.address?.trim() || "";
}

function nameOf(value: { address?: string | null; name?: string | null } | undefined) {
  return value?.name?.trim() || null;
}

export class ImapSmtpGateway implements MailGateway {
  async testConnection(connection: MailConnection) {
    const imap = await this.connectImap(connection);
    try {
      await imap.logout();
    } catch {
      imap.close();
    }
    const smtp = await this.smtp(connection);
    try {
      await smtp.verify();
    } finally {
      smtp.close();
    }
  }

  async fetchRecent(
    connection: MailConnection,
    options?: { sinceMs?: number; limit?: number },
  ): Promise<FetchedMail[]> {
    const client = await this.connectImap(connection);
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - (options?.sinceMs ?? FETCH_SINCE_MS));
      const uids = await client.search({ since }, { uid: true });
      const slice = (Array.isArray(uids) ? uids : []).slice(-(options?.limit ?? FETCH_LIMIT));
      const items: FetchedMail[] = [];
      for (const uid of slice) {
        const msg = await client.fetchOne(
          String(uid),
          { envelope: true, bodyStructure: true, source: { maxLength: 12_000 } },
          { uid: true },
        );
        if (!msg || msg.envelope == null) continue;
        const source = Buffer.isBuffer(msg.source)
          ? msg.source.toString("utf8")
          : typeof msg.source === "string"
            ? msg.source
            : "";
        const from = msg.envelope.from?.[0];
        items.push({
          provider_uid: String(msg.uid ?? uid),
          from_address: addressOf(from),
          from_name: nameOf(from),
          to_address: addressOf(msg.envelope.to?.[0]) || connection.email,
          subject: msg.envelope.subject?.trim() || "",
          snippet: source,
          received_at: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : null,
          has_calendar_invite: /text\/calendar|\.ics|method=REQUEST/iu.test(
            `${JSON.stringify(msg.bodyStructure ?? {})}\n${source}`,
          ),
        });
      }
      return items;
    } finally {
      lock.release();
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  }

  async send(connection: MailConnection, message: OutgoingMail) {
    const smtp = await this.smtp(connection);
    try {
      await smtp.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    } finally {
      smtp.close();
    }
  }

  private async connectImap(connection: MailConnection) {
    const host = await ipv4Of(connection.imap_host);
    const client = new ImapFlow({
      host,
      port: connection.imap_port,
      secure: connection.imap_port !== 143,
      auth: { user: connection.username, pass: connection.password },
      logger: false,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      tls: { servername: connection.imap_host },
    });
    await client.connect();
    return client;
  }

  private async smtp(connection: MailConnection) {
    const host = await ipv4Of(connection.smtp_host);
    return nodemailer.createTransport({
      host,
      port: connection.smtp_port,
      secure: connection.smtp_port === 465,
      auth: { user: connection.username, pass: connection.password },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 20_000,
      tls: { servername: connection.smtp_host },
    });
  }
}
