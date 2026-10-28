import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useBookingLookup } from "../../../hooks/useVerificationCalls.js";
import { walletMessage } from "../../wallet/walletErrors.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";

// ─── Cancel a booking (gate (lxxiii)) ────────────────────────────────────────
// Support finds a paid service, stay or ticket purchase and cancels it before it reaches the customer. The money goes
// back, whole, to the customer's AshantiHub wallet (not the payment processing charge). The lookup is NOT paginated
// ({results}, at most 20) and shows only the masked phone: no call link, because Support is not calling anyone here.
// Every amount and time comes from the server row; the refunded figure shown is the server's `refunded`.
const MIN_REASON = 3;
const MAX_REASON = 300;
const KIND_WORDS = { service: "Service", stay: "Stay", tickets: "Tickets" };
const figures = { fontVariantNumeric: "tabular-nums" };
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GH") : "—");

function CancelForm({ sale, onDone }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const trimmed = reason.trim();
  const ready = trimmed.length >= MIN_REASON;
  const submit = async (e) => {
    e.preventDefault();
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const answer = await apiPost(`/api/ledger/bookings/${sale.sale_id}/cancel/`, { reason: trimmed });
      await queryClient.invalidateQueries({ queryKey: ["ledger-verification"] });
      onDone(`Cancelled. GH₵ ${answer.refunded} went back to the customer's AshantiHub wallet.`);
      return;
    } catch (err) {
      setError(walletMessage(err).text);
      if (err?.status === 409) queryClient.invalidateQueries({ queryKey: ["ledger-verification"] });
    }
    inFlight.current = false;
    setBusy(false);
  };
  return (
    <form onSubmit={submit} style={{ ...glassCard, padding: 12, display: "flex", flexDirection: "column", gap: 8, border: `1px solid ${D.cardBorder}` }}>
      <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, color: D.text, fontSize: "0.8rem", fontWeight: 700 }}>
          Reason for cancelling
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={MAX_REASON} style={field} />
        </label>
        <span style={{ ...dim, ...figures }}>{reason.length}/{MAX_REASON}</span>
        <div style={{ color: D.text, fontSize: "0.82rem" }}>
          Refunds GH₵ {sale.amount} to {sale.customer_name}'s AshantiHub wallet. The payment processing charge is not refunded. The customer and the business are told.
        </div>
      </fieldset>
      {error && <div role="alert" style={callout(D.red)}>{error}</div>}
      <div><button type="submit" disabled={!ready || busy} style={button(D.gold, D.text, !ready || busy)}>Cancel and refund</button></div>
    </form>
  );
}

function SaleRow({ sale, open, onToggle, onDone }) {
  return (
    <li style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 8, listStyle: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={chip(D.textDim)}>{KIND_WORDS[sale.kind] || sale.kind}</span>
          <span style={{ color: D.text, fontWeight: 800 }}>{sale.what}</span>
        </div>
        <span style={{ color: D.text, fontWeight: 800, ...figures }}>GH₵{sale.amount}</span>
      </div>
      <div style={{ color: D.text, fontSize: "0.85rem" }}>{sale.business}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", color: D.text, fontSize: "0.85rem" }}>
        <span>{sale.customer_name}</span>
        <span style={figures}>{sale.customer_phone}</span>
      </div>
      <div style={{ ...dim, ...figures }}>Paid {when(sale.paid_at)}</div>
      {sale.cancellable
        ? <div><button type="button" onClick={onToggle} aria-expanded={open} style={button(D.panelBg, D.text, false)}>Cancel booking…</button></div>
        : <div style={{ ...dim, ...figures }}>Received {when(sale.handed_over_at)}: a problem now is a dispute, not a cancel.</div>}
      {open && sale.cancellable && <CancelForm sale={sale} onDone={onDone} />}
    </li>
  );
}

export default function BookingCancelTab() {
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);
  const [notice, setNotice] = useState("");
  const query = useBookingLookup(q);
  const off = query.error && walletMessage(query.error).kind === "off";
  const rows = query.data?.results || [];
  return (
    <>
      <div style={dim}>Cancel a paid booking the customer has not received yet. Once it is received, it is a dispute.</div>
      <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setOpenId(null); setNotice(""); }}
        aria-label="Sale, service request or booking number, customer name or phone, business"
        placeholder="Sale, service request or booking number, customer name or phone, business" style={field} />
      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      {off ? <div role="status" style={dim}>Cancelling a booking opens when the ledger is switched on.</div>
        : query.error ? <div role="alert" style={callout(D.red)}>{walletMessage(query.error).text}</div>
        : !query.data ? <div role="status" style={dim}>Loading…</div>
        : !rows.length ? <div style={dim}>No open booking matches.</div>
        : <ul aria-label="Open bookings" style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((sale) => (
            <SaleRow key={sale.sale_id} sale={sale} open={openId === sale.sale_id}
              onToggle={() => { setNotice(""); setOpenId(openId === sale.sale_id ? null : sale.sale_id); }}
              onDone={(text) => { setOpenId(null); setNotice(text); }} />
          ))}
        </ul>}
    </>
  );
}
