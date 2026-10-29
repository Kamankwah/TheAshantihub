import { C } from "../../theme.js";
import { HEADING_FONT } from "../storefront/storefrontType.js";
import { D, glassCard } from "../dashboard/theme.js";

const button = { borderRadius: 10, padding: "10px 18px", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" };

// Only features that exist today: the Ashanti-region shopper base, the Verified business
// badge a business earns after KYC, and payouts through the AshantiHub wallet.
const WHY = [
  "Reach shoppers across the Ashanti region.",
  "A Verified business badge once your identity check (KYC) is approved.",
  "Get paid to mobile money or bank through your AshantiHub wallet.",
];

// "Sell on AshantiHub": welcomes the signed-in customer and starts business registration,
// with their name, phone and email filled in or from scratch. A business is a separate
// account type, so registering never changes the shopping account.
export default function SellOnAshantiHub({ user, onStart }) {
  const name = user?.fullName || "there";
  return (
    <div className="ah-sell" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16, alignItems: "start" }}>
      <div style={{ ...glassCard, padding: 20, display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0, fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.2rem", color: D.text }}>{`Welcome, ${name}`}</h2>
        <dl style={{ margin: 0, display: "grid", gap: 6, fontSize: "0.85rem" }}>
          {user?.email && <div style={{ display: "flex", gap: 8 }}><dt style={{ color: D.textDim }}>Email</dt><dd style={{ margin: 0, color: D.text, fontWeight: 700 }}>{user.email}</dd></div>}
          {user?.phone && <div style={{ display: "flex", gap: 8 }}><dt style={{ color: D.textDim }}>Phone</dt><dd style={{ margin: 0, color: D.text, fontWeight: 700 }}>{user.phone}</dd></div>}
        </dl>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" onClick={() => onStart?.({ full_name: user?.fullName || "", phone: user?.phone || "", email: user?.email || "" })} style={{ ...button, background: D.gold, color: D.darkBrown, border: "none" }}>Use my details</button>
          <button type="button" onClick={() => onStart?.(null)} style={{ ...button, background: "none", color: D.text, border: `1px solid ${D.divider}` }}>Start with different details</button>
        </div>
        <p style={{ margin: 0, fontSize: "0.78rem", color: D.textDim }}>This creates a separate business login.</p>
      </div>
      <div style={{ ...glassCard, padding: 20 }}>
        <h2 style={{ margin: "0 0 10px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.1rem", color: D.text }}>Why sell on AshantiHub</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8, color: C.ink, fontSize: "0.85rem", lineHeight: 1.5 }}>
          {WHY.map((w) => <li key={w}>{w}</li>)}
        </ul>
      </div>
      <style>{`@media (max-width: 760px) { .ah-sell { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
