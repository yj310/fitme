"use client";

import { useState } from "react";
import { createStyleProfile, errorMessage } from "@/lib/api";
import { cx } from "@/lib/format";
import { ALL_SUBCATEGORIES, COLORS, FITS, STYLE_PRESETS, STYLE_TAGS, label, labels } from "@/lib/taxonomy";
import type { StyleAttributes, StyleProfile } from "@/lib/types";
import { ClothingIcon } from "../ClothingIcon";
import { Banner, Button, Chip, Field, inputCls, toggleIn } from "../ui";

/** Read-only attribute chips (profile card). */
export function StyleAttributeChips({ a }: { a: StyleAttributes }) {
  const row = (name: string, values: string[]) =>
    values.length > 0 && (
      <div className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-2 text-xs">
        <span className="pt-0.5 text-muted">{name}</span>
        <div className="flex flex-wrap gap-1">
          {values.map((v) => (
            <Chip key={v}>{v}</Chip>
          ))}
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-1.5">
      {row("스타일", labels("style", a.style_tags))}
      {row("색", labels("color", a.preferred_colors))}
      {row(
        "실루엣",
        [...labels("fit", a.silhouette.top).map((x) => `${x} 상의`), ...labels("fit", a.silhouette.bottom).map((x) => `${x} 하의`)],
      )}
      {row("무드", a.mood)}
      {row("피함", [...labels("subcategory", a.avoid.subcategories), ...labels("color", a.avoid.colors)])}
    </div>
  );
}

/** Preset cards (3 columns, 3 item drawings + name) + free text → POST /style-profiles (spec F04). */
export function StyleCreator({ onCreated }: { onCreated: (p: StyleProfile) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (body: { text: string } | { preset: string }, key: string) => {
    setBusy(key);
    setError(null);
    try {
      onCreated(await createStyleProfile(body));
      setText("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2.5">
        {STYLE_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            disabled={busy !== null}
            onClick={() => create({ preset: p.key }, p.key)}
            className={cx(
              "flex flex-col items-center gap-2 rounded-[12px] border border-line bg-surface p-3 hover:border-accent",
              busy === p.key && "border-accent bg-accent-soft",
            )}
          >
            <div className="grid w-full grid-cols-3 gap-1">
              {p.icons.map((ic) => (
                <div key={ic} className="grid aspect-square place-items-center rounded-[8px] bg-tile">
                  <ClothingIcon subcategory={ic} size={40} className="h-4/5 w-4/5" />
                </div>
              ))}
            </div>
            <span className="text-[13px] font-semibold">{p.style_name}</span>
            <span className="text-[11px] text-muted">{labels("style", p.attributes.style_tags).join(" · ")}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">직접 적기</span>
        <div className="flex gap-2">
          <input
            aria-label="추구미 직접 적기"
            className={inputCls}
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && text.trim()) void create({ text: text.trim() }, "text");
            }}
            placeholder="예: 힘 뺀 듯 단정하고, 톤 다운된 색을 좋아해요"
          />
          <Button onClick={() => create({ text: text.trim() }, "text")} disabled={!text.trim() || busy !== null} loading={busy === "text"}>
            분석하기
          </Button>
        </div>
        {busy === "text" && <p className="text-xs text-muted">AI가 추구미를 색·실루엣·무드로 정리하고 있어요 (10초 이내)</p>}
      </div>
      {error && <Banner tone="danger">{error}</Banner>}
    </div>
  );
}

/** Edit structured attributes before/after saving (spec F04: 결과를 보여주고 수정 후 저장). */
export function StyleAttributesEditor({
  name,
  value,
  onChange,
  onNameChange,
}: {
  name: string;
  value: StyleAttributes;
  onChange: (a: StyleAttributes) => void;
  onNameChange: (n: string) => void;
}) {
  const [moodText, setMoodText] = useState(value.mood.join(", "));
  const set = (patch: Partial<StyleAttributes>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-3">
      <Field label="이름">
        <input className={inputCls} value={name} maxLength={40} onChange={(e) => onNameChange(e.target.value)} />
      </Field>
      <ChipGroup title="스타일 (최대 3)">
        {STYLE_TAGS.map((s) => (
          <Chip key={s.code} on={value.style_tags.includes(s.code)} onClick={() => set({ style_tags: toggleIn(value.style_tags, s.code, 3) })}>
            {s.label}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup title="선호 색">
        {COLORS.map((c) => (
          <Chip key={c.code} on={value.preferred_colors.includes(c.code)} onClick={() => set({ preferred_colors: toggleIn(value.preferred_colors, c.code) })}>
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border border-line-strong" style={{ background: c.hex }} />
            {c.label}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup title="실루엣 · 상의">
        {FITS.top.map((f) => (
          <Chip
            key={f.code}
            on={value.silhouette.top.includes(f.code)}
            onClick={() => set({ silhouette: { ...value.silhouette, top: toggleIn(value.silhouette.top, f.code) } })}
          >
            {f.label}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup title="실루엣 · 하의">
        {FITS.bottom.map((f) => (
          <Chip
            key={f.code}
            on={value.silhouette.bottom.includes(f.code)}
            onClick={() => set({ silhouette: { ...value.silhouette, bottom: toggleIn(value.silhouette.bottom, f.code) } })}
          >
            {f.label}
          </Chip>
        ))}
      </ChipGroup>
      <Field label="무드 (쉼표로 구분, 최대 3개)">
        <input
          className={inputCls}
          value={moodText}
          onChange={(e) => {
            setMoodText(e.target.value);
            set({
              mood: e.target.value
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean)
                .slice(0, 3),
            });
          }}
          placeholder="예: 힘 뺀, 단정한"
        />
      </Field>
      <ChipGroup title="피하는 아이템">
        {ALL_SUBCATEGORIES.map((s) => (
          <Chip
            key={s.code}
            on={value.avoid.subcategories.includes(s.code)}
            onClick={() => set({ avoid: { ...value.avoid, subcategories: toggleIn(value.avoid.subcategories, s.code) } })}
          >
            {label("subcategory", s.code)}
          </Chip>
        ))}
      </ChipGroup>
      <ChipGroup title="피하는 색">
        {COLORS.map((c) => (
          <Chip
            key={c.code}
            on={value.avoid.colors.includes(c.code)}
            onClick={() => set({ avoid: { ...value.avoid, colors: toggleIn(value.avoid.colors, c.code) } })}
          >
            {c.label}
          </Chip>
        ))}
      </ChipGroup>
    </div>
  );
}

function ChipGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-muted">{title}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}
