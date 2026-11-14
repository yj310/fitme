"use client";

import { useState } from "react";
import { cx } from "@/lib/format";
import { ClothingIcon } from "./ClothingIcon";

/** Square thumbnail on a light-gray rounded tile (spec 6.4). Falls back to a drawing. */
export function ItemThumb({
  src,
  alt,
  subcategory,
  color,
  className,
  rounded = "rounded-[10px]",
}: {
  src: string | null | undefined;
  alt: string;
  subcategory: string;
  color?: string;
  className?: string;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={cx("relative aspect-square overflow-hidden bg-tile", rounded, className)}>
      {src && !failed ? (
        // Signed Supabase URLs change hourly, so next/image optimisation is not useful here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <div role="img" aria-label={alt} className="grid h-full w-full place-items-center">
          <ClothingIcon subcategory={subcategory} color={color} size={56} className="h-3/5 w-3/5" />
        </div>
      )}
    </div>
  );
}
