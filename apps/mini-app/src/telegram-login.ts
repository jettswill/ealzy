export type TelegramLoginPayload = Record<string, string | number>;

export function telegramBotId() {
  const fromEnv = (import.meta.env.VITE_TELEGRAM_BOT_ID as string | undefined)?.trim();
  return fromEnv && /^\d+$/.test(fromEnv) ? fromEnv : "";
}

export function telegramBotUsername() {
  const fromEnv = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined)?.trim();
  return fromEnv ? fromEnv.replace(/^@/, "") : "";
}

export function telegramAuthUrl(botId: string, returnTo = telegramReturnTo()) {
  const origin = window.location.origin;
  const params = new URLSearchParams({
    bot_id: botId,
    origin,
    request_access: "write",
    return_to: returnTo,
  });
  return `https://oauth.telegram.org/auth?${params.toString()}`;
}

export function telegramReturnTo() {
  return `${window.location.origin}/auth/telegram`;
}

export function telegramLoginCallbackPath() {
  return "/auth/telegram";
}

export function hasTelegramAuthResult(source = "") {
  return /(?:^|[?#&])tgAuthResult=/.test(source);
}

function readQueryValue(source: string, key: string, keepPlus = false) {
  const match = new RegExp(`(?:^|[?#&])${key}=([^&]*)`).exec(source);
  if (!match) return null;
  const raw = keepPlus ? match[1].replace(/\+/g, "%2B") : match[1];
  try {
    return decodeURIComponent(raw);
  } catch {
    return match[1];
  }
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return decodeURIComponent(
    Array.from(binary, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
  );
}

function payloadFromFields(
  fields: Record<string, string | number | undefined | null>,
): TelegramLoginPayload | null {
  const id = Number(fields.id);
  const hashValue = String(fields.hash ?? "");
  const authDate = Number(fields.auth_date);
  const firstName = String(fields.first_name ?? "");
  if (!Number.isFinite(id) || id <= 0 || !hashValue || !Number.isFinite(authDate) || !firstName) {
    return null;
  }
  const payload: TelegramLoginPayload = {
    id,
    first_name: firstName,
    auth_date: authDate,
    hash: hashValue,
  };
  if (fields.last_name) payload.last_name = String(fields.last_name);
  if (fields.username) payload.username = String(fields.username);
  if (fields.photo_url) payload.photo_url = String(fields.photo_url);
  return payload;
}

function payloadFromParams(source: string): TelegramLoginPayload | null {
  return payloadFromFields({
    id: readQueryValue(source, "id"),
    hash: readQueryValue(source, "hash"),
    auth_date: readQueryValue(source, "auth_date"),
    first_name: readQueryValue(source, "first_name"),
    last_name: readQueryValue(source, "last_name"),
    username: readQueryValue(source, "username"),
    photo_url: readQueryValue(source, "photo_url"),
  });
}

function payloadFromAuthResult(source: string): TelegramLoginPayload | null {
  const encoded = readQueryValue(source, "tgAuthResult", true);
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(encoded)) as Record<string, unknown>;
    return payloadFromFields({
      id: parsed.id as string | number | undefined,
      hash: parsed.hash as string | undefined,
      auth_date: parsed.auth_date as string | number | undefined,
      first_name: parsed.first_name as string | undefined,
      last_name: parsed.last_name as string | undefined,
      username: parsed.username as string | undefined,
      photo_url: parsed.photo_url as string | undefined,
    });
  } catch {
    return null;
  }
}

export function telegramLoginFromSearch(
  search: string,
  hash = "",
): TelegramLoginPayload | null {
  return (
    payloadFromParams(search) ??
    payloadFromAuthResult(hash) ??
    payloadFromAuthResult(search) ??
    payloadFromParams(hash)
  );
}
