"use client";

import { useId } from "react";
import { Garment, viewBoxFor } from "@/components/ClothingIcon";
import { colorHex } from "@/lib/taxonomy";

/* ───────────────────────── fit: same person, four garment widths ───────────────────────── */

interface FitShape {
  sw: number; // shoulder half-width
  sy: number; // shoulder line (lower = dropped shoulder)
  hw: number; // hem half-width
  hemY: number;
  out: number; // how far the sleeve flares out
  sleeve: number; // sleeve width at the cuff
  wristY: number;
}

const FIT: Record<string, FitShape> = {
  slim: { sw: 17, sy: 41, hw: 16, hemY: 90, out: 5, sleeve: 8, wristY: 92 },
  regular: { sw: 20, sy: 41, hw: 20, hemY: 94, out: 7, sleeve: 11, wristY: 94 },
  semi_over: { sw: 25, sy: 45, hw: 25, hemY: 99, out: 8, sleeve: 14, wristY: 97 },
  over: { sw: 31, sy: 50, hw: 31, hemY: 107, out: 7, sleeve: 18, wristY: 103 },
};

export function FitArt({ fit, className }: { fit: string; className?: string }) {
  const f = FIT[fit] ?? FIT.regular;
  const c = 60;
  const body = "var(--line-strong)";
  const top = "var(--accent-soft)";
  const line = "var(--accent)";
  const torso = `M${c - 16} 40 L${c + 16} 40 L${c + 15} 90 L${c - 15} 90 Z`;
  const shirt = `M${c - f.sw} ${f.sy} L${c - 7} 38 Q${c} 45 ${c + 7} 38 L${c + f.sw} ${f.sy} L${c + f.hw} ${f.hemY} L${c - f.hw} ${f.hemY} Z`;
  const sleeve = (dir: 1 | -1) => {
    const sx = c + dir * f.sw;
    const wx = sx + dir * f.out;
    return `M${sx} ${f.sy} L${wx} ${f.wristY} L${wx - dir * f.sleeve} ${f.wristY + 1} L${sx - dir * 8} ${f.sy + 22} Z`;
  };
  return (
    <svg viewBox="0 0 120 140" className={className} aria-hidden>
      {/* legs + head */}
      <path d={`M${c - 15} 86 L${c - 2} 86 L${c - 3} 134 L${c - 13} 134 Z M${c + 2} 86 L${c + 15} 86 L${c + 13} 134 L${c + 3} 134 Z`} fill="var(--muted)" opacity="0.45" />
      <circle cx={c} cy={25} r={11} fill={body} />
      <rect x={c - 4} y={33} width={8} height={7} fill={body} />
      {/* garment */}
      <g strokeLinejoin="round">
        <path d={sleeve(-1)} fill={top} stroke={line} strokeWidth="2" />
        <path d={sleeve(1)} fill={top} stroke={line} strokeWidth="2" />
        <path d={shirt} fill={top} stroke={line} strokeWidth="2" />
      </g>
      {/* hands */}
      <circle cx={c - f.sw - f.out + f.sleeve / 2} cy={f.wristY + 5} r={3.5} fill={body} />
      <circle cx={c + f.sw + f.out - f.sleeve / 2} cy={f.wristY + 5} r={3.5} fill={body} />
      {/* the body's own outline: the gap between it and the garment is the fit */}
      <path d={torso} fill="none" stroke="var(--muted)" strokeWidth="1.4" strokeDasharray="3 3" />
    </svg>
  );
}

/* ───────────────────────── style: a flat lay of a typical outfit ───────────────────────── */

type Piece = { sub: string; color: string; pattern?: "stripe" | "check" };
interface StyleLook {
  top: Piece;
  bottom: Piece;
  shoes: Piece;
  hat?: "cap" | "beret" | "bucket";
  hatColor?: string;
  bag?: string; // color
}

const LOOKS: Record<string, StyleLook> = {
  minimal: { top: { sub: "tshirt_short", color: "white" }, bottom: { sub: "slacks", color: "black" }, shoes: { sub: "loafers", color: "black" } },
  casual: { top: { sub: "sweatshirt", color: "gray" }, bottom: { sub: "denim", color: "denim_blue" }, shoes: { sub: "sneakers", color: "white" } },
  street: { top: { sub: "hoodie", color: "black" }, bottom: { sub: "jogger", color: "khaki" }, shoes: { sub: "sneakers", color: "white" }, hat: "cap", hatColor: "red" },
  office: { top: { sub: "blazer", color: "navy" }, bottom: { sub: "slacks", color: "gray" }, shoes: { sub: "loafers", color: "black" }, bag: "brown" },
  feminine: { top: { sub: "blouse", color: "pink" }, bottom: { sub: "midi_skirt", color: "ivory" }, shoes: { sub: "flats", color: "beige" }, bag: "pink" },
  classic: { top: { sub: "trench_coat", color: "beige" }, bottom: { sub: "slacks", color: "navy" }, shoes: { sub: "loafers", color: "brown" } },
  sporty: { top: { sub: "jumper", color: "green" }, bottom: { sub: "jogger", color: "black" }, shoes: { sub: "sneakers", color: "white" }, hat: "cap", hatColor: "white" },
  vintage: { top: { sub: "cardigan", color: "brown" }, bottom: { sub: "long_skirt", color: "khaki" }, shoes: { sub: "boots", color: "brown" } },
  french_chic: { top: { sub: "tshirt_long", color: "white", pattern: "stripe" }, bottom: { sub: "denim", color: "denim_blue" }, shoes: { sub: "flats", color: "black" }, hat: "beret", hatColor: "black" },
  amekaji: { top: { sub: "shirt", color: "red", pattern: "check" }, bottom: { sub: "denim", color: "navy" }, shoes: { sub: "boots", color: "brown" }, hat: "bucket", hatColor: "khaki" },
};

export const STYLE_WORDS: Record<string, string> = {
  minimal: "무채색 · 군더더기 없이",
  casual: "맨투맨 · 청바지 · 편하게",
  street: "후드 · 오버핏 · 캡",
  office: "블레이저 · 슬랙스 · 단정",
  feminine: "블라우스 · 스커트 · 부드럽게",
  classic: "트렌치 · 로퍼 · 정갈하게",
  sporty: "점퍼 · 조거 · 활동적",
  vintage: "가디건 · 롱스커트 · 따뜻한 톤",
  french_chic: "스트라이프 · 베레모 · 무심한 듯",
  amekaji: "체크 셔츠 · 데님 · 워커",
};

function Hat({ kind, color }: { kind: "cap" | "beret" | "bucket"; color: string }) {
  const fill = colorHex(color);
  const s = { fill, stroke: "var(--accent)", strokeWidth: 2.5, strokeLinejoin: "round" as const };
  if (kind === "beret") return <path d="M18 60 Q20 30 52 30 Q86 32 84 58 Q60 66 18 60 Z M50 30 L52 22" {...s} />;
  if (kind === "bucket") return <path d="M30 58 L34 30 Q50 24 66 30 L70 58 Z M14 60 Q50 72 86 60 L84 66 Q50 76 16 66 Z" {...s} />;
  return <path d="M22 62 Q22 30 50 30 Q76 30 76 62 Z M76 56 L96 64 L92 70 L74 64 Z" {...s} />;
}

export function StyleArt({ style, className }: { style: string; className?: string }) {
  const look = LOOKS[style] ?? LOOKS.minimal;
  const id = useId().replace(/:/g, "");
  const fillOf = (p: Piece) => (p.pattern ? `url(#${id}-${p.pattern})` : colorHex(p.color));
  return (
    <svg viewBox="0 0 200 150" className={className} aria-hidden>
      <defs>
        <pattern id={`${id}-stripe`} width="100" height="9" patternUnits="userSpaceOnUse">
          <rect width="100" height="9" fill={colorHex("white")} />
          <rect width="100" height="4" y="5" fill={colorHex("navy")} />
        </pattern>
        <pattern id={`${id}-check`} width="14" height="14" patternUnits="userSpaceOnUse">
          <rect width="14" height="14" fill={colorHex(look.top.color)} />
          <rect width="14" height="5" y="0" fill="rgba(0,0,0,0.28)" />
          <rect width="5" height="14" x="0" fill="rgba(0,0,0,0.28)" />
        </pattern>
      </defs>
      {/* bottom (behind), top, shoes, extras */}
      <svg x="94" y="18" width="100" height="100" viewBox="0 0 100 100">
        <Garment subcategory={look.bottom.sub} fill={fillOf(look.bottom)} />
      </svg>
      <svg x="4" y="8" width="104" height="104" viewBox="0 0 100 100">
        <Garment subcategory={look.top.sub} fill={fillOf(look.top)} detail={!look.top.pattern} />
      </svg>
      <svg x="24" y="102" width="72" height="48" viewBox={viewBoxFor(look.shoes.sub)}>
        <Garment subcategory={look.shoes.sub} fill={colorHex(look.shoes.color)} />
      </svg>
      {look.hat && (
        <svg x="150" y="0" width="46" height="46" viewBox="0 0 100 100">
          <Hat kind={look.hat} color={look.hatColor ?? "black"} />
        </svg>
      )}
      {look.bag && (
        <svg x="158" y="108" width="38" height="38" viewBox="0 0 100 100">
          <path d="M36 40 Q36 16 50 16 Q64 16 64 40" fill="none" stroke="var(--accent)" strokeWidth="4" />
          <path d="M20 40 L80 40 L86 90 L14 90 Z" fill={colorHex(look.bag)} stroke="var(--accent)" strokeWidth="4" strokeLinejoin="round" />
        </svg>
      )}
    </svg>
  );
}
