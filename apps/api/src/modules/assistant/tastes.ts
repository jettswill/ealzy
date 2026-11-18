import type {
  ActivityCatalog,
  ActivityPreference,
  ActivityType,
  PlaceEmotion,
  TasteTargetKind,
} from "../../types.js";
import type { AppRepository } from "../../repository.js";
import { assertCloudQuota } from "../billing/quota.js";

// Личные вкусы по активностям. У каждого типа и каждой категории может быть:
//  • вердикт человека — «нравится» или «никогда не предлагай»;
//  • след визитов — оценки и впечатления после «я был»;
//  • гипотеза нейросети — из того, что Илзи о человеке знает.
// Из этого получается вес: «никогда» не показываем вовсе, остальное делает
// вариант чаще или реже. Нелюбимое не исчезает совсем — его просто почти
// не бывает, как и просил основатель: «вероятность снижается».

export interface TasteVerdict {
  /** −1…1: насколько это человеку, по нашим данным, подходит. */
  score: number;
  /** Сказал «никогда не предлагай» — не показываем. */
  never: boolean;
  liked: boolean;
  /** Почему так, человеческими словами — для карточки и для Илзи. */
  reason: string | null;
}

const clamp = (value: number, min = -1, max = 1) => Math.min(max, Math.max(min, value));

export type TasteIndex = Map<string, ActivityPreference>;

export function tasteIndex(rows: ActivityPreference[]): TasteIndex {
  return new Map(rows.map((row) => [`${row.target_kind}:${row.target_id}`, row]));
}

export function tasteFor(
  type: Pick<ActivityType, "id" | "category_id">,
  index: TasteIndex,
): TasteVerdict {
  const own = index.get(`type:${type.id}`);
  const category = index.get(`category:${type.category_id}`);
  // Тип важнее категории: «не люблю творчество, но гончарка — да» работает.
  if (own?.verdict === "never") return { score: -1, never: true, liked: false, reason: null };
  if (own?.verdict === "like")
    return { score: 1, never: false, liked: true, reason: "ты отметил, что тебе это нравится" };
  if (category?.verdict === "never") return { score: -1, never: true, liked: false, reason: null };
  let score =
    (own?.visit_affinity ?? 0) +
    0.6 * (own?.ai_affinity ?? 0) +
    0.5 * (category?.visit_affinity ?? 0) +
    0.45 * (category?.ai_affinity ?? 0);
  if (category?.verdict === "like") score = Math.max(score, 0.6);
  score = clamp(score);
  let reason: string | null = null;
  if (category?.verdict === "like") reason = "ты любишь такое";
  else if ((own?.visit_affinity ?? 0) >= 0.3) reason = "тебе понравилось в прошлый раз";
  else if (own?.ai_reason && Math.abs(own.ai_affinity) >= 0.2) reason = own.ai_reason;
  else if (category?.ai_reason && Math.abs(category.ai_affinity) >= 0.2)
    reason = category.ai_reason;
  return { score, never: false, liked: score >= 0.6, reason };
}

/** Во сколько раз чаще или реже выпадает: от ×0.33 до ×3. */
export function tasteMultiplier(score: number) {
  return Math.exp(1.1 * clamp(score));
}

/** Сигнал вкуса из оценки и впечатления после визита; null — ничего не сказали. */
export function visitSignal(rating: number | null | undefined, emotion?: PlaceEmotion | null) {
  const parts: number[] = [];
  if (rating != null)
    parts.push(({ 1: -0.8, 2: -0.4, 3: 0, 4: 0.4, 5: 0.8 } as const)[rating as 1] ?? 0);
  if (emotion) parts.push({ wow: 0.9, good: 0.4, meh: -0.2, bad: -0.8 }[emotion]);
  if (!parts.length) return null;
  return parts.reduce((sum, value) => sum + value, 0) / parts.length;
}

/** Оценка после визита сдвигает вес типа заметно, категории — слегка. */
export async function learnFromVisit(
  repository: Pick<AppRepository, "listActivityPreferences" | "patchActivityPreference">,
  ownerId: string,
  type: Pick<ActivityType, "id" | "category_id">,
  signal: number,
) {
  const index = tasteIndex(await repository.listActivityPreferences(ownerId));
  const own = index.get(`type:${type.id}`)?.visit_affinity ?? 0;
  const category = index.get(`category:${type.category_id}`)?.visit_affinity ?? 0;
  await repository.patchActivityPreference(ownerId, {
    target_kind: "type",
    target_id: type.id,
    visit_affinity: clamp(0.4 * own + 0.6 * signal),
  });
  await repository.patchActivityPreference(ownerId, {
    target_kind: "category",
    target_id: type.category_id,
    visit_affinity: clamp(0.7 * category + 0.3 * signal),
  });
}

/** Взвешенное перемешивание: тяжёлые чаще оказываются впереди (Efraimidis–Spirakis). */
export function weightedShuffle<T>(items: T[], weight: (item: T) => number, rng: () => number) {
  return items
    .map((item) => {
      const w = Math.max(1e-6, weight(item));
      return { item, key: Math.pow(Math.max(rng(), 1e-12), 1 / w) };
    })
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.item);
}

// ——— Гипотезы нейросети ————————————————————————————————————————————————

export interface TasteHypothesis {
  target_kind: TasteTargetKind;
  target_id: string;
  affinity: number;
  reason: string;
}
export interface TasteInference {
  summary: string;
  hypotheses: TasteHypothesis[];
}
export interface TasteEvidence {
  locale: string;
  about: { bio: string | null; values: string[]; portrait: string | null };
  memories: string[];
  experiences: { title: string; liked: string[]; disliked: string[] }[];
  visits: {
    activity: string;
    rating: number | null;
    emotion: string | null;
    note: string | null;
  }[];
  verdicts: { activity: string; verdict: "like" | "never" }[];
  categories: { id: string; name: string }[];
  types: { id: string; name: string; category_id: string }[];
}
export interface TasteAi {
  inferActivityTastes?(evidence: TasteEvidence): Promise<TasteInference | null>;
}

/** Ответ нейросети приводим к справочнику: чужие id выбрасываем, силу ограничиваем. */
export function sanitizeInference(raw: unknown, catalog: ActivityCatalog): TasteInference | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as { summary?: unknown; hypotheses?: unknown };
  const types = new Set(catalog.types.map((t) => t.id));
  const categories = new Set(catalog.categories.map((c) => c.id));
  const seen = new Set<string>();
  const hypotheses: TasteHypothesis[] = [];
  for (const item of Array.isArray(data.hypotheses) ? data.hypotheses : []) {
    if (!item || typeof item !== "object") continue;
    const h = item as Record<string, unknown>;
    const kind =
      h.target_kind === "category" ? "category" : h.target_kind === "type" ? "type" : null;
    const id = typeof h.target_id === "string" ? h.target_id : "";
    const affinity = typeof h.affinity === "number" ? h.affinity : NaN;
    if (!kind || !Number.isFinite(affinity)) continue;
    if (kind === "type" ? !types.has(id) : !categories.has(id)) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hypotheses.push({
      target_kind: kind,
      target_id: id,
      // Догадка — не приговор: сильнее ±0.8 её не пускаем.
      affinity: clamp(affinity, -0.8, 0.8),
      reason: (typeof h.reason === "string" ? h.reason : "").trim().slice(0, 300),
    });
    if (hypotheses.length >= 30) break;
  }
  const summary = typeof data.summary === "string" ? data.summary.trim().slice(0, 600) : "";
  return { summary, hypotheses };
}

const STALE_AFTER_MS = 14 * 24 * 3600_000;
const COOLDOWN_MS = 30 * 60_000;

/** Пора ли пересобрать гипотезы: давно не собирали или появились новые факты. */
export function needsTasteRefresh(
  refreshedAt: string | null | undefined,
  latestSignalAt: string | null,
  now = Date.now(),
) {
  if (!refreshedAt) return true;
  const at = Date.parse(refreshedAt);
  if (now - at > STALE_AFTER_MS) return true;
  return Boolean(latestSignalAt && Date.parse(latestSignalAt) > at && now - at > COOLDOWN_MS);
}

type TasteRepository = Pick<
  AppRepository,
  | "getProfile"
  | "getSelfPerson"
  | "listMemories"
  | "listExperiences"
  | "listPlaceVisits"
  | "listActivityPreferences"
  | "replaceAiPreferences"
  | "getTasteProfile"
  | "saveTasteProfile"
  | "listActivityCatalog"
>;

export async function collectTasteEvidence(
  repository: TasteRepository,
  ownerId: string,
  catalog: ActivityCatalog,
): Promise<{ evidence: TasteEvidence; latestSignalAt: string | null }> {
  const [profile, self, experiences, visits, prefs] = await Promise.all([
    repository.getProfile(ownerId),
    repository.getSelfPerson(ownerId),
    repository.listExperiences(ownerId),
    repository.listPlaceVisits(ownerId),
    repository.listActivityPreferences(ownerId),
  ]);
  const memories = self
    ? (await repository.listMemories(ownerId, self.id)).filter((m) => m.status === "active")
    : [];
  const typeName = new Map(catalog.types.map((t) => [t.id, t.name]));
  const categoryName = new Map(catalog.categories.map((c) => [c.id, c.name]));
  const nameOf = (kind: TasteTargetKind, id: string) =>
    (kind === "type" ? typeName.get(id) : categoryName.get(id)) ?? id;
  const stamps = [
    ...memories.map((m) => m.updated_at ?? m.created_at),
    ...visits.map((v) => v.updated_at),
    ...prefs.filter((p) => p.verdict).map((p) => p.updated_at),
  ].filter(Boolean) as string[];
  return {
    latestSignalAt: stamps.sort().at(-1) ?? null,
    evidence: {
      locale: profile?.locale || "ru",
      about: {
        bio: profile?.bio ?? null,
        values: (profile?.values ?? []).slice(0, 12),
        portrait: profile?.context_summary ?? null,
      },
      memories: memories.slice(0, 40).map((m) => m.content.slice(0, 240)),
      experiences: experiences.slice(0, 20).map((x) => ({
        title: x.title,
        liked: x.positive_signals.slice(0, 4),
        disliked: x.negative_signals.slice(0, 4),
      })),
      visits: visits
        .filter((v) => v.status === "visited")
        .slice(0, 30)
        .map((v) => ({
          activity: (v.activity_type_id && typeName.get(v.activity_type_id)) || v.title || "",
          rating: v.rating,
          emotion: v.emotion ?? null,
          note: v.note?.slice(0, 200) ?? null,
        })),
      verdicts: prefs
        .filter((p) => p.verdict)
        .map((p) => ({ activity: nameOf(p.target_kind, p.target_id), verdict: p.verdict! })),
      categories: catalog.categories.map((c) => ({ id: c.id, name: c.name })),
      types: catalog.types.map((t) => ({ id: t.id, name: t.name, category_id: t.category_id })),
    },
  };
}

const running = new Map<string, Promise<TasteInference | null>>();

/**
 * Пересобирает гипотезы нейросети о вкусах. Без force — только если пора
 * (см. needsTasteRefresh). Вердикты человека и следы визитов не трогает.
 */
export async function refreshTastes(
  repository: TasteRepository & Pick<AppRepository, "listActivityCatalog">,
  ai: TasteAi | undefined,
  ownerId: string,
  options: { force?: boolean; catalog: ActivityCatalog },
): Promise<TasteInference | null> {
  if (!ai?.inferActivityTastes || !options.catalog.types.length) return null;
  const inflight = running.get(ownerId);
  if (inflight) return inflight;
  const run = (async () => {
    const [{ evidence, latestSignalAt }, profile] = await Promise.all([
      collectTasteEvidence(repository, ownerId, options.catalog),
      repository.getTasteProfile(ownerId),
    ]);
    if (!options.force && !needsTasteRefresh(profile?.refreshed_at, latestSignalAt)) return null;
    // Без единого факта гадать не о чем — просто отмечаем, что смотрели.
    const empty =
      !evidence.memories.length &&
      !evidence.experiences.length &&
      !evidence.visits.length &&
      !evidence.verdicts.length &&
      !evidence.about.bio &&
      !evidence.about.portrait;
    if (empty) {
      await repository.saveTasteProfile(ownerId, {
        summary: profile?.summary ?? null,
        refreshed_at: new Date().toISOString(),
      });
      return null;
    }
    await assertCloudQuota(repository as unknown as AppRepository, ownerId);
    const inference = sanitizeInference(await ai.inferActivityTastes!(evidence), options.catalog);
    if (!inference) return null;
    await repository.replaceAiPreferences(
      ownerId,
      inference.hypotheses.map((h) => ({
        target_kind: h.target_kind,
        target_id: h.target_id,
        ai_affinity: h.affinity,
        ai_reason: h.reason || null,
      })),
    );
    await repository.saveTasteProfile(ownerId, {
      summary: inference.summary || null,
      refreshed_at: new Date().toISOString(),
    });
    return inference;
  })().finally(() => running.delete(ownerId));
  running.set(ownerId, run);
  return run;
}
