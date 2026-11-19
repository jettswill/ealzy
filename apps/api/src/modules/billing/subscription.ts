import type { AppRepository } from "../../repository.js";
import { HttpError } from "../../middleware.js";

/** Тарифы, которые считаются подпиской (не «Бесплатно»). */
const PAID_PLANS = new Set(["pro", "unlimited"]);

/**
 * Есть ли у человека подписка: платный тариф, который ещё действует, — или он
 * администратор. Не зависит от того, включены ли лимиты облака.
 */
export async function hasSubscription(
  repository: Pick<AppRepository, "getUserPlan" | "isAdmin">,
  ownerId: string,
  at = new Date(),
): Promise<boolean> {
  const [plan, admin] = await Promise.all([
    repository.getUserPlan(ownerId),
    repository.isAdmin(ownerId),
  ]);
  if (admin) return true;
  if (!plan || !PAID_PLANS.has(plan.plan)) return false;
  return !plan.plan_until || Date.parse(plan.plan_until) > at.getTime();
}

/** «Удиви меня» и места — только по подписке: иначе 402 SUBSCRIPTION_REQUIRED. */
export async function requireSubscription(
  repository: Pick<AppRepository, "getUserPlan" | "isAdmin">,
  ownerId: string,
) {
  if (!(await hasSubscription(repository, ownerId))) {
    throw new HttpError(
      402,
      "SUBSCRIPTION_REQUIRED",
      "«Удиви меня» — в подписке. Оформи её, и колесо откроется.",
    );
  }
}
