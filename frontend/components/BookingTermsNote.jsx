import { C } from "../theme.js";
import { D } from "./dashboard/theme.js";
import { useBookingTerms } from "../hooks/useBookingTerms.js";
import { formatAccra, hoursText, refundLines, stayStart } from "../lib/bookingTerms.js";

// ─── BookingTermsNote ───────────────────────────────────────────────────────
// Shown before a customer pays for a service, a stay or a ticket (ledger Plan 7E): when they can still cancel and for
// how much, and when the money is paid to the business. Everything comes from real data: the listing's cancellation
// policy (tiers from /api/ledger/booking-terms/), the stay's check-in date at the check-in time, the event date, and the
// governed release hours. A product shows nothing; so does a screen whose terms have not loaded, and so does every screen while the ledger is off (no refund or timed release runs then) (no placeholder numbers).
//   kind        "service" | "stay" | "ticket" | anything else (renders nothing)
//   policy      the listing's cancellation_policy (service and stay)
//   start       Date: stay check-in instant (use `stayStart`) or the event's date
//   refundDays  the event's refund_until_days_before (null = no refund after purchase)
//   tone        "dark" for the dark listing/event pages, "light" for the account panels
export default function BookingTermsNote({ kind, policy, start, refundDays, tone = "dark", now }) {
  const terms = useBookingTerms();
  if (!["service", "stay", "ticket"].includes(kind) || !terms.data || terms.data.enabled === false) return null;
  const t = terms.data;
  const at = now || new Date();
  const text = tone === "dark" ? "rgba(255,255,255,0.78)" : D.textDim;
  const strong = tone === "dark" ? C.lightGold : D.text;

  let cancel = [];
  let release = null;
  let extra = null;
  if (kind === "service") {
    // A service has no scheduled start, so the policy's dates do not apply: it is cancelled before it is done.
    cancel = ["Cancel for a full refund any time before the business marks the job done"];
    release = `When the job is done you can accept it or report a problem. If you do neither it is accepted automatically ${hoursText(t.service_auto_accept_hours)} after the business marks it done, and the business is paid then.`;
  } else if (kind === "stay") {
    const tiers = t.policies?.[policy]?.tiers;
    if (!tiers || !start) return null;
    cancel = refundLines(tiers, start, at);
    release = `The host is paid ${hoursText(t.stay_issue_window_hours)} after check-in time, on ${formatAccra(new Date(start.getTime() + t.stay_issue_window_hours * 3600 * 1000))}, unless you report a problem before then.`;
  } else {
    if (refundDays == null) {
      cancel = ["No refund after purchase"];
      extra = "Tickets are refunded in full if the event is cancelled.";
    } else if (start) {
      cancel = refundLines([[refundDays * 24, 10000]], start, at);
    } else return null;
    release = `The organiser is paid ${hoursText(t.event_release_delay_hours)} after the event day ends.`;
  }

  return (
    <div data-testid="booking-terms" style={{ marginTop: 10, marginBottom: 10, fontSize: "0.72rem", lineHeight: 1.5, color: text }}>
      {cancel.map((line) => <div key={line} style={{ color: strong, fontWeight: 800 }}>{line}</div>)}
      {extra && <div>{extra}</div>}
      <div>{release}</div>
    </div>
  );
}
