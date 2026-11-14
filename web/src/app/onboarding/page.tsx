"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/AppShell";
import { TagReviewPanel } from "@/components/closet/TagReviewPanel";
import { MAX_FILES, useUploadQueue } from "@/components/closet/useUploadQueue";
import { DevBand } from "@/components/DevBand";
import { ItemThumb } from "@/components/ItemThumb";
import { onboardingDone, useAuth } from "@/components/providers/AuthProvider";
import { BodyFigure, BodyForm, GENDERS, bodyDraftFrom, bodyPatch, type BodyDraft } from "@/components/profile/BodyForm";
import { StyleAttributesEditor, StyleCreator } from "@/components/profile/StyleEditor";
import { ClothingIcon, TYPICAL_COLOR } from "@/components/ClothingIcon";
import { Banner, Button, LoadingState, toggleIn } from "@/components/ui";
import { errorMessage, listStyleProfiles, patchMe, patchStyleProfile } from "@/lib/api";
import { cx } from "@/lib/format";
import { CATEGORIES, COLORS, STYLE_TAGS, SUBCATEGORIES, TOP_FITS } from "@/lib/taxonomy";
import type { Gender, Item, OnboardingStep, StyleAttributes, StyleProfile, User } from "@/lib/types";

const STEPS: { key: OnboardingStep; label: string }[] = [
  { key: "body", label: "내 몸" },
  { key: "fit", label: "취향" },
  { key: "style", label: "추구미" },
  { key: "closet", label: "옷 등록" },
];
const S = { body: 0, pref: 1, style: 2, closet: 3 } as const;

// Steps with several short pages, one question each.
const BODY_PAGES = ["gender", "size"] as const;
const PREF_PAGES = ["fit", "style", "colors", "items"] as const;
const pagesOf = (step: number) => (step === S.body ? BODY_PAGES.length : step === S.pref ? PREF_PAGES.length : 1);

// Lookbook images generated for FITME (Figma AI) in public/onboarding/, picked by gender and height.
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

/** From this height (cm) the "tall" pictures are shown. Roughly the Korean average for each. */
const TALL_FROM: Record<Gender, number> = { female: 163, male: 176 };

function lookPerson(gender: Gender | "", height: string): { gender: Gender; tall: boolean } {
  const g = gender || "female";
  const h = Number(height);
  return { gender: g, tall: !h || h >= TALL_FROM[g] };
}

function firstOpenStep(me: User): number {
  if (!me.gender || !me.height_cm) return S.body; // the pictures need both
  const done = me.onboarding_state?.steps ?? {};
  const i = STEPS.findIndex((s) => !done[s.key]);
  return i < 0 ? S.closet : i;
}

export default function OnboardingPage() {
  const { status, me } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed_out") router.replace("/welcome");
    else if (me && onboardingDone(me)) router.replace("/chat");
  }, [status, me, router]);

  if (!me || onboardingDone(me)) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LoadingState />
      </div>
    );
  }
  return <Wizard me={me} />;
}

function Wizard({ me }: { me: User }) {
  const { setMe } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(() => firstOpenStep(me));
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 내 몸
  const [body, setBody] = useState<BodyDraft>(() => bodyDraftFrom(me));
  // 취향
  const [fit, setFit] = useState<string>(me.preferred_fit ?? "");
  const [styleTags, setStyleTags] = useState<string[]>(me.style_tags);
  const [avoidColors, setAvoidColors] = useState<string[]>(me.avoid_colors);
  const [avoidSubs, setAvoidSubs] = useState<string[]>(me.avoid_subcategories);
  // 추구미
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [styleName, setStyleName] = useState("");
  const [attrs, setAttrs] = useState<StyleAttributes | null>(null);
  // 옷 등록
  const [saved, setSaved] = useState<Item[]>([]);
  const onSaved = useCallback((item: Item) => setSaved((s) => [...s, item]), []);
  const queue = useUploadQueue(onSaved);
  const fileRef = useRef<HTMLInputElement>(null);

  const person = lookPerson(body.gender, body.height_cm);
  const fitSrc = (code: string) => `/onboarding/fit-${person.gender}-${person.tall ? "tall" : "short"}-${code}.webp`;
  const styleSrc = (code: string) => `/onboarding/style-${person.gender}-${code}.webp`;

  // Resume an existing default style profile when coming back to 추구미.
  useEffect(() => {
    if (step !== S.style || profile) return;
    let alive = true;
    listStyleProfiles()
      .then((r) => {
        const p = r.profiles.find((x) => x.is_default) ?? r.profiles[0];
        if (alive && p) {
          setProfile(p);
          setStyleName(p.style_name);
          setAttrs(p.attributes);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [step, profile]);

  const closetCount = me.closet_count + saved.length;

  /** Save, then go to the next page of this step or the first page of the next step. */
  const save = async (fn: () => Promise<User | void>) => {
    setBusy(true);
    setError(null);
    try {
      const u = await fn();
      if (u) setMe(u);
      if (page < pagesOf(step) - 1) setPage(page + 1);
      else if (step < S.closet) {
        setStep(step + 1);
        setPage(0);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (step === S.body) {
      if (BODY_PAGES[page] === "gender") {
        if (!body.gender) return setError("성별을 골라 주세요.");
        return void save(() => patchMe({ gender: body.gender || undefined }));
      }
      const h = Number(body.height_cm);
      if (!h || h < 100 || h > 230) return setError("키를 cm로 적어 주세요. 나머지 칸은 비워도 돼요.");
      return void save(() => patchMe({ ...bodyPatch(body), onboarding_step: { step: "body", status: "done" } }));
    }
    if (step === S.pref) {
      const p = PREF_PAGES[page];
      if (p === "fit" && !fit) return setError("가장 좋아하는 핏을 하나 골라 주세요.");
      if (p === "style" && styleTags.length === 0) return setError("끌리는 스타일을 하나 이상 골라 주세요.");
      const patch =
        p === "fit"
          ? { preferred_fit: fit }
          : p === "style"
            ? { style_tags: styleTags }
            : p === "colors"
              ? { avoid_colors: avoidColors }
              : { avoid_subcategories: avoidSubs, onboarding_step: { step: "fit" as const, status: "done" as const } };
      return void save(() => patchMe(patch));
    }
    if (step === S.style) {
      if (!profile || !attrs) return setError("추구미를 하나 골라 주세요.");
      return void save(async () => {
        await patchStyleProfile(profile.id, { style_name: styleName.trim() || profile.style_name, attributes: attrs, is_default: true });
        return patchMe({ onboarding_step: { step: "style", status: "done" } });
      });
    }
    void finish("done");
  };

  const finish = (status: "done" | "skipped") =>
    save(async () => {
      const u = await patchMe({ onboarding_step: { step: "closet", status }, complete_onboarding: true });
      setMe(u);
      router.replace("/chat");
      return u;
    });

  const back = () => {
    setError(null);
    if (page > 0) setPage(page - 1);
    else if (step > 0) {
      setStep(step - 1);
      setPage(pagesOf(step - 1) - 1);
    }
  };

  const optionalEmpty =
    step === S.pref && ((PREF_PAGES[page] === "colors" && !avoidColors.length) || (PREF_PAGES[page] === "items" && !avoidSubs.length));
  const counter = (n: number) => `${page + 1} / ${n}`;

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <DevBand />
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-8">
        <Logo />
        <ol className="flex items-center gap-1.5 whitespace-nowrap text-[13px] sm:gap-2" aria-label="온보딩 단계">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              <span
                aria-current={i === step ? "step" : undefined}
                className={cx(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1",
                  i === step ? "bg-accent text-accent-ink" : i < step ? "bg-accent-soft text-accent" : "text-muted",
                )}
              >
                <span className="font-mono text-xs">{i < step ? "✓" : i + 1}</span>
                {/* phones: only the current step keeps its name */}
                <span className={cx(i !== step && "hidden sm:inline")}>{s.label}</span>
              </span>
              {i < STEPS.length - 1 && <span aria-hidden className="h-px w-2 bg-line-strong sm:w-4" />}
            </li>
          ))}
        </ol>
        <span className="hidden w-16 sm:block" />
      </header>

      <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
        {step === S.body && BODY_PAGES[page] === "gender" && (
          <section className="flex flex-col gap-6">
            <Heading step={counter(BODY_PAGES.length)} title="성별을 알려 주세요" sub="핏과 스타일 사진을 내 성별에 맞춰 보여 드려요. AI에는 보내지 않아요." />
            <div className="mx-auto grid w-full max-w-[560px] grid-cols-2 gap-4">
              {GENDERS.map((g) => (
                <Tile
                  key={g.code}
                  on={body.gender === g.code}
                  onClick={() => setBody({ ...body, gender: g.code })}
                  label={g.label}
                  media={<Look src={`/onboarding/style-${g.code}-casual.webp`} />}
                />
              ))}
            </div>
          </section>
        )}

        {step === S.body && BODY_PAGES[page] === "size" && (
          <section className="flex flex-col gap-5">
            <Heading
              step={counter(BODY_PAGES.length)}
              title="키와 치수를 알려 주세요"
              sub="키만 꼭 적어 주세요. 키에 맞는 사진과 핏 추천에 써요. 나머지는 모르면 비워도 되고, 치수는 AI에 보내지 않아요. 몸무게는 받지 않아요."
            />
            <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
              <div className="hidden flex-col items-center gap-2 rounded-[14px] border border-line bg-surface p-4 md:flex">
                <span className="text-[13px] font-semibold">줄자 재는 위치</span>
                <BodyFigure />
              </div>
              <BodyForm value={body} onChange={setBody} gender={false} />
            </div>
          </section>
        )}

        {step === S.pref && PREF_PAGES[page] === "fit" && (
          <section className="flex flex-col gap-6">
            <Heading
              step={counter(PREF_PAGES.length)}
              title="어떤 핏을 가장 좋아하세요?"
              sub={`같은 옷을 핏만 다르게 입은 모습이에요 (${person.gender === "female" ? "여성" : "남성"} · 키 ${person.tall ? "큰" : "작은"} 편 기준).`}
            />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {TOP_FITS.map((f) => (
                <Tile
                  key={f.code}
                  on={fit === f.code}
                  onClick={() => setFit(f.code)}
                  label={f.label}
                  desc={FIT_WORDS[f.code]}
                  media={<Look src={fitSrc(f.code)} crop />}
                />
              ))}
            </div>
          </section>
        )}

        {step === S.pref && PREF_PAGES[page] === "style" && (
          <section className="flex flex-col gap-6">
            <Heading
              step={counter(PREF_PAGES.length)}
              title="끌리는 스타일을 골라 주세요"
              sub={`최대 3개까지 고를 수 있어요. ${styleTags.length ? `${styleTags.length}개 골랐어요.` : ""}`}
            />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {STYLE_TAGS.map((t) => (
                <Tile
                  key={t.code}
                  on={styleTags.includes(t.code)}
                  disabled={!styleTags.includes(t.code) && styleTags.length >= 3}
                  onClick={() => setStyleTags((v) => toggleIn(v, t.code, 3))}
                  label={t.label}
                  desc={STYLE_WORDS[t.code]}
                  media={<Look src={styleSrc(t.code)} />}
                />
              ))}
            </div>
          </section>
        )}

        {step === S.pref && PREF_PAGES[page] === "colors" && (
          <section className="flex flex-col gap-6">
            <Heading step={counter(PREF_PAGES.length)} title="입기 싫은 색이 있나요?" sub="고른 색은 코디에 넣지 않아요. 없으면 그냥 넘어가도 돼요." />
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {COLORS.map((c) => (
                <Tile key={c.code} avoid on={avoidColors.includes(c.code)} onClick={() => setAvoidColors((v) => toggleIn(v, c.code))} label={c.label}>
                  <span aria-hidden className="my-2 block h-16 w-16 rounded-full border border-line-strong shadow-inner" style={{ background: c.hex }} />
                </Tile>
              ))}
            </div>
          </section>
        )}

        {step === S.pref && PREF_PAGES[page] === "items" && (
          <section className="flex flex-col gap-6">
            <Heading step={counter(PREF_PAGES.length)} title="입지 않는 옷이 있나요?" sub="고른 옷은 추천에서 빼요. 없으면 그냥 넘어가도 돼요." />
            {CATEGORIES.map((cat) => (
              <div key={cat.code} className="flex flex-col gap-2">
                <h2 className="text-[14px] font-semibold text-muted">{cat.label}</h2>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
                  {SUBCATEGORIES[cat.code].map((sub) => (
                    <Tile key={sub.code} avoid on={avoidSubs.includes(sub.code)} onClick={() => setAvoidSubs((v) => toggleIn(v, sub.code))} label={sub.label}>
                      <ClothingIcon subcategory={sub.code} color={TYPICAL_COLOR[sub.code] ?? "white"} size={cat.code === "shoes" ? 84 : 64} />
                    </Tile>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {step === S.style && (
          <section className="flex flex-col gap-5">
            <Heading title="되고 싶은 스타일, 추구미를 알려주세요" sub="고르거나 직접 적으면 색·실루엣·무드로 정리해 드려요. 나중에 바꿀 수 있어요." />
            {!profile || !attrs ? (
              <StyleCreator
                onCreated={(p) => {
                  setProfile(p);
                  setStyleName(p.style_name);
                  setAttrs(p.attributes);
                }}
              />
            ) : (
              <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">정리된 추구미를 확인하고 고쳐 주세요</h2>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setProfile(null);
                      setAttrs(null);
                    }}
                  >
                    다른 추구미 고르기
                  </Button>
                </div>
                <StyleAttributesEditor name={styleName} onNameChange={setStyleName} value={attrs} onChange={setAttrs} />
              </div>
            )}
          </section>
        )}

        {step === S.closet && (
          <section className="flex flex-col gap-5">
            <Heading
              title="옷 사진을 3장 이상 올려 주세요"
              sub={`한 번에 ${MAX_FILES}장까지 올릴 수 있어요. AI가 태그를 붙이면 확인하고 저장해 주세요.`}
            />
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px]">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Button onClick={() => fileRef.current?.click()}>옷 사진 올리기</Button>
                  <span className={cx("text-[13px]", closetCount >= 3 ? "text-good" : "text-muted")}>
                    {closetCount >= 3 ? "✓ " : ""}등록한 옷 {closetCount}벌 / 3벌
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      if (e.target.files?.length) queue.addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
                {saved.length > 0 ? (
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {saved.map((i) => (
                      <li key={i.id} className="flex flex-col gap-1 text-[11.5px]">
                        <ItemThumb src={i.image_url} alt={i.name} subcategory={i.subcategory} color={i.color} />
                        <span className="truncate">{i.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="grid h-48 place-items-center rounded-[14px] border border-dashed border-line-strong px-4 text-center text-[13px] text-muted">
                    상의·하의·신발을 골고루 올리면 코디가 더 잘 나와요.
                  </div>
                )}
              </div>
              {queue.total > 0 && <TagReviewPanel queue={queue} />}
            </div>
          </section>
        )}

        {error && <Banner tone="danger">{error}</Banner>}
      </main>

      <footer className="sticky bottom-0 border-t border-line bg-surface px-4 py-3 sm:px-8">
        <div className="mx-auto flex max-w-[1040px] items-center justify-between">
          <Button variant="ghost" onClick={back} disabled={(step === 0 && page === 0) || busy}>
            이전
          </Button>
          <div className="flex items-center gap-2">
            {step === S.closet && closetCount < 3 && (
              <Button variant="subtle" onClick={() => void finish("skipped")} disabled={busy}>
                나중에 하기
              </Button>
            )}
            <Button onClick={next} loading={busy} disabled={step === S.closet && closetCount < 3}>
              {step === S.closet ? "완료하고 첫 코디 받기" : optionalEmpty ? "없어요, 다음" : "다음"}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Heading({ title, sub, badge, step }: { title: string; sub?: string; badge?: string; step?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {badge && <span className="self-start rounded bg-tile px-1.5 py-px text-[11px] font-semibold text-muted">{badge}</span>}
      {step && <span className="font-mono text-[13px] font-semibold text-accent">{step}</span>}
      <h1 className="text-[24px] font-bold">{title}</h1>
      {sub && <p className="text-[14px] text-muted">{sub}</p>}
    </div>
  );
}

/** A big picture card. `avoid` cards mark what the user does NOT want (red ✕ instead of ✓). */
function Tile({
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
        on
          ? avoid
            ? "border-danger bg-danger-soft"
            : "border-accent bg-accent-soft"
          : "border-line hover:border-line-strong",
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
function Look({ src, crop }: { src: string; crop?: boolean }) {
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
