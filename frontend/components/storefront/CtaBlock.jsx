import { C } from "../../theme.js";
import { BODY_FONT, HEADING_FONT, SECTION } from "./storefrontType.js";

// The call-to-action block at the foot of the home, in the spirit of Amazon's
// "Sign in for the best experience" band: a calm row of white cards. Signed
// out, the first card asks the visitor to sign in (the one gold button, which
// opens the auth modal through `onSignIn`). "Sell on AshantiHub" always shows
// and starts business registration through `onSell`. Every claim here is
// something the app does today.
export default function CtaBlock({ user, onSignIn, onSell }) {
  return (
    <section aria-label="Get started" style={{ ...SECTION, padding: "32px 16px 40px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {!user && (
          <div style={card}>
            <h2 style={title}>Sign in for the best experience</h2>
            <p style={copy}>Follow your orders, keep your account details in one place and message AshantiHub Support.</p>
            <button type="button" onClick={onSignIn} style={{ ...button, background: C.gold, color: C.darkBrown, border: "none" }}>Sign in</button>
          </div>
        )}
        <div style={card}>
          <h2 style={title}>Sell on AshantiHub</h2>
          <p style={copy}>Register your Kumasi business and list your products, services, stays or events. Every listing is reviewed by AshantiHub before it goes live.</p>
          <button type="button" onClick={onSell} style={{ ...button, background: "transparent", color: C.darkBrown, border: `1.5px solid ${C.darkBrown}` }}>Register your business</button>
        </div>
      </div>
    </section>
  );
}

const card = {
  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10, padding: "20px 20px 22px",
  borderRadius: 16, background: C.white, color: C.darkBrown, border: `1px solid ${C.gold}33`,
  boxShadow: "0 10px 28px rgba(44,24,16,0.12)", fontFamily: BODY_FONT,
};
const title = { margin: 0, fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 22, lineHeight: 1.15, letterSpacing: "-0.02em", color: C.darkBrown };
const copy = { margin: 0, fontSize: 15, lineHeight: 1.5, color: "rgba(44,24,16,0.72)", maxWidth: 440 };
const button = { minHeight: 44, padding: "10px 22px", borderRadius: 12, fontFamily: BODY_FONT, fontSize: 15, fontWeight: 700, cursor: "pointer", marginTop: 4 };
