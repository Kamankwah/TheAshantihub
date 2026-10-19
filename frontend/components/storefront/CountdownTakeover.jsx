import { useState } from "react";
import { C } from "../../theme.js";
import { useOpening } from "../../hooks/useOpening.js";
import { opensHeadline, splitRemaining } from "../../lib/openingFormat.js";
import NotifyMeForm from "./NotifyMeForm.jsx";
import { BODY_FONT, HEADING_FONT, TABULAR } from "./storefrontType.js";

// The opening-day takeover (spec mockup "A"): a full-width dark-brown band at
// the top of the marketplace home with a server-timed countdown in four boxed
// units and one gold "Notify me" button that opens the form inline. Renders
// nothing while loading and once the marketplace is open (or the gate is off).
// No animation, so there is nothing to tone down for prefers-reduced-motion.
const UNITS = [
  ["days", "Days"],
  ["hours", "Hours"],
  ["minutes", "Minutes"],
  ["seconds", "Seconds"],
];

const pad = (n) => String(n).padStart(2, "0");

export default function CountdownTakeover({ onNotify }) {
  const { isOpen, opensAt, remainingMs, loading } = useOpening();
  const [formOpen, setFormOpen] = useState(false);
  if (loading || isOpen) return null;

  const parts = splitRemaining(remainingMs);

  return (
    <section
      aria-labelledby="ah-countdown-heading"
      style={{ background: C.darkBrown, color: C.cream, fontFamily: BODY_FONT, borderBottom: `1px solid ${C.gold}33` }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "28px 16px 32px", boxSizing: "border-box" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.lightGold, opacity: 0.8, marginBottom: 8 }}>
          Opening day
        </div>
        <h2
          id="ah-countdown-heading"
          style={{ margin: "0 0 20px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "clamp(1.5rem, 4.6vw, 2.25rem)", lineHeight: 1.1, letterSpacing: "-0.02em", color: C.cream }}
        >
          {opensHeadline(opensAt)}
        </h2>

        <div
          role="timer"
          aria-label={`${parts.days} days, ${parts.hours} hours, ${parts.minutes} minutes left`}
          style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, maxWidth: 520, marginBottom: 20 }}
        >
          {UNITS.map(([key, label]) => (
            <div key={key} style={{ background: C.void, border: `1px solid ${C.gold}55`, borderRadius: 12, padding: "12px 4px 10px", textAlign: "center", minWidth: 0 }}>
              <div
                data-testid={`countdown-${key}`}
                style={{ fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "clamp(1.75rem, 8vw, 3rem)", lineHeight: 1, color: C.gold, ...TABULAR }}
              >
                {pad(parts[key])}
              </div>
              <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: C.lightGold, opacity: 0.8 }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          aria-expanded={formOpen}
          onClick={() => { setFormOpen((open) => !open); if (onNotify) onNotify(); }}
          style={{ minHeight: 44, padding: "10px 24px", borderRadius: 12, border: "none", background: C.gold, color: C.darkBrown, fontFamily: BODY_FONT, fontSize: 15, fontWeight: 700, cursor: "pointer" }}
        >
          Notify me
        </button>

        {formOpen && <NotifyMeForm style={{ marginTop: 16, maxWidth: 520 }} />}
      </div>
    </section>
  );
}
