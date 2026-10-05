// Clip config shape. All times are SECONDS. `start`/`duration` are relative
// to the clip; `at` inside taps/scroll/zoom is relative to the scene's start.
// Screen coordinates (taps, scroll, zoom focus) are in SCREENSHOT pixels:
// phone screens are 1170×2532 (390×844 CSS @3x), desktop 2880×1800 (1440×900 @2x).

export type Format = "vertical" | "landscape";

export type Tap = { x: number; y: number; at: number };

/** Pan the screenshot vertically: top edge of the visible window moves from→to (screenshot px). */
export type Scroll = { from: number; to: number; at?: number; duration?: number };

/** Zoom toward a focus point (screenshot px), which ends centred in the frame. */
export type Zoom = { x: number; y: number; scale: number; at?: number; duration?: number };

type SceneBase = {
  start: number;
  duration: number;
  /** Fraunces headline shown with the scene. */
  onScreen?: string;
  /** Shows the "Demo store" pill (any screen showing Akosua Ntoma). */
  demo?: boolean;
  /** Step chips (e.g. Register · Get verified · Pick a plan) and which one is lit. */
  chips?: string[];
  activeChip?: number;
};

export type ScreenScene = SceneBase & {
  kind: "phone" | "desktop";
  /** File name under public/screens/. */
  screen: string;
  scroll?: Scroll;
  zoom?: Zoom;
  taps?: Tap[];
};

export type HookTextScene = SceneBase & { kind: "hook-text"; text: string };

export type ChatStackScene = SceneBase & {
  kind: "chat-stack";
  /** The repeated incoming message. */
  message: string;
  /** Counter climbs from 1 to this. */
  countTo: number;
};

export type EndCardScene = SceneBase & { kind: "end-card"; headline: string; url: string };

export type Scene = ScreenScene | HookTextScene | ChatStackScene | EndCardScene;

/** Burned-in caption (the script's voiceover, verbatim). Max 2 lines. */
export type Caption = { start: number; end: number; text: string };

export type Clip = {
  id: string;
  /** Source script + clip, for humans. */
  source: string;
  duration: number;
  scenes: Scene[];
  captions: Caption[];
};

export const PHONE_SCREEN = { w: 1170, h: 2532 };
export const DESKTOP_SCREEN = { w: 2880, h: 1800 };
