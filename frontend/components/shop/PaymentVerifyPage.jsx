import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { C } from "../../theme.js";
import { apiFetch } from "../../apiClient.js";
import { BODY_FONT, HEADING_FONT, TABULAR } from "../storefront/storefrontType.js";

// Hubtel integration (docs/HUBTEL_INTEGRATION.md) — where a customer lands after paying, at /payment/return (Hubtel's
// hosted checkout, and every flow outside shopping: service requests, bookings, tickets, wallet top-ups) and at
// /checkout/verify (the Marketplace checkout). The redirect itself is never proof of payment: with a ?reference= this
// page polls GET /api/payments/checkout-sessions/{reference}/ — the only source of truth — until it leaves "pending".
// With only ?order= (a wallet or simulated checkout, already settled server-side) it reads GET /api/orders/{id}/ and
// reports the status the server gives. Neither → an error. The paying phone number is never shown.
//
// Moved from App.jsx's PaymentReturnPage; the 2 s poll and 60 s timeout are unchanged.
const PAYMENT_RETURN_POLL_INTERVAL_MS = 2000;
const PAYMENT_RETURN_TIMEOUT_MS = 60000;

const ERROR_COPY = "Could not check this payment's status. Please check your account for the latest status.";

const money = (v) => (v == null || v === "" ? null : `GHS ${v}`);
const hasFee = (v) => v != null && v !== "" && Number(v) > 0;

const btn = (primary) => ({
  width: "100%", boxSizing: "border-box", minHeight: 44, borderRadius: 10, fontFamily: BODY_FONT, fontWeight: 700,
  fontSize: "0.9rem", cursor: "pointer",
  background: primary ? C.gold : "transparent", color: primary ? C.darkBrown : C.ink,
  border: primary ? "none" : `1px solid ${C.line}`,
});

export default function PaymentVerifyPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const reference = params.get("reference") || "";
  const orderParam = params.get("order") || "";
  const [session, setSession] = useState(null);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    setSession(null); setOrder(null); setError(null); setTimedOut(false);
    if (!reference && !orderParam) { setError("No payment reference found in this link."); return undefined; }

    let cancelled = false;
    let timer = null;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled) return;
      try {
        const data = await apiFetch(`/api/payments/checkout-sessions/${encodeURIComponent(reference)}/`);
        if (cancelled) return;
        setSession(data);
        if (data.status !== "pending") return; // resolved — stop polling
        if (Date.now() - startedAt >= PAYMENT_RETURN_TIMEOUT_MS) { setTimedOut(true); return; }
        timer = setTimeout(poll, PAYMENT_RETURN_POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) setError(ERROR_COPY);
      }
    };
    const readOrder = async () => {
      try {
        const data = await apiFetch(`/api/orders/${encodeURIComponent(orderParam)}/`);
        if (!cancelled) setOrder(data);
      } catch {
        if (!cancelled) setError(ERROR_COPY);
      }
    };
    if (reference) poll(); else readOrder();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [reference, orderParam]);

  // One normalised view over whichever source answered.
  let status = null; // "pending" | "success" | "failed" | "expired"
  let isOrder = false;
  let kind = null;
  if (session) {
    status = session.status;
    kind = session.kind;
    isOrder = kind === "order_checkout";
  } else if (order) {
    isOrder = true;
    status = order.status === "pending" ? "pending" : order.status === "cancelled" ? "failed" : "success";
  }
  const orderId = session ? session.order_id : order ? order.id : null;
  const amount = session ? session.amount : order ? order.total_amount : null;
  const resolved = status && status !== "pending";
  const wallet = !!session?.wallet;

  const rows = [["Merchant", "AshantiHub"]];
  if (money(amount)) rows.push(["Amount", money(amount)]);
  if (session && hasFee(session.processing_fee)) rows.push(["Payment processing", money(session.processing_fee)]);
  if (session) rows.push(["Method", wallet ? "AshantiHub wallet" : "Mobile money"]);
  if (session?.reference) rows.push(["Reference", session.reference]);
  if (orderId != null) rows.push(["Order #", `#${orderId}`]);

  const headline = {
    success: ["Payment confirmed", C.okInk],
    failed: ["Payment failed", C.errInk],
    expired: ["Payment expired", C.warnInk],
  }[status];
  const failedBody = status === "expired"
    ? "This checkout session expired before payment was completed. Please try again."
    : "Your payment could not be completed. Please try again.";

  let pendingBody = null;
  if (status === "pending") {
    if (timedOut) pendingBody = "We are still waiting for the provider — check Your Orders for the latest status.";
    else if (order) pendingBody = "We are still waiting for the payment on this order. The status here is what AshantiHub has recorded.";
    else if (wallet) pendingBody = "Confirming your payment…";
    else pendingBody = "Approve the payment prompt on your phone. This page updates by itself once the provider confirms.";
  }

  const go = (path) => () => navigate(path);

  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.canvas, padding: 16, fontFamily: BODY_FONT, boxSizing: "border-box" }}>
    <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, width: "100%", maxWidth: 440, padding: 24, boxSizing: "border-box", color: C.ink }}>
      <h1 style={{ margin: "0 0 16px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 24, letterSpacing: "-0.02em", textAlign: "center", color: C.ink }}>Verify payment</h1>

      {error ? (
        <div role="alert" style={{ background: C.errBg, color: C.errInk, borderRadius: 10, padding: "12px 14px", fontSize: "0.85rem", lineHeight: 1.6 }}>{error}</div>
      ) : !status ? (
        <div style={{ color: C.inkDim, fontSize: "0.88rem", textAlign: "center" }}>Confirming your payment…</div>
      ) : (
        <>
          <div role="status" style={{ textAlign: "center", marginBottom: 16 }}>
            {resolved ? (
              <>
                <div style={{ fontWeight: 700, color: headline[1], fontSize: "1.05rem", marginBottom: 6 }}>{headline[0]}</div>
                {status !== "success" && <div style={{ color: C.inkDim, fontSize: "0.85rem", lineHeight: 1.6 }}>{failedBody}</div>}
              </>
            ) : (
              <div style={{ color: C.inkDim, fontSize: "0.88rem", lineHeight: 1.6 }}>{pendingBody}</div>
            )}
          </div>

          <div style={{ fontWeight: 700, fontSize: "0.8rem", color: C.inkDim, margin: "0 0 6px" }}>Transaction details</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: 18 }}>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} style={{ borderTop: `1px solid ${C.line}` }}>
                  <th scope="row" style={{ textAlign: "left", fontWeight: 500, color: C.inkDim, padding: "9px 0" }}>{k}</th>
                  <td style={{ textAlign: "right", padding: "9px 0", fontWeight: 600, color: k === "Amount" || k === "Payment processing" ? C.price : C.ink, ...TABULAR, wordBreak: "break-all" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {(resolved || timedOut) && (
            <div style={{ display: "grid", gap: 8 }}>
              {status === "success" && isOrder && <>
                <button type="button" onClick={go("/my-account/orders")} style={btn(true)}>View your order</button>
                <button type="button" onClick={go("/")} style={btn(false)}>Continue shopping</button>
              </>}
              {status === "success" && !isOrder && kind === "wallet_topup" && (
                <button type="button" onClick={go("/my-account")} style={btn(true)}>Back to your account</button>
              )}
              {status === "success" && !isOrder && kind !== "wallet_topup" && (
                <button type="button" onClick={go("/")} style={btn(true)}>Back to AshantiHub</button>
              )}
              {status !== "success" && status !== "pending" && isOrder && <>
                <button type="button" onClick={go("/checkout")} style={btn(true)}>Try again</button>
                <button type="button" onClick={go("/cart")} style={btn(false)}>Exit</button>
              </>}
              {((status !== "success" && status !== "pending" && !isOrder) || status === "pending") && (
                <button type="button" onClick={go("/")} style={btn(true)}>Back to AshantiHub</button>
              )}
            </div>
          )}
        </>
      )}
      {error && <button type="button" onClick={go("/")} style={{ ...btn(true), marginTop: 16 }}>Back to AshantiHub</button>}
    </div>
  </div>;
}
