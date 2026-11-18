"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/AppShell";
import { TagReviewPanel } from "@/components/closet/TagReviewPanel";
import { MAX_FILES, useUploadQueue } from "@/components/closet/useUploadQueue";
import { FeedbackButton } from "@/components/board/FeedbackButton";
import { DevBand } from "@/components/DevBand";
import { ItemThumb } from "@/components/ItemThumb";
import { onboardingDone, useAuth } from "@/components/providers/AuthProvider";
import { BodyFigure, BodyForm, GENDERS, bodyDraftFrom, bodyPatch, type BodyDraft } from "@/components/profile/BodyForm";
import {
  EMPTY_DRAFT,
  Heading,
  Look,
  STYLE_PAGES,
  StylePage,
  Tile,
  attributesOf,
  draftFrom,
  lookPerson,
  pageError,
  pageIsEmpty,
  styleSrc,
  type StyleDraft,
} from "@/components/profile/StyleSteps";
import { Banner, Button, LoadingState } from "@/components/ui";
import { createStyleProfile, errorMessage, listStyleProfiles, patchMe, patchStyleProfile } from "@/lib/api";
import { cx } from "@/lib/format";
import type { Item, OnboardingStep, User } from "@/lib/types";

// 내 몸 → 내 추구미 (fit, styles, colors, items: saved as the default 추구미) → 옷 등록. Decision 13.
const STEPS: { key: OnboardingStep; label: string }[] = [
  { key: "body", label: "내 몸" },
  { key: "style", label: "내 추구미" },
  { key: "closet", label: "옷 등록" },
];
const S = { body: 0, style: 1, closet: 2 } as const;

// Steps with several short pages, one question each.
const BODY_PAGES = ["gender", "size"] as const;
const pagesOf = (step: number) => (step === S.body ? BODY_PAGES.length : step === S.style ? STYLE_PAGES.length : 1);

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
  // 내 추구미: the default 추구미, if there already is one (coming back to onboarding)
  const [style, setStyle] = useState<StyleDraft>(EMPTY_DRAFT);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  // 옷 등록
  const [saved, setSaved] = useState<Item[]>([]);
  const onSaved = useCallback((item: Item) => setSaved((s) => [...s, item]), []);
  const queue = useUploadQueue(onSaved);
  const fileRef = useRef<HTMLInputElement>(null);

  const person = lookPerson(body.gender, body.height_cm);

  useEffect(() => {
    if (step !== S.style || styleLoaded) return;
    let alive = true;
    listStyleProfiles()
      .then((r) => {
        const p = r.profiles.find((x) => x.is_default) ?? r.profiles[0];
        if (alive && p) {
          setStyle(draftFrom(p));
          setStyleId(p.id);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setStyleLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [step, styleLoaded]);

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

  const saveStyle = async () => {
    const body = { style_name: style.style_name.trim() || undefined, attributes: attributesOf(style) };
    if (styleId) await patchStyleProfile(styleId, { ...body, is_default: true });
    else {
      const p = await createStyleProfile({ ...body, source_text: style.source_text.trim() || undefined, is_default: true });
      setStyleId(p.id);
    }
    return patchMe({ onboarding_step: { step: "style", status: "done" } });
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
    if (step === S.style) {
      const err = pageError(STYLE_PAGES[page], style);
      if (err) return setError(err);
      if (page < STYLE_PAGES.length - 1) return void save(async () => {});
      return void save(saveStyle);
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

  const optionalEmpty = step === S.style && pageIsEmpty(STYLE_PAGES[page], style);
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
                  media={<Look src={styleSrc({ gender: g.code, tall: true }, "casual")} />}
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

        {step === S.style &&
          (styleLoaded ? (
            <>
              {page === 0 && (
                <p className="rounded-[12px] bg-accent-soft px-4 py-3 text-[13.5px] text-accent">
                  추구미는 &lsquo;이렇게 입고 싶다&rsquo;는 내 기준이에요. 여기서 고른 핏·스타일·색이 대표 추구미가 되고, 코디를 고를 때 이 기준을 따라요. 내 프로필에서 다른 추구미를 더 만들고 바꿀 수 있어요.
                </p>
              )}
              <StylePage page={STYLE_PAGES[page]} draft={style} onChange={setStyle} person={person} step={counter(STYLE_PAGES.length)} />
            </>
          ) : (
            <LoadingState />
          ))}

        {step === S.closet && (
          <section className="flex flex-col gap-5">
            <Heading
              title="옷 사진을 3장 이상 올려 주세요"
              sub={`한 번에 ${MAX_FILES}장까지 올릴 수 있어요. AI가 태그를 붙이면 확인하고 저장해 주세요.`}
            />
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_300px]">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Button onClick={() => fileRef.current?.click()}>
                    옷 사진 올리기
                  </Button>
                  <span
                    className={cx(
                      "text-[13px]",
                      closetCount >= 3 ? "text-good" : "text-muted",
                    )}
                  >
                    {closetCount >= 3 ? "✓ " : ""}등록한 옷 {closetCount}벌 /
                    3벌
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      if (e.target.files?.length)
                        queue.addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>
                {saved.length > 0 ? (
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {saved.map((i) => (
                      <li
                        key={i.id}
                        className="flex flex-col gap-1 text-[11.5px]"
                      >
                        <ItemThumb
                          src={i.image_url}
                          alt={i.name}
                          subcategory={i.subcategory}
                          color={i.color}
                        />
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
          <Button
            variant="ghost"
            onClick={back}
            disabled={(step === 0 && page === 0) || busy}
          >
            이전
          </Button>
          <div className="flex items-center gap-2">
            {step === S.closet && closetCount < 3 && (
              <Button
                variant="subtle"
                onClick={() => void finish("skipped")}
                disabled={busy}
              >
                나중에 하기
              </Button>
            )}
            <Button
              onClick={next}
              loading={busy}
              disabled={step === S.closet && closetCount < 3}
            >
              {step === S.closet
                ? "완료하고 첫 코디 받기"
                : optionalEmpty
                  ? "없어요, 다음"
                  : "다음"}
            </Button>
          </div>
        </div>
      </footer>
      <FeedbackButton where={`온보딩 · ${STEPS[step].label}`} />
    </div>
  );
}
