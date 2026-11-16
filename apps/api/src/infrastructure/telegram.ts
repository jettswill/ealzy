import { parseAppLoginStart } from "../modules/auth/index.js";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { formatCompanionTelegramText } from "../modules/assistant/companion.js";
import type { AppRepository } from "../repository.js";
import type {
  AiProvider,
  AssistantHandleResult,
  AssistantOrchestrator,
  CompanionService,
  ReflectionService,
} from "../modules/assistant/index.js";
import {
  captureTelegramInbound,
  stripForwardAttribution,
  telegramQuotedReply,
  type TelegramFile,
} from "./telegram-inbound.js";
import {
  completeExperienceFollowUpPending,
  createExperienceParticipantDisambiguation,
  createPersonDisambiguation,
  parseDayCloseCallback,
  parseGoalCheckInCallback,
  parseMailSendCallback,
  parsePendingCallback,
  resumeDayClose,
  resumeGoalCheckIn,
  resumeMailSend,
  resumePendingAction,
  dayCloseActionKeyboard,
  dayCloseListKeyboard,
} from "../modules/assistant/pending-actions.js";
import type { MailService } from "../modules/mail/service.js";
import type { AssistantIntent } from "../types.js";
import { HttpError } from "../middleware.js";
import { languageOf, localeFromLanguageCode } from "../locale.js";
import { compressVideoNoteAudio } from "./audio.js";
import {
  GUIDED_ONBOARDING_ACTION,
  ONBOARDING_MORE_CALLBACK,
  onboardingAddressMarkup,
  parseOnboardingAddress,
  saveAddressForm,
  startGuidedOnboarding,
  startOnboardingMore,
  handleOnboardingReply,
  skipGuidedOnboarding,
  onboardingReplyMarkup,
} from "../modules/assistant/guided-onboarding.js";
import {
  BRAIN_DUMP_ACTION,
  handleBrainDumpReply,
} from "../modules/assistant/first-session.js";
import { runWithUsageOwner } from "../modules/billing/usage.js";

const TelegramUserSchema = z
  .object({
    id: z.number().int().positive(),
    first_name: z.string(),
    last_name: z.string().optional(),
    username: z.string().optional(),
    language_code: z.string().optional(),
    is_bot: z.boolean().optional(),
  })
  .passthrough();
const TelegramMessageSchema = z
  .object({
    message_id: z.number().int(),
    text: z.string().optional(),
    caption: z.string().optional(),
    voice: z
      .object({
        file_id: z.string(),
        duration: z.number().optional(),
        mime_type: z.string().optional(),
        file_size: z.number().optional(),
      })
      .passthrough()
      .optional(),
    audio: z
      .object({
        file_id: z.string(),
        mime_type: z.string().optional(),
        file_name: z.string().optional(),
        file_size: z.number().optional(),
      })
      .passthrough()
      .optional(),
    video_note: z
      .object({
        file_id: z.string(),
        file_size: z.number().optional(),
      })
      .passthrough()
      .optional(),
    photo: z.array(z.object({ file_id: z.string() }).passthrough()).optional(),
    forward_date: z.number().optional(),
    forward_sender_name: z.string().optional(),
    forward_from: z
      .object({
        first_name: z.string().optional(),
        last_name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    forward_origin: z
      .object({
        type: z.string().optional(),
        sender_user: z
          .object({
            first_name: z.string().optional(),
            last_name: z.string().optional(),
          })
          .passthrough()
          .optional(),
        sender_user_name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    chat: z.object({ id: z.number().int() }).passthrough(),
    from: TelegramUserSchema,
    reply_to_message: z
      .object({
        message_id: z.number().int(),
        text: z.string().optional(),
        caption: z.string().optional(),
        from: TelegramUserSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const TelegramUpdateSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
    message: TelegramMessageSchema.optional(),
    edited_message: TelegramMessageSchema.optional(),
    callback_query: z
      .object({
        id: z.string(),
        data: z.string().optional(),
        from: TelegramUserSchema,
        message: z
          .object({
            message_id: z.number().int(),
            chat: z.object({ id: z.number().int() }).passthrough(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;

export interface TelegramGateway {
  sendMessage(
    chatId: number,
    text: string,
    options?: Record<string, unknown>,
  ): Promise<{ message_id?: number } | void>;
  answerCallbackQuery(id: string, text?: string): Promise<void>;
  editMessageReplyMarkup?(
    chatId: number,
    messageId: number,
    replyMarkup: { inline_keyboard: { text: string; callback_data?: string; web_app?: { url: string } }[][] },
  ): Promise<void>;
  sendChatAction?(chatId: number, action?: string): Promise<void>;
  downloadFile?(fileId: string): Promise<TelegramFile | null>;
  getUpdates?(offset: number, timeoutSeconds?: number): Promise<unknown[]>;
  deleteWebhook?(dropPending?: boolean): Promise<void>;
}

const escapeTelegramHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escapeTelegramAttribute = (text: string) =>
  escapeTelegramHtml(text).replaceAll('"', "&quot;");

const findClosingDelimiter = (text: string, delimiter: string, from: number) => {
  let cursor = from;
  while ((cursor = text.indexOf(delimiter, cursor)) !== -1) {
    let backslashes = 0;
    for (let index = cursor - 1; index >= 0 && text[index] === "\\"; index -= 1) backslashes += 1;
    if (backslashes % 2 === 0) {
      if (delimiter.length === 2 && text.startsWith(delimiter[0]!.repeat(3), cursor)) {
        return cursor + 1;
      }
      return cursor;
    }
    cursor += delimiter.length;
  }
  return -1;
};

function formatTelegramInline(text: string): string {
  let result = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] === "\\" && index + 1 < text.length && /[\\*_`[\]]/.test(text[index + 1]!)) {
      result += escapeTelegramHtml(text[index + 1]!);
      index += 2;
      continue;
    }
    if (text[index] === "`") {
      const closing = findClosingDelimiter(text, "`", index + 1);
      if (closing !== -1) {
        result += `<code>${escapeTelegramHtml(text.slice(index + 1, closing))}</code>`;
        index = closing + 1;
        continue;
      }
    }
    if (text[index] === "[") {
      const labelEnd = text.indexOf("](", index + 1);
      const urlEnd = labelEnd === -1 ? -1 : text.indexOf(")", labelEnd + 2);
      if (labelEnd !== -1 && urlEnd !== -1) {
        const url = text.slice(labelEnd + 2, urlEnd);
        if (/^(?:https?:\/\/|tg:\/\/|mailto:)/iu.test(url)) {
          result += `<a href="${escapeTelegramAttribute(url)}">${formatTelegramInline(
            text.slice(index + 1, labelEnd),
          )}</a>`;
          index = urlEnd + 1;
          continue;
        }
      }
    }
    const delimiter =
      text.startsWith("**", index) || text.startsWith("__", index)
        ? text.slice(index, index + 2)
        : text[index] === "*" || text[index] === "_"
          ? text[index]!
          : null;
    if (delimiter) {
      const closing = findClosingDelimiter(text, delimiter, index + delimiter.length);
      if (closing > index + delimiter.length) {
        const tag = delimiter.length === 2 ? "b" : "i";
        result += `<${tag}>${formatTelegramInline(
          text.slice(index + delimiter.length, closing),
        )}</${tag}>`;
        index = closing + delimiter.length;
        continue;
      }
    }
    result += escapeTelegramHtml(text[index]!);
    index += 1;
  }
  return result;
}

export function formatTelegramHtml(text: string) {
  const fence = /```(?:[a-z0-9_+-]+)?[ \t]*\n([\s\S]*?)```/giu;
  let result = "";
  let cursor = 0;
  for (const match of text.matchAll(fence)) {
    const start = match.index;
    result += formatTelegramInline(text.slice(cursor, start));
    result += `<pre>${escapeTelegramHtml(match[1]!)}</pre>`;
    cursor = start + match[0].length;
  }
  return result + formatTelegramInline(text.slice(cursor));
}

const TELEGRAM_SAFE_CHUNK_LEN = 3900; // margin under Telegram's 4096-char cap

function splitTelegramChunks(text: string, maxLen = TELEGRAM_SAFE_CHUNK_LEN): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLen) return [trimmed];
  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n\n", maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.4) cut = rest.lastIndexOf(" ", maxLen);
    if (cut < maxLen * 0.4) cut = maxLen;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export const TELEGRAM_API_ORIGIN = "https://api.telegram.org";

export class TelegramClient implements TelegramGateway {
  private readonly apiBase: string;
  // apiBase — адрес Bot API. По умолчанию это сам Telegram; с сервера в России он
  // недоступен, поэтому сюда можно подставить свой HTTPS-прокси (см.
  // deploy/telegram-proxy). Прокси должен пересылать путь как есть.
  constructor(
    private readonly token: string,
    apiBase: string = TELEGRAM_API_ORIGIN,
  ) {
    this.apiBase = apiBase.replace(/\/+$/, "");
  }
  private async call(method: string, body: unknown) {
    await this.callJson(method, body);
  }
  private async callJson(method: string, body: unknown, timeoutMs = 15_000) {
    const response = await fetch(`${this.apiBase}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Telegram ${method} failed (${response.status})`);
    return (await response.json()) as { ok?: boolean; result?: unknown };
  }
  async sendMessage(chatId: number, text: string, options: Record<string, unknown> = {}) {
    const hasExplicitFormatting =
      options.parse_mode !== undefined || options.entities !== undefined;
    const data = await this.callJson("sendMessage", {
      chat_id: chatId,
      text: hasExplicitFormatting ? text : formatTelegramHtml(text),
      ...(hasExplicitFormatting ? {} : { parse_mode: "HTML" }),
      ...options,
    });
    const result = data.result;
    const messageId =
      result && typeof result === "object" && "message_id" in result
        ? Number((result as { message_id?: unknown }).message_id)
        : NaN;
    return { message_id: Number.isFinite(messageId) ? messageId : undefined };
  }
  sendChatAction(chatId: number, action = "typing") {
    return this.call("sendChatAction", { chat_id: chatId, action });
  }
  answerCallbackQuery(id: string, text?: string) {
    return this.call("answerCallbackQuery", { callback_query_id: id, text });
  }
  editMessageReplyMarkup(
    chatId: number,
    messageId: number,
    replyMarkup: { inline_keyboard: { text: string; callback_data?: string; web_app?: { url: string } }[][] },
  ) {
    return this.call("editMessageReplyMarkup", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup,
    });
  }
  async downloadFile(fileId: string): Promise<TelegramFile | null> {
    const meta = await this.callJson("getFile", { file_id: fileId });
    const path =
      meta && typeof meta.result === "object" && meta.result && "file_path" in meta.result
        ? String((meta.result as { file_path?: unknown }).file_path ?? "")
        : "";
    if (!path) return null;
    const file = await fetch(`${this.apiBase}/file/bot${this.token}/${path}`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!file.ok) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const filename = path.split("/").at(-1) || "voice.ogg";
    return {
      bytes,
      filename,
      mime:
        filename.endsWith(".oga") || filename.endsWith(".ogg")
          ? "audio/ogg"
          : "application/octet-stream",
    };
  }
  async deleteWebhook(dropPending = false) {
    await this.callJson("deleteWebhook", { drop_pending_updates: dropPending });
  }
  async getUpdates(offset: number, timeoutSeconds = 50) {
    const data = await this.callJson(
      "getUpdates",
      {
        offset,
        timeout: timeoutSeconds,
        allowed_updates: ["message", "edited_message", "callback_query"],
      },
      (timeoutSeconds + 10) * 1000,
    );
    return Array.isArray(data.result) ? data.result : [];
  }
}

export async function startTelegramPolling(
  handler: { handle: (raw: unknown) => Promise<unknown> },
  telegram: TelegramGateway,
  options: { signal?: AbortSignal; timeoutSeconds?: number } = {},
) {
  if (!telegram.getUpdates) return;
  await telegram.deleteWebhook?.(false).catch((error) => {
    console.error(
      JSON.stringify({
        event: "telegram_delete_webhook_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });
  let offset = 0;
  const timeoutSeconds = options.timeoutSeconds ?? 50;
  console.log("Telegram long polling started");
  while (!options.signal?.aborted) {
    try {
      const updates = await telegram.getUpdates(offset, timeoutSeconds);
      for (const update of updates) {
        const updateId =
          update && typeof update === "object" && "update_id" in update
            ? Number((update as { update_id?: unknown }).update_id)
            : NaN;
        if (Number.isFinite(updateId)) offset = Math.max(offset, updateId + 1);
        await handler.handle(update);
      }
    } catch (error) {
      if (options.signal?.aborted) return;
      console.error(
        JSON.stringify({
          event: "telegram_polling_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  }
}
export function assertWebhookSecret(
  pathSecret: string,
  headerSecret: string | undefined,
  expected: string,
) {
  const equal = (value: string) => {
    const a = Buffer.from(value);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  if (!equal(pathSecret) || (headerSecret !== undefined && !equal(headerSecret)))
    throw new HttpError(401, "INVALID_WEBHOOK_SECRET", "Invalid webhook secret");
}

export class TelegramUpdateHandler {
  constructor(
    private readonly repository: AppRepository,
    private readonly assistant: AssistantOrchestrator,
    private readonly companion: CompanionService,
    private readonly reflections: ReflectionService,
    private readonly telegram: TelegramGateway,
    private readonly miniAppUrl: string,
    private readonly ai?: AiProvider,
    private readonly mail?: MailService,
  ) {}
  async handle(raw: unknown) {
    const update = TelegramUpdateSchema.parse(raw);
    if (!(await this.repository.claimTelegramUpdate(update.update_id))) return { duplicate: true };
    if (update.callback_query) return this.handleCallback(update);
    const message = update.message ?? update.edited_message;
    if (!message) return { duplicate: false };
    try {
      return await this.handleMessage(update, message);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "telegram_handle_failed",
          update_id: update.update_id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      try {
        await this.telegram.sendMessage(
          message.chat.id,
          "Сейчас не получилось разобрать. Напишите ещё раз текстом или коротким голосом — я попробую понять и сделать.",
        );
      } catch (sendError) {
        console.error(
          JSON.stringify({
            event: "telegram_error_reply_failed",
            error: sendError instanceof Error ? sendError.message : String(sendError),
          }),
        );
      }
      return { duplicate: false };
    }
  }

  /**
   * Sends a companion answer to Telegram, splitting it into multiple messages
   * when it exceeds Telegram's 4096-char limit, and falling back to a plain
   * (non-HTML) retry if the API rejects the formatted text (e.g. unbalanced
   * entities). A delivery failure here must never bubble up to the generic
   * "не получилось разобрать" handler in handle(): Ealzy did understand the
   * request and already did the work — only the message delivery broke, and
   * the person deserves an honest, specific message about that instead of
   * being told (wrongly) that their request wasn't understood at all.
   */
  private async safeSendCompanionReply(
    chatId: number,
    text: string,
    extraOptions?: Record<string, unknown>,
  ): Promise<{ message_id?: number } | undefined> {
    const chunks = splitTelegramChunks(text);
    if (!chunks.length) return undefined;
    // sendMessage у шлюза объявлен как Promise<{ message_id?: number } | void>,
    // поэтому результат нормализуем к undefined, а не тащим void дальше.
    let lastSent: { message_id?: number } | undefined;
    let anyDelivered = false;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!;
      const isLast = i === chunks.length - 1;
      const options = isLast ? extraOptions : undefined;
      try {
        lastSent = (await this.telegram.sendMessage(chatId, chunk, options)) || undefined;
        anyDelivered = true;
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "telegram_companion_reply_chunk_failed",
            chat_id: chatId,
            chunk_index: i,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        try {
          // entities: [] tells TelegramGateway.sendMessage to send the chunk
          // verbatim, skipping the HTML auto-formatting that likely caused
          // the first attempt to fail Telegram's entity parser.
          lastSent =
            (await this.telegram.sendMessage(chatId, chunk, {
              ...(options ?? {}),
              entities: [],
            })) || undefined;
          anyDelivered = true;
        } catch (plainError) {
          console.error(
            JSON.stringify({
              event: "telegram_companion_reply_plain_failed",
              chat_id: chatId,
              chunk_index: i,
              error: plainError instanceof Error ? plainError.message : String(plainError),
            }),
          );
        }
      }
    }
    if (!anyDelivered) {
      try {
        lastSent =
          (await this.telegram.sendMessage(
            chatId,
            "Я разобрала запрос и подготовила ответ, но не смогла его отправить целиком — похоже, он получился слишком длинным или Telegram не принял формат. Напишите «покажи короче», пришлю сжатую версию.",
          )) || undefined;
      } catch (finalError) {
        console.error(
          JSON.stringify({
            event: "telegram_companion_reply_final_failed",
            chat_id: chatId,
            error: finalError instanceof Error ? finalError.message : String(finalError),
          }),
        );
      }
    }
    return lastSent;
  }

  private async handleMessage(
    _update: TelegramUpdate,
    message: NonNullable<TelegramUpdate["message"]>,
  ) {
    await this.telegram.sendChatAction?.(message.chat.id, "typing").catch(() => undefined);
    const user = await this.repository.upsertTelegramUser({
      telegram_id: message.from.id,
      name: [message.from.first_name, message.from.last_name].filter(Boolean).join(" "),
      username: message.from.username ?? null,
    });
    void this.repository.updateProfile(user.id, { last_active_at: new Date().toISOString() }).catch(
      () => undefined,
    );
    if (message.from.language_code && Date.now() - Date.parse(user.created_at) < 15_000) {
      const profile = await this.repository.getProfile(user.id);
      if (profile?.locale === "ru") {
        await this.repository.updateProfile(user.id, {
          locale: localeFromLanguageCode(message.from.language_code),
        });
      }
    }
    return runWithUsageOwner(user.id, async () => {
    const inbound = await captureTelegramInbound(message, {
      downloadFile: this.telegram.downloadFile?.bind(this.telegram),
      prepareForTranscription: async (file) => {
        try {
          return await compressVideoNoteAudio(file);
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "video_note_audio_conversion_failed",
              bytes: file.bytes.byteLength,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          throw error;
        }
      },
      transcribe: this.ai?.transcribe?.bind(this.ai),
    });
    const conversation = await this.repository.getPrimaryConversation(user.id);
    const en = languageOf((await this.repository.getProfile(user.id))?.locale) === "en";
    if ("empty" in inbound) {
      await this.telegram.sendMessage(
        message.chat.id,
        en
          ? "I need a text, a voice memo, or a forwarded note to understand what you want."
          : "Напишите текстом, наговорите голосом или перешлите заметку — так я пойму, что сделать.",
      );
      return { duplicate: false };
    }
    if ("unreadable" in inbound) {
      await this.telegram.sendMessage(
        message.chat.id,
        en
          ? "I couldn't read that. Add a caption, type it, or send a shorter voice note."
          : "Не разобрал это. Добавьте подпись, напишите текстом или наговорите короче.",
      );
      return { duplicate: false };
    }
    const text = inbound.text;
    const commandText = stripForwardAttribution(text);
    const appLoginNonce = parseAppLoginStart(commandText);
    if (appLoginNonce) {
      const approved = await this.repository.approveAppLoginRequest(appLoginNonce, user.id);
      await this.telegram.sendMessage(
        message.chat.id,
        approved
          ? en
            ? "Done — you're signed in to the Ealzy app. Go back to it."
            : "Готово, вход в приложение Ealzy подтверждён. Возвращайся в него."
          : en
            ? "This sign-in link has expired. Tap “Sign in with Telegram” in the app again."
            : "Ссылка для входа устарела. Нажми «Войти через Telegram» в приложении ещё раз.",
      );
      return { duplicate: false };
    }
    const replyTo = await this.resolveQuotedReply(user.id, message.chat.id, message);
    const stored = await this.repository.createMessage(user.id, {
      conversation_id: conversation.id,
      telegram_chat_id: message.chat.id,
      telegram_message_id: message.message_id,
      role: "user",
      content: text,
      intent: null,
      source_channel: "telegram",
      metadata: {
        capture: inbound.source,
        forwarded_from: inbound.forwarded_from,
        ...(replyTo ? { reply_to: replyTo } : {}),
      },
    });
    if (!stored) return { duplicate: true };
    if (commandText === "/start") {
      const profile = await this.repository.getProfile(user.id);
      const en = languageOf(profile?.locale) === "en";
      await this.repository.updateMessageIntent(user.id, stored.id, "other");

      if (!profile?.onboarding_completed_at) {
        const question = await startGuidedOnboarding(
          this.repository,
          user.id,
          message.chat.id,
          profile?.locale,
        );
        const addressMarkup = onboardingAddressMarkup(profile?.locale);
        await this.telegram.sendMessage(
          message.chat.id,
          question,
          addressMarkup ? { reply_markup: addressMarkup } : {},
        );
        await this.repository.createMessage(user.id, {
          conversation_id: conversation.id,
          telegram_chat_id: null,
          telegram_message_id: null,
          role: "assistant",
          content: question,
          intent: "other",
          source_channel: "telegram",
          metadata: {},
        });
        return { duplicate: false };
      }

      const welcome = en
        ? [
            "Ealzy helps you use your time and energy well, stick to plans, and reach ambitious goals.",
            "I'm nearby as a time-management mentor, an adequate coach, and a psychologist — not a guru. Ask anything, including a silly question. About once a week I may invite a short sync on goals and plans; it's your move.",
            "",
            "Examples:",
            "• “Three things today: call, pay bills, finish the offer”",
            "• Forward a note or send a voice memo",
            "• “This week's goal is to ship the landing”",
            "• /companion — open conversation",
            "• /reflection — weekly review",
          ].join("\n")
        : [
            "Ealzy помогает беречь время и силы, держаться планов и идти к большим целям.",
            "Я рядом как ментор по тайм-менеджменту, спокойный наставник и психолог — без пафоса. Можно спрашивать что угодно, даже глупости. Раз в неделю могу предложить свериться по целям и плану — это твой ход.",
            "",
            "Примеры:",
            "• «Три дела на сегодня: позвонить, оплатить счета, дописать оффер»",
            "• Перешлите сообщение или наговорите голосом",
            "• «Цель на неделю — запустить лендинг»",
            "• /companion — свободный разговор",
            "• /reflection — обзор недели",
          ].join("\n");
      await this.telegram.sendMessage(message.chat.id, welcome, {
        reply_markup: {
          inline_keyboard: [
            [{ text: en ? "Open Ealzy" : "Открыть Ealzy", web_app: { url: this.miniAppUrl } }],
          ],
        },
      });
      await this.repository.createMessage(user.id, {
        conversation_id: conversation.id,
        telegram_chat_id: null,
        telegram_message_id: null,
        role: "assistant",
        content: welcome,
        intent: "other",
        source_channel: "telegram",
        metadata: {},
      });
      return { duplicate: false };
    }
    if (commandText === "/companion" || commandText === "/lifeos") {
      const mode = commandText === "/companion" ? "companion" : "command";
      await this.repository.updateConversationMode(user.id, mode);
      const reply =
        mode === "companion"
          ? en
            ? "I'm here. We can think out loud, look at the plan, or ask anything — even a silly question."
            : "Я рядом. Можно подумать вслух, разобрать план или спросить что угодно — даже глупость."
          : en
            ? "Command mode is on. Memory, tasks, spaces, and recommendations are available."
            : "Command mode включён. Доступны память, задачи, пространства и рекомендации.";
      await this.repository.updateMessageIntent(user.id, stored.id, "other");
      await this.persistAndSend(user.id, conversation.id, message.chat.id, reply, "other");
      return { duplicate: false };
    }
    if (commandText === "/reflection") {
      const reflection = await this.reflections.weekly(user.id);
      const en = languageOf((await this.repository.getProfile(user.id))?.locale) === "en";
      const text = [
        en ? "Weekly review" : "Обзор недели",
        ...reflection.wins.map((x) => `✓ ${x}`),
        ...reflection.improvements.map((x) => `• ${x}`),
        ...reflection.next_steps.map((x) => `→ ${x}`),
      ].join("\n");
      await this.repository.updateMessageIntent(user.id, stored.id, "reflection");
      await this.persistAndSend(user.id, conversation.id, message.chat.id, text, "reflection");
      return { duplicate: false };
    }
    if (commandText === "/followups") {
      const due = await this.repository.findDueExperienceFollowUps(undefined, user.id);
      const en = languageOf((await this.repository.getProfile(user.id))?.locale) === "en";
      const text = due.length
        ? due
            .map((experience) =>
              en ? `• ${experience.title}: how was it?` : `• ${experience.title}: как вам?`,
            )
            .join("\n")
        : en
          ? "No follow-up questions waiting."
          : "Нет ожидающих follow-up вопросов.";
      await this.repository.updateMessageIntent(user.id, stored.id, "experience");
      await this.persistAndSend(user.id, conversation.id, message.chat.id, text, "experience");
      return { duplicate: false };
    }
    const followUpAnswer = await completeExperienceFollowUpPending(
      this.repository,
      this.assistant.experiences,
      user.id,
      message.chat.id,
      commandText,
      stored.id,
    );
    if (followUpAnswer) {
      await this.repository.updateMessageIntent(user.id, stored.id, followUpAnswer.intent);
      await this.persistAndSend(
        user.id,
        conversation.id,
        message.chat.id,
        followUpAnswer.text,
        followUpAnswer.intent,
      );
      return { duplicate: false };
    }
    const guidedPending = await this.repository.findActivePendingAction(
      user.id,
      message.chat.id,
      GUIDED_ONBOARDING_ACTION,
    );
    if (guidedPending && commandText === "/skip") {
      const profile = await this.repository.getProfile(user.id);
      const reply = await skipGuidedOnboarding(
        this.repository,
        user.id,
        guidedPending,
        profile?.locale,
      );
      await this.repository.updateMessageIntent(user.id, stored.id, "other");
      await this.telegram.sendMessage(message.chat.id, reply);
      await this.repository.createMessage(user.id, {
        conversation_id: conversation.id,
        telegram_chat_id: null,
        telegram_message_id: null,
        role: "assistant",
        content: reply,
        intent: "other",
        source_channel: "telegram",
        metadata: {},
      });
      return { duplicate: false };
    }
    if (guidedPending && !commandText.startsWith("/")) {
      const profile = await this.repository.getProfile(user.id);
      const stepResult = await handleOnboardingReply(
        this.repository,
        user.id,
        guidedPending,
        commandText,
        profile?.locale,
        async (text, locale) =>
          this.ai?.extractOnboardingFacts?.(text, locale) ?? {
            memories: [],
            goals: [],
            people: [],
          },
      );
      await this.repository.updateMessageIntent(user.id, stored.id, "other");
      const sendOptions: Record<string, unknown> = {};
      if (stepResult.done) {
        sendOptions.reply_markup = onboardingReplyMarkup(
          profile?.locale,
          this.miniAppUrl,
          Boolean(stepResult.offerMore),
        );
      }
      await this.telegram.sendMessage(message.chat.id, stepResult.reply, sendOptions);
      await this.repository.createMessage(user.id, {
        conversation_id: conversation.id,
        telegram_chat_id: null,
        telegram_message_id: null,
        role: "assistant",
        content: stepResult.reply,
        intent: "other",
        source_channel: "telegram",
        metadata: {},
      });
      return { duplicate: false };
    }
    const brainDumpPending = await this.repository.findActivePendingAction(
      user.id,
      message.chat.id,
      BRAIN_DUMP_ACTION,
    );
    if (brainDumpPending && !commandText.startsWith("/")) {
      const dump = await handleBrainDumpReply(
        this.repository,
        user.id,
        brainDumpPending,
        commandText,
      );
      if (dump.handled) {
        await this.repository.updateMessageIntent(user.id, stored.id, "create_task");
        await this.persistAndSend(
          user.id,
          conversation.id,
          message.chat.id,
          dump.reply,
          "create_task",
        );
        return { duplicate: false };
      }
    }
    if (conversation.mode === "companion" && !commandText.startsWith("/")) {
      const result = await this.companion.respondToMessage(
        user.id,
        commandText,
        "telegram",
        stored,
      );
      await this.repository.updateMessageIntent(user.id, stored.id, "companion");
      const sent = await this.safeSendCompanionReply(
        message.chat.id,
        formatCompanionTelegramText(
          result.response,
          (await this.repository.getProfile(user.id))?.locale,
        ),
        result.mail_confirm
          ? { reply_markup: { inline_keyboard: result.mail_confirm.keyboard } }
          : undefined,
      );
      await this.rememberSentTelegramId(
        user.id,
        result.assistant_message.id,
        message.chat.id,
        sent,
      );
      return { duplicate: false };
    }
    const answer = await this.assistant.handle(user.id, commandText, stored.id);
    await this.repository.updateMessageIntent(user.id, stored.id, answer.intent);
    await this.deliverAssistantAnswer(
      user.id,
      conversation.id,
      message.chat.id,
      commandText,
      stored.id,
      answer,
    );
    return { duplicate: false };
    });
  }

  private async handleOnboardingMore(
    callback: NonNullable<TelegramUpdate["callback_query"]>,
  ) {
    const chatId = callback.message?.chat.id;
    const user = await this.repository.upsertTelegramUser({
      telegram_id: callback.from.id,
      name: [callback.from.first_name, callback.from.last_name].filter(Boolean).join(" "),
      username: callback.from.username ?? null,
    });
    return runWithUsageOwner(user.id, async () => {
    const profile = await this.repository.getProfile(user.id);
    await this.telegram.answerCallbackQuery(
      callback.id,
      languageOf(profile?.locale) === "en" ? "Let's continue" : "Продолжаем",
    );
    if (chatId === undefined) return { duplicate: false };
    const question = await startOnboardingMore(
      this.repository,
      user.id,
      chatId,
      profile?.locale,
    );
    await this.telegram.sendMessage(chatId, question);
    const conversation = await this.repository.getPrimaryConversation(user.id);
    await this.repository.createMessage(user.id, {
      conversation_id: conversation.id,
      telegram_chat_id: chatId,
      telegram_message_id: null,
      role: "assistant",
      content: question,
      intent: "other",
      source_channel: "telegram",
      metadata: { onboarding: "more" },
    });
    return { duplicate: false };
    });
  }

  private async handleCallback(update: TelegramUpdate) {
    const callback = update.callback_query!;
    if (callback.data === ONBOARDING_MORE_CALLBACK) {
      return this.handleOnboardingMore(callback);
    }
    const addressChoice = parseOnboardingAddress(callback.data);
    if (addressChoice) {
      const chooser = await this.repository.upsertTelegramUser({
        telegram_id: callback.from.id,
        name: [callback.from.first_name, callback.from.last_name].filter(Boolean).join(" "),
        username: callback.from.username ?? null,
      });
      await saveAddressForm(this.repository, chooser.id, addressChoice);
      await this.telegram.answerCallbackQuery(
        callback.id,
        addressChoice === "ты" ? "Хорошо, на «ты»" : "Хорошо, на «вы»",
      );
      return { duplicate: false };
    }
    const dayClose = callback.data ? parseDayCloseCallback(callback.data) : null;
    const goalCheck = !dayClose && callback.data ? parseGoalCheckInCallback(callback.data) : null;
    const mailSend =
      !dayClose && !goalCheck && callback.data ? parseMailSendCallback(callback.data) : null;
    const parsed =
      !dayClose && !goalCheck && !mailSend && callback.data
        ? parsePendingCallback(callback.data)
        : null;
    if (!dayClose && !goalCheck && !mailSend && !parsed) {
      await this.telegram.answerCallbackQuery(callback.id, "Готово");
      return { duplicate: false };
    }
    const user = await this.repository.upsertTelegramUser({
      telegram_id: callback.from.id,
      name: [callback.from.first_name, callback.from.last_name].filter(Boolean).join(" "),
      username: callback.from.username ?? null,
    });
    return runWithUsageOwner(user.id, async () => {
    const conversation = await this.repository.getPrimaryConversation(user.id);
    const chatId = callback.message?.chat.id;
    if (dayClose) {
      const result =
        chatId === undefined
          ? null
          : await resumeDayClose(this.repository, user.id, chatId, dayClose);
      const ru = languageOf((await this.repository.getProfile(user.id))?.locale) !== "en";
      const toast = !result
        ? ru
          ? "Устарело"
          : "Expired"
        : result.kind === "acted"
          ? ru
            ? "Готово"
            : "Done"
          : result.kind === "discuss"
            ? ru
              ? "Обсуждаем"
              : "Let's talk"
            : result.view === "task"
              ? (result.task?.title ?? (ru ? "Задача" : "Task")).slice(0, 200)
              : ru
                ? "Все задачи"
                : "All tasks";
      await this.telegram.answerCallbackQuery(callback.id, toast);
      if (!result || !callback.message) return { duplicate: false };
      const focus =
        result.kind === "discuss"
          ? result.task
          : result.kind === "menu" && result.view === "task"
            ? result.task
            : null;
      const keyboard = focus
        ? dayCloseActionKeyboard(result.pendingId, focus, result.locale)
        : dayCloseListKeyboard(result.pendingId, result.remaining, result.locale);
      try {
        await this.telegram.editMessageReplyMarkup?.(
          callback.message.chat.id,
          callback.message.message_id,
          { inline_keyboard: keyboard },
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "telegram_day_close_markup_failed",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      if (result.kind === "discuss") {
        const reply = await this.companion.send(user.id, result.instruction, "telegram");
        await this.safeSendCompanionReply(
          callback.message.chat.id,
          formatCompanionTelegramText(
            reply.response,
            (await this.repository.getProfile(user.id))?.locale,
          ),
        );
        return { duplicate: false };
      }
      if (result.kind === "acted") {
        await this.persistAndSend(
          user.id,
          conversation.id,
          callback.message.chat.id,
          result.text,
          result.intent,
        );
      }
      return { duplicate: false };
    }
    if (goalCheck) {
      const result =
        chatId === undefined
          ? null
          : await resumeGoalCheckIn(this.repository, user.id, chatId, goalCheck);
      await this.telegram.answerCallbackQuery(callback.id, result ? "Готово" : "Устарело");
      if (!result || !callback.message) return { duplicate: false };
      if (result.kind === "plan") {
        const reply = await this.companion.send(user.id, result.instruction, "telegram");
        await this.safeSendCompanionReply(
          callback.message.chat.id,
          formatCompanionTelegramText(
            reply.response,
            (await this.repository.getProfile(user.id))?.locale,
          ),
        );
        return { duplicate: false };
      }
      await this.persistAndSend(
        user.id,
        conversation.id,
        callback.message.chat.id,
        result.text,
        result.intent,
      );
      return { duplicate: false };
    }
    if (mailSend) {
      const result =
        chatId === undefined
          ? null
          : await resumeMailSend(this.repository, user.id, chatId, mailSend);
      await this.telegram.answerCallbackQuery(callback.id, result ? "Готово" : "Устарело");
      if (!result || !callback.message) return { duplicate: false };
      let text = result.text ?? "";
      if (result.kind === "confirm") {
        const ru = languageOf((await this.repository.getProfile(user.id))?.locale) !== "en";
        if (!this.mail) {
          text = ru
            ? "Отправка из бота сейчас недоступна."
            : "Sending from the bot is unavailable.";
        } else {
          try {
            const draft = await this.mail.sendDraft(user.id, result.draft_id);
            text = ru ? `Отправил: ${draft.subject}` : `Sent: ${draft.subject}`;
          } catch {
            text = ru ? "Не удалось отправить письмо." : "Could not send the email.";
          }
        }
      }
      await this.persistAndSend(
        user.id,
        conversation.id,
        callback.message.chat.id,
        text,
        "companion",
      );
      return { duplicate: false };
    }
    const result = await resumePendingAction(
      this.repository,
      this.assistant,
      this.assistant.experiences,
      user.id,
      parsed!.pendingActionId,
      parsed!.personId,
    );
    await this.telegram.answerCallbackQuery(callback.id, result ? "Готово" : "Устарело");
    if (!result || !callback.message) return { duplicate: false };
    await this.persistAndSend(
      user.id,
      conversation.id,
      callback.message.chat.id,
      result.text,
      result.intent,
    );
    return { duplicate: false };
    });
  }

  private async deliverAssistantAnswer(
    ownerId: string,
    conversationId: string,
    chatId: number,
    originalText: string,
    sourceMessageId: string,
    answer: AssistantHandleResult,
  ) {
    if (
      answer.disambiguation?.kind === "resolve_experience_participant" &&
      answer.disambiguation.experience
    ) {
      const { keyboard } = await createExperienceParticipantDisambiguation(
        this.repository,
        ownerId,
        chatId,
        answer.disambiguation.experience,
        answer.disambiguation.candidates,
        answer.disambiguation.sourceMessageId ?? sourceMessageId,
        originalText,
      );
      await this.telegram.sendMessage(chatId, answer.text, {
        reply_markup: { inline_keyboard: keyboard },
      });
      await this.repository.createMessage(ownerId, {
        conversation_id: conversationId,
        telegram_chat_id: null,
        telegram_message_id: null,
        role: "assistant",
        content: answer.text,
        intent: answer.intent,
        source_channel: "telegram",
        metadata: {},
      });
      return;
    }
    if (answer.disambiguation?.decision) {
      const { keyboard } = await createPersonDisambiguation(
        this.repository,
        ownerId,
        chatId,
        answer.disambiguation.decision,
        answer.disambiguation.candidates,
        sourceMessageId,
      );
      await this.telegram.sendMessage(chatId, answer.text, {
        reply_markup: { inline_keyboard: keyboard },
      });
      await this.repository.createMessage(ownerId, {
        conversation_id: conversationId,
        telegram_chat_id: null,
        telegram_message_id: null,
        role: "assistant",
        content: answer.text,
        intent: answer.intent,
        source_channel: "telegram",
        metadata: {},
      });
      return;
    }
    await this.persistAndSend(ownerId, conversationId, chatId, answer.text, answer.intent);
  }

  private async persistAndSend(
    ownerId: string,
    conversationId: string,
    chatId: number,
    text: string,
    intent: AssistantIntent,
  ) {
    const profile = await this.repository.getProfile(ownerId);
    const en = languageOf(profile?.locale) === "en";
    const sent = await this.telegram.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: en ? "Open Ealzy" : "Открыть Ealzy", web_app: { url: this.miniAppUrl } }],
        ],
      },
    });
    const stored = await this.repository.createMessage(ownerId, {
      conversation_id: conversationId,
      telegram_chat_id: null,
      telegram_message_id: null,
      role: "assistant",
      content: text,
      intent,
      source_channel: "telegram",
      metadata: {},
    });
    if (stored) await this.rememberSentTelegramId(ownerId, stored.id, chatId, sent);
  }

  private async resolveQuotedReply(
    ownerId: string,
    chatId: number,
    message: NonNullable<TelegramUpdate["message"]>,
  ) {
    const quoted = telegramQuotedReply(message);
    if (!quoted) return null;
    if (!quoted.telegram_message_id) return quoted;
    const stored = await this.repository.findMessageByTelegramId(
      ownerId,
      chatId,
      quoted.telegram_message_id,
    );
    if (!stored) return quoted;
    const labels = entityLabelsFromMetadata(stored.metadata);
    return {
      telegram_message_id: quoted.telegram_message_id,
      role:
        stored.role === "assistant" || stored.role === "user" ? stored.role : quoted.role,
      content: stored.content.trim() || quoted.content,
      ...(labels.length ? { entity_labels: labels } : {}),
    };
  }

  private async rememberSentTelegramId(
    ownerId: string,
    messageId: string,
    chatId: number,
    sent: { message_id?: number } | void,
  ) {
    const telegramId = sent && typeof sent === "object" ? sent.message_id : undefined;
    if (!telegramId || messageId.startsWith("unavailable-")) return;
    try {
      await this.repository.updateMessageTelegramId(ownerId, messageId, chatId, telegramId);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "telegram_message_id_save_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}

function entityLabelsFromMetadata(metadata: Record<string, unknown> | undefined) {
  const entities = metadata?.entities;
  if (!Array.isArray(entities)) return [];
  return entities.flatMap((item) => {
    if (!item || typeof item !== "object" || !("label" in item)) return [];
    const label = String((item as { label?: unknown }).label ?? "").trim();
    return label ? [label] : [];
  });
}
