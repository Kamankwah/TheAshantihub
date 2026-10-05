import type { Clip } from "../types";
import { captionsOf, durationOf } from "../voiceover";

// docs/marketing/business-script.md — Clip 3 "Is this still available?".
export const bizEnquiries: Clip = {
  id: "biz-enquiries",
  source: "business-script.md · Clip 3",
  duration: durationOf("biz-enquiries"),
  scenes: [
    { kind: "chat-stack", start: 0, duration: 5.1, message: "Is this still available?", countTo: 47, onScreen: "“Is this still available?”" },
    // The staff app at phone size: Support answers the customer's question.
    { kind: "phone", start: 5.1, duration: 4.5, screen: "staff-inbox-phone.png", demo: true, onScreen: "AshantiHub Support handles it" },
    // What the customer sees: an answer from Support, relayed on the business's behalf.
    { kind: "phone", start: 9.6, duration: 5, screen: "cust-support-reply.png", demo: true, onScreen: "Your number stays private" },
    { kind: "phone", start: 14.6, duration: 6.4, screen: "biz-dash-orders.png", demo: true, onScreen: "Real customers order and book from your page" },
    { kind: "end-card", start: 21, duration: 6, headline: "Less chasing. More selling.", url: "theashantihub.com" },
  ],
  captions: captionsOf("biz-enquiries"),
};
