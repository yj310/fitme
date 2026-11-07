"use client";

import { useState } from "react";
import { errorMessage, setFavorite } from "@/lib/api";
import { cx } from "@/lib/format";
import { label } from "@/lib/taxonomy";
import type { MissingCategory, OutfitCard } from "@/lib/types";
import { ItemThumb } from "./ItemThumb";
import { Banner } from "./ui";

export function FavoriteButton({
  outfit,
  onChange,
  size = "sm",
}: {
  outfit: OutfitCard;
  onChange?: (o: OutfitCard) => void;
  size?: "sm" | "md";
}) {
  const [on, setOn] = useState(outfit.is_favorite);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep in sync when the parent passes a new outfit object.
  const [seenId, setSeenId] = useState(outfit.id);
  if (seenId !== outfit.id) {
    setSeenId(outfit.id);
    setOn(outfit.is_favorite);
  }

  const toggle = async () => {
    const next = !on;
    setOn(next);
    setBusy(true);
    setError(null);
    try {
      const r = await setFavorite(outfit.id, next);
      setOn(r.is_favorite);
      onChange?.({ ...outfit, is_favorite: r.is_favorite });
    } catch (e) {
      setOn(!next);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        aria-pressed={on}
        aria-label={on ? "저장 해제" : "코디 저장"}
        title={on ? "저장 해제" : "♥ 저장"}
        onClick={toggle}
        disabled={busy}
        className={cx(
          "inline-flex items-center gap-1 rounded-full border font-semibold transition-colors",
          size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1.5 text-[13px]",
          on ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-surface text-muted hover:text-ink",
        )}
      >
        <span aria-hidden>{on ? "♥" : "♡"}</span>
        {size === "md" && (on ? "저장됨" : "저장")}
      </button>
      {error && <span className="mt-1 text-[11px] text-danger">{error}</span>}
    </span>
  );
}

export function OutfitThumbs({ outfit, max = 4, className }: { outfit: OutfitCard; max?: number; className?: string }) {
  const items = outfit.items.slice(0, max);
  return (
    <div className={cx("grid gap-1.5", className)} style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 3)}, minmax(0, 1fr))` }}>
      {items.map((i) => (
        <ItemThumb key={i.id} src={i.image_url} alt={i.name} subcategory={i.subcategory} color={i.color} rounded="rounded-[8px]" />
      ))}
    </div>
  );
}

/** Compact card for the chat result panel. */
export function CompactOutfitCard({ outfit, onChange }: { outfit: OutfitCard; onChange?: (o: OutfitCard) => void }) {
  return (
    <article className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3">
      <OutfitThumbs outfit={outfit} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold">
            {outfit.rank} · {outfit.title}
          </h3>
          {outfit.reasons[0] && <p className="line-clamp-2 text-xs text-muted">{outfit.reasons[0]}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <ScoreText score={outfit.score} />
          <FavoriteButton outfit={outfit} onChange={onChange} />
        </div>
      </div>
    </article>
  );
}

export function ScoreText({ score, large }: { score: number; large?: boolean }) {
  return (
    <span className={cx("font-mono font-semibold text-accent", large ? "text-2xl" : "text-[15px]")} aria-label={`점수 ${Math.round(score)}점`}>
      {Math.round(score)}
    </span>
  );
}

export function ScoreBreakdown({ outfit }: { outfit: OutfitCard }) {
  const d = outfit.score_detail;
  const rows: [string, number][] = [
    ["스타일 일치", d.style],
    ["조화", d.harmony],
    ["상황", d.situation],
    ["개인 선호", d.preference],
  ];
  return (
    <dl className="grid grid-cols-4 gap-2 text-[11px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-1">
          <dt className="text-muted">{k}</dt>
          <dd className="flex items-center gap-1.5">
            <span className="h-1.5 flex-1 overflow-hidden rounded bg-line">
              <span className="block h-full rounded bg-accent" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
            </span>
            <span className="font-mono">{Math.round(v)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Grid card for saved outfits / alternatives. */
export function OutfitGridCard({
  outfit,
  onChange,
  heading,
  showMeta,
}: {
  outfit: OutfitCard;
  onChange?: (o: OutfitCard) => void;
  heading?: string;
  showMeta?: boolean;
}) {
  return (
    <article className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5">
      <OutfitThumbs outfit={outfit} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {heading && <p className="text-[11px] font-semibold text-muted">{heading}</p>}
          <h3 className="text-[13.5px] font-semibold">{outfit.title}</h3>
          {outfit.reasons[0] && <p className="line-clamp-2 text-xs text-muted">{outfit.reasons[0]}</p>}
        </div>
        <ScoreText score={outfit.score} />
      </div>
      <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted">
        <span className="truncate">
          {showMeta && [outfit.occasion, outfit.target_date].filter(Boolean).join(" · ")}
        </span>
        <FavoriteButton outfit={outfit} onChange={onChange} />
      </div>
    </article>
  );
}

export function MissingNotice({ missing, count }: { missing?: MissingCategory[]; count: number }) {
  if (!missing?.length && count >= 3) return null;
  const text = (missing ?? [])
    .filter((m) => m.have < m.need)
    .map((m) => `${label("category", m.category)} ${m.need - m.have}벌 더`)
    .join(", ");
  return (
    <Banner>
      {count === 0 ? "지금 옷장으로는 코디를 만들 수 없어요." : `옷장이 부족해서 ${count}개만 만들었어요.`}
      {text && <> {text} 등록하면 더 다양하게 골라드릴게요.</>}
      <span className="block text-xs opacity-80">최소 권장: 상의 5 · 하의 3 · 신발 2</span>
    </Banner>
  );
}
