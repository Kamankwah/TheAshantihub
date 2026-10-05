import React, { useMemo } from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { ChatStackScene, EndCardScene, Format, HookTextScene } from "../types";
import { PHONE, topZone } from "../layout";
import { BODY, C, DISPLAY } from "../theme";
import { Emph } from "./Chrome";
import { PhoneShell, phoneViewH } from "./Frames";

/** Kinetic hook: words rise in one after another. */
export const HookText: React.FC<{ scene: HookTextScene; format: Format }> = ({ scene, format }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const plain = scene.text.replace(/\*/g, "");
  const size =
    format === "vertical"
      ? plain.length <= 14 ? 168 : plain.length <= 28 ? 120 : 98
      : plain.length <= 14 ? 160 : plain.length <= 28 ? 116 : 96;
  // Keep *emphasis* markers attached to their words.
  const words = scene.text.split(" ");
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: format === "vertical" ? "0 80px" : "0 200px" }}>
      <div
        style={{
          fontFamily: DISPLAY,
          fontWeight: 600,
          fontSize: size,
          lineHeight: 1.04,
          letterSpacing: "-0.025em",
          color: C.brown,
          textAlign: "center",
          textWrap: "balance",
          fontVariantNumeric: "tabular-nums",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          columnGap: "0.26em",
        }}
      >
        {words.map((word, i) => {
          const s = spring({ frame: frame - 3 - i * 4, fps, config: { damping: 200 } });
          return (
            <span key={i} style={{ display: "inline-block", opacity: s, transform: `translateY(${(1 - s) * 44}px)` }}>
              <Emph text={word} />
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** Hook for "Is this still available?": generic incoming bubbles stack up in a phone; a counter climbs. */
export const ChatStack: React.FC<{ scene: ChatStackScene; format: Format }> = ({ scene, format }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const total = Math.round(scene.duration * fps);
  const ramp = Math.round(total * 0.82);

  // Frame at which bubble k arrives (count eases in: slow first, then a flood).
  const arrivals = useMemo(() => {
    const out: number[] = [];
    let last = 0;
    for (let f = 0; f <= total; f++) {
      const n = 1 + Math.floor((scene.countTo - 1) * Easing.in(Easing.quad)(Math.min(1, f / ramp)));
      while (last < n) {
        out.push(f);
        last++;
      }
    }
    return out;
  }, [scene.countTo, total, ramp]);

  const count = arrivals.filter((f) => f <= frame).length;
  const newestAge = count > 0 ? frame - arrivals[count - 1] : 99;
  const shakeX = newestAge < 3 ? [5, -5, 3][newestAge] : 0;

  // Chat is laid out in 390-wide phone CSS px, then scaled into the shell.
  const p = PHONE[format];
  const k = p.width / 390;
  const viewCss = phoneViewH(format) / k;
  // Keep the newest bubble above the caption band (vertical) / screen bottom.
  const listBottom = format === "vertical" ? Math.min(viewCss - 24, (1430 - p.top) / k) : viewCss - 24;
  const HEADER = 64;
  const BUBBLE = 64; // bubble + "now" + gap, in phone CSS px
  const fit = Math.max(1, Math.floor((listBottom - HEADER - 8) / BUBBLE));
  const shown = Math.min(count, fit);
  const visible = Array.from({ length: shown }, (_, j) => count - shown + j);

  const z = topZone(format, "chat-stack");
  const counterSize = format === "vertical" ? 120 : 150;

  return (
    <>
      <PhoneShell format={format} shakeX={shakeX}>
        <div style={{ position: "absolute", left: 0, top: 0, width: 390, height: viewCss, transform: `scale(${k})`, transformOrigin: "0 0", fontFamily: BODY }}>
          <div style={{ height: HEADER, boxSizing: "border-box", padding: "22px 20px 0", fontWeight: 700, fontSize: 20, color: "#1c1c1c", borderBottom: "1px solid #e6e6e6" }}>
            Messages
          </div>
          <div style={{ position: "absolute", left: 16, right: 16, top: HEADER + 8, height: listBottom - HEADER - 8, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 10 }}>
            {visible.map((idx) => {
              const age = frame - arrivals[idx];
              const pop = interpolate(age, [0, 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
              return (
                <div key={idx} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3, opacity: pop, transform: `translateY(${(1 - pop) * 12}px)` }}>
                  <div style={{ background: "#EDEDED", color: "#1c1c1c", fontSize: 16, fontWeight: 500, padding: "9px 14px", borderRadius: "18px 18px 18px 6px", maxWidth: 270 }}>
                    {scene.message}
                  </div>
                  <div style={{ fontSize: 11, color: "#8a8a8a", paddingLeft: 6 }}>now</div>
                </div>
              );
            })}
          </div>
        </div>
      </PhoneShell>
      <div style={{ position: "absolute", left: z.left, top: z.top, width: z.width, display: "flex", flexDirection: format === "vertical" ? "row" : "column", alignItems: format === "vertical" ? "baseline" : "flex-start", justifyContent: z.align === "center" ? "center" : "flex-start", gap: format === "vertical" ? 24 : 8 }}>
        {scene.onScreen ? (
          <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: z.fontSize, lineHeight: 1.08, letterSpacing: "-0.02em", color: C.brown }}>
            {scene.onScreen}
          </div>
        ) : null}
        <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: counterSize, lineHeight: 1, color: C.brown, fontVariantNumeric: "tabular-nums", minWidth: counterSize * 2.2 }}>
          × {count}
        </div>
      </div>
    </>
  );
};

/** Closing card: logo, headline, URL on the dark-brown ground (the logo's gold reads there). */
export const EndCard: React.FC<{ scene: EndCardScene; format: Format }> = ({ scene, format }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = format === "vertical";
  const rise = (delay: number) => {
    const s = spring({ frame: frame - 6 - delay, fps, config: { damping: 200 } });
    return { opacity: s, transform: `translateY(${(1 - s) * 30}px)` };
  };
  return (
    <AbsoluteFill style={{ background: C.brown, alignItems: "center", justifyContent: "center", gap: v ? 72 : 56, padding: v ? "0 80px" : "0 160px" }}>
      <Img src={staticFile("brand/logo-main.png")} style={{ width: v ? 820 : 760, ...rise(0) }} />
      <div style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: v ? 92 : 84, lineHeight: 1.06, letterSpacing: "-0.02em", color: C.lightGold, textAlign: "center", textWrap: "balance", ...rise(6) }}>
        <Emph text={scene.headline} />
      </div>
      <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: v ? 48 : 42, color: C.gold, letterSpacing: "0.01em", ...rise(12) }}>{scene.url}</div>
    </AbsoluteFill>
  );
};

