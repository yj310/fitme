// Mirrors docs/api-contract.md. Keep in sync with the API.

export type Category = "outer" | "top" | "bottom" | "dress" | "shoes";
export type Task = "chat" | "tagging" | "style";
export type Provider = "gemini" | "anthropic" | "openai";
export type TimeOfDay = "morning" | "afternoon" | "evening" | "all";
export type MoodCode = "neat" | "comfy" | "dressy" | "warm";
export type FeedbackChip = "change_top" | "too_plain" | "warmer" | "reroll";

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface Health {
  status: string;
  app_env: string;
  models: { chat: string; tagging: string; style: string } | null;
}

export type OnboardingStep = "fit" | "style" | "body" | "closet";

export interface PersistentExclusion {
  id: string;
  type: string;
  target: string;
  target_label: string;
  scope: string[] | null;
  created_at: string;
}

export interface BodyMeasurements {
  shoulder?: number | null;
  chest?: number | null;
  waist?: number | null;
  hip?: number | null;
}

export interface User {
  id: string;
  nickname: string | null;
  avatar_url: string | null;
  preferred_fit: string | null;
  style_tags: string[];
  avoid_colors: string[];
  avoid_subcategories: string[];
  personal_color: string | null;
  home_region: string | null;
  region_code: string | null;
  grid_nx: number | null;
  grid_ny: number | null;
  height_cm: number | null;
  usual_sizes: { top?: "S" | "M" | "L" | "XL"; bottom_waist?: number };
  body_traits: string[];
  body_measurements: BodyMeasurements | null;
  onboarding_state: {
    steps?: Partial<Record<OnboardingStep, { status: "done" | "skipped"; at: string }>>;
    completed_at?: string;
  };
  persistent_exclusions: PersistentExclusion[];
  default_style: { id: string; style_name: string } | null;
  closet_count: number;
  created_at: string;
}

export type UserPatch = Partial<
  Pick<
    User,
    | "nickname"
    | "preferred_fit"
    | "style_tags"
    | "avoid_colors"
    | "avoid_subcategories"
    | "personal_color"
    | "height_cm"
    | "usual_sizes"
    | "body_traits"
    | "body_measurements"
    | "region_code"
  >
> & {
  onboarding_step?: { step: OnboardingStep; status: "done" | "skipped" };
  complete_onboarding?: boolean;
};

export interface LearningEvent {
  type: "exclusion" | "dislike" | "favorite" | "style_added";
  date: string;
  text: string;
}

export interface LearningLog {
  events: LearningEvent[];
  total: number;
  last_updated: string | null;
}

export interface TagSuggestion {
  category: Category;
  subcategory: string;
  color: string;
  pattern: string;
  fit: string;
  material: string | null;
  seasons: string[];
  style_tags: string[];
  formality: 1 | 2 | 3;
  warmth: 1 | 2 | 3;
}

export interface Item extends TagSuggestion {
  id: string;
  image_path: string | null;
  image_url: string | null;
  name: string;
  brand: string | null;
  size_label: string | null;
  memo: string | null;
  tag_confidence: Record<string, number>;
  tag_source: "ai" | "user_edited" | "manual";
  is_active: boolean;
  created_at: string;
}

export interface ItemCreate extends TagSuggestion {
  image_path: string | null;
  name?: string;
  brand?: string | null;
  size_label?: string | null;
  memo?: string | null;
  tag_confidence?: Record<string, number>;
  tag_source: "ai" | "user_edited" | "manual";
}

export type ItemPatch = Partial<Omit<ItemCreate, "image_path">> & { is_active?: boolean };

export interface ItemCounts {
  all: number;
  outer: number;
  top: number;
  bottom: number;
  dress: number;
  shoes: number;
  archived: number;
}

export interface ItemList {
  items: Item[];
  counts: ItemCounts;
}

export interface TagResult {
  tags: TagSuggestion;
  confidence: Record<string, number>;
  name: string;
}

export interface StyleAttributes {
  style_tags: string[];
  preferred_colors: string[];
  silhouette: { top: string[]; bottom: string[] };
  mood: string[];
  avoid: { subcategories: string[]; colors: string[] };
}

export interface StyleProfile {
  id: string;
  style_name: string;
  source_text: string | null;
  preset_key: string | null;
  attributes: StyleAttributes;
  is_default: boolean;
  created_at: string;
}

export interface StylePreset {
  key: string;
  style_name: string;
  icons: string[];
  attributes: StyleAttributes;
}

export interface OutfitItem {
  id: string;
  role: Category;
  name: string;
  image_url: string | null;
  subcategory: string;
  color: string;
}

export interface OutfitCard {
  id: string;
  rank: number;
  title: string;
  score: number;
  score_detail: { style: number; harmony: number; situation: number; preference: number };
  reasons: string[];
  is_favorite: boolean;
  items: OutfitItem[];
  occasion: string | null;
  target_date: string | null;
  version: number;
  source: "chat" | "today";
  created_at: string;
}

export interface WeatherSummary {
  available: true;
  date: string;
  time_of_day: TimeOfDay;
  temp: number;
  min: number | null;
  max: number | null;
  sky: string;
  pty: string;
  pop: number;
  wind: number;
  label: string;
  base_datetime: string;
  stale: boolean;
}

export interface WeatherUnavailable {
  available: false;
  date: string;
  reason: "OUT_OF_RANGE" | "UNAVAILABLE" | "NO_REGION";
}

export type Weather = WeatherSummary | WeatherUnavailable;

export interface Region {
  code: string;
  name: string;
  sido: string;
  sigungu: string;
  nx: number;
  ny: number;
}

export interface MissingCategory {
  category: Category;
  have: number;
  need: number;
}

export interface Notice {
  code: string;
  message: string;
}

// ── Chat SSE ──
export interface Step {
  tool: string;
  summary: string;
  status: "running" | "done" | "failed";
  ms?: number;
}

export interface OutfitsEvent {
  version: number;
  label: string | null;
  occasion: string | null;
  title: string;
  outfits: OutfitCard[];
  missing?: MissingCategory[];
}

export interface AskOption {
  label: string;
  value: string;
}

export interface AskEvent {
  ask_id: string;
  kind: "remember" | "clarify";
  question: string;
  options: AskOption[];
}

export interface DoneEvent {
  run_id: string;
  conversation_id: string;
  steps: number;
  ms: number;
}

export type ChatEvent =
  | { event: "meta"; data: { conversation_id: string; run_id: string } }
  | { event: "step"; data: Step }
  | { event: "notice"; data: Notice }
  | { event: "message"; data: { delta: string } }
  | { event: "outfits"; data: OutfitsEvent }
  | { event: "ask"; data: AskEvent }
  | { event: "done"; data: DoneEvent }
  | { event: "favorite"; data: { outfit_id: string; is_favorite: boolean } }
  | { event: "error"; data: { code: string; message: string } };

export interface ChatRequest {
  conversation_id: string | null;
  message: string;
  answer?: { ask_id: string; value: string };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  payload: {
    steps?: Step[];
    run?: { steps: number; ms: number };
    outfits?: OutfitsEvent;
    ask?: AskEvent;
    answered?: boolean;
  } | null;
}

export interface ChatLatest {
  conversation: { id: string; title: string | null; updated_at: string } | null;
  messages: ChatMessage[];
  current: OutfitsEvent | null;
}

// ── Today ──
export interface GenerateRequest {
  date: string;
  time_of_day?: TimeOfDay;
  nx?: number;
  ny?: number;
  region_code?: string;
  schedule?: string;
  moods?: MoodCode[];
  temp_band?: string;
}

export interface TodayResult {
  weather: Weather;
  outfits: OutfitCard[];
  missing: MissingCategory[];
  message: string | null;
  run_id: string;
  notice?: Notice;
}

// ── AI ──
export interface AiConnection {
  provider: Provider;
  key_last4: string;
  status: "active" | "invalid";
  monthly_limit_usd: number | null;
  verified_at: string | null;
}

export interface AiConnections {
  free: { provider: string; model_label: string; notice: string };
  connections: AiConnection[];
  providers: Provider[];
}

export interface TaskSetting {
  task: Task;
  label: string;
  provider: string;
  model: string;
  source: "free" | "byok";
  choices: { provider: string; model: string; label: string }[];
}

export interface AiUsage {
  month: string;
  byok: {
    provider: Provider;
    requests: number;
    input_tokens: number;
    output_tokens: number;
    est_cost_usd: number;
    monthly_limit_usd: number | null;
  }[];
  free: {
    agent_runs_today: number;
    agent_runs_limit: number;
    tagging_today: number;
    tagging_limit: number;
  };
  notices: { code: string; provider: string; message: string; at: string }[];
}
