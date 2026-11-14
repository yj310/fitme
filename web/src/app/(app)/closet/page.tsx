"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ItemEditModal } from "@/components/closet/ItemEditModal";
import { TagReviewPanel } from "@/components/closet/TagReviewPanel";
import { MAX_FILES, useUploadQueue } from "@/components/closet/useUploadQueue";
import { ItemThumb } from "@/components/ItemThumb";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button, Chip, EmptyState, ErrorState, PageHeader, toggleIn } from "@/components/ui";
import { errorMessage, listItems } from "@/lib/api";
import { cx } from "@/lib/format";
import { CATEGORIES, COLORS, SEASONS, label } from "@/lib/taxonomy";
import type { Category, Item, ItemCounts } from "@/lib/types";

export default function ClosetPage() {
  const { refreshMe } = useAuth();
  const [items, setItems] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<ItemCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | "all">("all");
  const [colors, setColors] = useState<string[]>([]);
  const [seasons, setSeasons] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const multiRef = useRef<HTMLInputElement>(null);
  const singleRef = useRef<HTMLInputElement>(null);

  // Load the whole closet once and filter on the client: instant for 200 items (spec F03 < 1s).
  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await listItems({ active: "all" });
      setItems(r.items);
      setCounts(r.counts);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load();
  }, [load]);

  const onSaved = useCallback(
    (item: Item) => {
      setItems((list) => (list ? [item, ...list] : [item]));
      setCounts((c) =>
        c ? { ...c, all: c.all + 1, [item.category]: c[item.category] + 1 } : c,
      );
      void refreshMe();
    },
    [refreshMe],
  );
  const queue = useUploadQueue(onSaved);

  const pick = (files: FileList | null) => {
    if (!files?.length) return;
    queue.addFiles(files);
    setPanelOpen(true);
  };

  const visible = useMemo(() => {
    if (!items) return [];
    return items.filter(
      (i) =>
        (showArchived ? !i.is_active : i.is_active) &&
        (category === "all" || i.category === category) &&
        (!colors.length || colors.includes(i.color)) &&
        (!seasons.length || i.seasons.some((s) => seasons.includes(s))),
    );
  }, [items, category, colors, seasons, showArchived]);

  const replace = (updated: Item) => {
    setItems((list) => list?.map((i) => (i.id === updated.id ? updated : i)) ?? null);
    void load();
    void refreshMe();
  };
  const removed = (id: string) => {
    setItems((list) => list?.filter((i) => i.id !== id) ?? null);
    void load();
    void refreshMe();
  };

  const filtersActive = colors.length > 0 || seasons.length > 0;

  return (
    <div className={cx("grid gap-5 px-[26px] py-[22px]", panelOpen && "grid-cols-[minmax(0,1fr)_280px]")}>
      <div className="flex min-w-0 flex-col gap-4">
        <PageHeader
          title="옷장"
          sub={counts ? `${counts.all}벌` : undefined}
          right={
            <>
              <Button variant="ghost" onClick={() => multiRef.current?.click()}>
                사진 여러 장 올리기
              </Button>
              <Button onClick={() => singleRef.current?.click()}>+ 옷 등록</Button>
              <input
                ref={multiRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  pick(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={singleRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  pick(e.target.files);
                  e.target.value = "";
                }}
              />
            </>
          }
        />

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip on={category === "all"} onClick={() => setCategory("all")}>
              전체 {counts?.all ?? ""}
            </Chip>
            {CATEGORIES.map((c) => (
              <Chip key={c.code} on={category === c.code} onClick={() => setCategory(c.code)}>
                {c.label} {counts?.[c.code] ?? ""}
              </Chip>
            ))}
            <span className="mx-1 h-4 w-px bg-line" aria-hidden />
            <Chip on={moreFilters || filtersActive} onClick={() => setMoreFilters((v) => !v)}>
              색·계절{filtersActive ? ` ${colors.length + seasons.length}` : ""}
            </Chip>
            <Chip on={showArchived} onClick={() => setShowArchived((v) => !v)}>
              보관 {counts?.archived ?? ""}
            </Chip>
          </div>
          {moreFilters && (
            <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-10 text-xs text-muted">계절</span>
                {SEASONS.map((s) => (
                  <Chip key={s.code} on={seasons.includes(s.code)} onClick={() => setSeasons((v) => toggleIn(v, s.code))}>
                    {s.label}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-10 text-xs text-muted">색</span>
                {COLORS.map((c) => (
                  <Chip key={c.code} on={colors.includes(c.code)} onClick={() => setColors((v) => toggleIn(v, c.code))}>
                    <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border border-line-strong" style={{ background: c.hex }} />
                    {c.label}
                  </Chip>
                ))}
              </div>
              {filtersActive && (
                <div>
                  <Button
                    variant="subtle"
                    onClick={() => {
                      setColors([]);
                      setSeasons([]);
                    }}
                  >
                    필터 지우기
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !items ? (
          <div className="grid grid-cols-6 gap-2.5" aria-busy>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="skeleton aspect-square" />
                <div className="skeleton h-3 w-3/4" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="옷을 등록하면 코디를 받을 수 있어요"
            description={`사진을 한 번에 ${MAX_FILES}장까지 올릴 수 있어요. 최소 권장: 상의 5 · 하의 3 · 신발 2`}
            action={<Button onClick={() => multiRef.current?.click()}>옷 사진 올리기</Button>}
          />
        ) : visible.length === 0 ? (
          <EmptyState title={showArchived ? "보관한 옷이 없어요" : "조건에 맞는 옷이 없어요"} description="필터를 바꿔 보세요." />
        ) : (
          <ul className="grid grid-cols-6 gap-2.5">
            {visible.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => setEditing(i)}
                  className="flex w-full flex-col gap-1 text-left text-[11.5px]"
                >
                  <ItemThumb src={i.image_url} alt={i.name} subcategory={i.subcategory} color={i.color} className={cx(!i.is_active && "opacity-60")} />
                  <span className="truncate text-[12.5px] font-medium text-ink">{i.name}</span>
                  <span className="truncate text-muted">
                    {label("category", i.category)}
                    {i.fit && i.fit !== "none" ? ` · ${label("fit", i.fit)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {panelOpen && (
        <div className="sticky top-4 self-start">
          <TagReviewPanel queue={queue} onClose={() => setPanelOpen(false)} />
        </div>
      )}

      <ItemEditModal item={editing} onClose={() => setEditing(null)} onChanged={replace} onDeleted={removed} />
    </div>
  );
}
