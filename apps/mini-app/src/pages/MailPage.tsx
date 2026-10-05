import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import type { MailAccount, MailDraft, MailMessage, MailPlaybook, MailProvider } from "../types";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  useAsyncData,
} from "../components/ui";
import { useI18n } from "../i18n";
import { loadMailSnapshot, snapshotMail, subscribeMailSnapshot, writeMailCache } from "../mail-sync";

const providers: MailProvider[] = ["gmail", "yandex", "mailru", "outlook", "custom"];

export function MailPage() {
  const { api } = useAuth();
  const { t, formatDate } = useI18n();
  const state = useAsyncData(() => loadMailSnapshot(api), [api], snapshotMail, { live: true });
  const [connecting, setConnecting] = useState(false);
  const [editingDraft, setEditingDraft] = useState<MailDraft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => subscribeMailSnapshot((snapshot) => state.setData(snapshot)), [state.setData]);

  if (state.loading && !state.data?.accounts.length && !state.data?.messages.length)
    return <LoadingState label={t("mail.loading")} />;
  if (!state.data && state.error)
    return <ErrorState message={state.error ?? t("mail.unavailable")} retry={state.reload} />;
  if (!state.data) return <LoadingState label={t("mail.loading")} />;

  const { accounts, messages, drafts, playbooks } = state.data;
  const openMessages = messages.filter((item) => !item.handled);
  const openDrafts = drafts.filter((item) => item.status !== "sent");

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await work();
      await state.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("mail.actionFailed"));
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <Link className="back-link mb-3 inline-flex" to="/profile">
        ← {t("more.profileTitle")}
      </Link>
      <PageHeader
        eyebrow={t("mail.eyebrow")}
        title={t("mail.title")}
        description={t("mail.description")}
        action={
          <Button onClick={() => setConnecting(true)}>{t("mail.connect")}</Button>
        }
      />
      {state.error && (
        <p className="error-text mb-4" role="alert">
          {state.error}
        </p>
      )}
      {error && (
        <p className="error-text mb-4" role="alert">
          {error}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-bold">{t("mail.accounts")}</h2>
        {!accounts.length ? (
          <EmptyState icon="✉" title={t("mail.emptyAccounts")} description={t("mail.emptyAccountsText")} />
        ) : (
          accounts.map((account) => (
            <Card key={account.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold">{account.email}</p>
                  <p className="mt-1 text-sm text-muted">
                    {t(`mail.provider.${account.provider}`)} · {t(`mail.status.${account.status}`)}
                    {account.last_synced_at
                      ? ` · ${formatDate(account.last_synced_at)}`
                      : ""}
                  </p>
                  {account.last_error && <p className="error-text mt-2 text-sm">{account.last_error}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={busy === `sync-${account.id}`}
                    onClick={() => void run(`sync-${account.id}`, () => api.syncMail(account.id).then(() => undefined))}
                  >
                    {busy === `sync-${account.id}` ? t("mail.syncing") : t("mail.sync")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy === `off-${account.id}`}
                    onClick={() => {
                      if (!window.confirm(t("mail.disconnectConfirm"))) return;
                      void run(`off-${account.id}`, () => api.disconnectMail(account.id));
                    }}
                  >
                    {t("mail.disconnect")}
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-bold">{t("mail.important")}</h2>
        {!openMessages.length ? (
          <Card>
            <p className="text-sm text-muted">{t("mail.emptyMessages")}</p>
          </Card>
        ) : (
          openMessages.map((message) => (
            <MailMessageCard
              key={message.id}
              message={message}
              busy={busy}
              onDraft={() => void run(`draft-${message.id}`, async () => {
                setEditingDraft(await api.draftMailReply(message.id));
              })}
              onTask={() => void run(`task-${message.id}`, () => api.createMailTask(message.id).then(() => undefined))}
              onHandled={() => void run(`done-${message.id}`, () => api.markMailHandled(message.id).then(() => undefined))}
            />
          ))
        )}
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-lg font-bold">{t("mail.drafts")}</h2>
        {!openDrafts.length ? (
          <Card>
            <p className="text-sm text-muted">{t("mail.emptyDrafts")}</p>
          </Card>
        ) : (
          openDrafts.map((draft) => (
            <Card key={draft.id}>
              <p className="font-bold">{draft.subject}</p>
              <p className="mt-1 text-sm text-muted">
                {t("mail.to")}: {draft.to_address}
              </p>
              <p className="mt-2 line-clamp-3 text-sm">{draft.body}</p>
              {draft.error && <p className="error-text mt-2 text-sm">{draft.error}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setEditingDraft(draft)}>
                  {t("common.edit")}
                </Button>
                <Button
                  disabled={busy === `send-${draft.id}`}
                  onClick={() => {
                    if (!window.confirm(t("mail.sendConfirm"))) return;
                    void run(`send-${draft.id}`, () => api.sendMailDraft(draft.id).then(() => undefined));
                  }}
                >
                  {t("common.send")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void run(`del-${draft.id}`, () => api.deleteMailDraft(draft.id))}
                >
                  {t("common.delete")}
                </Button>
              </div>
            </Card>
          ))
        )}
      </section>

      {!!playbooks.length && (
        <section className="mt-6 space-y-3">
          <h2 className="text-lg font-bold">{t("mail.playbooks")}</h2>
          <p className="text-sm text-muted">{t("mail.playbooksText")}</p>
          {playbooks.map((playbook) => (
            <Card key={playbook.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="font-bold">{playbook.name}</p>
                <p className="mt-1 text-sm text-muted">{playbook.actions.join(", ")}</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={playbook.enabled}
                  onChange={(event) =>
                    void run(`pb-${playbook.id}`, () =>
                      api.updateMailPlaybook(playbook.id, { enabled: event.target.checked }).then(() => undefined),
                    )
                  }
                />
                {t("mail.enabled")}
              </label>
            </Card>
          ))}
        </section>
      )}

      {connecting && (
        <ConnectMailForm
          onClose={() => setConnecting(false)}
          onSaved={(account) => {
            const next = {
              ...state.data!,
              accounts: [account, ...accounts],
            };
            writeMailCache(next);
            state.setData(next);
            setConnecting(false);
            void state.reload();
          }}
        />
      )}
      {editingDraft && (
        <DraftForm
          draft={editingDraft}
          onClose={() => setEditingDraft(null)}
          onSaved={(draft) => {
            state.setData({
              ...state.data!,
              drafts: drafts.map((item) => (item.id === draft.id ? draft : item)),
            });
            setEditingDraft(null);
          }}
        />
      )}
    </>
  );
}

function MailMessageCard({
  message,
  busy,
  onDraft,
  onTask,
  onHandled,
}: {
  message: MailMessage;
  busy: string;
  onDraft: () => void;
  onTask: () => void;
  onHandled: () => void;
}) {
  const { t, formatDate } = useI18n();
  return (
    <Card>
      <div className="flex flex-wrap gap-2">
        {message.is_meeting && <span className="tag">{t("mail.meeting")}</span>}
        {message.is_important && <span className="tag">{t("mail.importantTag")}</span>}
      </div>
      <p className="mt-2 font-bold">{message.subject || t("mail.noSubject")}</p>
      <p className="mt-1 text-sm text-muted">
        {message.from_name || message.from_address}
        {message.received_at ? ` · ${formatDate(message.received_at)}` : ""}
      </p>
      {message.snippet && <p className="mt-2 text-sm">{message.snippet}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy === `draft-${message.id}`} onClick={onDraft}>
          {t("mail.prepareReply")}
        </Button>
        {message.is_meeting && (
          <Button variant="secondary" disabled={busy === `task-${message.id}`} onClick={onTask}>
            {t("mail.addToCalendar")}
          </Button>
        )}
        <Button variant="ghost" disabled={busy === `done-${message.id}`} onClick={onHandled}>
          {t("mail.handled")}
        </Button>
      </div>
    </Card>
  );
}

function ConnectMailForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (account: MailAccount) => void;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [provider, setProvider] = useState<MailProvider>("gmail");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [imapHost, setImapHost] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const account = await api.connectMail({
        email,
        password,
        provider,
        imap_host: provider === "custom" ? imapHost : undefined,
        smtp_host: provider === "custom" ? smtpHost : undefined,
      });
      onSaved(account);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("mail.connectFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t("mail.connectTitle")} onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <p className="text-sm text-muted">{t("mail.connectHint")}</p>
        <Field label={t("mail.providerLabel")}>
          <select
            className="input"
            value={provider}
            onChange={(event) => setProvider(event.target.value as MailProvider)}
          >
            {providers.map((item) => (
              <option key={item} value={item}>
                {t(`mail.provider.${item}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("profile.email")}>
          <input className="input" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field label={t("mail.appPassword")} hint={t("mail.appPasswordHint")}>
          <input
            className="input"
            type="password"
            required
            autoComplete="off"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        {provider === "custom" && (
          <>
            <Field label="IMAP">
              <input className="input" required value={imapHost} onChange={(event) => setImapHost(event.target.value)} />
            </Field>
            <Field label="SMTP">
              <input className="input" required value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} />
            </Field>
          </>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={saving}>{saving ? t("mail.connecting") : t("mail.connect")}</Button>
        </div>
      </form>
    </Modal>
  );
}

function DraftForm({
  draft,
  onClose,
  onSaved,
}: {
  draft: MailDraft;
  onClose: () => void;
  onSaved: (draft: MailDraft) => void;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [to, setTo] = useState(draft.to_address);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      onSaved(await api.updateMailDraft(draft.id, { to_address: to, subject, body }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("mail.actionFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t("mail.editDraft")} onClose={onClose}>
      <form className="space-y-4" onSubmit={(event) => void submit(event)}>
        <Field label={t("mail.to")}>
          <input className="input" required value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>
        <Field label={t("mail.subject")}>
          <input className="input" value={subject} onChange={(event) => setSubject(event.target.value)} />
        </Field>
        <Field label={t("mail.body")}>
          <textarea className="input min-h-40" value={body} onChange={(event) => setBody(event.target.value)} />
        </Field>
        {error && <p className="error-text">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={saving}>{saving ? t("common.saving") : t("common.save")}</Button>
        </div>
      </form>
    </Modal>
  );
}
