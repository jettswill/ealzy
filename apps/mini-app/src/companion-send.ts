import { ApiError, NETWORK_ERROR_MESSAGE, REQUEST_TIMEOUT_MS } from "./api";
import type { CompanionReply, ConversationMessage } from "./types";

export const COMPANION_RECOVER_ATTEMPTS = 30;
export const COMPANION_RECOVER_DELAY_MS = 2_000;
export const COMPANION_WATCH_AFTER_MS =
  import.meta.env.MODE === "test" ? 0 : REQUEST_TIMEOUT_MS;

export type CompanionRecovery = {
  messages: ConversationMessage[];
  complete: boolean;
};

export type CompanionSendResult =
  | { reply: CompanionReply }
  | { messages: ConversationMessage[] };

export function isRecoverableCompanionError(cause: unknown) {
  if (!(cause instanceof ApiError)) return false;
  return cause.status === 0 || cause.status === 408 || cause.status >= 500;
}

export function isAiUnavailableMessage(message?: ConversationMessage | null) {
  if (!message || message.role !== "assistant") return false;
  if (message.metadata?.ai_unavailable === true) return true;
  const content = message.content.trim();
  return (
    content.includes("не удалось связаться с AI") || content.includes("Couldn't reach the AI")
  );
}

export function failedCompanionRetryTarget(messages: ConversationMessage[]) {
  let index = messages.length - 1;
  while (index >= 0 && isAiUnavailableMessage(messages[index])) index -= 1;
  if (index < 0 || messages[index].role !== "user") return null;
  const content = messages[index].content.trim();
  if (!content) return null;
  let keepIndex = index;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor];
    if (isAiUnavailableMessage(message)) continue;
    if (message.role === "user" && message.content.trim() === content) {
      keepIndex = cursor;
      continue;
    }
    break;
  }
  return {
    keep: messages[keepIndex],
    remove: messages.slice(keepIndex + 1),
  };
}

export function retryableUserContent(messages: ConversationMessage[]) {
  return failedCompanionRetryTarget(messages)?.keep.content.trim() ?? "";
}

export function visibleCompanionMessages(messages: ConversationMessage[]) {
  const target = failedCompanionRetryTarget(messages);
  const hidden = new Set(messages.filter(isAiUnavailableMessage).map((message) => message.id));
  if (target) {
    for (const message of target.remove) hidden.add(message.id);
  }
  return messages.filter((message) => !hidden.has(message.id));
}

export function companionTurnFromHistory(
  previous: ConversationMessage[],
  latest: ConversationMessage[],
  content: string,
): CompanionRecovery | null {
  const known = new Set(previous.map((message) => message.id));
  const added = latest.filter((message) => !known.has(message.id));
  const userAt = added.findIndex(
    (message) => message.role === "user" && message.content === content,
  );
  if (userAt >= 0) {
    return {
      messages: latest,
      complete: added
        .slice(userAt + 1)
        .some((message) => message.role === "assistant" && !isAiUnavailableMessage(message)),
    };
  }
  const lastUser = [...previous]
    .reverse()
    .find((message) => message.role === "user" && message.content === content);
  if (!lastUser) return null;
  const userIndex = latest.findIndex((message) => message.id === lastUser.id);
  if (userIndex < 0) return null;
  return {
    messages: latest,
    complete: latest
      .slice(userIndex + 1)
      .some((message) => message.role === "assistant" && !isAiUnavailableMessage(message)),
  };
}

async function waitWithStop(
  ms: number,
  delay: (ms: number) => Promise<void>,
  isStopped?: () => boolean,
) {
  if (ms <= 0) return;
  const slice = 200;
  let remaining = ms;
  while (remaining > 0 && !isStopped?.()) {
    const step = Math.min(slice, remaining);
    await delay(step);
    remaining -= step;
  }
}

export async function recoverCompanionTurn(
  loadMessages: () => Promise<ConversationMessage[]>,
  previous: ConversationMessage[],
  content: string,
  options: {
    attempts?: number;
    delay?: (ms: number) => Promise<void>;
    warmupMs?: number;
    isStopped?: () => boolean;
  } = {},
): Promise<CompanionRecovery | null> {
  const attempts = options.attempts ?? COMPANION_RECOVER_ATTEMPTS;
  const delay = options.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  await waitWithStop(options.warmupMs ?? 0, delay, options.isStopped);
  let partial: CompanionRecovery | null = null;
  let loadFailures = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.isStopped?.()) return partial;
    if (attempt > 0) await waitWithStop(COMPANION_RECOVER_DELAY_MS, delay, options.isStopped);
    if (options.isStopped?.()) return partial;
    try {
      const recovered = companionTurnFromHistory(previous, await loadMessages(), content);
      loadFailures = 0;
      if (recovered?.complete) return recovered;
      if (recovered) partial = recovered;
    } catch {
      loadFailures += 1;
      if (loadFailures >= 3 && !partial) return null;
    }
  }
  return partial;
}

export async function raceCompanionSend(
  send: () => Promise<CompanionReply>,
  loadMessages: () => Promise<ConversationMessage[]>,
  previous: ConversationMessage[],
  content: string,
  options: {
    delay?: (ms: number) => Promise<void>;
    warmupMs?: number;
  } = {},
): Promise<CompanionSendResult> {
  const stop = { value: false };
  const fromHistory = recoverCompanionTurn(loadMessages, previous, content, {
    delay: options.delay,
    warmupMs: options.warmupMs ?? COMPANION_WATCH_AFTER_MS,
    isStopped: () => stop.value,
  });
  const posted = send().then(
    (reply) => ({ type: "reply" as const, reply }),
    (error: unknown) => ({ type: "error" as const, error }),
  );
  const watched = fromHistory.then((recovered) => ({ type: "history" as const, recovered }));

  try {
    const first = await Promise.race([posted, watched]);
    if (first.type === "reply") return { reply: first.reply };
    if (first.type === "history" && first.recovered?.complete) {
      return { messages: first.recovered.messages };
    }
    if (first.type === "error" && !isRecoverableCompanionError(first.error)) throw first.error;

    const rest = first.type === "error" ? await watched : await posted;
    if (rest.type === "reply") return { reply: rest.reply };
    if (rest.type === "history" && rest.recovered?.complete) {
      return { messages: rest.recovered.messages };
    }
    if (rest.type === "history" && rest.recovered) {
      return { messages: rest.recovered.messages };
    }
    if (rest.type === "error") throw rest.error;
    if (first.type === "error") throw first.error;
    throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
  } finally {
    stop.value = true;
  }
}
