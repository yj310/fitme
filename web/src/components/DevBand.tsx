"use client";

import { useEffect, useState } from "react";
import { getHealth } from "@/lib/api";
import { isDev } from "@/lib/env";

/** Development mode strip: "개발 모드 · 사용 모델명" (spec 6.1). Hidden in production. */
export function DevBand() {
  const [model, setModel] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (!isDev) return;
    getHealth()
      .then((h) => setModel(h.models?.chat ?? null))
      .catch(() => setOffline(true));
  }, []);
  if (!isDev) return null;
  return (
    <div className="bg-warn-soft px-4 py-1 text-center font-mono text-[11.5px] text-warn">
      개발 모드 · {offline ? "API 서버에 연결 안 됨" : (model ?? "모델 확인 중")}
    </div>
  );
}
