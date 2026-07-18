import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useIncomingServiceRequests } from "../../../hooks/useIncomingServiceRequests.js";
import { useMyListings } from "../../../hooks/useMyListings.js";
import { useCategories } from "../../../hooks/useCategories.js";
import { D, glassCard, sectionTitle } from "../theme.js";
import OwnerListingCard from "./OwnerListingCard.jsx";

// Services management (business item 2 / Wave H2): a service business's
// incoming request queue, Fiverr/Upwork-style. The owner accepts (quoting a
// price) or declines a new request; once the customer pays it moves to
// in-progress, where the owner posts progress updates and finally marks it
// complete. Only surfaced for a service business (BusinessCommandCenter.buildTabs).
const inputStyle = { padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${D.divider}`, fontSize: "0.8rem", fontFamily: "inherit", background: D.panelBg2, color: D.text, boxSizing: "border-box" };
const btn = { border: "none", borderRadius: 20, padding: "7px 14px", fontSize: "0.74rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

const STATUS_META = {
  requested: { label: "New request", color: D.amber },
  accepted: { label: "Awaiting payment", color: D.blue },
  declined: { label: "Declined", color: D.red },
  in_progress: { label: "In progress", color: D.blue },
  completed: { label: "Completed", color: D.green },
  cancelled: { label: "Cancelled", color: D.textFaint },
};

function RequestCard({ sr, onChanged }) {
  const [mode, setMode] = useState(null); // "accept" | "decline" | "progress" | null
  const [price, setPrice] = useState(sr.budget || "");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState(sr.progress_note || "");
  const [actionError, setActionError] = useState(null);
  const meta = STATUS_META[sr.status] || { label: sr.status, color: D.textDim };

  const call = async (path, body) => {
    setActionError(null);
    try { await apiPost(`/api/services/requests/${sr.id}/${path}/`, body || {}); setMode(null); onChanged(); }
    catch { setActionError("Could not complete that action. Please try again."); }
  };

  return (
    <div style={{ ...glassCard, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem" }}>{sr.listing_name}</div>
          <div style={{ color: D.textDim, fontSize: "0.72rem", marginTop: 2 }}>From {sr.customer_name} · {sr.created_at?.slice(0, 10)}</div>
        </div>
        <span style={{ background: `${meta.color}22`, color: meta.color, borderRadius: 20, padding: "3px 11px", fontSize: "0.66rem", fontWeight: 800 }}>{meta.label}</span>
      </div>

      <div style={{ color: D.text, fontSize: "0.78rem", margin: "8px 0" }}>"{sr.message}"</div>
      <div style={{ color: D.textDim, fontSize: "0.72rem" }}>
        {sr.budget != null && <>Budget: GHS {sr.budget}</>}
        {sr.agreed_price != null && <> · Agreed: GHS {sr.agreed_price}</>}
      </div>
      {sr.progress_note && sr.status !== "requested" && <div style={{ color: D.textFaint, fontSize: "0.7rem", marginTop: 4 }}>Last update: {sr.progress_note}</div>}
      {sr.decline_reason && <div style={{ color: D.red, fontSize: "0.7rem", marginTop: 4 }}>Declined: {sr.decline_reason}</div>}

      {actionError && <div style={{ color: D.red, fontSize: "0.74rem", marginTop: 6 }}>{actionError}</div>}

      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        {sr.status === "requested" && (
          <>
            <button onClick={() => setMode(mode === "accept" ? null : "accept")} style={{ ...btn, background: D.green, color: "#fff" }}>✓ Accept & quote</button>
            <button onClick={() => setMode(mode === "decline" ? null : "decline")} style={{ ...btn, background: `${D.red}22`, color: D.red }}>✕ Decline</button>
          </>
        )}
        {sr.status === "in_progress" && (
          <>
            <button onClick={() => setMode(mode === "progress" ? null : "progress")} style={{ ...btn, background: D.panelBg2, color: D.text, border: `1px solid ${D.divider}` }}>📝 Update progress</button>
            <button onClick={() => call("complete")} style={{ ...btn, background: D.gold, color: "#1a1205" }}>✓ Mark complete</button>
          </>
        )}
      </div>

      {mode === "accept" && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="Your price (GHS)" style={{ ...inputStyle, width: 160 }} />
          <button onClick={() => call("respond", { action: "accept", price })} disabled={!price} style={{ ...btn, background: D.green, color: "#fff", cursor: price ? "pointer" : "default" }}>Send quote</button>
        </div>
      )}
      {mode === "decline" && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
          <button onClick={() => call("respond", { action: "decline", reason })} style={{ ...btn, background: D.red, color: "#fff" }}>Confirm decline</button>
        </div>
      )}
      {mode === "progress" && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Progress note for the customer" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
          <button onClick={() => call("progress", { note })} disabled={!note} style={{ ...btn, background: D.gold, color: "#1a1205", cursor: note ? "pointer" : "default" }}>Post update</button>
        </div>
      )}
    </div>
  );
}

export default function ServicesPanel() {
  const { data, isLoading, isError, refetch } = useIncomingServiceRequests();
  const listings = useMyListings();
  const categories = useCategories();

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading your requests…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your service requests.</div>;
  const requests = data || [];
  const active = requests.filter(r => !["completed", "declined", "cancelled"].includes(r.status));

  // The owner's own approved service listings (bug fix 4): non-accommodation
  // service listings belong here; accommodation ones are managed in Bookings.
  const catMap = Object.fromEntries((categories.data || []).map(c => [c.id, c]));
  const myServices = (listings.data || []).filter(l => {
    if (l.status !== "published") return false;
    const cat = catMap[l.category];
    return cat && cat.kind === "service" && !cat.is_accommodation;
  });

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Your listings — view/edit price, specs and photos (bug fix 4) */}
      <div style={{ ...sectionTitle, marginBottom: 4 }}>Your service listings</div>
      <div style={{ color: D.textFaint, fontSize: "0.72rem", marginBottom: 14 }}>Approved services. Edit price, specs and add photos here — changes go live without re-approval.</div>
      {!listings.isLoading && myServices.length === 0 && <div style={{ color: D.textDim, fontSize: "0.82rem", marginBottom: 20 }}>No approved service listings yet. Once a service is approved it appears here.</div>}
      {myServices.map(l => <OwnerListingCard key={l.id} listing={l} onChanged={listings.refetch} variant="service" />)}

      <div style={{ ...sectionTitle, marginTop: 28, marginBottom: 4 }}>Service requests</div>
      <div style={{ color: D.textFaint, fontSize: "0.72rem", marginBottom: 14 }}>{active.length} active. Accept a request with a quote, then track it to completion once the customer pays.</div>
      {requests.length === 0 && <div style={{ color: D.textDim, fontSize: "0.82rem" }}>No service requests yet. They'll appear here when a customer requests one of your services.</div>}
      {requests.map(r => <RequestCard key={r.id} sr={r} onChanged={refetch} />)}
    </div>
  );
}
