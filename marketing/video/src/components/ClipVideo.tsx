import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { getClip } from "../clips";
import type { Format, Scene } from "../types";
import { C } from "../theme";
import { CaptionTrack } from "./Captions";
import { DemoPill, KenteEdge, TopZone } from "./Chrome";
import { DesktopScreen, PhoneScreen } from "./Frames";
import { ChatStack, EndCard, HookText } from "./Scenes";
import { AudioTrack } from "./AudioTrack";
import { audioOf } from "../voiceover";

/** Crossfade length: each scene overlaps the next by this many frames. */
const FADE = 9;

const sameTop = (a: Scene | undefined, b: Scene) =>
  !!a && a.onScreen === b.onScreen && JSON.stringify(a.chips) === JSON.stringify(b.chips);

const SceneLayer: React.FC<{ scene: Scene; format: Format; fadeIn: boolean; animateTop: boolean }> = ({
  scene,
  format,
  fadeIn,
  animateTop,
}) => {
  const frame = useCurrentFrame();
  const opacity = fadeIn ? interpolate(frame, [0, FADE], [0, 1], { extrapolateRight: "clamp" }) : 1;
  const dark = scene.kind === "end-card";
  return (
    <AbsoluteFill style={{ background: dark ? C.brown : C.cream, opacity }}>
      {scene.kind === "hook-text" ? <HookText scene={scene} format={format} /> : null}
      {scene.kind === "chat-stack" ? <ChatStack scene={scene} format={format} /> : null}
      {scene.kind === "end-card" ? <EndCard scene={scene} format={format} /> : null}
      {scene.kind === "phone" ? <PhoneScreen scene={scene} format={format} /> : null}
      {scene.kind === "desktop" ? <DesktopScreen scene={scene} format={format} /> : null}
      {scene.kind === "phone" || scene.kind === "desktop" ? <TopZone scene={scene} format={format} animate={animateTop} /> : null}
      {scene.demo ? <DemoPill scene={scene} format={format} /> : null}
    </AbsoluteFill>
  );
};

export const ClipVideo: React.FC<{ clipId: string; format: Format }> = ({ clipId, format }) => {
  const planned = getClip(clipId);
  const audio = audioOf(clipId);
  // With generated audio, captions follow the actual speech instead of the planned timings.
  const clip = audio ? { ...planned, captions: audio.captions } : planned;
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: C.cream }}>
      {clip.scenes.map((scene, i) => {
        const last = i === clip.scenes.length - 1;
        const from = Math.round(scene.start * fps);
        const frames = Math.round(scene.duration * fps) + (last ? 0 : FADE);
        return (
          <Sequence key={i} from={from} durationInFrames={frames} name={`${i + 1}. ${scene.kind}`}>
            <SceneLayer scene={scene} format={format} fadeIn={i > 0} animateTop={!sameTop(clip.scenes[i - 1], scene)} />
          </Sequence>
        );
      })}
      <CaptionTrack clip={clip} format={format} />
      <KenteEdge />
      {audio ? <AudioTrack clip={clip} audio={audio} /> : null}
    </AbsoluteFill>
  );
};
