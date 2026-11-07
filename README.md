# FITME

내 옷장 안에서 코디를 제안하고, 대화로 고쳐 주는 AI 스타일링 에이전트 웹 서비스 (P1).

- 요구서: FITME 개발 요구사항 명세서 v1.0 (P1)
- 결정 기록: [docs/decisions.md](docs/decisions.md) · API 계약: [docs/api-contract.md](docs/api-contract.md)
- 이미지 출처: [docs/image-credits.md](docs/image-credits.md)

```
fitme/
  web/        Next.js (App Router) + TypeScript + Tailwind — 화면
  api/        FastAPI + LangGraph — API, 스타일링 에이전트
    app/agent/      그래프(graph.py), 실행 상태(run.py), 코드 도구(core.py), LLM 도구, prompts/
    app/llm/        model_router(router.py), 제공사 어댑터(Gemini·Claude·OpenAI·NVIDIA)
    app/domain/     태그 체계(taxonomy.json), 추천 규칙(rules.py: 검증·점수·색·기온)
    app/routers/    API 라우트      app/services/  날씨·지역·스토리지·암호화
    config/         models.{development,production}.yaml, scoring.yaml, pricing.yaml
    eval/           평가 세트 + run.py
  supabase/
    migrations/     SQL (RLS 포함)       seed/   샘플 옷장(사진 + wardrobe.json)
  docs/
```

## ⚠️ 보안 규칙 (공개 저장소)

- 키·토큰·비밀번호는 **`.env` 파일에만** 둔다. `.env`, `.env.local`은 git이 무시한다. 저장소에는 `.env.example`만 있다.
- 커밋할 때마다 비밀값 검사(gitleaks)가 돈다. 클론한 뒤 한 번 설정한다:
  ```bash
  brew install gitleaks
  ```
  ```bash
  git config core.hooksPath .githooks
  ```
- CI도 전체 이력을 gitleaks로 검사한다.

## 1. 로컬 실행

필요: Node 24 + pnpm 10, Python 3.11 + [uv](https://docs.astral.sh/uv/).

```bash
cp api/.env.example api/.env && cp web/.env.example web/.env.local
```
두 파일에 값을 채운 뒤(2장), 터미널 두 개에서:
```bash
cd api && uv sync && uv run uvicorn app.main:app --reload --port 8000
```
```bash
cd web && pnpm install && pnpm dev
```
- 웹: http://localhost:3000 · API 문서: http://localhost:8000/docs
- `APP_ENV=development`이면 화면 상단에 "개발 모드 · 사용 모델" 띠가 보이고, 로그인 화면에 테스트 계정 A/B 버튼이 생긴다(시드 필요).

## 2. 외부 서비스 설정

### Supabase (개발·운영 프로젝트 각각)
1. supabase.com → New project → Region **Northeast Asia (Seoul)**.
2. SQL Editor에서 `supabase/migrations/*.sql`을 순서대로 실행 (테이블, RLS, 비공개 `closet` 버킷, 스토리지 정책).
3. Project Settings → API에서 URL, anon(publishable) 키, service_role(secret) 키를 `.env`에 넣는다.
   - JWT는 JWKS로 자동 검증한다. 옛 HS256 프로젝트만 `SUPABASE_JWT_SECRET`을 넣는다.
4. Authentication → URL Configuration: Site URL과 Redirect URL에 `http://localhost:3000/auth/callback`(개발) / 운영 도메인을 추가.

### 카카오 로그인
1. Kakao Developers → 애플리케이션 추가 → REST API 키, 보안 → Client Secret 발급.
2. 카카오 로그인 활성화, Redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
3. 동의항목: **닉네임(profile_nickname), 프로필 사진(profile_image)만**. 이메일은 설정하지 않는다 (KOE205 방지).
4. Supabase → Authentication → Providers → Kakao: REST API 키, Client Secret 입력, **Allow users without an email** 켜기.
5. 카카오 키는 Supabase 대시보드에만 넣고 코드·`.env`에는 넣지 않는다.

### 기상청 단기예보
공공데이터포털 '기상청_단기예보 조회서비스' 활용 신청 → 승인된 **일반 인증키(Decoding)** 를 `KMA_SERVICE_KEY`에.
지역 표(`api/app/data/regions.json`)는 같은 서비스 참고문서의 격자·위경도 엑셀로 만들었다 (`api/scripts/build_regions.py`).

### AI
- `GEMINI_API_KEY`: Google AI Studio 키 (운영 기본 무료 모델).
- `NVIDIA_API_KEY`: build.nvidia.com 무료 키 (**개발 모드 전용**).
- `AI_KEY_ENCRYPTION_KEY`: 사용자 키 암호화용 32바이트. 생성:
  ```bash
  python3 -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"
  ```

### 환경 변수
| 변수 | 위치 | 설명 |
|---|---|---|
| `APP_ENV` | api | `development` / `production` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | api | 서버용 |
| `NEXT_PUBLIC_APP_ENV`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL` | web | 브라우저에 노출되는 공개값만 |
| `ALLOWED_ORIGINS` | api | CORS 허용 도메인(쉼표 구분) |
| `GEMINI_API_KEY`, `NVIDIA_API_KEY`, `KMA_SERVICE_KEY`, `AI_KEY_ENCRYPTION_KEY` | api | |
| `FREE_DAILY_AGENT_RUNS`(20), `FREE_DAILY_TAGGING`(50), `RATE_LIMIT_PER_MINUTE`(30) | api | 무료 상한 |
| `DEV_TEST_PASSWORD` | api (개발만) | 시드 테스트 계정 비밀번호 |

## 3. 시드 (개발 프로젝트만)
```bash
cd api && uv run python scripts/seed.py
```
테스트 계정 A(샘플 옷장 + 추구미 '자연스러운 미니멀')와 B(빈 옷장)를 만든다. `--reset`은 A의 옷장을 다시 올린다. 운영 모드에서는 실행되지 않는다.

## 4. 테스트 · 평가
```bash
cd api && uv run pytest -q
```
```bash
cd api && uv run python eval/run.py
```
```bash
cd api && uv run python eval/run.py --llm live --env production --tagging
```
```bash
cd api && uv run python eval/run.py --llm live --parse
```
- 기본(`offline`)은 AI 없이 규칙만으로 검증 지표(ID 유효성, 제외 재추천, 3개 생성)를 확인한다.
- `--parse`는 "바지 빼줘" 같은 제외 표현 30개를 실제 AI로 해석해 인식률을 본다 (`eval/parse/cases.jsonl`).
- `--llm live`는 `config/models.{env}.yaml`의 실제 모델을 쓴다. 매주 1회 `--env production`으로 실행해 개발·운영 모델 차이를 본다 (요구서 10.3).

## 5. 배포
- **웹 (Vercel):** Root Directory `web`, 환경 변수 `NEXT_PUBLIC_*` 4개. Preview = 개발, Production = 운영.
- **API (Render):** New Web Service → Docker → Root Directory `api` (Dockerfile 사용). 환경 변수는 2장 표. 운영 서비스에는 `NVIDIA_API_KEY`를 넣지 않는다.
  - 운영 설정에 `nvidia`가 들어가면 서버가 시작되지 않는다 (인수 테스트 12).
- `ALLOWED_ORIGINS`에 Vercel 도메인을 넣는다.

### 무료 호스팅 깨우기 (시연·검수 전)
- Render 무료 서비스는 15분 미사용 시 잠든다. 시연 5분 전에 헬스체크를 호출한다:
  ```bash
  curl https://<api-domain>/api/v1/health
  ```
- Supabase 무료 프로젝트는 1주일 미사용 시 일시정지된다. 대시보드에서 프로젝트를 열고 **Restore project**를 누른 뒤 1–2분 기다린다. 발표 전날 접속해 확인한다.

## 6. 개발 / 운영 모드
| | 개발 | 운영 |
|---|---|---|
| 대화·추구미 | NVIDIA `nvidia/nemotron-3.5-super-vl-120b-a12b` (추론 끔) | Gemini `gemini-3.8-flash` |
| 태깅 | NVIDIA `nvidia/nemotron-3.5-super-vl-120b-a12b` | Gemini `gemini-3.5-flash-lite` |
| 실패 시 | Gemini로 대체 (`fallback`) | — |

NVIDIA 첫 점검에서 실패한 작업은 `config/models.development.yaml`의 `force_fallback_tasks`에 넣어 개발 모드에서도 Gemini로 돌린다.
