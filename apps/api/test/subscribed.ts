import { InMemoryRepository } from "../src/repository.js";

/** Репозиторий, где у каждого есть подписка, — для тестов «Удиви меня» и мест. */
export class SubscribedRepository extends InMemoryRepository {
  override async getUserPlan(ownerId: string) {
    return (
      (await super.getUserPlan(ownerId)) ?? {
        owner_id: ownerId,
        plan: "pro",
        plan_until: null,
        updated_at: new Date().toISOString(),
      }
    );
  }
}
