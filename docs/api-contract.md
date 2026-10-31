# FITME API 계약 (P1)

요구서 13장을 구현 수준으로 구체화한 문서. 웹(`web/`)과 서버(`api/`)는 이 문서를 기준으로 맞춘다.

- 기본 경로: `/api/v1`
- 인증: `Authorization: Bearer <Supabase access token>` (헬스체크·`/meta`·`/dev/*` 제외)
- 서버는 토큰에서 user_id를 정한다. 본문의 user_id는 받지 않는다.
- 오류: HTTP 4xx/5xx + `{ "error": { "code": "WEATHER_UNAVAILABLE", "message": "사용자에게 보여줄 한국어 문장" } }`
- 무료 상한 초과: 429 `FREE_QUOTA_EXCEEDED` / 분당 요청 초과: 429 `RATE_LIMITED`
- 모든 태그 값은 `api/app/domain/taxonomy.json`의 **코드**(영문)로 주고받는다. 화면은 라벨(한글)로 표시.

## 공통 타입

```ts
type Category = "outer" | "top" | "bottom" | "dress" | "shoes";

interface Item {
  id: string;
  image_path: string | null;
  image_url: string | null;        // 1시간 만료 서명 URL
  name: string;                    // 자동 생성 "색 + 세부 카테고리", 수정 가능
  category: Category;
  subcategory: string;             // taxonomy.subcategories[category][].code
  color: string;
  pattern: string;
  fit: string;                     // 원피스·신발은 "none"
  material: string | null;
  seasons: string[];               // spring | summer | fall | winter
  style_tags: string[];            // 최대 3
  formality: 1 | 2 | 3;
  warmth: 1 | 2 | 3;
  brand: string | null;
  size_label: string | null;
  memo: string | null;
  tag_confidence: Record<string, number>;   // 키: category, subcategory, color, pattern, fit, seasons, style_tags, formality, warmth, material
  tag_source: "ai" | "user_edited" | "manual";
  is_active: boolean;
  created_at: string;
}

interface StyleAttributes {
  style_tags: string[];
  preferred_colors: string[];
  silhouette: { top: string[]; bottom: string[] };
  mood: string[];                  // 자유 텍스트 최대 3
  avoid: { subcategories: string[]; colors: string[] };
}

interface StyleProfile {
  id: string;
  style_name: string;
  source_text: string | null;
  preset_key: string | null;
  attributes: StyleAttributes;
  is_default: boolean;
  created_at: string;
}

interface OutfitItem { id: string; role: Category; name: string; image_url: string | null; subcategory: string; color: string; }

interface OutfitCard {
  id: string;
  rank: number;                    // 1..3
  title: string;
  score: number;                   // 0–100, 소수 1자리
  score_detail: { style: number; harmony: number; situation: number; preference: number };
  reasons: string[];               // 2–3줄
  is_favorite: boolean;
  items: OutfitItem[];             // 순서: outer, top, bottom|dress, shoes
  occasion: string | null;
  target_date: string | null;      // YYYY-MM-DD
  version: number;
  source: "chat" | "today";
  created_at: string;
}

interface WeatherSummary {
  available: true;
  date: string;
  time_of_day: "morning" | "afternoon" | "evening" | "all";
  temp: number; min: number | null; max: number | null;
  sky: string;          // 맑음 | 구름많음 | 흐림
  pty: string;          // 없음 | 비 | 비/눈 | 눈 | 소나기
  pop: number;          // 강수확률 %
  wind: number;         // m/s
  label: string;        // "내일 저녁 14° · 맑음"
  base_datetime: string;
  stale: boolean;       // 직전 발표 캐시로 대체했으면 true
}
type Weather = WeatherSummary | { available: false; date: string; reason: "OUT_OF_RANGE" | "UNAVAILABLE" | "NO_REGION" };
```

## 엔드포인트

### 상태
| | | |
|---|---|---|
| GET `/health` | 인증 없음 | `{ status: "ok", app_env, models: { chat, tagging, style } \| null }` — `models`는 개발 모드에서만 (`"nvidia/moonshotai/kimi-k2.6"` 형식, 상단 띠 표시용) |

### 개발 모드 전용 (`APP_ENV=development`일 때만 라우터가 등록됨)
| | |
|---|---|
| POST `/dev/session` `{ account: "a" \| "b" }` | 서버 `.env`의 테스트 계정으로 Supabase 로그인 → `{ access_token, refresh_token }`. 웹은 `supabase.auth.setSession()`으로 적용. 운영 모드에서는 404 |

### 프로필 (F01, F11)
- GET `/me` → `User`
```ts
interface User {
  id: string; nickname: string | null; avatar_url: string | null;
  preferred_fit: string | null; style_tags: string[];
  avoid_colors: string[]; avoid_subcategories: string[];
  personal_color: string | null;
  home_region: string | null; region_code: string | null; grid_nx: number | null; grid_ny: number | null;
  height_cm: number | null;
  usual_sizes: { top?: "S"|"M"|"L"|"XL"; bottom_waist?: number };
  body_traits: string[];
  body_measurements: { shoulder?: number|null; chest?: number|null; waist?: number|null; hip?: number|null } | null;
  onboarding_state: { steps?: Record<"fit"|"style"|"body"|"closet", { status: "done"|"skipped"; at: string }>; completed_at?: string };
  persistent_exclusions: { id: string; type: string; target: string; target_label: string; scope: string[] | null; created_at: string }[];
  default_style: { id: string; style_name: string } | null;
  closet_count: number;    // is_active 옷 수
  created_at: string;
}
```
- PATCH `/me` — 위 필드 중 수정 가능한 것 일부 + 선택 `onboarding_step: { step, status }` (단계 기록), `complete_onboarding: true`, `region_code` (주면 서버가 home_region·격자 채움) → `User`
- DELETE `/me/exclusions/{feedback_id}` — 영구 제외 조건 해제 → 204
- DELETE `/me` → 204. DB 행·Storage 사진·AI 키 전부 삭제 후 auth 사용자 삭제
- GET `/me/learning-log` → `{ events: { type: "exclusion" | "dislike" | "favorite" | "style_added"; date: string; text: string }[]; total: number; last_updated: string | null }`

### 옷장 (F02, F03)
- POST `/items/upload-url` `{ content_type: "image/webp" | "image/jpeg" }` → `{ path, upload_url }`
  - 웹은 `fetch(upload_url, { method: "PUT", headers: { "content-type": content_type }, body: blob })`
- POST `/items/tag` `{ image_path }` → `{ tags: TagSuggestion, confidence: Record<string, number>, name: string }`
  - 실패 시 502 `TAGGING_FAILED` → 웹은 빈 폼으로 직접 입력
  - `TagSuggestion = Pick<Item, "category"|"subcategory"|"color"|"pattern"|"fit"|"material"|"seasons"|"style_tags"|"formality"|"warmth">`
- POST `/items` `{ image_path, name?, ...TagSuggestion, brand?, size_label?, memo?, tag_confidence?, tag_source }` → `Item`
- GET `/items?category=top,bottom&color=&season=&active=true|false|all` → `{ items: Item[], counts: { all, outer, top, bottom, dress, shoes, archived } }`
- PATCH `/items/{id}` (일부 필드, `is_active` 포함) → `Item`
- DELETE `/items/{id}` → 204 (사진도 삭제)

### 추구미 (F04)
- GET `/style-presets` → `{ presets: { key, style_name, icons: string[], attributes: StyleAttributes }[] }`
- POST `/style-profiles` `{ text }` 또는 `{ preset }` → `StyleProfile` (저장까지 함. 첫 추구미면 기본)
- GET `/style-profiles` → `{ profiles: StyleProfile[] }`
- PATCH `/style-profiles/{id}` `{ style_name?, attributes?, is_default?: true }` → `StyleProfile`
- DELETE `/style-profiles/{id}` → 204

### 날씨·지역 (F06)
- GET `/weather?date=YYYY-MM-DD&time_of_day=&nx=&ny=` (nx·ny 없으면 프로필 지역) → `Weather`
- GET `/regions?q=마포` → `{ regions: { code, name, sido, sigungu, nx, ny }[] }` (최대 20)
- GET `/regions/nearest?lat=&lon=` → `{ region }`

### 대화 (F05–F07, F09) — SSE
POST `/chat` `{ conversation_id: string | null, message: string, answer?: { ask_id: string, value: string } }`

`answer`는 `ask` 이벤트의 `kind === "remember"` 선택지를 누를 때 보낸다 (message에는 선택지 label).
`kind === "clarify"` 선택지는 label을 그냥 `message`로 보낸다.

이벤트 (순서대로, `event:` 이름 + `data:` JSON)
```
event: meta      data: {"conversation_id":"uuid","run_id":"uuid"}
event: step      data: {"tool":"get_weather","summary":"내일 저녁 14° · 맑음","status":"done","ms":420}
event: notice    data: {"code":"BYOK_FALLBACK","message":"연결한 Claude 키가 실패해 기본 무료 AI로 바꿨어요."}
event: message   data: {"delta":"자연스러운 미니멀로 3개 골랐어요."}
event: outfits   data: {"version":2,"label":"슬랙스 제외","occasion":"소개팅","title":"소개팅 코디","outfits":[OutfitCard], "missing":[{"category":"shoes","have":0,"need":2}]}
event: ask       data: {"ask_id":"uuid","kind":"remember"|"clarify","question":"...","options":[{"label":"네, 기억해줘","value":"persist"},{"label":"이번만","value":"once"}]}
event: done      data: {"run_id":"uuid","conversation_id":"uuid","steps":6,"ms":6800}
event: error     data: {"code":"FREE_QUOTA_EXCEEDED","message":"..."}
```
- `step`은 같은 도구에 대해 `running` → `done|failed` 두 번 올 수 있다. 웹은 `tool` 순서대로 갱신.

GET `/chat/latest` → `{ conversation: { id, title, updated_at } | null, messages: ChatMessage[], current: OutfitsEvent | null }`
```ts
interface ChatMessage {
  id: string; role: "user" | "assistant"; content: string; created_at: string;
  payload: { steps?: Step[]; run?: { steps: number; ms: number }; outfits?: OutfitsEvent; ask?: AskEvent; answered?: boolean } | null;
}
```

### 오늘의 코디·저장 (F05–F08) — JSON
- POST `/outfits/generate` `{ date, time_of_day?, nx?, ny?, region_code?, schedule?: string, moods?: ("neat"|"comfy"|"dressy"|"warm")[], temp_band?: string }`
  → `TodayResult = { weather: Weather, outfits: OutfitCard[], missing: {category, have, need}[], message: string | null, run_id, notice?: {code,message} }`
  - 날씨가 없으면 `weather.available=false`이고 `temp_band`(taxonomy.temp_bands 코드)를 주면 그 기온으로 생성. 둘 다 없으면 17° 가정 + 안내 문구
- POST `/outfits/{id}/feedback` `{ chip?: "change_top" | "too_plain" | "warmer" | "reroll", message?: string }` → `TodayResult` (새 버전)
- POST `/outfits/{id}/favorite` / DELETE `/outfits/{id}/favorite` → `{ id, is_favorite }`
- GET `/outfits?favorite=true&occasion=&limit=` → `{ outfits: OutfitCard[], occasions: string[] }`

### AI 연결 (F10)
- GET `/ai/connections` → `{ free: { provider, model_label, notice }, connections: { provider, key_last4, status, monthly_limit_usd, verified_at }[], providers: ("gemini"|"anthropic"|"openai")[] }`
- POST `/ai/connections/{provider}` `{ api_key, monthly_limit_usd? }` → 테스트 호출 성공 시 저장 → connection. 실패 400 `INVALID_KEY`
- PATCH `/ai/connections/{provider}` `{ monthly_limit_usd }` → connection
- DELETE `/ai/connections/{provider}` → 204 (즉시 키 삭제)
- GET `/ai/task-settings` → `{ tasks: { task: "chat"|"tagging"|"style", label, provider, model, source: "free"|"byok", choices: { provider, model, label }[] }[] }`
- PUT `/ai/task-settings` `{ tasks: { task, provider, model }[] }` (provider `"free"` = 기본 무료로)
- GET `/ai/usage?month=YYYY-MM` → `{ month, byok: { provider, requests, input_tokens, output_tokens, est_cost_usd, monthly_limit_usd }[], free: { agent_runs_today, agent_runs_limit, tagging_today, tagging_limit }, notices: { code, provider, message, at }[] }`
