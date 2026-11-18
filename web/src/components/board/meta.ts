import type { BoardKind, BoardStatus } from "@/lib/types";

export const STATUS: Record<BoardStatus, { label: string; chip: string; dot: string }> = {
  new: { label: "접수", chip: "bg-warn-soft text-warn", dot: "bg-warn" },
  doing: { label: "해결 중", chip: "bg-accent-soft text-accent", dot: "bg-accent" },
  done: { label: "해결됨", chip: "bg-good-soft text-good", dot: "bg-good" },
  hold: { label: "보류", chip: "bg-tile text-muted", dot: "bg-line-strong" },
};
export const STATUS_ORDER: BoardStatus[] = ["new", "doing", "done", "hold"];

export const KIND: Record<BoardKind, { label: string; ask: string; icon: string }> = {
  bug: { label: "버그", ask: "안 돼요", icon: "🐞" },
  idea: { label: "개선 제안", ask: "이러면 좋겠어요", icon: "💡" },
  etc: { label: "기타", ask: "그 밖에", icon: "💬" },
};

const PAGES: [string, string][] = [
  ["/onboarding", "온보딩"],
  ["/chat", "대화"],
  ["/closet", "옷장"],
  ["/today", "오늘의 코디"],
  ["/saved", "저장한 코디"],
  ["/me", "내 프로필"],
  ["/settings", "설정"],
  ["/admin", "피드백 관리"],
];

/** "옷장" for /closet; the path itself for anything else. */
export function pageLabel(pathname: string): string {
  return PAGES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? pathname;
}

/** "iPhone · Safari" — a short device summary, nothing that identifies the person. */
export function deviceLabel(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "기타";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "삼성 인터넷"
      : /KAKAOTALK/i.test(ua)
        ? "카카오톡"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "브라우저";
  const w = typeof window === "undefined" ? "" : ` · ${window.innerWidth}×${window.innerHeight}`;
  return `${os} · ${browser}${w}`;
}

export function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}시간 전`;
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, "0")}`;
}
