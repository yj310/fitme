"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/AppShell";
import { TagReviewPanel } from "@/components/closet/TagReviewPanel";
import { MAX_FILES, useUploadQueue } from "@/components/closet/useUploadQueue";
import { DevBand } from "@/components/DevBand";
import { ItemThumb } from "@/components/ItemThumb";
import { onboardingDone, useAuth } from "@/components/providers/AuthProvider";
import { BodyFigure, BodyForm, bodyDraftFrom, bodyPatch, type BodyDraft } from "@/components/profile/BodyForm";
import { StyleAttributesEditor, StyleCreator } from "@/components/profile/StyleEditor";
import { Banner, Button, Chip, LoadingState, toggleIn } from "@/components/ui";
import { errorMessage, listStyleProfiles, patchMe, patchStyleProfile } from "@/lib/api";
import { cx } from "@/lib/format";
import { ALL_SUBCATEGORIES, COLORS, STYLE_TAGS, TOP_FITS, label } from "@/lib/taxonomy";
import type { Item, OnboardingStep, StyleAttributes, StyleProfile, User } from "@/lib/types";

const STEPS: { key: OnboardingStep; label: string }[] = [
  { key: "fit", label: "선호 핏" },
  { key: "style", label: "추구미" },
  { key: "body", label: "신체 치수" },
  { key: "closet", label: "옷 등록" },
];

function firstOpenStep(me: User): number {
  const done = me.onboarding_state?.steps ?? {};
  const i = STEPS.findIndex((s) => !done[s.key]);
  return i < 0 ? 3 : i;
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Step 1
  const [fit, setFit] = useState<string>(me.preferred_fit ?? "");
  const [styleTags, setStyleTags] = useState<string[]>(me.style_tags);
  const [avoidColors, setAvoidColors] = useState<string[]>(me.avoid_colors);
  const [avoidSubs, setAvoidSubs] = useState<string[]>(me.avoid_subcategories);
  // Step 2
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [styleName, setStyleName] = useState("");
  const [attrs, setAttrs] = useState<StyleAttributes | null>(null);
  // Step 3
  const [body, setBody] = useState<BodyDraft>(() => bodyDraftFrom(me));
  // Step 4
  const [saved, setSaved] = useState<Item[]>([]);
  const onSaved = useCallback((item: Item) => setSaved((s) => [...s, item]), []);
  const queue = useUploadQueue(onSaved);
  const fileRef = useRef<HTMLInputElement>(null);

  // Resume an existing default style profile when coming back to step 2.
  useEffect(() => {
    if (step !== 1 || profile) return;
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

  const save = async (fn: () => Promise<User | void>, next?: number) => {
    setBusy(true);
    setError(null);
    try {
      const u = await fn();
      if (u) setMe(u);
      if (next !== undefined) setStep(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (step === 0) {
      if (!fit || styleTags.length === 0) {
        setError("선호 핏과 스타일을 하나 이상 골라 주세요.");
        return;
      }
      void save(
        () =>
          patchMe({
            preferred_fit: fit,
            style_tags: styleTags,
            avoid_colors: avoidColors,
            avoid_subcategories: avoidSubs,
            onboarding_step: { step: "fit", status: "done" },
          }),
        1,
      );
    } else if (step === 1) {
      if (!profile || !attrs) {
        setError("추구미를 하나 골라 주세요.");
        return;
      }
      void save(async () => {
        await patchStyleProfile(profile.id, { style_name: styleName.trim() || profile.style_name, attributes: attrs, is_default: true });
        return patchMe({ onboarding_step: { step: "style", status: "done" } });
      }, 2);
    } else if (step === 2) {
      void save(() => patchMe({ ...bodyPatch(body), onboarding_step: { step: "body", status: "done" } }), 3);
    } else {
      void finish("done");
    }
  };

  const finish = (status: "done" | "skipped") =>
    save(async () => {
      const u = await patchMe({ onboarding_step: { step: "closet", status }, complete_onboarding: true });
      setMe(u);
      router.replace("/chat");
      return u;
    });

  const skipBody = () => void save(() => patchMe({ onboarding_step: { step: "body", status: "skipped" } }), 3);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <DevBand />
      <header className="flex items-center justify-between border-b border-line bg-surface px-8 py-3">
        <Logo />
        <ol className="flex items-center gap-2 text-[13px]" aria-label="온보딩 단계">
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
                {s.label}
              </span>
              {i < STEPS.length - 1 && <span aria-hidden className="h-px w-4 bg-line-strong" />}
            </li>
          ))}
        </ol>
        <span className="w-16" />
      </header>

      <main className="mx-auto flex w-full max-w-[1040px] flex-1 flex-col gap-5 px-8 py-8">
        {step === 0 && (
          <section className="flex flex-col gap-5">
            <Heading title="어떤 핏과 스타일을 좋아하세요?" sub="코디를 고를 때 가장 먼저 참고해요." />
            <Group title="선호 핏" required>
              {TOP_FITS.map((f) => (
                <Chip key={f.code} on={fit === f.code} onClick={() => setFit(f.code)}>
                  {f.label}
                </Chip>
              ))}
            </Group>
            <Group title="스타일 (최대 3개)" required>
              {STYLE_TAGS.map((s) => (
                <Chip key={s.code} on={styleTags.includes(s.code)} onClick={() => setStyleTags((v) => toggleIn(v, s.code, 3))}>
                  {s.label}
                </Chip>
              ))}
            </Group>
            <Group title="피하는 색 (선택)">
              {COLORS.map((c) => (
                <Chip key={c.code} on={avoidColors.includes(c.code)} onClick={() => setAvoidColors((v) => toggleIn(v, c.code))}>
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border border-line-strong" style={{ background: c.hex }} />
                  {c.label}
                </Chip>
              ))}
            </Group>
            <Group title="피하는 아이템 (선택)">
              {ALL_SUBCATEGORIES.map((s) => (
                <Chip key={s.code} on={avoidSubs.includes(s.code)} onClick={() => setAvoidSubs((v) => toggleIn(v, s.code))}>
                  {label("subcategory", s.code)}
                </Chip>
              ))}
            </Group>
          </section>
        )}

        {step === 1 && (
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

        {step === 2 && (
          <section className="flex flex-col gap-5">
            <Heading
              badge="선택 단계"
              title="몸에 맞는 추천을 받으려면 치수를 알려주세요"
              sub="모르는 칸은 비워도 돼요. 치수는 핏 계산에만 쓰고 AI에 보내지 않아요. 몸무게는 받지 않아요."
            />
            <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-6">
              <div className="flex flex-col items-center gap-2 rounded-[14px] border border-line bg-surface p-4">
                <span className="text-[13px] font-semibold">줄자 재는 위치</span>
                <BodyFigure />
              </div>
              <BodyForm value={body} onChange={setBody} />
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="flex flex-col gap-5">
            <Heading
              title="옷 사진을 3장 이상 올려 주세요"
              sub={`한 번에 ${MAX_FILES}장까지 올릴 수 있어요. AI가 태그를 붙이면 확인하고 저장해 주세요.`}
            />
            <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5">
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
                  <ul className="grid grid-cols-5 gap-2">
                    {saved.map((i) => (
                      <li key={i.id} className="flex flex-col gap-1 text-[11.5px]">
                        <ItemThumb src={i.image_url} alt={i.name} subcategory={i.subcategory} color={i.color} />
                        <span className="truncate">{i.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="grid h-48 place-items-center rounded-[14px] border border-dashed border-line-strong text-[13px] text-muted">
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

      <footer className="sticky bottom-0 border-t border-line bg-surface px-8 py-3">
        <div className="mx-auto flex max-w-[1040px] items-center justify-between">
          <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>
            이전
          </Button>
          <div className="flex items-center gap-2">
            {step === 2 && (
              <Button variant="subtle" onClick={skipBody} disabled={busy}>
                건너뛰기
              </Button>
            )}
            {step === 3 && closetCount < 3 && (
              <Button variant="subtle" onClick={() => void finish("skipped")} disabled={busy}>
                나중에 하기
              </Button>
            )}
            <Button onClick={next} loading={busy} disabled={step === 3 && closetCount < 3}>
              {step === 2 ? "다음 · 옷 3벌 등록하기" : step === 3 ? "완료하고 첫 코디 받기" : "다음"}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Heading({ title, sub, badge }: { title: string; sub?: string; badge?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {badge && <span className="self-start rounded bg-tile px-1.5 py-px text-[11px] font-semibold text-muted">{badge}</span>}
      <h1 className="text-[22px] font-bold">{title}</h1>
      {sub && <p className="text-[13.5px] text-muted">{sub}</p>}
    </div>
  );
}

function Group({ title, required, children }: { title: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13.5px] font-semibold">
        {title} {required && <span className="text-xs font-normal text-accent">필수</span>}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
