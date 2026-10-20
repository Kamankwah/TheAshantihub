import { useState } from "react";
import { createOwnerDeliveryPromo, ownerDeliveryPromoAction, useOwnerDeliveryPromos } from "../../../hooks/useDeliveryPromos.js";
import { useMyListings } from "../../../hooks/useMyListings.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard, tint } from "../theme.js";

// ─── Free-delivery promos — a business waives the delivery fee on its own items ───
// Every call is scoped server-side to the signed-in business: it can only name its own listings and only
// ever sees its own promos. A new promo waits for AshantiHub's review before it applies.
// Each waived fee is a ledger row against the business (marketing.WaivedFeeCharge), reversed on cancel, failed payment or full refund.

const STATUS = {
  pending: ["Waiting for review", D.amber], active: ["Approved", D.green], paused: ["Paused", D.amber],
  ended: ["Ended", D.textDim], rejected: ["Not approved", D.red],
};
const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const input = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: D.panelBg, minHeight: 36, boxSizing: "border-box" };
const btn = (bg, color, disabled) => ({ background: bg, color, border: bg === D.panelBg ? `1px solid ${D.cardBorder}` : "none", borderRadius: 10, padding: "7px 12px", fontSize: "0.76rem", fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "inherit" });

function NewPromo({ onDone }) {
  const { data: listings } = useMyListings();
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [allItems, setAllItems] = useState(true);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const published = (listings || []).filter((l) => l.status === "published");

  const submit = async (e) => {
    e.preventDefault();
    setActionError("");
    setBusy(true);
    try {
      await createOwnerDeliveryPromo({
        name, starts_at: new Date(startsAt).toISOString(), ends_at: new Date(endsAt).toISOString(),
        all_items: allItems, listing_ids: allItems ? [] : picked,
      });
      onDone();
    } catch (error) {
      setActionError(apiErrorMessage(error, "Could not send the promo."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }} aria-label="New free-delivery promo">
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.74rem", fontWeight: 700, color: D.text }}>Promo name
        <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} style={input} placeholder="e.g. Free delivery weekend" />
      </label>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.74rem", fontWeight: 700, color: D.text }}>Starts
          <input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} style={input} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.74rem", fontWeight: 700, color: D.text }}>Ends
          <input required type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={input} />
        </label>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <legend style={{ fontSize: "0.74rem", fontWeight: 700, color: D.text, padding: 0, marginBottom: 4 }}>Which items</legend>
        <label style={{ fontSize: "0.78rem", color: D.text }}><input type="radio" checked={allItems} onChange={() => setAllItems(true)} /> All my items</label>
        <label style={{ fontSize: "0.78rem", color: D.text }}><input type="radio" checked={!allItems} onChange={() => setAllItems(false)} /> Only the items I choose</label>
        {!allItems && (published.length === 0
          ? <div style={{ color: D.textDim, fontSize: "0.74rem" }}>You have no published items yet.</div>
          : published.map((l) => (
            <label key={l.id} style={{ fontSize: "0.78rem", color: D.text, marginLeft: 18 }}>
              <input type="checkbox" checked={picked.includes(l.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))} /> {l.name}
            </label>
          )))}
      </fieldset>
      <div style={{ color: D.textDim, fontSize: "0.72rem", lineHeight: 1.5 }}>
        Delivery is free only when everything in the customer's order is from your business and covered by this promo.
        You cover the delivery fee. Each waived fee is recorded as a charge against your business for that order, and reversed if the order is cancelled, its payment fails or it is fully refunded.
        AshantiHub reviews each promo before it applies.
      </div>
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{actionError}</div>}
      <div><button type="submit" disabled={busy || !name || !startsAt || !endsAt || (!allItems && picked.length === 0)} style={btn(D.gold, D.text, busy)}>Send for review</button></div>
    </form>
  );
}

export default function DeliveryPromosPanel() {
  const { data, isError, refetch } = useOwnerDeliveryPromos();
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [actionError, setActionError] = useState("");

  const act = async (id, action) => {
    setActionError("");
    setBusyId(id);
    try {
      await ownerDeliveryPromoAction(id, action);
      await refetch();
    } catch (error) {
      setActionError(apiErrorMessage(error, "That did not work."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "1.05rem" }}>Free delivery</div>
          <div style={{ color: D.textDim, fontSize: "0.74rem" }}>Waive the delivery fee on your own items for a set time.</div>
        </div>
        <button type="button" onClick={() => setShowForm((v) => !v)} style={btn(D.gold, D.text)}>{showForm ? "Close" : "New promo"}</button>
      </div>
      {showForm && <NewPromo onDone={() => { setShowForm(false); refetch(); }} />}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.78rem", marginBottom: 8 }}>{actionError}</div>}
      {isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Couldn't load your promos. <button type="button" onClick={() => refetch()} style={btn(D.panelBg, D.text)}>Try again</button></div>}
      {!data && !isError && <div role="status" style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
      {data && data.results.length === 0 && <div style={{ ...glassCard, padding: 16, color: D.textDim, fontSize: "0.8rem" }}>You have no free-delivery promos yet.</div>}
      {data?.results.map((p) => {
        const [label, color] = STATUS[p.effective_status] || [p.effective_status, D.textDim];
        const over = p.effective_status === "ended" || p.effective_status === "rejected";
        return (
          <div key={p.id} style={{ ...glassCard, padding: 16, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem" }}>{p.name}</div>
              <span style={{ background: tint(color, "22"), color, borderRadius: 20, padding: "3px 11px", fontSize: "0.66rem", fontWeight: 800 }}>{label}{p.live ? " · running now" : ""}</span>
            </div>
            {p.funded_by === "platform" && <div style={{ marginTop: 4 }}><span style={{ background: `${D.green}22`, color: D.green, borderRadius: 20, padding: "3px 11px", fontSize: "0.66rem", fontWeight: 800 }}>AshantiHub pays</span></div>}
            <div style={{ color: D.textDim, fontSize: "0.72rem", marginTop: 4 }}>{when(p.starts_at)} to {when(p.ends_at)}</div>
            <div style={{ color: D.textFaint, fontSize: "0.72rem", marginTop: 4 }}>{p.all_items ? "All your items" : p.listings.map((l) => l.name).join(", ")}</div>
            <div style={{ color: D.textDim, fontSize: "0.72rem", marginTop: 4 }}>Delivery covered so far: GH₵ {p.covered_total} on {p.covered_orders} {p.covered_orders === 1 ? "order" : "orders"}</div>
            {p.status === "rejected" && p.rejection_reason && <div style={{ color: D.red, fontSize: "0.74rem", marginTop: 6 }}>Reason: {p.rejection_reason}</div>}
            {!over && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {p.status === "active" && <button type="button" disabled={busyId === p.id} onClick={() => act(p.id, "pause")} style={btn(D.panelBg, D.text, busyId === p.id)}>Pause</button>}
                {p.status === "paused" && <button type="button" disabled={busyId === p.id} onClick={() => act(p.id, "resume")} style={btn(D.panelBg, D.text, busyId === p.id)}>Resume</button>}
                <button type="button" disabled={busyId === p.id} onClick={() => { if (window.confirm("End this promo? Customers will pay delivery again straight away.")) act(p.id, "end"); }} style={btn(D.panelBg, D.red, busyId === p.id)}>{p.status === "pending" ? "Withdraw" : "End"}</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
