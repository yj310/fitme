import { categoryOf, colorHex } from "@/lib/taxonomy";

// Simple line drawings used for preset cards and as photo placeholders.
const SHAPES: Record<string, string> = {
  tee: "M30 18 L42 12 Q50 18 58 12 L70 18 L82 32 L72 40 L68 36 L68 86 L32 86 L32 36 L28 40 L18 32 Z",
  longsleeve: "M30 18 L42 12 Q50 18 58 12 L70 18 L84 70 L74 73 L68 40 L68 86 L32 86 L32 40 L26 73 L16 70 Z",
  shirt: "M30 18 L42 12 L50 22 L58 12 L70 18 L84 70 L74 73 L68 40 L68 86 L32 86 L32 40 L26 73 L16 70 Z M50 22 L50 86",
  hoodie: "M36 18 Q50 4 64 18 L72 20 L84 70 L74 73 L68 42 L68 86 L32 86 L32 42 L26 73 L16 70 L28 20 Z M40 20 Q50 30 60 20",
  coat: "M32 14 L44 10 L50 20 L56 10 L68 14 L84 76 L74 78 L70 46 L70 92 L30 92 L30 46 L26 78 L16 76 Z M50 20 L50 92",
  cardigan: "M32 16 L44 12 L50 30 L56 12 L68 16 L84 72 L74 74 L69 44 L69 88 L31 88 L31 44 L26 74 L16 72 Z M50 30 L50 88",
  vest: "M34 14 L44 12 L50 28 L56 12 L66 14 L70 30 L70 86 L30 86 L30 30 Z",
  sleeveless: "M36 14 L44 14 Q50 24 56 14 L64 14 L68 30 L68 86 L32 86 L32 30 Z",
  pants: "M32 12 L68 12 L72 88 L56 88 L50 40 L44 88 L28 88 Z",
  shorts: "M30 24 L70 24 L74 64 L54 64 L50 46 L46 64 L26 64 Z",
  skirt: "M36 16 L64 16 L76 84 L24 84 Z",
  dress: "M40 10 L46 10 Q50 18 54 10 L60 10 L62 30 L76 88 L24 88 L38 30 Z",
  jumpsuit: "M38 10 L62 10 L66 46 L70 90 L54 90 L50 58 L46 90 L30 90 L34 46 Z",
  sneakers: "M14 60 L38 50 L52 58 L80 62 Q88 64 86 74 L14 74 Z",
  boots: "M34 20 L54 20 L54 58 L80 64 Q86 66 84 76 L34 76 Z",
  loafers: "M14 64 Q26 54 46 58 L78 62 Q88 64 86 74 L14 74 Z",
  sandals: "M16 70 L84 70 L84 76 L16 76 Z M30 70 L44 54 L58 70 M52 70 L66 56 L76 70",
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
  jacket: "coat",
  blazer: "coat",
  trench_coat: "coat",
  coat: "coat",
  jumper: "hoodie",
  padding: "coat",
  vest: "vest",
  slacks: "pants",
  denim: "pants",
  cotton_pants: "pants",
  jogger: "pants",
  shorts: "shorts",
  mini_skirt: "skirt",
  midi_skirt: "skirt",
  long_skirt: "skirt",
  mini_dress: "dress",
  midi_dress: "dress",
  long_dress: "dress",
  jumpsuit: "jumpsuit",
  sneakers: "sneakers",
  loafers: "loafers",
  flats: "loafers",
  boots: "boots",
  sandals: "sandals",
  slippers: "sandals",
};

const CATEGORY_FALLBACK: Record<string, string> = {
  outer: "coat",
  top: "tee",
  bottom: "pants",
  dress: "dress",
  shoes: "sneakers",
};

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
  const shape = SUB_TO_SHAPE[subcategory] ?? CATEGORY_FALLBACK[categoryOf(subcategory) ?? "top"] ?? "tee";
  const fill = color ? colorHex(color) : "var(--accent-soft)";
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden>
      <path d={SHAPES[shape]} fill={fill} stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}
