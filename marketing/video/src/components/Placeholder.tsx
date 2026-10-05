import React from "react";
import { AbsoluteFill } from "remotion";
import { BODY, C } from "../theme";

/** Stand-in screenshot until the real capture lands. The ruler marks screenshot px for tuning taps/scroll. */
export const Placeholder: React.FC<{ label: string; w: number; h: number }> = ({ label, w, h }) => {
  const marks = Array.from({ length: Math.floor(h / 250) + 1 }, (_, i) => i * 250);
  return (
    <AbsoluteFill style={{ background: C.recessed, fontFamily: BODY, color: C.brown }}>
      <div style={{ position: "absolute", inset: 24, border: `6px dashed rgba(44,24,16,0.3)`, borderRadius: 24 }} />
      {marks.map((y) => (
        <div key={y} style={{ position: "absolute", left: 0, top: y, width: 90, borderTop: "3px solid rgba(44,24,16,0.35)", fontSize: 30, paddingLeft: 36, paddingTop: 4 }}>
          {y}
        </div>
      ))}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 24, textAlign: "center", padding: 120 }}>
        <div style={{ fontWeight: 700, fontSize: w / 13 }}>{label}</div>
        <div style={{ fontWeight: 500, fontSize: w / 30, color: C.brownDim }}>
          placeholder · {w}×{h}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
