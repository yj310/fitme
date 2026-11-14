"use client";

import { cx } from "@/lib/format";
import {
  CATEGORIES,
  COLORS,
  FORMALITY,
  MATERIALS,
  PATTERNS,
  SEASONS,
  STYLE_TAGS,
  SUBCATEGORIES,
  WARMTH,
  autoName,
  fitsFor,
} from "@/lib/taxonomy";
import type { Category, TagSuggestion } from "@/lib/types";
import { Chip, inputCls, Select, toggleIn } from "../ui";

export interface TagDraft extends TagSuggestion {
  name: string;
  nameEdited: boolean;
  brand: string;
  size_label: string;
  memo: string;
}

export const LOW_CONFIDENCE = 0.6;

export function emptyDraft(): TagDraft {
  return {
    category: "top",
    subcategory: "tshirt_short",
    color: "white",
    pattern: "solid",
    fit: "regular",
    material: null,
    seasons: [],
    style_tags: [],
    formality: 2,
    warmth: 2,
    name: autoName("white", "tshirt_short"),
    nameEdited: false,
    brand: "",
    size_label: "",
    memo: "",
  };
}

export function draftFromTags(tags: TagSuggestion, name?: string): TagDraft {
  return {
    ...tags,
    material: tags.material ?? null,
    name: name || autoName(tags.color, tags.subcategory),
    nameEdited: false,
    brand: "",
    size_label: "",
    memo: "",
  };
}

/** Which tag fields differ — used to decide tag_source "ai" vs "user_edited". */
export function tagsChanged(a: TagSuggestion, b: TagSuggestion): boolean {
  const keys: (keyof TagSuggestion)[] = [
    "category",
    "subcategory",
    "color",
    "pattern",
    "fit",
    "material",
    "formality",
    "warmth",
  ];
  if (keys.some((k) => (a[k] ?? null) !== (b[k] ?? null))) return true;
  const set = (x: string[]) => [...x].sort().join(",");
  return set(a.seasons) !== set(b.seasons) || set(a.style_tags) !== set(b.style_tags);
}

function Row({
  label,
  conf,
  children,
}: {
  label: string;
  conf?: number;
  children: React.ReactNode;
}) {
  const low = conf !== undefined && conf < LOW_CONFIDENCE;
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)_52px] items-center gap-x-2 gap-y-1 text-[12.5px]">
      <span className="text-muted">{label}</span>
      <div className={cx("min-w-0 rounded-[8px]", low && "ring-2 ring-warn ring-offset-1 ring-offset-surface")}>
        {children}
      </div>
      <span className={cx("text-right font-mono text-[11px]", low ? "font-semibold text-warn" : "text-muted")}>
        {conf !== undefined ? (
          <>
            {Math.round(conf * 100)}%{low && <span className="block text-[10px]">확인 필요</span>}
          </>
        ) : (
          ""
        )}
      </span>
    </div>
  );
}

function Seg({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: number;
  options: { code: number; label: string }[];
  onChange: (v: 1 | 2 | 3) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex gap-0.5 rounded-[8px] border border-line-strong bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.code}
          type="button"
          aria-pressed={value === o.code}
          onClick={() => onChange(o.code as 1 | 2 | 3)}
          className={cx(
            "rounded-[6px] px-2.5 py-0.5 text-xs font-semibold",
            value === o.code ? "bg-accent text-accent-ink" : "text-ink hover:bg-tile",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TagForm({
  value,
  onChange,
  confidence,
  showExtras = true,
}: {
  value: TagDraft;
  onChange: (d: TagDraft) => void;
  confidence?: Record<string, number>;
  showExtras?: boolean;
}) {
  const set = (patch: Partial<TagDraft>) => {
    const next = { ...value, ...patch };
    if (!next.nameEdited && (patch.color || patch.subcategory)) next.name = autoName(next.color, next.subcategory);
    onChange(next);
  };
  const c = confidence ?? {};

  const changeCategory = (cat: Category) => {
    const sub = SUBCATEGORIES[cat][0].code;
    const fit = fitsFor(cat)[0]?.code ?? "none";
    set({ category: cat, subcategory: sub, fit });
  };

  return (
    <div className="flex flex-col gap-2">
      <Row label="카테고리" conf={c.category}>
        <div className="grid grid-cols-2 gap-1">
          <Select
            ariaLabel="카테고리"
            value={value.category}
            onChange={(v) => changeCategory(v as Category)}
            options={CATEGORIES}
          />
          <Select
            ariaLabel="세부 카테고리"
            value={value.subcategory}
            onChange={(v) => set({ subcategory: v })}
            options={SUBCATEGORIES[value.category]}
          />
        </div>
      </Row>
      <Row label="색" conf={c.color}>
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-5 w-5 shrink-0 rounded-full border border-line-strong"
            style={{ background: COLORS.find((x) => x.code === value.color)?.hex }}
          />
          <Select ariaLabel="색" value={value.color} onChange={(v) => set({ color: v })} options={COLORS} />
        </div>
      </Row>
      <Row label="패턴" conf={c.pattern}>
        <Select ariaLabel="패턴" value={value.pattern} onChange={(v) => set({ pattern: v })} options={PATTERNS} />
      </Row>
      <Row label="핏" conf={c.fit}>
        <Select ariaLabel="핏" value={value.fit} onChange={(v) => set({ fit: v })} options={fitsFor(value.category)} />
      </Row>
      <Row label="계절" conf={c.seasons}>
        <div className="flex flex-wrap gap-1">
          {SEASONS.map((s) => (
            <Chip key={s.code} on={value.seasons.includes(s.code)} onClick={() => set({ seasons: toggleIn(value.seasons, s.code) })}>
              {s.label}
            </Chip>
          ))}
        </div>
      </Row>
      <Row label="스타일" conf={c.style_tags}>
        <div className="flex flex-wrap gap-1">
          {STYLE_TAGS.map((s) => (
            <Chip
              key={s.code}
              on={value.style_tags.includes(s.code)}
              onClick={() => set({ style_tags: toggleIn(value.style_tags, s.code, 3) })}
            >
              {s.label}
            </Chip>
          ))}
        </div>
      </Row>
      <Row label="격식" conf={c.formality}>
        <Seg ariaLabel="격식" value={value.formality} options={FORMALITY} onChange={(v) => set({ formality: v })} />
      </Row>
      <Row label="보온" conf={c.warmth}>
        <Seg ariaLabel="보온" value={value.warmth} options={WARMTH} onChange={(v) => set({ warmth: v })} />
      </Row>
      <Row label="소재" conf={c.material}>
        <Select
          ariaLabel="소재"
          value={value.material ?? ""}
          onChange={(v) => set({ material: v || null })}
          options={MATERIALS}
          placeholder="선택 안 함"
        />
      </Row>
      {showExtras && (
        <>
          <Row label="이름">
            <input
              aria-label="이름"
              className={inputCls}
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value, nameEdited: true })}
            />
          </Row>
          <Row label="브랜드">
            <input aria-label="브랜드" className={inputCls} value={value.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="선택" />
          </Row>
          <Row label="사이즈">
            <input aria-label="사이즈" className={inputCls} value={value.size_label} onChange={(e) => set({ size_label: e.target.value })} placeholder="선택" />
          </Row>
          <Row label="메모">
            <input aria-label="메모" className={inputCls} value={value.memo} onChange={(e) => set({ memo: e.target.value })} placeholder="선택" />
          </Row>
        </>
      )}
    </div>
  );
}
