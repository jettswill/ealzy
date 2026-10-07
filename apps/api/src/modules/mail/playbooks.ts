import type { MailPlaybook, MailPlaybookAction, MailPlaybookTrigger } from "../../types.js";

export const DEFAULT_MAIL_PLAYBOOKS: {
  name: string;
  trigger: MailPlaybookTrigger;
  actions: MailPlaybookAction[];
  prompt: string | null;
}[] = [
  {
    name: "Important digest",
    trigger: "important",
    actions: ["summarize"],
    prompt: null,
  },
  {
    name: "Meetings to calendar",
    trigger: "meeting",
    actions: ["create_task"],
    prompt: null,
  },
  {
    name: "Draft replies",
    trigger: "important",
    actions: ["draft_reply"],
    prompt: "Prepare a short, polite reply the user can edit before sending. Never send it.",
  },
];

export function playbookMatches(
  playbook: Pick<MailPlaybook, "enabled" | "trigger" | "account_id">,
  message: { account_id: string; is_important: boolean; is_meeting: boolean; handled: boolean },
) {
  if (!playbook.enabled) return false;
  if (playbook.account_id && playbook.account_id !== message.account_id) return false;
  if (playbook.trigger === "important") return message.is_important;
  if (playbook.trigger === "meeting") return message.is_meeting;
  if (playbook.trigger === "unread") return !message.handled;
  return false;
}
