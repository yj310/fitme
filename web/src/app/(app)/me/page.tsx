"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ItemThumb } from "@/components/ItemThumb";
import { useAuth } from "@/components/providers/AuthProvider";
import { BodyForm, bodyDraftFrom, bodyPatch, type BodyDraft } from "@/components/profile/BodyForm";
import {
  EMPTY_DRAFT,
  StyleAttributeChips,
  StyleStepper,
  attributesOf,
  draftFrom,
  lookPerson,
  type StyleDraft,
} from "@/components/profile/StyleSteps";
import { RegionPicker } from "@/components/RegionPicker";
import { Badge, Banner, Button, Card, CardTitle, Chip, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Select } from "@/components/ui";
import {
  createStyleProfile,
  deleteExclusion,
  deleteStyleProfile,
  errorMessage,
  getLearningLog,
  listOutfits,
  listStyleProfiles,
  patchMe,
  patchStyleProfile,
} from "@/lib/api";
import { shortDate } from "@/lib/format";
import { PERSONAL_COLORS, label } from "@/lib/taxonomy";
import type { LearningLog, OutfitCard, StyleProfile, User } from "@/lib/types";

export default function MePage() {
  const { me, setMe, refreshMe } = useAuth();
  const [log, setLog] = useState<LearningLog | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  const loadLog = useCallback(async () => {
    setLogError(null);
    try {
      setLog(await getLearningLog());
    } catch (e) {
      setLogError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void loadLog();
  }, [loadLog]);

  if (!me) return <LoadingState />;

  return (
    <div className="flex flex-col gap-4 px-[26px] py-[22px]">
      <PageHeader
        title="내 프로필"
        sub={log ? `학습 ${log.total}회${log.last_updated ? ` · 마지막 갱신 ${shortDate(log.last_updated)}` : ""}` : undefined}
      />
      <div className="grid grid-cols-3 gap-4">
        <StyleCard
          onChanged={() => {
            void refreshMe();
            void loadLog();
          }}
        />
        <PreferenceCard me={me} setMe={setMe} onChanged={loadLog} />
        <BodyCard me={me} setMe={setMe} />
      </div>
      <div className="grid grid-cols-[2fr_1fr] gap-4">
        <Card>
          <CardTitle>학습 기록</CardTitle>
          {logError ? (
            <ErrorState message={logError} onRetry={loadLog} />
          ) : !log ? (
            <LoadingState />
          ) : log.events.length === 0 ? (
            <EmptyState
              title="아직 학습한 내용이 없어요"
              description="대화에서 제외 조건을 기억하거나 코디를 ♥ 저장하면 여기에 기록돼요."
            />
          ) : (
            <ol className="flex flex-col">
              {log.events.map((e, i) => (
                <li key={i} className="grid grid-cols-[52px_16px_minmax(0,1fr)] items-start gap-2 py-1.5 text-[13px]">
                  <span className="font-mono text-xs text-muted">{shortDate(e.date)}</span>
                  <span aria-hidden className="mt-1.5 h-2 w-2 rounded-full bg-accent" />
                  <span>
                    {e.text}{" "}
                    <Badge tone="muted">
                      {{ exclusion: "제외 조건", dislike: "비선호", favorite: "♥ 저장", style_added: "추구미" }[e.type]}
                    </Badge>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <SavedPreview />
      </div>
    </div>
  );
}

// ── 추구미 카드 ──
// Every 추구미 is made and edited with the same steps as onboarding; the default one drives the outfits.
function StyleCard({ onChanged }: { onChanged: () => void }) {
  const { me } = useAuth();
  const [profiles, setProfiles] = useState<StyleProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null: closed · "new": 추가 · a profile: 고치기
  const [open, setOpen] = useState<StyleProfile | "new" | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProfiles((await listStyleProfiles()).profiles);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load();
  }, [load]);

  const def = profiles?.find((p) => p.is_default) ?? profiles?.[0];
  const others = profiles?.filter((p) => p.id !== def?.id) ?? [];
  const person = lookPerson(me?.gender, me?.height_cm);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const submit = async (d: StyleDraft) => {
    const body = { style_name: d.style_name.trim() || undefined, attributes: attributesOf(d) };
    if (open === "new") await createStyleProfile({ ...body, source_text: d.source_text.trim() || undefined });
    else if (open) await patchStyleProfile(open.id, body);
    setOpen(null);
    await load();
    onChanged();
  };

  return (
    <Card>
      <CardTitle
        right={
          <Button variant="subtle" className="!px-2 !py-0.5 text-xs" onClick={() => setOpen("new")}>
            + 추구미 추가
          </Button>
        }
      >
        추구미
      </CardTitle>
      {error && <Banner tone="danger">{error}</Banner>}
      {!profiles ? (
        <LoadingState />
      ) : !def ? (
        <EmptyState title="추구미가 없어요" action={<Button onClick={() => setOpen("new")}>추구미 만들기</Button>} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">
              {def.style_name} <Badge>대표</Badge>
            </span>
            <Button variant="subtle" className="!px-2 !py-0.5 text-xs" onClick={() => setOpen(def)}>
              고치기
            </Button>
          </div>
          <p className="text-xs text-muted">코디는 대표 추구미를 기준으로 골라요.</p>
          <StyleAttributeChips a={def.attributes} />
          {others.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-line pt-2 text-[13px]">
              <span className="text-xs text-muted">다른 추구미</span>
              {others.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-1">
                  <span className="truncate">{p.style_name}</span>
                  <span className="flex shrink-0 gap-0.5">
                    <Button variant="subtle" className="!px-1.5 !py-0 text-xs" onClick={() => act(() => patchStyleProfile(p.id, { is_default: true }))}>
                      대표로
                    </Button>
                    <Button variant="subtle" className="!px-1.5 !py-0 text-xs" onClick={() => setOpen(p)}>
                      고치기
                    </Button>
                    <Button variant="subtle" className="!px-1.5 !py-0 text-xs" onClick={() => act(() => deleteStyleProfile(p.id))}>
                      삭제
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <Modal open={open !== null} title={open === "new" ? "새 추구미" : "추구미 고치기"} onClose={() => setOpen(null)} width={980}>
        {open !== null && (
          <>
            {open === "new" && def && (
              <p className="mb-4 rounded-[12px] bg-accent-soft px-4 py-3 text-[13.5px] text-accent">
                대표 추구미 &lsquo;{def.style_name}&rsquo;에서 시작해요. 이 추구미에서 달라지는 것만 바꿔 주세요.
              </p>
            )}
            <StyleStepper
              key={open === "new" ? "new" : open.id}
              initial={open === "new" ? (def ? { ...draftFrom(def), style_name: "", source_text: "" } : EMPTY_DRAFT) : draftFrom(open)}
              person={person}
              submitLabel={open === "new" ? "추구미 만들기" : "저장"}
              onSubmit={submit}
            />
          </>
        )}
      </Modal>
    </Card>
  );
}

// ── 기억 · 설정 카드 ──
function PreferenceCard({ me, setMe, onChanged }: { me: User; setMe: (u: User) => void; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [changingRegion, setChangingRegion] = useState(false);

  const patch = async (body: Parameters<typeof patchMe>[0]) => {
    setError(null);
    try {
      setMe(await patchMe(body));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const removeExclusion = async (id: string) => {
    setError(null);
    try {
      await deleteExclusion(id);
      setMe({ ...me, persistent_exclusions: me.persistent_exclusions.filter((x) => x.id !== id) });
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardTitle>기억 · 설정</CardTitle>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">대화에서 기억한 제외</span>
        <div className="flex flex-wrap gap-1">
          {me.persistent_exclusions.map((x) => (
            <span key={x.id} className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2.5 py-0.5 text-xs">
              {x.target_label}
              {x.scope?.length ? ` (${x.scope.join("·")})` : ""}
              <button type="button" aria-label={`${x.target_label} 제외 해제`} className="text-muted hover:text-danger" onClick={() => removeExclusion(x.id)}>
                ×
              </button>
            </span>
          ))}
          {!me.persistent_exclusions.length && <span className="text-xs text-muted">없어요. 대화에서 &ldquo;앞으로 ○○ 빼줘&rdquo;라고 하면 여기에 남아요.</span>}
        </div>
        <span className="text-xs text-muted">피하는 색·옷은 추구미에서 정해요.</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">
          퍼스널 컬러 <Badge tone="muted">선택</Badge>
        </span>
        <Select
          ariaLabel="퍼스널 컬러"
          value={me.personal_color ?? ""}
          onChange={(v) => patch({ personal_color: v || null })}
          options={PERSONAL_COLORS}
          placeholder="모름 / 선택 안 함"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-xs text-muted">
          기본 지역 (날씨)
          <Button variant="subtle" className="!px-1.5 !py-0 text-xs" onClick={() => setChangingRegion((v) => !v)}>
            {changingRegion ? "닫기" : "변경"}
          </Button>
        </span>
        <span className="text-[13px]">{me.home_region ?? "설정 안 됨"}</span>
        {changingRegion && (
          <RegionPicker
            onSelect={(r) => {
              setChangingRegion(false);
              void patch({ region_code: r.code });
            }}
          />
        )}
      </div>
    </Card>
  );
}

// ── 신체 정보 카드 ──
function BodyCard({ me, setMe }: { me: User; setMe: (u: User) => void }) {
  const [editing, setEditing] = useState(false);
  const m = me.body_measurements ?? {};
  const v = (n: number | null | undefined, unit = "") => (n ? `${n}${unit}` : "—");
  const rows: [string, string][] = [
    ["키", v(me.height_cm)],
    ["평소 상의", me.usual_sizes?.top ?? "—"],
    ["하의 허리", v(me.usual_sizes?.bottom_waist, "인치")],
    ["어깨너비", v(m.shoulder)],
    ["가슴둘레", v(m.chest)],
    ["허리둘레", v(m.waist)],
    ["엉덩이둘레", v(m.hip)],
  ];
  return (
    <Card>
      <CardTitle
        right={
          <Button variant="subtle" className="!px-2 !py-0.5 text-xs" onClick={() => setEditing(true)}>
            수정
          </Button>
        }
      >
        신체 정보 <Badge tone="muted">선택</Badge>
      </CardTitle>
      <table className="w-full text-[12.5px]">
        <tbody>
          {rows.map(([k, val]) => (
            <tr key={k} className="border-b border-line last:border-0">
              <th scope="row" className="py-1.5 text-left font-normal text-muted">
                {k}
              </th>
              <td className="py-1.5 text-right font-mono">{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-1">
        {me.body_traits.map((t) => (
          <Chip key={t}>{label("trait", t)}</Chip>
        ))}
      </div>
      <p className="text-xs text-muted">언제든 수정할 수 있어요. 치수 숫자는 AI에 보내지 않아요.</p>
      <Modal open={editing} title="신체 정보" onClose={() => setEditing(false)} width={760}>
        {editing && <BodyEditBody me={me} setMe={setMe} onDone={() => setEditing(false)} />}
      </Modal>
    </Card>
  );
}

function BodyEditBody({ me, setMe, onDone }: { me: User; setMe: (u: User) => void; onDone: () => void }) {
  const [draft, setDraft] = useState<BodyDraft>(() => bodyDraftFrom(me));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <BodyForm value={draft} onChange={setDraft} />
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="flex justify-between">
        <Button
          variant="subtle"
          onClick={() =>
            setDraft({ gender: draft.gender, height_cm: "", top: "", bottom_waist: "", body_traits: [], shoulder: "", chest: "", waist: "", hip: "" })
          }
        >
          모두 지우기
        </Button>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setMe(await patchMe(bodyPatch(draft)));
              onDone();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          저장
        </Button>
      </div>
    </div>
  );
}

// ── 저장한 코디 미리보기 ──
function SavedPreview() {
  const [outfits, setOutfits] = useState<OutfitCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setOutfits((await listOutfits({ favorite: true, limit: 5 })).outfits.slice(0, 5));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load();
  }, [load]);
  return (
    <Card>
      <CardTitle
        right={
          <Link href="/saved" className="text-xs text-accent hover:underline">
            전체 보기
          </Link>
        }
      >
        저장한 코디 {outfits && <span className="font-mono text-xs text-muted">{outfits.length}</span>}
      </CardTitle>
      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !outfits ? (
        <LoadingState />
      ) : outfits.length === 0 ? (
        <p className="text-[13px] text-muted">아직 저장한 코디가 없어요.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {outfits.map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              <div className="grid w-24 shrink-0 grid-cols-2 gap-0.5">
                {o.items.slice(0, 4).map((i) => (
                  <ItemThumb key={i.id} src={i.image_url} alt={i.name} subcategory={i.subcategory} color={i.color} rounded="rounded-[4px]" />
                ))}
              </div>
              <div className="min-w-0 text-[12.5px]">
                <p className="truncate font-semibold">{o.title}</p>
                <p className="truncate text-muted">{[o.occasion, shortDate(o.created_at)].filter(Boolean).join(" · ")}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto text-xs text-muted">♥ 이력은 다음 추천의 개인 선호도 점수에 반영돼요.</p>
    </Card>
  );
}
