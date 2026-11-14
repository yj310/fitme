"use client";

import Link from "next/link";
import { QUOTA_MESSAGE } from "@/lib/api";
import { Banner } from "./ui";

/** Error banner; the free-quota error links to /settings/ai (spec F10-a). */
export function ApiErrorBanner({ code, message, onClose }: { code?: string; message: string; onClose?: () => void }) {
  if (code === "FREE_QUOTA_EXCEEDED") {
    return (
      <Banner tone="warn" onClose={onClose}>
        {QUOTA_MESSAGE}{" "}
        <Link href="/settings/ai" className="font-semibold underline">
          내 AI 키 연결하기
        </Link>
      </Banner>
    );
  }
  return (
    <Banner tone="danger" onClose={onClose}>
      {message}
    </Banner>
  );
}
