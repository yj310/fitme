"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ItemThumb } from "@/components/ItemThumb";
import { useAuth } from "@/components/providers/AuthProvider";
import { BodyForm, bodyDraftFrom, bodyPatch, type BodyDraft } from "@/components/profile/BodyForm";
import { StyleAttributeChips, StyleAttributesEditor, StyleCreator } from "@/components/profile/StyleEditor";
import { RegionPicker } from "@/components/RegionPicker";
import { Badge, Banner, Button, Card, CardTitle, Chip, EmptyState, ErrorState, LoadingState, Modal, PageHeader, Select, toggleIn } from "@/components/ui";
import {
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
import { ALL_SUBCATEGORIES, COLORS, PERSONAL_COLORS, TOP_FITS, label, labels } from "@/lib/taxonomy";
import type { LearningLog, OutfitCard, StyleAttributes, StyleProfile, User } from "@/lib/types";

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
function StyleCard({ onChanged }: { onChanged: () => void }) {
  const [profiles, setProfiles] = useState<StyleProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StyleProfile | null>(null);

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

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Card>
      <CardTitle
        right={
          <Button variant="subtle" className="!px-2 !py-0.5 text-xs" onClick={() => setAdding(true)}>
            + 추가
          </Button>
        }
      >
        추구미
      </CardTitle>
      {error && <Banner tone="danger">{error}</Banner>}
      {!profiles ? (
        <LoadingState />
      ) : !def ? (
        <EmptyState title="추구미가 없어요" action={<Button onClick={() => setAdding(true)}>추구미 정하기</Button>} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">
              {def.style_name} {def.is_default && <Badge>기본</Badge>}
            </span>
            <Button variant="subtle" className="!px-2 !py-0.5 text-xs" onClick={() => setEditing(def)}>
              수정
            </Button>
          </div>
          <StyleAttributeChips a={def.attributes} />
          {others.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-line pt-2 text-[13px]">
              <span className="text-xs text-muted">다른 추구미</span>
              {others.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-1">
                  <span className="truncate">{p.style_name}</span>
                  <span className="flex shrink-0 gap-0.5">
                    <Button variant="subtle" className="!px-1.5 !py-0 text-xs" onClick={() => act(() => patchStyleProfile(p.id, { is_default: true }))}>
                      기본으로
                    </Button>
                    <Button variant="subtle" className="!px-1.5 !py-0 text-xs" onClick={() => setEditing(p)}>
                      수정
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
      <Modal open={adding} title="추구미 추가" onClose={() => setAdding(false)} width={720}>
        <StyleCreator
          onCreated={(p) => {
            setAdding(false);
            void load().then(() => setEditing(p));
            onChanged();
          }}
        />
      </Modal>
      <StyleEditModal
        profile={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
          onChanged();
        }}
      />
    </Card>
  );
}

function StyleEditModal({ profile, onClose, onSaved }: { profile: StyleProfile | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Modal open={Boolean(profile)} title="추구미 확인·수정" onClose={onClose} width={680}>
      {profile && <StyleEditBody key={profile.id} profile={profile} onSaved={onSaved} />}
    </Modal>
  );
}

function StyleEditBody({ profile, onSaved }: { profile: StyleProfile; onSaved: () => void }) {
  const [name, setName] = useState(profile.style_name);
  const [attrs, setAttrs] = useState<StyleAttributes>(profile.attributes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await patchStyleProfile(profile.id, { style_name: name.trim() || profile.style_name, attributes: attrs });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {profile.source_text && <p className="rounded-[8px] bg-tile px-3 py-2 text-[13px] text-muted">입력: “{profile.source_text}”</p>}
      <StyleAttributesEditor name={name} onNameChange={setName} value={attrs} onChange={setAttrs} />
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="flex justify-end">
        <Button onClick={save} loading={busy}>
          저장
        </Button>
      </div>
    </div>
  );
}

// ── 선호 · 제외 카드 ──
function PreferenceCard({ me, setMe, onChanged }: { me: User; setMe: (u: User) => void; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [editingAvoid, setEditingAvoid] = useState(false);
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
      <CardTitle>선호 · 제외</CardTitle>
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">선호 핏</span>
        <div className="flex flex-wrap gap-1">
          {TOP_FITS.map((f) => (
            <Chip key={f.code} on={me.preferred_fit === f.code} onClick={() => patch({ preferred_fit: f.code })}>
              {f.label}
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-xs text-muted">
          제외 아이템
          <Button variant="subtle" className="!px-1.5 !py-0 text-xs" onClick={() => setEditingAvoid(true)}>
            편집
          </Button>
        </span>
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
          {labels("subcategory", me.avoid_subcategories).map((l) => (
            <Chip key={l}>{l}</Chip>
          ))}
          {labels("color", me.avoid_colors).map((l) => (
            <Chip key={l}>{l}색</Chip>
          ))}
          {!me.persistent_exclusions.length && !me.avoid_subcategories.length && !me.avoid_colors.length && (
            <span className="text-xs text-muted">없어요</span>
          )}
        </div>
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
      <AvoidModal open={editingAvoid} me={me} onClose={() => setEditingAvoid(false)} onSave={patch} />
    </Card>
  );
}

function AvoidModal({
  open,
  me,
  onClose,
  onSave,
}: {
  open: boolean;
  me: User;
  onClose: () => void;
  onSave: (b: { avoid_subcategories: string[]; avoid_colors: string[] }) => Promise<void>;
}) {
  return (
    <Modal open={open} title="피하는 아이템·색" onClose={onClose} width={640}>
      {open && <AvoidBody me={me} onClose={onClose} onSave={onSave} />}
    </Modal>
  );
}

function AvoidBody({
  me,
  onClose,
  onSave,
}: {
  me: User;
  onClose: () => void;
  onSave: (b: { avoid_subcategories: string[]; avoid_colors: string[] }) => Promise<void>;
}) {
  const [subs, setSubs] = useState(me.avoid_subcategories);
  const [colors, setColors] = useState(me.avoid_colors);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">여기서 고른 아이템·색은 모든 상황의 코디에서 빠져요.</p>
      <div className="flex flex-wrap gap-1">
        {ALL_SUBCATEGORIES.map((s) => (
          <Chip key={s.code} on={subs.includes(s.code)} onClick={() => setSubs((v) => toggleIn(v, s.code))}>
            {label("subcategory", s.code)}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {COLORS.map((c) => (
          <Chip key={c.code} on={colors.includes(c.code)} onClick={() => setColors((v) => toggleIn(v, c.code))}>
            {c.label}
          </Chip>
        ))}
      </div>
      <div className="flex justify-end">
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await onSave({ avoid_subcategories: subs, avoid_colors: colors });
            setBusy(false);
            onClose();
          }}
        >
          저장
        </Button>
      </div>
    </div>
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
          onClick={() => setDraft({ height_cm: "", top: "", bottom_waist: "", body_traits: [], shoulder: "", chest: "", waist: "", hip: "" })}
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
