import { D } from "../theme.js";

// Overview tab's "Quick actions" card (sketch analog). Every entry is a
// tab-jump shortcut to a real, already-existing action in this dashboard —
// there is no "create new listing" flow anywhere in the frontend, so this
// deliberately does NOT invent a fabricated one-click-create button.
const ACTIONS = [
  { id: "events", icon: "📅", label: "Submit an Event", sub: "Add a new event" },
  { id: "listings", icon: "🏷️", label: "Manage Listings", sub: "Edit, promote, price" },
  { id: "payments", icon: "💳", label: "View Payments", sub: "Transactions & plan" },
  { id: "credit", icon: "🏅", label: "Apply for Credit", sub: "Check your score" },
];

export default function QuickActionGrid({ onNavigate }) {
  if (!onNavigate) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
      {ACTIONS.map((a) => (
        <button key={a.id} onClick={() => onNavigate(a.id)} style={{
          textAlign: "left", padding: 14, borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
          background: D.panelBg, border: `1px solid ${D.cardBorder}`,
        }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: D.goldSoft, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.05rem", marginBottom: 8 }}>{a.icon}</div>
          <div style={{ fontWeight: 800, fontSize: "0.8rem", color: D.text }}>{a.label}</div>
          <div style={{ fontSize: "0.68rem", color: D.textDim, marginTop: 2 }}>{a.sub}</div>
        </button>
      ))}
    </div>
  );
}
