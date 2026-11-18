import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActivityCatalog,
  ActivityPreference,
  ActivityPreferencePatch,
  ActivityTasteProfile,
  PlaceUpsertInput,
  ActivitySpin,
  ActivitySpinInput,
  Place,
  PlaceVisit,
  PlaceVisitInput,
  CalendarEvent,
  CalendarEventInput,
  Memory,
  Message,
  Person,
  Recommendation,
  Space,
  Task,
  User,
  MemoryCategory,
  RecommendationItem,
  TaskStatus,
  TaskActivityType,
  TaskAssignee,
  TaskKind,
  TaskRecurrenceFrequency,
  Conversation,
  UserProfile,
  Goal,
  Project,
  Reflection,
  RecommendationFeedback,
  PendingAction,
  UsageCounter,
  UsageHour,
  QuotaPlan,
  UserPlan,
  Experience,
  SelfPromise,
  SelfPromiseCheckin,
  MailAccount,
  MailAccountPublic,
  MailMessage,
  MailDraft,
  MailPlaybook,
  PersonLocation,
  PersonDate,
  PersonDateKind,
  Note,
  NoteActionPreview,
  NoteActionProposal,
  NoteMutation,
  NoteRevision,
  ImportSession,
  ImportItem,
  ImportSource,
} from "./types.js";
import {
  nextUpcomingRecurrenceAt,
  recurrenceTemplate,
  type RecurrenceTemplate,
} from "./task-recurrence.js";
import {
  AI_WORK_MAX_ATTEMPTS,
  AI_WORK_STALE_MS,
  isFreshAiLock,
  isStaleAiLock,
  pickNextAiWork,
} from "./modules/assistant/ai-work-queue.js";
import { archiveGoalLinkedWork } from "./modules/assistant/goal-plan.js";
import {
  PERSON_DATE_MAX,
  isUniquePersonDateKind,
  isValidCalendarDay,
  sortPersonDates,
} from "./modules/assistant/dates.js";

export type PersonInput = {
  name: string;
  relationship?: string | null;
  description?: string | null;
  aliases?: string[];
};
export type LocationInput = {
  label?: string | null;
  city: string;
  address?: string | null;
  is_primary?: boolean;
};
export type DateInput = {
  kind: PersonDateKind;
  label?: string | null;
  month: number;
  day: number;
  year?: number | null;
};
export type MemoryInput = {
  content: string;
  category: MemoryCategory;
  importance?: number;
  confidence?: number;
  source_message_id?: string | null;
  status?: "active" | "archived";
  occurred_at?: string | null;
  metadata?: Record<string, unknown>;
};
type SpaceInput = { name: string; type?: string; context?: string | null; person_ids?: string[] };
export type TaskInput = {
  id?: string;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  person_id?: string | null;
  space_id?: string | null;
  goal_id?: string | null;
  project_id?: string | null;
  source_note_id?: string | null;
  due_at?: string | null;
  estimate_minutes?: number | null;
  completed_at?: string | null;
  sort_order?: number | null;
  recurrence_frequency?: TaskRecurrenceFrequency | null;
  recurrence_series_id?: string | null;
  recurrence_anchor_at?: string | null;
  recurrence_template?: Record<string, unknown> | null;
  recurrence_scope?: "instance" | "series";
  kind?: TaskKind;
  activity_type?: TaskActivityType | null;
  value_score?: number | null;
  importance?: number;
  urgency?: number;
  assignee?: TaskAssignee;
  agent_locked_at?: string | null;
  agent_attempts?: number;
  agent_result?: string | null;
};

const recurrenceTemplateKeys = [
  "title",
  "description",
  "person_id",
  "space_id",
  "goal_id",
  "project_id",
  "kind",
  "activity_type",
  "value_score",
  "estimate_minutes",
  "importance",
  "urgency",
  "assignee",
] as const;

function recurrenceFields(input: TaskInput) {
  if (!input.recurrence_frequency) return {};
  const anchor = input.recurrence_anchor_at ?? input.due_at;
  if (!anchor) throw Object.assign(new Error("A recurring task needs a due date"), { status: 400 });
  const template: RecurrenceTemplate = {
    title: input.title,
    description: input.description ?? null,
    person_id: input.person_id ?? null,
    space_id: input.space_id ?? null,
    goal_id: input.goal_id ?? null,
    project_id: input.project_id ?? null,
    kind: input.kind ?? "task",
    activity_type: input.activity_type ?? null,
    value_score: input.value_score ?? null,
    estimate_minutes: input.estimate_minutes ?? null,
    importance: input.importance ?? 3,
    urgency: input.urgency ?? 3,
    assignee: input.assignee ?? "user",
  };
  return {
    recurrence_frequency: input.recurrence_frequency,
    recurrence_series_id: input.recurrence_series_id ?? randomUUID(),
    recurrence_anchor_at: anchor,
    recurrence_template: input.recurrence_template ?? template,
  };
}

function nextRecurringInput(task: Task, timezone = "UTC", at = new Date()): TaskInput | null {
  if (!task.recurrence_frequency || !task.recurrence_series_id) return null;
  const anchor = task.recurrence_anchor_at ?? task.due_at;
  if (!anchor) return null;
  const next = nextUpcomingRecurrenceAt(anchor, task.recurrence_frequency, at, timezone);
  const template = (task.recurrence_template ?? recurrenceTemplate(task)) as RecurrenceTemplate;
  return {
    ...template,
    due_at: next,
    recurrence_frequency: task.recurrence_frequency,
    recurrence_series_id: task.recurrence_series_id,
    recurrence_anchor_at: next,
    recurrence_template: template,
  };
}

function seriesUpdateFields(task: Task, fields: Partial<TaskInput>) {
  if (fields.recurrence_scope !== "series" || !task.recurrence_series_id) return fields;
  const template = {
    ...(task.recurrence_template ?? recurrenceTemplate(task)),
  } as Record<string, unknown>;
  for (const key of recurrenceTemplateKeys) {
    if (key in fields) template[key] = fields[key];
  }
  return {
    ...fields,
    recurrence_template: template as RecurrenceTemplate,
    recurrence_anchor_at: fields.due_at ?? task.recurrence_anchor_at,
  };
}
type RecommendationInput = {
  person_id?: string | null;
  space_id?: string | null;
  task_id?: string | null;
  query: string;
  items: RecommendationItem[];
  memory_ids: string[];
  experience_ids?: string[];
};
export type ProfileInput = Partial<
  Pick<
    UserProfile,
    | "bio"
    | "values"
    | "communication_style"
    | "timezone"
    | "locale"
    | "context_summary"
    | "weekly_reflection_enabled"
    | "morning_digest_enabled"
    | "morning_digest_time"
    | "weekly_digest_enabled"
    | "weekly_digest_time"
    | "evening_sync_enabled"
    | "evening_sync_time"
    | "last_morning_digest_on"
    | "last_weekly_digest_on"
    | "last_evening_sync_on"
    | "last_goal_checkin_on"
    | "onboarding_completed_at"
    | "last_active_at"
    | "last_reengagement_at"
    | "reengagement_enabled"
  >
>;
export type GoalInput = Pick<Goal, "title"> &
  Partial<
    Pick<
      Goal,
      | "description"
      | "status"
      | "horizon"
      | "priority"
      | "target_date"
      | "current_plan"
      | "plan_revised_at"
      | "source_note_id"
    >
  >;
export type ProjectInput = Pick<Project, "name"> &
  Partial<Pick<Project, "goal_id" | "space_id" | "description" | "status">>;
export type PromiseInput = Pick<SelfPromise, "title"> &
  Partial<Pick<SelfPromise, "description" | "status" | "started_at">>;
export type PromiseCheckinInput = Pick<SelfPromiseCheckin, "status"> &
  Partial<Pick<SelfPromiseCheckin, "note">>;
export type ExperienceInput = Pick<Experience, "type" | "title"> &
  Partial<
    Pick<
      Experience,
      | "place"
      | "description"
      | "occurred_at"
      | "positive_signals"
      | "negative_signals"
      | "emotions"
      | "outcome"
      | "source_message_id"
      | "planned_task_id"
      | "planned_space_id"
      | "follow_up_at"
      | "status"
      | "participant_ids"
    >
  >;
export type MailAccountInput = Pick<
  MailAccount,
  | "email"
  | "provider"
  | "username"
  | "imap_host"
  | "imap_port"
  | "smtp_host"
  | "smtp_port"
  | "secret_cipher"
> &
  Partial<Pick<MailAccount, "status" | "last_error" | "last_synced_at">>;
export type MailMessageInput = Pick<
  MailMessage,
  "account_id" | "provider_uid" | "from_address" | "subject" | "snippet"
> &
  Partial<
    Pick<
      MailMessage,
      | "from_name"
      | "to_address"
      | "received_at"
      | "is_important"
      | "is_meeting"
      | "meeting_at"
      | "has_calendar_invite"
      | "handled"
    >
  >;
export type MailDraftInput = Pick<MailDraft, "account_id" | "to_address" | "subject" | "body"> &
  Partial<Pick<MailDraft, "message_id" | "status" | "error" | "sent_at">>;
export type MailPlaybookInput = Pick<MailPlaybook, "name" | "trigger" | "actions"> &
  Partial<Pick<MailPlaybook, "account_id" | "prompt" | "enabled">>;
export type BetaMetricName =
  "first_self_fact" | "personal_recommendation" | "companion_week_2" | "reflection_completed";
export type LinkAuthUserResult =
  { status: "linked"; user: User } | { status: "not_found" | "owner_conflict" | "auth_conflict" };
export type NoteMutationResult =
  { status: "ok"; note: Note } | { status: "conflict"; note: Note } | { status: "not_found" };

export const DEFAULT_QUOTA_PLANS: Omit<QuotaPlan, "updated_at">[] = [
  {
    plan: "free",
    title: "Бесплатно",
    period: "week",
    period_tokens: 150_000,
    window_hours: 5,
    window_tokens: 50_000,
  },
  {
    plan: "pro",
    title: "Подписка",
    period: "month",
    period_tokens: 3_000_000,
    window_hours: 5,
    window_tokens: 300_000,
  },
  {
    plan: "unlimited",
    title: "Без лимита",
    period: "month",
    period_tokens: 0,
    window_hours: 5,
    window_tokens: 0,
  },
];

export interface AppRepository {
  upsertTelegramUser(input: {
    telegram_id: number;
    name: string;
    username?: string | null;
  }): Promise<User>;
  upsertOAuthUser(input: {
    auth_user_id: string;
    name: string;
    email?: string | null;
  }): Promise<User>;
  createGuestUser(input?: { name?: string }): Promise<User>;
  getUserByAuthUserId(authUserId: string): Promise<User | null>;
  linkAuthUser(
    ownerId: string,
    authUserId: string,
    email: string | null,
  ): Promise<LinkAuthUserResult>;
  linkTelegramUser(
    ownerId: string,
    input: { telegram_id: number; name: string; username?: string | null },
  ): Promise<LinkAuthUserResult>;
  deleteAccount(ownerId: string): Promise<boolean>;
  listNotes(ownerId: string): Promise<Note[]>;
  getNote(ownerId: string, id: string): Promise<Note | null>;
  listNoteRevisions(ownerId: string): Promise<NoteRevision[]>;
  mutateNote(
    ownerId: string,
    id: string,
    input: NoteMutation,
    tombstone?: boolean,
  ): Promise<NoteMutationResult>;
  createNoteAction(
    ownerId: string,
    input: Pick<NoteActionPreview, "note_id" | "note_revision" | "instruction" | "proposal">,
  ): Promise<NoteActionPreview>;
  listNoteActions(ownerId: string): Promise<NoteActionPreview[]>;
  getNoteAction(ownerId: string, id: string): Promise<NoteActionPreview | null>;
  confirmNoteAction(
    ownerId: string,
    id: string,
    proposal?: NoteActionProposal,
  ): Promise<NoteActionPreview | null>;
  listPeople(ownerId: string, search?: string): Promise<Person[]>;
  getPerson(ownerId: string, id: string): Promise<Person | null>;
  createPerson(ownerId: string, input: PersonInput): Promise<Person>;
  updatePerson(ownerId: string, id: string, input: Partial<PersonInput>): Promise<Person | null>;
  deletePerson(ownerId: string, id: string): Promise<boolean>;
  listLocations(ownerId: string, personId: string): Promise<PersonLocation[]>;
  createLocation(ownerId: string, personId: string, input: LocationInput): Promise<PersonLocation>;
  updateLocation(
    ownerId: string,
    id: string,
    input: Partial<LocationInput>,
  ): Promise<PersonLocation | null>;
  deleteLocation(ownerId: string, id: string): Promise<boolean>;
  listDates(ownerId: string, personId: string): Promise<PersonDate[]>;
  createDate(ownerId: string, personId: string, input: DateInput): Promise<PersonDate>;
  updateDate(ownerId: string, id: string, input: Partial<DateInput>): Promise<PersonDate | null>;
  deleteDate(ownerId: string, id: string): Promise<boolean>;
  listMemories(ownerId: string, personId: string): Promise<Memory[]>;
  createMemory(
    ownerId: string,
    personId: string,
    input: MemoryInput,
  ): Promise<{ memory: Memory; duplicate: boolean }>;
  updateMemory(ownerId: string, id: string, input: Partial<MemoryInput>): Promise<Memory | null>;
  deleteMemory(ownerId: string, id: string): Promise<boolean>;
  listSpaces(ownerId: string): Promise<Space[]>;
  getSpace(ownerId: string, id: string): Promise<Space | null>;
  createSpace(ownerId: string, input: SpaceInput): Promise<Space>;
  updateSpace(ownerId: string, id: string, input: Partial<SpaceInput>): Promise<Space | null>;
  setSpacePerson(
    ownerId: string,
    spaceId: string,
    personId: string,
    add: boolean,
  ): Promise<boolean>;
  listTasks(ownerId: string): Promise<Task[]>;
  createTask(ownerId: string, input: TaskInput): Promise<Task>;
  updateTask(ownerId: string, id: string, input: Partial<TaskInput>): Promise<Task | null>;
  resetStaleAiWork(now: Date, staleMs?: number): Promise<number>;
  hasFreshAiWorkLock(now: Date, staleMs?: number, ownerId?: string): Promise<boolean>;
  claimNextAiWork(now: Date, maxAttempts?: number): Promise<Task | null>;
  listRecommendations(ownerId: string): Promise<Recommendation[]>;
  getRecommendation(ownerId: string, id: string): Promise<Recommendation | null>;
  createRecommendation(ownerId: string, input: RecommendationInput): Promise<Recommendation>;
  claimTelegramUpdate(updateId: number): Promise<boolean>;
  createMessage(
    ownerId: string,
    input: Omit<Message, "id" | "owner_id" | "created_at">,
  ): Promise<Message | null>;
  deleteMessage(ownerId: string, id: string): Promise<boolean>;
  getUser(ownerId: string): Promise<User | null>;
  getProfile(ownerId: string): Promise<UserProfile | null>;
  updateProfile(ownerId: string, input: ProfileInput): Promise<UserProfile | null>;
  listNotificationProfiles(): Promise<UserProfile[]>;
  listReliabilityCohort(): Promise<
    {
      timezone: string;
      tasks: {
        status: Task["status"];
        due_at: string | null;
        assignee?: Task["assignee"] | null;
        completed_at?: string | null;
        updated_at?: string | null;
      }[];
    }[]
  >;
  getSelfPerson(ownerId: string): Promise<Person | null>;
  getPrimaryConversation(ownerId: string): Promise<Conversation>;
  updateConversationMode(ownerId: string, mode: Conversation["mode"]): Promise<Conversation>;
  listMessages(ownerId: string, conversationId: string, limit?: number): Promise<Message[]>;
  updateMessageIntent(ownerId: string, id: string, intent: Message["intent"]): Promise<void>;
  findMessageByTelegramId(
    ownerId: string,
    chatId: number,
    telegramMessageId: number,
  ): Promise<Message | null>;
  updateMessageTelegramId(
    ownerId: string,
    id: string,
    chatId: number,
    telegramMessageId: number,
  ): Promise<void>;
  listGoals(ownerId: string): Promise<Goal[]>;
  getGoal(ownerId: string, id: string): Promise<Goal | null>;
  createGoal(ownerId: string, input: GoalInput): Promise<Goal>;
  updateGoal(ownerId: string, id: string, input: Partial<GoalInput>): Promise<Goal | null>;
  deleteGoal(ownerId: string, id: string): Promise<boolean>;
  listPromises(ownerId: string): Promise<SelfPromise[]>;
  getPromise(ownerId: string, id: string): Promise<SelfPromise | null>;
  createPromise(ownerId: string, input: PromiseInput): Promise<SelfPromise>;
  updatePromise(
    ownerId: string,
    id: string,
    input: Partial<PromiseInput>,
  ): Promise<SelfPromise | null>;
  deletePromise(ownerId: string, id: string): Promise<boolean>;
  listPromiseCheckins(ownerId: string, promiseId?: string): Promise<SelfPromiseCheckin[]>;
  createPromiseCheckin(
    ownerId: string,
    promiseId: string,
    input: PromiseCheckinInput,
  ): Promise<SelfPromiseCheckin>;
  listProjects(ownerId: string): Promise<Project[]>;
  getProject(ownerId: string, id: string): Promise<Project | null>;
  createProject(ownerId: string, input: ProjectInput): Promise<Project>;
  updateProject(ownerId: string, id: string, input: Partial<ProjectInput>): Promise<Project | null>;
  deleteProject(ownerId: string, id: string): Promise<boolean>;
  createRecommendationFeedback(
    ownerId: string,
    recommendationId: string,
    input: Pick<RecommendationFeedback, "item_index" | "outcome" | "note">,
  ): Promise<RecommendationFeedback>;
  listRecommendationFeedback(ownerId: string, limit?: number): Promise<RecommendationFeedback[]>;
  createReflection(
    ownerId: string,
    input: Omit<Reflection, "id" | "owner_id" | "created_at">,
  ): Promise<Reflection>;
  listReflections(ownerId: string): Promise<Reflection[]>;
  createPendingAction(
    ownerId: string,
    input: Omit<PendingAction, "id" | "owner_id" | "created_at">,
  ): Promise<PendingAction>;
  consumePendingAction(ownerId: string, id: string): Promise<PendingAction | null>;
  findActivePendingAction(
    ownerId: string,
    telegramChatId: number,
    action?: string,
  ): Promise<PendingAction | null>;
  listExperiences(ownerId: string, personId?: string): Promise<Experience[]>;
  getExperience(ownerId: string, id: string): Promise<Experience | null>;
  createExperience(ownerId: string, input: ExperienceInput): Promise<Experience>;
  updateExperience(
    ownerId: string,
    id: string,
    input: Partial<ExperienceInput>,
  ): Promise<Experience | null>;
  deleteExperience(ownerId: string, id: string): Promise<boolean>;
  findDueExperienceFollowUps(at?: string, ownerId?: string): Promise<Experience[]>;
  linkExperienceMemory(
    ownerId: string,
    experienceId: string,
    memoryId: string,
    signal: "positive" | "negative",
  ): Promise<void>;
  trackBetaMetric(
    ownerId: string,
    name: BetaMetricName,
    properties?: Record<string, unknown>,
  ): Promise<void>;
  trackEvents(
    ownerId: string,
    events: { name: string; properties?: Record<string, unknown> }[],
  ): Promise<void>;
  replaceCalendarEvents(
    ownerId: string,
    input: { source: "ios"; from: string; to: string; events: CalendarEventInput[] },
  ): Promise<number>;
  listCalendarEvents(ownerId: string, from: string, to: string): Promise<CalendarEvent[]>;
  listDevices(ownerId: string): Promise<Device[]>;
  createAppLoginRequest(nonce: string): Promise<void>;
  approveAppLoginRequest(nonce: string, ownerId: string): Promise<boolean>;
  consumeAppLoginRequest(nonce: string): Promise<AppLoginPoll>;
  upsertDevice(ownerId: string, input: DeviceInput): Promise<Device>;
  deleteDevice(ownerId: string, pushToken: string): Promise<void>;
  incrementUsage(
    ownerId: string,
    input: {
      metric: string;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    },
    at?: Date,
  ): Promise<UsageCounter>;
  listUsageCounters(ownerId: string, from: string, to: string): Promise<UsageCounter[]>;
  listUsageHours(ownerId: string, since: string): Promise<UsageHour[]>;
  listQuotaPlans(): Promise<QuotaPlan[]>;
  updateQuotaPlan(
    plan: string,
    input: Partial<Pick<QuotaPlan, "period" | "period_tokens" | "window_hours" | "window_tokens">>,
  ): Promise<QuotaPlan | null>;
  getQuotaEnforced(): Promise<boolean>;
  setQuotaEnforced(enforced: boolean): Promise<void>;
  getUserPlan(ownerId: string): Promise<UserPlan | null>;
  setUserPlan(ownerId: string, plan: string, until: string | null): Promise<UserPlan>;
  isAdmin(ownerId: string): Promise<boolean>;
  claimFirstAdmin(ownerId: string): Promise<boolean>;
  findUserByHandle(handle: string): Promise<User | null>;
  createImportSession(
    ownerId: string,
    input: { source: ImportSource; items: ImportItem[]; access_token?: string | null },
  ): Promise<ImportSession>;
  getImportSession(ownerId: string, id: string): Promise<ImportSession | null>;
  updateImportSession(
    ownerId: string,
    id: string,
    input: Partial<
      Pick<ImportSession, "status" | "items" | "access_token" | "log" | "confirmed_at">
    >,
  ): Promise<ImportSession | null>;
  listMailAccounts(ownerId: string): Promise<MailAccountPublic[]>;
  getMailAccountSecret(ownerId: string, id: string): Promise<MailAccount | null>;
  listMailAccountsDueForSync(): Promise<MailAccount[]>;
  createMailAccount(ownerId: string, input: MailAccountInput): Promise<MailAccount>;
  updateMailAccount(
    ownerId: string,
    id: string,
    input: Partial<
      Omit<MailAccountInput, "email" | "secret_cipher"> & Pick<MailAccount, "secret_cipher">
    >,
  ): Promise<MailAccount | null>;
  deleteMailAccount(ownerId: string, id: string): Promise<boolean>;
  listMailMessages(ownerId: string, limit?: number): Promise<MailMessage[]>;
  getMailMessage(ownerId: string, id: string): Promise<MailMessage | null>;
  upsertMailMessage(ownerId: string, input: MailMessageInput): Promise<MailMessage>;
  updateMailMessage(
    ownerId: string,
    id: string,
    input: Partial<Pick<MailMessage, "handled" | "is_important" | "is_meeting" | "meeting_at">>,
  ): Promise<MailMessage | null>;
  listMailDrafts(ownerId: string): Promise<MailDraft[]>;
  getMailDraft(ownerId: string, id: string): Promise<MailDraft | null>;
  createMailDraft(ownerId: string, input: MailDraftInput): Promise<MailDraft>;
  updateMailDraft(
    ownerId: string,
    id: string,
    input: Partial<MailDraftInput>,
  ): Promise<MailDraft | null>;
  deleteMailDraft(ownerId: string, id: string): Promise<boolean>;
  listMailPlaybooks(ownerId: string): Promise<MailPlaybook[]>;
  createMailPlaybook(ownerId: string, input: MailPlaybookInput): Promise<MailPlaybook>;
  updateMailPlaybook(
    ownerId: string,
    id: string,
    input: Partial<MailPlaybookInput>,
  ): Promise<MailPlaybook | null>;
  deleteMailPlaybook(ownerId: string, id: string): Promise<boolean>;
  /** Справочник «чем заняться» — категории и активные типы. */
  listActivityCatalog(): Promise<ActivityCatalog>;
  /** Видимые места; с typeIds — только подходящие под эти типы. Лучшие по рейтингу — первыми. */
  listPlaces(filter: {
    typeIds?: string[];
    city?: string | null;
    limit?: number;
  }): Promise<Place[]>;
  listPlaceVisits(ownerId: string): Promise<PlaceVisit[]>;
  /** Запись дневника; для места из справочника — одна строка на место, повтор её обновляет. */
  savePlaceVisit(ownerId: string, input: PlaceVisitInput): Promise<PlaceVisit>;
  deletePlaceVisit(ownerId: string, id: string): Promise<boolean>;
  /** Вращения колеса за местный день, по порядку. */
  listActivitySpins(ownerId: string, localDate: string): Promise<ActivitySpin[]>;
  createActivitySpin(ownerId: string, input: ActivitySpinInput): Promise<ActivitySpin>;
  listActivityPreferences(ownerId: string): Promise<ActivityPreference[]>;
  /** Меняет только переданные поля; строки нет — создаёт с нулями. */
  patchActivityPreference(
    ownerId: string,
    patch: ActivityPreferencePatch,
  ): Promise<ActivityPreference>;
  /** Новые гипотезы нейросети целиком заменяют прежние; вердикты и оценки не трогает. */
  replaceAiPreferences(
    ownerId: string,
    rows: Pick<ActivityPreference, "target_kind" | "target_id" | "ai_affinity" | "ai_reason">[],
  ): Promise<void>;
  getTasteProfile(ownerId: string): Promise<ActivityTasteProfile | null>;
  saveTasteProfile(
    ownerId: string,
    input: Pick<ActivityTasteProfile, "summary" | "refreshed_at">,
  ): Promise<ActivityTasteProfile>;
  /** Место из внешнего поиска — по (source, source_id); тип добавляется к уже имеющимся. */
  upsertPlace(input: PlaceUpsertInput, activityTypeId: string | null): Promise<Place>;
}

const sameCity = (a: string | null | undefined, b: string | null | undefined) =>
  !b || (a ?? "").trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
const byRating = (a: Place, b: Place) =>
  (b.yandex_rating ?? -1) - (a.yandex_rating ?? -1) || a.name.localeCompare(b.name);

const now = () => new Date().toISOString();

export const APP_LOGIN_TTL_MS = 10 * 60_000;
export type AppLoginPoll =
  { status: "pending" } | { status: "expired" } | { status: "approved"; owner_id: string };
export interface DeviceInput {
  platform: "ios";
  push_token: string;
  environment: "sandbox" | "production";
  app_version?: string | null;
}
export interface Device extends DeviceInput {
  id: string;
  owner_id: string;
  app_version: string | null;
  created_at: string;
  updated_at: string;
}
interface AppLoginRow {
  nonce: string;
  owner_id: string | null;
  created_at: string;
  approved_at: string | null;
  consumed_at: string | null;
}
function appLoginExpired(row: Pick<AppLoginRow, "created_at">, at = Date.now()) {
  return at - Date.parse(row.created_at) > APP_LOGIN_TTL_MS;
}
const norm = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
const PERSON_LOCATION_MAX = 10;
const normalizeDateInput = (input: DateInput): DateInput => {
  const month = input.month;
  const day = input.day;
  const year = input.year ?? null;
  if (!isValidCalendarDay(month, day, year))
    throw Object.assign(new Error("Invalid date"), { status: 400, code: "INVALID_DATE" });
  if (input.kind === "other" && !blankToNull(input.label))
    throw Object.assign(new Error("Label required"), { status: 400, code: "INVALID_DATE" });
  return {
    kind: input.kind,
    label: blankToNull(input.label),
    month,
    day,
    year,
  };
};
const sortLocations = (locations: PersonLocation[]) =>
  [...locations].sort(
    (a, b) =>
      Number(b.is_primary) - Number(a.is_primary) || a.created_at.localeCompare(b.created_at),
  );
const blankToNull = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};
const publicMailAccount = (account: MailAccount): MailAccountPublic => {
  return Object.fromEntries(
    Object.entries(account).filter(([key]) => key !== "secret_cipher"),
  ) as MailAccountPublic;
};

export class InMemoryRepository implements AppRepository {
  users: User[] = [];
  appLogins: AppLoginRow[] = [];
  calendarEvents: CalendarEvent[] = [];
  devices: Device[] = [];
  activityCatalog: ActivityCatalog = { categories: [], types: [] };
  places: Place[] = [];
  placeVisits: PlaceVisit[] = [];
  activitySpins: ActivitySpin[] = [];
  activityPreferences: ActivityPreference[] = [];
  tasteProfiles: ActivityTasteProfile[] = [];
  people: Person[] = [];
  personLocations: PersonLocation[] = [];
  personDates: PersonDate[] = [];
  memories: Memory[] = [];
  spaces: Space[] = [];
  tasks: Task[] = [];
  recommendations: Recommendation[] = [];
  messages: Message[] = [];
  conversations: Conversation[] = [];
  profiles: UserProfile[] = [];
  goals: Goal[] = [];
  promises: SelfPromise[] = [];
  promiseCheckins: SelfPromiseCheckin[] = [];
  projects: Project[] = [];
  feedback: RecommendationFeedback[] = [];
  reflections: Reflection[] = [];
  pendingActions: PendingAction[] = [];
  experiences: Experience[] = [];
  mailAccounts: MailAccount[] = [];
  mailMessages: MailMessage[] = [];
  mailDrafts: MailDraft[] = [];
  mailPlaybooks: MailPlaybook[] = [];
  notes: Note[] = [];
  noteRevisions: NoteRevision[] = [];
  noteActions: NoteActionPreview[] = [];
  importSessions: ImportSession[] = [];
  usageCounters: UsageCounter[] = [];
  private noteActionConfirmations = new Map<string, Promise<NoteActionPreview | null>>();
  experienceMemoryLinks: {
    experience_id: string;
    memory_id: string;
    signal: "positive" | "negative";
  }[] = [];
  betaMetrics: {
    owner_id: string;
    name: string;
    properties: Record<string, unknown>;
    created_at: string;
  }[] = [];
  updateIds = new Set<number>();
  async upsertTelegramUser(input: { telegram_id: number; name: string; username?: string | null }) {
    const existing = this.users.find((x) => x.telegram_id === input.telegram_id);
    if (existing) {
      existing.name = input.name;
      existing.username = input.username ?? null;
      await this.provisionUser(existing);
      const self = this.people.find((person) => person.owner_id === existing.id && person.is_self);
      if (self) self.name = input.name;
      return existing;
    }
    const user: User = {
      id: randomUUID(),
      telegram_id: input.telegram_id,
      name: input.name,
      username: input.username ?? null,
      auth_user_id: null,
      email: null,
      created_at: now(),
    };
    this.users.push(user);
    await this.provisionUser(user);
    return user;
  }
  async upsertOAuthUser(input: { auth_user_id: string; name: string; email?: string | null }) {
    const existing = await this.getUserByAuthUserId(input.auth_user_id);
    if (existing) {
      existing.name = input.name || existing.name;
      existing.email = input.email?.trim().toLowerCase() ?? existing.email;
      await this.provisionUser(existing);
      return existing;
    }
    const user: User = {
      id: randomUUID(),
      telegram_id: null,
      name: input.name,
      username: null,
      auth_user_id: input.auth_user_id,
      email: input.email?.trim().toLowerCase() ?? null,
      created_at: now(),
    };
    this.users.push(user);
    await this.provisionUser(user);
    return user;
  }
  async createGuestUser(input: { name?: string } = {}) {
    const user: User = {
      id: randomUUID(),
      telegram_id: null,
      name: input.name?.trim() || "Гость",
      username: null,
      auth_user_id: null,
      email: null,
      is_guest: true,
      created_at: now(),
    };
    this.users.push(user);
    await this.provisionUser(user);
    return user;
  }
  async getUserByAuthUserId(authUserId: string) {
    return this.users.find((user) => user.auth_user_id === authUserId) ?? null;
  }
  async linkAuthUser(ownerId: string, authUserId: string, email: string | null) {
    const user = await this.getUser(ownerId);
    if (!user) return { status: "not_found" } as const;
    if (user.auth_user_id && user.auth_user_id !== authUserId)
      return { status: "owner_conflict" } as const;
    const linked = await this.getUserByAuthUserId(authUserId);
    if (linked && linked.id !== ownerId) return { status: "auth_conflict" } as const;
    user.auth_user_id = authUserId;
    user.email = email?.trim().toLowerCase() ?? null;
    user.is_guest = false;
    return { status: "linked", user } as const;
  }
  async linkTelegramUser(
    ownerId: string,
    input: { telegram_id: number; name: string; username?: string | null },
  ) {
    const user = await this.getUser(ownerId);
    if (!user) return { status: "not_found" } as const;
    if (user.telegram_id && user.telegram_id !== input.telegram_id)
      return { status: "owner_conflict" } as const;
    const taken = this.users.find(
      (item) => item.telegram_id === input.telegram_id && item.id !== ownerId,
    );
    if (taken) return { status: "auth_conflict" } as const;
    user.telegram_id = input.telegram_id;
    user.name = input.name || user.name;
    user.username = input.username ?? user.username;
    user.is_guest = false;
    return { status: "linked", user } as const;
  }
  private async provisionUser(user: User) {
    let self = this.people.find((p) => p.owner_id === user.id && p.is_self);
    if (!self)
      self = await this.createPerson(user.id, { name: user.name, relationship: "self" }, true);
    const hasTelegram = user.telegram_id != null;
    if (!this.profiles.some((p) => p.owner_id === user.id))
      this.profiles.push({
        owner_id: user.id,
        self_person_id: self.id,
        bio: null,
        values: [],
        communication_style: null,
        timezone: hasTelegram ? "Europe/Moscow" : "UTC",
        locale: "ru",
        context_summary: null,
        weekly_reflection_enabled: false,
        // Утренняя сводка — всем по умолчанию (как в миграции 035).
        morning_digest_enabled: true,
        morning_digest_time: "08:00",
        weekly_digest_enabled: false,
        weekly_digest_time: "09:00",
        evening_sync_enabled: hasTelegram,
        evening_sync_time: "21:00",
        last_morning_digest_on: null,
        last_weekly_digest_on: null,
        last_evening_sync_on: null,
        last_goal_checkin_on: null,
        onboarding_completed_at: null,
        last_active_at: null,
        last_reengagement_at: null,
        reengagement_enabled: true,
        updated_at: now(),
      });
    await this.getPrimaryConversation(user.id);
  }
  async deleteAccount(ownerId: string) {
    const exists = this.users.some((user) => user.id === ownerId);
    if (!exists) return false;
    const personIds = new Set(
      this.people.filter((person) => person.owner_id === ownerId).map((person) => person.id),
    );
    this.users = this.users.filter((user) => user.id !== ownerId);
    this.people = this.people.filter((person) => person.owner_id !== ownerId);
    this.personLocations = this.personLocations.filter(
      (location) => !personIds.has(location.person_id),
    );
    this.personDates = this.personDates.filter((date) => !personIds.has(date.person_id));
    this.memories = this.memories.filter((memory) => !personIds.has(memory.person_id));
    this.spaces = this.spaces.filter((space) => space.owner_id !== ownerId);
    this.tasks = this.tasks.filter((task) => task.owner_id !== ownerId);
    this.recommendations = this.recommendations.filter((item) => item.owner_id !== ownerId);
    this.messages = this.messages.filter((message) => message.owner_id !== ownerId);
    this.conversations = this.conversations.filter((x) => x.owner_id !== ownerId);
    this.profiles = this.profiles.filter((x) => x.owner_id !== ownerId);
    this.goals = this.goals.filter((x) => x.owner_id !== ownerId);
    this.promises = this.promises.filter((x) => x.owner_id !== ownerId);
    this.promiseCheckins = this.promiseCheckins.filter((x) => x.owner_id !== ownerId);
    this.projects = this.projects.filter((x) => x.owner_id !== ownerId);
    this.feedback = this.feedback.filter((x) => x.owner_id !== ownerId);
    this.reflections = this.reflections.filter((x) => x.owner_id !== ownerId);
    this.pendingActions = this.pendingActions.filter((x) => x.owner_id !== ownerId);
    this.experiences = this.experiences.filter((x) => x.owner_id !== ownerId);
    this.mailAccounts = this.mailAccounts.filter((x) => x.owner_id !== ownerId);
    this.mailMessages = this.mailMessages.filter((x) => x.owner_id !== ownerId);
    this.mailDrafts = this.mailDrafts.filter((x) => x.owner_id !== ownerId);
    this.mailPlaybooks = this.mailPlaybooks.filter((x) => x.owner_id !== ownerId);
    this.notes = this.notes.filter((x) => x.owner_id !== ownerId);
    this.noteRevisions = this.noteRevisions.filter((x) => x.owner_id !== ownerId);
    this.noteActions = this.noteActions.filter((x) => x.owner_id !== ownerId);
    this.importSessions = this.importSessions.filter((x) => x.owner_id !== ownerId);
    return true;
  }
  async listNotes(ownerId: string) {
    return this.notes
      .filter((note) => note.owner_id === ownerId)
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  }
  async getNote(ownerId: string, id: string) {
    return this.notes.find((note) => note.owner_id === ownerId && note.id === id) ?? null;
  }
  async listNoteRevisions(ownerId: string) {
    return this.noteRevisions.filter((revision) => revision.owner_id === ownerId);
  }
  async mutateNote(ownerId: string, id: string, input: NoteMutation, tombstone = false) {
    const repeated = this.noteRevisions.find(
      (revision) =>
        revision.owner_id === ownerId &&
        revision.note_id === id &&
        revision.client_mutation_id === input.client_mutation_id,
    );
    const anyCurrent = this.notes.find((note) => note.id === id);
    if (anyCurrent && anyCurrent.owner_id !== ownerId) return { status: "not_found" as const };
    const current = anyCurrent ?? null;
    if (repeated && current) {
      return {
        status: "ok" as const,
        note: {
          ...current,
          title: repeated.title,
          content: repeated.content,
          plain_text: repeated.plain_text,
          revision: repeated.revision,
          deleted_at: repeated.deleted_at,
          updated_at: repeated.created_at,
        },
      };
    }
    if (!current) {
      if (input.base_revision !== 0 || tombstone) return { status: "not_found" as const };
    } else if (current.revision !== input.base_revision) {
      return { status: "conflict" as const, note: { ...current } };
    }
    const timestamp = now();
    const note: Note = current ?? {
      id,
      owner_id: ownerId,
      title: input.title,
      content: input.content,
      plain_text: input.plain_text,
      revision: 1,
      deleted_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    if (current) {
      note.title = tombstone ? note.title : input.title;
      note.content = tombstone ? note.content : input.content;
      note.plain_text = tombstone ? note.plain_text : input.plain_text;
      note.revision += 1;
      note.deleted_at = tombstone ? timestamp : null;
      note.updated_at = timestamp;
    } else {
      this.notes.push(note);
    }
    this.noteRevisions.push({
      id: randomUUID(),
      note_id: id,
      owner_id: ownerId,
      revision: note.revision,
      title: note.title,
      content: note.content,
      plain_text: note.plain_text,
      deleted_at: note.deleted_at,
      client_mutation_id: input.client_mutation_id,
      created_at: timestamp,
    });
    return { status: "ok" as const, note: { ...note } };
  }
  async createNoteAction(
    ownerId: string,
    input: Pick<NoteActionPreview, "note_id" | "note_revision" | "instruction" | "proposal">,
  ) {
    const action: NoteActionPreview = {
      id: randomUUID(),
      owner_id: ownerId,
      ...input,
      status: "pending",
      confirmed_at: null,
      result: null,
      created_at: now(),
    };
    this.noteActions.push(action);
    return action;
  }
  async listNoteActions(ownerId: string) {
    return this.noteActions.filter((action) => action.owner_id === ownerId);
  }
  async getNoteAction(ownerId: string, id: string) {
    return (
      this.noteActions.find((action) => action.owner_id === ownerId && action.id === id) ?? null
    );
  }
  confirmNoteAction(ownerId: string, id: string, proposal?: NoteActionProposal) {
    const key = `${ownerId}:${id}`;
    const active = this.noteActionConfirmations.get(key);
    if (active) return active;
    const confirmation = this.performNoteActionConfirmation(ownerId, id, proposal).finally(() => {
      this.noteActionConfirmations.delete(key);
    });
    this.noteActionConfirmations.set(key, confirmation);
    return confirmation;
  }
  private async performNoteActionConfirmation(
    ownerId: string,
    id: string,
    editedProposal?: NoteActionProposal,
  ) {
    const action = await this.getNoteAction(ownerId, id);
    if (!action) return null;
    if (action.status === "confirmed") return action;
    const proposal: NoteActionProposal = editedProposal ?? action.proposal;
    action.proposal = proposal;
    let result: Record<string, unknown>;
    if (proposal.kind === "goal") {
      const goal = await this.createGoal(ownerId, {
        ...proposal.goal,
        source_note_id: action.note_id,
      });
      result = { goal_id: goal.id };
    } else if (proposal.kind === "tasks") {
      const tasks = await Promise.all(
        proposal.tasks.map((task) =>
          this.createTask(ownerId, { ...task, source_note_id: action.note_id }),
        ),
      );
      result = { task_ids: tasks.map((task) => task.id) };
    } else {
      const goal = await this.createGoal(ownerId, {
        title: proposal.title,
        description: proposal.description,
        current_plan: proposal.current_plan,
        plan_revised_at: now(),
        source_note_id: action.note_id,
      });
      const tasks = await Promise.all(
        proposal.tasks.map((task) =>
          this.createTask(ownerId, {
            ...task,
            goal_id: goal.id,
            source_note_id: action.note_id,
          }),
        ),
      );
      result = { goal_id: goal.id, task_ids: tasks.map((task) => task.id) };
    }
    action.status = "confirmed";
    action.confirmed_at = now();
    action.result = result;
    return action;
  }
  async listPeople(ownerId: string, search?: string) {
    const q = search && norm(search);
    return this.people
      .filter(
        (p) =>
          p.owner_id === ownerId &&
          (!q ||
            [p.name, p.relationship ?? "", ...p.aliases].some((x) => norm(x).includes(q)) ||
            this.locationsOf(p.id).some(
              (location) =>
                norm(location.city).includes(q) ||
                norm(location.address ?? "").includes(q) ||
                norm(location.label ?? "").includes(q),
            ) ||
            this.datesOf(p.id).some(
              (date) => norm(date.label ?? "").includes(q) || norm(date.kind).includes(q),
            )),
      )
      .map((person) => this.withPersonExtras(person));
  }
  async getPerson(ownerId: string, id: string) {
    const person = this.people.find((p) => p.owner_id === ownerId && p.id === id);
    return person ? this.withPersonExtras(person) : null;
  }
  async createPerson(ownerId: string, input: PersonInput, isSelf = false) {
    const person: Person = {
      id: randomUUID(),
      owner_id: ownerId,
      name: input.name,
      relationship: input.relationship ?? null,
      description: input.description ?? null,
      aliases: input.aliases ?? [],
      is_self: isSelf,
      created_at: now(),
      updated_at: now(),
    };
    this.people.push(person);
    return this.withPersonExtras(person);
  }
  async updatePerson(ownerId: string, id: string, input: Partial<PersonInput>) {
    const person = this.people.find((p) => p.owner_id === ownerId && p.id === id);
    if (!person) return null;
    Object.assign(person, input, { updated_at: now() });
    return this.withPersonExtras(person);
  }
  async deletePerson(ownerId: string, id: string) {
    const i = this.people.findIndex((p) => p.owner_id === ownerId && p.id === id);
    if (i < 0) return false;
    this.people.splice(i, 1);
    this.personLocations = this.personLocations.filter((location) => location.person_id !== id);
    this.personDates = this.personDates.filter((date) => date.person_id !== id);
    return true;
  }
  private locationsOf(personId: string) {
    return sortLocations(this.personLocations.filter((item) => item.person_id === personId));
  }
  private datesOf(personId: string) {
    return sortPersonDates(this.personDates.filter((item) => item.person_id === personId));
  }
  private withPersonExtras(person: Person): Person {
    return { ...person, locations: this.locationsOf(person.id), dates: this.datesOf(person.id) };
  }
  async listLocations(ownerId: string, personId: string) {
    return (await this.getPerson(ownerId, personId)) ? this.locationsOf(personId) : [];
  }
  private async ownedLocation(ownerId: string, id: string) {
    const location = this.personLocations.find((item) => item.id === id);
    return location && (await this.getPerson(ownerId, location.person_id)) ? location : null;
  }
  private setPrimaryFor(personId: string, locationId: string) {
    for (const item of this.personLocations) {
      if (item.person_id === personId) item.is_primary = item.id === locationId;
    }
  }
  async createLocation(ownerId: string, personId: string, input: LocationInput) {
    if (!(await this.getPerson(ownerId, personId)))
      throw Object.assign(new Error("Person not found"), { status: 404 });
    const existing = this.locationsOf(personId);
    if (existing.length >= PERSON_LOCATION_MAX)
      throw Object.assign(new Error("Too many locations"), {
        status: 400,
        code: "TOO_MANY_LOCATIONS",
      });
    const location: PersonLocation = {
      id: randomUUID(),
      person_id: personId,
      label: blankToNull(input.label),
      city: input.city.trim(),
      address: blankToNull(input.address),
      is_primary: input.is_primary ?? existing.length === 0,
      created_at: now(),
      updated_at: now(),
    };
    this.personLocations.push(location);
    if (location.is_primary) this.setPrimaryFor(personId, location.id);
    return this.locationsOf(personId).find((item) => item.id === location.id)!;
  }
  async updateLocation(ownerId: string, id: string, input: Partial<LocationInput>) {
    const location = await this.ownedLocation(ownerId, id);
    if (!location) return null;
    if (input.label !== undefined) location.label = blankToNull(input.label);
    if (input.city !== undefined) location.city = input.city.trim();
    if (input.address !== undefined) location.address = blankToNull(input.address);
    location.updated_at = now();
    if (input.is_primary === true) this.setPrimaryFor(location.person_id, location.id);
    else if (input.is_primary === false) location.is_primary = false;
    return { ...location };
  }
  async deleteLocation(ownerId: string, id: string) {
    const location = await this.ownedLocation(ownerId, id);
    if (!location) return false;
    this.personLocations = this.personLocations.filter((item) => item.id !== id);
    if (location.is_primary) {
      const next = this.locationsOf(location.person_id)[0];
      if (next) next.is_primary = true;
    }
    return true;
  }
  async listDates(ownerId: string, personId: string) {
    return (await this.getPerson(ownerId, personId)) ? this.datesOf(personId) : [];
  }
  private async ownedDate(ownerId: string, id: string) {
    const date = this.personDates.find((item) => item.id === id);
    return date && (await this.getPerson(ownerId, date.person_id)) ? date : null;
  }
  async createDate(ownerId: string, personId: string, input: DateInput) {
    if (!(await this.getPerson(ownerId, personId)))
      throw Object.assign(new Error("Person not found"), { status: 404 });
    const values = normalizeDateInput(input);
    if (isUniquePersonDateKind(values.kind)) {
      const existing = this.datesOf(personId).find((item) => item.kind === values.kind);
      if (existing) {
        const updated = await this.updateDate(ownerId, existing.id, values);
        if (!updated) throw Object.assign(new Error("Date not found"), { status: 404 });
        return updated;
      }
    }
    const current = this.datesOf(personId);
    if (current.length >= PERSON_DATE_MAX)
      throw Object.assign(new Error("Too many dates"), { status: 400, code: "TOO_MANY_DATES" });
    const date: PersonDate = {
      id: randomUUID(),
      person_id: personId,
      kind: values.kind,
      label: values.label ?? null,
      month: values.month,
      day: values.day,
      year: values.year ?? null,
      created_at: now(),
      updated_at: now(),
    };
    this.personDates.push(date);
    return this.datesOf(personId).find((item) => item.id === date.id)!;
  }
  async updateDate(ownerId: string, id: string, input: Partial<DateInput>) {
    const date = await this.ownedDate(ownerId, id);
    if (!date) return null;
    const next = normalizeDateInput({
      kind: input.kind ?? date.kind,
      label: input.label !== undefined ? input.label : date.label,
      month: input.month ?? date.month,
      day: input.day ?? date.day,
      year: input.year !== undefined ? input.year : date.year,
    });
    if (isUniquePersonDateKind(next.kind)) {
      const clash = this.datesOf(date.person_id).find(
        (item) => item.kind === next.kind && item.id !== date.id,
      );
      if (clash)
        throw Object.assign(new Error("Date already exists"), {
          status: 409,
          code: "ALREADY_EXISTS",
        });
    }
    Object.assign(date, next, { updated_at: now() });
    return { ...date };
  }
  async deleteDate(ownerId: string, id: string) {
    const date = await this.ownedDate(ownerId, id);
    if (!date) return false;
    this.personDates = this.personDates.filter((item) => item.id !== id);
    return true;
  }
  async listMemories(ownerId: string, personId: string) {
    return (await this.getPerson(ownerId, personId))
      ? this.memories.filter((m) => m.person_id === personId)
      : [];
  }
  async createMemory(ownerId: string, personId: string, input: MemoryInput) {
    if (!(await this.getPerson(ownerId, personId)))
      throw Object.assign(new Error("Person not found"), { status: 404 });
    const duplicate = this.memories.find(
      (m) =>
        m.person_id === personId &&
        m.category === input.category &&
        norm(m.content) === norm(input.content),
    );
    if (duplicate) return { memory: duplicate, duplicate: true };
    const memory: Memory = {
      id: randomUUID(),
      person_id: personId,
      content: input.content,
      category: input.category,
      importance: input.importance ?? 3,
      confidence: input.confidence ?? 1,
      source_message_id: input.source_message_id ?? null,
      occurred_at: input.occurred_at ?? null,
      metadata: input.metadata ?? {},
      status: input.status ?? "active",
      created_at: now(),
      updated_at: now(),
    };
    this.memories.push(memory);
    return { memory, duplicate: false };
  }
  private async ownedMemory(ownerId: string, id: string) {
    const m = this.memories.find((x) => x.id === id);
    return m && (await this.getPerson(ownerId, m.person_id)) ? m : null;
  }
  async updateMemory(ownerId: string, id: string, input: Partial<MemoryInput>) {
    const m = await this.ownedMemory(ownerId, id);
    if (!m) return null;
    Object.assign(m, input, { updated_at: now() });
    return m;
  }
  async deleteMemory(ownerId: string, id: string) {
    const m = await this.ownedMemory(ownerId, id);
    if (!m) return false;
    this.memories.splice(this.memories.indexOf(m), 1);
    return true;
  }
  async listSpaces(ownerId: string) {
    return this.spaces.filter((x) => x.owner_id === ownerId);
  }
  async getSpace(ownerId: string, id: string) {
    const space = this.spaces.find((x) => x.owner_id === ownerId && x.id === id);
    if (!space) return null;
    return {
      ...space,
      people: this.people.filter((person) => space.person_ids.includes(person.id)),
      tasks: this.tasks.filter((task) => task.owner_id === ownerId && task.space_id === id),
    };
  }
  async createSpace(ownerId: string, input: SpaceInput) {
    const s: Space = {
      id: randomUUID(),
      owner_id: ownerId,
      name: input.name,
      type: input.type ?? "other",
      context: input.context ?? null,
      person_ids: input.person_ids ?? [],
      created_at: now(),
      updated_at: now(),
    };
    this.spaces.push(s);
    return s;
  }
  async updateSpace(ownerId: string, id: string, input: Partial<SpaceInput>) {
    const s = await this.getSpace(ownerId, id);
    if (!s) return null;
    Object.assign(s, input, { updated_at: now() });
    return s;
  }
  async setSpacePerson(ownerId: string, spaceId: string, personId: string, add: boolean) {
    const s = await this.getSpace(ownerId, spaceId);
    if (!s || !(await this.getPerson(ownerId, personId))) return false;
    s.person_ids = add
      ? [...new Set([...s.person_ids, personId])]
      : s.person_ids.filter((id) => id !== personId);
    return true;
  }
  async listTasks(ownerId: string) {
    return this.tasks
      .filter((x) => x.owner_id === ownerId)
      .map((task) => ({
        ...task,
        person: this.people.find((person) => person.id === task.person_id)
          ? {
              id: task.person_id!,
              name: this.people.find((person) => person.id === task.person_id)!.name,
            }
          : null,
        space: this.spaces.find((space) => space.id === task.space_id)
          ? {
              id: task.space_id!,
              name: this.spaces.find((space) => space.id === task.space_id)!.name,
            }
          : null,
        goal: this.goals.find((goal) => goal.id === task.goal_id)
          ? { id: task.goal_id!, title: this.goals.find((goal) => goal.id === task.goal_id)!.title }
          : null,
        project: this.projects.find((project) => project.id === task.project_id)
          ? {
              id: task.project_id!,
              name: this.projects.find((project) => project.id === task.project_id)!.name,
            }
          : null,
      }));
  }
  private async assertOwnedLinks(
    ownerId: string,
    input: Pick<Partial<TaskInput>, "person_id" | "space_id" | "goal_id" | "project_id">,
  ) {
    if (input.person_id && !(await this.getPerson(ownerId, input.person_id)))
      throw Object.assign(new Error("Person not found"), { status: 400 });
    if (input.space_id && !(await this.getSpace(ownerId, input.space_id)))
      throw Object.assign(new Error("Space not found"), { status: 400 });
    if (input.goal_id && !(await this.getGoal(ownerId, input.goal_id)))
      throw Object.assign(new Error("Goal not found"), { status: 400 });
    if (input.project_id && !(await this.getProject(ownerId, input.project_id)))
      throw Object.assign(new Error("Project not found"), { status: 400 });
  }
  async createTask(ownerId: string, input: TaskInput) {
    await this.assertOwnedLinks(ownerId, input);
    if (input.id) {
      const existing = this.tasks.find((task) => task.id === input.id);
      if (existing) {
        if (existing.owner_id !== ownerId)
          throw Object.assign(new Error("Task already exists"), {
            status: 409,
            code: "ALREADY_EXISTS",
          });
        return existing;
      }
    }
    const recurrence = recurrenceFields(input);
    const t: Task = {
      id: input.id ?? randomUUID(),
      owner_id: ownerId,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "todo",
      person_id: input.person_id ?? null,
      space_id: input.space_id ?? null,
      goal_id: input.goal_id ?? null,
      project_id: input.project_id ?? null,
      source_note_id: input.source_note_id ?? null,
      due_at: input.due_at ?? null,
      completed_at: input.completed_at ?? null,
      sort_order: input.sort_order ?? null,
      kind: input.kind ?? "task",
      activity_type: input.activity_type ?? null,
      value_score: input.value_score ?? null,
      estimate_minutes: input.estimate_minutes ?? null,
      importance: input.importance ?? 3,
      urgency: input.urgency ?? 3,
      assignee: input.assignee ?? "user",
      agent_locked_at: input.agent_locked_at ?? null,
      agent_attempts: input.agent_attempts ?? 0,
      agent_result: input.agent_result ?? null,
      ...recurrence,
      created_at: now(),
      updated_at: now(),
    };
    this.tasks.push(t);
    return t;
  }
  async updateTask(ownerId: string, id: string, input: Partial<TaskInput>) {
    const t = this.tasks.find((x) => x.owner_id === ownerId && x.id === id);
    if (!t) return null;
    const wasDone = t.status === "done";
    const fields = seriesUpdateFields(t, { ...input });
    delete fields.id;
    delete fields.recurrence_scope;
    if (fields.recurrence_frequency && !t.recurrence_series_id) {
      Object.assign(fields, recurrenceFields({ ...t, ...fields }));
    }
    await this.assertOwnedLinks(ownerId, fields);
    Object.assign(t, fields, { updated_at: now() });
    if (!wasDone && t.status === "done") {
      const profile = await this.getProfile(ownerId);
      const next = nextRecurringInput(t, profile?.timezone || "UTC");
      if (
        next &&
        !this.tasks.some(
          (item) =>
            item.recurrence_series_id === next.recurrence_series_id &&
            item.recurrence_anchor_at === next.recurrence_anchor_at,
        )
      ) {
        await this.createTask(ownerId, next);
      }
    }
    return t;
  }
  async resetStaleAiWork(at = new Date(), staleMs = AI_WORK_STALE_MS) {
    let count = 0;
    for (const task of this.tasks) {
      if (!isStaleAiLock(task, at, staleMs)) continue;
      task.status = "todo";
      task.agent_locked_at = null;
      task.updated_at = at.toISOString();
      count += 1;
    }
    return count;
  }
  async hasFreshAiWorkLock(at = new Date(), staleMs = AI_WORK_STALE_MS, ownerId?: string) {
    return this.tasks.some(
      (task) => (!ownerId || task.owner_id === ownerId) && isFreshAiLock(task, at, staleMs),
    );
  }
  async claimNextAiWork(at = new Date(), maxAttempts = AI_WORK_MAX_ATTEMPTS) {
    await this.resetStaleAiWork(at);
    // Очередь «Поручить Ealzy» сериализуется по владельцу, а не по всей базе:
    // раньше одна зависшая задача любого пользователя останавливала делегирование
    // у всех остальных, и на полусотне платящих функция переставала работать.
    const busy = new Set(
      this.tasks
        .filter((task) => isFreshAiLock(task, at, AI_WORK_STALE_MS))
        .map((task) => task.owner_id),
    );
    const next = pickNextAiWork(
      this.tasks.filter((task) => !busy.has(task.owner_id)),
      at,
      maxAttempts,
    );
    if (!next) return null;
    next.status = "in_progress";
    next.agent_locked_at = at.toISOString();
    next.agent_attempts = (next.agent_attempts ?? 0) + 1;
    next.updated_at = at.toISOString();
    return next;
  }
  async listRecommendations(ownerId: string) {
    return this.recommendations
      .filter((x) => x.owner_id === ownerId)
      .map((recommendation) => this.enrichRecommendation(recommendation));
  }
  async getRecommendation(ownerId: string, id: string) {
    const recommendation = this.recommendations.find((x) => x.owner_id === ownerId && x.id === id);
    return recommendation ? this.enrichRecommendation(recommendation) : null;
  }
  async createRecommendation(ownerId: string, input: RecommendationInput) {
    await this.assertOwnedLinks(ownerId, input);
    const r: Recommendation = {
      id: randomUUID(),
      owner_id: ownerId,
      person_id: input.person_id ?? null,
      space_id: input.space_id ?? null,
      task_id: input.task_id ?? null,
      query: input.query,
      items: input.items,
      memory_ids: input.memory_ids,
      experience_ids: input.experience_ids ?? [],
      created_at: now(),
    };
    this.recommendations.push(r);
    return r;
  }
  async claimTelegramUpdate(updateId: number) {
    if (this.updateIds.has(updateId)) return false;
    this.updateIds.add(updateId);
    return true;
  }
  async createMessage(ownerId: string, input: Omit<Message, "id" | "owner_id" | "created_at">) {
    if (
      input.telegram_chat_id !== null &&
      input.telegram_message_id !== null &&
      this.messages.some(
        (m) =>
          m.telegram_chat_id === input.telegram_chat_id &&
          m.telegram_message_id === input.telegram_message_id,
      )
    )
      return null;
    const m: Message = { ...input, id: randomUUID(), owner_id: ownerId, created_at: now() };
    this.messages.push(m);
    const conversation = this.conversations.find((x) => x.id === input.conversation_id);
    if (conversation) conversation.last_message_at = m.created_at;
    return m;
  }
  async deleteMessage(ownerId: string, id: string) {
    const index = this.messages.findIndex(
      (message) => message.owner_id === ownerId && message.id === id,
    );
    if (index < 0) return false;
    this.messages.splice(index, 1);
    return true;
  }
  async getUser(ownerId: string) {
    return this.users.find((x) => x.id === ownerId) ?? null;
  }
  async getProfile(ownerId: string) {
    return this.profiles.find((x) => x.owner_id === ownerId) ?? null;
  }
  async updateProfile(ownerId: string, input: ProfileInput) {
    const profile = await this.getProfile(ownerId);
    if (!profile) return null;
    Object.assign(profile, input, { updated_at: now() });
    return profile;
  }
  async listNotificationProfiles() {
    return [...this.profiles];
  }
  async listReliabilityCohort() {
    return this.profiles.map((profile) => ({
      timezone: profile.timezone || "UTC",
      tasks: this.tasks
        .filter((task) => task.owner_id === profile.owner_id && task.due_at)
        .map((task) => ({
          status: task.status,
          due_at: task.due_at,
          assignee: task.assignee,
          completed_at: task.completed_at,
          updated_at: task.updated_at,
        })),
    }));
  }
  async getSelfPerson(ownerId: string) {
    const person = this.people.find((x) => x.owner_id === ownerId && x.is_self);
    return person ? this.withPersonExtras(person) : null;
  }
  async getPrimaryConversation(ownerId: string) {
    let conversation = this.conversations.find((x) => x.owner_id === ownerId && x.is_primary);
    if (!conversation) {
      const timestamp = now();
      conversation = {
        id: randomUUID(),
        owner_id: ownerId,
        kind: "companion",
        mode: "companion",
        title: "LifeOS",
        summary: null,
        is_primary: true,
        last_message_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
      };
      this.conversations.push(conversation);
    }
    return conversation;
  }
  async updateConversationMode(ownerId: string, mode: Conversation["mode"]) {
    const conversation = await this.getPrimaryConversation(ownerId);
    conversation.mode = mode;
    conversation.updated_at = now();
    return conversation;
  }
  async listMessages(ownerId: string, conversationId: string, limit = 50) {
    return this.messages
      .filter((x) => x.owner_id === ownerId && x.conversation_id === conversationId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(-Math.min(limit, 100));
  }
  async updateMessageIntent(ownerId: string, id: string, intent: Message["intent"]) {
    const message = this.messages.find((x) => x.owner_id === ownerId && x.id === id);
    if (message) message.intent = intent;
  }
  async findMessageByTelegramId(ownerId: string, chatId: number, telegramMessageId: number) {
    return (
      this.messages.find(
        (message) =>
          message.owner_id === ownerId &&
          message.telegram_chat_id === chatId &&
          message.telegram_message_id === telegramMessageId,
      ) ?? null
    );
  }
  async updateMessageTelegramId(
    ownerId: string,
    id: string,
    chatId: number,
    telegramMessageId: number,
  ) {
    const message = this.messages.find((item) => item.owner_id === ownerId && item.id === id);
    if (!message) return;
    message.telegram_chat_id = chatId;
    message.telegram_message_id = telegramMessageId;
  }
  async listGoals(ownerId: string) {
    return this.goals.filter((x) => x.owner_id === ownerId);
  }
  async getGoal(ownerId: string, id: string) {
    return this.goals.find((x) => x.owner_id === ownerId && x.id === id) ?? null;
  }
  async createGoal(ownerId: string, input: GoalInput) {
    const timestamp = now();
    const goal: Goal = {
      id: randomUUID(),
      owner_id: ownerId,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "active",
      horizon: input.horizon ?? null,
      priority: input.priority ?? 3,
      target_date: input.target_date ?? null,
      source_note_id: input.source_note_id ?? null,
      current_plan: input.current_plan ?? null,
      plan_revised_at: input.plan_revised_at ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.goals.push(goal);
    return goal;
  }
  async updateGoal(ownerId: string, id: string, input: Partial<GoalInput>) {
    const value = await this.getGoal(ownerId, id);
    if (!value) return null;
    Object.assign(value, input, { updated_at: now() });
    return value;
  }
  async deleteGoal(ownerId: string, id: string) {
    return archiveGoalLinkedWork(this, ownerId, id);
  }
  async listPromises(ownerId: string) {
    return this.promises
      .filter((x) => x.owner_id === ownerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async getPromise(ownerId: string, id: string) {
    return this.promises.find((x) => x.owner_id === ownerId && x.id === id) ?? null;
  }
  async createPromise(ownerId: string, input: PromiseInput) {
    const timestamp = now();
    const value: SelfPromise = {
      id: randomUUID(),
      owner_id: ownerId,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "active",
      started_at: input.started_at ?? timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.promises.push(value);
    return value;
  }
  async updatePromise(ownerId: string, id: string, input: Partial<PromiseInput>) {
    const value = await this.getPromise(ownerId, id);
    if (!value) return null;
    Object.assign(value, input, { updated_at: now() });
    return value;
  }
  async deletePromise(ownerId: string, id: string) {
    const value = await this.getPromise(ownerId, id);
    if (!value) return false;
    this.promises.splice(this.promises.indexOf(value), 1);
    this.promiseCheckins = this.promiseCheckins.filter((item) => item.promise_id !== id);
    return true;
  }
  async listPromiseCheckins(ownerId: string, promiseId?: string) {
    return this.promiseCheckins
      .filter((item) => item.owner_id === ownerId && (!promiseId || item.promise_id === promiseId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async createPromiseCheckin(ownerId: string, promiseId: string, input: PromiseCheckinInput) {
    if (!(await this.getPromise(ownerId, promiseId)))
      throw Object.assign(new Error("Promise not found"), { status: 404 });
    const value: SelfPromiseCheckin = {
      id: randomUUID(),
      owner_id: ownerId,
      promise_id: promiseId,
      status: input.status,
      note: input.note ?? null,
      created_at: now(),
    };
    this.promiseCheckins.push(value);
    return value;
  }
  async listProjects(ownerId: string) {
    return this.projects
      .filter((x) => x.owner_id === ownerId)
      .map((project) => {
        const goal = this.goals.find((item) => item.id === project.goal_id);
        const space = this.spaces.find((item) => item.id === project.space_id);
        return {
          ...project,
          goal: goal ? { id: goal.id, title: goal.title } : null,
          space: space ? { id: space.id, name: space.name } : null,
        };
      });
  }
  async getProject(ownerId: string, id: string) {
    return this.projects.find((x) => x.owner_id === ownerId && x.id === id) ?? null;
  }
  private async assertProjectLinks(ownerId: string, input: Partial<ProjectInput>) {
    if (input.goal_id && !(await this.getGoal(ownerId, input.goal_id)))
      throw Object.assign(new Error("Goal not found"), { status: 400 });
    if (input.space_id && !(await this.getSpace(ownerId, input.space_id)))
      throw Object.assign(new Error("Space not found"), { status: 400 });
  }
  async createProject(ownerId: string, input: ProjectInput) {
    await this.assertProjectLinks(ownerId, input);
    const timestamp = now();
    const value: Project = {
      id: randomUUID(),
      owner_id: ownerId,
      name: input.name,
      goal_id: input.goal_id ?? null,
      space_id: input.space_id ?? null,
      description: input.description ?? null,
      status: input.status ?? "active",
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.projects.push(value);
    return value;
  }
  async updateProject(ownerId: string, id: string, input: Partial<ProjectInput>) {
    const value = await this.getProject(ownerId, id);
    if (!value) return null;
    await this.assertProjectLinks(ownerId, input);
    Object.assign(value, input, { updated_at: now() });
    return value;
  }
  async deleteProject(ownerId: string, id: string) {
    const value = await this.getProject(ownerId, id);
    if (!value) return false;
    this.projects.splice(this.projects.indexOf(value), 1);
    this.tasks.forEach((x) => {
      if (x.project_id === id) x.project_id = null;
    });
    return true;
  }
  async createRecommendationFeedback(
    ownerId: string,
    recommendationId: string,
    input: Pick<RecommendationFeedback, "item_index" | "outcome" | "note">,
  ) {
    if (!(await this.getRecommendation(ownerId, recommendationId)))
      throw Object.assign(new Error("Recommendation not found"), { status: 404 });
    const existing = this.feedback.find(
      (x) =>
        x.owner_id === ownerId &&
        x.recommendation_id === recommendationId &&
        x.item_index === input.item_index,
    );
    if (existing) {
      Object.assign(existing, input, { updated_at: now() });
      return existing;
    }
    const timestamp = now();
    const value = {
      id: randomUUID(),
      owner_id: ownerId,
      recommendation_id: recommendationId,
      ...input,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.feedback.push(value);
    return value;
  }
  async listRecommendationFeedback(ownerId: string, limit = 20) {
    return this.feedback.filter((x) => x.owner_id === ownerId).slice(-limit);
  }
  async createReflection(
    ownerId: string,
    input: Omit<Reflection, "id" | "owner_id" | "created_at">,
  ) {
    const value = { id: randomUUID(), owner_id: ownerId, ...input, created_at: now() };
    this.reflections.push(value);
    return value;
  }
  async listReflections(ownerId: string) {
    return this.reflections
      .filter((x) => x.owner_id === ownerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async createPendingAction(
    ownerId: string,
    input: Omit<PendingAction, "id" | "owner_id" | "created_at">,
  ) {
    const value = { id: randomUUID(), owner_id: ownerId, ...input, created_at: now() };
    this.pendingActions.push(value);
    return value;
  }
  async consumePendingAction(ownerId: string, id: string) {
    const action = this.pendingActions.find(
      (x) => x.owner_id === ownerId && x.id === id && x.expires_at > now(),
    );
    if (!action) return null;
    this.pendingActions.splice(this.pendingActions.indexOf(action), 1);
    return action;
  }
  async findActivePendingAction(ownerId: string, telegramChatId: number, action?: string) {
    return (
      this.pendingActions
        .filter(
          (x) =>
            x.owner_id === ownerId &&
            x.telegram_chat_id === telegramChatId &&
            x.expires_at > now() &&
            (!action || x.action === action),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
    );
  }
  async listExperiences(ownerId: string, personId?: string) {
    return this.experiences
      .filter((x) => x.owner_id === ownerId && (!personId || x.participant_ids.includes(personId)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async getExperience(ownerId: string, id: string) {
    return this.experiences.find((x) => x.owner_id === ownerId && x.id === id) ?? null;
  }
  private async assertExperienceLinks(ownerId: string, input: Partial<ExperienceInput>) {
    for (const personId of input.participant_ids ?? [])
      if (!(await this.getPerson(ownerId, personId)))
        throw Object.assign(new Error("Participant not found"), { status: 400 });
    if (
      input.planned_task_id &&
      !this.tasks.some((x) => x.owner_id === ownerId && x.id === input.planned_task_id)
    )
      throw Object.assign(new Error("Task not found"), { status: 400 });
    if (input.planned_space_id && !(await this.getSpace(ownerId, input.planned_space_id)))
      throw Object.assign(new Error("Space not found"), { status: 400 });
  }
  async createExperience(ownerId: string, input: ExperienceInput) {
    await this.assertExperienceLinks(ownerId, input);
    const timestamp = now();
    const value: Experience = {
      id: randomUUID(),
      owner_id: ownerId,
      type: input.type,
      title: input.title,
      place: input.place ?? null,
      description: input.description ?? null,
      occurred_at: input.occurred_at ?? null,
      positive_signals: input.positive_signals ?? [],
      negative_signals: input.negative_signals ?? [],
      emotions: input.emotions ?? [],
      outcome: input.outcome ?? null,
      source_message_id: input.source_message_id ?? null,
      planned_task_id: input.planned_task_id ?? null,
      planned_space_id: input.planned_space_id ?? null,
      follow_up_at: input.follow_up_at ?? null,
      status: input.status ?? (input.occurred_at ? "completed" : "planned"),
      participant_ids: input.participant_ids ?? [],
      participants: (input.participant_ids ?? [])
        .map((id) => this.people.find((x) => x.id === id)!)
        .filter(Boolean)
        .map(({ id, name }) => ({ id, name })),
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.experiences.push(value);
    return value;
  }
  async updateExperience(ownerId: string, id: string, input: Partial<ExperienceInput>) {
    const value = await this.getExperience(ownerId, id);
    if (!value) return null;
    await this.assertExperienceLinks(ownerId, input);
    Object.assign(value, input, { updated_at: now() });
    value.participants = value.participant_ids
      .map((personId) => this.people.find((x) => x.id === personId)!)
      .filter(Boolean)
      .map(({ id, name }) => ({ id, name }));
    return value;
  }
  async deleteExperience(ownerId: string, id: string) {
    const value = await this.getExperience(ownerId, id);
    if (!value) return false;
    this.experiences.splice(this.experiences.indexOf(value), 1);
    return true;
  }
  async findDueExperienceFollowUps(at = now(), ownerId?: string) {
    return this.experiences.filter(
      (x) =>
        (!ownerId || x.owner_id === ownerId) &&
        x.status === "planned" &&
        !!x.follow_up_at &&
        x.follow_up_at <= at,
    );
  }
  async linkExperienceMemory(
    ownerId: string,
    experienceId: string,
    memoryId: string,
    signal: "positive" | "negative",
  ) {
    if (
      !(await this.getExperience(ownerId, experienceId)) ||
      !(await this.ownedMemory(ownerId, memoryId))
    )
      throw Object.assign(new Error("Experience or memory not found"), { status: 404 });
    this.experienceMemoryLinks.push({ experience_id: experienceId, memory_id: memoryId, signal });
  }
  async trackBetaMetric(
    ownerId: string,
    name: BetaMetricName,
    properties: Record<string, unknown> = {},
  ) {
    if (this.betaMetrics.some((metric) => metric.owner_id === ownerId && metric.name === name))
      return;
    this.betaMetrics.push({ owner_id: ownerId, name, properties, created_at: now() });
  }
  async replaceCalendarEvents(
    ownerId: string,
    input: { source: "ios"; from: string; to: string; events: CalendarEventInput[] },
  ) {
    const from = Date.parse(input.from);
    const to = Date.parse(input.to);
    this.calendarEvents = this.calendarEvents.filter(
      (x) =>
        !(
          x.owner_id === ownerId &&
          x.source === input.source &&
          Date.parse(x.starts_at) < to &&
          Date.parse(x.ends_at) > from
        ),
    );
    for (const event of input.events) {
      this.calendarEvents.push({
        ...event,
        id: randomUUID(),
        owner_id: ownerId,
        source: input.source,
        created_at: now(),
      });
    }
    return input.events.length;
  }
  async listCalendarEvents(ownerId: string, from: string, to: string) {
    const start = Date.parse(from);
    const end = Date.parse(to);
    return this.calendarEvents
      .filter(
        (x) =>
          x.owner_id === ownerId && Date.parse(x.starts_at) < end && Date.parse(x.ends_at) > start,
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }
  async listDevices(ownerId: string) {
    return this.devices.filter((x) => x.owner_id === ownerId);
  }
  async createAppLoginRequest(nonce: string) {
    this.appLogins.push({
      nonce,
      owner_id: null,
      created_at: now(),
      approved_at: null,
      consumed_at: null,
    });
  }
  async approveAppLoginRequest(nonce: string, ownerId: string) {
    const row = this.appLogins.find((x) => x.nonce === nonce);
    if (!row || row.consumed_at || appLoginExpired(row)) return false;
    if (row.approved_at) return row.owner_id === ownerId;
    row.owner_id = ownerId;
    row.approved_at = now();
    return true;
  }
  async consumeAppLoginRequest(nonce: string): Promise<AppLoginPoll> {
    const row = this.appLogins.find((x) => x.nonce === nonce);
    if (!row || row.consumed_at || appLoginExpired(row)) return { status: "expired" };
    if (!row.approved_at || !row.owner_id) return { status: "pending" };
    row.consumed_at = now();
    return { status: "approved", owner_id: row.owner_id };
  }
  async upsertDevice(ownerId: string, input: DeviceInput) {
    const existing = this.devices.find(
      (x) => x.platform === input.platform && x.push_token === input.push_token,
    );
    if (existing) {
      Object.assign(existing, {
        owner_id: ownerId,
        environment: input.environment,
        app_version: input.app_version ?? null,
        updated_at: now(),
      });
      return existing;
    }
    const device: Device = {
      id: randomUUID(),
      owner_id: ownerId,
      platform: input.platform,
      push_token: input.push_token,
      environment: input.environment,
      app_version: input.app_version ?? null,
      created_at: now(),
      updated_at: now(),
    };
    this.devices.push(device);
    return device;
  }
  async deleteDevice(ownerId: string, pushToken: string) {
    this.devices = this.devices.filter(
      (x) => !(x.owner_id === ownerId && x.push_token === pushToken),
    );
  }
  async trackEvents(
    ownerId: string,
    events: { name: string; properties?: Record<string, unknown> }[],
  ) {
    for (const event of events) {
      this.betaMetrics.push({
        owner_id: ownerId,
        name: event.name,
        properties: event.properties ?? {},
        created_at: now(),
      });
    }
  }
  async incrementUsage(
    ownerId: string,
    input: {
      metric: string;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    },
    at = new Date(),
  ) {
    const used_on = at.toISOString().slice(0, 10);
    const metric = input.metric.slice(0, 40) || "other";
    const prompt_tokens = Math.max(0, Math.trunc(input.prompt_tokens));
    const completion_tokens = Math.max(0, Math.trunc(input.completion_tokens));
    const total_tokens = Math.max(0, Math.trunc(input.total_tokens));
    const hour_start = new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000).toISOString();
    const hour = this.usageHours.find(
      (row) => row.owner_id === ownerId && row.hour_start === hour_start,
    );
    if (hour) {
      hour.total_tokens += total_tokens;
      hour.call_count += 1;
    } else {
      this.usageHours.push({ owner_id: ownerId, hour_start, total_tokens, call_count: 1 });
    }
    const existing = this.usageCounters.find(
      (row) => row.owner_id === ownerId && row.used_on === used_on && row.metric === metric,
    );
    if (existing) {
      existing.prompt_tokens += prompt_tokens;
      existing.completion_tokens += completion_tokens;
      existing.total_tokens += total_tokens;
      existing.call_count += 1;
      existing.updated_at = now();
      return existing;
    }
    const created: UsageCounter = {
      owner_id: ownerId,
      used_on,
      metric,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      call_count: 1,
      updated_at: now(),
    };
    this.usageCounters.push(created);
    return created;
  }
  usageHours: UsageHour[] = [];
  quotaPlans: QuotaPlan[] = DEFAULT_QUOTA_PLANS.map((plan) => ({ ...plan, updated_at: now() }));
  quotaEnforced = false;
  userPlans: UserPlan[] = [];
  admins: string[] = [];
  async listUsageHours(ownerId: string, since: string) {
    return this.usageHours
      .filter((row) => row.owner_id === ownerId && row.hour_start >= since)
      .sort((a, b) => a.hour_start.localeCompare(b.hour_start));
  }
  async listQuotaPlans() {
    return [...this.quotaPlans];
  }
  async updateQuotaPlan(
    plan: string,
    input: Partial<Pick<QuotaPlan, "period" | "period_tokens" | "window_hours" | "window_tokens">>,
  ) {
    const row = this.quotaPlans.find((x) => x.plan === plan);
    if (!row) return null;
    Object.assign(row, input, { updated_at: now() });
    return row;
  }
  async getQuotaEnforced() {
    return this.quotaEnforced;
  }
  async setQuotaEnforced(enforced: boolean) {
    this.quotaEnforced = enforced;
  }
  async getUserPlan(ownerId: string) {
    return this.userPlans.find((x) => x.owner_id === ownerId) ?? null;
  }
  async setUserPlan(ownerId: string, plan: string, until: string | null) {
    const row: UserPlan = { owner_id: ownerId, plan, plan_until: until, updated_at: now() };
    this.userPlans = [...this.userPlans.filter((x) => x.owner_id !== ownerId), row];
    return row;
  }
  async isAdmin(ownerId: string) {
    return this.admins.includes(ownerId);
  }
  async claimFirstAdmin(ownerId: string) {
    if (this.admins.length) return this.admins.includes(ownerId);
    this.admins.push(ownerId);
    return true;
  }
  async findUserByHandle(handle: string) {
    const value = handle.trim().replace(/^@/, "").toLowerCase();
    return (
      this.users.find(
        (x) =>
          x.id === value ||
          x.username?.toLowerCase() === value ||
          x.email?.toLowerCase() === value ||
          String(x.telegram_id ?? "") === value,
      ) ?? null
    );
  }
  async listUsageCounters(ownerId: string, from: string, to: string) {
    return this.usageCounters
      .filter((row) => row.owner_id === ownerId && row.used_on >= from && row.used_on <= to)
      .sort((a, b) => a.used_on.localeCompare(b.used_on) || a.metric.localeCompare(b.metric));
  }
  async createImportSession(
    ownerId: string,
    input: { source: ImportSource; items: ImportItem[]; access_token?: string | null },
  ) {
    const session: ImportSession = {
      id: randomUUID(),
      owner_id: ownerId,
      source: input.source,
      status: "preview",
      items: input.items,
      access_token: input.access_token ?? null,
      log: {},
      created_at: now(),
      confirmed_at: null,
    };
    this.importSessions.push(session);
    return session;
  }
  async getImportSession(ownerId: string, id: string) {
    return this.importSessions.find((item) => item.owner_id === ownerId && item.id === id) ?? null;
  }
  async updateImportSession(
    ownerId: string,
    id: string,
    input: Partial<
      Pick<ImportSession, "status" | "items" | "access_token" | "log" | "confirmed_at">
    >,
  ) {
    const session = await this.getImportSession(ownerId, id);
    if (!session) return null;
    Object.assign(session, input);
    return session;
  }
  async listMailAccounts(ownerId: string) {
    return this.mailAccounts.filter((item) => item.owner_id === ownerId).map(publicMailAccount);
  }
  async getMailAccountSecret(ownerId: string, id: string) {
    return this.mailAccounts.find((item) => item.owner_id === ownerId && item.id === id) ?? null;
  }
  async listMailAccountsDueForSync() {
    return this.mailAccounts.filter((item) => item.status !== "disabled");
  }
  async createMailAccount(ownerId: string, input: MailAccountInput) {
    const timestamp = now();
    const value: MailAccount = {
      id: randomUUID(),
      owner_id: ownerId,
      email: input.email,
      provider: input.provider,
      username: input.username,
      imap_host: input.imap_host,
      imap_port: input.imap_port,
      smtp_host: input.smtp_host,
      smtp_port: input.smtp_port,
      secret_cipher: input.secret_cipher,
      status: input.status ?? "active",
      last_error: input.last_error ?? null,
      last_synced_at: input.last_synced_at ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.mailAccounts.push(value);
    return value;
  }
  async updateMailAccount(
    ownerId: string,
    id: string,
    input: Partial<
      Omit<MailAccountInput, "email" | "secret_cipher"> & Pick<MailAccount, "secret_cipher">
    >,
  ) {
    const value = await this.getMailAccountSecret(ownerId, id);
    if (!value) return null;
    Object.assign(value, input, { updated_at: now() });
    return value;
  }
  async deleteMailAccount(ownerId: string, id: string) {
    const value = await this.getMailAccountSecret(ownerId, id);
    if (!value) return false;
    this.mailAccounts.splice(this.mailAccounts.indexOf(value), 1);
    this.mailMessages = this.mailMessages.filter((item) => item.account_id !== id);
    this.mailDrafts = this.mailDrafts.filter((item) => item.account_id !== id);
    this.mailPlaybooks = this.mailPlaybooks.filter((item) => item.account_id !== id);
    return true;
  }
  async listMailMessages(ownerId: string, limit = 50) {
    return this.mailMessages
      .filter((item) => item.owner_id === ownerId)
      .sort((a, b) => (b.received_at ?? b.created_at).localeCompare(a.received_at ?? a.created_at))
      .slice(0, limit);
  }
  async getMailMessage(ownerId: string, id: string) {
    return this.mailMessages.find((item) => item.owner_id === ownerId && item.id === id) ?? null;
  }
  async upsertMailMessage(ownerId: string, input: MailMessageInput) {
    const existing = this.mailMessages.find(
      (item) =>
        item.owner_id === ownerId &&
        item.account_id === input.account_id &&
        item.provider_uid === input.provider_uid,
    );
    if (existing) {
      Object.assign(existing, {
        from_address: input.from_address,
        from_name: input.from_name ?? existing.from_name,
        to_address: input.to_address ?? existing.to_address,
        subject: input.subject,
        snippet: input.snippet,
        received_at: input.received_at ?? existing.received_at,
        is_important: input.is_important ?? existing.is_important,
        is_meeting: input.is_meeting ?? existing.is_meeting,
        meeting_at: input.meeting_at ?? existing.meeting_at,
        has_calendar_invite: input.has_calendar_invite ?? existing.has_calendar_invite,
        updated_at: now(),
      });
      return existing;
    }
    const timestamp = now();
    const value: MailMessage = {
      id: randomUUID(),
      owner_id: ownerId,
      account_id: input.account_id,
      provider_uid: input.provider_uid,
      from_address: input.from_address,
      from_name: input.from_name ?? null,
      to_address: input.to_address ?? null,
      subject: input.subject,
      snippet: input.snippet,
      received_at: input.received_at ?? null,
      is_important: input.is_important ?? false,
      is_meeting: input.is_meeting ?? false,
      meeting_at: input.meeting_at ?? null,
      has_calendar_invite: input.has_calendar_invite ?? false,
      handled: input.handled ?? false,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.mailMessages.push(value);
    return value;
  }
  async updateMailMessage(
    ownerId: string,
    id: string,
    input: Partial<Pick<MailMessage, "handled" | "is_important" | "is_meeting" | "meeting_at">>,
  ) {
    const value = await this.getMailMessage(ownerId, id);
    if (!value) return null;
    Object.assign(value, input, { updated_at: now() });
    return value;
  }
  async listMailDrafts(ownerId: string) {
    return this.mailDrafts
      .filter((item) => item.owner_id === ownerId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async getMailDraft(ownerId: string, id: string) {
    return this.mailDrafts.find((item) => item.owner_id === ownerId && item.id === id) ?? null;
  }
  async createMailDraft(ownerId: string, input: MailDraftInput) {
    const timestamp = now();
    const value: MailDraft = {
      id: randomUUID(),
      owner_id: ownerId,
      account_id: input.account_id,
      message_id: input.message_id ?? null,
      to_address: input.to_address,
      subject: input.subject,
      body: input.body,
      status: input.status ?? "draft",
      error: input.error ?? null,
      sent_at: input.sent_at ?? null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.mailDrafts.push(value);
    return value;
  }
  async updateMailDraft(ownerId: string, id: string, input: Partial<MailDraftInput>) {
    const value = await this.getMailDraft(ownerId, id);
    if (!value) return null;
    Object.assign(value, input, { updated_at: now() });
    return value;
  }
  async deleteMailDraft(ownerId: string, id: string) {
    const value = await this.getMailDraft(ownerId, id);
    if (!value) return false;
    this.mailDrafts.splice(this.mailDrafts.indexOf(value), 1);
    return true;
  }
  async listMailPlaybooks(ownerId: string) {
    return this.mailPlaybooks.filter((item) => item.owner_id === ownerId);
  }
  async createMailPlaybook(ownerId: string, input: MailPlaybookInput) {
    const timestamp = now();
    const value: MailPlaybook = {
      id: randomUUID(),
      owner_id: ownerId,
      account_id: input.account_id ?? null,
      name: input.name,
      trigger: input.trigger,
      actions: input.actions,
      prompt: input.prompt ?? null,
      enabled: input.enabled ?? true,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.mailPlaybooks.push(value);
    return value;
  }
  async updateMailPlaybook(ownerId: string, id: string, input: Partial<MailPlaybookInput>) {
    const value = this.mailPlaybooks.find((item) => item.owner_id === ownerId && item.id === id);
    if (!value) return null;
    Object.assign(value, input, { updated_at: now() });
    return value;
  }
  async deleteMailPlaybook(ownerId: string, id: string) {
    const value = this.mailPlaybooks.find((item) => item.owner_id === ownerId && item.id === id);
    if (!value) return false;
    this.mailPlaybooks.splice(this.mailPlaybooks.indexOf(value), 1);
    return true;
  }
  private enrichRecommendation(recommendation: Recommendation): Recommendation {
    const person = this.people.find((item) => item.id === recommendation.person_id);
    const space = this.spaces.find((item) => item.id === recommendation.space_id);
    const task = this.tasks.find((item) => item.id === recommendation.task_id);
    return {
      ...recommendation,
      person: person ? { id: person.id, name: person.name } : null,
      space: space ? { id: space.id, name: space.name } : null,
      task: task ? { id: task.id, title: task.title } : null,
    };
  }
  async listActivityCatalog() {
    return {
      categories: [...this.activityCatalog.categories].sort((a, b) => a.sort - b.sort),
      types: [...this.activityCatalog.types].sort((a, b) => a.sort - b.sort),
    };
  }
  async listPlaces(filter: { typeIds?: string[]; city?: string | null; limit?: number }) {
    const types = filter.typeIds?.length ? new Set(filter.typeIds) : null;
    return this.places
      .filter((place) => sameCity(place.city, filter.city))
      .filter((place) => !types || place.activity_type_ids.some((id) => types.has(id)))
      .sort(byRating)
      .slice(0, filter.limit ?? 50);
  }
  async listPlaceVisits(ownerId: string) {
    return this.placeVisits
      .filter((visit) => visit.owner_id === ownerId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async savePlaceVisit(ownerId: string, input: PlaceVisitInput) {
    const existing = input.place_id
      ? this.placeVisits.find((v) => v.owner_id === ownerId && v.place_id === input.place_id)
      : undefined;
    if (existing) {
      Object.assign(existing, input, { updated_at: now() });
      return existing;
    }
    const visit: PlaceVisit = {
      id: randomUUID(),
      owner_id: ownerId,
      ...input,
      created_at: now(),
      updated_at: now(),
    };
    this.placeVisits.push(visit);
    return visit;
  }
  async deletePlaceVisit(ownerId: string, id: string) {
    const before = this.placeVisits.length;
    this.placeVisits = this.placeVisits.filter((v) => !(v.owner_id === ownerId && v.id === id));
    return this.placeVisits.length < before;
  }
  async listActivitySpins(ownerId: string, localDate: string) {
    return this.activitySpins.filter(
      (spin) => spin.owner_id === ownerId && spin.local_date === localDate,
    );
  }
  async createActivitySpin(ownerId: string, input: ActivitySpinInput) {
    const spin: ActivitySpin = { id: randomUUID(), owner_id: ownerId, ...input, created_at: now() };
    this.activitySpins.push(spin);
    return spin;
  }
  async listActivityPreferences(ownerId: string) {
    return this.activityPreferences.filter((row) => row.owner_id === ownerId);
  }
  async patchActivityPreference(ownerId: string, patch: ActivityPreferencePatch) {
    let row = this.activityPreferences.find(
      (r) =>
        r.owner_id === ownerId &&
        r.target_kind === patch.target_kind &&
        r.target_id === patch.target_id,
    );
    if (!row) {
      row = {
        owner_id: ownerId,
        target_kind: patch.target_kind,
        target_id: patch.target_id,
        verdict: null,
        visit_affinity: 0,
        ai_affinity: 0,
        ai_reason: null,
        updated_at: now(),
      };
      this.activityPreferences.push(row);
    }
    for (const key of ["verdict", "visit_affinity", "ai_affinity", "ai_reason"] as const)
      if (patch[key] !== undefined) (row as unknown as Record<string, unknown>)[key] = patch[key];
    row.updated_at = now();
    return row;
  }
  async replaceAiPreferences(
    ownerId: string,
    rows: Pick<ActivityPreference, "target_kind" | "target_id" | "ai_affinity" | "ai_reason">[],
  ) {
    for (const row of this.activityPreferences.filter((r) => r.owner_id === ownerId)) {
      row.ai_affinity = 0;
      row.ai_reason = null;
    }
    for (const row of rows) await this.patchActivityPreference(ownerId, row);
  }
  async getTasteProfile(ownerId: string) {
    return this.tasteProfiles.find((row) => row.owner_id === ownerId) ?? null;
  }
  async saveTasteProfile(
    ownerId: string,
    input: Pick<ActivityTasteProfile, "summary" | "refreshed_at">,
  ) {
    const existing = this.tasteProfiles.find((row) => row.owner_id === ownerId);
    if (existing) return Object.assign(existing, input);
    const row = { owner_id: ownerId, ...input };
    this.tasteProfiles.push(row);
    return row;
  }
  async upsertPlace(input: PlaceUpsertInput, activityTypeId: string | null) {
    let place = this.places.find(
      (p) =>
        p.source === input.source && (p as { source_id?: string }).source_id === input.source_id,
    );
    if (!place) {
      place = {
        id: randomUUID(),
        name: input.name,
        city: input.city,
        address: input.address,
        lat: input.lat,
        lon: input.lon,
        description: input.note ?? null,
        image_url: input.image_url,
        photos: input.photos,
        phone: input.phone,
        website: input.website,
        hours: input.hours,
        price_from: null,
        yandex_org_id: null,
        yandex_url: null,
        yandex_rating: null,
        yandex_reviews: null,
        twogis_url: input.twogis_url,
        source: input.source,
        rating: input.rating,
        rating_count: input.rating_count,
        rating_source: input.rating == null ? null : input.source,
        activity_type_ids: [],
      };
      Object.assign(place, { source_id: input.source_id });
      this.places.push(place);
    } else {
      Object.assign(place, {
        name: input.name,
        address: input.address ?? place.address,
        rating: input.rating ?? place.rating,
        rating_count: input.rating_count ?? place.rating_count,
      });
    }
    if (activityTypeId && !place.activity_type_ids.includes(activityTypeId))
      place.activity_type_ids.push(activityTypeId);
    return place;
  }
}

export class SupabaseRepository implements AppRepository {
  constructor(private readonly db: SupabaseClient) {}
  private async one<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
    const { data, error } = await q;
    if (error) throw Object.assign(new Error(error.message || "Database error"), error);
    return data as T;
  }
  private async many<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
    return (await this.one<T[] | null>(q)) ?? [];
  }
  async listActivityCatalog() {
    const [categories, types] = await Promise.all([
      this.many<ActivityCatalog["categories"][number]>(
        this.db.from("activity_categories").select("id,name,emoji,sort").order("sort"),
      ),
      this.many<ActivityCatalog["types"][number]>(
        this.db
          .from("activity_types")
          .select(
            "id,category_id,name,emoji,description,activity_level,emotion_level,price_level,duration_hours,season,setting,min_people,kids_ok,search_query,geo,sort",
          )
          .eq("is_active", true)
          .order("sort"),
      ),
    ]);
    return {
      categories,
      types: types.map((type) => ({ ...type, duration_hours: Number(type.duration_hours) })),
    };
  }
  async listPlaces(filter: { typeIds?: string[]; city?: string | null; limit?: number }) {
    const typed = Boolean(filter.typeIds?.length);
    let query = this.db
      .from("places")
      .select(`*, place_activity_types${typed ? "!inner" : ""}(activity_type_id)`)
      .eq("is_visible", true);
    if (typed) query = query.in("place_activity_types.activity_type_id", filter.typeIds!);
    if (filter.city?.trim()) query = query.ilike("city", filter.city.trim());
    const rows = await this.many<
      Omit<Place, "activity_type_ids"> & {
        place_activity_types?: { activity_type_id: string }[];
        yandex_rating: number | string | null;
      }
    >(
      query
        .order("yandex_rating", { ascending: false, nullsFirst: false })
        .order("name")
        .limit(Math.min(filter.limit ?? 50, 200)),
    );
    return rows.map(({ place_activity_types, ...row }) => ({
      ...row,
      yandex_rating: row.yandex_rating == null ? null : Number(row.yandex_rating),
      activity_type_ids: (place_activity_types ?? []).map((link) => link.activity_type_id),
    })) as Place[];
  }
  async listPlaceVisits(ownerId: string) {
    return this.many<PlaceVisit>(
      this.db
        .from("place_visits")
        .select("*")
        .eq("owner_id", ownerId)
        .order("updated_at", { ascending: false })
        .limit(500),
    );
  }
  async savePlaceVisit(ownerId: string, input: PlaceVisitInput) {
    if (input.place_id) {
      const existing = await this.many<PlaceVisit>(
        this.db
          .from("place_visits")
          .select("id")
          .eq("owner_id", ownerId)
          .eq("place_id", input.place_id)
          .limit(1),
      );
      if (existing[0]) {
        return this.one<PlaceVisit>(
          this.db
            .from("place_visits")
            .update({ ...input, updated_at: now() })
            .eq("owner_id", ownerId)
            .eq("id", existing[0].id)
            .select("*")
            .single(),
        );
      }
    }
    return this.one<PlaceVisit>(
      this.db
        .from("place_visits")
        .insert({ ...input, owner_id: ownerId })
        .select("*")
        .single(),
    );
  }
  async deletePlaceVisit(ownerId: string, id: string) {
    const rows = await this.many<{ id: string }>(
      this.db.from("place_visits").delete().eq("owner_id", ownerId).eq("id", id).select("id"),
    );
    return rows.length > 0;
  }
  async listActivitySpins(ownerId: string, localDate: string) {
    return this.many<ActivitySpin>(
      this.db
        .from("activity_spins")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("local_date", localDate)
        .order("created_at", { ascending: true }),
    );
  }
  async createActivitySpin(ownerId: string, input: ActivitySpinInput) {
    return this.one<ActivitySpin>(
      this.db
        .from("activity_spins")
        .insert({ ...input, owner_id: ownerId })
        .select("*")
        .single(),
    );
  }
  async listActivityPreferences(ownerId: string) {
    const rows = await this.many<ActivityPreference>(
      this.db.from("activity_preferences").select("*").eq("owner_id", ownerId),
    );
    return rows.map((row) => ({
      ...row,
      visit_affinity: Number(row.visit_affinity),
      ai_affinity: Number(row.ai_affinity),
    }));
  }
  async patchActivityPreference(ownerId: string, patch: ActivityPreferencePatch) {
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    const existing = await this.many<ActivityPreference>(
      this.db
        .from("activity_preferences")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("target_kind", patch.target_kind)
        .eq("target_id", patch.target_id)
        .limit(1),
    );
    const query = existing[0]
      ? this.db
          .from("activity_preferences")
          .update({ ...fields, updated_at: now() })
          .eq("owner_id", ownerId)
          .eq("target_kind", patch.target_kind)
          .eq("target_id", patch.target_id)
      : this.db.from("activity_preferences").insert({ ...fields, owner_id: ownerId });
    const row = await this.one<ActivityPreference>(query.select("*").single());
    return {
      ...row,
      visit_affinity: Number(row.visit_affinity),
      ai_affinity: Number(row.ai_affinity),
    };
  }
  async replaceAiPreferences(
    ownerId: string,
    rows: Pick<ActivityPreference, "target_kind" | "target_id" | "ai_affinity" | "ai_reason">[],
  ) {
    await this.one(
      this.db
        .from("activity_preferences")
        .update({ ai_affinity: 0, ai_reason: null })
        .eq("owner_id", ownerId)
        .neq("ai_affinity", 0),
    );
    if (!rows.length) return;
    const existing = await this.listActivityPreferences(ownerId);
    const byKey = new Map(existing.map((row) => [`${row.target_kind}:${row.target_id}`, row]));
    await this.one(
      this.db.from("activity_preferences").upsert(
        rows.map((row) => {
          const old = byKey.get(`${row.target_kind}:${row.target_id}`);
          return {
            owner_id: ownerId,
            target_kind: row.target_kind,
            target_id: row.target_id,
            verdict: old?.verdict ?? null,
            visit_affinity: old?.visit_affinity ?? 0,
            ai_affinity: row.ai_affinity,
            ai_reason: row.ai_reason,
            updated_at: now(),
          };
        }),
        { onConflict: "owner_id,target_kind,target_id" },
      ),
    );
  }
  async getTasteProfile(ownerId: string) {
    return this.one<ActivityTasteProfile | null>(
      this.db
        .from("activity_taste_profiles")
        .select("owner_id,summary,refreshed_at")
        .eq("owner_id", ownerId)
        .maybeSingle(),
    );
  }
  async saveTasteProfile(
    ownerId: string,
    input: Pick<ActivityTasteProfile, "summary" | "refreshed_at">,
  ) {
    return this.one<ActivityTasteProfile>(
      this.db
        .from("activity_taste_profiles")
        .upsert({ owner_id: ownerId, ...input, updated_at: now() }, { onConflict: "owner_id" })
        .select("owner_id,summary,refreshed_at")
        .single(),
    );
  }
  async upsertPlace(input: PlaceUpsertInput, activityTypeId: string | null) {
    const row = await this.one<Omit<Place, "activity_type_ids">>(
      this.db
        .from("places")
        .upsert(
          {
            source: input.source,
            source_id: input.source_id,
            name: input.name.slice(0, 300),
            city: input.city,
            address: input.address,
            lat: input.lat,
            lon: input.lon,
            image_url: input.image_url,
            photos: input.photos,
            phone: input.phone,
            website: input.website,
            hours: input.hours,
            twogis_url: input.twogis_url,
            rating: input.rating,
            rating_count: input.rating_count,
            rating_source: input.rating == null ? null : input.source,
            ...(input.note ? { description: input.note.slice(0, 2000) } : {}),
            updated_at: now(),
          },
          { onConflict: "source,source_id" },
        )
        .select("*")
        .single(),
    );
    if (activityTypeId)
      await this.one(
        this.db
          .from("place_activity_types")
          .upsert(
            { place_id: row.id, activity_type_id: activityTypeId },
            { onConflict: "place_id,activity_type_id", ignoreDuplicates: true },
          ),
      );
    const links = await this.many<{ activity_type_id: string }>(
      this.db.from("place_activity_types").select("activity_type_id").eq("place_id", row.id),
    );
    return { ...row, activity_type_ids: links.map((link) => link.activity_type_id) } as Place;
  }
  async upsertTelegramUser(input: { telegram_id: number; name: string; username?: string | null }) {
    const user = await this.one<User>(
      this.db
        .from("users")
        .upsert({ ...input, username: input.username ?? null }, { onConflict: "telegram_id" })
        .select("*")
        .single(),
    );
    const self = await this.getSelfPerson(user.id);
    if (self && self.name !== user.name)
      await this.one(
        this.db
          .from("people")
          .update({ name: user.name })
          .eq("owner_id", user.id)
          .eq("id", self.id),
      );
    return user;
  }
  async upsertOAuthUser(input: { auth_user_id: string; name: string; email?: string | null }) {
    const existing = await this.getUserByAuthUserId(input.auth_user_id);
    if (existing) {
      return this.one<User>(
        this.db
          .from("users")
          .update({
            name: input.name || existing.name,
            email: input.email?.trim().toLowerCase() ?? existing.email,
          })
          .eq("id", existing.id)
          .select("*")
          .single(),
      );
    }
    return this.one<User>(
      this.db
        .from("users")
        .insert({
          auth_user_id: input.auth_user_id,
          email: input.email?.trim().toLowerCase() ?? null,
          name: input.name,
          username: null,
        })
        .select("*")
        .single(),
    );
  }
  async createGuestUser(input: { name?: string } = {}) {
    return this.one<User>(
      this.db
        .from("users")
        .insert({
          name: input.name?.trim() || "Гость",
          is_guest: true,
        })
        .select("*")
        .single(),
    );
  }
  async getUserByAuthUserId(authUserId: string) {
    return this.one<User | null>(
      this.db.from("users").select("*").eq("auth_user_id", authUserId).maybeSingle(),
    );
  }
  async linkAuthUser(ownerId: string, authUserId: string, email: string | null) {
    const user = await this.getUser(ownerId);
    if (!user) return { status: "not_found" } as const;
    if (user.auth_user_id && user.auth_user_id !== authUserId)
      return { status: "owner_conflict" } as const;
    const linked = await this.getUserByAuthUserId(authUserId);
    if (linked && linked.id !== ownerId) return { status: "auth_conflict" } as const;

    const update = this.db
      .from("users")
      .update({
        auth_user_id: authUserId,
        email: email?.trim().toLowerCase() ?? null,
        is_guest: false,
      })
      .eq("id", ownerId);
    const filtered = user.auth_user_id
      ? update.eq("auth_user_id", authUserId)
      : update.is("auth_user_id", null);
    const { data, error } = await filtered.select("*").maybeSingle();
    if (error?.code === "23505") return { status: "auth_conflict" } as const;
    if (error) throw error;
    if (data) return { status: "linked", user: data as User } as const;

    const current = await this.getUser(ownerId);
    if (!current) return { status: "not_found" } as const;
    return current.auth_user_id === authUserId
      ? ({ status: "linked", user: current } as const)
      : ({ status: "owner_conflict" } as const);
  }
  async linkTelegramUser(
    ownerId: string,
    input: { telegram_id: number; name: string; username?: string | null },
  ) {
    const user = await this.getUser(ownerId);
    if (!user) return { status: "not_found" } as const;
    if (user.telegram_id && user.telegram_id !== input.telegram_id)
      return { status: "owner_conflict" } as const;
    const update = this.db
      .from("users")
      .update({
        telegram_id: input.telegram_id,
        name: input.name || user.name,
        username: input.username ?? user.username,
        is_guest: false,
      })
      .eq("id", ownerId);
    const filtered = user.telegram_id
      ? update.eq("telegram_id", input.telegram_id)
      : update.is("telegram_id", null);
    const { data, error } = await filtered.select("*").maybeSingle();
    if (error?.code === "23505") return { status: "auth_conflict" } as const;
    if (error) throw error;
    if (data) return { status: "linked", user: data as User } as const;
    const current = await this.getUser(ownerId);
    if (!current) return { status: "not_found" } as const;
    return current.telegram_id === input.telegram_id
      ? ({ status: "linked", user: current } as const)
      : ({ status: "owner_conflict" } as const);
  }
  async deleteAccount(ownerId: string) {
    return !!(await this.one<User | null>(
      this.db.from("users").delete().eq("id", ownerId).select("id").maybeSingle(),
    ));
  }
  async listNotes(ownerId: string) {
    return this.many<Note>(
      this.db.from("notes").select("*").eq("owner_id", ownerId).order("updated_at"),
    );
  }
  async getNote(ownerId: string, id: string) {
    return this.one<Note | null>(
      this.db.from("notes").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle(),
    );
  }
  async listNoteRevisions(ownerId: string) {
    return this.many<NoteRevision>(
      this.db.from("note_revisions").select("*").eq("owner_id", ownerId).order("created_at"),
    );
  }
  async mutateNote(ownerId: string, id: string, input: NoteMutation, tombstone = false) {
    return this.one<NoteMutationResult>(
      this.db.rpc("mutate_note", {
        p_owner_id: ownerId,
        p_note_id: id,
        p_base_revision: input.base_revision,
        p_client_mutation_id: input.client_mutation_id,
        p_title: input.title,
        p_content: input.content,
        p_plain_text: input.plain_text,
        p_delete: tombstone,
      }),
    );
  }
  async createNoteAction(
    ownerId: string,
    input: Pick<NoteActionPreview, "note_id" | "note_revision" | "instruction" | "proposal">,
  ) {
    return this.one<NoteActionPreview>(
      this.db
        .from("note_actions")
        .insert({ owner_id: ownerId, ...input })
        .select("*")
        .single(),
    );
  }
  async listNoteActions(ownerId: string) {
    return this.many<NoteActionPreview>(
      this.db.from("note_actions").select("*").eq("owner_id", ownerId).order("created_at"),
    );
  }
  async getNoteAction(ownerId: string, id: string) {
    return this.one<NoteActionPreview | null>(
      this.db.from("note_actions").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle(),
    );
  }
  async confirmNoteAction(ownerId: string, id: string, proposal?: NoteActionProposal) {
    const result = await this.one<
      { status: "ok"; action: NoteActionPreview } | { status: "not_found" }
    >(
      this.db.rpc("confirm_note_action", {
        p_owner_id: ownerId,
        p_action_id: id,
        p_proposal: proposal ?? null,
      }),
    );
    return result.status === "ok" ? result.action : null;
  }
  async listPeople(ownerId: string, search?: string) {
    let q = this.db
      .from("people")
      .select("*, person_aliases(alias), person_locations(*), person_dates(*)")
      .eq("owner_id", ownerId);
    if (search)
      q = q.or(
        `name.ilike.%${search.replace(/[%_,]/g, "")}%,relationship.ilike.%${search.replace(/[%_,]/g, "")}%`,
      );
    const rows = await this.many<
      Record<string, unknown> & {
        person_aliases?: { alias: string }[];
        person_locations?: PersonLocation[];
        person_dates?: PersonDate[];
      }
    >(q);
    return rows.map(({ person_aliases, person_locations, person_dates, ...p }) => ({
      ...p,
      aliases: person_aliases?.map((a) => a.alias) ?? [],
      locations: sortLocations(person_locations ?? []),
      dates: sortPersonDates(person_dates ?? []),
    })) as Person[];
  }
  async getPerson(ownerId: string, id: string) {
    return (await this.listPeople(ownerId)).find((p) => p.id === id) ?? null;
  }
  async createPerson(ownerId: string, input: PersonInput) {
    const { aliases = [], ...values } = input;
    const p = await this.one<Person>(
      this.db
        .from("people")
        .insert({ owner_id: ownerId, ...values })
        .select("*")
        .single(),
    );
    if (aliases.length)
      await this.one(
        this.db.from("person_aliases").insert(aliases.map((alias) => ({ person_id: p.id, alias }))),
      );
    return { ...p, aliases, locations: [], dates: [] };
  }
  async updatePerson(ownerId: string, id: string, input: Partial<PersonInput>) {
    const { aliases, ...values } = input;
    const p = await this.one<Person | null>(
      this.db
        .from("people")
        .update(values)
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    if (!p) return null;
    if (aliases) {
      await this.one(this.db.from("person_aliases").delete().eq("person_id", id));
      if (aliases.length)
        await this.one(
          this.db.from("person_aliases").insert(aliases.map((alias) => ({ person_id: id, alias }))),
        );
    }
    return this.getPerson(ownerId, id);
  }
  async deletePerson(ownerId: string, id: string) {
    return !!(await this.one<Person | null>(
      this.db
        .from("people")
        .delete()
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("id")
        .maybeSingle(),
    ));
  }
  async listLocations(ownerId: string, personId: string) {
    if (!(await this.getPerson(ownerId, personId))) return [];
    return sortLocations(
      await this.many<PersonLocation>(
        this.db
          .from("person_locations")
          .select("*")
          .eq("person_id", personId)
          .order("created_at", { ascending: true }),
      ),
    );
  }
  private async ownedLocation(ownerId: string, id: string) {
    const location = await this.one<PersonLocation | null>(
      this.db.from("person_locations").select("*").eq("id", id).maybeSingle(),
    );
    if (!location) return null;
    return (await this.getPerson(ownerId, location.person_id)) ? location : null;
  }
  private async setPrimaryLocation(personId: string, locationId: string) {
    await this.one(
      this.db.from("person_locations").update({ is_primary: false }).eq("person_id", personId),
    );
    await this.one(
      this.db.from("person_locations").update({ is_primary: true }).eq("id", locationId),
    );
  }
  async createLocation(ownerId: string, personId: string, input: LocationInput) {
    if (!(await this.getPerson(ownerId, personId)))
      throw Object.assign(new Error("Person not found"), { status: 404 });
    const existing = await this.listLocations(ownerId, personId);
    if (existing.length >= PERSON_LOCATION_MAX)
      throw Object.assign(new Error("Too many locations"), {
        status: 400,
        code: "TOO_MANY_LOCATIONS",
      });
    const isPrimary = input.is_primary ?? existing.length === 0;
    if (isPrimary)
      await this.one(
        this.db.from("person_locations").update({ is_primary: false }).eq("person_id", personId),
      );
    return this.one<PersonLocation>(
      this.db
        .from("person_locations")
        .insert({
          person_id: personId,
          label: blankToNull(input.label),
          city: input.city.trim(),
          address: blankToNull(input.address),
          is_primary: isPrimary,
        })
        .select("*")
        .single(),
    );
  }
  async updateLocation(ownerId: string, id: string, input: Partial<LocationInput>) {
    const current = await this.ownedLocation(ownerId, id);
    if (!current) return null;
    const values: Record<string, unknown> = {};
    if (input.label !== undefined) values.label = blankToNull(input.label);
    if (input.city !== undefined) values.city = input.city.trim();
    if (input.address !== undefined) values.address = blankToNull(input.address);
    if (input.is_primary === false) values.is_primary = false;
    if (input.is_primary === true) await this.setPrimaryLocation(current.person_id, current.id);
    if (!Object.keys(values).length && input.is_primary !== true)
      return this.ownedLocation(ownerId, id);
    const updated = Object.keys(values).length
      ? await this.one<PersonLocation | null>(
          this.db.from("person_locations").update(values).eq("id", id).select("*").maybeSingle(),
        )
      : await this.ownedLocation(ownerId, id);
    return updated;
  }
  async deleteLocation(ownerId: string, id: string) {
    const location = await this.ownedLocation(ownerId, id);
    if (!location) return false;
    const deleted = await this.one<PersonLocation | null>(
      this.db.from("person_locations").delete().eq("id", id).select("*").maybeSingle(),
    );
    if (!deleted) return false;
    if (location.is_primary) {
      const next = (await this.listLocations(ownerId, location.person_id))[0];
      if (next)
        await this.one(
          this.db.from("person_locations").update({ is_primary: true }).eq("id", next.id),
        );
    }
    return true;
  }
  async listDates(ownerId: string, personId: string) {
    if (!(await this.getPerson(ownerId, personId))) return [];
    return sortPersonDates(
      await this.many<PersonDate>(
        this.db.from("person_dates").select("*").eq("person_id", personId),
      ),
    );
  }
  private async ownedDate(ownerId: string, id: string) {
    const date = await this.one<PersonDate | null>(
      this.db.from("person_dates").select("*").eq("id", id).maybeSingle(),
    );
    if (!date) return null;
    return (await this.getPerson(ownerId, date.person_id)) ? date : null;
  }
  async createDate(ownerId: string, personId: string, input: DateInput) {
    if (!(await this.getPerson(ownerId, personId)))
      throw Object.assign(new Error("Person not found"), { status: 404 });
    const values = normalizeDateInput(input);
    if (isUniquePersonDateKind(values.kind)) {
      const existing = (await this.listDates(ownerId, personId)).find(
        (item) => item.kind === values.kind,
      );
      if (existing) {
        const updated = await this.updateDate(ownerId, existing.id, values);
        if (!updated) throw Object.assign(new Error("Date not found"), { status: 404 });
        return updated;
      }
    }
    const current = await this.listDates(ownerId, personId);
    if (current.length >= PERSON_DATE_MAX)
      throw Object.assign(new Error("Too many dates"), { status: 400, code: "TOO_MANY_DATES" });
    return this.one<PersonDate>(
      this.db
        .from("person_dates")
        .insert({
          person_id: personId,
          kind: values.kind,
          label: values.label ?? null,
          month: values.month,
          day: values.day,
          year: values.year ?? null,
        })
        .select("*")
        .single(),
    );
  }
  async updateDate(ownerId: string, id: string, input: Partial<DateInput>) {
    const current = await this.ownedDate(ownerId, id);
    if (!current) return null;
    const next = normalizeDateInput({
      kind: input.kind ?? current.kind,
      label: input.label !== undefined ? input.label : current.label,
      month: input.month ?? current.month,
      day: input.day ?? current.day,
      year: input.year !== undefined ? input.year : current.year,
    });
    return this.one<PersonDate | null>(
      this.db.from("person_dates").update(next).eq("id", id).select("*").maybeSingle(),
    );
  }
  async deleteDate(ownerId: string, id: string) {
    const date = await this.ownedDate(ownerId, id);
    if (!date) return false;
    return !!(await this.one<PersonDate | null>(
      this.db.from("person_dates").delete().eq("id", id).select("*").maybeSingle(),
    ));
  }
  async listMemories(ownerId: string, personId: string) {
    return this.many<Memory>(
      this.db
        .from("memories")
        .select("*, people!inner(owner_id)")
        .eq("person_id", personId)
        .eq("people.owner_id", ownerId)
        .order("created_at", { ascending: false }),
    );
  }
  async createMemory(ownerId: string, personId: string, input: MemoryInput) {
    if (!(await this.getPerson(ownerId, personId)))
      throw Object.assign(new Error("Person not found"), { status: 404 });
    const normalized = norm(input.content);
    const existing = (await this.listMemories(ownerId, personId)).find(
      (m) => m.category === input.category && norm(m.content) === normalized,
    );
    if (existing) return { memory: existing, duplicate: true };
    return {
      memory: await this.one<Memory>(
        this.db
          .from("memories")
          .insert({ person_id: personId, ...input })
          .select("*")
          .single(),
      ),
      duplicate: false,
    };
  }
  async updateMemory(ownerId: string, id: string, input: Partial<MemoryInput>) {
    return this.one<Memory | null>(
      this.db
        .from("memories")
        .update(input)
        .eq("id", id)
        .in(
          "person_id",
          (await this.listPeople(ownerId)).map((p) => p.id),
        )
        .select("*")
        .maybeSingle(),
    );
  }
  async deleteMemory(ownerId: string, id: string) {
    return !!(await this.one<Memory | null>(
      this.db
        .from("memories")
        .delete()
        .eq("id", id)
        .in(
          "person_id",
          (await this.listPeople(ownerId)).map((p) => p.id),
        )
        .select("id")
        .maybeSingle(),
    ));
  }
  async listSpaces(ownerId: string) {
    const rows = await this.many<
      Record<string, unknown> & { space_people?: { person_id: string }[] }
    >(this.db.from("spaces").select("*, space_people(person_id)").eq("owner_id", ownerId));
    return rows.map(
      ({ space_people, ...s }) =>
        ({ ...s, person_ids: space_people?.map((p) => p.person_id) ?? [] }) as unknown as Space,
    );
  }
  async getSpace(ownerId: string, id: string) {
    const space = (await this.listSpaces(ownerId)).find((x) => x.id === id);
    if (!space) return null;
    const people = (await this.listPeople(ownerId)).filter((person) =>
      space.person_ids.includes(person.id),
    );
    const tasks = (await this.listTasks(ownerId)).filter((task) => task.space_id === id);
    return { ...space, people, tasks };
  }
  async createSpace(ownerId: string, input: SpaceInput) {
    const { person_ids = [], ...v } = input;
    const s = await this.one<Space>(
      this.db
        .from("spaces")
        .insert({ owner_id: ownerId, type: "other", ...v })
        .select("*")
        .single(),
    );
    for (const id of person_ids) await this.setSpacePerson(ownerId, s.id, id, true);
    return { ...s, person_ids };
  }
  async updateSpace(ownerId: string, id: string, input: Partial<SpaceInput>) {
    const { person_ids, ...v } = input;
    const s = await this.one<Space | null>(
      this.db
        .from("spaces")
        .update(v)
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    if (!s) return null;
    if (person_ids) {
      await this.one(this.db.from("space_people").delete().eq("space_id", id));
      for (const p of person_ids) await this.setSpacePerson(ownerId, id, p, true);
    }
    return { ...s, person_ids: person_ids ?? (await this.getSpace(ownerId, id))?.person_ids ?? [] };
  }
  async setSpacePerson(ownerId: string, spaceId: string, personId: string, add: boolean) {
    if (!(await this.getSpace(ownerId, spaceId)) || !(await this.getPerson(ownerId, personId)))
      return false;
    const q = add
      ? this.db.from("space_people").upsert({ space_id: spaceId, person_id: personId })
      : this.db.from("space_people").delete().eq("space_id", spaceId).eq("person_id", personId);
    await this.one(q);
    return true;
  }
  async listTasks(ownerId: string) {
    const [tasks, people, spaces, goals, projects] = await Promise.all([
      this.many<Task>(this.db.from("tasks").select("*").eq("owner_id", ownerId)),
      this.listPeople(ownerId),
      this.listSpaces(ownerId),
      this.listGoals(ownerId),
      this.listProjects(ownerId),
    ]);
    return tasks.map((task) => {
      const person = people.find((item) => item.id === task.person_id);
      const space = spaces.find((item) => item.id === task.space_id);
      const goal = goals.find((item) => item.id === task.goal_id);
      const project = projects.find((item) => item.id === task.project_id);
      return {
        ...task,
        person: person ? { id: person.id, name: person.name } : null,
        space: space ? { id: space.id, name: space.name } : null,
        goal: goal ? { id: goal.id, title: goal.title } : null,
        project: project ? { id: project.id, name: project.name } : null,
      };
    });
  }
  private async assertOwnedLinks(
    ownerId: string,
    input: Pick<Partial<TaskInput>, "person_id" | "space_id" | "goal_id" | "project_id">,
  ) {
    if (input.person_id && !(await this.getPerson(ownerId, input.person_id)))
      throw Object.assign(new Error("Person not found"), { status: 400 });
    if (input.space_id && !(await this.getSpace(ownerId, input.space_id)))
      throw Object.assign(new Error("Space not found"), { status: 400 });
    if (input.goal_id && !(await this.getGoal(ownerId, input.goal_id)))
      throw Object.assign(new Error("Goal not found"), { status: 400 });
    if (input.project_id && !(await this.getProject(ownerId, input.project_id)))
      throw Object.assign(new Error("Project not found"), { status: 400 });
  }
  async createTask(ownerId: string, input: TaskInput) {
    await this.assertOwnedLinks(ownerId, input);
    if (input.id) {
      const existing = await this.one<Task | null>(
        this.db.from("tasks").select("*").eq("id", input.id).maybeSingle(),
      );
      if (existing) {
        if (existing.owner_id !== ownerId)
          throw Object.assign(new Error("Task already exists"), {
            status: 409,
            code: "ALREADY_EXISTS",
          });
        return existing;
      }
    }
    const id = input.id;
    const fields = { ...input, ...recurrenceFields(input) };
    delete fields.id;
    delete fields.recurrence_scope;
    try {
      return await this.one<Task>(
        this.db
          .from("tasks")
          .insert({
            owner_id: ownerId,
            ...(id ? { id } : {}),
            ...fields,
            status: fields.status ?? "todo",
            assignee: fields.assignee ?? "user",
          })
          .select("*")
          .single(),
      );
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code === "23505" && id) {
        const existing = await this.one<Task | null>(
          this.db.from("tasks").select("*").eq("id", id).maybeSingle(),
        );
        if (existing?.owner_id === ownerId) return existing;
      }
      throw error;
    }
  }
  async updateTask(ownerId: string, id: string, input: Partial<TaskInput>) {
    const current = await this.one<Task | null>(
      this.db.from("tasks").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle(),
    );
    if (!current) return null;
    const wasDone = current.status === "done";
    const fields = seriesUpdateFields(current, { ...input });
    delete fields.id;
    delete fields.recurrence_scope;
    if (fields.recurrence_frequency && !current.recurrence_series_id) {
      Object.assign(fields, recurrenceFields({ ...current, ...fields }));
    }
    await this.assertOwnedLinks(ownerId, fields);
    const updated = await this.one<Task | null>(
      this.db
        .from("tasks")
        .update(fields)
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    if (!wasDone && updated?.status === "done") {
      const profile = await this.getProfile(ownerId);
      const next = nextRecurringInput(updated, profile?.timezone || "UTC");
      if (next) {
        try {
          await this.createTask(ownerId, next);
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error ? error.code : undefined;
          if (code !== "23505") throw error;
        }
      }
    }
    return updated;
  }
  async resetStaleAiWork(at = new Date(), staleMs = AI_WORK_STALE_MS) {
    const cutoff = new Date(at.getTime() - staleMs).toISOString();
    const rows = await this.many<{ id: string }>(
      this.db
        .from("tasks")
        .update({ status: "todo", agent_locked_at: null, updated_at: at.toISOString() })
        .eq("assignee", "ealzy")
        .eq("status", "in_progress")
        .or(`agent_locked_at.is.null,agent_locked_at.lt.${cutoff}`)
        .select("id"),
    );
    return rows.length;
  }
  async hasFreshAiWorkLock(at = new Date(), staleMs = AI_WORK_STALE_MS, ownerId?: string) {
    const cutoff = new Date(at.getTime() - staleMs).toISOString();
    let query = this.db
      .from("tasks")
      .select("id")
      .eq("assignee", "ealzy")
      .eq("status", "in_progress")
      .gte("agent_locked_at", cutoff);
    if (ownerId) query = query.eq("owner_id", ownerId);
    const row = await this.one<{ id: string } | null>(query.limit(1).maybeSingle());
    return Boolean(row);
  }
  async claimNextAiWork(at = new Date(), maxAttempts = AI_WORK_MAX_ATTEMPTS) {
    await this.resetStaleAiWork(at, AI_WORK_STALE_MS);
    // Занятыми считаем только тех владельцев, у кого уже есть свежая блокировка.
    const cutoff = new Date(at.getTime() - AI_WORK_STALE_MS).toISOString();
    const locked = await this.many<{ owner_id: string }>(
      this.db
        .from("tasks")
        .select("owner_id")
        .eq("assignee", "ealzy")
        .eq("status", "in_progress")
        .gte("agent_locked_at", cutoff),
    );
    const busy = new Set(locked.map((row) => row.owner_id));
    const candidates = (
      await this.many<Task>(
        this.db.from("tasks").select("*").eq("assignee", "ealzy").eq("status", "todo"),
      )
    ).filter((task) => !busy.has(task.owner_id));
    const next = pickNextAiWork(candidates, at, maxAttempts);
    if (!next) return null;
    return this.one<Task | null>(
      this.db
        .from("tasks")
        .update({
          status: "in_progress",
          agent_locked_at: at.toISOString(),
          agent_attempts: (next.agent_attempts ?? 0) + 1,
          updated_at: at.toISOString(),
        })
        .eq("id", next.id)
        .eq("status", "todo")
        .select("*")
        .maybeSingle(),
    );
  }
  async listRecommendations(ownerId: string) {
    const rows = await this.many<Recommendation>(
      this.db
        .from("recommendations")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false }),
    );
    return this.enrichRecommendations(ownerId, rows);
  }
  async getRecommendation(ownerId: string, id: string) {
    const row = await this.one<Recommendation | null>(
      this.db
        .from("recommendations")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("id", id)
        .maybeSingle(),
    );
    return row ? ((await this.enrichRecommendations(ownerId, [row]))[0] ?? null) : null;
  }
  async createRecommendation(ownerId: string, input: RecommendationInput) {
    await this.assertOwnedLinks(ownerId, input);
    return this.one<Recommendation>(
      this.db
        .from("recommendations")
        .insert({ owner_id: ownerId, ...input })
        .select("*")
        .single(),
    );
  }
  async claimTelegramUpdate(updateId: number) {
    const { error } = await this.db.from("telegram_updates").insert({ update_id: updateId });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw error;
  }
  async createMessage(ownerId: string, input: Omit<Message, "id" | "owner_id" | "created_at">) {
    const { data, error } = await this.db
      .from("messages")
      .insert({ owner_id: ownerId, ...input })
      .select("*")
      .single();
    if (error?.code === "23505") return null;
    if (error) throw error;
    return data as Message;
  }
  async deleteMessage(ownerId: string, id: string) {
    return !!(await this.one<Message | null>(
      this.db
        .from("messages")
        .delete()
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("id")
        .maybeSingle(),
    ));
  }
  async getUser(ownerId: string) {
    return this.one<User | null>(this.db.from("users").select("*").eq("id", ownerId).maybeSingle());
  }
  async getProfile(ownerId: string) {
    return this.one<UserProfile | null>(
      this.db.from("user_profiles").select("*").eq("owner_id", ownerId).maybeSingle(),
    );
  }
  async updateProfile(ownerId: string, input: ProfileInput) {
    return this.one<UserProfile | null>(
      this.db.from("user_profiles").update(input).eq("owner_id", ownerId).select("*").maybeSingle(),
    );
  }
  async listNotificationProfiles() {
    return this.many<UserProfile>(this.db.from("user_profiles").select("*"));
  }
  async listReliabilityCohort() {
    const [profiles, tasks] = await Promise.all([
      this.many<Pick<UserProfile, "owner_id" | "timezone">>(
        this.db.from("user_profiles").select("owner_id, timezone"),
      ),
      this.many<{
        owner_id: string;
        status: Task["status"];
        due_at: string | null;
        assignee: Task["assignee"] | null;
        completed_at: string | null;
        updated_at: string | null;
      }>(
        this.db
          .from("tasks")
          .select("owner_id, status, due_at, assignee, completed_at, updated_at")
          .not("due_at", "is", null),
      ),
    ]);
    const byOwner = new Map<string, (typeof tasks)[number][]>();
    for (const task of tasks) {
      const list = byOwner.get(task.owner_id) ?? [];
      list.push(task);
      byOwner.set(task.owner_id, list);
    }
    return profiles.map((profile) => ({
      timezone: profile.timezone || "UTC",
      tasks: (byOwner.get(profile.owner_id) ?? []).map((task) => ({
        status: task.status,
        due_at: task.due_at,
        assignee: task.assignee ?? undefined,
        completed_at: task.completed_at,
        updated_at: task.updated_at,
      })),
    }));
  }
  async getSelfPerson(ownerId: string) {
    const people = await this.listPeople(ownerId);
    return people.find((x) => x.is_self) ?? null;
  }
  async getPrimaryConversation(ownerId: string) {
    const existing = await this.one<Conversation | null>(
      this.db
        .from("conversations")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("is_primary", true)
        .maybeSingle(),
    );
    if (existing) return existing;
    return this.one<Conversation>(
      this.db
        .from("conversations")
        .insert({
          owner_id: ownerId,
          kind: "companion",
          mode: "companion",
          title: "LifeOS",
          is_primary: true,
        })
        .select("*")
        .single(),
    );
  }
  async updateConversationMode(ownerId: string, mode: Conversation["mode"]) {
    const conversation = await this.getPrimaryConversation(ownerId);
    return this.one<Conversation>(
      this.db
        .from("conversations")
        .update({ mode })
        .eq("owner_id", ownerId)
        .eq("id", conversation.id)
        .select("*")
        .single(),
    );
  }
  async listMessages(ownerId: string, conversationId: string, limit = 50) {
    const rows = await this.many<Message>(
      this.db
        .from("messages")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(Math.min(limit, 100)),
    );
    return rows.reverse();
  }
  async updateMessageIntent(ownerId: string, id: string, intent: Message["intent"]) {
    await this.one(
      this.db.from("messages").update({ intent }).eq("owner_id", ownerId).eq("id", id),
    );
  }
  async findMessageByTelegramId(ownerId: string, chatId: number, telegramMessageId: number) {
    return this.one<Message | null>(
      this.db
        .from("messages")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("telegram_chat_id", chatId)
        .eq("telegram_message_id", telegramMessageId)
        .maybeSingle(),
    );
  }
  async updateMessageTelegramId(
    ownerId: string,
    id: string,
    chatId: number,
    telegramMessageId: number,
  ) {
    await this.one(
      this.db
        .from("messages")
        .update({ telegram_chat_id: chatId, telegram_message_id: telegramMessageId })
        .eq("owner_id", ownerId)
        .eq("id", id),
    );
  }
  async listGoals(ownerId: string) {
    return this.many<Goal>(
      this.db.from("goals").select("*").eq("owner_id", ownerId).order("priority"),
    );
  }
  async getGoal(ownerId: string, id: string) {
    return this.one<Goal | null>(
      this.db.from("goals").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle(),
    );
  }
  async createGoal(ownerId: string, input: GoalInput) {
    return this.one<Goal>(
      this.db
        .from("goals")
        .insert({ owner_id: ownerId, ...input })
        .select("*")
        .single(),
    );
  }
  async updateGoal(ownerId: string, id: string, input: Partial<GoalInput>) {
    return this.one<Goal | null>(
      this.db
        .from("goals")
        .update(input)
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
  }
  async deleteGoal(ownerId: string, id: string) {
    return archiveGoalLinkedWork(this, ownerId, id);
  }
  async listPromises(ownerId: string) {
    return this.many<SelfPromise>(
      this.db
        .from("self_promises")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false }),
    );
  }
  async getPromise(ownerId: string, id: string) {
    return this.one<SelfPromise | null>(
      this.db.from("self_promises").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle(),
    );
  }
  async createPromise(ownerId: string, input: PromiseInput) {
    return this.one<SelfPromise>(
      this.db
        .from("self_promises")
        .insert({ owner_id: ownerId, ...input })
        .select("*")
        .single(),
    );
  }
  async updatePromise(ownerId: string, id: string, input: Partial<PromiseInput>) {
    return this.one<SelfPromise | null>(
      this.db
        .from("self_promises")
        .update(input)
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
  }
  async deletePromise(ownerId: string, id: string) {
    return !!(await this.one<SelfPromise | null>(
      this.db
        .from("self_promises")
        .delete()
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("id")
        .maybeSingle(),
    ));
  }
  async listPromiseCheckins(ownerId: string, promiseId?: string) {
    let query = this.db
      .from("self_promise_checkins")
      .select("*")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if (promiseId) query = query.eq("promise_id", promiseId);
    return this.many<SelfPromiseCheckin>(query);
  }
  async createPromiseCheckin(ownerId: string, promiseId: string, input: PromiseCheckinInput) {
    if (!(await this.getPromise(ownerId, promiseId)))
      throw Object.assign(new Error("Promise not found"), { status: 404 });
    return this.one<SelfPromiseCheckin>(
      this.db
        .from("self_promise_checkins")
        .insert({
          owner_id: ownerId,
          promise_id: promiseId,
          status: input.status,
          note: input.note ?? null,
        })
        .select("*")
        .single(),
    );
  }
  async listProjects(ownerId: string) {
    const [projects, goals, spaces] = await Promise.all([
      this.many<Project>(
        this.db.from("projects").select("*").eq("owner_id", ownerId).order("created_at"),
      ),
      this.listGoals(ownerId),
      this.listSpaces(ownerId),
    ]);
    return projects.map((project) => {
      const goal = goals.find((item) => item.id === project.goal_id);
      const space = spaces.find((item) => item.id === project.space_id);
      return {
        ...project,
        goal: goal ? { id: goal.id, title: goal.title } : null,
        space: space ? { id: space.id, name: space.name } : null,
      };
    });
  }
  async getProject(ownerId: string, id: string) {
    return this.one<Project | null>(
      this.db.from("projects").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle(),
    );
  }
  private async assertProjectLinks(ownerId: string, input: Partial<ProjectInput>) {
    if (input.goal_id && !(await this.getGoal(ownerId, input.goal_id)))
      throw Object.assign(new Error("Goal not found"), { status: 400 });
    if (input.space_id && !(await this.getSpace(ownerId, input.space_id)))
      throw Object.assign(new Error("Space not found"), { status: 400 });
  }
  async createProject(ownerId: string, input: ProjectInput) {
    await this.assertProjectLinks(ownerId, input);
    return this.one<Project>(
      this.db
        .from("projects")
        .insert({ owner_id: ownerId, ...input })
        .select("*")
        .single(),
    );
  }
  async updateProject(ownerId: string, id: string, input: Partial<ProjectInput>) {
    await this.assertProjectLinks(ownerId, input);
    return this.one<Project | null>(
      this.db
        .from("projects")
        .update(input)
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
  }
  async deleteProject(ownerId: string, id: string) {
    return !!(await this.one<Project | null>(
      this.db
        .from("projects")
        .delete()
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("id")
        .maybeSingle(),
    ));
  }
  async createRecommendationFeedback(
    ownerId: string,
    recommendationId: string,
    input: Pick<RecommendationFeedback, "item_index" | "outcome" | "note">,
  ) {
    if (!(await this.getRecommendation(ownerId, recommendationId)))
      throw Object.assign(new Error("Recommendation not found"), { status: 404 });
    return this.one<RecommendationFeedback>(
      this.db
        .from("recommendation_feedback")
        .upsert(
          { owner_id: ownerId, recommendation_id: recommendationId, ...input },
          { onConflict: "recommendation_id,item_index" },
        )
        .select("*")
        .single(),
    );
  }
  async listRecommendationFeedback(ownerId: string, limit = 20) {
    return this.many<RecommendationFeedback>(
      this.db
        .from("recommendation_feedback")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false })
        .limit(limit),
    );
  }
  async createReflection(
    ownerId: string,
    input: Omit<Reflection, "id" | "owner_id" | "created_at">,
  ) {
    return this.one<Reflection>(
      this.db
        .from("reflections")
        .insert({ owner_id: ownerId, ...input })
        .select("*")
        .single(),
    );
  }
  async listReflections(ownerId: string) {
    return this.many<Reflection>(
      this.db
        .from("reflections")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false }),
    );
  }
  async createPendingAction(
    ownerId: string,
    input: Omit<PendingAction, "id" | "owner_id" | "created_at">,
  ) {
    return this.one<PendingAction>(
      this.db
        .from("pending_actions")
        .insert({ owner_id: ownerId, ...input })
        .select("*")
        .single(),
    );
  }
  async consumePendingAction(ownerId: string, id: string) {
    return this.one<PendingAction | null>(
      this.db
        .from("pending_actions")
        .delete()
        .eq("owner_id", ownerId)
        .eq("id", id)
        .gt("expires_at", now())
        .select("*")
        .maybeSingle(),
    );
  }
  async findActivePendingAction(ownerId: string, telegramChatId: number, action?: string) {
    let query = this.db
      .from("pending_actions")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("telegram_chat_id", telegramChatId)
      .gt("expires_at", now())
      .order("created_at", { ascending: false })
      .limit(1);
    if (action) query = query.eq("action", action);
    return this.one<PendingAction | null>(query.maybeSingle());
  }
  async listExperiences(ownerId: string, personId?: string) {
    let experienceIds: string[] | null = null;
    if (personId) {
      experienceIds = (
        await this.many<{ experience_id: string }>(
          this.db.from("experience_participants").select("experience_id").eq("person_id", personId),
        )
      ).map((x) => x.experience_id);
      if (!experienceIds.length) return [];
    }
    let query = this.db
      .from("experiences")
      .select("*, experience_participants(person_id, people(id,name))")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false });
    if (experienceIds) query = query.in("id", experienceIds);
    const rows = await this.many<
      Record<string, unknown> & {
        experience_participants?: {
          person_id: string;
          people?: { id: string; name: string } | null;
        }[];
      }
    >(query);
    return rows.map(({ experience_participants, ...experience }) => ({
      ...experience,
      participant_ids: experience_participants?.map((x) => x.person_id) ?? [],
      participants: experience_participants?.flatMap((x) => (x.people ? [x.people] : [])) ?? [],
    })) as Experience[];
  }
  async getExperience(ownerId: string, id: string) {
    return (await this.listExperiences(ownerId)).find((x) => x.id === id) ?? null;
  }
  private async assertExperienceLinks(ownerId: string, input: Partial<ExperienceInput>) {
    for (const personId of input.participant_ids ?? [])
      if (!(await this.getPerson(ownerId, personId)))
        throw Object.assign(new Error("Participant not found"), { status: 400 });
    if (
      input.planned_task_id &&
      !(await this.listTasks(ownerId)).some((x) => x.id === input.planned_task_id)
    )
      throw Object.assign(new Error("Task not found"), { status: 400 });
    if (input.planned_space_id && !(await this.getSpace(ownerId, input.planned_space_id)))
      throw Object.assign(new Error("Space not found"), { status: 400 });
  }
  async createExperience(ownerId: string, input: ExperienceInput) {
    await this.assertExperienceLinks(ownerId, input);
    const { participant_ids = [], ...values } = input;
    const created = await this.one<Experience>(
      this.db
        .from("experiences")
        .insert({ owner_id: ownerId, ...values })
        .select("*")
        .single(),
    );
    if (participant_ids.length)
      await this.one(
        this.db
          .from("experience_participants")
          .insert(participant_ids.map((person_id) => ({ experience_id: created.id, person_id }))),
      );
    return (await this.getExperience(ownerId, created.id))!;
  }
  async updateExperience(ownerId: string, id: string, input: Partial<ExperienceInput>) {
    await this.assertExperienceLinks(ownerId, input);
    const { participant_ids, ...values } = input;
    const updated = await this.one<Experience | null>(
      this.db
        .from("experiences")
        .update(values)
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
    if (!updated) return null;
    if (participant_ids) {
      await this.one(this.db.from("experience_participants").delete().eq("experience_id", id));
      if (participant_ids.length)
        await this.one(
          this.db
            .from("experience_participants")
            .insert(participant_ids.map((person_id) => ({ experience_id: id, person_id }))),
        );
    }
    return this.getExperience(ownerId, id);
  }
  async deleteExperience(ownerId: string, id: string) {
    return !!(await this.one<Experience | null>(
      this.db
        .from("experiences")
        .delete()
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("id")
        .maybeSingle(),
    ));
  }
  async findDueExperienceFollowUps(at = now(), ownerId?: string) {
    let query = this.db
      .from("experiences")
      .select("*, experience_participants(person_id, people(id,name))")
      .eq("status", "planned")
      .not("follow_up_at", "is", null)
      .lte("follow_up_at", at)
      .order("follow_up_at");
    if (ownerId) query = query.eq("owner_id", ownerId);
    const rows = await this.many<
      Record<string, unknown> & {
        experience_participants?: {
          person_id: string;
          people?: { id: string; name: string } | null;
        }[];
      }
    >(query);
    return rows.map(({ experience_participants, ...experience }) => ({
      ...experience,
      participant_ids: experience_participants?.map((x) => x.person_id) ?? [],
      participants: experience_participants?.flatMap((x) => (x.people ? [x.people] : [])) ?? [],
    })) as Experience[];
  }
  async linkExperienceMemory(
    ownerId: string,
    experienceId: string,
    memoryId: string,
    signal: "positive" | "negative",
  ) {
    if (!(await this.getExperience(ownerId, experienceId)))
      throw Object.assign(new Error("Experience not found"), { status: 404 });
    const memory = await this.one<Memory | null>(
      this.db
        .from("memories")
        .select("*, people!inner(owner_id)")
        .eq("id", memoryId)
        .eq("people.owner_id", ownerId)
        .maybeSingle(),
    );
    if (!memory) throw Object.assign(new Error("Memory not found"), { status: 404 });
    await this.one(
      this.db
        .from("experience_memory_updates")
        .upsert({ experience_id: experienceId, memory_id: memoryId, signal }),
    );
  }
  async trackBetaMetric(
    ownerId: string,
    name: BetaMetricName,
    properties: Record<string, unknown> = {},
  ) {
    await this.one(
      this.db
        .from("beta_metrics")
        .upsert(
          { owner_id: ownerId, name, properties },
          { onConflict: "owner_id,name", ignoreDuplicates: true },
        ),
    );
  }
  async replaceCalendarEvents(
    ownerId: string,
    input: { source: "ios"; from: string; to: string; events: CalendarEventInput[] },
  ) {
    await this.one(
      this.db
        .from("calendar_events")
        .delete()
        .eq("owner_id", ownerId)
        .eq("source", input.source)
        .lt("starts_at", input.to)
        .gt("ends_at", input.from),
    );
    if (!input.events.length) return 0;
    // Повторяющееся событие с тем же id и временем телефон может прислать дважды.
    const unique = new Map(input.events.map((e) => [`${e.external_id}|${e.starts_at}`, e]));
    await this.one(
      this.db.from("calendar_events").upsert(
        [...unique.values()].map((event) => ({
          ...event,
          owner_id: ownerId,
          source: input.source,
        })),
        { onConflict: "owner_id,source,external_id,starts_at" },
      ),
    );
    return unique.size;
  }
  async listCalendarEvents(ownerId: string, from: string, to: string) {
    return this.many<CalendarEvent>(
      this.db
        .from("calendar_events")
        .select("*")
        .eq("owner_id", ownerId)
        .lt("starts_at", to)
        .gt("ends_at", from)
        .order("starts_at", { ascending: true })
        .limit(200),
    );
  }
  async listDevices(ownerId: string) {
    return this.many<Device>(this.db.from("devices").select("*").eq("owner_id", ownerId));
  }
  async createAppLoginRequest(nonce: string) {
    await this.one(this.db.from("app_login_requests").insert({ nonce }));
  }
  async approveAppLoginRequest(nonce: string, ownerId: string) {
    const freshSince = new Date(Date.now() - APP_LOGIN_TTL_MS).toISOString();
    const updated = await this.many<{ nonce: string }>(
      this.db
        .from("app_login_requests")
        .update({ owner_id: ownerId, approved_at: now() })
        .eq("nonce", nonce)
        .is("approved_at", null)
        .is("consumed_at", null)
        .gte("created_at", freshSince)
        .select("nonce"),
    );
    if (updated.length) return true;
    // Повтор того же /start (Telegram переотправил вебхук) — не ошибка.
    const row = await this.one<AppLoginRow | null>(
      this.db.from("app_login_requests").select("*").eq("nonce", nonce).maybeSingle(),
    );
    return Boolean(row && row.owner_id === ownerId && !row.consumed_at && !appLoginExpired(row));
  }
  async consumeAppLoginRequest(nonce: string): Promise<AppLoginPoll> {
    const row = await this.one<AppLoginRow | null>(
      this.db.from("app_login_requests").select("*").eq("nonce", nonce).maybeSingle(),
    );
    if (!row || row.consumed_at || appLoginExpired(row)) return { status: "expired" };
    if (!row.approved_at || !row.owner_id) return { status: "pending" };
    const consumed = await this.many<{ owner_id: string }>(
      this.db
        .from("app_login_requests")
        .update({ consumed_at: now() })
        .eq("nonce", nonce)
        .is("consumed_at", null)
        .select("owner_id"),
    );
    if (!consumed.length) return { status: "expired" };
    return { status: "approved", owner_id: row.owner_id };
  }
  async upsertDevice(ownerId: string, input: DeviceInput) {
    return this.one<Device>(
      this.db
        .from("devices")
        .upsert(
          {
            owner_id: ownerId,
            platform: input.platform,
            push_token: input.push_token,
            environment: input.environment,
            app_version: input.app_version ?? null,
          },
          { onConflict: "platform,push_token" },
        )
        .select("*")
        .single(),
    );
  }
  async deleteDevice(ownerId: string, pushToken: string) {
    await this.one(
      this.db.from("devices").delete().eq("owner_id", ownerId).eq("push_token", pushToken),
    );
  }
  async trackEvents(
    ownerId: string,
    events: { name: string; properties?: Record<string, unknown> }[],
  ) {
    if (!events.length) return;
    const rows = events.map((e) => ({
      owner_id: ownerId,
      name: e.name,
      properties: e.properties ?? {},
    }));
    await this.one(this.db.from("events").insert(rows));
  }
  async incrementUsage(
    ownerId: string,
    input: {
      metric: string;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    },
    at = new Date(),
  ) {
    const used_on = at.toISOString().slice(0, 10);
    const metric = input.metric.slice(0, 40) || "other";
    await this.one(
      this.db.rpc("increment_usage_counters", {
        p_owner_id: ownerId,
        p_used_on: used_on,
        p_metric: metric,
        p_prompt_tokens: Math.max(0, Math.trunc(input.prompt_tokens)),
        p_completion_tokens: Math.max(0, Math.trunc(input.completion_tokens)),
        p_total_tokens: Math.max(0, Math.trunc(input.total_tokens)),
      }),
    );
    const rows = await this.listUsageCounters(ownerId, used_on, used_on);
    return (
      rows.find((row) => row.metric === metric) ?? {
        owner_id: ownerId,
        used_on,
        metric,
        prompt_tokens: Math.max(0, Math.trunc(input.prompt_tokens)),
        completion_tokens: Math.max(0, Math.trunc(input.completion_tokens)),
        total_tokens: Math.max(0, Math.trunc(input.total_tokens)),
        call_count: 1,
        updated_at: now(),
      }
    );
  }
  async listUsageHours(ownerId: string, since: string) {
    const rows = await this.many<UsageHour>(
      this.db
        .from("usage_hours")
        .select("*")
        .eq("owner_id", ownerId)
        .gte("hour_start", since)
        .order("hour_start", { ascending: true }),
    );
    return rows.map((row) => ({
      ...row,
      hour_start: new Date(row.hour_start).toISOString(),
      total_tokens: Number(row.total_tokens),
    }));
  }
  async listQuotaPlans() {
    const rows = await this.many<QuotaPlan>(
      this.db.from("quota_plans").select("*").order("plan", { ascending: true }),
    );
    return rows.map((row) => ({
      ...row,
      period_tokens: Number(row.period_tokens),
      window_tokens: Number(row.window_tokens),
    }));
  }
  async updateQuotaPlan(
    plan: string,
    input: Partial<Pick<QuotaPlan, "period" | "period_tokens" | "window_hours" | "window_tokens">>,
  ) {
    const row = await this.one<QuotaPlan | null>(
      this.db
        .from("quota_plans")
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq("plan", plan)
        .select("*")
        .maybeSingle(),
    );
    return row
      ? {
          ...row,
          period_tokens: Number(row.period_tokens),
          window_tokens: Number(row.window_tokens),
        }
      : null;
  }
  async getQuotaEnforced() {
    const row = await this.one<{ enforced: boolean } | null>(
      this.db.from("quota_settings").select("enforced").eq("id", true).maybeSingle(),
    );
    return row?.enforced ?? false;
  }
  async setQuotaEnforced(enforced: boolean) {
    await this.one(
      this.db
        .from("quota_settings")
        .upsert({ id: true, enforced, updated_at: new Date().toISOString() }),
    );
  }
  async getUserPlan(ownerId: string) {
    return this.one<UserPlan | null>(
      this.db.from("user_plans").select("*").eq("owner_id", ownerId).maybeSingle(),
    );
  }
  async setUserPlan(ownerId: string, plan: string, until: string | null) {
    return this.one<UserPlan>(
      this.db
        .from("user_plans")
        .upsert({
          owner_id: ownerId,
          plan,
          plan_until: until,
          updated_at: new Date().toISOString(),
        })
        .select("*")
        .single(),
    );
  }
  async isAdmin(ownerId: string) {
    const row = await this.one<{ owner_id: string } | null>(
      this.db.from("app_admins").select("owner_id").eq("owner_id", ownerId).maybeSingle(),
    );
    return Boolean(row);
  }
  async claimFirstAdmin(ownerId: string) {
    const existing = await this.many<{ owner_id: string }>(
      this.db.from("app_admins").select("owner_id").limit(1),
    );
    if (existing.length) return this.isAdmin(ownerId);
    await this.one(this.db.from("app_admins").insert({ owner_id: ownerId }));
    return true;
  }
  async findUserByHandle(handle: string) {
    const value = handle.trim().replace(/^@/, "");
    if (/^[0-9a-f-]{36}$/i.test(value)) return this.getUser(value.toLowerCase());
    if (/^\d+$/.test(value)) {
      return this.one<User | null>(
        this.db.from("users").select("*").eq("telegram_id", Number(value)).maybeSingle(),
      );
    }
    const column = value.includes("@") ? "email" : "username";
    const rows = await this.many<User>(
      this.db.from("users").select("*").ilike(column, value).limit(1),
    );
    return rows[0] ?? null;
  }
  async listUsageCounters(ownerId: string, from: string, to: string) {
    return this.many<UsageCounter>(
      this.db
        .from("usage_counters")
        .select("*")
        .eq("owner_id", ownerId)
        .gte("used_on", from)
        .lte("used_on", to)
        .order("used_on", { ascending: true })
        .order("metric", { ascending: true }),
    );
  }
  async createImportSession(
    ownerId: string,
    input: { source: ImportSource; items: ImportItem[]; access_token?: string | null },
  ) {
    return this.one<ImportSession>(
      this.db
        .from("import_sessions")
        .insert({
          owner_id: ownerId,
          source: input.source,
          items: input.items,
          access_token: input.access_token ?? null,
        })
        .select("*")
        .single(),
    );
  }
  async getImportSession(ownerId: string, id: string) {
    return this.one<ImportSession | null>(
      this.db
        .from("import_sessions")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("id", id)
        .maybeSingle(),
    );
  }
  async updateImportSession(
    ownerId: string,
    id: string,
    input: Partial<
      Pick<ImportSession, "status" | "items" | "access_token" | "log" | "confirmed_at">
    >,
  ) {
    return this.one<ImportSession | null>(
      this.db
        .from("import_sessions")
        .update(input)
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
  }
  async listMailAccounts(ownerId: string) {
    const rows = await this.many<MailAccount>(
      this.db
        .from("mail_accounts")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false }),
    );
    return rows.map(publicMailAccount);
  }
  async getMailAccountSecret(ownerId: string, id: string) {
    return this.one<MailAccount | null>(
      this.db.from("mail_accounts").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle(),
    );
  }
  async listMailAccountsDueForSync() {
    return this.many<MailAccount>(
      this.db.from("mail_accounts").select("*").neq("status", "disabled"),
    );
  }
  async createMailAccount(ownerId: string, input: MailAccountInput) {
    return this.one<MailAccount>(
      this.db
        .from("mail_accounts")
        .insert({ owner_id: ownerId, ...input })
        .select("*")
        .single(),
    );
  }
  async updateMailAccount(
    ownerId: string,
    id: string,
    input: Partial<
      Omit<MailAccountInput, "email" | "secret_cipher"> & Pick<MailAccount, "secret_cipher">
    >,
  ) {
    return this.one<MailAccount | null>(
      this.db
        .from("mail_accounts")
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
  }
  async deleteMailAccount(ownerId: string, id: string) {
    return !!(await this.one<MailAccount | null>(
      this.db
        .from("mail_accounts")
        .delete()
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("id")
        .maybeSingle(),
    ));
  }
  async listMailMessages(ownerId: string, limit = 50) {
    return this.many<MailMessage>(
      this.db
        .from("mail_messages")
        .select("*")
        .eq("owner_id", ownerId)
        .order("received_at", { ascending: false, nullsFirst: false })
        .limit(limit),
    );
  }
  async getMailMessage(ownerId: string, id: string) {
    return this.one<MailMessage | null>(
      this.db.from("mail_messages").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle(),
    );
  }
  async upsertMailMessage(ownerId: string, input: MailMessageInput) {
    return this.one<MailMessage>(
      this.db
        .from("mail_messages")
        .upsert({ owner_id: ownerId, ...input }, { onConflict: "account_id,provider_uid" })
        .select("*")
        .single(),
    );
  }
  async updateMailMessage(
    ownerId: string,
    id: string,
    input: Partial<Pick<MailMessage, "handled" | "is_important" | "is_meeting" | "meeting_at">>,
  ) {
    return this.one<MailMessage | null>(
      this.db
        .from("mail_messages")
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
  }
  async listMailDrafts(ownerId: string) {
    return this.many<MailDraft>(
      this.db
        .from("mail_drafts")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false }),
    );
  }
  async getMailDraft(ownerId: string, id: string) {
    return this.one<MailDraft | null>(
      this.db.from("mail_drafts").select("*").eq("owner_id", ownerId).eq("id", id).maybeSingle(),
    );
  }
  async createMailDraft(ownerId: string, input: MailDraftInput) {
    return this.one<MailDraft>(
      this.db
        .from("mail_drafts")
        .insert({ owner_id: ownerId, ...input })
        .select("*")
        .single(),
    );
  }
  async updateMailDraft(ownerId: string, id: string, input: Partial<MailDraftInput>) {
    return this.one<MailDraft | null>(
      this.db
        .from("mail_drafts")
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
  }
  async deleteMailDraft(ownerId: string, id: string) {
    return !!(await this.one<MailDraft | null>(
      this.db
        .from("mail_drafts")
        .delete()
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("id")
        .maybeSingle(),
    ));
  }
  async listMailPlaybooks(ownerId: string) {
    return this.many<MailPlaybook>(
      this.db
        .from("mail_playbooks")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: true }),
    );
  }
  async createMailPlaybook(ownerId: string, input: MailPlaybookInput) {
    return this.one<MailPlaybook>(
      this.db
        .from("mail_playbooks")
        .insert({ owner_id: ownerId, ...input })
        .select("*")
        .single(),
    );
  }
  async updateMailPlaybook(ownerId: string, id: string, input: Partial<MailPlaybookInput>) {
    return this.one<MailPlaybook | null>(
      this.db
        .from("mail_playbooks")
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("*")
        .maybeSingle(),
    );
  }
  async deleteMailPlaybook(ownerId: string, id: string) {
    return !!(await this.one<MailPlaybook | null>(
      this.db
        .from("mail_playbooks")
        .delete()
        .eq("owner_id", ownerId)
        .eq("id", id)
        .select("id")
        .maybeSingle(),
    ));
  }
  private async enrichRecommendations(ownerId: string, rows: Recommendation[]) {
    const [people, spaces, tasks] = await Promise.all([
      this.listPeople(ownerId),
      this.listSpaces(ownerId),
      this.listTasks(ownerId),
    ]);
    return rows.map((recommendation) => {
      const person = people.find((item) => item.id === recommendation.person_id);
      const space = spaces.find((item) => item.id === recommendation.space_id);
      const task = tasks.find((item) => item.id === recommendation.task_id);
      return {
        ...recommendation,
        person: person ? { id: person.id, name: person.name } : null,
        space: space ? { id: space.id, name: space.name } : null,
        task: task ? { id: task.id, title: task.title } : null,
      };
    });
  }
}
