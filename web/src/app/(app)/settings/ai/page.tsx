"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Banner, Button, Card, CardTitle, ErrorState, LoadingState, PageHeader, Select, TextInput } from "@/components/ui";
import {
  connectAi,
  disconnectAi,
  errorMessage,
  getAiConnections,
  getAiUsage,
  getTaskSettings,
  patchAiConnection,
  putTaskSettings,
} from "@/lib/api";
import { compactNumber, shortDate, usd } from "@/lib/format";
import type { AiConnection, AiConnections, AiUsage, Provider, TaskSetting } from "@/lib/types";

const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic Claude",
  openai: "OpenAI",
};

const FREE_NOTICE = "사용량 제한이 있고, 입력 내용이 Google 제품 개선에 쓰일 수 있어요.";

export default function AiSettingsPage() {
  const [conn, setConn] = useState<AiConnections | null>(null);
  const [tasks, setTasks] = useState<TaskSetting[] | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, t, u] = await Promise.all([getAiConnections(), getTaskSettings(), getAiUsage()]);
      setConn(c);
      setTasks(t.tasks);
      setUsage(u);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="px-[26px] py-[22px]">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }
  if (!conn || !tasks || !usage) return <LoadingState />;

  const connected = new Map(conn.connections.map((c) => [c.provider, c]));
  const unconnected = conn.providers.filter((p) => !connected.has(p));
  const usingByok = tasks.some((t) => t.source === "byok");

  return (
    <div className="flex flex-col gap-4 px-[26px] py-[22px]">
      <PageHeader
        title="AI 연결"
        sub="연결한 키는 암호화해 저장하고 다시 보여주지 않아요"
        right={
          <Link href="/settings" className="text-[13px] text-accent hover:underline">
            ← 설정
          </Link>
        }
      />
      {flash && (
        <Banner tone="good" onClose={() => setFlash(null)}>
          {flash}
        </Banner>
      )}
      {usage.notices.map((n, i) => (
        <Banner key={i} tone="warn">
          {n.message} <span className="text-xs opacity-75">({shortDate(n.at)})</span>
        </Banner>
      ))}

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardTitle right={!usingByok ? <Badge tone="good">사용 중</Badge> : <Badge tone="muted">대기</Badge>}>기본 무료 AI</CardTitle>
          <p className="font-semibold">{conn.free.model_label}</p>
          <p className="text-xs text-muted">FITME가 제공 · 가입하면 바로 사용</p>
          <p className="rounded-[8px] bg-warn-soft px-2.5 py-1.5 text-xs text-warn">{conn.free.notice || FREE_NOTICE}</p>
          <p className="text-xs text-muted">
            오늘 사용: 코디 요청 {usage.free.agent_runs_today}/{usage.free.agent_runs_limit}회 · 옷 태깅 {usage.free.tagging_today}/
            {usage.free.tagging_limit}장
          </p>
        </Card>
        {conn.connections.map((c) => (
          <ConnectedCard key={c.provider} c={c} onChanged={load} onFlash={setFlash} />
        ))}
        {unconnected.map((p) => (
          <ConnectCard key={p} provider={p} onConnected={load} onFlash={setFlash} />
        ))}
      </div>

      <div className="grid grid-cols-[2fr_1fr] gap-4">
        <TaskTable tasks={tasks} onSaved={(t) => setTasks(t)} />
        <UsageCard usage={usage} connections={conn.connections} onChanged={load} />
      </div>
    </div>
  );
}

function ConnectedCard({ c, onChanged, onFlash }: { c: AiConnection; onChanged: () => void; onFlash: (m: string) => void }) {
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await disconnectAi(c.provider);
      onFlash(`${PROVIDER_LABEL[c.provider]} 연결을 해제하고 키를 삭제했어요. 다음 요청부터 기본 무료 AI를 써요.`);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardTitle right={c.status === "active" ? <Badge tone="good">연결됨</Badge> : <Badge tone="danger">키 오류</Badge>}>
        {PROVIDER_LABEL[c.provider]}
      </CardTitle>
      <p className="font-mono text-[13px]">•••• {c.key_last4}</p>
      <p className="text-xs text-muted">
        {c.verified_at ? `${shortDate(c.verified_at)} 연결 · 테스트 호출 통과` : "확인 전"}
        {c.status === "invalid" && " · 키가 실패해 기본 무료 AI로 바꿨어요"}
      </p>
      {error && <Banner tone="danger">{error}</Banner>}
      {replacing ? (
        <KeyForm
          provider={c.provider}
          onDone={(ok) => {
            setReplacing(false);
            if (ok) {
              onFlash(`${PROVIDER_LABEL[c.provider]} 키를 바꿨어요.`);
              onChanged();
            }
          }}
        />
      ) : (
        <div className="mt-auto flex gap-2">
          <Button variant="ghost" onClick={() => setReplacing(true)} disabled={busy}>
            키 바꾸기
          </Button>
          <Button variant="subtle" onClick={disconnect} loading={busy}>
            연결 해제
          </Button>
        </div>
      )}
    </Card>
  );
}

function ConnectCard({ provider, onConnected, onFlash }: { provider: Provider; onConnected: () => void; onFlash: (m: string) => void }) {
  return (
    <Card>
      <CardTitle right={<Badge tone="muted">미연결</Badge>}>{PROVIDER_LABEL[provider]}</CardTitle>
      <KeyForm
        provider={provider}
        onDone={(ok) => {
          if (ok) {
            onFlash(`${PROVIDER_LABEL[provider]}를 연결했어요. 아래에서 작업별 모델을 고를 수 있어요.`);
            onConnected();
          }
        }}
      />
    </Card>
  );
}

/** The key lives only in this input's state until sent once; it is cleared right after. Never stored in the browser. */
function KeyForm({ provider, onDone }: { provider: Provider; onDone: (ok: boolean) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const value = key.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await connectAi(provider, value);
      setKey("");
      onDone(true);
    } catch (e) {
      setKey("");
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      autoComplete="off"
    >
      <TextInput
        type="password"
        name={`fitme-${provider}-key`}
        autoComplete="new-password"
        spellCheck={false}
        aria-label={`${PROVIDER_LABEL[provider]} API 키`}
        placeholder="API 키 붙여넣기"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
      <Button type="submit" variant="ghost" loading={busy} disabled={!key.trim()}>
        연결 확인
      </Button>
      <p className="text-[11px] text-muted">테스트 호출로 확인한 뒤 암호화해 저장해요. 저장 후에는 끝 4자리만 보여요.</p>
    </form>
  );
}

function TaskTable({ tasks, onSaved }: { tasks: TaskSetting[]; onSaved: (t: TaskSetting[]) => void }) {
  const [sel, setSel] = useState<Record<string, string>>(() =>
    Object.fromEntries(tasks.map((t) => [t.task, t.source === "free" ? "free" : `${t.provider}|${t.model}`])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const body = tasks.map((t) => {
        const v = sel[t.task];
        if (v === "free" || !v) return { task: t.task, provider: "free", model: "" };
        const [provider, model] = v.split("|");
        return { task: t.task, provider, model };
      });
      const r = await putTaskSettings(body);
      onSaved(r.tasks);
      setOk(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardTitle>작업별 사용 모델</CardTitle>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-muted">
            <th className="py-1.5 text-left font-medium">작업</th>
            <th className="py-1.5 text-left font-medium">사용 모델</th>
            <th className="py-1.5 text-right font-medium">키</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.task} className="border-b border-line last:border-0">
              <td className="py-2">{t.label}</td>
              <td className="py-2 pr-3">
                <Select
                  ariaLabel={`${t.label} 모델`}
                  value={sel[t.task] ?? "free"}
                  onChange={(v) => {
                    setSel((s) => ({ ...s, [t.task]: v }));
                    setOk(false);
                  }}
                  options={[
                    { code: "free", label: "기본 무료 AI" },
                    ...t.choices.map((c) => ({ code: `${c.provider}|${c.model}`, label: c.label })),
                  ]}
                />
              </td>
              <td className="py-2 text-right">
                {sel[t.task] === "free" ? <Badge tone="muted">기본 무료</Badge> : <Badge>내 키</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tasks.every((t) => t.choices.length === 0) && <p className="text-xs text-muted">키를 연결하면 작업마다 모델을 고를 수 있어요.</p>}
      {error && <Banner tone="danger">{error}</Banner>}
      <div className="flex items-center justify-end gap-2">
        {ok && <span className="text-xs text-good">✓ 저장했어요</span>}
        <Button onClick={save} loading={busy}>
          저장
        </Button>
      </div>
    </Card>
  );
}

function UsageCard({ usage, connections, onChanged }: { usage: AiUsage; connections: AiConnection[]; onChanged: () => void }) {
  return (
    <Card>
      <CardTitle>이번 달 내 키 사용량</CardTitle>
      <p className="text-xs text-muted">{usage.month}</p>
      {connections.length === 0 ? (
        <p className="text-[13px] text-muted">연결한 키가 없어요.</p>
      ) : (
        connections.map((c) => {
          const u = usage.byok.find((b) => b.provider === c.provider);
          return <UsageRow key={c.provider} c={c} u={u} onChanged={onChanged} />;
        })
      )}
    </Card>
  );
}

function UsageRow({ c, u, onChanged }: { c: AiConnection; u: AiUsage["byok"][number] | undefined; onChanged: () => void }) {
  const [limit, setLimit] = useState(c.monthly_limit_usd?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const n = limit.trim() ? Number(limit) : null;
      if (n !== null && (!Number.isFinite(n) || n < 0)) throw new Error("한도는 0 이상의 숫자로 적어 주세요.");
      await patchAiConnection(c.provider, n);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const cost = u?.est_cost_usd ?? 0;
  const pct = c.monthly_limit_usd ? Math.min(100, (cost / c.monthly_limit_usd) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2 first-of-type:border-0 first-of-type:pt-0">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-semibold">{PROVIDER_LABEL[c.provider]}</span>
        <span className="font-mono">약 {usd(cost)}</span>
      </div>
      <p className="text-xs text-muted">
        요청 {u?.requests ?? 0}회 · 입력 {compactNumber(u?.input_tokens ?? 0)} · 출력 {compactNumber(u?.output_tokens ?? 0)} 토큰
      </p>
      {c.monthly_limit_usd !== null && (
        <div className="h-1.5 overflow-hidden rounded bg-line" aria-label={`월 한도 ${Math.round(pct)}% 사용`}>
          <div className="h-full rounded bg-accent" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">월 한도 $</span>
        <TextInput
          type="number"
          min={0}
          step="1"
          className="!w-20"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          aria-label={`${PROVIDER_LABEL[c.provider]} 월 한도 (USD)`}
          placeholder="없음"
        />
        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={save} loading={busy}>
          저장
        </Button>
      </div>
      <p className="text-[11px] text-muted">한도에 닿으면 기본 무료 모델로 자동 전환하고 알려드려요.</p>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
