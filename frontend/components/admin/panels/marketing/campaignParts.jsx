import { D } from "../../theme.js";
import { dim } from "./mkParts.jsx";

// Shared by the campaign screens (02 Campaigns, 03 New campaign, 04 Calendar, 18 Results).
export const STATUS = {
  draft: ["Draft", D.textDim], waiting_approval: ["Waiting for Super Admin", D.amber], scheduled: ["Scheduled", D.blue],
  sending: ["Sending", D.blue], sent: ["Sent", D.green], withdrawn: ["Withdrawn", D.textDim], failed: ["Failed", D.red],
};
export const CHANNELS = [["sms", "SMS"], ["whatsapp", "WhatsApp"], ["email", "Email"], ["inapp", "In-app"]];

export const whenText = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Accra" }) : "—");
export const costText = (c) => (c.free_channel ? "No charge" : c.cost_known ? `GH₵ ${c.est_cost}${c.status === "sent" ? "" : " est."}` : "Unknown");

// A server check {key, title, detail, state: ok|warn|block} -> the CheckList shape.
export const asChecks = (checks) => checks.map((c) => ({ key: c.key, label: c.title, detail: c.detail, status: { ok: "pass", warn: "warn", block: "fail" }[c.state] }));

export function ApprovalNote({ children }) {
  return <div role="note" style={{ ...dim, lineHeight: 1.5, border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "10px 12px", background: D.goldSoft, color: D.text }}>{children}</div>;
}
