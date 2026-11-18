"use client";

// Pictures for 피드백 게시판: click to pick, drag & drop, or paste a screenshot (⌘/Ctrl+V).
// Images are resized in the browser and uploaded to the private 'board' bucket only when the post is sent.

import { ImagePlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { uploadBoardImage } from "@/lib/api";
import { cx } from "@/lib/format";
import { resizeForUpload } from "@/lib/image";

export const MAX_IMAGES = 5;
const MAX_SIDE = 1600; // screenshots need to stay readable

export interface Attached {
  id: string;
  blob: Blob;
  url: string;
  /** set for the automatic screen capture */
  label?: string;
}

export function useImageAttach(max = MAX_IMAGES) {
  const [items, setItems] = useState<Attached[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const add = useCallback(
    (files: Iterable<Blob>, label?: string) => {
      const list = [...files].filter((f) => f.type.startsWith("image/"));
      if (!list.length) return;
      setItems((cur) => {
        const room = max - cur.length;
        if (list.length > room) setNote(`사진은 ${max}장까지 넣을 수 있어요.`);
        else setNote(null);
        return [...cur, ...list.slice(0, Math.max(0, room)).map((blob) => ({ id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), label }))];
      });
    },
    [max],
  );

  const remove = useCallback((id: string) => {
    setItems((cur) => {
      const gone = cur.find((x) => x.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return cur.filter((x) => x.id !== id);
    });
    setNote(null);
  }, []);

  const clear = useCallback(() => {
    itemsRef.current.forEach((x) => URL.revokeObjectURL(x.url));
    setItems([]);
    setNote(null);
  }, []);

  useEffect(() => () => itemsRef.current.forEach((x) => URL.revokeObjectURL(x.url)), []);

  /** Spread on the area that should accept ⌘/Ctrl+V. */
  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        add(files);
      }
    },
    [add],
  );

  return { items, add, remove, clear, onPaste, note };
}

export type ImageAttachState = ReturnType<typeof useImageAttach>;

/** Resize and upload every attached picture; returns storage paths in order. */
export async function uploadAttached(items: Attached[]): Promise<string[]> {
  const paths: string[] = [];
  for (const it of items) {
    const { blob, contentType } = await resizeForUpload(it.blob, MAX_SIDE);
    paths.push(await uploadBoardImage(blob, contentType));
  }
  return paths;
}

/** Soft style: one row button (grey on a white surface, white on a grey one) and thumbnails. */
export function AttachArea({ state, tone = "fill" }: { state: ImageAttachState; tone?: "fill" | "white" }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const full = state.items.length >= MAX_IMAGES;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={full}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          state.add(e.dataTransfer.files);
        }}
        title="끌어다 놓거나, 클릭하거나, 스크린샷을 ⌘/Ctrl+V로 붙여 넣을 수 있어요"
        className={cx(
          "flex h-11 w-full items-center gap-2 rounded-xl px-3.5 text-sm text-tx-2 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          over ? "bg-st-doing-soft text-st-doing" : tone === "white" ? "bg-surface" : "bg-fill",
        )}
      >
        <ImagePlus aria-hidden size={16} strokeWidth={1.75} />
        <span className="font-semibold text-tx">사진 넣기</span>
        <span className="hidden text-xs text-tx-3 sm:inline">끌어다 놓기 · ⌘/Ctrl+V</span>
        <span className="ml-auto text-[13px] tabular-nums text-tx-3">
          {state.items.length}/{MAX_IMAGES}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) state.add(e.target.files);
          e.target.value = "";
        }}
      />
      {state.items.length > 0 && <Thumbs items={state.items} onRemove={state.remove} />}
      {state.note && <span className="text-xs text-st-new">{state.note}</span>}
    </div>
  );
}

function Thumbs({ items, onRemove }: { items: Attached[]; onRemove: (id: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <li key={it.id} className="relative h-[58px] w-[76px] overflow-hidden rounded-[10px] bg-fill">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img src={it.url} alt="" className="h-full w-full object-cover" />
          {it.label && <span className="absolute inset-x-0 bottom-0 bg-black/45 py-px text-center text-[10.5px] text-white">{it.label}</span>}
          <button
            type="button"
            aria-label="사진 빼기"
            onClick={() => onRemove(it.id)}
            className="absolute right-1 top-1 grid h-[18px] w-[18px] place-items-center rounded-full bg-black/50 text-white"
          >
            <X aria-hidden size={11} strokeWidth={2.5} />
          </button>
        </li>
      ))}
    </ul>
  );
}
