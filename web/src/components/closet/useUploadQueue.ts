"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, QUOTA_MESSAGE, createItem, errorMessage, tagItem, uploadImage } from "@/lib/api";
import { resizeForUpload } from "@/lib/image";
import type { Item, TagSuggestion } from "@/lib/types";
import { draftFromTags, emptyDraft, tagsChanged, type TagDraft } from "./TagForm";

export const MAX_FILES = 10;

export interface QueueEntry {
  id: string;
  previewUrl: string;
  file: File;
  status: "waiting" | "processing" | "ready" | "upload_failed" | "saving" | "saved" | "skipped";
  path: string | null;
  aiTags: TagSuggestion | null;
  confidence: Record<string, number>;
  draft: TagDraft;
  /** Tagging failed (or quota) → manual form. */
  taggingError: string | null;
  error: string | null;
}

/**
 * Photos → resize (1024 WebP) → signed upload → AI tagging, one at a time.
 * The user reviews entries in order while later ones keep processing.
 */
export function useUploadQueue(onSaved: (item: Item) => void) {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const working = useRef(false);
  const entriesRef = useRef<QueueEntry[]>([]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const update = useCallback((id: string, patch: Partial<QueueEntry>) => {
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const pump = useCallback(async () => {
    if (working.current) return;
    working.current = true;
    try {
      for (;;) {
        const next = entriesRef.current.find((e) => e.status === "waiting");
        if (!next) break;
        update(next.id, { status: "processing" });
        entriesRef.current = entriesRef.current.map((e) => (e.id === next.id ? { ...e, status: "processing" } : e));
        let path: string;
        try {
          const { blob, contentType } = await resizeForUpload(next.file);
          path = await uploadImage(blob, contentType);
        } catch (e) {
          update(next.id, { status: "upload_failed", error: errorMessage(e) });
          continue;
        }
        try {
          const r = await tagItem(path);
          update(next.id, {
            status: "ready",
            path,
            aiTags: r.tags,
            confidence: r.confidence ?? {},
            draft: draftFromTags(r.tags, r.name),
          });
        } catch (e) {
          const quota = e instanceof ApiError && e.code === "FREE_QUOTA_EXCEEDED";
          update(next.id, {
            status: "ready",
            path,
            taggingError: quota ? QUOTA_MESSAGE : "AI 태그를 받지 못했어요. 직접 입력해 주세요.",
          });
        }
      }
    } finally {
      working.current = false;
    }
  }, [update]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (!list.length) return;
      const active = entriesRef.current.filter((e) => !["saved", "skipped"].includes(e.status)).length;
      const room = Math.max(0, MAX_FILES - active);
      if (list.length > room) setNotice(`한 번에 최대 ${MAX_FILES}장까지 올릴 수 있어요. ${room}장만 추가했어요.`);
      else setNotice(null);
      const added: QueueEntry[] = list.slice(0, room).map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        previewUrl: URL.createObjectURL(file),
        file,
        status: "waiting",
        path: null,
        aiTags: null,
        confidence: {},
        draft: emptyDraft(),
        taggingError: null,
        error: null,
      }));
      entriesRef.current = [...entriesRef.current, ...added];
      setEntries(entriesRef.current);
      void pump();
    },
    [pump],
  );

  const setDraft = useCallback((id: string, draft: TagDraft) => update(id, { draft }), [update]);

  const skip = useCallback((id: string) => update(id, { status: "skipped" }), [update]);

  const retryUpload = useCallback(
    (id: string) => {
      entriesRef.current = entriesRef.current.map((e) => (e.id === id ? { ...e, status: "waiting", error: null } : e));
      setEntries(entriesRef.current);
      void pump();
    },
    [pump],
  );

  const save = useCallback(
    async (id: string) => {
      const e = entriesRef.current.find((x) => x.id === id);
      if (!e || !e.path) return;
      update(id, { status: "saving", error: null });
      const d = e.draft;
      const tag_source = e.aiTags ? (tagsChanged(e.aiTags, d) ? "user_edited" : "ai") : "manual";
      try {
        const item = await createItem({
          image_path: e.path,
          name: d.name.trim() || undefined,
          category: d.category,
          subcategory: d.subcategory,
          color: d.color,
          pattern: d.pattern,
          fit: d.fit,
          material: d.material,
          seasons: d.seasons,
          style_tags: d.style_tags,
          formality: d.formality,
          warmth: d.warmth,
          brand: d.brand.trim() || null,
          size_label: d.size_label.trim() || null,
          memo: d.memo.trim() || null,
          tag_confidence: e.confidence,
          tag_source,
        });
        update(id, { status: "saved" });
        onSaved(item);
      } catch (err) {
        update(id, { status: "ready", error: errorMessage(err) });
      }
    },
    [onSaved, update],
  );

  const clearDone = useCallback(() => {
    for (const e of entriesRef.current) {
      if (e.status === "saved" || e.status === "skipped") URL.revokeObjectURL(e.previewUrl);
    }
    entriesRef.current = entriesRef.current.filter((e) => e.status !== "saved" && e.status !== "skipped");
    setEntries(entriesRef.current);
  }, []);

  const pending = entries.filter((e) => e.status !== "saved" && e.status !== "skipped");
  const current = pending[0] ?? null;
  const total = entries.length;
  const position = current ? entries.indexOf(current) + 1 : total;

  return { entries, pending, current, total, position, notice, addFiles, setDraft, skip, save, retryUpload, clearDone };
}

export type UploadQueue = ReturnType<typeof useUploadQueue>;
