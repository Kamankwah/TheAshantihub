import React from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Scroll, Tap, Zoom } from "../types";
import { C } from "../theme";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeInOut = Easing.inOut(Easing.cubic);

/**
 * A screenshot fitted to `frameW`, panned by `scroll` and zoomed by `zoom`,
 * with tap ripples drawn in screenshot space so they follow every transform.
 * `viewH` is the part of the frame actually on screen (the vertical phone runs
 * off the bottom edge), used to centre a zoom focus and to clamp panning.
 */
export const ScreenLayer: React.FC<{
  screen: string;
  natural: { w: number; h: number };
  frameW: number;
  viewH: number;
  scroll?: Scroll;
  zoom?: Zoom;
  taps?: Tap[];
  sceneDuration: number;
}> = ({ screen, natural, frameW, viewH, scroll, zoom, taps, sceneDuration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const s0 = frameW / natural.w;

  let scrollY = 0;
  if (scroll) {
    const at = scroll.at ?? 0.4;
    const dur = scroll.duration ?? Math.max(0.6, sceneDuration - at - 0.6);
    scrollY = scroll.from + (scroll.to - scroll.from) * easeInOut(clamp01((t - at) / dur));
  }

  let scale = s0;
  let tx = 0;
  let ty = -scrollY * s0;
  if (zoom) {
    const at = zoom.at ?? 0.5;
    const dur = zoom.duration ?? 1.4;
    const q = easeInOut(clamp01((t - at) / dur));
    const endScale = s0 * zoom.scale;
    scale = s0 + (endScale - s0) * q;
    const cx = frameW / 2 - endScale * zoom.x;
    const cy = viewH / 2 - endScale * zoom.y;
    tx = tx + (cx - tx) * q;
    ty = ty + (cy - ty) * q;
  }
  // Never pan past the screenshot's edges.
  tx = Math.min(0, Math.max(frameW - natural.w * scale, tx));
  ty = Math.min(0, Math.max(Math.min(0, viewH - natural.h * scale), ty));

  const ring = natural.w > 2000 ? 110 : 150;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: natural.w,
        height: natural.h,
        transformOrigin: "0 0",
        transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
      }}
    >
      <Img src={staticFile(`screens/${screen}`)} style={{ width: natural.w, height: natural.h, display: "block" }} />
      {(taps ?? []).map((tap, i) => {
        const local = t - tap.at;
        if (local < 0 || local > 0.95) return null;
        const ringScale = interpolate(local, [0, 0.95], [0.5, 1.6], { easing: Easing.out(Easing.cubic) });
        const ringOpacity = interpolate(local, [0, 0.12, 0.95], [0, 0.9, 0], { extrapolateRight: "clamp" });
        const dotOpacity = interpolate(local, [0, 0.08, 0.45, 0.65], [0, 0.5, 0.5, 0], { extrapolateRight: "clamp" });
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left: tap.x - ring / 2,
                top: tap.y - ring / 2,
                width: ring,
                height: ring,
                borderRadius: "50%",
                border: `${ring / 14}px solid ${C.brown}`,
                opacity: ringOpacity,
                transform: `scale(${ringScale})`,
                boxSizing: "border-box",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: tap.x - ring * 0.3,
                top: tap.y - ring * 0.3,
                width: ring * 0.6,
                height: ring * 0.6,
                borderRadius: "50%",
                background: C.brown,
                opacity: dotOpacity,
              }}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
};
