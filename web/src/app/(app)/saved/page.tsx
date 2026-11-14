"use client";

import { useCallback, useEffect, useState } from "react";
import { OutfitGridCard } from "@/components/OutfitCards";
import { ButtonLink, Chip, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { errorMessage, listOutfits } from "@/lib/api";
import type { OutfitCard } from "@/lib/types";

export default function SavedPage() {
  const [outfits, setOutfits] = useState<OutfitCard[] | null>(null);
  const [occasions, setOccasions] = useState<string[]>([]);
  const [occasion, setOccasion] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (occ: string) => {
    setError(null);
    setOutfits(null);
    try {
      const r = await listOutfits({ favorite: true, occasion: occ || undefined });
      setOutfits(r.outfits);
      if (!occ) setOccasions(r.occasions);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch when the filter changes
    void load(occasion);
  }, [load, occasion]);

  // Unfavoriting removes the card right away (spec F08: 즉시 반영).
  const onChange = (o: OutfitCard) => {
    if (!o.is_favorite) setOutfits((list) => list?.filter((x) => x.id !== o.id) ?? null);
  };

  return (
    <div className="flex flex-col gap-4 px-[26px] py-[22px]">
      <PageHeader title="저장한 코디" sub={outfits ? `${outfits.length}개` : undefined} />
      {occasions.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="상황 필터">
          <Chip on={!occasion} onClick={() => setOccasion("")}>
            전체
          </Chip>
          {occasions.map((o) => (
            <Chip key={o} on={occasion === o} onClick={() => setOccasion(o)}>
              {o}
            </Chip>
          ))}
        </div>
      )}
      {error ? (
        <ErrorState message={error} onRetry={() => load(occasion)} />
      ) : !outfits ? (
        <div className="grid grid-cols-3 gap-4" aria-busy>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-56" />
          ))}
        </div>
      ) : outfits.length === 0 ? (
        <EmptyState
          title={occasion ? `‘${occasion}’ 상황으로 저장한 코디가 없어요` : "아직 저장한 코디가 없어요"}
          description="마음에 드는 코디의 ♥를 누르면 여기에 모여요. 저장한 코디는 다음 추천에 반영돼요."
          action={<ButtonLink href="/today">오늘의 코디 보기</ButtonLink>}
        />
      ) : (
        <ul className="grid grid-cols-3 gap-4">
          {outfits.map((o) => (
            <li key={o.id}>
              <OutfitGridCard outfit={o} onChange={onChange} showMeta />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
