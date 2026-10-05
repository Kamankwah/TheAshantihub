import type { Clip } from "../types";
import { captionsOf, durationOf } from "../voiceover";

// docs/marketing/customer-script.md — Clip 3 "Why can't I just WhatsApp the seller?".
export const custWhySupport: Clip = {
  id: "cust-why-support",
  source: "customer-script.md · Clip 3",
  duration: durationOf("cust-why-support"),
  scenes: [
    { kind: "hook-text", start: 0, duration: 3.5, text: "“Why can’t I WhatsApp the seller?”" },
    {
      kind: "phone",
      start: 3.5,
      duration: 6.5,
      screen: "cust-listing.png",
      demo: true,
      onScreen: "Every question goes through Support",
      // Push in on title, price and Contact Support; keeps AshantiHub's own
      // floating WhatsApp bubble (bottom-right) out of this clip's frame.
      zoom: { x: 366, y: 1735, scale: 1.6, at: 0.3, duration: 1.4 }, // x=366 pins the left edge so the title isn't clipped
      taps: [{ x: 255, y: 1946, at: 4.4 }], // Contact Support
    },
    { kind: "phone", start: 10, duration: 7, screen: "cust-support-chat.png", demo: true, onScreen: "We talk to the business for you" },
    { kind: "phone", start: 17, duration: 8, screen: "cust-support-reply.png", demo: true, onScreen: "A record of everything promised" },
    { kind: "phone", start: 25, duration: 9, screen: "cust-cart.png", demo: true, onScreen: "Fraud kept out, for everyone" },
    { kind: "end-card", start: 34, duration: 6, headline: "Safer shopping, by design.", url: "theashantihub.com" },
  ],
  captions: captionsOf("cust-why-support"),
};
