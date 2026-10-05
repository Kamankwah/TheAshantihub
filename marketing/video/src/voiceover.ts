import voiceover from "./clips/voiceover.json";
import manifest from "./generated/audio-manifest.json";
import type { Caption } from "./types";

// src/clips/voiceover.json is the single source for each clip's spoken lines
// and caption chunks; scripts/audio.mjs reads it too. Once audio has been
// generated, src/generated/audio-manifest.json carries the voice files and
// captions re-timed to the actual speech — those win over the planned timings.

type ClipVoiceover = { duration: number; beats: { start: number; say: string; captions: Caption[] }[] };
const VO = voiceover as Record<string, ClipVoiceover>;

export type ClipAudio = {
  voice: { file: string; start: number; duration: number }[];
  captions: Caption[];
  music: string | null;
};
type Manifest = { clips: Record<string, ClipAudio>; sfx: { tap?: string } };
const AUDIO = manifest as unknown as Manifest;

export const durationOf = (clipId: string): number => VO[clipId].duration;

export const captionsOf = (clipId: string): Caption[] => VO[clipId].beats.flatMap((b) => b.captions);

/** Generated audio for a clip, or null when `npm run audio` hasn't been run (renders silent). */
export const audioOf = (clipId: string): ClipAudio | null => AUDIO.clips[clipId] ?? null;

export const tapSound = (): string | null => AUDIO.sfx.tap ?? null;
