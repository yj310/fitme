"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { cx } from "@/lib/format";
import { onboardingDone, useAuth } from "./providers/AuthProvider";
import { DevBand } from "./DevBand";
import { ErrorState, LoadingState } from "./ui";

const NAV = [
  { href: "/chat", label: "대화" },
  { href: "/closet", label: "옷장", count: true },
  { href: "/today", label: "오늘의 코디" },
  { href: "/saved", label: "저장한 코디" },
  { href: "/me", label: "내 프로필" },
  { href: "/settings", label: "설정" },
];

export function Logo({ className }: { className?: string }) {
  return <span className={cx("font-bold tracking-[0.18em] text-accent", className)}>FITME</span>;
}

/** Guards the signed-in app: logged out → /welcome, onboarding not finished → /onboarding. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, me, meError, refreshMe } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "signed_out") router.replace("/welcome");
    else if (status === "signed_in" && me && !onboardingDone(me)) router.replace("/onboarding");
  }, [status, me, router]);

  if (status !== "signed_in" || (!me && !meError)) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LoadingState />
      </div>
    );
  }
  if (!me) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <ErrorState message={meError ?? "프로필을 불러오지 못했어요."} onRetry={() => void refreshMe()} />
      </div>
    );
  }

  return (
    <div className="flex h-screen min-w-[1024px] flex-col">
      <DevBand />
      <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)]">
        <aside className="flex h-full flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface px-3 py-[18px]">
          <Link href="/chat" className="mb-4 px-2.5">
            <Logo />
          </Link>
          <nav aria-label="주 메뉴" className="flex flex-col gap-0.5">
            {NAV.map((n) => {
              const on = pathname === n.href || pathname.startsWith(`${n.href}/`);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={on ? "page" : undefined}
                  className={cx(
                    "flex justify-between rounded-lg px-2.5 py-[7px]",
                    on ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-tile hover:text-ink",
                  )}
                >
                  <span>{n.label}</span>
                  {n.count && <span className="font-mono text-xs">{me.closet_count}</span>}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto flex flex-col gap-1 border-t border-line px-2.5 pt-3 text-xs">
            <span className="text-muted">추구미</span>
            <Link href="/me" className="font-semibold text-ink hover:text-accent">
              {me.default_style?.style_name ?? "아직 없어요"}
            </Link>
          </div>
        </aside>
        <main className="h-full min-h-0 min-w-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
