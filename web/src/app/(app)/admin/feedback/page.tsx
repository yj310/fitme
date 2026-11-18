"use client";

// 피드백 관리 (decision 14): list on the left, the selected post on the right.
// Keys: J/K move, 1–4 set the status. Only for admins (the API checks too).

import { useCallback, useEffect, useMemo, useState } from "react";
import { AttachArea, uploadAttached, useImageAttach } from "@/components/board/ImageAttach";
import { KIND, STATUS, STATUS_ORDER, when } from "@/components/board/meta";
import { BoardImages, KindChip, StatusChip, Timeline } from "@/components/board/parts";
import { useAuth } from "@/components/providers/AuthProvider";
import { Banner, Button, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { adminListBoard, adminReplyBoard, adminSetBoardStatus, errorMessage } from "@/lib/api";
import { cx } from "@/lib/format";
import type { BoardPost, BoardStatus } from "@/lib/types";

type Tab = BoardStatus | "all";
const TABS: [Tab, string][] = [["all", "전체"], ...STATUS_ORDER.map((s) => [s, STATUS[s].label] as [Tab, string])];
const QUICK = ["확인했어요. 고쳐 볼게요!", "고쳤어요. 새로고침한 뒤 다시 확인해 주세요.", "재현이 안 돼요. 어떤 순서로 하셨는지 알려 주실래요?"];

export default function AdminFeedbackPage() {
  const { me } = useAuth();
  if (!me) return <LoadingState />;
  if (!me.is_admin) {
    return (
      <div className="px-[26px] py-[22px]">
        <EmptyState title="관리자만 볼 수 있어요" description="피드백은 화면 오른쪽의 '피드백' 버튼으로 남길 수 있어요." />
      </div>
    );
  }
  return <Board />;
}

function Board() {
  const [posts, setPosts] = useState<BoardPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("new");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  // A post whose status was just changed stays in the list (and selected) until the tab changes,
  // so the admin can still reply to it.
  const [pinned, setPinned] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPosts((await adminListBoard()).posts);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: posts?.length ?? 0, new: 0, doing: 0, done: 0, hold: 0 };
    posts?.forEach((p) => c[p.status]++);
    return c;
  }, [posts]);

  const visible = useMemo(() => {
    const needle = q.trim();
    return (posts ?? []).filter(
      (p) => (tab === "all" || p.status === tab || p.id === pinned) && (!needle || `${p.body} ${p.author ?? ""} ${p.page ?? ""} #${p.id}`.includes(needle)),
    );
  }, [posts, tab, q, pinned]);

  const current = visible.find((p) => p.id === sel) ?? visible[0] ?? null;

  const replace = (p: BoardPost) => setPosts((cur) => cur?.map((x) => (x.id === p.id ? p : x)) ?? null);

  const setStatus = useCallback(
    async (p: BoardPost, s: BoardStatus) => {
      if (p.status === s) return;
      try {
        const updated = await adminSetBoardStatus(p.id, s);
        setSel(p.id);
        setPinned(p.id);
        setPosts((cur) => cur?.map((x) => (x.id === p.id ? updated : x)) ?? null);
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [],
  );

  // J/K: next/previous · 1–4: status
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      const i = current ? visible.findIndex((p) => p.id === current.id) : -1;
      if (e.key === "j" && visible[i + 1]) setSel(visible[i + 1].id);
      else if (e.key === "k" && visible[i - 1]) setSel(visible[i - 1].id);
      else if (current && /^[1-4]$/.test(e.key)) void setStatus(current, STATUS_ORDER[Number(e.key) - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, current, setStatus]);

  if (error && !posts) return <ErrorState message={error} onRetry={load} />;
  if (!posts) return <LoadingState />;

  return (
    <div className="grid h-full grid-cols-[400px_minmax(0,1fr)]">
      <section className="flex min-h-0 flex-col border-r border-line bg-surface">
        <div className="flex flex-col gap-2.5 border-b border-line px-4 pb-2.5 pt-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-bold">피드백 관리</h1>
            <Button variant="subtle" className="!px-2 !py-0.5 text-xs" onClick={load}>
              새로고침
            </Button>
          </div>
          <input
            className="w-full rounded-[10px] border border-line-strong bg-surface px-3 py-1.5 text-[13px]"
            placeholder="내용 · 남긴 사람 · 화면 · #번호 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="flex gap-0.5" role="tablist">
            {TABS.map(([k, l]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => {
                  setTab(k);
                  setPinned(null);
                }}
                className={cx("whitespace-nowrap rounded-lg px-2.5 py-1 text-[13px]", tab === k ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-tile")}
              >
                {l}
                <span className="ml-1 font-mono text-[11.5px]">{counts[k]}</span>
              </button>
            ))}
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {visible.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setSel(p.id)}
                className={cx(
                  "grid w-full grid-cols-[14px_minmax(0,1fr)_auto] gap-2.5 border-b border-l-[3px] border-b-line px-4 py-2.5 text-left",
                  current?.id === p.id ? "border-l-accent bg-accent-soft" : "border-l-transparent hover:bg-app",
                )}
              >
                <span aria-hidden className={cx("mt-1.5 h-2.5 w-2.5 rounded-full", STATUS[p.status].dot)} />
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold">{p.title}</span>
                  <span className="block truncate text-xs text-muted">
                    {KIND[p.kind].icon} {KIND[p.kind].label} · {p.author} · {p.page ?? "—"}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1 text-xs text-muted">
                  <span>{when(p.created_at)}</span>
                  <span>
                    {p.images.length > 0 && `🖼 ${p.images.length}`} {p.comments.filter((c) => c.kind === "comment").length > 0 && `💬 ${p.comments.filter((c) => c.kind === "comment").length}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {!visible.length && <p className="p-5 text-[13px] text-muted">{posts.length ? "이 상태의 피드백이 없어요." : "아직 들어온 피드백이 없어요."}</p>}
        </ul>
      </section>
      <section className="min-h-0 overflow-y-auto px-7 py-5">
        {error && <Banner tone="danger">{error}</Banner>}
        {current ? <Detail key={current.id} post={current} onStatus={(s) => setStatus(current, s)} onReplied={replace} /> : <p className="text-muted">왼쪽에서 피드백을 골라 주세요.</p>}
      </section>
    </div>
  );
}

function Detail({ post, onStatus, onReplied }: { post: BoardPost; onStatus: (s: BoardStatus) => void; onReplied: (p: BoardPost) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attach = useImageAttach();

  const send = async () => {
    if (!text.trim() && !attach.items.length) return;
    setBusy(true);
    setError(null);
    try {
      onReplied(await adminReplyBoard(post.id, { body: text.trim(), image_paths: await uploadAttached(attach.items) }));
      setText("");
      attach.clear();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex max-w-[860px] flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <KindChip kind={post.kind} />
            <StatusChip status={post.status} />
            <span className="font-mono text-xs text-muted">#{post.id}</span>
          </div>
          <h2 className="text-xl font-bold">{post.title}</h2>
        </div>
        <span className="flex shrink-0 gap-2 text-xs text-muted">
          <span>
            <Kbd>J</Kbd>/<Kbd>K</Kbd> 이동
          </span>
          <span>
            <Kbd>1</Kbd>–<Kbd>4</Kbd> 상태
          </span>
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="상태 바꾸기">
        {STATUS_ORDER.map((s, i) => (
          <button
            key={s}
            type="button"
            aria-pressed={post.status === s}
            onClick={() => onStatus(s)}
            className={cx(
              "rounded-full border px-3 py-1 text-[13px]",
              post.status === s ? cx(STATUS[s].chip, "border-current font-semibold") : "border-line-strong bg-surface hover:border-accent",
            )}
          >
            <span className="mr-1 font-mono text-[11px] opacity-60">{i + 1}</span>
            {STATUS[s].label}
          </button>
        ))}
      </div>
      <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-muted">남긴 사람</dt>
        <dd>
          {post.author} <span className="text-muted">· {new Date(post.created_at).toLocaleString("ko-KR")}</span>
        </dd>
        <dt className="text-muted">화면</dt>
        <dd>{post.page ?? "—"}</dd>
        <dt className="text-muted">기기</dt>
        <dd>{post.device ?? "—"}</dd>
      </dl>
      <p className="whitespace-pre-wrap rounded-[12px] border border-line bg-surface px-4 py-3 text-[14px]">{post.body}</p>
      <BoardImages images={post.images} size={180} />
      <Timeline comments={post.comments} authorName={post.author ?? "사용자"} />
      <div className="flex flex-col gap-2 rounded-[12px] border border-line-strong bg-surface p-3" onPaste={attach.onPaste}>
        <textarea
          className="min-h-[72px] w-full resize-y bg-transparent text-[13.5px] outline-none"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          placeholder="답변 남기기 — 남긴 사람의 피드백 버튼에 새 소식으로 표시돼요"
        />
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((t) => (
            <button key={t} type="button" onClick={() => setText(t)} className="rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-xs text-muted hover:text-ink">
              {t.split(".")[0]}
            </button>
          ))}
        </div>
        <AttachArea state={attach} compact />
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex justify-end">
          <Button onClick={send} loading={busy} disabled={!text.trim() && !attach.items.length}>
            답변 보내기
          </Button>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-b-2 border-line-strong bg-surface px-1 font-mono text-[11px]">{children}</kbd>;
}
