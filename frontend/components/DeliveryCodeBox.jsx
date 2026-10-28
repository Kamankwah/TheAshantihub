import { C } from "../theme.js";

// The customer's delivery code, shown only from pickup onwards (the server sends it from assignment,
// but a code that cannot be used yet is only a risk). It is the customer's alone: it is read to the
// rider at the door, never to AshantiHub or the business, and there is deliberately no contact action.
const SHOW_FROM = ["picked_up", "at_customer"];

export default function DeliveryCodeBox({ code, assignmentStatus }) {
  if (!code || !SHOW_FROM.includes(assignmentStatus)) return null;
  const spaced = String(code).split("").join(" ");
  return (
    <div data-testid="delivery-code-box" style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12, background: C.canvas, border: `1.5px solid ${C.gold}` }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 800, color: C.deepGold, textTransform: "uppercase", letterSpacing: "0.06em" }}>Delivery code</div>
      <div aria-label={`Delivery code ${spaced}`} style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: "2rem", fontWeight: 700, letterSpacing: "0.3em", color: C.ink, margin: "4px 0" }}>{spaced}</div>
      <div style={{ fontSize: "0.72rem", color: C.ink, lineHeight: 1.5 }}>
        Give this code to the rider only when your order is in your hands. AshantiHub will never ask for it by phone or message.
      </div>
    </div>
  );
}
