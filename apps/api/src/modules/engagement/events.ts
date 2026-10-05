import type { AppRepository } from "../../repository.js";

export async function trackFunnelEvent(
  repository: AppRepository,
  ownerId: string,
  name: string,
  properties?: Record<string, unknown>,
) {
  try {
    await repository.trackEvents(ownerId, [{ name, properties }]);
  } catch {
    // Analytics must not break product flows.
  }
}
