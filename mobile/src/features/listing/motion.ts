import type { PhotoSizes } from "../browse/types";

export type Rect = { id: number; uri: string; x: number; y: number; width: number; height: number };

/** Reduce-motion on, or no measured card to fly from → a plain fade. Otherwise the photo flies. */
export function openingMode(reduced: boolean, origin: Rect | null): "flight" | "fade" {
  return !reduced && origin ? "flight" : "fade";
}

/** The thumb shows at once (already cached from the card); the sharper size replaces it when loaded. */
export function photoSources(v: PhotoSizes): { placeholder: string | null; uri: string | null } {
  return { placeholder: v.thumb ?? v.medium ?? v.large, uri: v.large ?? v.medium ?? v.thumb };
}

/** Drag-down-to-close: far enough, or a quick downward flick. */
export function shouldClose(translationY: number, velocityY: number): boolean {
  return translationY > 120 || (translationY > 0 && velocityY > 900);
}
