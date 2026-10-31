"use client";

import { Banner, Button, Spinner } from "../ui";
import { TagForm } from "./TagForm";
import type { UploadQueue } from "./useUploadQueue";

/** Right-side "새 옷 태그 확인 n / N" panel (spec 6.3 ③). */
export function TagReviewPanel({ queue, onClose }: { queue: UploadQueue; onClose?: () => void }) {
  const { current, position, total, notice } = queue;

  if (!current) {
    return (
      <aside className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[13.5px] font-semibold">새 옷 태그 확인</h2>
          <span className="font-mono text-xs text-muted">
            {total} / {total}
          </span>
        </div>
        <p className="text-[13px] text-good">✓ 올린 옷을 모두 확인했어요.</p>
        {onClose && (
          <Button
            variant="ghost"
            onClick={() => {
              queue.clearDone();
              onClose();
            }}
          >
            닫기
          </Button>
        )}
      </aside>
    );
  }

  const busy = current.status === "waiting" || current.status === "processing";
  return (
    <aside aria-label="새 옷 태그 확인" className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[13.5px] font-semibold">새 옷 태그 확인</h2>
        <span className="font-mono text-xs text-muted">
          {position} / {total}
        </span>
      </div>
      {notice && <Banner>{notice}</Banner>}
      <div className="relative aspect-square overflow-hidden rounded-[12px] bg-tile">
        {/* Local preview (object URL) of the photo being reviewed. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.previewUrl} alt="올린 옷 사진" className="h-full w-full object-cover" />
        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-surface/70 text-[13px] text-muted">
            <span className="flex items-center gap-2">
              <Spinner /> {current.status === "waiting" ? "대기 중" : "AI가 태그를 보고 있어요"}
            </span>
          </div>
        )}
      </div>

      {current.status === "upload_failed" ? (
        <>
          <Banner tone="danger">{current.error}</Banner>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => queue.skip(current.id)}>
              건너뛰기
            </Button>
            <Button onClick={() => queue.retryUpload(current.id)}>다시 올리기</Button>
          </div>
        </>
      ) : busy ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-7" />
          ))}
        </div>
      ) : (
        <>
          {current.taggingError && <Banner>{current.taggingError}</Banner>}
          {!current.taggingError && Object.values(current.confidence).some((v) => v < 0.6) && (
            <p className="text-xs text-warn">주황 테두리(확인 필요) 항목을 먼저 확인해 주세요.</p>
          )}
          <TagForm
            value={current.draft}
            onChange={(d) => queue.setDraft(current.id, d)}
            confidence={current.taggingError ? undefined : current.confidence}
          />
          {current.error && <Banner tone="danger">{current.error}</Banner>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => queue.skip(current.id)} disabled={current.status === "saving"}>
              건너뛰기
            </Button>
            <Button onClick={() => void queue.save(current.id)} loading={current.status === "saving"}>
              확인하고 저장
            </Button>
          </div>
        </>
      )}
    </aside>
  );
}
