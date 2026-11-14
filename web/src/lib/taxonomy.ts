import taxonomy from "./taxonomy.json";
import presetsJson from "./style_presets.json";
import type { Category, StylePreset } from "./types";

export interface Opt<T = string> {
  code: T;
  label: string;
}

export const T = taxonomy;
export const STYLE_PRESETS = presetsJson.presets as StylePreset[];

export const CATEGORIES = taxonomy.categories as Opt<Category>[];
export const SUBCATEGORIES = taxonomy.subcategories as Record<Category, Opt[]>;
export const COLORS = taxonomy.colors as (Opt & { hex: string; neutral: boolean; family: string })[];
export const PATTERNS = taxonomy.patterns as Opt[];
export const SEASONS = taxonomy.seasons as Opt[];
export const FITS = taxonomy.fits as Record<Category, Opt[]>;
export const STYLE_TAGS = taxonomy.style_tags as Opt[];
export const FORMALITY = taxonomy.formality as Opt<number>[];
export const WARMTH = taxonomy.warmth as Opt<number>[];
export const MATERIALS = taxonomy.materials as Opt[];
export const BODY_TRAITS = taxonomy.body_traits as Opt[];
export const PERSONAL_COLORS = taxonomy.personal_colors as Opt[];
export const TOP_SIZES = taxonomy.top_sizes as ("S" | "M" | "L" | "XL")[];
export const OCCASIONS = taxonomy.occasions as string[];
export const TODAY_MOODS = taxonomy.today_moods as Opt<"neat" | "comfy" | "dressy" | "warm">[];
export const TEMP_BANDS = taxonomy.temp_bands as (Opt & { temp: number })[];
export const ALL_SUBCATEGORIES: (Opt & { category: Category })[] = CATEGORIES.flatMap((c) =>
  SUBCATEGORIES[c.code].map((s) => ({ ...s, category: c.code })),
);
/** Top/outer fits used for the onboarding "선호 핏" choice. */
export const TOP_FITS = FITS.top;

const index = (opts: Opt<string | number>[]) => new Map(opts.map((o) => [String(o.code), o.label]));
const maps = {
  category: index(CATEGORIES),
  subcategory: index(ALL_SUBCATEGORIES),
  color: index(COLORS),
  pattern: index(PATTERNS),
  season: index(SEASONS),
  fit: index([...FITS.top, ...FITS.bottom, ...FITS.dress]),
  style: index(STYLE_TAGS),
  formality: index(FORMALITY),
  warmth: index(WARMTH),
  material: index(MATERIALS),
  trait: index(BODY_TRAITS),
  personalColor: index(PERSONAL_COLORS),
  mood: index(TODAY_MOODS),
  tempBand: index(TEMP_BANDS),
};

export type LabelKind = keyof typeof maps;

export function label(kind: LabelKind, code: string | number | null | undefined): string {
  if (code === null || code === undefined || code === "") return "";
  return maps[kind].get(String(code)) ?? String(code);
}

export function labels(kind: LabelKind, codes: (string | number)[] | null | undefined): string[] {
  return (codes ?? []).map((c) => label(kind, c));
}

export function colorHex(code: string): string {
  return COLORS.find((c) => c.code === code)?.hex ?? "#cccccc";
}

export function fitsFor(category: Category): Opt[] {
  return FITS[category] ?? [];
}

export function categoryOf(subcategory: string): Category | undefined {
  return ALL_SUBCATEGORIES.find((s) => s.code === subcategory)?.category;
}

/** "색 + 세부 카테고리", e.g. "차콜 가디건" (spec F03). */
export function autoName(color: string, subcategory: string): string {
  return `${label("color", color)} ${label("subcategory", subcategory)}`.trim();
}
