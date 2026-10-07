import type { AppRepository } from "../../repository.js";
import type { TelegramGateway } from "../../infrastructure/telegram.js";
import { languageOf } from "../../locale.js";
import type { CompanionService } from "./companion.js";
import {
  AI_WORK_MAX_ATTEMPTS,
  aiWorkInstruction,
} from "./ai-work-queue.js";
import { runWithUsageOwner } from "../billing/usage.js";

export class AiWorkService {
  constructor(
    private readonly repository: AppRepository,
    private readonly companion: CompanionService,
    private readonly telegram: TelegramGateway,
  ) {}

  async processOne(now = new Date()) {
    const claimed = await this.repository.claimNextAiWork(
      now,
      AI_WORK_MAX_ATTEMPTS,
    );
    if (!claimed) return { processed: 0 as const };
    try {
      const result = await runWithUsageOwner(claimed.owner_id, () =>
        this.companion.send(claimed.owner_id, aiWorkInstruction(claimed), "system"),
      );
      const answer = result.response.answer.trim().slice(0, 4000);
      await this.repository.updateTask(claimed.owner_id, claimed.id, {
        status: "done",
        completed_at: now.toISOString(),
        agent_locked_at: null,
        agent_result: answer,
      });
      await this.notify(claimed.owner_id, claimed.title, answer);
      return { processed: 1 as const, task_id: claimed.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = (claimed.agent_attempts ?? 1) >= AI_WORK_MAX_ATTEMPTS;
      await this.repository.updateTask(claimed.owner_id, claimed.id, {
        status: failed ? "cancelled" : "todo",
        agent_locked_at: null,
        agent_result: message.slice(0, 2000),
        due_at: failed
          ? claimed.due_at
          : new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      });
      return { processed: 0 as const, failed: true as const, task_id: claimed.id };
    }
  }

  private async notify(ownerId: string, title: string, answer: string) {
    const [user, profile] = await Promise.all([
      this.repository.getUser(ownerId),
      this.repository.getProfile(ownerId),
    ]);
    if (!user?.telegram_id) return;
    const ru = languageOf(profile?.locale) !== "en";
    const heading = ru ? `Ealzy сделал: ${title}` : `Ealzy finished: ${title}`;
    const text = `${heading}\n\n${answer}`.slice(0, 3500);
    try {
      await this.telegram.sendMessage(user.telegram_id, text);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "ai_work_notify_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
