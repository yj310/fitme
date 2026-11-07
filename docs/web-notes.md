# 웹(web/) 메모

## 실행

```bash
cd web
cp .env.example .env.local   # 값 채우기 (NEXT_PUBLIC_* 만, 비밀값 넣지 않기)
pnpm install
pnpm dev                     # http://localhost:3000
```

- 검사: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm check:taxonomy`
- 태그 체계를 바꾸면 `api/app/domain/*.json` 수정 후 `pnpm sync:taxonomy` (웹 사본 `src/lib/taxonomy.json`, `style_presets.json` 갱신)

## 구조

- Next.js 16 App Router (Turbopack, Cache Components 켜짐) + Tailwind v4 + TypeScript
- `src/app/(app)/*` — 로그인 후 화면. `AppShell`이 가드(로그아웃 → `/welcome`, 온보딩 미완료 → `/onboarding`) + 사이드바 + 개발 모드 띠
- `src/app/welcome`, `src/app/onboarding`, `src/app/auth/callback` — 로그인·온보딩
- `src/lib/api.ts` — FastAPI 클라이언트(Bearer = Supabase access token), `/chat` SSE 파서
- `src/lib/types.ts` — `docs/api-contract.md`를 그대로 옮긴 타입
- Supabase JS는 **로그인에만** 사용. 데이터는 전부 FastAPI 경유

## 보안

- 웹에는 `NEXT_PUBLIC_*` 공개 값만. AI 키 입력값은 컴포넌트 상태에만 있다가 `POST /ai/connections/{provider}`로 한 번 보내고 즉시 지움. localStorage·sessionStorage에 저장하지 않음
- 개발 모드 테스트 로그인 버튼은 `NEXT_PUBLIC_APP_ENV=development`일 때만 렌더링. 비밀번호는 웹에 없음(서버 `/dev/session`이 처리)

## 구현하며 정한 것

- 옷장은 `GET /items?active=all`로 한 번 받아 화면에서 필터 (200벌 기준 즉시, F03 1초 기준)
- 오늘의 코디: 화면 진입·날짜·지역·시간대 변경 시 자동 생성. 분위기·일정 변경은 버튼으로 다시 생성(무료 사용량 절약)
- 대화 화면은 Cache Components의 Activity 때문에 다른 화면에 갔다 와도 대화·진행 중 스트림을 유지(한 번만 로드)
- 업로드 후 '건너뛰기'한 사진은 Storage에 남음 (계약에 고아 파일 삭제 API 없음 → 계정 삭제 시 폴더째 삭제)
- 카카오 로그인 요청 시 `scopes: "profile_nickname profile_image"`를 넘김. Supabase가 기본으로 `account_email`을 함께 요청하면 KOE205가 날 수 있으니 카카오 설정 때 실제 동작 확인 필요 (요구서 11.1)
