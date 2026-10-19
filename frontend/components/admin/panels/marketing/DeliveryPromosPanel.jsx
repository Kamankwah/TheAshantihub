import { useState } from "react";
import { createPlatformDeliveryPromo, staffDeliveryPromoAction, useStaffDeliveryPromos } from "../../../../hooks/useDeliveryPromos.js";
import { useBusinessOwnerSearch } from "../../../../hooks/useFraudFlags.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { D } from "../../theme.js";
import { pill } from "../panelStyles.js";
import { Honest, Loading, PageHead, Section, button, chip, dim, inputStyle, labelStyle } from "./mkParts.jsx";

// ─── Free-delivery promos: the review queue ──────────────────────────────────────
// A business asks to waive delivery on its own items; nothing applies until it is approved here. The waived
// fee is recorded on each order, there is no settlement against the business yet.
const TABS = [["pending", "Waiting"], ["approved", "Approved"], ["rejected", "Not approved"], ["paused", "Paused"], ["ended", "Ended"]];
const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });


// AshantiHub pays the waived fees up to a cap. Always waits for Operations or a Super Admin, so nothing applies from here.
// First version covers every item of the one business; choosing items is not offered.
function PlatformForm({ onDone }) {
  const [term, setTerm] = useState("");
  const [owner, setOwner] = useState(null);
  const [manualId, setManualId] = useState("");
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [cap, setCap] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const search = useBusinessOwnerSearch(term);
  const ownerId = owner ? owner.id : Number(manualId) || null;
  const ready = ownerId && name.trim() && startsAt && endsAt && Number(cap) > 0;

  const submit = async (e) => {
    e.preventDefault();
    setActionError("");
    setNotice("");
    setBusy(true);
    try {
      await createPlatformDeliveryPromo({
        business_owner: ownerId, name: name.trim(), starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString(),
        all_items: true, budget_cap: cap,
      });
      setNotice("Sent for approval to Operations or a Super Admin.");
      setOwner(null); setTerm(""); setManualId(""); setName(""); setStartsAt(""); setEndsAt(""); setCap("");
      await onDone();
    } catch (error) {
      setActionError(apiErrorMessage(error, "Could not send the promo."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} aria-label="New AshantiHub-paid free-delivery promo" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Honest>AshantiHub pays the delivery fee on this business's orders, up to the cap. It covers every item of the business; choosing items is not offered yet. It waits for Operations or a Super Admin before it applies.</Honest>
      {owner ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: "0.82rem", color: D.text }}>
          <strong>{owner.business_name || owner.full_name}</strong>
          <button type="button" onClick={() => setOwner(null)} style={button(D.panelBg, D.text)}>Change</button>
        </div>
      ) : (
        <>
          <label style={labelStyle}>Find the business<input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Type at least 2 letters" style={inputStyle} /></label>
          {search.isError ? (
            <label style={labelStyle}>Business number (search is not available for your role)<input type="number" min="1" value={manualId} onChange={(e) => setManualId(e.target.value)} style={inputStyle} /></label>
          ) : (search.data?.results || []).map((o) => (
            <button key={o.id} type="button" onClick={() => setOwner(o)} style={{ ...button(D.panelBg, D.text), textAlign: "left" }}>{o.business_name || o.full_name}</button>
          ))}
        </>
      )}
      <label style={labelStyle}>Promo name<input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} /></label>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={labelStyle}>Starts<input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={inputStyle} /></label>
        <label style={labelStyle}>Ends<input required type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={inputStyle} /></label>
        <label style={labelStyle}>Budget cap (GH₵)<input required type="number" min="0.01" step="0.01" value={cap} onChange={(e) => setCap(e.target.value)} style={{ ...inputStyle, width: 140 }} /></label>
      </div>
      <div style={dim}>Covers every item of this business.</div>
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{actionError}</div>}
      {notice && <div role="status" style={chip(D.green)}>{notice}</div>}
      <div><button type="submit" disabled={busy || !ready} style={button(D.gold, D.text, busy || !ready)}>Send for approval</button></div>
    </form>
  );
}

export default function DeliveryPromosPanel({ auth }) {
  const canFund = !!auth?.hasPermission?.("delivery_promo.fund");
  const [status, setStatus] = useState("pending");
  const { data, isError, refetch } = useStaffDeliveryPromos(status);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");

  const act = async (id, action, body) => {
    setActionError("");
    setBusyId(id);
    try {
      await staffDeliveryPromoAction(id, action, body);
      setRejecting(null);
      setReason("");
      await refetch();
    } catch (error) {
      setActionError(apiErrorMessage(error, "That did not work."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageHead title="Free-delivery promos" />
      <Honest>A business can waive delivery only on its own items, and only when the whole order is from that business. Unless a promo says "Paid by AshantiHub", the business covers the cost: each waived fee is a charge recorded against the business for that order, reversed if the order is cancelled, its payment fails or it is fully refunded.</Honest>
      {canFund && <Section id="dp-new" title="New AshantiHub-paid promo"><PlatformForm onDone={refetch} /></Section>}
      <Section id="dp-list" title="Promos" action={
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TABS.map(([v, l]) => <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} style={pill(status === v)}>{l}</button>)}
        </div>
      }>
        {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{actionError}</div>}
        {!data ? <Loading error={isError} onRetry={refetch} what="promos" /> : data.results.length === 0 ? <Honest>Nothing here.</Honest> : data.results.map((p) => (
          <div key={p.id} style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800, color: D.text, fontSize: "0.86rem" }}>{p.name} <span style={dim}>· {p.business}</span></div>
              <span style={chip(p.live ? D.green : D.textDim)}>{p.live ? "Running now" : p.effective_status}</span>
            </div>
            <div><span style={chip(p.funded_by === "platform" ? D.gold : D.textDim)}>{p.funded_by === "platform" ? "Paid by AshantiHub" : "Paid by the business"}</span></div>
            <div style={dim}>{when(p.starts_at)} to {when(p.ends_at)} · {p.source === "staff" ? "Set up by staff" : "Asked for by the business"}</div>
            <div style={dim}>{p.all_items ? "All of the business's items" : p.listings.map((l) => l.name).join(", ")}</div>
            <div style={dim}>Covered so far: GH₵ {p.covered_total} on {p.covered_orders} {p.covered_orders === 1 ? "order" : "orders"}</div>
            {p.funded_by === "platform" && p.budget_cap != null && <div style={dim}>Spent GH₵ {p.spent ?? "0.00"} of GH₵ {p.budget_cap}</div>}
            {p.awaiting_approval && <div style={{ ...dim, color: D.amber }}>Waiting for Operations or Super Admin. Decide it from the approvals inbox.</div>}
            {p.rejection_reason && <div style={{ ...dim, color: D.red }}>Reason: {p.rejection_reason}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {p.status === "pending" && !p.awaiting_approval && (
                <>
                  <button type="button" disabled={busyId === p.id} onClick={() => act(p.id, "approve")} style={button(D.gold, D.text, busyId === p.id)}>Approve</button>
                  <button type="button" disabled={busyId === p.id} onClick={() => { setRejecting(rejecting === p.id ? null : p.id); setReason(""); }} style={button(D.panelBg, D.text)}>Not approve</button>
                </>
              )}
              {p.status === "rejected" && <button type="button" disabled={busyId === p.id} onClick={() => act(p.id, "re-review")} style={button(D.panelBg, D.text, busyId === p.id)}>Send back to review</button>}
              {["active", "paused"].includes(p.status) && <button type="button" disabled={busyId === p.id} onClick={() => { if (window.confirm("End this promo now?")) act(p.id, "end"); }} style={button(D.panelBg, D.red, busyId === p.id)}>End now</button>}
            </div>
            {rejecting === p.id && (
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Tell the business why" maxLength={300} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
                <button type="button" disabled={!reason.trim() || busyId === p.id} onClick={() => act(p.id, "reject", { reason })} style={button(D.red, "#fff", !reason.trim())}>Send</button>
              </div>
            )}
          </div>
        ))}
      </Section>
    </div>
  );
}
