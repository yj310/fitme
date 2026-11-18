"use client";

import { useState } from "react";
import { cx } from "@/lib/format";
import type { BoardComment, BoardImage, BoardKind, BoardStatus } from "@/lib/types";
import { Modal } from "../ui";
import { KIND, STATUS, when } from "./meta";

export function StatusChip({ status, className }: { status: BoardStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-px text-xs font-semibold", s.chip, className)}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

export function KindChip({ kind }: { kind: BoardKind }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line-strong px-2 py-px text-xs text-muted">
      {KIND[kind].icon} {KIND[kind].label}
    </span>
  );
}

/** 접수 → 해결 중 → 해결됨 progress bar for the author. */
export function StatusSteps({ status }: { status: BoardStatus }) {
  if (status === "hold") return <p className="text-xs text-muted">지금은 보류 중이에요. 관리자 답변을 확인해 주세요.</p>;
  const i = ["new", "doing", "done"].indexOf(status);
  const bar = (on: boolean) => <span className={cx("h-[3px] flex-1 rounded-full", on ? (status === "done" ? "bg-good" : "bg-accent") : "bg-line")} />;
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted" aria-label={`진행 상황: ${STATUS[status].label}`}>
      <span className={cx(i === 0 && "font-semibold text-warn")}>접수</span>
      {bar(i >= 1)}
      <span className={cx(i === 1 && "font-semibold text-accent")}>해결 중</span>
      {bar(i >= 2)}
      <span className={cx(i === 2 && "font-semibold text-good")}>해결됨</span>
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
              className="block cursor-zoom-in overflow-hidden rounded-[8px] border border-line bg-tile"
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
        {open && <img src={open} alt="" className="mx-auto max-h-[75vh] w-auto rounded-[8px]" />}
      </Modal>
    </>
  );
}

/** Replies and status changes, oldest first. `authorName` labels the author's own comments. */
export function Timeline({ comments, authorName }: { comments: BoardComment[]; authorName: string }) {
  if (!comments.length) return null;
  return (
    <ol className="ml-1.5 flex flex-col gap-3 border-l-2 border-line pl-4">
      {comments.map((c) => (
        <li key={c.id} className="relative text-[13px]">
          <span aria-hidden className={cx("absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface", c.is_admin ? "bg-accent" : "bg-line-strong")} />
          <span className="font-semibold">{c.is_admin ? "FITME" : authorName}</span> <span className="text-muted">· {when(c.created_at)}</span>
          {c.kind === "status" && c.status ? (
            <div className="text-muted">
              상태를 <StatusChip status={c.status} className="mx-0.5" />(으)로 바꿨어요.
            </div>
          ) : (
            <div className={cx("mt-1 flex flex-col gap-2 rounded-[10px] px-3 py-2", c.is_admin ? "bg-accent-soft" : "border border-line bg-app")}>
              {c.body && <p className="whitespace-pre-wrap">{c.body}</p>}
              <BoardImages images={c.images} size={72} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
