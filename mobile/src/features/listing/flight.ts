import { create } from "zustand";

import type { Rect } from "./motion";

type FlightState = { origin: Rect | null; set: (r: Rect | null) => void };
/** Where the tapped card's photo was on screen, so the product page can fly it into place. */
export const useFlight = create<FlightState>((set) => ({ origin: null, set: (origin) => set({ origin }) }));

type Measurable = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void };
const registry = new Map<number, { ref: Measurable; uri: string }>();

export function registerPhoto(id: number, ref: Measurable | null, uri: string) {
  if (ref) registry.set(id, { ref, uri });
  else registry.delete(id);
}

/** Measure the card photo, then resolve. Never blocks navigation for more than ~80 ms. */
export function captureFlight(id: number): Promise<void> {
  const entry = registry.get(id);
  if (!entry) {
    useFlight.getState().set(null);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const done = setTimeout(resolve, 80);
    entry.ref.measureInWindow((x, y, width, height) => {
      clearTimeout(done);
      useFlight.getState().set(width > 0 && height > 0 ? { id, uri: entry.uri, x, y, width, height } : null);
      resolve();
    });
  });
}
