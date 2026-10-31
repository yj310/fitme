---
id: fitme-p1-개발
title: FITME P1 개발
labels: [p1, feature]
priority: high
created: 2026-10-31
depends_on: []
---

요구서 `FITME_개발요구서_v1.0.md`(P1) 기준 개발. 결정 사항은 `docs/decisions.md`.

## 체크리스트
- [x] 저장소 생성 (공개 GitHub `yj310/fitme`), 비밀값 커밋 차단 훅(gitleaks)
- [x] 태그 체계·추구미 프리셋·DB 마이그레이션(RLS, 비공개 버킷)
- [x] 기상청 격자 표(공식 엑셀 → 274개 지역)
- [x] API 계약 문서 (`docs/api-contract.md`)
- [x] API: 인증·프로필·옷장·추구미·날씨·대화 SSE·오늘의 코디·저장·AI 연결
- [x] 모델 라우터 + 개발/운영 모드 + 제공사 어댑터 (Gemini·Claude·OpenAI·NVIDIA)
- [x] 에이전트 그래프(LangGraph) + 검증·점수 규칙 + 재시도·되묻기
- [x] 웹 화면 7개 + 온보딩 (Next.js)
- [x] API 테스트 (인수 시나리오 흐름, 다른 계정 차단, 상한, 키 실패 전환, 계정 삭제)
- [x] 샘플 옷 사진: 평가 30장 + 시드 27벌 (출처 `docs/image-credits.md`)
- [x] 날씨 서비스 단위 테스트
- [x] 시드 스크립트 (테스트 계정 A/B + 샘플 옷장 업로드)
- [x] 평가 세트(코디 요청 30개) + `eval/run.py`
- [x] Dockerfile, CI(gitleaks·테스트·웹 빌드), README
- [x] 웹 ↔ API 계약 일치 점검
- [ ] 시드 사진 3장 추가 (사용자 제공 대기)
- [ ] 실제 키 연결 후 통합 확인 (Supabase·카카오·기상청·Gemini·NVIDIA) — 사용자 설정 대기
- [ ] 배포 (Vercel·Render) — 사용자 계정 대기

## 결과 요약
- API 테스트 43개 통과, 오프라인 평가 30개 요청: ID 유효성 100% · 제외 재추천 0건 · 3개 생성 100%.
- 웹 빌드·린트·타입 검사 통과 (12개 경로). 실제 Supabase·AI 키 연결 후 브라우저 확인은 아직.
- 남은 일: 시드 사진 3장, 외부 서비스 키 설정, 실제 모델 평가(`--llm live`), 배포.
