"use client";

// Pictures for 피드백 게시판: click to pick, drag & drop, or paste a screenshot (⌘/Ctrl+V).
// Images are resized in the browser and uploaded to the private 'board' bucket only when the post is sent.

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

export function AttachArea({ state, compact }: { state: ImageAttachState; compact?: boolean }) {
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
        className={cx(
          "rounded-[12px] border-2 border-dashed text-center text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          compact ? "px-3 py-2" : "px-3 py-3",
          over ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-app text-muted hover:border-accent",
        )}
      >
        <span className="font-semibold text-ink">사진 넣기</span> · 끌어다 놓기, 클릭, 스크린샷은{" "}
        <kbd className="rounded border border-b-2 border-line-strong bg-surface px-1 font-mono text-[11px]">⌘/Ctrl</kbd>+
        <kbd className="rounded border border-b-2 border-line-strong bg-surface px-1 font-mono text-[11px]">V</kbd>
        <span className="ml-1 font-mono">
          ({state.items.length}/{MAX_IMAGES})
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
      {state.note && <span className="text-xs text-warn">{state.note}</span>}
    </div>
  );
}

function Thumbs({ items, onRemove }: { items: Attached[]; onRemove: (id: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <li key={it.id} className="relative h-16 w-16 overflow-hidden rounded-[8px] border border-line bg-tile">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img src={it.url} alt="" className="h-full w-full object-cover" />
          {it.label && <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 text-center text-[10px] text-white">{it.label}</span>}
          <button
            type="button"
            aria-label="사진 빼기"
            onClick={() => onRemove(it.id)}
            className="absolute right-0.5 top-0.5 grid h-[18px] w-[18px] place-items-center rounded-full bg-black/60 text-[10px] text-white"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
