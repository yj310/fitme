"use client";

import { useState } from "react";
import { deleteItem, errorMessage, patchItem } from "@/lib/api";
import type { Item } from "@/lib/types";
import { ItemThumb } from "../ItemThumb";
import { Badge, Banner, Button, Modal } from "../ui";
import { TagForm, tagsChanged, type TagDraft } from "./TagForm";

function toDraft(item: Item): TagDraft {
  return {
    category: item.category,
    subcategory: item.subcategory,
    color: item.color,
    pattern: item.pattern,
    fit: item.fit,
    material: item.material,
    seasons: item.seasons,
    style_tags: item.style_tags,
    formality: item.formality,
    warmth: item.warmth,
    name: item.name,
    nameEdited: true,
    brand: item.brand ?? "",
    size_label: item.size_label ?? "",
    memo: item.memo ?? "",
  };
}

export function ItemEditModal({
  item,
  onClose,
  onChanged,
  onDeleted,
}: {
  item: Item | null;
  onClose: () => void;
  onChanged: (item: Item) => void;
  onDeleted: (id: string) => void;
}) {
  return (
    <Modal open={Boolean(item)} title="옷 정보" onClose={onClose} width={720}>
      {item && <Body key={item.id} item={item} onClose={onClose} onChanged={onChanged} onDeleted={onDeleted} />}
    </Modal>
  );
}

function Body({
  item,
  onClose,
  onChanged,
  onDeleted,
}: {
  item: Item;
  onClose: () => void;
  onChanged: (item: Item) => void;
  onDeleted: (id: string) => void;
}) {
  const [draft, setDraft] = useState<TagDraft>(() => toDraft(item));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const changed = tagsChanged(item, draft);
      const updated = await patchItem(item.id, {
        name: draft.name.trim() || undefined,
        category: draft.category,
        subcategory: draft.subcategory,
        color: draft.color,
        pattern: draft.pattern,
        fit: draft.fit,
        material: draft.material,
        seasons: draft.seasons,
        style_tags: draft.style_tags,
        formality: draft.formality,
        warmth: draft.warmth,
        brand: draft.brand.trim() || null,
        size_label: draft.size_label.trim() || null,
        memo: draft.memo.trim() || null,
        ...(changed && item.tag_source === "ai" ? { tag_source: "user_edited" as const } : {}),
      });
      onChanged(updated);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleArchive = async () => {
    setBusy("archive");
    setError(null);
    try {
      const updated = await patchItem(item.id, { is_active: !item.is_active });
      onChanged(updated);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    setError(null);
    try {
      await deleteItem(item.id);
      onDeleted(item.id);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-5">
      <div className="flex flex-col gap-2">
        <ItemThumb src={item.image_url} alt={item.name} subcategory={item.subcategory} color={item.color} />
        <div className="flex flex-wrap gap-1">
          {!item.is_active && <Badge tone="muted">보관 중</Badge>}
          <Badge tone="muted">
            {item.tag_source === "ai" ? "AI 태그" : item.tag_source === "user_edited" ? "AI 태그 + 수정" : "직접 입력"}
          </Badge>
        </div>
        <p className="text-xs text-muted">보관한 옷은 코디 추천에서 빠져요.</p>
      </div>
      <div className="flex flex-col gap-3">
        <TagForm value={draft} onChange={setDraft} />
        {error && <Banner tone="danger">{error}</Banner>}
        {confirmDelete ? (
          <div className="flex flex-col gap-2 rounded-[10px] bg-danger-soft p-3 text-[13px] text-danger">
            <p>이 옷과 사진을 삭제할까요? 되돌릴 수 없어요.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                취소
              </Button>
              <Button variant="danger" onClick={remove} loading={busy === "delete"}>
                삭제
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="ghost" onClick={toggleArchive} loading={busy === "archive"} disabled={busy !== null}>
                {item.is_active ? "보관하기" : "보관 해제"}
              </Button>
              <Button variant="subtle" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>
                삭제
              </Button>
            </div>
            <Button onClick={save} loading={busy === "save"} disabled={busy !== null}>
              저장
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
