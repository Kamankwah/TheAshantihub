import { C } from "../../../theme.js";
import { BODY_FONT, HEADING_FONT } from "../storefrontType.js";

// One stacked section of the browse rail, Amazon's structure in AshantiHub's
// look: a Fraunces heading (focusable by script, so the collapsed rail's icon
// can land the reader on it), a "Clear" link only while the section holds a
// value, then the section's own options (children). `ah-rail-hit` gives the
// 40px / 44px-on-a-phone target from BrowseRail's scoped stylesheet.
export default function RailSection({ headingId, label, active, onClear, children }) {
  return (
    <section aria-labelledby={headingId} style={{ borderTop: `1px solid ${C.line}`, padding: "12px 0" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h3 id={headingId} tabIndex={-1} style={{ margin: 0, fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 16, lineHeight: 1.25, letterSpacing: "-0.01em", color: C.ink }}>
          {label}
        </h3>
        {active && onClear && (
          <button
            type="button"
            className="ah-rail-hit"
            onClick={onClear}
            aria-label={`Clear ${label}`}
            style={{ flexShrink: 0, padding: "0 4px", border: "none", background: "transparent", color: C.inkDim, fontFamily: BODY_FONT, fontSize: 13, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}
          >
            Clear
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
