import { D, glassCard } from "../theme.js";

// Promotions went live as a business-owner self-serve feature in
// docs/BUSINESS_EVENTS_ROADMAP.md Phase 5 (BusinessCommandCenter's Listings &
// Prices tab — "📣 Promote"), so a ComingSoonPanel placeholder here would be
// actively misleading to staff. There's no backend "list all promotions"
// endpoint in this phase's scope (only the purchase endpoint and the
// `is_promoted` flag on listings), so this stays a minimal informational
// panel rather than a fabricated admin promotions-management UI.
export default function PromotionsInfoPanel() {
  return (
    <div style={{ ...glassCard, padding: "40px 24px", textAlign: "center" }}>
      <div style={{ fontSize: "2rem", marginBottom: 10 }}>📣</div>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>Promotions are self-serve</div>
      <div style={{ color: D.textDim, fontSize: "0.78rem", maxWidth: 420, margin: "0 auto" }}>Business owners now purchase Featured and Boost promotions directly from their own dashboard's Listings &amp; Prices tab. There's nothing for staff to manage here yet — a future phase may add an admin view of active promotions.</div>
    </div>
  );
}
