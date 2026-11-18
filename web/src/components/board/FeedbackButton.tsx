"use client";

// 피드백 버튼: a tab on the right edge of every screen (decision 14). It sits mid-height so it never
// covers the 보내기 / 다음 buttons at the bottom. Opens a panel to write feedback (with a capture of
// the current screen) and to follow your own posts. Marked data-feedback-ui so the capture skips it.

import { Info, MessageSquareText, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { addBoardComment, createBoardPost, errorMessage, getMyBoard, markBoardSeen } from "@/lib/api";
import { cx } from "@/lib/format";
import type { BoardKind, BoardPost } from "@/lib/types";
import { Banner, LoadingState } from "../ui";
import { AttachArea, uploadAttached, useImageAttach } from "./ImageAttach";
import { KIND, deviceLabel, pageLabel, when } from "./meta";
import { BoardImages, KindIcon, SoftButton, StatusChip, StatusSteps, Timeline } from "./parts";

const CAPTURE_LABEL = "지금 화면";

/** Picture of what is on screen now, without the feedback UI. null when the browser can't. */
async function captureScreen(): Promise<Blob | null> {
  try {
    const { toCanvas } = await import("html-to-image");
    const canvas = await toCanvas(document.body, {
      pixelRatio: 1,
      skipFonts: true,
      cacheBust: false,
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
      filter: (node) => !(node instanceof HTMLElement && node.dataset.feedbackUi !== undefined),
    });
    // Pages that scroll the window are captured whole: keep the part that was on screen.
    const h = Math.min(canvas.height, window.innerHeight);
    const top = Math.min(window.scrollY, canvas.height - h);
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = h;
    out.getContext("2d")?.drawImage(canvas, 0, top, canvas.width, h, 0, 0, canvas.width, h);
    return await new Promise((resolve) => out.toBlob(resolve, "image/png"));
  } catch {
    return null;
  }
}

export function FeedbackButton({ where }: { where?: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"write" | "mine">("write");
  const [unread, setUnread] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const clearUnread = useCallback(() => setUnread(0), []);

  const refreshUnread = useCallback(() => {
    getMyBoard()
      .then((r) => setUnread(r.unread))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshUnread();
  }, [refreshUnread]);

  // Escape closes; clicking outside the panel closes too.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-feedback-ui]") && !t.closest("dialog")) setOpen(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("mousedown", down);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("mousedown", down);
    };
  }, [open]);

  const page = where ?? pageLabel(pathname);

  return (
    <>
      <button
        type="button"
        data-feedback-ui
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-2 rounded-l-2xl bg-surface px-2.5 py-4 text-[13px] font-bold text-tx shadow-[0_4px_20px_rgba(0,0,0,0.12)] transition-[padding] hover:pr-3.5"
      >
        <MessageSquareText aria-hidden size={18} strokeWidth={1.75} className="text-st-doing" />
        <span className="[writing-mode:vertical-rl]">피드백</span>
        {unread > 0 && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-st-new px-1 text-[11.5px] tabular-nums text-white" aria-label={`새 답변 ${unread}개`}>
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div
          ref={panel}
          data-feedback-ui
          role="dialog"
          aria-label="피드백"
          className="fixed right-14 top-1/2 z-40 flex max-h-[min(660px,calc(100vh-40px))] w-[384px] max-w-[calc(100vw-72px)] -translate-y-1/2 flex-col overflow-hidden rounded-3xl bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.18)] dark:ring-1 dark:ring-fill-strong"
        >
          <div className="flex gap-1 px-3.5 pt-3.5">
            {(
              [
                ["write", "남기기"],
                ["mine", "내 피드백"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cx("h-10 flex-1 rounded-xl text-[14.5px] font-semibold", tab === k ? "bg-fill text-tx" : "text-tx-3 hover:text-tx-2")}
              >
                {l}
                {k === "mine" && unread > 0 && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-st-new align-middle" />}
              </button>
            ))}
            <button type="button" aria-label="닫기" onClick={() => setOpen(false)} className="grid w-10 place-items-center text-tx-3 hover:text-tx">
              <X aria-hidden size={18} strokeWidth={1.75} />
            </button>
          </div>
          {tab === "write" ? (
            <WriteTab
              page={page}
              onSent={() => {
                setTab("mine");
              }}
            />
          ) : (
            <MineTab onSeen={clearUnread} />
          )}
        </div>
      )}
    </>
  );
}

function WriteTab({ page, onSent }: { page: string; onSent: () => void }) {
  const [kind, setKind] = useState<BoardKind>("bug");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(true);
  const attach = useImageAttach();
  const { add } = attach;

  // Capture the screen behind the panel once, when the panel opens.
  useEffect(() => {
    let alive = true;
    void captureScreen().then((b) => {
      if (alive && b) add([b], CAPTURE_LABEL);
      if (alive) setCapturing(false);
    });
    return () => {
      alive = false;
    };
  }, [add]);

  const send = async () => {
    if (!body.trim()) return setError("무엇이 어땠는지 적어 주세요.");
    setBusy(true);
    setError(null);
    try {
      const image_paths = await uploadAttached(attach.items);
      await createBoardPost({ kind, body: body.trim(), page, device: deviceLabel(), image_paths });
      attach.clear();
      setBody("");
      onSent();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 overflow-y-auto px-[18px] pb-5 pt-4" onPaste={attach.onPaste}>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="종류">
        {(Object.keys(KIND) as BoardKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cx(
              "flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3.5 text-[13px] font-semibold transition-colors",
              kind === k ? "bg-tx text-tx-inverse" : "bg-fill text-tx-2 hover:bg-fill-strong",
            )}
          >
            <KindIcon kind={k} size={22} />
            {KIND[k].ask}
          </button>
        ))}
      </div>
      <textarea
        className="soft-field min-h-[120px] w-full resize-y rounded-[14px] bg-fill px-4 py-3.5 text-[15px] text-tx outline-none placeholder:text-tx-3"
        value={body}
        maxLength={2000}
        onChange={(e) => setBody(e.target.value)}
        placeholder={kind === "bug" ? "무엇을 했을 때 어떻게 됐나요? 짧게 적어도 돼요" : kind === "idea" ? "어떻게 되면 좋을까요?" : "자유롭게 적어 주세요"}
        autoFocus
      />
      <p className="flex gap-1.5 px-0.5 text-[12.5px] leading-relaxed text-tx-3">
        <Info aria-hidden size={14} strokeWidth={1.75} className="mt-[3px] shrink-0" />
        <span>
          <b className="font-semibold text-tx-2">{page}</b> 화면에서 남겨요. 기기 정보와 {capturing ? "지금 화면 캡처(만드는 중…)" : "지금 화면 캡처"}가 함께 가요. 캡처가 싫으면 사진에서 빼 주세요.
        </span>
      </p>
      <AttachArea state={attach} />
      {error && <Banner tone="danger">{error}</Banner>}
      <SoftButton onClick={send} loading={busy} disabled={!body.trim()} className="h-[50px] w-full rounded-[14px] text-[15.5px]">
        보내기
      </SoftButton>
    </div>
  );
}

function MineTab({ onSeen }: { onSeen: () => void }) {
  const [posts, setPosts] = useState<BoardPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await getMyBoard();
      setPosts(r.posts);
      setOpenId((cur) => cur ?? r.posts.find((p) => p.unread)?.id ?? r.posts[0]?.id ?? null);
      if (r.unread) {
        await markBoardSeen();
        onSeen();
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [onSeen]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load();
  }, [load]);

  if (error) return <Banner tone="danger">{error}</Banner>;
  if (!posts) return <LoadingState />;
  if (!posts.length) return <p className="p-8 text-center text-sm text-tx-3">아직 남긴 피드백이 없어요.</p>;
  return (
    <ul className="flex flex-col gap-2 overflow-y-auto px-3.5 pb-4 pt-3">
      {posts.map((p) => (
        <li key={p.id} className={cx("rounded-[18px] p-4", p.unread ? "bg-st-doing-soft" : "bg-fill-weak")}>
          <button type="button" className="flex w-full items-start justify-between gap-2.5 text-left" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
            <span className="text-[15px] font-bold tracking-[-0.01em] text-tx">
              {p.unread && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-st-new align-middle" aria-label="새 소식" />}
              {p.title}
            </span>
            <StatusChip status={p.status} />
          </button>
          <div className="mt-3">
            <StatusSteps status={p.status} />
          </div>
          {openId === p.id && <MineDetail post={p} onAdded={load} />}
          {openId !== p.id && (
            <p className="mt-2 text-[12.5px] text-tx-3">
              {when(p.created_at)} · {p.page}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function MineDetail({ post, onAdded }: { post: BoardPost; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attach = useImageAttach();
  const send = async () => {
    if (!text.trim() && !attach.items.length) return;
    setBusy(true);
    setError(null);
    try {
      await addBoardComment(post.id, { body: text.trim(), image_paths: await uploadAttached(attach.items) });
      setText("");
      attach.clear();
      onAdded();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 flex flex-col gap-3" onPaste={attach.onPaste}>
      {post.body.trim() !== post.title && <p className="whitespace-pre-wrap text-sm text-tx-2">{post.body}</p>}
      <BoardImages images={post.images} size={56} />
      <p className="text-[12.5px] text-tx-3">
        {when(post.created_at)} · {post.page} · #{post.id}
      </p>
      <Timeline comments={post.comments} authorName="나" onWhite />
      <div className="flex flex-col gap-2">
        <textarea
          className="soft-field min-h-[56px] w-full resize-y rounded-xl bg-surface px-3.5 py-3 text-sm text-tx outline-none placeholder:text-tx-3"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          placeholder="덧붙일 내용이나 사진 (예: 다시 해 보니 또 그래요)"
        />
        <AttachArea state={attach} tone="white" />
        {error && <Banner tone="danger">{error}</Banner>}
        <SoftButton tone="light" onClick={send} loading={busy} disabled={!text.trim() && !attach.items.length} className="h-[42px] w-full">
          덧붙이기
        </SoftButton>
      </div>
    </div>
  );
}
