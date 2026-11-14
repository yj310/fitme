import { categoryOf, colorHex } from "@/lib/taxonomy";

// Simple line drawings used for the "입지 않는 옷" tiles and as photo placeholders.
// Every shape sits in a 100×100 box. DETAILS add the few strokes that tell look-alike kinds apart
// (a coat's length, a puffer's quilting, a denim's pockets).
export const SHAPES: Record<string, string> = {
  tee: "M30 18 L42 12 Q50 18 58 12 L70 18 L82 32 L72 40 L68 36 L68 86 L32 86 L32 36 L28 40 L18 32 Z",
  longsleeve: "M30 18 L42 12 Q50 18 58 12 L70 18 L84 70 L74 73 L68 40 L68 86 L32 86 L32 40 L26 73 L16 70 Z",
  shirt: "M30 18 L42 12 L50 22 L58 12 L70 18 L84 70 L74 73 L68 40 L68 86 L32 86 L32 40 L26 73 L16 70 Z",
  hoodie: "M36 18 Q50 4 64 18 L72 20 L84 70 L74 73 L68 42 L68 86 L32 86 L32 42 L26 73 L16 70 L28 20 Z",
  coat: "M32 14 L44 10 L50 20 L56 10 L68 14 L84 76 L74 78 L70 46 L70 94 L30 94 L30 46 L26 78 L16 76 Z",
  jacket: "M32 16 L44 12 L50 22 L56 12 L68 16 L84 70 L74 72 L70 44 L70 76 L30 76 L30 44 L26 72 L16 70 Z",
  bomber: "M30 18 L42 12 Q50 18 58 12 L70 18 Q84 40 84 70 L74 72 L70 46 L70 80 L30 80 L30 46 L26 72 L16 70 Q16 40 30 18 Z",
  puffer: "M30 16 L44 10 Q50 14 56 10 L70 16 Q86 40 86 74 L74 76 L72 46 L72 88 L28 88 L28 46 L26 76 L14 74 Q14 40 30 16 Z",
  cardigan: "M32 16 L44 12 L50 30 L56 12 L68 16 L84 72 L74 74 L69 44 L69 88 L31 88 L31 44 L26 74 L16 72 Z",
  vest: "M34 14 L44 12 L50 28 L56 12 L66 14 L70 30 L70 86 L30 86 L30 30 Z",
  sleeveless: "M36 14 L44 14 Q50 24 56 14 L64 14 L68 30 L68 86 L32 86 L32 30 Z",
  pants: "M32 12 L68 12 L72 88 L56 88 L50 40 L44 88 L28 88 Z",
  jogger: "M32 12 L68 12 L68 80 L64 88 L54 88 L50 40 L46 88 L36 88 L32 80 Z",
  shorts: "M30 24 L70 24 L74 64 L54 64 L50 46 L46 64 L26 64 Z",
  skirt_mini: "M36 20 L64 20 L72 54 L28 54 Z",
  skirt: "M36 16 L64 16 L76 76 L24 76 Z",
  skirt_long: "M38 10 L62 10 L76 92 L24 92 Z",
  dress_mini: "M40 10 L46 10 Q50 18 54 10 L60 10 L62 30 L72 66 L28 66 L38 30 Z",
  dress: "M40 10 L46 10 Q50 18 54 10 L60 10 L62 30 L76 84 L24 84 L38 30 Z",
  dress_long: "M40 6 L46 6 Q50 14 54 6 L60 6 L62 26 L78 96 L22 96 L38 26 Z",
  jumpsuit: "M38 10 L62 10 L66 46 L70 90 L54 90 L50 58 L46 90 L30 90 L34 46 Z",
  sneakers: "M14 60 L38 50 L52 58 L80 62 Q88 64 86 74 L14 74 Z",
  boots: "M34 20 L54 20 L54 58 L80 64 Q86 66 84 76 L34 76 Z",
  loafers: "M14 64 Q26 54 46 58 L78 62 Q88 64 86 74 L14 74 Z",
  flats: "M12 68 Q30 62 52 64 L80 66 Q90 68 88 74 L12 74 Z",
  sandals: "M16 70 L84 70 L84 76 L16 76 Z M30 70 L44 54 L58 70 M52 70 L66 56 L76 70",
  slides: "M16 70 L84 70 L84 76 L16 76 Z M28 70 Q50 48 72 70",
};

const DETAILS: Record<string, string> = {
  shirt: "M50 22 L50 86 M47 34 h0.1 M47 48 h0.1 M47 62 h0.1",
  blouse: "M50 22 L50 86 M44 22 Q50 30 56 22 M46 26 L50 30 L54 26",
  knit: "M44 30 Q50 38 44 46 Q50 54 44 62 Q50 70 44 78 M56 30 Q50 38 56 46 Q50 54 56 62 Q50 70 56 78 M32 80 L68 80",
  sweatshirt: "M42 16 Q50 24 58 16 M32 80 L68 80 M27 68 L17 66",
  hoodie: "M40 20 Q50 30 60 20 M46 26 L46 38 M54 26 L54 38 M38 62 L62 62",
  cardigan: "M50 30 L50 88 M47 42 h0.1 M47 56 h0.1 M47 70 h0.1",
  jacket: "M50 22 L50 76 M44 12 L46 26 L50 32 M56 12 L54 26 L50 32",
  blazer: "M44 10 L46 34 L50 44 M56 10 L54 34 L50 44 M50 44 L50 94 M58 66 L66 66",
  trench_coat: "M44 10 L44 30 L50 36 M56 10 L56 30 L50 36 M30 56 L70 56 M44 44 h0.1 M56 44 h0.1 M44 66 h0.1 M56 66 h0.1",
  coat: "M50 20 L50 94 M44 10 L46 24 L50 30 M56 10 L54 24 L50 30",
  jumper: "M50 18 L50 80 M30 74 L70 74",
  padding: "M50 12 L50 88 M28 32 L72 32 M28 46 L72 46 M28 60 L72 60 M28 74 L72 74",
  vest: "M50 28 L50 86",
  slacks: "M38 18 L36 86 M62 18 L64 86 M32 18 L68 18",
  denim: "M32 18 L68 18 M36 18 Q38 28 44 26 M64 18 Q62 28 56 26 M50 12 L50 34",
  cotton_pants: "M32 18 L68 18 M50 12 L50 30",
  jogger: "M32 18 L68 18 M36 82 L46 82 M54 82 L64 82",
  shorts: "M30 30 L70 30",
  sneakers: "M36 54 L42 62 M42 52 L48 60 M14 68 L86 68",
  loafers: "M40 60 L56 62",
  flats: "M44 64 Q50 60 56 64 M50 62 L50 66",
  boots: "M34 66 L84 70",
};

const SUB_TO_SHAPE: Record<string, string> = {
  tshirt_short: "tee",
  tshirt_long: "longsleeve",
  knit: "longsleeve",
  sweatshirt: "longsleeve",
  shirt: "shirt",
  blouse: "shirt",
  hoodie: "hoodie",
  sleeveless: "sleeveless",
  cardigan: "cardigan",
  jacket: "jacket",
  blazer: "coat",
  trench_coat: "coat",
  coat: "coat",
  jumper: "bomber",
  padding: "puffer",
  vest: "vest",
  slacks: "pants",
  denim: "pants",
  cotton_pants: "pants",
  jogger: "jogger",
  shorts: "shorts",
  mini_skirt: "skirt_mini",
  midi_skirt: "skirt",
  long_skirt: "skirt_long",
  mini_dress: "dress_mini",
  midi_dress: "dress",
  long_dress: "dress_long",
  jumpsuit: "jumpsuit",
  sneakers: "sneakers",
  loafers: "loafers",
  flats: "flats",
  boots: "boots",
  sandals: "sandals",
  slippers: "slides",
};

const CATEGORY_FALLBACK: Record<string, string> = {
  outer: "coat",
  top: "tee",
  bottom: "pants",
  dress: "dress",
  shoes: "sneakers",
};

/** Color that makes each kind easy to recognise when the user hasn't picked one (onboarding tiles). */
export const TYPICAL_COLOR: Record<string, string> = {
  denim: "denim_blue",
  shorts: "denim_blue",
  padding: "black",
  trench_coat: "beige",
  coat: "charcoal",
  blazer: "navy",
  jumper: "khaki",
  cardigan: "beige",
  knit: "ivory",
  hoodie: "gray",
  sweatshirt: "gray",
  blouse: "pink",
  slacks: "charcoal",
  cotton_pants: "beige",
  jogger: "gray",
  boots: "brown",
  loafers: "black",
  sneakers: "white",
  flats: "black",
  sandals: "beige",
  slippers: "gray",
  jacket: "denim_blue",
  vest: "beige",
  mini_skirt: "black",
  midi_skirt: "beige",
  long_skirt: "khaki",
  mini_dress: "black",
  midi_dress: "navy",
  long_dress: "ivory",
  jumpsuit: "khaki",
};

/** Shoes are wide and flat: crop their box so they show as big as the clothes. */
export function viewBoxFor(subcategory: string): string {
  return categoryOf(subcategory) === "shoes" ? "4 14 92 70" : "0 0 100 100";
}

export function isDark(fill: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(fill);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
}

function shapeOf(subcategory: string): string {
  return SUB_TO_SHAPE[subcategory] ?? CATEGORY_FALLBACK[categoryOf(subcategory) ?? "top"] ?? "tee";
}

/** One garment as an SVG group in a 100×100 box, for composing larger illustrations. */
export function Garment({
  subcategory,
  fill,
  stroke = "var(--accent)",
  detail = true,
}: {
  subcategory: string;
  fill: string;
  stroke?: string;
  detail?: boolean;
}) {
  const extra = detail ? DETAILS[subcategory] : undefined;
  // On dark garments the outline color disappears: draw the detail lines light instead.
  const lineColor = isDark(fill) ? "rgba(255,255,255,0.75)" : stroke;
  return (
    <g strokeLinejoin="round" strokeLinecap="round">
      <path d={SHAPES[shapeOf(subcategory)]} fill={fill} stroke={stroke} strokeWidth="2.5" />
      {extra && <path d={extra} fill="none" stroke={lineColor} strokeWidth="2" opacity="0.8" />}
    </g>
  );
}

export function ClothingIcon({
  subcategory,
  color,
  size = 48,
  className,
}: {
  subcategory: string;
  color?: string;
  size?: number;
  className?: string;
}) {
  const fill = color ? colorHex(color) : "var(--accent-soft)";
  return (
    <svg viewBox={viewBoxFor(subcategory)} width={size} height={size} className={className} aria-hidden>
      <Garment subcategory={subcategory} fill={fill} />
    </svg>
  );
}
