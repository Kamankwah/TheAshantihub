import { useRef, useState } from "react";
import { D, tint } from "../dashboard/theme.js";
import { apiPost } from "../../apiClient.js";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { useBookingTerms } from "../../hooks/useBookingTerms.js";
import { useCancelQuote } from "../../hooks/useCancelQuote.js";
import { payeeWord, policyLabel, policyLines } from "./bookingMoney.js";

// Inline confirmation before a customer cancels a service, stay or ticket purchase. With the ledger on (`money`), the
// exact refund comes from the server's quote and the confirm button only appears once it is known; the amount shown
// afterwards is the cancel response's `wallet_refund`, never the quote. With the ledger off (`money` null) nothing is
// refunded in the app and the dialog says so.
const pill = (bg, color) => ({ background: bg, color, border: "none", borderRadius: 20, padding: "8px 16px", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit" });
const money_ = { color: D.text, fontWeight: 800, fontVariantNumeric: "tabular-nums" };
const line = { color: D.textDim, fontSize: "0.74rem" };

const HEADING = {
  service: () => "Cancel this service?",
  stay: () => "Cancel this booking?",
  tickets: (n) => (n === 1 ? "Cancel this ticket?" : `Cancel all ${n} tickets in this purchase?`),
};
const CONFIRM = { service: "Cancel service", stay: "Cancel booking", tickets: "Cancel tickets" };

export default function CancelBookingDialog({ kind, money, cancelPath, ticketCount = 1, paid = false, onDone, onClose }) {
  const terms = useBookingTerms();
  const quote = useCancelQuote(money?.sale, { enabled: !!money });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const inFlight = useRef(false);
  const P = payeeWord(kind);

  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setActionError(null);
    setBusy(true);
    try {
      const body = await apiPost(cancelPath, {});
      onDone({ refunded: body?.wallet_refund ?? null });
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not cancel. Nothing was changed."));
      inFlight.current = false;
      setBusy(false);
    }
  };

  let policyBlock = null;
  let quoteBlock = null;
  let canConfirm = false;
  if (money) {
    const label = policyLabel(money.policy, terms.data);
    policyBlock = (
      <>
        {money.policy?.text && <div style={line}>{label ? `${label}: ${money.policy.text}` : money.policy.text}</div>}
        {policyLines(money).map((l) => <div key={l} style={line}>{l}</div>)}
      </>
    );
    if (quote.isError) {
      const status = quote.error?.status;
      if (status >= 400 && status < 500) {
        quoteBlock = <div role="alert" style={{ color: D.red, fontSize: "0.74rem" }}>{apiErrorMessage(quote.error, "This booking cannot be cancelled here.")}</div>;
      } else {
        quoteBlock = (
          <div role="alert" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: D.red, fontSize: "0.74rem" }}>Could not check what you get back. Try again.</span>
            <button type="button" onClick={() => quote.refetch()} style={pill(D.panelBg2, D.text)}>Try again</button>
          </div>
        );
      }
    } else if (quote.data) {
      canConfirm = true;
      quoteBlock = (
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={line}><span style={money_}>GH₵ {quote.data.refund}</span> goes back to your AshantiHub wallet.</div>
          {!quote.data.whole && <div style={line}>The {P} keeps the rest under this policy.</div>}
        </div>
      );
    } else {
      quoteBlock = <div role="status" style={line}>Checking what you get back…</div>;
    }
  } else {
    canConfirm = true;
    quoteBlock = (
      <>
        <div style={line}>This cancels your booking and frees the dates.</div>
        {paid && <div style={line}>No refund is made in the app. Contact AshantiHub Support about your payment.</div>}
      </>
    );
  }

  return (
    <div role="dialog" aria-label="Cancel this booking" style={{ marginTop: 10, padding: 12, borderRadius: 12, border: `1px solid ${D.cardBorder}`, background: D.panelBg2, display: "flex", flexDirection: "column", gap: 8 }}>
      <h4 style={{ margin: 0, color: D.text, fontSize: "0.82rem" }}>{HEADING[kind](ticketCount)}</h4>
      {policyBlock}
      {quoteBlock}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.74rem" }}>{actionError}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canConfirm && <button type="button" disabled={busy} onClick={confirm} style={pill(tint(D.red, "22"), D.red)}>{CONFIRM[kind]}</button>}
        <button type="button" disabled={busy} onClick={onClose} style={pill(D.panelBg2, D.textDim)}>Keep it</button>
      </div>
    </div>
  );
}
