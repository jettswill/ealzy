// Telegram's hosted Bot API only allows bots to download files up to 20 MB.
const MAX_VOICE_BYTES = 20_000_000;
const MAX_TEXT = 4000;

export type TelegramFile = {
  bytes: Uint8Array;
  filename: string;
  mime: string;
};

export type TelegramInboundMessage = {
  text?: string;
  caption?: string;
  voice?: { file_id: string; file_size?: number; duration?: number; mime_type?: string };
  audio?: { file_id: string; file_size?: number; mime_type?: string; file_name?: string };
  video_note?: { file_id: string; file_size?: number };
  photo?: { file_id: string }[];
  document?: { file_id: string; file_name?: string; mime_type?: string };
  forward_date?: number;
  forward_sender_name?: string;
  forward_from?: { first_name?: string; last_name?: string };
  forward_origin?: {
    type?: string;
    sender_user?: { first_name?: string; last_name?: string };
    sender_user_name?: string;
  };
};

export type InboundCapture = {
  text: string;
  source: "text" | "voice" | "forward" | "caption";
  forwarded_from: string | null;
};

export function isForwarded(message: TelegramInboundMessage) {
  return Boolean(
    message.forward_date ||
    message.forward_from ||
    message.forward_sender_name ||
    message.forward_origin,
  );
}

export function forwardName(message: TelegramInboundMessage) {
  const origin = message.forward_origin;
  const fromUser = origin?.sender_user ?? message.forward_from;
  const named = [fromUser?.first_name, fromUser?.last_name].filter(Boolean).join(" ");
  return origin?.sender_user_name || message.forward_sender_name || named || null;
}

export function hasCapturableMedia(message: TelegramInboundMessage) {
  return Boolean(message.voice || message.audio || message.video_note || message.photo?.length);
}

function voiceFile(message: TelegramInboundMessage) {
  if (message.voice) {
    return {
      file_id: message.voice.file_id,
      filename: "voice.ogg",
      mime: message.voice.mime_type ?? "audio/ogg",
      file_size: message.voice.file_size,
    };
  }
  if (message.audio) {
    return {
      file_id: message.audio.file_id,
      filename: message.audio.file_name ?? "audio.mp3",
      mime: message.audio.mime_type ?? "audio/mpeg",
      file_size: message.audio.file_size,
    };
  }
  if (message.video_note) {
    return {
      file_id: message.video_note.file_id,
      filename: "video_note.mp4",
      mime: "video/mp4",
      file_size: message.video_note.file_size,
    };
  }
  return null;
}

export async function captureTelegramInbound(
  message: TelegramInboundMessage,
  deps: {
    downloadFile?: (fileId: string) => Promise<TelegramFile | null>;
    prepareForTranscription?: (file: TelegramFile) => Promise<TelegramFile>;
    transcribe?: (file: TelegramFile) => Promise<string | null>;
  } = {},
): Promise<InboundCapture | { empty: true } | { unreadable: true }> {
  const written = (message.text ?? message.caption ?? "").trim();
  const media = voiceFile(message);
  let spoken = "";
  if (media && deps.downloadFile && deps.transcribe) {
    if ((media.file_size ?? 0) > MAX_VOICE_BYTES) {
      if (!written) return { unreadable: true };
    } else {
      try {
        const file = await deps.downloadFile(media.file_id);
        if (file && file.bytes.byteLength <= MAX_VOICE_BYTES) {
          const normalized = {
            ...file,
            filename: media.filename,
            mime: media.mime,
          };
          const prepared =
            message.video_note && deps.prepareForTranscription
              ? await deps.prepareForTranscription(normalized)
              : normalized;
          spoken = ((await deps.transcribe(prepared)) ?? "").trim();
        }
      } catch {
        spoken = "";
      }
    }
  }
  let text = [written, spoken].filter(Boolean).join("\n\n").trim();
  if (!text) {
    if (hasCapturableMedia(message) || media) return { unreadable: true };
    return { empty: true };
  }
  const forwarded = isForwarded(message);
  const from = forwarded ? forwardName(message) : null;
  if (forwarded) {
    text = from ? `${text}\n\n(переслано от ${from})` : `${text}\n\n(переслано)`;
  }
  return {
    text: text.slice(0, MAX_TEXT),
    source:
      spoken && !written
        ? "voice"
        : forwarded
          ? "forward"
          : written && message.caption && !message.text
            ? "caption"
            : "text",
    forwarded_from: from,
  };
}

export function stripForwardAttribution(text: string) {
  return text.replace(/\n*\(переслано(?: от [^)]+)?\)\s*$/u, "").trim();
}

export type TelegramQuotedReply = {
  telegram_message_id: number;
  content: string;
  role: "user" | "assistant" | "unknown";
};

export function telegramQuotedReply(message: {
  reply_to_message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    from?: { is_bot?: boolean; first_name?: string };
  } | null;
}): TelegramQuotedReply | null {
  const quoted = message.reply_to_message;
  if (!quoted) return null;
  const content = (quoted.text ?? quoted.caption ?? "").trim();
  if (!content) return null;
  return {
    telegram_message_id: Number(quoted.message_id) || 0,
    content: content.slice(0, MAX_TEXT),
    role: quoted.from?.is_bot ? "assistant" : quoted.from ? "user" : "unknown",
  };
}
