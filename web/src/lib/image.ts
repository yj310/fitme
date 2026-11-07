"use client";

const MAX_SIDE = 1024;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Revoke after decode; the decoded bitmap stays usable for drawing.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Resize so the long side is 1024px and encode as WebP (JPEG when WebP encoding is unsupported). */
export async function resizeForUpload(file: File): Promise<{ blob: Blob; contentType: "image/webp" | "image/jpeg" }> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리하지 못했어요.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const webp = await canvasToBlob(canvas, "image/webp", 0.85);
  // Browsers without WebP encoding silently return PNG — fall back to JPEG then.
  if (webp && webp.type === "image/webp") return { blob: webp, contentType: "image/webp" };
  const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.88);
  if (!jpeg) throw new Error("이미지를 처리하지 못했어요.");
  return { blob: jpeg, contentType: "image/jpeg" };
}
