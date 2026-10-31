"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiErrorBanner } from "@/components/ApiErrorBanner";
import { FavoriteButton, MissingNotice, OutfitGridCard, OutfitThumbs, ScoreBreakdown, ScoreText } from "@/components/OutfitCards";
import { useAuth } from "@/components/providers/AuthProvider";
import { RegionPicker } from "@/components/RegionPicker";
import { Badge, Banner, Button, Card, CardTitle, Chip, EmptyState, PageHeader, Select, Spinner, inputCls, toggleIn } from "@/components/ui";
import { ApiError, errorMessage, generateOutfits, getWeather, outfitFeedback, patchMe } from "@/lib/api";
import { addDays, koreanDate, ymd } from "@/lib/format";
import { TEMP_BANDS, TODAY_MOODS } from "@/lib/taxonomy";
import type { FeedbackChip, GenerateRequest, MoodCode, OutfitCard, Region, TimeOfDay, TodayResult, Weather } from "@/lib/types";

const TIMES: { code: TimeOfDay; label: string }[] = [
  { code: "all", label: "하루 전체" },
  { code: "morning", label: "아침" },
  { code: "afternoon", label: "낮" },
  { code: "evening", label: "저녁" },
];

const FEEDBACK_CHIPS: { code: FeedbackChip; label: string }[] = [
  { code: "change_top", label: "상의 바꾸기" },
  { code: "too_plain", label: "너무 무난해" },
  { code: "warmer", label: "더 따뜻하게" },
];

interface Place {
  name: string;
  nx: number;
  ny: number;
  code: string | null;
}

export default function TodayPage() {
  const { me, setMe } = useAuth();
  const today = ymd();
  const [date, setDate] = useState(today);
  const [time, setTime] = useState<TimeOfDay>("all");
  const [place, setPlace] = useState<Place | null>(() =>
    me?.grid_nx && me.grid_ny
      ? { name: me.home_region ?? "기본 지역", nx: me.grid_nx, ny: me.grid_ny, code: me.region_code }
      : null,
  );
  const [changingRegion, setChangingRegion] = useState(false);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [schedule, setSchedule] = useState("");
  const [moods, setMoods] = useState<MoodCode[]>([]);
  const [tempBand, setTempBand] = useState<string>("");
  const [result, setResult] = useState<TodayResult | null>(null);
  const [mainIdx, setMainIdx] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savingRegion, setSavingRegion] = useState(false);
  // Dedupe auto-generation (React StrictMode runs effects twice in development).
  const lastAutoKey = useRef<string | null>(null);

  const request = useCallback(
    (): GenerateRequest => ({
      date,
      time_of_day: time,
      ...(place ? { nx: place.nx, ny: place.ny, region_code: place.code ?? undefined } : {}),
      schedule: schedule.trim() || undefined,
      moods,
      temp_band: tempBand || undefined,
    }),
    [date, time, place, schedule, moods, tempBand],
  );

  const run = useCallback(
    async (kind: string, fn: () => Promise<TodayResult>) => {
      setBusy(kind);
      setError(null);
      try {
        const r = await fn();
        setResult(r);
        setMainIdx(0);
        setWeather(r.weather);
        setDirty(false);
      } catch (e) {
        setError({ code: e instanceof ApiError ? e.code : "ERROR", message: errorMessage(e) });
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const generate = useCallback(() => run("generate", () => generateOutfits(request())), [run, request]);

  // Weather shows first (fast), then outfits. Re-run when the date / region / time changes.
  useEffect(() => {
    let alive = true;
    const loadWeather = async () => {
      setWeatherLoading(true);
      try {
        const w = await getWeather({ date, time_of_day: time, nx: place?.nx, ny: place?.ny });
        if (alive) setWeather(w);
      } catch {
        if (alive) setWeather({ available: false, date, reason: "UNAVAILABLE" });
      } finally {
        if (alive) setWeatherLoading(false);
      }
    };
    void loadWeather();
    return () => {
      alive = false;
    };
  }, [date, time, place]);

  useEffect(() => {
    // Auto-generate on open, and again whenever date / region / time changes (spec 15.3-7).
    const key = `${date}|${time}|${place?.nx ?? ""},${place?.ny ?? ""}`;
    if (lastAutoKey.current === key) return;
    lastAutoKey.current = key;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, time, place]);

  const feedback = (chip: FeedbackChip) => {
    const main = result?.outfits[mainIdx];
    if (!main) return;
    void run(chip, () => outfitFeedback(main.id, { chip }));
  };

  const pickRegion = (r: Region) => {
    setPlace({ name: r.name, nx: r.nx, ny: r.ny, code: r.code });
    setChangingRegion(false);
  };

  const saveRegionAsHome = async () => {
    if (!place?.code) return;
    setSavingRegion(true);
    try {
      setMe(await patchMe({ region_code: place.code }));
    } catch (e) {
      setError({ code: "ERROR", message: errorMessage(e) });
    } finally {
      setSavingRegion(false);
    }
  };

  const updateOutfit = (o: OutfitCard) =>
    setResult((r) => (r ? { ...r, outfits: r.outfits.map((x) => (x.id === o.id ? o : x)) } : r));

  const outfits = result?.outfits ?? [];
  const main = outfits[mainIdx];
  const alternatives = outfits.filter((_, i) => i !== mainIdx);
  const weatherOk = weather?.available === true;
  const isHome = place && me?.grid_nx === place.nx && me?.grid_ny === place.ny;

  return (
    <div className="flex flex-col gap-4 px-[26px] py-[22px]">
      <PageHeader
        title={`오늘의 코디 · ${koreanDate(date)}`}
        sub={place ? `기상청 단기예보 · ${place.name}` : "기상청 단기예보"}
      />

      {result?.notice && <Banner tone="warn">{result.notice.message}</Banner>}
      {error && <ApiErrorBanner code={error.code} message={error.message} onClose={() => setError(null)} />}

      <div className="grid grid-cols-3 gap-4">
        {/* 날씨 */}
        <Card>
          <CardTitle
            right={
              <Button variant="subtle" className="!px-2 !py-0.5 text-xs" onClick={() => setChangingRegion((v) => !v)}>
                {changingRegion ? "닫기" : "지역 변경"}
              </Button>
            }
          >
            날씨 <Badge tone="muted">자동</Badge>
          </CardTitle>
          <div className="grid grid-cols-2 gap-2">
            <Select
              ariaLabel="날짜"
              value={date}
              onChange={(v) => {
                setDate(v);
                setTempBand("");
              }}
              options={Array.from({ length: 5 }, (_, i) => {
                const d = addDays(today, i);
                return { code: d, label: i === 0 ? `오늘 (${koreanDate(d)})` : i === 1 ? `내일 (${koreanDate(d)})` : koreanDate(d) };
              })}
            />
            <Select ariaLabel="시간대" value={time} onChange={(v) => setTime(v as TimeOfDay)} options={TIMES} />
          </div>
          {changingRegion || !place ? (
            <div className="flex flex-col gap-1.5">
              {!place && <p className="text-[13px] text-muted">날씨를 보려면 지역을 정해 주세요.</p>}
              <RegionPicker onSelect={pickRegion} />
            </div>
          ) : weatherLoading && !weather ? (
            <div className="flex items-center gap-2 text-muted">
              <Spinner /> 예보를 가져오는 중
            </div>
          ) : weatherOk && weather.available ? (
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="text-[34px] font-bold leading-none">{Math.round(weather.temp)}°</span>
                <span className="text-[13px] text-muted">
                  {weather.min !== null && `최저 ${Math.round(weather.min)}°`}
                  {weather.max !== null && ` · 최고 ${Math.round(weather.max)}°`}
                </span>
              </div>
              <p className="text-[13px]">
                {weather.sky}
                {weather.pty !== "없음" && ` · ${weather.pty}`} · 강수 {weather.pop}% · 바람 {weather.wind.toFixed(1)}m/s
              </p>
              {weather.stale && <p className="text-xs text-warn">최신 예보를 못 받아서 직전 예보를 보여드려요.</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-semibold">
                예보가 없어요
                <span className="block text-xs font-normal text-muted">
                  {weather?.available === false && weather.reason === "OUT_OF_RANGE"
                    ? "기상청 예보는 오늘 포함 5일까지만 있어요."
                    : "날씨 정보를 가져오지 못했어요."}{" "}
                  기온 구간을 골라 주세요.
                </span>
              </p>
              <div className="flex flex-wrap gap-1">
                {TEMP_BANDS.map((b) => (
                  <Chip
                    key={b.code}
                    on={tempBand === b.code}
                    onClick={() => {
                      setTempBand(tempBand === b.code ? "" : b.code);
                      setDirty(true);
                    }}
                  >
                    {b.label}
                  </Chip>
                ))}
              </div>
            </div>
          )}
          {place && !changingRegion && !isHome && place.code && (
            <Button variant="subtle" className="self-start !px-1 text-xs underline" onClick={saveRegionAsHome} loading={savingRegion}>
              {place.name}을 기본 지역으로 저장
            </Button>
          )}
        </Card>

        {/* 일정 · 상황 */}
        <Card>
          <CardTitle>일정 · 상황</CardTitle>
          <textarea
            aria-label="일정과 상황"
            rows={4}
            className={`${inputCls} resize-none`}
            value={schedule}
            onChange={(e) => {
              setSchedule(e.target.value);
              setDirty(true);
            }}
            placeholder={"예: 14:00 팀 회의, 19:00 친구 저녁"}
          />
          <p className="text-xs text-muted">적어 주시면 일정에 맞는 격식과 분위기로 골라요.</p>
        </Card>

        {/* 오늘의 분위기 */}
        <Card>
          <CardTitle>오늘의 분위기</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {TODAY_MOODS.map((m) => (
              <Chip
                key={m.code}
                on={moods.includes(m.code)}
                onClick={() => {
                  setMoods((v) => toggleIn(v, m.code));
                  setDirty(true);
                }}
              >
                {m.label}
              </Chip>
            ))}
          </div>
          <Button className="mt-auto" variant={dirty ? "primary" : "ghost"} onClick={generate} loading={busy === "generate"} disabled={busy !== null}>
            {dirty ? "이 조건으로 코디 만들기" : "코디 새로 만들기"}
          </Button>
        </Card>
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-4">
        {busy === "generate" && !result ? (
          <>
            <Card>
              <div className="skeleton h-6 w-1/3" />
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton aspect-square" />
                ))}
              </div>
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-4 w-1/2" />
              <p className="flex items-center gap-2 text-[13px] text-muted">
                <Spinner size={14} /> 날씨를 확인하고 옷장에서 코디를 고르는 중이에요
              </p>
            </Card>
            <div className="flex flex-col gap-3">
              <div className="skeleton h-40" />
              <div className="skeleton h-40" />
            </div>
          </>
        ) : !result ? (
          <div className="col-span-2">
            {!error && <EmptyState title="코디를 준비하고 있어요" description="잠시만 기다려 주세요." />}
          </div>
        ) : outfits.length === 0 ? (
          <div className="col-span-2 flex flex-col gap-3">
            <MissingNotice missing={result.missing} count={0} />
            {result.message && <p className="text-[13px] text-muted">{result.message}</p>}
          </div>
        ) : (
          <>
            <Card className="relative">
              {busy && busy !== "generate" && (
                <div className="absolute inset-0 z-10 grid place-items-center rounded-[14px] bg-surface/70">
                  <span className="flex items-center gap-2 text-[13px] text-muted">
                    <Spinner /> 다시 짜는 중이에요
                  </span>
                </div>
              )}
              <CardTitle right={<ScoreText score={main.score} large />}>
                추천 코디
                {me?.default_style && <Badge tone="muted">추구미: {me.default_style.style_name}</Badge>}
                {main.version > 1 && <Badge>v{main.version}</Badge>}
              </CardTitle>
              <OutfitThumbs outfit={main} className="max-w-[560px]" />
              <h2 className="text-[16px] font-semibold">{main.title}</h2>
              <ul className="flex flex-col gap-1 text-[13px]">
                {main.reasons.map((r, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span aria-hidden className="text-accent">
                      ·
                    </span>
                    {r}
                  </li>
                ))}
              </ul>
              <ScoreBreakdown outfit={main} />
              {result.message && <p className="text-[13px] text-muted">{result.message}</p>}
              {outfits.length < 3 && <MissingNotice missing={result.missing} count={outfits.length} />}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted">아쉬운 점:</span>
                  {FEEDBACK_CHIPS.map((c) => (
                    <Chip key={c.code} onClick={busy ? undefined : () => feedback(c.code)}>
                      {c.label}
                    </Chip>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={() => feedback("reroll")} loading={busy === "reroll"} disabled={busy !== null}>
                    다시 짜기
                  </Button>
                  <FavoriteButton outfit={main} onChange={updateOutfit} size="md" />
                </div>
              </div>
            </Card>
            <div className="flex flex-col gap-3">
              {alternatives.length === 0 ? (
                <EmptyState title="대안 코디가 없어요" description="옷을 더 등록하면 대안도 보여드려요." />
              ) : (
                alternatives.map((o, i) => (
                  <div key={o.id} className="flex flex-col gap-1">
                    <OutfitGridCard outfit={o} onChange={updateOutfit} heading={`대안 ${i + 1}`} />
                    <Button variant="subtle" className="self-end !py-1 text-xs" onClick={() => setMainIdx(outfits.indexOf(o))}>
                      이 코디를 메인으로 보기
                    </Button>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
