"use client";

// 추구미 = everything about the look the user wants (fit, styles, liked/avoided colors, avoided items).
// Onboarding and 내 프로필 ask for it with the same pages, one question per page, big picture cards.

import Image from "next/image";
import { useState } from "react";
import { analyzeStyle, errorMessage } from "@/lib/api";
import { cx } from "@/lib/format";
import { CATEGORIES, COLORS, STYLE_TAGS, SUBCATEGORIES, TOP_FITS, labels } from "@/lib/taxonomy";
import type { Gender, StyleAttributes } from "@/lib/types";
import { ClothingIcon, TYPICAL_COLOR } from "../ClothingIcon";
import { Banner, Button, Chip, Field, inputCls, toggleIn } from "../ui";

// ── draft ──

export const STYLE_PAGES = ["fit", "style", "colors", "items"] as const;
export type StylePageKey = (typeof STYLE_PAGES)[number];

export interface StyleDraft {
  style_name: string;
  source_text: string;
  top: string[];
  bottom: string[];
  style_tags: string[];
  mood: string[];
  preferred_colors: string[];
  avoid_colors: string[];
  avoid_subcategories: string[];
}

export const EMPTY_DRAFT: StyleDraft = {
  style_name: "",
  source_text: "",
  top: [],
  bottom: [],
  style_tags: [],
  mood: [],
  preferred_colors: [],
  avoid_colors: [],
  avoid_subcategories: [],
};

const MAX_LIKED_COLORS = 6;

/** The fit photos show a whole outfit, so picking one also picks the trousers that go with it. */
const BOTTOM_FOR_FIT: Record<string, string[]> = {
  slim: ["slim"],
  regular: ["straight"],
  semi_over: ["straight", "wide"],
  over: ["wide"],
};

/** One mood word per style, used when the user picked styles instead of writing a description. */
const STYLE_MOOD: Record<string, string> = {
  minimal: "깔끔한",
  casual: "편안한",
  street: "힙한",
  office: "단정한",
  feminine: "부드러운",
  classic: "정갈한",
  sporty: "활동적인",
  vintage: "레트로한",
  french_chic: "무심한",
  amekaji: "빈티지한",
};

export function draftFrom(p: { style_name: string; attributes: StyleAttributes; source_text?: string | null }): StyleDraft {
  const a = p.attributes;
  return {
    style_name: p.style_name,
    source_text: p.source_text ?? "",
    top: a.silhouette?.top ?? [],
    bottom: a.silhouette?.bottom ?? [],
    style_tags: a.style_tags ?? [],
    mood: a.mood ?? [],
    preferred_colors: a.preferred_colors ?? [],
    avoid_colors: a.avoid?.colors ?? [],
    avoid_subcategories: a.avoid?.subcategories ?? [],
  };
}

export function attributesOf(d: StyleDraft): StyleAttributes {
  return {
    style_tags: d.style_tags,
    preferred_colors: d.preferred_colors,
    silhouette: { top: d.top, bottom: d.bottom },
    mood: d.mood.length ? d.mood : d.style_tags.map((t) => STYLE_MOOD[t]).filter(Boolean),
    avoid: { subcategories: d.avoid_subcategories, colors: d.avoid_colors },
  };
}

/** What a page still needs before "다음", or null. */
export function pageError(page: StylePageKey, d: StyleDraft): string | null {
  if (page === "fit" && !d.top.length) return "가장 좋아하는 핏을 하나 골라 주세요.";
  if (page === "style" && !d.style_tags.length) return "되고 싶은 스타일을 하나 이상 골라 주세요.";
  return null;
}

/** Optional pages with nothing picked: the button says "없어요, 다음". */
export function pageIsEmpty(page: StylePageKey, d: StyleDraft): boolean {
  if (page === "colors") return !d.preferred_colors.length && !d.avoid_colors.length;
  if (page === "items") return !d.avoid_subcategories.length;
  return false;
}

// ── pictures ──

/** From this height (cm) the "tall" pictures are shown. Roughly the Korean average for each. */
const TALL_FROM: Record<Gender, number> = { female: 163, male: 176 };

export interface LookPerson {
  gender: Gender;
  tall: boolean;
}

export function lookPerson(gender: Gender | "" | null | undefined, height: string | number | null | undefined): LookPerson {
  const g = gender || "female";
  const h = Number(height);
  return { gender: g, tall: !h || h >= TALL_FROM[g] };
}

// Lookbook images generated for FITME (Figma AI) in public/onboarding/, picked by gender and height.
const fitSrc = (p: LookPerson, code: string) => `/onboarding/fit-${p.gender}-${p.tall ? "tall" : "short"}-${code}.webp`;
export const styleSrc = (p: LookPerson, code: string) => `/onboarding/style-${p.gender}-${code}.webp`;

const STYLE_WORDS: Record<string, string> = {
  minimal: "무채색 · 군더더기 없이",
  casual: "맨투맨 · 청바지 · 편하게",
  street: "후드 · 카고 · 캡",
  office: "블레이저 · 슬랙스 · 단정",
  feminine: "파스텔 · 부드러운 소재",
  classic: "트렌치 · 로퍼 · 정갈하게",
  sporty: "트랙 재킷 · 조거 · 활동적",
  vintage: "가디건 · 브라운 톤 · 레트로",
  french_chic: "스트라이프 · 베레모 · 무심한 듯",
  amekaji: "체크 셔츠 · 데님 · 워커",
};

const FIT_WORDS: Record<string, string> = {
  slim: "몸에 딱 맞게",
  regular: "적당히 여유 있게",
  semi_over: "살짝 넉넉하게",
  over: "크고 루즈하게",
};

// ── one page ──

export function StylePage({
  page,
  draft,
  onChange,
  person,
  step,
}: {
  page: StylePageKey;
  draft: StyleDraft;
  onChange: (d: StyleDraft) => void;
  person: LookPerson;
  /** "2 / 4" counter shown above the title. */
  step?: string;
}) {
  const set = (patch: Partial<StyleDraft>) => onChange({ ...draft, ...patch });

  if (page === "fit") {
    return (
      <section className="flex flex-col gap-6">
        <Heading
          step={step}
          title="어떤 핏을 가장 좋아하세요?"
          sub={`같은 옷을 핏만 다르게 입은 모습이에요 (${person.gender === "female" ? "여성" : "남성"} · 키 ${person.tall ? "큰" : "작은"} 편 기준).`}
        />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {TOP_FITS.map((f) => (
            <Tile
              key={f.code}
              on={draft.top[0] === f.code}
              onClick={() => set({ top: [f.code], bottom: BOTTOM_FOR_FIT[f.code] ?? [] })}
              label={f.label}
              desc={FIT_WORDS[f.code]}
              media={<Look src={fitSrc(person, f.code)} crop />}
            />
          ))}
        </div>
      </section>
    );
  }

  if (page === "style") {
    return (
      <section className="flex flex-col gap-6">
        <Heading
          step={step}
          title="어떤 스타일이 되고 싶나요?"
          sub={`최대 3개까지 골라 주세요. ${draft.style_tags.length ? `${draft.style_tags.length}개 골랐어요.` : ""}`}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {STYLE_TAGS.map((t) => (
            <Tile
              key={t.code}
              on={draft.style_tags.includes(t.code)}
              disabled={!draft.style_tags.includes(t.code) && draft.style_tags.length >= 3}
              // the mood came with the old picks (or the AI); let it follow the new ones
              onClick={() => set({ style_tags: toggleIn(draft.style_tags, t.code, 3), mood: [] })}
              label={t.label}
              desc={STYLE_WORDS[t.code]}
              media={<Look src={styleSrc(person, t.code)} />}
            />
          ))}
        </div>
        <DescribeBox draft={draft} onChange={onChange} />
      </section>
    );
  }

  if (page === "colors") {
    const like = (code: string) =>
      set({ preferred_colors: toggleIn(draft.preferred_colors, code, MAX_LIKED_COLORS), avoid_colors: draft.avoid_colors.filter((c) => c !== code) });
    const avoid = (code: string) =>
      set({ avoid_colors: toggleIn(draft.avoid_colors, code), preferred_colors: draft.preferred_colors.filter((c) => c !== code) });
    return (
      <section className="flex flex-col gap-6">
        <Heading step={step} title="좋아하는 색, 피하는 색이 있나요?" sub="좋아하는 색은 코디에 더 자주 넣고, 피하는 색은 빼요. 없으면 그냥 넘어가도 돼요." />
        <ColorGrid
          title={`좋아하는 색 (최대 ${MAX_LIKED_COLORS}개)`}
          picked={draft.preferred_colors}
          full={draft.preferred_colors.length >= MAX_LIKED_COLORS}
          onPick={like}
        />
        <ColorGrid title="피하는 색" avoid picked={draft.avoid_colors} onPick={avoid} />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <Heading step={step} title="입지 않는 옷이 있나요?" sub="고른 옷은 추천에서 빼요. 없으면 그냥 넘어가도 돼요." />
      {CATEGORIES.map((cat) => (
        <div key={cat.code} className="flex flex-col gap-2">
          <h2 className="text-[14px] font-semibold text-muted">{cat.label}</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
            {SUBCATEGORIES[cat.code].map((sub) => (
              <Tile
                key={sub.code}
                avoid
                on={draft.avoid_subcategories.includes(sub.code)}
                onClick={() => set({ avoid_subcategories: toggleIn(draft.avoid_subcategories, sub.code) })}
                label={sub.label}
              >
                <ClothingIcon subcategory={sub.code} color={TYPICAL_COLOR[sub.code] ?? "white"} size={cat.code === "shoes" ? 84 : 64} />
              </Tile>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ColorGrid({
  title,
  picked,
  onPick,
  avoid,
  full,
}: {
  title: string;
  picked: string[];
  onPick: (code: string) => void;
  avoid?: boolean;
  full?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-9">
        {COLORS.map((c) => {
          const on = picked.includes(c.code);
          return (
            <button
              key={c.code}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => onPick(c.code)}
              className={cx(
                "relative flex flex-col items-center gap-1.5 rounded-[14px] border-2 bg-surface px-1 py-2.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                on ? (avoid ? "border-danger bg-danger-soft font-semibold text-danger" : "border-accent bg-accent-soft font-semibold") : "border-line hover:border-line-strong",
              )}
            >
              <span aria-hidden className="relative grid h-10 w-10 place-items-center rounded-full border border-line-strong shadow-inner" style={{ background: c.hex }}>
                {on && (
                  <span className={cx("grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold text-white shadow", avoid ? "bg-danger" : "bg-accent")}>
                    {avoid ? "✕" : "✓"}
                  </span>
                )}
              </span>
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Optional: describe the look in words and let the AI fill every page (the user checks them after). */
function DescribeBox({ draft, onChange }: { draft: StyleDraft; onChange: (d: StyleDraft) => void }) {
  const [text, setText] = useState(draft.source_text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const run = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const r = await analyzeStyle(t);
      const ai = draftFrom(r);
      onChange({
        ...ai,
        source_text: t,
        // the fit was picked on the page before: an explicit pick wins over the AI's guess
        top: draft.top.length ? draft.top : ai.top,
        bottom: draft.top.length ? draft.bottom : ai.bottom,
        // keep what the user already said they avoid
        avoid_colors: [...new Set([...draft.avoid_colors, ...ai.avoid_colors])],
        avoid_subcategories: [...new Set([...draft.avoid_subcategories, ...ai.avoid_subcategories])],
      });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-4">
      <span className="text-[14px] font-semibold">말로 설명해도 돼요 (선택)</span>
      <span className="text-[13px] text-muted">적으면 AI가 핏·스타일·색을 채워 줘요. 다음 페이지에서 확인하고 고칠 수 있어요.</span>
      <div className="flex gap-2">
        <input
          aria-label="추구미 설명"
          className={inputCls}
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void run();
          }}
          placeholder="예: 힘 뺀 듯 단정하고, 톤 다운된 색을 좋아해요"
        />
        <Button variant="subtle" onClick={run} disabled={!text.trim()} loading={busy}>
          채우기
        </Button>
      </div>
      {busy && <p className="text-xs text-muted">AI가 정리하고 있어요 (10초 이내)</p>}
      {done && <p className="text-xs text-good">✓ 채웠어요. 위에서 고른 스타일과 다음 페이지의 색을 확인해 주세요.</p>}
      {error && <Banner tone="danger">{error}</Banner>}
    </div>
  );
}

// ── steps in a modal (내 프로필: 추가 · 고치기) ──

export function StyleStepper({
  initial,
  person,
  submitLabel,
  onSubmit,
}: {
  initial: StyleDraft;
  person: LookPerson;
  submitLabel: string;
  onSubmit: (d: StyleDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = STYLE_PAGES[page];
  const last = page === STYLE_PAGES.length - 1;

  const next = async () => {
    const err = pageError(key, draft);
    if (err) return setError(err);
    setError(null);
    if (!last) return setPage(page + 1);
    setBusy(true);
    try {
      await onSubmit(draft);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Field label="이름" hint="비워 두면 고른 스타일로 지어요 (예: 미니멀 · 캐주얼)">
        <input
          className={inputCls}
          value={draft.style_name}
          maxLength={30}
          onChange={(e) => setDraft({ ...draft, style_name: e.target.value })}
          placeholder="예: 출근룩, 주말 데이트"
        />
      </Field>
      <StylePage page={key} draft={draft} onChange={setDraft} person={person} step={`${page + 1} / ${STYLE_PAGES.length}`} />
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="sticky bottom-0 -mx-5 -mb-4 flex justify-between border-t border-line bg-surface px-5 py-3">
        <Button
          variant="ghost"
          disabled={page === 0 || busy}
          onClick={() => {
            setError(null);
            setPage(page - 1);
          }}
        >
          이전
        </Button>
        <Button onClick={next} loading={busy}>
          {last ? submitLabel : pageIsEmpty(key, draft) ? "없어요, 다음" : "다음"}
        </Button>
      </div>
    </div>
  );
}

// ── read-only summary (profile card) ──

export function StyleAttributeChips({ a }: { a: StyleAttributes }) {
  const row = (name: string, values: string[], tone?: "avoid") =>
    values.length > 0 && (
      <div className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-2 text-xs">
        <span className="pt-0.5 text-muted">{name}</span>
        <div className="flex flex-wrap gap-1">
          {values.map((v) => (
            <Chip key={v}>{tone === "avoid" ? `✕ ${v}` : v}</Chip>
          ))}
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-1.5">
      {row("핏", labels("fit", a.silhouette.top))}
      {row("스타일", labels("style", a.style_tags))}
      {row("색", labels("color", a.preferred_colors))}
      {row("무드", a.mood)}
      {row("피함", [...labels("subcategory", a.avoid.subcategories), ...labels("color", a.avoid.colors)], "avoid")}
    </div>
  );
}

// ── building blocks (also used by the onboarding body pages) ──

export function Heading({ title, sub, step }: { title: string; sub?: string; step?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {step && <span className="font-mono text-[13px] font-semibold text-accent">{step}</span>}
      <h1 className="text-[24px] font-bold">{title}</h1>
      {sub && <p className="text-[14px] text-muted">{sub}</p>}
    </div>
  );
}

/** A big picture card. `avoid` cards mark what the user does NOT want (red ✕ instead of ✓). */
export function Tile({
  on,
  onClick,
  label,
  desc,
  avoid,
  disabled,
  media,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  desc?: string;
  avoid?: boolean;
  disabled?: boolean;
  /** Full-bleed picture at the top of the card (photos); `children` is a centered icon instead. */
  media?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "relative flex flex-col items-center gap-1.5 overflow-hidden rounded-[16px] border-2 bg-surface text-center transition-colors",
        media ? "pb-4" : "p-3 pb-4",
        "focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45",
        on ? (avoid ? "border-danger bg-danger-soft" : "border-accent bg-accent-soft") : "border-line hover:border-line-strong",
      )}
    >
      {on && (
        <span
          aria-hidden
          className={cx(
            "absolute right-2 top-2 z-10 grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold shadow",
            avoid ? "bg-danger text-white" : "bg-accent text-accent-ink",
          )}
        >
          {avoid ? "✕" : "✓"}
        </span>
      )}
      {media && <div className="mb-1.5 w-full">{media}</div>}
      {children}
      <span className={cx("px-2 text-[15px] font-semibold", on && avoid && "text-danger")}>{label}</span>
      {desc && <span className="px-2 text-[12.5px] leading-snug text-muted">{desc}</span>}
    </button>
  );
}

/** `crop`: head to knees, so the top's fit (shoulders, width, length) reads larger. */
export function Look({ src, crop }: { src: string; crop?: boolean }) {
  return (
    <Image
      src={src}
      alt=""
      width={600}
      height={800}
      sizes="(min-width: 1024px) 240px, 45vw"
      className={cx("w-full bg-tile object-cover", crop ? "aspect-square object-[50%_6%]" : "aspect-[3/4]")}
    />
  );
}
