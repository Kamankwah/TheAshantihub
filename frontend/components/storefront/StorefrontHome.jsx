import { C } from "../../theme.js";
import CountdownTakeover from "./CountdownTakeover.jsx";
import { BODY_FONT, HEADING_FONT } from "./storefrontType.js";

// The marketplace home at "/". This is the shell: the countdown takeover sits
// first until opening, then a short honest intro with a way into the browse
// page, then `children` — the slot where App.jsx places the home sections
// (Task 10 adds the hero slider, flash banner, deals and categories here).
// Colours come from the --ah-* CSS variables (index.css) so the header theme
// toggle restyles this surface; the fallbacks are the light `C` values.
export default function StorefrontHome({ onBrowse, children }) {
  return (
    <div data-testid="storefront-home" style={{ background: `var(--ah-canvas, ${C.cream})`, color: `var(--ah-ink, ${C.darkBrown})` }}>
      <CountdownTakeover />
      <section style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 16px", boxSizing: "border-box", fontFamily: BODY_FONT }}>
        <h1 style={{ margin: "0 0 8px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "clamp(1.75rem, 5vw, 2.5rem)", lineHeight: 1.1, letterSpacing: "-0.02em", color: `var(--ah-ink, ${C.darkBrown})` }}>
          AshantiHub marketplace
        </h1>
        <p style={{ margin: "0 0 20px", fontSize: 16, lineHeight: 1.5, color: `var(--ah-ink-dim, rgba(44,24,16,0.62))`, maxWidth: 560 }}>
          Shop from Kumasi businesses — products, services, stays and events.
        </p>
        {onBrowse && (
          <button
            type="button"
            onClick={onBrowse}
            style={{ minHeight: 44, padding: "10px 22px", borderRadius: 12, border: "none", background: C.gold, color: C.darkBrown, fontFamily: BODY_FONT, fontSize: 15, fontWeight: 700, cursor: "pointer" }}
          >
            Browse businesses
          </button>
        )}
      </section>
      {children}
    </div>
  );
}
