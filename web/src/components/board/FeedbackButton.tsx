"use client";

// 피드백 버튼: a tab on the right edge of every screen (decision 14). It sits mid-height so it never
// covers the 보내기 / 다음 buttons at the bottom. Opens a panel to write feedback (with a capture of
// the current screen) and to follow your own posts. Marked data-feedback-ui so the capture skips it.

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { addBoardComment, createBoardPost, errorMessage, getMyBoard, markBoardSeen } from "@/lib/api";
import { cx } from "@/lib/format";
import type { BoardKind, BoardPost } from "@/lib/types";
import { Banner, Button, LoadingState } from "../ui";
import { AttachArea, uploadAttached, useImageAttach } from "./ImageAttach";
import { KIND, deviceLabel, pageLabel, when } from "./meta";
import { BoardImages, StatusChip, StatusSteps, Timeline } from "./parts";

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
        className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-l-[12px] bg-accent px-2 py-3 text-[13px] font-semibold text-accent-ink shadow-lg [writing-mode:vertical-rl] hover:pr-3"
      >
        💬 피드백
        {unread > 0 && (
          <span className="grid h-5 w-5 place-items-center rounded-full bg-good font-mono text-[11px] text-white [writing-mode:horizontal-tb]" aria-label={`새 답변 ${unread}개`}>
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
          className="fixed right-12 top-1/2 z-40 flex max-h-[min(640px,calc(100vh-48px))] w-[380px] -translate-y-1/2 flex-col overflow-hidden rounded-[16px] border border-line bg-surface shadow-2xl"
        >
          <div className="flex border-b border-line">
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
                className={cx("flex-1 border-b-2 py-2.5 text-[13.5px] font-semibold", tab === k ? "border-accent text-accent" : "border-transparent text-muted")}
              >
                {l}
                {k === "mine" && unread > 0 && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-good align-middle" />}
              </button>
            ))}
            <button type="button" aria-label="닫기" onClick={() => setOpen(false)} className="px-3 text-lg text-muted">
              ×
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
    <div className="flex flex-col gap-3 overflow-y-auto p-4" onPaste={attach.onPaste}>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="종류">
        {(Object.keys(KIND) as BoardKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={cx(
              "flex flex-col items-center gap-0.5 rounded-[12px] border-[1.5px] px-1 py-2 text-[12.5px]",
              kind === k ? "border-accent bg-accent-soft font-semibold text-accent" : "border-line",
            )}
          >
            <span className="text-[20px]">{KIND[k].icon}</span>
            {KIND[k].ask}
          </button>
        ))}
      </div>
      <textarea
        className="min-h-[96px] w-full resize-y rounded-[10px] border border-line-strong bg-surface px-3 py-2 text-[13.5px]"
        value={body}
        maxLength={2000}
        onChange={(e) => setBody(e.target.value)}
        placeholder={kind === "bug" ? "무엇을 했을 때 어떻게 됐나요? 짧게 적어도 돼요" : kind === "idea" ? "어떻게 되면 좋을까요?" : "자유롭게 적어 주세요"}
        autoFocus
      />
      <p className="rounded-[10px] bg-app px-3 py-2 text-xs text-muted">
        <span className="font-semibold text-ink">{page}</span> 화면에서 남겨요. 기기 정보와 {capturing ? "지금 화면 캡처(만드는 중…)" : "지금 화면 캡처"}가 함께 가요. 캡처가 싫으면 사진에서 빼 주세요.
      </p>
      <AttachArea state={attach} compact />
      {error && <Banner tone="danger">{error}</Banner>}
      <Button onClick={send} loading={busy} disabled={!body.trim()}>
        보내기
      </Button>
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
  if (!posts.length) return <p className="p-6 text-center text-[13px] text-muted">아직 남긴 피드백이 없어요.</p>;
  return (
    <ul className="flex flex-col gap-2 overflow-y-auto p-3">
      {posts.map((p) => (
        <li key={p.id} className={cx("rounded-[12px] border p-3", p.unread ? "border-good" : "border-line")}>
          <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
            <span className="text-[13.5px] font-semibold">
              {p.unread && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-good align-middle" aria-label="새 소식" />}
              {p.title}
            </span>
            <StatusChip status={p.status} />
          </button>
          <div className="mt-2">
            <StatusSteps status={p.status} />
          </div>
          {openId === p.id && <MineDetail post={p} onAdded={load} />}
          {openId !== p.id && <p className="mt-1.5 text-[11.5px] text-muted">{when(p.created_at)} · {p.page}</p>}
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
      {post.body.trim() !== post.title && <p className="whitespace-pre-wrap text-[13px]">{post.body}</p>}
      <BoardImages images={post.images} size={56} />
      <p className="text-[11.5px] text-muted">
        {when(post.created_at)} · {post.page} · #{post.id}
      </p>
      <Timeline comments={post.comments} authorName="나" />
      <div className="flex flex-col gap-2 border-t border-dashed border-line pt-3">
        <textarea
          className="min-h-[56px] w-full resize-y rounded-[10px] border border-line-strong bg-surface px-3 py-2 text-[13px]"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          placeholder="덧붙일 내용이나 사진 (예: 다시 해 보니 또 그래요)"
        />
        <AttachArea state={attach} compact />
        {error && <Banner tone="danger">{error}</Banner>}
        <Button variant="subtle" onClick={send} loading={busy} disabled={!text.trim() && !attach.items.length}>
          덧붙이기
        </Button>
      </div>
    </div>
  );
}
