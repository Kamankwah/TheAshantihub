import type { Format, Scene } from "./types";

// Fixed geometry per format. Vertical (1080×1920) keeps captions out of the
// top 220px and bottom 340px that TikTok/Reels/Shorts cover with their own UI.

export const SIZE: Record<Format, { w: number; h: number }> = {
  vertical: { w: 1080, h: 1920 },
  landscape: { w: 1920, h: 1080 },
};

/** Phone: `width` is the SCREEN width; the bezel sits outside it. */
export const PHONE: Record<Format, { left: number; top: number; width: number; bezel: number; radius: number }> = {
  // 860 wide → screenshot shown at 0.735, so 16px app text reads at ~12px on a phone.
  // The device runs off the bottom edge; scroll the screenshot to reach lower content.
  vertical: { left: 110, top: 420, width: 860, bezel: 14, radius: 72 },
  landscape: { left: 128, top: 64, width: 440, bezel: 8, radius: 44 },
};

export const DESKTOP: Record<Format, { left: number; top: number; width: number }> = {
  vertical: { left: 40, top: 560, width: 1000 },
  landscape: { left: 360, top: 150, width: 1200 },
};

type TopZone = { left: number; top: number; width: number; align: "center" | "left"; fontSize: number };

/** Where the Fraunces headline + chips go, by scene kind. */
export const topZone = (format: Format, kind: Scene["kind"]): TopZone => {
  if (format === "vertical") return { left: 60, top: 222, width: 960, align: "center", fontSize: 58 };
  if (kind === "phone" || kind === "chat-stack") return { left: 700, top: 250, width: 1100, align: "left", fontSize: 76 };
  return { left: 160, top: 44, width: 1600, align: "center", fontSize: 56 };
};

type CaptionPlace = { centerX: number; bottom: number; maxWidth: number; fontSize: number };

export const captionPlace = (format: Format, kind: Scene["kind"] | undefined): CaptionPlace => {
  if (format === "vertical") return { centerX: 540, bottom: 340, maxWidth: 960, fontSize: 44 };
  if (kind === "phone" || kind === "chat-stack") return { centerX: 1250, bottom: 110, maxWidth: 1060, fontSize: 40 };
  return { centerX: 960, bottom: 44, maxWidth: 1400, fontSize: 38 };
};

/** "Demo store" pill: just above the phone's top-right corner. */
export const demoPill = (format: Format, kind: Scene["kind"]) => {
  if (kind === "desktop") {
    const d = DESKTOP[format];
    return { right: SIZE[format].w - (d.left + d.width), top: d.top - 60 };
  }
  const p = PHONE[format];
  if (format === "vertical") return { right: SIZE.vertical.w - (p.left + p.width + p.bezel), top: p.top - p.bezel - 64 };
  return { left: p.left + p.width + p.bezel * 2 + 20, top: p.top };
};
