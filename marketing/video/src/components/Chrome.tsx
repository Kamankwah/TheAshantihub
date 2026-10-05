import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import type { Format, Scene } from "../types";
import { demoPill, topZone } from "../layout";
import { BODY, C, DISPLAY } from "../theme";

/** DESIGN.md: kente lives on a 4–6px structural edge only. */
const KENTE = [
  [C.gold, 64],
  [C.brown, 14],
  [C.green, 30],
  [C.brown, 14],
  [C.gold, 64],
  [C.red, 20],
  [C.brown, 14],
] as const;

export const KenteEdge: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div style={{ display: "flex", height: 6, width: "100%", overflow: "hidden" }}>
      {Array.from({ length: 12 }).flatMap((_, r) =>
        KENTE.map(([color, w], i) => <div key={`${r}-${i}`} style={{ flex: `0 0 ${w}px`, background: color }} />),
      )}
    </div>
  </AbsoluteFill>
);

/** Renders `*word*` as gold italic emphasis (DESIGN.md: italic in the accent gold, sparingly). */
export const Emph: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(\*[^*]+\*)/g).map((part, i) =>
      part.startsWith("*") && part.endsWith("*") ? (
        <em key={i} style={{ color: C.deepGold, fontStyle: "italic" }}>
          {part.slice(1, -1)}
        </em>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      ),
    )}
  </>
);

/** Fraunces headline and/or step chips for a scene. `animate` is false when the previous scene showed the same top. */
export const TopZone: React.FC<{ scene: Scene; format: Format; animate: boolean }> = ({ scene, format, animate }) => {
  const frame = useCurrentFrame();
  if (!scene.onScreen && !scene.chips) return null;
  const z = topZone(format, scene.kind);
  const enter = animate ? interpolate(frame, [4, 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }) : 1;
  const chipSize = format === "vertical" ? 30 : 28;
  return (
    <div
      style={{
        position: "absolute",
        left: z.left,
        top: z.top,
        width: z.width,
        display: "flex",
        flexDirection: "column",
        alignItems: z.align === "center" ? "center" : "flex-start",
        gap: 22,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 18}px)`,
      }}
    >
      {scene.onScreen ? (
        <div
          style={{
            fontFamily: DISPLAY,
            fontWeight: 600,
            fontSize: z.fontSize,
            lineHeight: 1.08,
            letterSpacing: "-0.02em",
            color: C.brown,
            textAlign: z.align,
            textWrap: "balance",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Emph text={scene.onScreen} />
        </div>
      ) : null}
      {scene.chips ? (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: z.align === "center" ? "center" : "flex-start" }}>
          {scene.chips.map((chip, i) => {
            const active = i === scene.activeChip;
            return (
              <div
                key={chip}
                style={{
                  fontFamily: BODY,
                  fontWeight: 600,
                  fontSize: chipSize,
                  padding: `${chipSize * 0.32}px ${chipSize * 0.75}px`,
                  borderRadius: 999,
                  background: active ? C.gold : "transparent",
                  color: active ? C.brown : C.brownDim,
                  border: `2px solid ${active ? C.gold : "rgba(44,24,16,0.25)"}`,
                }}
              >
                {chip}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

/** Neutral-chrome pill marking the fictional demo business on screen. */
export const DemoPill: React.FC<{ scene: Scene; format: Format }> = ({ scene, format }) => {
  const pos = demoPill(format, scene.kind);
  const size = format === "vertical" ? 26 : 22;
  return (
    <div
      style={{
        position: "absolute",
        ...pos,
        fontFamily: BODY,
        fontWeight: 600,
        fontSize: size,
        color: C.brown,
        background: C.cream,
        border: "1.5px solid rgba(44,24,16,0.28)",
        borderRadius: 999,
        padding: `${size * 0.3}px ${size * 0.75}px`,
        letterSpacing: "0.01em",
      }}
    >
      Demo store
    </div>
  );
};
