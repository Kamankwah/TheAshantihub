import { C } from "../theme.js";
import { D } from "./dashboard/theme.js";
import { STAFF_GATE_MESSAGE } from "../lib/staffSession.js";

// The one notice a staff session sees in place of any marketplace buy/sell/
// book/create action (lib/staffSession.js). Neutral chrome per DESIGN.md's
// trust-surface rules: cream field, dark-brown text, thin gold-tinted border,
// no motion. Inline by default; `floating` pins it under the top chrome for
// actions whose button lives in a shared band with no room for an inline
// message (the "Register Your Business" / "Submit an Event" CTAs). It is an
// assertive alert when it answers a click; `passive` placements that are
// simply on the page from the start (a review box, /register) use a polite
// status instead so a page load doesn't interrupt a screen reader.
export default function StaffGateNotice({ floating = false, passive = false, onDismiss, style }) {
  const notice = (
    <div role={passive ? "status" : "alert"} style={{
      display: "flex", alignItems: "center", gap: 10,
      background: C.cream, color: C.darkBrown, border: `1px solid ${C.gold}66`, borderRadius: 12,
      padding: "10px 14px", fontSize: "0.8rem", fontWeight: 700, lineHeight: 1.5, textAlign: "left",
      boxShadow: floating ? D.shadow : "none",
      ...style,
    }}>
      <span style={{ flex: 1 }}>{STAFF_GATE_MESSAGE}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss notice"
          style={{ background: "none", border: "none", color: C.darkBrown, opacity: 0.6, cursor: "pointer", fontSize: "0.95rem", minWidth: 32, minHeight: 32, fontFamily: "inherit" }}>
          ✕
        </button>
      )}
    </div>
  );
  if (!floating) return notice;
  return (
    <div style={{
      position: "fixed", left: 12, right: 12, zIndex: 1100, display: "flex", justifyContent: "center", pointerEvents: "none",
      top: "calc(var(--ah-top-offset, 0px) + 88px)",
    }}>
      <div style={{ width: "100%", maxWidth: 440, pointerEvents: "auto" }}>{notice}</div>
    </div>
  );
}
