import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiPost } from "../../../apiClient.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { useOpeningSnapshot, useTestAccounts } from "../../../hooks/useOpeningAdmin.js";
import { OPENING_QUERY_KEY } from "../../../hooks/useOpening.js";
import { D } from "../theme.js";
import { button, dim, field } from "./panelStyles.js";
import { card, errorStyle, h3, labelStyle } from "./portfolioParts.jsx";

// Super Admin > Marketplace opening. Shows when the marketplace opens (Africa/Accra), whether the opening gate is
// on, lets a Super Admin move the opening LATER with a reason (password re-entry is asked by the app), and keeps
// the list of named test customers who may buy before opening. Nothing here can bring the opening forward.
const accra = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Accra", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function accraText(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const p = Object.fromEntries(accra.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year} at ${p.hour}:${p.minute}`;
}
const GATE_OFF = "The opening gate is off: the marketplace is open to everyone. It is switched on by the server setting MARKETPLACE_GATE_ENABLED.";

export default function OpeningPanel({ auth }) {
  const allowed = Boolean(auth?.hasPermission?.("opening.manage"));
  const queryClient = useQueryClient();
  const snapshot = useOpeningSnapshot(allowed);
  const accounts = useTestAccounts(allowed);
  const [when, setWhen] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [delayError, setDelayError] = useState("");
  const [notice, setNotice] = useState("");
  const [customer, setCustomer] = useState("");
  const [accountError, setAccountError] = useState("");

  if (!allowed) return null;

  const snap = snapshot.data;
  // Accra has no daylight saving, so a typed Accra time is the same clock reading in UTC.
  const toUtc = (local) => `${local.length === 16 ? `${local}:00` : local}Z`;
  const alreadyOpen = snap ? Date.parse(snap.opens_at) <= Date.parse(snap.server_now) : false;

  const delay = async (event) => {
    event.preventDefault();
    if (busy || !when || !reason.trim()) return;
    setBusy(true); setDelayError(""); setNotice("");
    try {
      await apiPost("/api/storefront/opening/delay/", { opens_at: toUtc(when), reason: reason.trim() });
      setNotice(`Opening delayed to ${accraText(toUtc(when))} (Accra time).`);
      setWhen(""); setReason("");
      snapshot.refetch();
      queryClient.invalidateQueries({ queryKey: OPENING_QUERY_KEY });
    } catch (err) {
      setDelayError(apiErrorMessage(err, "Could not delay the opening."));
    } finally { setBusy(false); }
  };

  const addAccount = async (event) => {
    event.preventDefault();
    setAccountError("");
    const id = Number.parseInt(customer, 10);
    if (!Number.isInteger(id) || id < 1) { setAccountError("Enter the customer's ID number."); return; }
    try {
      await apiPost("/api/storefront/test-accounts/", { customer: id });
      setCustomer("");
      accounts.refetch();
    } catch (err) { setAccountError(apiErrorMessage(err, "Could not add this test account.")); }
  };
  const removeAccount = async (row) => {
    setAccountError("");
    try { await apiDelete("/api/storefront/test-accounts/", { customer: row.customer }); accounts.refetch(); }
    catch (err) { setAccountError(apiErrorMessage(err, "Could not remove this test account.")); }
  };

  const rows = Array.isArray(accounts.data) ? accounts.data : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section aria-label="Opening time" style={card}>
        <h3 style={h3}>Marketplace opening</h3>
        {snapshot.isError && <div role="alert" style={errorStyle}>Could not load the opening time.</div>}
        {!snap && !snapshot.isError && <div style={dim}>Loading…</div>}
        {snap && (
          <>
            <div style={{ fontSize: "1rem", fontWeight: 800, color: D.text }}>{accraText(snap.opens_at)} <span style={dim}>(Accra time)</span></div>
            {snap.gate_enabled
              ? <div style={dim}>{alreadyOpen ? "The marketplace is open." : "Shoppers can browse, but cart, checkout and booking stay closed until then."}</div>
              : <div style={dim}>{GATE_OFF}</div>}
          </>
        )}
      </section>

      <form aria-label="Delay opening" onSubmit={delay} style={card}>
        <h3 style={h3}>Delay opening</h3>
        {snap && alreadyOpen ? <div style={dim}>The marketplace is already open, so it cannot be delayed.</div> : (
          <>
            <div style={dim}>You can only move the opening later. Shoppers see the new time at once. You will be asked for your password.</div>
            <label style={labelStyle}>New opening time (Accra time)
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={field} />
            </label>
            <label style={labelStyle}>Reason (kept on record)
              <textarea rows={2} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} style={field} />
            </label>
            {delayError && <div role="alert" style={errorStyle}>{delayError}</div>}
            {notice && <div role="status" style={{ color: D.green, fontSize: "0.8rem", fontWeight: 700 }}>{notice}</div>}
            <button type="submit" disabled={busy || !when || !reason.trim()} style={{ ...button(D.gold, D.text, busy || !when || !reason.trim()), alignSelf: "flex-start" }}>Delay opening</button>
          </>
        )}
      </form>

      <section aria-label="Test accounts" style={card}>
        <h3 style={h3}>Test accounts</h3>
        <div style={dim}>Named customers who can buy before opening, so the checkout can be tried. Every other shopper waits for the opening.</div>
        {accounts.isError && <div role="alert" style={errorStyle}>Could not load the test accounts.</div>}
        {accounts.data && rows.length === 0 && <div style={dim}>No test accounts.</div>}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((row) => (
            <li key={row.customer} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: "0.82rem", color: D.text }}>
              <span style={{ fontWeight: 700 }}>{row.customer_name}</span>
              <span style={dim}>ID {row.customer}</span>
              <button type="button" aria-label={`Remove ${row.customer_name}`} onClick={() => removeAccount(row)} style={button(D.panelBg, D.red)}>Remove</button>
            </li>
          ))}
        </ul>
        <form onSubmit={addAccount} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <label style={labelStyle}>Customer ID
            <input inputMode="numeric" value={customer} onChange={(e) => setCustomer(e.target.value)} style={field} />
          </label>
          <button type="submit" style={button(D.gold, D.text)}>Add test account</button>
        </form>
        {accountError && <div role="alert" style={errorStyle}>{accountError}</div>}
      </section>
    </div>
  );
}
