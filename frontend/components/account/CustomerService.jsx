import { useNavigate } from "react-router-dom";
import { D, glassCard } from "../dashboard/theme.js";
import { ACCOUNT_ROOT } from "./accountNav.js";

const btn = { background: D.gold, color: D.darkBrown, border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" };
const ghost = { background: "none", color: D.text, border: `1px solid ${D.cardBorderStrong}`, borderRadius: 10, padding: "9px 16px", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" };

// Customer Service: help always goes through AshantiHub Support (never a business, never a
// phone number). `onContactSupport` opens a new Support conversation; `onOpenPage` goes to
// the About (FAQ) or Contact page, both App-owned.
export default function CustomerService({ onContactSupport, onOpenPage }) {
  const navigate = useNavigate();
  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 560 }}>
      <div style={{ ...glassCard, padding: 18 }}>
        <div style={{ fontWeight: 800, color: D.text, marginBottom: 4 }}>Talk to AshantiHub Support</div>
        <div style={{ color: D.textDim, fontSize: "0.8rem", marginBottom: 12 }}>Start a conversation with our support team. We reply in Your Messages.</div>
        <button type="button" style={btn} onClick={() => onContactSupport?.()}>🎧 Contact Support</button>
      </div>
      <div style={{ ...glassCard, padding: 18 }}>
        <div style={{ fontWeight: 800, color: D.text, marginBottom: 10 }}>Something wrong with an order?</div>
        <button type="button" style={ghost} onClick={() => navigate(`${ACCOUNT_ROOT}/orders`)}>Report a problem with an order</button>
      </div>
      <div style={{ ...glassCard, padding: 18 }}>
        <div style={{ fontWeight: 800, color: D.text, marginBottom: 10 }}>More help</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={ghost} onClick={() => onOpenPage?.("about")}>Read the FAQ</button>
          <button type="button" style={ghost} onClick={() => onOpenPage?.("contact")}>Contact page</button>
        </div>
      </div>
    </div>
  );
}
