"use client";

import { cx } from "@/lib/format";
import { BODY_TRAITS, TOP_SIZES } from "@/lib/taxonomy";
import type { BodyMeasurements, User } from "@/lib/types";
import { Badge, Chip, inputCls, toggleIn } from "../ui";

export interface BodyDraft {
  height_cm: string;
  top: "" | "S" | "M" | "L" | "XL";
  bottom_waist: string;
  body_traits: string[];
  shoulder: string;
  chest: string;
  waist: string;
  hip: string;
}

export function bodyDraftFrom(me: User | null): BodyDraft {
  const m = me?.body_measurements ?? {};
  const s = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  return {
    height_cm: s(me?.height_cm),
    top: me?.usual_sizes?.top ?? "",
    bottom_waist: s(me?.usual_sizes?.bottom_waist),
    body_traits: me?.body_traits ?? [],
    shoulder: s(m.shoulder),
    chest: s(m.chest),
    waist: s(m.waist),
    hip: s(m.hip),
  };
}

const num = (v: string): number | null => {
  const n = Number(v);
  return v.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** PATCH /me body fields. Weight is never collected (spec F01). */
export function bodyPatch(d: BodyDraft) {
  const measurements: BodyMeasurements = {
    shoulder: num(d.shoulder),
    chest: num(d.chest),
    waist: num(d.waist),
    hip: num(d.hip),
  };
  const any = Object.values(measurements).some((v) => v !== null);
  const sizes: { top?: "S" | "M" | "L" | "XL"; bottom_waist?: number } = {};
  if (d.top) sizes.top = d.top;
  const waist = num(d.bottom_waist);
  if (waist) sizes.bottom_waist = waist;
  return {
    height_cm: num(d.height_cm),
    usual_sizes: sizes,
    body_traits: d.body_traits,
    body_measurements: any ? measurements : null,
  };
}

function NumField({
  label,
  value,
  onChange,
  unit = "cm",
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  min: number;
  max: number;
}) {
  return (
    <label className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          className={cx(inputCls, "w-24")}
          value={value}
          placeholder="모름"
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="text-xs text-muted">{unit}</span>
      </span>
    </label>
  );
}

export function BodyForm({ value, onChange }: { value: BodyDraft; onChange: (d: BodyDraft) => void }) {
  const set = (patch: Partial<BodyDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13.5px] font-semibold">기본</h3>
          <span className="text-xs text-muted">30초</span>
        </div>
        <NumField label="키" value={value.height_cm} onChange={(v) => set({ height_cm: v })} min={100} max={230} />
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2 text-[13px]">
          <span className="text-muted">평소 상의</span>
          <div className="flex gap-1" role="group" aria-label="평소 상의 사이즈">
            {TOP_SIZES.map((s) => (
              <Chip key={s} on={value.top === s} onClick={() => set({ top: value.top === s ? "" : s })}>
                {s}
              </Chip>
            ))}
          </div>
        </div>
        <NumField label="평소 하의 허리" value={value.bottom_waist} onChange={(v) => set({ bottom_waist: v })} unit="인치" min={20} max={50} />
        <div className="flex flex-col gap-1.5 text-[13px]">
          <span className="text-muted">체형 특징 (여러 개 선택)</span>
          <div className="flex flex-wrap gap-1">
            {BODY_TRAITS.map((t) => (
              <Chip key={t.code} on={value.body_traits.includes(t.code)} onClick={() => set({ body_traits: toggleIn(value.body_traits, t.code) })}>
                {t.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 rounded-[12px] border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13.5px] font-semibold">
            상세 치수 <Badge tone="muted">선택</Badge>
          </h3>
          <span className="text-xs text-muted">2분</span>
        </div>
        <NumField label="어깨너비" value={value.shoulder} onChange={(v) => set({ shoulder: v })} min={25} max={70} />
        <NumField label="가슴둘레" value={value.chest} onChange={(v) => set({ chest: v })} min={50} max={160} />
        <NumField label="허리둘레" value={value.waist} onChange={(v) => set({ waist: v })} min={40} max={160} />
        <NumField label="엉덩이둘레" value={value.hip} onChange={(v) => set({ hip: v })} min={50} max={170} />
        <p className="rounded-[8px] bg-tile px-2.5 py-1.5 text-xs text-muted">
          줄자가 없다면: 잘 맞는 옷 하나를 바닥에 펴고 재면 더 정확해요
        </p>
      </div>
    </div>
  );
}

/** Where to measure: shoulder / chest / waist / hip (spec F01 step 3). */
export function BodyFigure() {
  const tape = "var(--warn)";
  return (
    <figure className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 200 320" className="h-auto w-full max-w-[220px]" role="img" aria-label="줄자 재는 위치: 어깨, 가슴, 허리, 엉덩이">
        <g fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2">
          <circle cx="100" cy="36" r="22" />
          <path d="M62 70 Q100 60 138 70 L150 150 L138 152 L132 104 L134 186 Q100 196 66 186 L68 104 L62 152 L50 150 Z" />
          <path d="M70 186 L66 300 L92 300 L100 210 L108 300 L134 300 L130 186 Z" />
        </g>
        <g stroke={tape} strokeWidth="3" strokeDasharray="6 4" fill="none">
          <line x1="64" y1="74" x2="136" y2="74" />
          <ellipse cx="100" cy="104" rx="34" ry="6" />
          <ellipse cx="100" cy="146" rx="32" ry="5" />
          <ellipse cx="100" cy="182" rx="35" ry="6" />
        </g>
        <g fontSize="11" fill="var(--ink)">
          <text x="142" y="70">어깨</text>
          <text x="140" y="108">가슴</text>
          <text x="138" y="150">허리</text>
          <text x="140" y="186">엉덩이</text>
        </g>
      </svg>
      <figcaption className="text-center text-xs text-muted">
        어깨: 양 끝 뼈 사이 · 가슴: 가장 두꺼운 곳
        <br />
        허리: 가장 가는 곳 · 엉덩이: 가장 넓은 곳
      </figcaption>
    </figure>
  );
}
