"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { onboardingDone, useAuth } from "@/components/providers/AuthProvider";
import { ErrorState, LoadingState } from "@/components/ui";
import { getSupabase } from "@/lib/supabase";

/**
 * Kakao → Supabase → here with ?code=. The browser client (PKCE, detectSessionInUrl) exchanges
 * the code by itself; we just wait for the session and route on.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const { status, me } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errDesc = params.get("error_description") || params.get("error");
    if (errDesc) {
      queueMicrotask(() => setError("로그인이 취소되었거나 실패했어요."));
      return;
    }
    // Make sure the client is created so it detects ?code= and exchanges it (PKCE, detectSessionInUrl).
    try {
      getSupabase();
    } catch {
      queueMicrotask(() => setError("로그인 설정을 찾지 못했어요."));
    }
  }, []);

  useEffect(() => {
    if (status === "signed_in" && me) router.replace(onboardingDone(me) ? "/chat" : "/onboarding");
    if (status === "signed_out") {
      const t = setTimeout(() => setError("로그인 정보를 확인하지 못했어요."), 4000);
      return () => clearTimeout(t);
    }
  }, [status, me, router]);

  return (
    <div className="grid min-h-screen place-items-center px-4">
      {error ? (
        <div className="flex flex-col items-center gap-3">
          <ErrorState message={error} />
          <Link href="/welcome" className="text-accent underline">
            로그인 화면으로
          </Link>
        </div>
      ) : (
        <LoadingState label="로그인하는 중이에요" />
      )}
    </div>
  );
}
