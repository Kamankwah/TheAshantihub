import React from "react";
import { Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Clip } from "../types";
import type { ClipAudio } from "../voiceover";
import { tapSound } from "../voiceover";

const MUSIC_BED = 0.2;
const MUSIC_UNDER_VOICE = 0.07;
const DUCK_SECONDS = 0.25;

/** Music volume at time t: dips under every voice line, with short ramps. */
function musicVolume(t: number, audio: ClipAudio): number {
  let duck = 0;
  for (const v of audio.voice) {
    const into = t - (v.start - DUCK_SECONDS);
    const outOf = v.start + v.duration + DUCK_SECONDS - t;
    duck = Math.max(duck, Math.min(1, Math.max(0, into / DUCK_SECONDS), Math.max(0, outOf / DUCK_SECONDS)));
  }
  return MUSIC_BED - (MUSIC_BED - MUSIC_UNDER_VOICE) * duck;
}

/** Voice lines, the ducked music bed, and a tap sound on every on-screen tap. */
export const AudioTrack: React.FC<{ clip: Clip; audio: ClipAudio }> = ({ clip, audio }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const tap = tapSound();
  const taps = clip.scenes.flatMap((s) => ("taps" in s && s.taps ? s.taps.map((t) => s.start + t.at) : []));
  return (
    <>
      {audio.music ? (
        <Audio src={staticFile(audio.music)} volume={() => musicVolume(frame / fps, audio)} />
      ) : null}
      {audio.voice.map((v, i) => (
        <Sequence key={`v${i}`} from={Math.round(v.start * fps)} name={`voice ${i + 1}`}>
          <Audio src={staticFile(v.file)} />
        </Sequence>
      ))}
      {tap
        ? taps.map((at, i) => (
            <Sequence key={`t${i}`} from={Math.round(at * fps)} durationInFrames={Math.round(0.6 * fps)} name="tap">
              <Audio src={staticFile(tap)} volume={0.6} />
            </Sequence>
          ))
        : null}
    </>
  );
};
