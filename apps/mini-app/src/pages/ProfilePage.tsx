import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { AppearancePicker } from "../components/AppearancePicker";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { TelegramLoginButton } from "../components/TelegramLogin";
import { LanguageSwitcher, pluralWord, useI18n } from "../i18n";
import { COMMON_TIMEZONES, detectTimeZone, type Language } from "../i18n/locale";
import { memoryCategoryKeys, isInferredBehaviorMemory } from "../memory";
import {
  type Memory,
  type MemoryCategory,
  type PersonLocation,
  type Reflection,
  type ReliabilityStats,
  type SelfProfile,
} from "../types";
import {
  Button,
  Card,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PageHeader,
  useAsyncData,
} from "../components/ui";
import { ProfileCompleteness } from "../components/ProfileCompleteness";

const SELF_MEMORY_CATEGORIES: MemoryCategory[] = [
  "interest",
  "preference",
  "skill",
  "important_event",
  "other",
];

const reflectionText = (items: Reflection["wins"]) =>
  items.map((item) => (typeof item === "string" ? item : (item.text ?? item.title ?? "")));

function timezoneOptions(current: string | null | undefined) {
  return Array.from(new Set([current || detectTimeZone(), detectTimeZone(), ...COMMON_TIMEZONES]));
}

const RELIABILITY_BADGES = [7, 30, 60, 100, 360] as const;
const FACT_PROMPTS: {
  id: "now" | "craft" | "place";
  category: MemoryCategory;
  label: string;
  hint: string;
}[] = [
  { id: "now", category: "preference", label: "profile.promptNow", hint: "profile.promptNowHint" },
  {
    id: "craft",
    category: "preference",
    label: "profile.promptCraft",
    hint: "profile.promptCraftHint",
  },
  { id: "place", category: "other", label: "profile.promptPlace", hint: "profile.promptPlaceHint" },
];

type MemoryDraft = {
  category?: MemoryCategory;
  placeholder?: string;
};

function dayUnit(language: Language, t: (key: string) => string, count: number) {
  return pluralWord(language, count, {
    one: t("profile.dayOne"),
    few: t("profile.dayFew"),
    many: t("profile.dayMany"),
  });
}

const EMPTY_RELIABILITY: ReliabilityStats = {
  percent: 0,
  on_time: 0,
  dated: 0,
  current_streak: 0,
  best_streak: 0,
  achievements: [],
  praise: "none",
};
const RELIABILITY_RING_RADIUS = 34;
const RELIABILITY_RING_LENGTH = 2 * Math.PI * RELIABILITY_RING_RADIUS;

const medalStroke = {
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none",
};

function AchievementMark({ days }: { days: (typeof RELIABILITY_BADGES)[number] }) {
  return (
    <svg className="reliability-medal-mark" viewBox="0 0 24 24" aria-hidden="true">
      {days === 7 ? (
        <path
          d="M12 3.7l1.85 6.05L20 11.6l-6.15 1.85L12 19.5l-1.85-6.05L4 11.6l6.15-1.85z"
          {...medalStroke}
        />
      ) : null}
      {days === 30 ? (
        <>
          <rect x="5" y="6.2" width="14" height="13.2" rx="2" {...medalStroke} />
          <path d="M8.2 4.4v3M15.8 4.4v3M5 10.4h14" {...medalStroke} />
        </>
      ) : null}
      {days === 60 ? (
        <>
          <circle cx="12" cy="12" r="7.45" {...medalStroke} />
          <circle cx="12" cy="12" r="3.55" {...medalStroke} />
        </>
      ) : null}
      {days === 100 ? (
        <>
          <circle cx="12" cy="12" r="8" {...medalStroke} />
          <circle cx="12" cy="12" r="4.2" {...medalStroke} />
          <circle cx="12" cy="12" r="1.35" fill="currentColor" />
        </>
      ) : null}
      {days === 360 ? (
        <>
          <circle cx="12" cy="12" r="7.5" {...medalStroke} />
          <circle cx="12" cy="12" r="1.15" fill="currentColor" />
          <path d="M12 4.5v2M19.5 12h-2M12 19.5v-2M4.5 12h2" {...medalStroke} />
        </>
      ) : null}
    </svg>
  );
}

function ReliabilityCard({ stats }: { stats: ReliabilityStats }) {
  const { t } = useI18n();
  const praise =
    stats.praise === "excellent"
      ? t("profile.reliabilityExcellent")
      : stats.praise === "solid"
        ? t("profile.reliabilitySolid")
        : null;
  const offset = RELIABILITY_RING_LENGTH * (1 - Math.max(0, Math.min(100, stats.percent)) / 100);
  return (
    <Card>
      <div className="reliability-hero">
        {/* Пока ни одно дело со сроком не закрыто и ни один срок не прошёл,
            считать нечего — а крупный «0%» на первом же экране читается как
            приговор человеку, который только что пришёл. Целевой сегмент S1
            приходит с чувством вины; встречать его нулём — ровно то, чего
            граф работ велит избегать. Кольцо появляется вместе с данными. */}
        {stats.dated ? (
          <div
            className="reliability-ring-wrap"
            role="img"
            aria-label={`${t("profile.reliabilityTitle")}: ${stats.percent}%`}
          >
            <svg className="reliability-ring" viewBox="0 0 88 88">
              <circle
                className="reliability-ring-track"
                cx="44"
                cy="44"
                r={RELIABILITY_RING_RADIUS}
              />
              <circle
                className="reliability-ring-fill"
                cx="44"
                cy="44"
                r={RELIABILITY_RING_RADIUS}
                strokeDasharray={RELIABILITY_RING_LENGTH}
                strokeDashoffset={offset}
                transform="rotate(-90 44 44)"
              />
            </svg>
            <p className="reliability-ring-value">{stats.percent}%</p>
          </div>
        ) : null}
        <div className="min-w-0">
          <p className="eyebrow">{t("profile.reliabilityEyebrow")}</p>
          <h2 id="reliability-title" className="text-xl font-bold">
            {t("profile.reliabilityTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("profile.reliabilityHint")}</p>
          {stats.dated ? (
            <p className="mt-2 text-xs text-muted">
              {t("profile.reliabilityCount", { onTime: stats.on_time, dated: stats.dated })}
            </p>
          ) : null}
        </div>
      </div>
      {praise ? <p className="mt-3 text-sm">{praise}</p> : null}
      {!stats.dated ? (
        <p className="reliability-cue">
          {t("profile.reliabilityEmpty")} <Link to="/">{t("profile.reliabilityOpenTasks")}</Link>
        </p>
      ) : null}
      {stats.dated && !praise ? (
        <p className="reliability-cue">
          {t("profile.reliabilityNextDated")}{" "}
          <Link to="/">{t("profile.reliabilityOpenTasks")}</Link>
        </p>
      ) : null}
    </Card>
  );
}

function medalHolders(
  t: (key: string, vars?: Record<string, string | number>) => string,
  days: (typeof RELIABILITY_BADGES)[number],
  community?: ReliabilityStats["community"],
) {
  if (!community?.users) return null;
  const holders = community.holders[days] ?? 0;
  const rounded = Math.round((holders / community.users) * 100);
  const percent = holders > 0 && rounded === 0 ? "<1" : String(rounded);
  return t("profile.reliabilityMedalHolders", { percent });
}

function AchievementsCard({ stats }: { stats: ReliabilityStats }) {
  const { language, t } = useI18n();
  const [openMedal, setOpenMedal] = useState<(typeof RELIABILITY_BADGES)[number] | null>(null);
  const nextBadge = RELIABILITY_BADGES.find((days) => !stats.achievements.includes(days));
  const current = Math.min(stats.current_streak, nextBadge ?? stats.current_streak);
  const progress = nextBadge ? Math.max(0, Math.min(100, (current / nextBadge) * 100)) : 100;
  return (
    <Card>
      <p className="eyebrow">{t("profile.reliabilityAchievementsEyebrow")}</p>
      <h2 id="achievements-title" className="text-xl font-bold">
        {t("profile.reliabilityAchievementsTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("profile.reliabilityAchievementsHint")}</p>
      {stats.current_streak > 0 ? (
        <p className="mt-2 text-sm">
          {t("profile.reliabilityStreak", {
            count: stats.current_streak,
            unit: dayUnit(language, t, stats.current_streak),
          })}
        </p>
      ) : null}
      {nextBadge ? (
        <div className="reliability-streak">
          <div className="reliability-streak-meta">
            <span>
              {t("profile.reliabilityNextMedal", {
                badge: t(`profile.reliabilityDay${nextBadge}`),
              })}
            </span>
            <span>{t("profile.reliabilityStreakOf", { current, target: nextBadge })}</span>
          </div>
          <div
            className="reliability-streak-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={nextBadge}
            aria-valuenow={current}
            aria-label={t("profile.reliabilityNextMedal", {
              badge: t(`profile.reliabilityDay${nextBadge}`),
            })}
          >
            <div className="reliability-streak-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}
      {/* Лестницу из пяти знаков показываем, когда серия уже идёт. Пустая
          витрина недостижимых наград в первый день — обещание нагрузки,
          а не мотивация; ближайшая цель выше уже названа отдельной строкой. */}
      <div className="reliability-medals">
        {(stats.current_streak > 0 || stats.achievements.length
          ? RELIABILITY_BADGES
          : RELIABILITY_BADGES.slice(0, 1)
        ).map((days) => {
          const unlocked = stats.achievements.includes(days);
          const holders = medalHolders(t, days, stats.community);
          const about = t(`profile.reliabilityMedalAbout${days}`);
          const awarded = t(`profile.reliabilityMedalFor${days}`);
          return (
            <button
              key={days}
              type="button"
              className={`reliability-medal${unlocked ? " reliability-medal-on" : ""}${openMedal === days ? " is-open" : ""}`}
              aria-expanded={openMedal === days}
              aria-label={[t(`profile.reliabilityDay${days}`), about, awarded, holders]
                .filter(Boolean)
                .join(". ")}
              onMouseEnter={() => setOpenMedal(days)}
              onMouseLeave={() => setOpenMedal(null)}
              onFocus={() => setOpenMedal(days)}
              onBlur={() => setOpenMedal(null)}
              onClick={(event) => {
                if (event.detail === 0) return;
                if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
                setOpenMedal((currentOpen) => (currentOpen === days ? null : days));
              }}
            >
              <AchievementMark days={days} />
              <span className="reliability-medal-name">{t(`profile.reliabilityDay${days}`)}</span>
              <span className="reliability-medal-hint">
                {t(`profile.reliabilityMedalHint${days}`)}
              </span>
              <span className="reliability-tooltip">
                <strong>{about}</strong>
                <span>{awarded}</span>
                {holders ? <span>{holders}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function primaryLocation(locations: PersonLocation[]) {
  return locations.find((item) => item.is_primary) ?? locations[0] ?? null;
}

function memorySelectCategories(memory?: Memory) {
  if (memory && !SELF_MEMORY_CATEGORIES.includes(memory.category)) {
    return [memory.category, ...SELF_MEMORY_CATEGORIES];
  }
  return SELF_MEMORY_CATEGORIES;
}

export function ProfilePage() {
  const { api } = useAuth();
  const { t, formatDate } = useI18n();
  const location = useLocation();
  const state = useAsyncData(
    async () => {
      const [profile, memories, reflections] = await Promise.all([
        api.me(),
        api.selfMemories(),
        api.reflections(),
      ]);
      return {
        profile,
        memories,
        reflections,
        locations: profile.locations ?? [],
      };
    },
    [api],
    undefined,
    { live: true },
  );
  const completeness = useAsyncData(() => api.profileCompleteness(), [api], undefined, {
    live: true,
  });
  const [editing, setEditing] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft | null>(null);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const id = location.hash.replace(/^#/, "");
    if (!id || !state.data) return;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash, state.data]);

  if (state.loading) return <LoadingState label={t("profile.loading")} />;
  if (state.error || !state.data)
    return <ErrorState message={state.error ?? t("profile.unavailable")} retry={state.reload} />;

  const { profile, memories, reflections, locations } = state.data;
  const facts = memories.filter((memory) => !isInferredBehaviorMemory(memory));
  const city = primaryLocation(locations)?.city;
  const reliability = profile.reliability ?? EMPTY_RELIABILITY;
  const identity =
    Boolean(profile.first_name || profile.username || profile.bio) ||
    profile.values.length > 0 ||
    Boolean(city);
  const keepLinkedProfile = (saved: SelfProfile): SelfProfile => ({
    ...profile,
    ...saved,
    telegram_id: saved.telegram_id ?? profile.telegram_id,
    auth_user_id: saved.auth_user_id ?? profile.auth_user_id,
    email: saved.email ?? profile.email,
    first_name: saved.first_name ?? profile.first_name,
    username: saved.username ?? profile.username,
  });
  const saveLinkedProfile = (saved: SelfProfile) => {
    state.setData({ ...state.data!, profile: keepLinkedProfile(saved) });
    completeness.reload();
  };

  return (
    <>
      <PageHeader
        eyebrow={t("profile.eyebrow")}
        title={t("profile.title")}
        description={t("profile.description")}
      />
      {actionError && (
        <p className="error-text mb-4" role="alert">
          {actionError}
        </p>
      )}

      <section id="reliability" className="profile-anchor" aria-labelledby="reliability-title">
        <ReliabilityCard stats={reliability} />
      </section>

      <section
        id="achievements"
        className="profile-anchor mt-6"
        aria-labelledby="achievements-title"
      >
        <AchievementsCard stats={reliability} />
      </section>

      <section id="facts" className="profile-anchor mt-6" aria-labelledby="self-memory-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">{t("profile.selfEyebrow")}</p>
            <h2 id="self-memory-title" className="text-xl font-bold">
              {t("profile.selfTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted">{t("profile.factsHint")}</p>
          </div>
          <Button variant="secondary" onClick={() => setMemoryDraft({})}>
            {t("profile.addFact")}
          </Button>
        </div>
        {identity ? (
          <Card className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">
                {profile.first_name || profile.username || t("profile.yourProfile")}
              </h3>
              {profile.bio ? (
                <p className="mt-2 text-sm leading-relaxed text-muted">{profile.bio}</p>
              ) : null}
              {(profile.values.length > 0 || city) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {profile.values.map((value) => (
                    <span className="tag" key={value}>
                      {value}
                    </span>
                  ))}
                  {city ? <span className="tag">{city}</span> : null}
                </div>
              )}
            </div>
            <button
              className="icon-button"
              aria-label={t("profile.editTitle")}
              onClick={() => setEditing(true)}
            >
              ✎
            </button>
          </Card>
        ) : null}
        {facts.length < 4 || !identity ? (
          <div className="chip-row mb-3">
            {!identity ? (
              <button type="button" className="chip" onClick={() => setEditing(true)}>
                {t("profile.editIdentity")}
              </button>
            ) : null}
            {facts.length < 4
              ? FACT_PROMPTS.map((prompt) => (
                  <button
                    key={prompt.id}
                    type="button"
                    className="chip"
                    onClick={() =>
                      setMemoryDraft({
                        category: prompt.category,
                        placeholder: t(prompt.hint),
                      })
                    }
                  >
                    {t(prompt.label)}
                  </button>
                ))
              : null}
          </div>
        ) : null}
        {facts.length ? (
          <>
            <p className="mb-2 text-xs text-muted">{t("profile.usesInChat")}</p>
            <div className="space-y-2">
              {facts.map((memory) => (
                <Card key={memory.id} className="flex items-start justify-between gap-3">
                  <div>
                    <span className="tag">{t(memoryCategoryKeys[memory.category])}</span>
                    <p className="mt-2 text-sm">{memory.content}</p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Edit ${memory.content}`}
                    onClick={() => setEditingMemory(memory)}
                  >
                    ✎
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Delete ${memory.content}`}
                    onClick={async () => {
                      if (!window.confirm(t("profile.deleteConfirm"))) return;
                      try {
                        await api.deleteSelfMemory(memory.id);
                        state.setData({
                          ...state.data!,
                          memories: memories.filter((item) => item.id !== memory.id),
                        });
                        completeness.reload();
                      } catch (cause) {
                        setActionError(
                          cause instanceof Error ? cause.message : t("profile.deleteFailed"),
                        );
                      }
                    }}
                  >
                    ×
                  </button>
                </Card>
              ))}
            </div>
          </>
        ) : null}
        <p className="mt-3 text-sm text-muted">
          <Link className="back-link" to="/companion">
            {t("profile.talkToIlzi")}
          </Link>
          {` ${t("profile.talkToIlziHint")}`}
        </p>
        {completeness.data ? (
          <div className="mt-3">
            <ProfileCompleteness report={completeness.data} />
          </div>
        ) : null}
      </section>

      <DayLoopCard profile={profile} onSaved={saveLinkedProfile} />

      {!!reflections.length && (
        <section className="mt-6" aria-labelledby="reflection-title">
          <p className="eyebrow">{t("profile.reflectionEyebrow")}</p>
          <h2 id="reflection-title" className="mb-3 text-xl font-bold">
            {t("profile.reflectionTitle")}
          </h2>
          <div className="space-y-3">
            {reflections.slice(0, 2).map((reflection) => (
              <Card key={reflection.id}>
                <p className="text-xs font-bold text-muted">
                  {formatDate(reflection.period_start)} – {formatDate(reflection.period_end)}
                </p>
                {reflectionText(reflection.wins)
                  .filter(Boolean)
                  .map((win) => (
                    <p className="mt-2 text-sm" key={win}>
                      {win}
                    </p>
                  ))}
              </Card>
            ))}
          </div>
        </section>
      )}

      <AppearancePicker />
      <AccountCard profile={profile} />

      {editingMemory && (
        <EditSelfMemoryForm
          memory={editingMemory}
          onClose={() => setEditingMemory(null)}
          onSaved={(memory) => {
            state.setData({
              ...state.data!,
              memories: memories.map((item) => (item.id === memory.id ? memory : item)),
            });
            setEditingMemory(null);
          }}
        />
      )}
      {editing && (
        <ProfileForm
          profile={profile}
          city={city ?? ""}
          onClose={() => setEditing(false)}
          onSaved={async (saved, nextCity) => {
            const trimmed = nextCity.trim();
            let nextLocations = locations;
            if (trimmed && trimmed !== city) {
              const current = primaryLocation(locations);
              const location = current
                ? await api.updateSelfLocation(current.id, {
                    city: trimmed,
                    address: current.address,
                    label: current.label,
                    is_primary: true,
                  })
                : await api.createSelfLocation({ city: trimmed, is_primary: true });
              nextLocations = current
                ? locations.map((item) =>
                    item.id === location.id ? location : { ...item, is_primary: false },
                  )
                : [location, ...locations];
            }
            state.setData({
              ...state.data!,
              profile: keepLinkedProfile(saved),
              locations: nextLocations,
            });
            completeness.reload();
            setEditing(false);
          }}
        />
      )}
      {memoryDraft && (
        <SelfMemoryForm
          draft={memoryDraft}
          onClose={() => setMemoryDraft(null)}
          onSaved={(memory) => {
            state.setData({ ...state.data!, memories: [memory, ...memories] });
            completeness.reload();
            setMemoryDraft(null);
          }}
        />
      )}
    </>
  );
}

function DayLoopCard({
  profile,
  onSaved,
}: {
  profile: SelfProfile;
  onSaved: (profile: SelfProfile) => void;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const hasTelegram = Boolean(profile.telegram_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({
    timezone: profile.timezone || detectTimeZone(),
    morning_digest_enabled: profile.morning_digest_enabled ?? false,
    morning_digest_time: profile.morning_digest_time ?? "08:00",
    weekly_digest_enabled: profile.weekly_digest_enabled ?? false,
    weekly_digest_time: profile.weekly_digest_time ?? "09:00",
    evening_sync_enabled: profile.evening_sync_enabled ?? false,
    evening_sync_time: profile.evening_sync_time ?? "21:00",
    weekly_reflection_enabled: profile.weekly_reflection_enabled ?? false,
  });

  const save = async (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setSaving(true);
    setError("");
    try {
      onSaved(await api.updateMe(next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("profile.notifyFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section id="loop" className="profile-anchor mt-6" aria-labelledby="notifications-title">
      <p className="eyebrow">{t("profile.loopEyebrow")}</p>
      <h2 id="notifications-title" className="mb-2 text-xl font-bold">
        {t("profile.loopTitle")}
      </h2>
      <Card>
        <Field label={t("profile.timezone")} hint={t("profile.timezoneHint")}>
          <select
            className="input"
            name="timezone"
            value={draft.timezone}
            disabled={saving}
            onChange={(event) => void save({ timezone: event.target.value })}
          >
            {timezoneOptions(draft.timezone).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </Field>
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-4 text-sm text-muted">
            {hasTelegram
              ? t("profile.notifyLead", { zone: draft.timezone || "UTC" })
              : t("profile.notifyWebLead", { zone: draft.timezone || "UTC" })}
          </p>
        </div>
        <div className="mt-2 space-y-4">
          {/* Утренняя сводка работает и без Telegram: она открывается на главной
              и ложится в диалог. Остальные каналы пока живут только в Telegram. */}
          <NotificationToggle
            id="morning_digest"
            title={t("profile.morningTitle")}
            description={hasTelegram ? t("profile.morningText") : t("profile.morningWebText")}
            enabled={draft.morning_digest_enabled}
            time={draft.morning_digest_time}
            onEnabled={(morning_digest_enabled) => void save({ morning_digest_enabled })}
            onTime={(morning_digest_time) => void save({ morning_digest_time })}
            disabled={saving}
          />
        </div>
        {!hasTelegram && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-sm text-muted">{t("profile.notifyNeedTelegram")}</p>
            <div className="mt-3">
              <TelegramLoginButton label={t("auth.continueTitle")} />
            </div>
          </div>
        )}
        {hasTelegram && (
          <div className="mt-4 space-y-4">
            <NotificationToggle
              id="weekly_digest"
              title={t("profile.weeklyTitle")}
              description={t("profile.weeklyText")}
              enabled={draft.weekly_digest_enabled}
              time={draft.weekly_digest_time}
              onEnabled={(weekly_digest_enabled) => void save({ weekly_digest_enabled })}
              onTime={(weekly_digest_time) => void save({ weekly_digest_time })}
              disabled={saving}
            />
            <NotificationToggle
              id="evening_sync"
              title={t("profile.eveningTitle")}
              description={t("profile.eveningText")}
              enabled={draft.evening_sync_enabled}
              time={draft.evening_sync_time}
              onEnabled={(evening_sync_enabled) => void save({ evening_sync_enabled })}
              onTime={(evening_sync_time) => void save({ evening_sync_time })}
              disabled={saving}
            />
            <NotificationToggle
              id="weekly_reflection"
              title={t("profile.weeklyReminders")}
              description={t("profile.weeklyRemindersText")}
              enabled={draft.weekly_reflection_enabled}
              onEnabled={(weekly_reflection_enabled) => void save({ weekly_reflection_enabled })}
              disabled={saving}
            />
          </div>
        )}
        {error && (
          <p className="error-text mt-4" role="alert">
            {error}
          </p>
        )}
      </Card>
    </section>
  );
}

function AccountCard({ profile }: { profile: SelfProfile }) {
  const { api } = useAuth();
  const { t } = useI18n();
  const mail = useAsyncData(() => api.mailAccounts(), [api]);

  return (
    <section id="accounts" className="profile-anchor mt-6" aria-labelledby="accounts-title">
      <p className="eyebrow">{t("profile.accountsEyebrow")}</p>
      <h2 id="accounts-title" className="mb-2 text-xl font-bold">
        {t("profile.accountsTitle")}
      </h2>
      <Card>
        <div className="space-y-4 text-sm">
          {profile.auth_user_id && (
            <div>
              <p className="font-semibold">{t("profile.emailLogin")}</p>
              <p className="mt-1 text-muted">
                {t("profile.emailConnected", {
                  email: profile.email ? t("profile.emailAs", { email: profile.email }) : "",
                })}
              </p>
            </div>
          )}
          <div>
            <p className="font-semibold">{t("profile.language")}</p>
            <p className="mt-1 text-xs text-muted">{t("profile.languageHint")}</p>
            <div className="mt-2">
              <LanguageSwitcher />
            </div>
          </div>
          <div>
            <p className="font-semibold">{t("profile.mailbox")}</p>
            {mail.data?.length ? (
              <p className="mt-1 text-muted">
                {t("profile.mailConnected", {
                  email: mail.data.map((item) => item.email).join(", "),
                })}
              </p>
            ) : (
              <p className="mt-1 text-muted">{t("profile.mailNone")}</p>
            )}
            <Link className="back-link mt-2 inline-block" to="/mail">
              {t("profile.mailConnect")}
            </Link>
          </div>
        </div>
      </Card>
      <Link to="/profile/privacy" className="list-row mt-3">
        <span className="idea-icon">◌</span>
        <span className="list-row-body">
          <span className="list-row-title">{t("more.privacyTitle")}</span>
          <span className="list-row-text">{t("more.privacyText")}</span>
        </span>
      </Link>
    </section>
  );
}

function NotificationToggle({
  id,
  title,
  description,
  enabled,
  time,
  onEnabled,
  onTime,
  disabled,
}: {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  time?: string;
  onEnabled: (enabled: boolean) => void;
  onTime?: (time: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3 pt-4 first:pt-0 sm:flex-row sm:items-center">
      <label className="flex min-w-0 flex-1 items-start gap-3 text-sm">
        <input
          className="mt-1"
          type="checkbox"
          name={id}
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onEnabled(event.target.checked)}
        />
        <span>
          <span className="block font-semibold">{title}</span>
          <span className="mt-1 block text-muted">{description}</span>
        </span>
      </label>
      {time != null && onTime && (
        <label className="flex items-center gap-2 text-sm sm:shrink-0">
          <span className="text-muted">{t("common.at")}</span>
          <input
            className="input w-auto"
            type="time"
            aria-label={`${title} time`}
            value={time}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value.slice(0, 5);
              if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) onTime(value);
            }}
          />
        </label>
      )}
    </div>
  );
}

function ProfileForm({
  profile,
  city,
  onClose,
  onSaved,
}: {
  profile: SelfProfile;
  city: string;
  onClose: () => void;
  onSaved: (profile: SelfProfile, city: string) => Promise<void> | void;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [values, setValues] = useState(profile.values);
  const [valueDraft, setValueDraft] = useState("");

  const addValue = (raw: string) => {
    const next = raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!next.length) return;
    setValues(Array.from(new Set([...values, ...next])));
    setValueDraft("");
  };

  const onValueKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addValue(valueDraft);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextValues = Array.from(
      new Set([
        ...values,
        ...String(form.get("value_draft") ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ]),
    );
    setSaving(true);
    try {
      const saved = await api.updateMe({
        bio: String(form.get("bio")).trim() || null,
        values: nextValues,
      });
      await onSaved(saved, String(form.get("city")).trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("profile.saveFailed"));
      setSaving(false);
    }
  };
  return (
    <Modal title={t("profile.editTitle")} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("profile.bio")}>
          <textarea className="input min-h-24" name="bio" defaultValue={profile.bio ?? ""} />
        </Field>
        <Field label={t("profile.values")} hint={t("profile.valuesHint")}>
          {values.length > 0 && (
            <div className="chip-row mb-2">
              {values.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="chip chip-active"
                  onClick={() => setValues(values.filter((item) => item !== value))}
                >
                  {value} ×
                </button>
              ))}
            </div>
          )}
          <input
            className="input"
            name="value_draft"
            value={valueDraft}
            onChange={(event) => setValueDraft(event.target.value)}
            onKeyDown={onValueKey}
            onBlur={() => addValue(valueDraft)}
          />
        </Field>
        <Field label={t("profile.city")} hint={t("profile.cityHint")}>
          <input
            className="input"
            name="city"
            defaultValue={city}
            placeholder={t("locations.cityPlaceholder")}
          />
        </Field>
        {error && <p className="error-text">{error}</p>}
        <Button className="w-full" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("profile.saveProfile")}
        </Button>
      </form>
    </Modal>
  );
}

function SelfMemoryForm({
  draft,
  onClose,
  onSaved,
}: {
  draft?: MemoryDraft;
  onClose: () => void;
  onSaved: (memory: Memory) => void;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState<MemoryCategory>(draft?.category ?? "interest");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      onSaved(
        await api.createSelfMemory({
          content: String(form.get("content")).trim(),
          category,
          importance: 3,
          confidence: 1,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("profile.saveMemoryFailed"));
      setSaving(false);
    }
  };
  return (
    <Modal title={t("profile.addMemory")} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("profile.category")}>
          <select
            className="input"
            name="category"
            value={category}
            onChange={(event) => setCategory(event.target.value as MemoryCategory)}
          >
            {memorySelectCategories().map((item) => (
              <option key={item} value={item}>
                {t(memoryCategoryKeys[item])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("profile.fact")}>
          <textarea
            className="input min-h-28"
            name="content"
            required
            autoFocus
            placeholder={draft?.placeholder}
          />
        </Field>
        {error && <p className="error-text">{error}</p>}
        <Button className="w-full" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("profile.saveFact")}
        </Button>
      </form>
    </Modal>
  );
}

function EditSelfMemoryForm({
  memory,
  onClose,
  onSaved,
}: {
  memory: Memory;
  onClose: () => void;
  onSaved: (memory: Memory) => void;
}) {
  const { api } = useAuth();
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      onSaved(
        await api.updateSelfMemory(memory.id, {
          content: String(form.get("content")).trim(),
          category: String(form.get("category")) as Memory["category"],
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("profile.saveMemoryFailed"));
      setSaving(false);
    }
  };
  return (
    <Modal title={t("profile.editFact")} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <Field label={t("profile.category")}>
          <select className="input" name="category" defaultValue={memory.category}>
            {memorySelectCategories(memory).map((category) => (
              <option key={category} value={category}>
                {t(memoryCategoryKeys[category])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("profile.fact")}>
          <textarea
            className="input min-h-28"
            name="content"
            defaultValue={memory.content}
            required
          />
        </Field>
        {error && <p className="error-text">{error}</p>}
        <Button className="w-full" type="submit" disabled={saving}>
          {saving ? t("common.saving") : t("profile.saveChanges")}
        </Button>
      </form>
    </Modal>
  );
}
