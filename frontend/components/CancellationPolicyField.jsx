import { useId } from "react";
import { useBookingTerms } from "../hooks/useBookingTerms.js";

// ─── CancellationPolicyField ────────────────────────────────────────────────
// The vendor's choice of cancellation policy for a stay (a service has none: it is cancelled in full until done) (ledger Plan 7E). The customer is shown it, with
// exact times, before paying, and it is copied onto the sale when they pay. Required: it starts unanswered so the
// vendor decides on purpose. The rules come from /api/ledger/booking-terms/ (the same data the refund uses), so the
// words here can never drift from what is refunded. Never rendered for a product or an ordinary service.
//   value/onChange   the chosen policy name ("" until chosen)
//   label            the visible label (default carries the required star)
//   labelStyle/inputStyle/hintStyle   the host form's own styles (the form decides its palette)
export default function CancellationPolicyField({ value, onChange, label = "Cancellation policy *", labelStyle, inputStyle, hintStyle }) {
  const id = useId();
  const terms = useBookingTerms();
  const policies = terms.data?.policies || {};
  const names = Object.keys(policies);
  return (
    <div style={{ marginBottom: 10 }}>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      <select id={id} value={value || ""} onChange={(e) => onChange(e.target.value)} style={inputStyle} disabled={names.length === 0}>
        <option value="">{terms.isError ? "Could not load the policies" : "Choose a policy"}</option>
        {names.map((name) => <option key={name} value={name}>{`${policies[name].label}: ${policies[name].text}`}</option>)}
      </select>
      <div style={hintStyle}>
        {policies[value]?.text
          ? (terms.data?.enabled === false
            ? `Saved with the listing. Customers see it, with the exact times, once online refunds are switched on: ${policies[value].text}`
            : `Customers see this before they pay: ${policies[value].text}`)
          : "Customers see this, with the exact times, before they pay."}
      </div>
    </div>
  );
}
