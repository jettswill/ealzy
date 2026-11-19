export type MemoryCategory =
  | "interest"
  | "dislike"
  | "favorite_place"
  | "favorite_food"
  | "gift"
  | "size"
  | "dream"
  | "important_date"
  | "story"
  | "personality"
  | "experience"
  | "preference"
  | "skill"
  | "important_event"
  | "important_fact"
  | "other";
export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";
export type TaskAssignee = "user" | "ealzy";
export type TaskKind = "task" | "meeting";
export type TaskActivityType =
  "development" | "routine" | "entertainment" | "household" | "degradation";
export type TaskRecurrenceFrequency = "daily" | "weekly" | "monthly";
export type AssistantIntent =
  | "remember"
  | "recommend"
  | "create_task"
  | "create_space"
  | "create_goal"
  | "create_project"
  | "query_memory"
  | "organize_event"
  | "companion"
  | "reflection"
  | "experience"
  | "other";
export type SourceChannel = "telegram" | "mini_app" | "system";

export interface User {
  id: string;
  telegram_id: number | null;
  name: string;
  username: string | null;
  auth_user_id: string | null;
  email: string | null;
  is_guest?: boolean;
  created_at: string;
}
export interface PersonLocation {
  id: string;
  person_id: string;
  label: string | null;
  city: string;
  address: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}
export type PersonDateKind = "birthday" | "met" | "wedding" | "anniversary" | "other";
export interface PersonDate {
  id: string;
  person_id: string;
  kind: PersonDateKind;
  label: string | null;
  month: number;
  day: number;
  year: number | null;
  created_at: string;
  updated_at: string;
}
export interface Person {
  id: string;
  owner_id: string;
  name: string;
  relationship: string | null;
  description: string | null;
  aliases: string[];
  is_self: boolean;
  locations?: PersonLocation[];
  dates?: PersonDate[];
  created_at: string;
  updated_at: string;
}
export interface Memory {
  id: string;
  person_id: string;
  content: string;
  category: MemoryCategory;
  importance: number;
  confidence: number;
  source_message_id: string | null;
  occurred_at: string | null;
  metadata: Record<string, unknown>;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}
export interface Space {
  id: string;
  owner_id: string;
  name: string;
  type: string;
  context: string | null;
  person_ids: string[];
  created_at: string;
  updated_at: string;
  people?: Person[];
  tasks?: Task[];
}
export interface Task {
  id: string;
  owner_id: string;
  space_id: string | null;
  person_id: string | null;
  goal_id: string | null;
  project_id: string | null;
  source_note_id?: string | null;
  due_at: string | null;
  estimate_minutes?: number | null;
  completed_at: string | null;
  sort_order?: number | null;
  recurrence_frequency?: TaskRecurrenceFrequency | null;
  recurrence_series_id?: string | null;
  recurrence_anchor_at?: string | null;
  recurrence_template?: Record<string, unknown> | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  kind?: TaskKind;
  activity_type?: TaskActivityType | null;
  value_score?: number | null;
  importance?: number;
  urgency?: number;
  assignee?: TaskAssignee;
  agent_locked_at?: string | null;
  agent_attempts?: number;
  agent_result?: string | null;
  created_at: string;
  updated_at: string;
  person?: Pick<Person, "id" | "name"> | null;
  space?: Pick<Space, "id" | "name"> | null;
  goal?: Pick<Goal, "id" | "title"> | null;
  project?: Pick<Project, "id" | "name"> | null;
}
export interface RecommendationProvenance {
  type: "memory" | "experience" | "profile" | "generic";
  id?: string;
  label?: string;
  detail?: string;
}
export interface RecommendationItem {
  title: string;
  rationale: string;
  memory_ids?: string[];
  experience_ids?: string[];
  is_generic?: boolean;
  provenance?: RecommendationProvenance[];
}
export interface Recommendation {
  id: string;
  owner_id: string;
  person_id: string | null;
  space_id: string | null;
  task_id: string | null;
  query: string;
  items: RecommendationItem[];
  memory_ids: string[];
  experience_ids: string[];
  created_at: string;
  person?: Pick<Person, "id" | "name"> | null;
  space?: Pick<Space, "id" | "name"> | null;
  task?: Pick<Task, "id" | "title"> | null;
}
export interface RecommendationFeedback {
  id: string;
  recommendation_id: string;
  owner_id: string;
  item_index: number;
  outcome: "liked" | "disliked" | "used";
  note: string | null;
  created_at: string;
  updated_at: string;
}
export interface Message {
  id: string;
  owner_id: string;
  conversation_id: string;
  telegram_chat_id: number | null;
  telegram_message_id: number | null;
  role: "user" | "assistant" | "system";
  content: string;
  intent: AssistantIntent | null;
  source_channel: SourceChannel;
  metadata: Record<string, unknown>;
  created_at: string;
}
export interface Conversation {
  id: string;
  owner_id: string;
  kind: "companion" | "system";
  mode: "command" | "companion";
  title: string | null;
  summary: string | null;
  is_primary: boolean;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}
export type ScheduledNotificationKind = "morning_digest" | "weekly_digest" | "evening_sync";
export interface UserProfile {
  owner_id: string;
  self_person_id: string;
  bio: string | null;
  values: string[];
  communication_style: string | null;
  timezone: string;
  locale: string;
  context_summary: string | null;
  weekly_reflection_enabled: boolean;
  morning_digest_enabled: boolean;
  morning_digest_time: string;
  weekly_digest_enabled: boolean;
  weekly_digest_time: string;
  evening_sync_enabled: boolean;
  evening_sync_time: string;
  last_morning_digest_on: string | null;
  last_weekly_digest_on: string | null;
  last_evening_sync_on: string | null;
  last_goal_checkin_on: string | null;
  onboarding_completed_at: string | null;
  last_active_at: string | null;
  last_reengagement_at: string | null;
  reengagement_enabled: boolean;
  updated_at: string;
}
export interface Me {
  user: User;
  profile: UserProfile;
  self: PersonProfile;
}
export interface GoalStats {
  task_count: number;
  done_count: number;
  open_count: number;
  progress: number;
  days_active: number;
}
export interface Goal {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  status: "active" | "completed" | "paused" | "cancelled";
  horizon: "short" | "medium" | "long" | null;
  priority: number;
  target_date: string | null;
  source_note_id?: string | null;
  current_plan?: string | null;
  plan_revised_at?: string | null;
  created_at: string;
  updated_at: string;
  stats?: GoalStats;
  tasks?: Task[];
}
export type SelfPromiseStatus = "active" | "paused" | "retired";
export type SelfPromiseCheckinStatus = "keeping" | "struggling" | "broken";
export interface SelfPromiseStats {
  keeping_days: number;
  keeping_count: number;
  struggling_count: number;
  broken_count: number;
  last_checkin_at: string | null;
  last_checkin_status: SelfPromiseCheckinStatus | null;
  due_for_checkin: boolean;
  praise_days: number | null;
}
export interface SelfPromiseCheckin {
  id: string;
  owner_id: string;
  promise_id: string;
  status: SelfPromiseCheckinStatus;
  note: string | null;
  created_at: string;
}
export interface SelfPromise {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  status: SelfPromiseStatus;
  started_at: string;
  created_at: string;
  updated_at: string;
  stats?: SelfPromiseStats;
  recent_checkins?: SelfPromiseCheckin[];
}
export interface Project {
  id: string;
  owner_id: string;
  goal_id: string | null;
  space_id: string | null;
  name: string;
  description: string | null;
  status: "active" | "completed" | "paused" | "cancelled";
  created_at: string;
  updated_at: string;
  goal?: Pick<Goal, "id" | "title"> | null;
  space?: Pick<Space, "id" | "name"> | null;
}
export interface Reflection {
  id: string;
  owner_id: string;
  period_start: string;
  period_end: string;
  wins: string[];
  improvements: string[];
  next_steps: string[];
  source_snapshot: Record<string, unknown>;
  created_at: string;
}
export interface UsageCounter {
  owner_id: string;
  used_on: string;
  metric: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  call_count: number;
  updated_at: string;
}
export type QuotaPeriod = "week" | "month";
export interface QuotaPlan {
  plan: string;
  title: string;
  period: QuotaPeriod;
  period_tokens: number;
  window_hours: number;
  window_tokens: number;
  updated_at: string;
}
export interface UserPlan {
  owner_id: string;
  plan: string;
  plan_until: string | null;
  updated_at: string;
}
export interface UsageHour {
  owner_id: string;
  hour_start: string;
  total_tokens: number;
  call_count: number;
}
export interface PendingAction {
  id: string;
  owner_id: string;
  telegram_chat_id: number;
  action: string;
  payload: Record<string, unknown>;
  expires_at: string;
  created_at: string;
}
export type MailProvider = "gmail" | "yandex" | "mailru" | "outlook" | "custom";
export type MailAccountStatus = "active" | "error" | "disabled";
export type MailDraftStatus = "draft" | "sent" | "failed";
export type MailPlaybookTrigger = "important" | "meeting" | "unread" | "custom";
export type MailPlaybookAction = "summarize" | "create_task" | "draft_reply";

export interface MailAccount {
  id: string;
  owner_id: string;
  email: string;
  provider: MailProvider;
  username: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  secret_cipher: string;
  status: MailAccountStatus;
  last_error: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export type MailAccountPublic = Omit<MailAccount, "secret_cipher">;

export interface MailMessage {
  id: string;
  owner_id: string;
  account_id: string;
  provider_uid: string;
  from_address: string;
  from_name: string | null;
  to_address: string | null;
  subject: string;
  snippet: string;
  received_at: string | null;
  is_important: boolean;
  is_meeting: boolean;
  meeting_at: string | null;
  has_calendar_invite: boolean;
  handled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MailDraft {
  id: string;
  owner_id: string;
  account_id: string;
  message_id: string | null;
  to_address: string;
  subject: string;
  body: string;
  status: MailDraftStatus;
  error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MailPlaybook {
  id: string;
  owner_id: string;
  account_id: string | null;
  name: string;
  trigger: MailPlaybookTrigger;
  actions: MailPlaybookAction[];
  prompt: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CalendarEvent {
  id: string;
  owner_id: string;
  source: "ios";
  external_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  calendar_title: string | null;
  created_at: string;
}
/** Привязка обычной заметки к встрече из календаря телефона. */
export interface MeetingNoteLink {
  owner_id: string;
  note_id: string;
  event_external_id: string;
  event_starts_at: string;
  event_ends_at: string;
  event_title: string;
  created_at: string;
  updated_at: string;
}
/** Заметка со встречи — то, что видит Илзи. */
export interface MeetingNoteContext {
  title: string;
  starts_at: string;
  ends_at: string;
  notes: string;
  updated_at: string;
}
export type CalendarEventInput = Pick<
  CalendarEvent,
  "external_id" | "title" | "starts_at" | "ends_at" | "all_day" | "location" | "calendar_title"
>;
export interface PersonalContext {
  profile: Pick<
    UserProfile,
    | "bio"
    | "values"
    | "communication_style"
    | "timezone"
    | "locale"
    | "last_goal_checkin_on"
    | "context_summary"
    | "weekly_reflection_enabled"
    | "morning_digest_enabled"
    | "morning_digest_time"
    | "weekly_digest_enabled"
    | "weekly_digest_time"
    | "evening_sync_enabled"
    | "evening_sync_time"
    | "reengagement_enabled"
  >;
  telegram_linked: boolean;
  known_patterns: { kind: string; detail: string }[];
  self_memories: Memory[];
  self_gender?: "female" | "male" | "unknown";
  goals: Goal[];
  promises: SelfPromise[];
  projects: Project[];
  tasks: Task[];
  goal_history_tasks: Task[];
  spaces: Space[];
  recent_messages: Message[];
  people_index: {
    id: string;
    name: string;
    relationship: string | null;
    city: string | null;
    birthday: string | null;
  }[];
  relevant_people: PersonProfile[];
  relevant_person: PersonProfile | null;
  self_locations: PersonLocation[];
  recommendation_feedback: RecommendationFeedback[];
  experiences: Experience[];
  mail_accounts: MailAccountPublic[];
  mail_messages: MailMessage[];
  mail_drafts: MailDraft[];
  mail_playbooks: MailPlaybook[];
  /** События календаря с телефона на ближайшие дни; нет у тех, кто не подключал. */
  calendar_events?: CalendarEvent[];
  /** Свежие заметки, которые человек писал на встречах. */
  meeting_notes?: MeetingNoteContext[];
  /** Идеи «чем заняться» из справочника — только когда человек спрашивает, куда сходить. */
  activity_ideas?: ActivityIdea[];
  upcoming_dates: {
    person: string | null;
    person_id?: string | null;
    relationship?: string | null;
    gender?: "female" | "male" | "unknown";
    label: string;
    date: string;
    days_until: number;
    kind: "birthday" | "holiday" | "date";
    gift_history?: string[];
    tastes?: string[];
  }[];
  city: string;
  overflow: {
    extra_tasks: number;
    extra_overdue: number;
    extra_goals: number;
    extra_projects: number;
    extra_spaces: number;
  };
  discovery_results: {
    kind: "product" | "place" | "shop" | "web";
    title: string;
    subtitle: string;
    url: string;
    price: string | null;
    source: string;
  }[];
}
export type ExperienceType =
  "restaurant" | "theater" | "trip" | "event" | "gift" | "activity" | "other";
export interface Experience {
  id: string;
  owner_id: string;
  type: ExperienceType;
  title: string;
  place: string | null;
  description: string | null;
  occurred_at: string | null;
  positive_signals: string[];
  negative_signals: string[];
  emotions: string[];
  outcome: string | null;
  source_message_id: string | null;
  planned_task_id: string | null;
  planned_space_id: string | null;
  follow_up_at: string | null;
  status: "planned" | "completed" | "follow_up_due";
  participant_ids: string[];
  participants?: Pick<Person, "id" | "name">[];
  created_at: string;
  updated_at: string;
}
export interface PersonProfile extends Person {
  memories: Memory[];
}
export type PersonResolution =
  | { status: "unique"; person: Person }
  | { status: "ambiguous"; people: Person[] }
  | { status: "not_found"; people: [] };

export type ImportSource = "todoist" | "text";
export type ImportStatus = "preview" | "confirmed" | "cancelled";
export type ImportItemKind = "project" | "task";

export interface ImportItem {
  id: string;
  kind: ImportItemKind;
  title: string;
  due_at: string | null;
  importance: number | null;
  project_title: string | null;
  source_id: string | null;
  duplicate: boolean;
}

export interface ImportSession {
  id: string;
  owner_id: string;
  source: ImportSource;
  status: ImportStatus;
  items: ImportItem[];
  access_token: string | null;
  log: Record<string, unknown>;
  created_at: string;
  confirmed_at: string | null;
}

export type {
  Note,
  NoteActionPreview,
  NoteActionProposal,
  NoteContent,
  NoteMutation,
  NoteRevision,
} from "@lifeos/contracts";

/** Справочник «чем заняться»: категории и типы активностей, общие для всех. */
export interface ActivityCategory {
  id: string;
  name: string;
  emoji: string | null;
  sort: number;
}
export type ActivitySeason = "all" | "warm" | "summer" | "winter";
export type ActivitySetting = "indoor" | "outdoor" | "both";
export interface ActivityType {
  id: string;
  category_id: string;
  name: string;
  emoji: string | null;
  description: string | null;
  /** 1 — сидя, 5 — выжимает все силы. */
  activity_level: number;
  /** 1 — спокойно, 5 — адреналин. */
  emotion_level: number;
  /** 1 — до 1000 ₽, 2 — 1–3 тыс., 3 — 3–7 тыс., 4 — от 7 тыс. с человека. */
  price_level: number;
  duration_hours: number;
  season: ActivitySeason;
  setting: ActivitySetting;
  min_people: number;
  kids_ok: boolean;
  search_query: string | null;
  geo: string | null;
  sort: number;
}
export interface ActivityCatalog {
  categories: ActivityCategory[];
  types: ActivityType[];
}
/** Конкретное место; activity_type_ids — все типы, под которые оно подходит. */
export interface Place {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  description: string | null;
  image_url: string | null;
  photos: string[];
  phone: string | null;
  website: string | null;
  hours: string | null;
  price_from: number | null;
  yandex_org_id: string | null;
  yandex_url: string | null;
  yandex_rating: number | null;
  yandex_reviews: number | null;
  twogis_url: string | null;
  source: string;
  /** Рейтинг каталога, из которого место пришло (2ГИС и т. п.). */
  rating?: number | null;
  rating_count?: number | null;
  rating_source?: string | null;
  activity_type_ids: string[];
}
/** Место из внешнего поиска: в базу попадает, только когда с ним что-то сделали. */
export interface PlaceCandidate {
  /** web — найдено веб-поиском Илзи, когда в каталоге карт под тип пусто. */
  source: "2gis" | "osm" | "web";
  source_id: string;
  name: string;
  address: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  rating: number | null;
  rating_count: number | null;
  image_url: string | null;
  photos: string[];
  phone: string | null;
  website: string | null;
  hours: string | null;
  twogis_url: string | null;
  distance_m: number | null;
  maps_url: string;
  /** Короткая строка «что это» — у мест из интернета. */
  note?: string | null;
}
export type PlaceVisitStatus = "visited" | "want" | "skip";
/** Впечатление после визита. */
export type PlaceEmotion = "wow" | "good" | "meh" | "bad";
/** Дневник человека: где был, куда хочет, что не предлагать. */
export interface PlaceVisit {
  id: string;
  owner_id: string;
  place_id: string | null;
  activity_type_id: string | null;
  title: string | null;
  city: string | null;
  status: PlaceVisitStatus;
  rating: number | null;
  emotion?: PlaceEmotion | null;
  note: string | null;
  visited_on: string | null;
  created_at: string;
  updated_at: string;
}
export type PlaceVisitInput = Pick<
  PlaceVisit,
  | "place_id"
  | "activity_type_id"
  | "title"
  | "city"
  | "status"
  | "rating"
  | "emotion"
  | "note"
  | "visited_on"
>;
export type TasteTargetKind = "type" | "category";
/** Вкус человека по типу или категории активностей. */
export interface ActivityPreference {
  owner_id: string;
  target_kind: TasteTargetKind;
  target_id: string;
  /** Сказал сам. */
  verdict: "like" | "never" | null;
  /** Из оценок после визитов, −1…1. */
  visit_affinity: number;
  /** Гипотеза нейросети, −1…1. */
  ai_affinity: number;
  ai_reason: string | null;
  updated_at: string;
}
export type ActivityPreferencePatch = Pick<ActivityPreference, "target_kind" | "target_id"> &
  Partial<Pick<ActivityPreference, "verdict" | "visit_affinity" | "ai_affinity" | "ai_reason">>;
export interface ActivityTasteProfile {
  owner_id: string;
  summary: string | null;
  refreshed_at: string | null;
}
/** Что сохраняем из внешнего поиска, когда человек отметил место. */
export type PlaceUpsertInput = Omit<PlaceCandidate, "distance_m" | "maps_url">;
/** Идея «чем заняться», которую Илзи видит в workspace. */
export interface ActivityIdea {
  type_id: string;
  name: string;
  category: string;
  emoji: string | null;
  price_level: number;
  activity_level: number;
  emotion_level: number;
  setting: ActivitySetting;
  search_query: string | null;
  tried: boolean;
  /** Что известно про вкус человека к этому: «тебе понравилось в прошлый раз». */
  taste?: string | null;
  places: { id: string; name: string; address: string | null; rating: number | null }[];
}

/** Вращение колеса «Удиви меня». */
export interface ActivitySpin {
  id: string;
  owner_id: string;
  local_date: string;
  request: Record<string, unknown>;
  feedback: string | null;
  segment_ids: string[];
  result_type_id: string | null;
  created_at: string;
}
export type ActivitySpinInput = Pick<
  ActivitySpin,
  "local_date" | "request" | "feedback" | "segment_ids" | "result_type_id"
>;
