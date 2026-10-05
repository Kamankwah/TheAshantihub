import React from "react";
import { Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Clip } from "../types";
import type { ClipAudio } from "../voiceover";
import { tapSound } from "../voiceover";

// Overall gain, +6 dB: at unity the mix sat near −23.5 LUFS, well under what social
// feeds play at. The voice sets the peaks (≈ −8 dBFS at unity), so ×2 lands them near
// −2 dBFS (≈ −17.5 LUFS) with headroom for the AAC encode.
const GAIN = 2;
const MUSIC_BED = 0.2;
const MUSIC_UNDER_VOICE = 0.07;
const DUCK_SECONDS = 0.25;
const FADE_IN_SECONDS = 0.4;
const FADE_OUT_SECONDS = 1.5;

/** Music volume at time t: dips under every voice line, with short ramps, and
 * fades in/out at the clip's edges (the bed may be longer than the clip). */
function musicVolume(t: number, audio: ClipAudio, clipSeconds: number): number {
  let duck = 0;
  for (const v of audio.voice) {
    const into = t - (v.start - DUCK_SECONDS);
    const outOf = v.start + v.duration + DUCK_SECONDS - t;
    duck = Math.max(duck, Math.min(1, Math.max(0, into / DUCK_SECONDS), Math.max(0, outOf / DUCK_SECONDS)));
  }
  const edge = Math.min(1, t / FADE_IN_SECONDS, Math.max(0, (clipSeconds - t) / FADE_OUT_SECONDS));
  return (MUSIC_BED - (MUSIC_BED - MUSIC_UNDER_VOICE) * duck) * edge * GAIN;
}

/** Voice lines, the ducked music bed, and a tap sound on every on-screen tap. */
export const AudioTrack: React.FC<{ clip: Clip; audio: ClipAudio }> = ({ clip, audio }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const tap = tapSound();
  const taps = clip.scenes.flatMap((s) => ("taps" in s && s.taps ? s.taps.map((t) => s.start + t.at) : []));
  return (
    <>
      {audio.music ? (
        <Audio src={staticFile(audio.music)} volume={() => musicVolume(frame / fps, audio, durationInFrames / fps)} />
      ) : null}
      {audio.voice.map((v, i) => (
        <Sequence key={`v${i}`} from={Math.round(v.start * fps)} name={`voice ${i + 1}`}>
          <Audio src={staticFile(v.file)} volume={GAIN} />
        </Sequence>
      ))}
      {tap
        ? taps.map((at, i) => (
            <Sequence key={`t${i}`} from={Math.round(at * fps)} durationInFrames={Math.round(0.6 * fps)} name="tap">
              <Audio src={staticFile(tap)} volume={0.6 * GAIN} />
            </Sequence>
          ))
        : null}
    </>
  );
};
