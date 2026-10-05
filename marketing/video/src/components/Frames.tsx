import React from "react";
import type { Format, ScreenScene } from "../types";
import { DESKTOP_SCREEN, PHONE_SCREEN } from "../types";
import { DESKTOP, PHONE, SIZE } from "../layout";
import { C, SHADOW } from "../theme";
import { ScreenLayer } from "./ScreenLayer";

/** A plain phone shape — bezel and rounded screen only, no painted status bar. */
export const PhoneShell: React.FC<{ format: Format; shakeX?: number; children: React.ReactNode }> = ({
  format,
  shakeX = 0,
  children,
}) => {
  const p = PHONE[format];
  const innerH = PHONE_SCREEN.h * (p.width / PHONE_SCREEN.w);
  return (
    <div
      style={{
        position: "absolute",
        left: p.left - p.bezel + shakeX,
        top: p.top - p.bezel,
        width: p.width + p.bezel * 2,
        height: innerH + p.bezel * 2,
        borderRadius: p.radius,
        background: C.brown,
        boxShadow: SHADOW,
        padding: p.bezel,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          position: "relative",
          width: p.width,
          height: innerH,
          borderRadius: p.radius - p.bezel,
          overflow: "hidden",
          background: C.white,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** Height of the phone screen that is actually inside the video frame. */
export const phoneViewH = (format: Format) => {
  const p = PHONE[format];
  const innerH = PHONE_SCREEN.h * (p.width / PHONE_SCREEN.w);
  return Math.min(innerH, SIZE[format].h - p.top);
};

export const PhoneScreen: React.FC<{ scene: ScreenScene; format: Format }> = ({ scene, format }) => (
  <PhoneShell format={format}>
    <ScreenLayer
      screen={scene.screen}
      natural={PHONE_SCREEN}
      frameW={PHONE[format].width}
      viewH={phoneViewH(format)}
      scroll={scene.scroll}
      zoom={scene.zoom}
      taps={scene.taps}
      sceneDuration={scene.duration}
    />
  </PhoneShell>
);

export const DesktopScreen: React.FC<{ scene: ScreenScene; format: Format }> = ({ scene, format }) => {
  const d = DESKTOP[format];
  const h = DESKTOP_SCREEN.h * (d.width / DESKTOP_SCREEN.w);
  return (
    <div
      style={{
        position: "absolute",
        left: d.left,
        top: d.top,
        width: d.width,
        height: h,
        borderRadius: 18,
        overflow: "hidden",
        border: "2px solid rgba(44,24,16,0.18)",
        boxShadow: SHADOW,
        background: C.white,
      }}
    >
      <ScreenLayer
        screen={scene.screen}
        natural={DESKTOP_SCREEN}
        frameW={d.width}
        viewH={h}
        scroll={scene.scroll}
        zoom={scene.zoom}
        taps={scene.taps}
        sceneDuration={scene.duration}
      />
    </div>
  );
};
