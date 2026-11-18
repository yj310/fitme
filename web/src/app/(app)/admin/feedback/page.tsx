"use client";

// 피드백 관리 (decision 14): list on the left, the selected post on the right.
// Keys: J/K move, 1–4 set the status. Only for admins (the API checks too).

import { Image as ImageIcon, MessageCircle, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AttachArea, uploadAttached, useImageAttach } from "@/components/board/ImageAttach";
import { KIND, STATUS, STATUS_ORDER, when } from "@/components/board/meta";
import { BoardImages, KindChip, KindIcon, SoftButton, StatusChip, Timeline } from "@/components/board/parts";
import { useAuth } from "@/components/providers/AuthProvider";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/ui";
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
    <div className="grid h-full grid-cols-[400px_minmax(0,1fr)] gap-3 bg-fill p-3">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-[20px] bg-surface">
        <div className="flex flex-col gap-3.5 px-[18px] pb-2.5 pt-[22px]">
          <div className="flex items-center justify-between px-1">
            <h1 className="text-[22px] font-bold tracking-[-0.03em] text-tx">피드백 관리</h1>
            <button type="button" onClick={load} className="h-8 rounded-[10px] bg-fill px-3 text-[13px] font-semibold text-tx-2 hover:bg-fill-strong">
              새로고침
            </button>
          </div>
          <label className="soft-within flex h-11 items-center gap-2 rounded-xl bg-fill px-3.5 text-tx-3">
            <Search aria-hidden size={16} strokeWidth={1.75} />
            <input
              className="w-full bg-transparent text-[14.5px] text-tx outline-none placeholder:text-tx-3"
              placeholder="내용 · 남긴 사람 · 화면 · #번호 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div className="flex gap-1 overflow-x-auto" role="tablist">
            {TABS.map(([k, l]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => {
                  setTab(k);
                  setPinned(null);
                }}
                className={cx(
                  "h-[34px] shrink-0 whitespace-nowrap rounded-full px-3 text-[13.5px] font-semibold",
                  tab === k ? "bg-tx text-tx-inverse" : "text-tx-2 hover:bg-fill",
                )}
              >
                {l}
                <span className="ml-1 tabular-nums opacity-60">{counts[k]}</span>
              </button>
            ))}
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2.5 pt-1">
          {visible.map((p) => {
            const replies = p.comments.filter((c) => c.kind === "comment").length;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSel(p.id)}
                  className={cx(
                    "grid w-full grid-cols-[8px_minmax(0,1fr)_auto] gap-3 rounded-[14px] px-3 py-3.5 text-left",
                    current?.id === p.id ? "bg-fill" : "hover:bg-fill-weak",
                  )}
                >
                  <span aria-hidden className={cx("mt-2 h-1.5 w-1.5 rounded-full", STATUS[p.status].dot)} />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold tracking-[-0.01em] text-tx">{p.title}</span>
                    <span className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-tx-3">
                      <KindIcon kind={p.kind} size={13} />
                      {KIND[p.kind].label} · {p.author} · {p.page ?? "—"}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1 text-[12.5px] tabular-nums text-tx-3">
                    <span>{when(p.created_at)}</span>
                    <span className="flex gap-2">
                      {p.images.length > 0 && (
                        <span className="inline-flex items-center gap-0.5" aria-label={`사진 ${p.images.length}장`}>
                          <ImageIcon aria-hidden size={13} strokeWidth={1.75} />
                          {p.images.length}
                        </span>
                      )}
                      {replies > 0 && (
                        <span className="inline-flex items-center gap-0.5" aria-label={`답변 ${replies}개`}>
                          <MessageCircle aria-hidden size={13} strokeWidth={1.75} />
                          {replies}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {!visible.length && <p className="p-5 text-sm text-tx-3">{posts.length ? "이 상태의 피드백이 없어요." : "아직 들어온 피드백이 없어요."}</p>}
        </ul>
      </section>
      <section className="min-h-0 overflow-y-auto rounded-[20px] bg-surface">
        <div className="max-w-[800px] px-9 pb-10 pt-[30px]">
          {error && <Banner tone="danger">{error}</Banner>}
          {current ? (
            <Detail key={current.id} post={current} onStatus={(s) => setStatus(current, s)} onReplied={replace} />
          ) : (
            <p className="text-tx-3">왼쪽에서 피드백을 골라 주세요.</p>
          )}
        </div>
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
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5">
            <KindChip kind={post.kind} />
            <StatusChip status={post.status} />
            <span className="ml-0.5 text-[13px] tabular-nums text-tx-3">#{post.id}</span>
          </div>
          <h2 className="text-[26px] font-bold leading-[1.35] tracking-[-0.03em] text-tx">{post.title}</h2>
        </div>
        <span className="flex shrink-0 gap-2.5 text-xs text-tx-3">
          <span>
            <Kbd>J</Kbd>/<Kbd>K</Kbd> 이동
          </span>
          <span>
            <Kbd>1</Kbd>–<Kbd>4</Kbd> 상태
          </span>
        </span>
      </div>
      <div className="grid max-w-[520px] grid-cols-4 gap-1 rounded-[14px] bg-fill p-1" role="group" aria-label="상태 바꾸기">
        {STATUS_ORDER.map((s, i) => (
          <button
            key={s}
            type="button"
            aria-pressed={post.status === s}
            aria-keyshortcuts={String(i + 1)}
            onClick={() => onStatus(s)}
            className={cx(
              "h-10 rounded-[10px] text-sm font-semibold transition-colors",
              post.status === s ? cx("bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.08)]", STATUS[s].text) : "text-tx-2 hover:text-tx",
            )}
          >
            {STATUS[s].label}
          </button>
        ))}
      </div>
      <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-tx-3">남긴 사람</dt>
        <dd className="text-tx-2">
          {post.author} <span className="text-tx-3">· {new Date(post.created_at).toLocaleString("ko-KR")}</span>
        </dd>
        <dt className="text-tx-3">화면</dt>
        <dd className="text-tx-2">{post.page ?? "—"}</dd>
        <dt className="text-tx-3">기기</dt>
        <dd className="text-tx-2">{post.device ?? "—"}</dd>
      </dl>
      <p className="whitespace-pre-wrap rounded-2xl bg-fill-weak px-5 py-[18px] text-[15.5px] leading-[1.7] text-tx">{post.body}</p>
      <BoardImages images={post.images} size={180} />
      <Timeline comments={post.comments} authorName={post.author ?? "사용자"} />
      <div className="flex flex-col gap-2.5 rounded-[18px] bg-fill p-3.5" onPaste={attach.onPaste}>
        <textarea
          className="soft-field min-h-[72px] w-full resize-y rounded-xl bg-surface px-3.5 py-3 text-[15px] text-tx outline-none placeholder:text-tx-3"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          placeholder="답변 남기기 — 남긴 사람의 피드백 버튼에 새 소식으로 표시돼요"
        />
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setText(t)}
              className="h-[30px] rounded-full bg-surface px-3 text-[13px] font-semibold text-tx-2 hover:text-tx"
            >
              {t.split(".")[0]}
            </button>
          ))}
        </div>
        <AttachArea state={attach} tone="white" />
        {error && <Banner tone="danger">{error}</Banner>}
        <div className="flex justify-end">
          <SoftButton onClick={send} loading={busy} disabled={!text.trim() && !attach.items.length}>
            답변 보내기
          </SoftButton>
        </div>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded bg-fill px-[5px] py-px font-mono text-[11px] text-tx-2">{children}</kbd>;
}
