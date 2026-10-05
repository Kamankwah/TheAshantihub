import type { Clip } from "../types";
import { captionsOf, durationOf } from "../voiceover";

// docs/marketing/business-script.md — Clip 1 "Nothing to pay to start".
const CHIPS = ["Register", "Get verified", "Pick a plan"];

export const bizFreeStart: Clip = {
  id: "biz-free-start",
  source: "business-script.md · Clip 1",
  duration: durationOf("biz-free-start"),
  scenes: [
    { kind: "hook-text", start: 0, duration: 4.4, text: "GHS *0* to join" },
    { kind: "phone", start: 4.4, duration: 3.2, screen: "reg-01-account.png", demo: true, chips: CHIPS, activeChip: 0, taps: [{ x: 585, y: 1155, at: 2.3 }] }, // Continue
    { kind: "phone", start: 7.6, duration: 4, screen: "reg-02-business-info.png", demo: true, chips: CHIPS, activeChip: 1, scroll: { from: 0, to: 480, at: 0.3, duration: 2.6 }, taps: [{ x: 585, y: 1785, at: 3.1 }] }, // Continue
    { kind: "phone", start: 11.6, duration: 4.8, screen: "reg-03-plan.png", demo: true, chips: CHIPS, activeChip: 2, taps: [{ x: 585, y: 1016, at: 1.6 }] }, // Product Basic
    { kind: "phone", start: 16.4, duration: 3.6, screen: "store-listing.png", demo: true, onScreen: "Plans from GHS 10/month", scroll: { from: 0, to: 360, at: 0.3, duration: 2.6 } },
    { kind: "phone", start: 20, duration: 4.4, screen: "biz-dash-order.png", demo: true, onScreen: "Plans from GHS 10/month" },
    { kind: "end-card", start: 24.4, duration: 5.6, headline: "Your first cycle’s on us.", url: "theashantihub.com" },
  ],
  captions: captionsOf("biz-free-start"),
};
