"use client";

import { useEffect, useState } from "react";
import { errorMessage, nearestRegion, searchRegions } from "@/lib/api";
import type { Region } from "@/lib/types";
import { Button, inputCls, Spinner } from "./ui";

/** 시·군·구 search (KMA grid table) + browser location (spec F06). */
export function RegionPicker({ onSelect }: { onSelect: (r: Region) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Region[]>([]);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    let alive = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await searchRegions(term);
        if (alive) {
          setResults(r.regions);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(errorMessage(e));
      } finally {
        if (alive) setBusy(false);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const locate = () => {
    if (!navigator.geolocation) {
      setError("이 브라우저는 위치를 지원하지 않아요.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await nearestRegion(pos.coords.latitude, pos.coords.longitude);
          onSelect(r.region);
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setLocating(false);
        }
      },
      () => {
        setError("위치 권한이 없어서 현재 위치를 찾지 못했어요. 지역을 검색해 주세요.");
        setLocating(false);
      },
      { timeout: 8000, maximumAge: 600_000 },
    );
  };

  const shown = q.trim() ? results : [];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          aria-label="지역 검색"
          className={inputCls}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="시·군·구 검색 (예: 마포구)"
        />
        <Button variant="ghost" onClick={locate} loading={locating}>
          현재 위치
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {busy && (
        <span className="flex items-center gap-1 text-xs text-muted">
          <Spinner size={12} /> 찾는 중
        </span>
      )}
      {shown.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-[8px] border border-line">
          {shown.map((r) => (
            <li key={r.code}>
              <button
                type="button"
                onClick={() => {
                  onSelect(r);
                  setQ("");
                  setResults([]);
                }}
                className="w-full px-3 py-1.5 text-left text-[13px] hover:bg-tile"
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim() && !busy && shown.length === 0 && !error && <p className="text-xs text-muted">검색 결과가 없어요.</p>}
    </div>
  );
}
