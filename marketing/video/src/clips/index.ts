import type { Clip } from "../types";
import { bizEnquiries } from "./biz-enquiries";
import { bizFreeStart } from "./biz-free-start";
import { custWhySupport } from "./cust-why-support";

export const CLIPS: Clip[] = [bizFreeStart, bizEnquiries, custWhySupport];

export const getClip = (id: string): Clip => {
  const clip = CLIPS.find((c) => c.id === id);
  if (!clip) throw new Error(`Unknown clip "${id}"`);
  const last = clip.scenes[clip.scenes.length - 1];
  if (Math.abs(last.start + last.duration - clip.duration) > 0.01) {
    throw new Error(`Clip "${id}": last scene ends at ${last.start + last.duration}s but duration is ${clip.duration}s`);
  }
  return clip;
};
