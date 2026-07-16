import { D, glassCard } from "../theme.js";

// Generic placeholder for the still-unbuilt nav tabs (Disputes, Transactions
// Report, Messaging/Tickets, Analytics) — same "not yet built" note as before,
// just restyled onto the dark glass card. A follow-up will replace these with
// real panels once their backing endpoints land.
export default function ComingSoonPanel({ feature }) {
  return (
    <div style={{ ...glassCard, padding: "40px 24px", textAlign: "center" }}>
      <div style={{ fontSize: "2rem", marginBottom: 10 }}>🚧</div>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>Coming soon</div>
      <div style={{ color: D.textDim, fontSize: "0.78rem" }}>{feature} isn't built yet.</div>
    </div>
  );
}
