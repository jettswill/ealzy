export const MAIL_PROVIDERS = ["gmail", "yandex", "mailru", "outlook", "custom"] as const;
export type MailProviderId = (typeof MAIL_PROVIDERS)[number];

export interface MailServerPreset {
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
}

const PRESETS: Record<Exclude<MailProviderId, "custom">, MailServerPreset> = {
  gmail: {
    imap_host: "imap.gmail.com",
    imap_port: 993,
    smtp_host: "smtp.gmail.com",
    smtp_port: 465,
  },
  yandex: {
    imap_host: "imap.yandex.ru",
    imap_port: 993,
    smtp_host: "smtp.yandex.ru",
    smtp_port: 465,
  },
  mailru: {
    imap_host: "imap.mail.ru",
    imap_port: 993,
    smtp_host: "smtp.mail.ru",
    smtp_port: 465,
  },
  outlook: {
    imap_host: "outlook.office365.com",
    imap_port: 993,
    smtp_host: "smtp.office365.com",
    smtp_port: 587,
  },
};

export function resolveMailServers(
  provider: MailProviderId,
  custom?: Partial<MailServerPreset>,
): MailServerPreset {
  if (provider === "custom") {
    const imap_host = custom?.imap_host?.trim() ?? "";
    const smtp_host = custom?.smtp_host?.trim() ?? "";
    if (!imap_host || !smtp_host) throw new Error("Custom IMAP and SMTP hosts are required");
    return {
      imap_host,
      imap_port: custom?.imap_port || 993,
      smtp_host,
      smtp_port: custom?.smtp_port || 465,
    };
  }
  const preset = PRESETS[provider];
  return {
    ...preset,
    imap_host: custom?.imap_host?.trim() || preset.imap_host,
    imap_port: custom?.imap_port || preset.imap_port,
    smtp_host: custom?.smtp_host?.trim() || preset.smtp_host,
    smtp_port: custom?.smtp_port || preset.smtp_port,
  };
}

export function inferMailProvider(email: string): MailProviderId {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  if (domain === "yandex.ru" || domain === "yandex.com" || domain === "ya.ru") return "yandex";
  if (domain === "mail.ru" || domain === "inbox.ru" || domain === "bk.ru" || domain === "list.ru")
    return "mailru";
  if (
    domain === "outlook.com" ||
    domain === "hotmail.com" ||
    domain === "live.com" ||
    domain.endsWith(".onmicrosoft.com")
  )
    return "outlook";
  return "custom";
}
