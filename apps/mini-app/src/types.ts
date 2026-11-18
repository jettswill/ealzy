export const memoryCategories = [
  "interest",
  "dislike",
  "favorite_place",
  "favorite_food",
  "gift",
  "important_date",
  "story",
  "personality",
  "dream",
  "size",
  "preference",
  "skill",
  "important_event",
  "important_fact",
  "experience",
  "other",
] as const;

export type MemoryCategory = (typeof memoryCategories)[number];
export type TaskStatus = "todo" | "in_progress" | "done" | "cancelled";
export type TaskAssignee = "user" | "ealzy";
export type TaskKind = "task" | "meeting";
export type TaskActivityType =
  "development" | "routine" | "entertainment" | "household" | "degradation";
export type TaskRecurrenceFrequency = "daily" | "weekly" | "monthly";

export type RichTextNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: RichTextNode[];
};

export type RichTextDocument = RichTextNode & {
  type: "doc";
  content?: RichTextNode[];
};

export type NoteSyncStatus = "local" | "syncing" | "synced" | "error" | "conflict";

export interface Note {
  id: string;
  title: string;
  content: RichTextDocument;
  plain_text: string;
  revision: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  pending_sync?: boolean;
  sync_status?: NoteSyncStatus;
}

export type NoteActionKind = "plan" | "goal" | "tasks";

export interface NoteActionDraft {
  id: string;
  note_id: string;
  action: NoteActionKind;
  payload: {
    goal?: { title: string; description?: string | null; current_plan?: string | null };
    tasks?: { title: string; description?: string | null }[];
  };
  expires_at?: string;
  confirmed_at?: string | null;
}

export interface NoteActionResult {
  draft: NoteActionDraft;
  entities: EntityLink[];
}

export interface PersonLocation {
  id: string;
  person_id: string;
  label: string | null;
  city: string;
  address: string | null;
  is_primary: boolean;
  created_at?: string;
  updated_at?: string;
}

export const personDateKinds = ["birthday", "met", "wedding", "anniversary", "other"] as const;
export type PersonDateKind = (typeof personDateKinds)[number];

export interface PersonDate {
  id: string;
  person_id: string;
  kind: PersonDateKind;
  label: string | null;
  month: number;
  day: number;
  year: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface Person {
  id: string;
  name: string;
  relationship: string | null;
  description: string | null;
  /** Карточка самого пользователя: сервер хранит её среди людей. */
  is_self?: boolean;
  aliases?: string[];
  locations?: PersonLocation[];
  dates?: PersonDate[];
  created_at?: string;
  updated_at?: string;
}

export interface Memory {
  id: string;
  person_id: string;
  content: string;
  category: MemoryCategory;
  importance?: number;
  confidence?: number;
  source_message_id?: string | null;
  source?: string | null;
  occurred_at?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface PersonDetail extends Person {
  memories: Memory[];
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  person_id?: string | null;
  person?: Pick<Person, "id" | "name"> | null;
  space_id?: string | null;
  space?: Pick<Space, "id" | "name"> | null;
  goal_id?: string | null;
  goal?: Pick<Goal, "id" | "title"> | null;
  project_id?: string | null;
  project?: Pick<Project, "id" | "name"> | null;
  due_at?: string | null;
  due_date?: string | null;
  estimate_minutes?: number | null;
  completed_at?: string | null;
  sort_order?: number | null;
  recurrence_frequency?: TaskRecurrenceFrequency | null;
  recurrence_series_id?: string | null;
  recurrence_anchor_at?: string | null;
  kind?: TaskKind;
  activity_type?: TaskActivityType | null;
  value_score?: number | null;
  importance?: number | null;
  urgency?: number | null;
  assignee?: TaskAssignee;
  created_at?: string;
  updated_at?: string;
  pending_sync?: boolean;
}

export interface Space {
  id: string;
  name: string;
  type?: string;
  context: string | null;
  people?: Person[];
  participants?: Person[];
  tasks?: Task[];
  created_at?: string;
  updated_at?: string;
}

export interface RecommendationItem {
  title: string;
  rationale: string;
  url?: string | null;
  link?: string | null;
  experience_ids?: string[];
  provenance?: {
    type: "memory" | "experience" | "profile" | "generic";
    id?: string;
    label?: string;
    detail?: string;
  }[];
}

export type RecommendationOutcome = "liked" | "disliked" | "used";

export interface Recommendation {
  id: string;
  query: string;
  items: RecommendationItem[];
  person_id?: string | null;
  person?: Pick<Person, "id" | "name"> | null;
  task_id?: string | null;
  task?: Pick<Task, "id" | "title"> | null;
  space_id?: string | null;
  space?: Pick<Space, "id" | "name"> | null;
  created_at?: string;
}

export interface Session {
  token: string;
  expires_at?: string;
}

export type ReliabilityPraise = "none" | "solid" | "excellent";

export interface ReliabilityStats {
  percent: number;
  on_time: number;
  dated: number;
  current_streak: number;
  best_streak: number;
  achievements: number[];
  praise: ReliabilityPraise;
  community?: {
    users: number;
    holders: Record<number, number>;
  };
}

export interface SelfProfile {
  id?: string;
  owner_id?: string;
  self_person_id?: string;
  first_name?: string | null;
  username?: string | null;
  bio: string | null;
  values: string[];
  communication_style: string | null;
  timezone: string | null;
  locale?: string | null;
  context_summary?: string | null;
  weekly_reflection_enabled?: boolean;
  telegram_id?: number | null;
  auth_user_id?: string | null;
  email?: string | null;
  morning_digest_enabled?: boolean;
  morning_digest_time?: string;
  weekly_digest_enabled?: boolean;
  weekly_digest_time?: string;
  evening_sync_enabled?: boolean;
  evening_sync_time?: string;
  last_goal_checkin_on?: string | null;
  onboarding_completed_at?: string | null;
  primary_conversation_id?: string | null;
  reliability?: ReliabilityStats;
  locations?: PersonLocation[];
  dates?: PersonDate[];
  updated_at?: string;
}

export type MessageRole = "user" | "assistant" | "system";

export interface EntityLink {
  type: "person" | "task" | "space" | "goal" | "project" | "recommendation" | "mail";
  id: string;
  label: string;
  url?: string;
}

export interface CompanionOffer {
  kind:
    | "draft"
    | "plan"
    | "rewrite"
    | "summarize"
    | "research"
    | "hint"
    | "search_products"
    | "search_places"
    | "remind";
  title: string;
  instruction: string;
}

export interface SearchHit {
  kind: "product" | "place" | "shop" | "web";
  title: string;
  subtitle?: string;
  url: string;
  price?: string | null;
  source?: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id?: string;
  role: MessageRole;
  content: string;
  source_channel?: "telegram" | "mini_app" | "system";
  created_at?: string;
  entities?: EntityLink[];
  metadata?: {
    entities?: EntityLink[];
    offers?: CompanionOffer[];
    search_results?: SearchHit[];
    [key: string]: unknown;
  };
}

export interface Conversation {
  id: string;
  kind?: "companion" | "system";
  mode?: "command" | "companion";
  title?: string | null;
  messages?: ConversationMessage[];
}

export interface CompanionReply {
  conversation?: Conversation;
  conversation_id?: string;
  user_message?: ConversationMessage;
  assistant_message?: ConversationMessage;
  message?: ConversationMessage;
  entities?: EntityLink[];
}

export interface GuidedIntroReply {
  question: string;
  step: number;
  total: number;
  facts_count: number;
  done: boolean;
  user_message: ConversationMessage | null;
  assistant_message: ConversationMessage | null;
}

export type CompletenessId = "telegram" | "portrait" | "timezone" | "goals" | "digests";

export interface CompletenessItem {
  id: CompletenessId;
  weight: number;
  done: boolean;
  href: string;
}

export interface CompletenessReport {
  percent: number;
  items: CompletenessItem[];
}

export interface UsageTotals {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  call_count: number;
}

export interface UsageSummary {
  as_of: string;
  today: string;
  month_start: string;
  today_usage: UsageTotals & { by_metric: Record<string, UsageTotals> };
  month_usage: UsageTotals & { by_metric: Record<string, UsageTotals> };
}

export type ImportSource = "todoist" | "text";

export interface ImportItem {
  id: string;
  kind: "project" | "task";
  title: string;
  due_at: string | null;
  importance: number | null;
  project_title: string | null;
  source_id: string | null;
  duplicate: boolean;
}

export interface ImportSession {
  id: string;
  source: ImportSource;
  status: "preview" | "confirmed" | "cancelled";
  items: ImportItem[];
  log: Record<string, unknown>;
  created_at: string;
  confirmed_at: string | null;
}

export type GoalStatus = "active" | "paused" | "completed" | "cancelled";

export interface GoalStats {
  task_count: number;
  done_count: number;
  open_count: number;
  progress: number;
  days_active: number;
}

export interface Goal {
  id: string;
  title: string;
  description?: string | null;
  status: GoalStatus;
  horizon?: string | null;
  priority?: number | null;
  target_date?: string | null;
  current_plan?: string | null;
  plan_revised_at?: string | null;
  created_at?: string;
  updated_at?: string;
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
  last_checkin_at?: string | null;
  last_checkin_status?: SelfPromiseCheckinStatus | null;
  due_for_checkin: boolean;
  praise_days?: number | null;
}

export interface SelfPromiseCheckin {
  id: string;
  promise_id?: string;
  status: SelfPromiseCheckinStatus;
  note?: string | null;
  created_at: string;
}

export interface SelfPromise {
  id: string;
  title: string;
  description?: string | null;
  status: SelfPromiseStatus;
  started_at?: string;
  created_at?: string;
  updated_at?: string;
  stats?: SelfPromiseStats;
  recent_checkins?: SelfPromiseCheckin[];
}

export type ProjectStatus = "active" | "paused" | "completed" | "cancelled";

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  status: ProjectStatus;
  goal_id?: string | null;
  goal?: Pick<Goal, "id" | "title"> | null;
  space_id?: string | null;
  space?: Pick<Space, "id" | "name"> | null;
  created_at?: string;
  updated_at?: string;
}

export interface Reflection {
  id: string;
  period_start: string;
  period_end: string;
  wins: string[] | { title?: string; text?: string }[];
  improvements: string[] | { title?: string; text?: string }[];
  next_steps: string[] | { title?: string; text?: string }[];
  created_at?: string;
}

export type ExperienceType =
  "restaurant" | "theater" | "trip" | "event" | "gift" | "activity" | "other";
export type ExperienceStatus = "planned" | "completed" | "follow_up_due";

export interface Experience {
  id: string;
  owner_id?: string;
  type: ExperienceType;
  title: string;
  description?: string | null;
  occurred_at?: string | null;
  place?: string | null;
  emotions: string[];
  positive_signals: string[];
  negative_signals: string[];
  outcome?: string | null;
  source_message_id?: string | null;
  participant_ids: string[];
  participants?: Pick<Person, "id" | "name">[];
  planned_task_id?: string | null;
  planned_space_id?: string | null;
  follow_up_at?: string | null;
  status: ExperienceStatus;
  created_at?: string;
  updated_at?: string;
}

export type MailProvider = "gmail" | "yandex" | "mailru" | "outlook" | "custom";
export type MailAccountStatus = "active" | "error" | "disabled";
export type MailDraftStatus = "draft" | "sent" | "failed";
export type MailPlaybookTrigger = "important" | "meeting" | "unread" | "custom";
export type MailPlaybookAction = "summarize" | "create_task" | "draft_reply";

export interface MailAccount {
  id: string;
  email: string;
  provider: MailProvider;
  username: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  status: MailAccountStatus;
  last_error: string | null;
  last_synced_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MailMessage {
  id: string;
  account_id: string;
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
}

export interface MailDraft {
  id: string;
  account_id: string;
  message_id: string | null;
  to_address: string;
  subject: string;
  body: string;
  status: MailDraftStatus;
  error: string | null;
  sent_at: string | null;
}

export interface MailPlaybook {
  id: string;
  account_id: string | null;
  name: string;
  trigger: MailPlaybookTrigger;
  actions: MailPlaybookAction[];
  prompt: string | null;
  enabled: boolean;
}

export type ApiEnvelope<T> = T | { data: T };

export type QuotaPlan = {
  plan: string;
  title: string;
  period: "week" | "month";
  period_tokens: number;
  window_hours: number;
  window_tokens: number;
  updated_at: string;
};

export type QuotaStatus = {
  plan: string;
  plan_title: string;
  plan_until: string | null;
  enforced: boolean;
  state: "ok" | "low" | "exhausted";
  period: { kind: "week" | "month"; limit: number; used: number; resets_at: string };
  window: { hours: number; limit: number; used: number; resets_at: string | null };
  available_at: string | null;
};

export type AdminQuota = {
  is_admin: boolean;
  enforced?: boolean;
  plans?: QuotaPlan[];
};

export type AdminUserQuota = {
  user: { id: string; name: string; username: string | null; email: string | null };
  quota: QuotaStatus;
};

/** Колесо «Удиви меня». */
export type WheelMood = "calm" | "active" | "any";
export type WheelWhen = "now" | "today" | "weekend";
export type WheelCompany = "solo" | "pair" | "friends" | "kids";
export interface WheelRequest {
  mood: WheelMood;
  want: string | null;
  when: WheelWhen;
  company: WheelCompany;
  city: string | null;
  only_new: boolean;
  feedback: string | null;
}
export interface ActivityTypeInfo {
  id: string;
  name: string;
  emoji: string | null;
  description: string | null;
  activity_level: number;
  emotion_level: number;
  price_level: number;
  duration_hours: number;
  setting: "indoor" | "outdoor" | "both";
}
export interface PlaceInfo {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  image_url: string | null;
  yandex_url: string | null;
  yandex_rating: number | null;
  yandex_reviews: number | null;
}
export interface WheelSegment {
  id: string;
  weight: number;
  liked?: boolean;
  name: string;
  emoji: string | null;
  category: string;
}
export interface WheelSpin {
  spin_id: string;
  segments: WheelSegment[];
  winner_index: number;
  winner: {
    type: ActivityTypeInfo;
    category: { name: string; emoji: string | null } | null;
    places: PlaceInfo[];
    maps_url: string;
    reason?: string | null;
    verdict?: "like" | "never" | null;
  };
  spins_used: number;
  /** null — без ограничения. */
  spins_left: number | null;
  spins_limit: number;
}
export interface WheelStatus {
  spins_used: number;
  spins_left: number | null;
  spins_limit: number;
}

export type PlaceEmotion = "wow" | "good" | "meh" | "bad";
export type PlaceVisitStatus = "visited" | "want" | "skip";
/** Место из поиска рядом — в базе его ещё нет. */
export interface PlaceCandidate {
  source: "2gis" | "osm";
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
}
export interface SavedPlace extends PlaceInfo {
  rating?: number | null;
  rating_count?: number | null;
  distance_m?: number | null;
  my_status?: PlaceVisitStatus | null;
  twogis_url?: string | null;
}
export interface NearbyPlaces {
  city: string;
  saved: SavedPlace[];
  found: PlaceCandidate[];
  source: "2gis" | "osm";
}
export interface VisitInput {
  activity_type_id: string;
  status: PlaceVisitStatus;
  rating?: number | null;
  emotion?: PlaceEmotion | null;
  note?: string | null;
}
export interface TasteItem {
  target_kind: "type" | "category";
  target_id: string;
  name: string;
  emoji: string | null;
  verdict: "like" | "never" | null;
  score: number;
  reason: string | null;
  source: "you" | "visits" | "ai";
}
export interface Tastes {
  summary: string | null;
  refreshed_at: string | null;
  ai_available: boolean;
  items: TasteItem[];
}
