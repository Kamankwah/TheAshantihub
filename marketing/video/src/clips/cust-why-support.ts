import type { Clip } from "../types";
import { captionsOf, durationOf } from "../voiceover";

// docs/marketing/customer-script.md — Clip 3 "Why can't I just WhatsApp the seller?".
export const custWhySupport: Clip = {
  id: "cust-why-support",
  source: "customer-script.md · Clip 3",
  duration: durationOf("cust-why-support"),
  scenes: [
    { kind: "hook-text", start: 0, duration: 4.4, text: "“Why can’t I WhatsApp the seller?”" },
    {
      kind: "phone",
      start: 4.4,
      duration: 4.6,
      screen: "cust-listing.png",
      demo: true,
      onScreen: "Every question goes through Support",
      // Push in on title, price and Contact Support; keeps AshantiHub's own
      // floating WhatsApp bubble (bottom-right) out of this clip's frame.
      zoom: { x: 366, y: 1735, scale: 1.6, at: 0.3, duration: 1.4 }, // x=366 pins the left edge so the title isn't clipped
      taps: [{ x: 255, y: 1946, at: 3.4 }], // Contact Support
    },
    { kind: "phone", start: 9, duration: 5.2, screen: "cust-support-chat.png", demo: true, onScreen: "We talk to the business for you" },
    { kind: "phone", start: 14.2, duration: 3.8, screen: "cust-support-reply.png", demo: true, onScreen: "A record of everything promised" },
    { kind: "phone", start: 18, duration: 4.2, screen: "cust-cart.png", demo: true, onScreen: "Fraud kept out, for everyone" },
    { kind: "end-card", start: 22.2, duration: 5.8, headline: "Safer shopping, by design.", url: "theashantihub.com" },
  ],
  captions: captionsOf("cust-why-support"),
};
