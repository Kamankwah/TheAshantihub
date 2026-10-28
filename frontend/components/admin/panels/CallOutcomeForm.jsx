import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { walletMessage } from "../../wallet/walletErrors.js";
import { D, glassCard } from "../theme.js";
import { button, callout, dim, field } from "./panelStyles.js";

// ─── Record the verification call ────────────────────────────────────────────
// One form for an order or a booking sale. "Matches" releases the business's money at once: the server asks for
// the password again (403 sudo_required), which apiClient's SudoPrompt answers before retrying this same POST. The
// "I spoke to the customer" tick is shown whenever the customer has not confirmed receipt in the app, or the only
// confirmation was the organiser's scan; it is never pre-ticked. Every result line comes from the server's answer.
const MAX_NOTE = 500;
const OUTCOMES = [
  ["matches", "Matches: release the money now"],
  ["does_not_match", "Does not match: open a dispute"],
  ["unreachable", "Could not reach the customer"],
];
const PATHS = { order: "orders", booking: "bookings" };

export function resultLine(answer) {
  if (answer?.released) return "Released to the business.";
  if (answer?.dispute_id) return `Dispute #${answer.dispute_id} opened.`;
  return "Recorded. It stays on the list.";
}

export default function CallOutcomeForm({ subject, id, customerConfirmed, confirmedByScan = false, onDone }) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [spoke, setSpoke] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const needsTick = outcome === "matches" && (!customerConfirmed || confirmedByScan);
  const trimmed = note.trim();
  const ready = Boolean(outcome) && (outcome !== "does_not_match" || trimmed.length > 0) && (!needsTick || spoke);
  const submit = async (e) => {
    e.preventDefault();
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const answer = await apiPost(`/api/ledger/${PATHS[subject]}/${id}/verification/`, {
        outcome, note: trimmed, ...(needsTick && spoke && { customer_confirmed_by_phone: true }),
      });
      await queryClient.invalidateQueries({ queryKey: ["ledger-verification"] });
      onDone?.(resultLine(answer));
      return;
    } catch (err) {
      setError(walletMessage(err).text);
      if (err?.status === 409 || err?.status === 400) queryClient.invalidateQueries({ queryKey: ["ledger-verification"] });
    }
    inFlight.current = false;
    setBusy(false);
  };
  return (
    <form onSubmit={submit} style={{ ...glassCard, padding: 12, display: "flex", flexDirection: "column", gap: 8, border: `1px solid ${D.cardBorder}` }}>
      <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <legend style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem", padding: 0, marginBottom: 6 }}>What did the customer say?</legend>
        {OUTCOMES.map(([value, label]) => (
          <label key={value} style={{ display: "flex", gap: 8, alignItems: "center", color: D.text, fontSize: "0.82rem" }}>
            <input type="radio" name={`outcome-${subject}-${id}`} value={value} checked={outcome === value} onChange={() => setOutcome(value)} />
            {label}
          </label>
        ))}
        {outcome === "matches" && <div style={dim}>This pays the business now. You will be asked for your password.</div>}
        {needsTick && (
          <label style={{ display: "flex", gap: 8, alignItems: "center", color: D.text, fontSize: "0.82rem", fontWeight: 700 }}>
            <input type="checkbox" checked={spoke} onChange={(e) => setSpoke(e.target.checked)} />
            I spoke to the customer and they confirmed they received it
          </label>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: 4, color: D.text, fontSize: "0.8rem", fontWeight: 700 }}>
          Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={MAX_NOTE} style={field} />
        </label>
        {outcome === "does_not_match" && <span style={dim}>A note is required to open a dispute.</span>}
      </fieldset>
      {error && <div role="alert" style={callout(D.red)}>{error}</div>}
      <div>
        <button type="submit" disabled={!ready || busy} style={button(D.gold, D.text, !ready || busy)}>Submit</button>
      </div>
    </form>
  );
}
