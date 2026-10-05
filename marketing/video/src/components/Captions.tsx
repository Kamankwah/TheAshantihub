import React from "react";
import { interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { Clip, Format, Scene } from "../types";
import { captionPlace } from "../layout";
import { BODY, C } from "../theme";

const sceneAt = (clip: Clip, t: number): Scene | undefined =>
  clip.scenes.find((s) => t >= s.start && t < s.start + s.duration);

const CaptionBox: React.FC<{ text: string; format: Format; kind: Scene["kind"] | undefined; frames: number }> = ({
  text,
  format,
  kind,
  frames,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 4, frames - 4, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const p = captionPlace(format, kind);
  return (
    <div
      style={{
        position: "absolute",
        left: p.centerX - p.maxWidth / 2,
        width: p.maxWidth,
        bottom: p.bottom,
        display: "flex",
        justifyContent: "center",
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: BODY,
          fontWeight: 600,
          fontSize: p.fontSize,
          lineHeight: 1.28,
          color: C.cream,
          background: "rgba(44,24,16,0.88)",
          borderRadius: 22,
          padding: `${p.fontSize * 0.36}px ${p.fontSize * 0.68}px`,
          textAlign: "center",
          textWrap: "balance",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {text}
      </div>
    </div>
  );
};

/** Burned-in captions — the script's voiceover lines, verbatim, timed to their beats. */
export const CaptionTrack: React.FC<{ clip: Clip; format: Format }> = ({ clip, format }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {clip.captions.map((c, i) => {
        const kind = sceneAt(clip, c.start + 0.05)?.kind;
        // The end card already shows its line (headline + URL) — don't print it twice.
        if (kind === "end-card") return null;
        const from = Math.round(c.start * fps);
        const frames = Math.max(1, Math.round(c.end * fps) - from);
        return (
          <Sequence key={i} from={from} durationInFrames={frames} name={`caption ${i + 1}`}>
            <CaptionBox text={c.text} format={format} kind={kind} frames={frames} />
          </Sequence>
        );
      })}
    </>
  );
};
