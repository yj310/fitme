"use client";

// Shared pieces of 피드백 게시판 in the soft style (decision 15): grey fills instead of borders,
// tinted status chips, line icons instead of emoji.

import { Bug, Lightbulb, MessageSquare, type LucideProps } from "lucide-react";
import { useState } from "react";
import { cx } from "@/lib/format";
import type { BoardComment, BoardImage, BoardKind, BoardStatus } from "@/lib/types";
import { Modal, Spinner } from "../ui";
import { KIND, STATUS, when } from "./meta";

const KIND_ICON: Record<BoardKind, React.ComponentType<LucideProps>> = { bug: Bug, idea: Lightbulb, etc: MessageSquare };

export function KindIcon({ kind, size = 14, className }: { kind: BoardKind; size?: number; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon aria-hidden size={size} strokeWidth={1.75} className={cx("shrink-0", className)} />;
}

export function StatusChip({ status, small, className }: { status: BoardStatus; small?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center whitespace-nowrap rounded-lg font-bold",
        small ? "h-[22px] px-2 text-xs" : "h-[26px] px-2.5 text-[12.5px]",
        STATUS[status].chip,
        className,
      )}
    >
      {STATUS[status].label}
    </span>
  );
}

export function KindChip({ kind }: { kind: BoardKind }) {
  return (
    <span className="inline-flex h-[26px] items-center gap-1 whitespace-nowrap rounded-lg bg-fill px-2.5 text-[12.5px] font-semibold text-tx-2">
      <KindIcon kind={kind} />
      {KIND[kind].label}
    </span>
  );
}

/** 접수 → 해결 중 → 해결됨 progress bar for the author. */
export function StatusSteps({ status }: { status: BoardStatus }) {
  if (status === "hold") return <p className="text-[12.5px] text-tx-3">지금은 보류 중이에요. 관리자 답변을 확인해 주세요.</p>;
  const i = ["new", "doing", "done"].indexOf(status);
  const color = STATUS[status];
  const label = (n: number, text: string) => (
    <span className={cx(i === n ? color.text : i > n ? "text-tx-2" : "text-tx-3")}>{text}</span>
  );
  const bar = (on: boolean) => <span className={cx("h-1 flex-1 rounded-full", on ? color.bar : "bg-fill-strong")} />;
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold" aria-label={`진행 상황: ${color.label}`}>
      {label(0, "접수")}
      {bar(i >= 1)}
      {label(1, "해결 중")}
      {bar(i >= 2)}
      {label(2, "해결됨")}
    </div>
  );
}

/** Thumbnails that open full size. */
export function BoardImages({ images, size = 64 }: { images: BoardImage[]; size?: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = images.filter((i) => i.url);
  if (!shown.length) return null;
  return (
    <>
      <ul className="flex flex-wrap gap-2">
        {shown.map((im) => (
          <li key={im.path}>
            <button
              type="button"
              onClick={() => setOpen(im.url)}
              className={cx("block cursor-zoom-in overflow-hidden bg-fill", size >= 120 ? "rounded-xl" : "rounded-lg")}
              style={{ width: size, height: size }}
              aria-label="사진 크게 보기"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
              <img src={im.url!} alt="" className="h-full w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      <Modal open={open !== null} title="사진" onClose={() => setOpen(null)} width={960}>
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
        {open && <img src={open} alt="" className="mx-auto max-h-[75vh] w-auto rounded-xl" />}
      </Modal>
    </>
  );
}

/**
 * Replies and status changes, oldest first. `authorName` labels the author's own comments.
 * `onWhite` is for timelines drawn on a grey card, where bubbles need a white fill.
 */
export function Timeline({ comments, authorName, onWhite }: { comments: BoardComment[]; authorName: string; onWhite?: boolean }) {
  if (!comments.length) return null;
  return (
    <ol className="flex flex-col gap-3.5">
      {comments.map((c) => (
        <li key={c.id} className="text-sm">
          <span className="text-[13px] text-tx-3">
            <b className="font-bold text-tx">{c.is_admin ? "FITME" : authorName}</b> · {when(c.created_at)}
          </span>
          {c.kind === "status" && c.status ? (
            <span className="ml-2 inline-flex items-center gap-1 text-[13.5px] text-tx-2">
              상태를 <StatusChip status={c.status} small />
              (으)로 바꿨어요.
            </span>
          ) : (
            <div
              className={cx(
                "mt-1.5 flex w-fit max-w-full flex-col gap-2 rounded-[4px_16px_16px_16px] px-4 py-3 text-[14.5px] text-tx",
                c.is_admin ? "bg-st-doing-soft" : onWhite ? "bg-surface" : "bg-fill",
              )}
            >
              {c.body && <p className="whitespace-pre-wrap">{c.body}</p>}
              <BoardImages images={c.images} size={72} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Soft style button: dark fill, or white for use on a grey card. */
export function SoftButton({
  tone = "dark",
  loading,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "dark" | "light"; loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-[18px] text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40",
        tone === "dark" ? "h-10 bg-tx text-tx-inverse hover:opacity-90" : "h-10 bg-surface text-tx hover:bg-fill-strong",
        className,
      )}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}
