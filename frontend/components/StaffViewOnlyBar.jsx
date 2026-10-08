import { C } from "../theme.js";

// Height App.jsx offsets the marketplace by (root padding-top and the
// `--ah-top-offset` custom property the sticky Navbar / ScrollSpyTabs read),
// so the bar never covers the Navbar.
export const STAFF_VIEW_ONLY_BAR_HEIGHT = 40;

// Thin fixed bar shown above the marketplace whenever a staff session is off
// /staff ("View site" from the dashboard). Quiet, neutral chrome per DESIGN.md
// — cream field, dark-brown text, thin gold-tinted rule, no kente, no gold
// fill — because it is a status line, not a call to action. At phone width
// the label and the dashboard button shorten so everything fits on one line
// at 320px; the button keeps its full accessible name either way.
export default function StaffViewOnlyBar({ onBackToDashboard, onSignOut }) {
  return (
    <div role="region" aria-label="Staff session, view only" style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 150, height: STAFF_VIEW_ONLY_BAR_HEIGHT, boxSizing: "border-box",
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
      paddingLeft: "max(12px, env(safe-area-inset-left, 0px))", paddingRight: "max(12px, env(safe-area-inset-right, 0px))",
      background: C.cream, color: C.darkBrown, borderBottom: `1px solid ${C.gold}66`,
      fontSize: "0.74rem",
    }}>
      <span style={{ fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
        <span className="ah-staff-bar-long">Staff session · view only</span>
        <span className="ah-staff-bar-short">Staff · view only</span>
      </span>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button type="button" aria-label="Back to dashboard" onClick={onBackToDashboard} style={{ ...barButton, background: C.white, border: `1px solid ${C.gold}66` }}>
          <span className="ah-staff-bar-long">Back to dashboard</span>
          <span className="ah-staff-bar-short">Dashboard</span>
        </button>
        <button type="button" onClick={onSignOut} style={{ ...barButton, background: "transparent", border: `1px solid ${C.darkBrown}33` }}>
          Sign out
        </button>
      </div>
      <style>{`
        .ah-staff-bar-short { display: none; }
        @media (max-width: 480px) {
          .ah-staff-bar-long { display: none; }
          .ah-staff-bar-short { display: inline; }
        }
      `}</style>
    </div>
  );
}

const barButton = {
  color: C.darkBrown, borderRadius: 999, padding: "0 12px", minHeight: 30,
  fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
};
