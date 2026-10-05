import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import {
  isAiUnavailableMessage,
  raceCompanionSend,
  retryableUserContent,
  visibleCompanionMessages,
} from "../companion-send";
import { ComposerBar } from "../components/Composer";
import { FormattedMessage } from "../components/FormattedMessage";
import type {
  CompanionOffer,
  CompanionReply,
  ConversationMessage,
  EntityLink,
  Goal,
  SearchHit,
} from "../types";
import { Button, Card, EmptyState, ErrorState, LoadingState, useAsyncData } from "../components/ui";
import { goalSyncPrompt, isGoalSyncPrompt } from "../direction-prompts";
import { useI18n } from "../i18n";

function entityPath(entity: EntityLink) {
  if (entity.url) return entity.url;
  const roots: Record<EntityLink["type"], string> = {
    person: "people",
    task: "tasks",
    space: "spaces",
    goal: "goals",
    project: "projects",
    recommendation: "recommendations",
    mail: "mail",
  };
  return ["task", "project", "mail"].includes(entity.type)
    ? `/${roots[entity.type]}`
    : `/${roots[entity.type]}/${entity.id}`;
}

const ENTITY_KIND: Record<EntityLink["type"], { ru: string; en: string }> = {
  person: { ru: "Человек", en: "Person" },
  task: { ru: "Дело", en: "Task" },
  space: { ru: "Место", en: "Place" },
  goal: { ru: "Цель", en: "Goal" },
  project: { ru: "Проект", en: "Project" },
  recommendation: { ru: "Идея", en: "Idea" },
  mail: { ru: "Письмо", en: "Mail" },
};

function entityChipLabel(entity: EntityLink, language: "ru" | "en") {
  const kind = ENTITY_KIND[entity.type][language === "en" ? "en" : "ru"];
  return `${kind} · ${entity.label}`;
}

function replyMessages(reply: CompanionReply): ConversationMessage[] {
  const messages = [reply.user_message, reply.assistant_message ?? reply.message].filter(
    (message): message is ConversationMessage => Boolean(message),
  );
  return messages.length ? messages : (reply.conversation?.messages ?? []);
}

function successfulAssistantMessages(messages: ConversationMessage[]) {
  return messages.filter((message) => message.role === "assistant" && !isAiUnavailableMessage(message));
}

function searchHitsOf(message?: ConversationMessage): SearchHit[] {
  const raw = message?.metadata?.search_results;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is SearchHit =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as SearchHit).title === "string" &&
      typeof (item as SearchHit).url === "string",
  );
}

function visibleContent(content: string, hits: SearchHit[]) {
  if (!hits.length) return content;
  return content.replace(/\n\nВот что нашлось:[\s\S]*$/, "").trim() || content;
}

const autoSendLock = { draft: "" };

function offersOf(message?: ConversationMessage): CompanionOffer[] {
  const raw = message?.metadata?.offers;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is CompanionOffer =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as CompanionOffer).title === "string" &&
      typeof (item as CompanionOffer).instruction === "string",
  );
}

export function CompanionPage() {
  const { api } = useAuth();
  const { t, language } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const history = useAsyncData(
    async () => {
      const profile = await api.me();
      return profile.primary_conversation_id
        ? api.conversationMessages(profile.primary_conversation_id)
        : [];
    },
    [api],
    undefined,
    { live: true },
  );
  const followUps = useAsyncData(() => api.dueExperienceFollowUps(), [api], undefined, {
    live: true,
  });
  const goals = useAsyncData(() => api.goals().catch(() => [] as Goal[]), [api], undefined, {
    live: true,
  });
  const incoming = location.state as { draft?: string; autoSend?: boolean; guidedIntro?: boolean } | null;
  const [draft, setDraft] = useState(() => incoming?.draft ?? "");
  const [sending, setSending] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [sendError, setSendError] = useState("");
  const [guided, setGuided] = useState<{
    step: number;
    total: number;
    facts_count: number;
    done: boolean;
  } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView === "function") {
      endRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [history.data, sending, streamingAnswer]);

  const loadHistory = async () => {
    const profile = await api.me();
    return profile.primary_conversation_id
      ? api.conversationMessages(profile.primary_conversation_id)
      : [];
  };

  const applyReply = (
    previous: ConversationMessage[],
    optimistic: ConversationMessage | null,
    reply: CompanionReply,
  ) => {
    const received = replyMessages(reply);
    const user =
      received.find((message) => message.role === "user") ??
      optimistic ??
      previous.at(-1);
    const assistants = successfulAssistantMessages(received);
    const withoutPending = optimistic
      ? previous.filter((message) => message.id !== optimistic.id)
      : previous;
    const withoutUser = user
      ? withoutPending.filter((message) => message.id !== user.id)
      : withoutPending;
    return [...withoutUser, ...(user ? [user] : []), ...assistants];
  };

  const sendContent = async (content: string) => {
    if (!content || sending) return;
    const optimistic: ConversationMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content,
      source_channel: "mini_app",
      created_at: new Date().toISOString(),
    };
    const previous = history.data ?? [];
    setSending(true);
    setStreamingAnswer("");
    setSendError("");
    setDraft("");
    history.setData([...previous, optimistic]);
    try {
      const result = await raceCompanionSend(
        () => api.sendCompanionMessage(content, setStreamingAnswer),
        loadHistory,
        previous,
        content,
      );
      if ("reply" in result) {
        history.setData(applyReply(previous, optimistic, result.reply));
        return;
      }
      history.setData(result.messages);
    } catch (cause) {
      history.setData(previous);
      setDraft(content);
      const message =
        cause instanceof ApiError && cause.status === 0
          ? t("companion.offline")
          : cause instanceof ApiError && cause.status === 401
            ? t("companion.expired")
            : cause instanceof Error
              ? cause.message
              : t("companion.sendFailed");
      setSendError(message);
    } finally {
      setStreamingAnswer("");
      setSending(false);
    }
  };

  const retryTurn = async () => {
    if (sending) return;
    const current = history.data ?? [];
    const content = retryableUserContent(current);
    if (!content) return;
    const pending = visibleCompanionMessages(current);
    setSending(true);
    setSendError("");
    history.setData(pending);
    setStreamingAnswer("");
    try {
      const result = await raceCompanionSend(
        () => api.retryCompanionMessage(setStreamingAnswer),
        loadHistory,
        pending,
        content,
      );
      if ("reply" in result) {
        history.setData(applyReply(pending, null, result.reply));
        return;
      }
      history.setData(result.messages);
    } catch (cause) {
      history.setData(pending);
      const message =
        cause instanceof ApiError && cause.status === 0
          ? t("companion.offline")
          : cause instanceof ApiError && cause.status === 401
            ? t("companion.expired")
            : cause instanceof Error
              ? cause.message
              : t("companion.sendFailed");
      setSendError(message);
    } finally {
      setStreamingAnswer("");
      setSending(false);
    }
  };

  const appendGuided = (userMessage?: ConversationMessage | null, assistantMessage?: ConversationMessage | null) => {
    history.setData((previous) => {
      const next = [...(previous ?? [])];
      if (userMessage && !next.some((item) => item.id === userMessage.id)) next.push(userMessage);
      if (assistantMessage && !next.some((item) => item.id === assistantMessage.id)) next.push(assistantMessage);
      return next;
    });
  };

  const startGuided = async () => {
    if (sending) return;
    setSending(true);
    setSendError("");
    try {
      const result = await api.guidedIntro();
      setGuided({
        step: result.step,
        total: result.total,
        facts_count: result.facts_count,
        done: result.done,
      });
      appendGuided(result.user_message, result.assistant_message);
      if (result.question && !result.assistant_message) {
        history.setData((previous) => {
          const list = previous ?? [];
          if (list.some((item) => item.content === result.question && item.role === "assistant")) return list;
          return [
            ...list,
            {
              id: `guided-${result.step}`,
              role: "assistant" as const,
              content: result.question,
              source_channel: "mini_app" as const,
              created_at: new Date().toISOString(),
            },
          ];
        });
      }
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : t("companion.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const sendGuidedAnswer = async (content: string) => {
    if (!content || sending) return;
    const optimistic: ConversationMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content,
      source_channel: "mini_app",
      created_at: new Date().toISOString(),
    };
    const previous = history.data ?? [];
    history.setData([...previous, optimistic]);
    setDraft("");
    setSending(true);
    setSendError("");
    try {
      const result = await api.guidedIntro(content);
      history.setData([
        ...previous,
        result.user_message ?? optimistic,
        ...(result.assistant_message ? [result.assistant_message] : []),
      ]);
      setGuided({
        step: result.step,
        total: result.total,
        facts_count: result.facts_count,
        done: result.done,
      });
      if (result.done) {
        navigate(".", { replace: true, state: {} });
      }
    } catch (cause) {
      history.setData(previous);
      setDraft(content);
      setSendError(cause instanceof Error ? cause.message : t("companion.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!incoming?.autoSend) {
      autoSendLock.draft = "";
      return;
    }
    if (history.loading || history.error) return;
    const content = incoming.draft?.trim();
    if (!content || autoSendLock.draft === content) return;
    autoSendLock.draft = content;
    navigate(".", { replace: true, state: {} });
    void sendContent(content);
  }, [history.error, history.loading, incoming?.autoSend, incoming?.draft, navigate]);

  useEffect(() => {
    if (!incoming?.guidedIntro) return;
    if (history.loading || history.error) return;
    if (guided) return;
    navigate(".", { replace: true, state: {} });
    void startGuided();
  }, [guided, history.error, history.loading, incoming?.guidedIntro, navigate]);

  const historyMessages = history.data ?? [];
  const messages = visibleCompanionMessages(historyMessages);
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const retryContent = retryableUserContent(historyMessages);
  const offers = sending || retryContent ? [] : offersOf(lastAssistant);

  return (
    <div className="companion-page">
      <h1 className="sr-only">{t("nav.ilzi")}</h1>
      {guided && !guided.done && (
        <Card className="guided-intro-card border-accent/30 bg-accent/5 p-3">
          <p className="text-sm font-bold">{t("companion.guidedStart")}</p>
          <p className="mt-1 text-sm text-muted">
            {t("companion.guidedProgress", {
              count: guided.facts_count,
              step: Math.min(guided.step + 1, guided.total),
              total: guided.total,
            })}
          </p>
        </Card>
      )}
      {!!followUps.data?.length && (
        <Card className="mb-3 shrink-0 border-accent/30 bg-accent/5 p-3">
          <p className="text-sm font-bold">{t("companion.followUpTitle")}</p>
          <p className="mt-1 text-sm text-muted">
            {followUps.data.map((experience) => experience.title).join(", ")} —{" "}
            {t("companion.experiences")}{" "}
            <Link className="back-link" to="/experiences">
              {t("plan.experiences")}
            </Link>
            .
          </p>
        </Card>
      )}
      {history.loading ? (
        <LoadingState label={t("companion.loading")} />
      ) : history.error ? (
        <ErrorState message={history.error} retry={history.reload} />
      ) : (
        <section aria-label={t("common.conversation")} className="companion-thread">
          {!messages.length && (
            <EmptyState
              icon="✦"
              title={t("companion.emptyTitle")}
              description={t("companion.emptyText")}
              action={
                <div className="home-plan-actions">
                  <Button variant="secondary" onClick={() => void startGuided()}>
                    {t("companion.guidedStart")}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void sendContent(goalSyncPrompt(goals.data ?? [], language))}
                  >
                    {t("companion.emptySync")}
                  </Button>
                </div>
              }
            />
          )}
          {messages.map((message) => {
            const entities = message.entities ?? message.metadata?.entities ?? [];
            const hits = searchHitsOf(message);
            return (
              <article
                key={message.id}
                className={`message ${message.role === "user" ? "message-user" : "message-assistant"}`}
                aria-label={`${message.role} message`}
              >
                <div className="message-copy">
                  <FormattedMessage>{visibleContent(message.content, hits)}</FormattedMessage>
                </div>
                {!!hits.length && (
                  <div className="search-hits" aria-label={t("common.searchResults")}>
                    {hits.map((hit) => (
                      <a
                        key={hit.url}
                        className="search-hit"
                        href={hit.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span className="search-hit-title">{hit.title}</span>
                        <span className="search-hit-meta">
                          {[hit.subtitle, hit.price, hit.source].filter(Boolean).join(" · ")}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
                {!!entities.length && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entities.map((entity) => (
                      <Link
                        className="tag tag-link"
                        key={`${entity.type}-${entity.id}`}
                        to={entityPath(entity)}
                      >
                        {entityChipLabel(entity, language)}
                      </Link>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
          {sending && streamingAnswer ? (
            <article
              className="message message-assistant message-streaming"
              aria-label="assistant message"
              aria-live="polite"
            >
              <div className="message-copy">
                <FormattedMessage>{streamingAnswer}</FormattedMessage>
                <span className="stream-caret" aria-hidden />
              </div>
            </article>
          ) : sending ? (
            <div className="message message-assistant flex items-center gap-2" role="status">
              <span className="spinner !h-4 !w-4 !border-2" />
              <span className="text-sm text-muted">{t("companion.thinking")}</span>
            </div>
          ) : null}
          <div ref={endRef} />
        </section>
      )}
      {!!offers.length && (
        <div className="offer-row" aria-label={t("companion.nextSteps")}>
          {offers.map((offer) => (
            <button
              key={`${offer.kind}-${offer.title}`}
              type="button"
              className="chip"
              onClick={() =>
                void sendContent(
                  isGoalSyncPrompt(offer.instruction)
                    ? offer.instruction
                    : `Сделай сам: ${offer.instruction}`,
                )
              }
            >
              {offer.title}
            </button>
          ))}
        </div>
      )}
      {!sending && retryContent && (
        <div className="offer-row" aria-label={t("companion.retry")}>
          <button
            type="button"
            className="chip chip-retry"
            onClick={() => void retryTurn()}
          >
            {t("companion.retry")}
          </button>
        </div>
      )}
      <ComposerBar
        value={draft}
        onChange={setDraft}
        onSubmit={() =>
          void (guided && !guided.done ? sendGuidedAnswer(draft.trim()) : sendContent(draft.trim()))
        }
        placeholder={t("companion.placeholder")}
        disabled={sending || history.loading}
        error={sendError}
        onRetry={
          sendError
            ? () =>
                void (guided && !guided.done
                  ? sendGuidedAnswer(draft.trim())
                  : retryContent
                    ? retryTurn()
                    : sendContent(draft.trim()))
            : undefined
        }
        autoFocus
      />
    </div>
  );
}
