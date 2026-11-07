"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/AppShell";
import { onboardingDone, useAuth } from "@/components/providers/AuthProvider";
import { Banner, Button } from "@/components/ui";
import { devSession, errorMessage } from "@/lib/api";
import { isDev } from "@/lib/env";
import { getSupabase } from "@/lib/supabase";

function KakaoSymbol() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#000000"
        d="M12 3C6.48 3 2 6.48 2 10.78c0 2.78 1.86 5.22 4.66 6.6-.15.52-.97 3.36-1 3.58 0 0-.02.17.09.24.11.06.24.01.24.01.32-.04 3.7-2.42 4.28-2.83.56.08 1.14.12 1.73.12 5.52 0 10-3.48 10-7.72S17.52 3 12 3Z"
      />
    </svg>
  );
}

export default function WelcomePage() {
  const { status, me, configError } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "signed_in" && me) router.replace(onboardingDone(me) ? "/chat" : "/onboarding");
  }, [status, me, router]);

  const kakao = async () => {
    setBusy("kakao");
    setError(null);
    try {
      const { error: err } = await getSupabase().auth.signInWithOAuth({
        provider: "kakao",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          // Only nickname + profile image. No email (spec F11, 11.1).
          scopes: "profile_nickname profile_image",
        },
      });
      if (err) throw err;
    } catch (e) {
      setError(errorMessage(e) || "카카오 로그인을 시작하지 못했어요.");
      setBusy(null);
    }
  };

  const devLogin = async (account: "a" | "b") => {
    setBusy(account);
    setError(null);
    try {
      const tokens = await devSession(account);
      const { error: err } = await getSupabase().auth.setSession(tokens);
      if (err) throw err;
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid min-h-screen bg-bg md:grid-cols-[1.1fr_1fr]">
      <section className="flex flex-col justify-center gap-5 px-6 py-12 md:px-16">
        <Logo className="text-lg" />
        <h1 className="text-[28px] font-bold leading-snug md:text-[36px]">
          내 옷장으로 오늘 입을 옷을
          <br />
          같이 골라드려요
        </h1>
        <p className="text-[15px] text-muted">보유한 옷만으로 코디하고, 대화로 고쳐요.</p>
        <ul className="flex flex-col gap-1.5 text-[13.5px] text-muted">
          <li>✓ 내 옷 사진을 올리면 AI가 태그를 정리해요</li>
          <li>✓ 상황·날씨·추구미에 맞춰 코디 3개를 골라요</li>
          <li>✓ “슬랙스 빼줘” 한마디로 다시 짜요</li>
        </ul>
      </section>
      <section className="flex items-center justify-center px-6 pb-12 md:py-12">
        <div className="flex w-full max-w-[380px] flex-col gap-4 rounded-[16px] border border-line bg-surface p-6">
          <h2 className="text-base font-semibold">시작하기</h2>
          {configError && <Banner tone="danger">{configError}</Banner>}
          {error && <Banner tone="danger">{error}</Banner>}
          <button
            type="button"
            onClick={kakao}
            disabled={busy !== null || Boolean(configError)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-[#FEE500] text-[15px] font-semibold text-black/85 disabled:opacity-60"
          >
            <KakaoSymbol />
            카카오로 계속하기
          </button>
          <p className="text-xs leading-relaxed text-muted">
            옷 사진과 선택 입력한 신체 정보를 코디 추천에만 사용해요. 설정에서 언제든 전부 삭제할 수 있어요.
            <br />
            기본 무료 AI는 사용량 제한이 있고, 입력 내용이 AI 제공사의 제품 개선에 쓰일 수 있어요.
          </p>
          {isDev && (
            <div className="flex flex-col gap-2 border-t border-dashed border-line-strong pt-4">
              <span className="text-xs font-semibold text-warn">개발 모드 전용</span>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ghost" loading={busy === "a"} disabled={busy !== null} onClick={() => devLogin("a")}>
                  테스트 계정 A로 로그인
                </Button>
                <Button variant="ghost" loading={busy === "b"} disabled={busy !== null} onClick={() => devLogin("b")}>
                  테스트 계정 B로 로그인
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
