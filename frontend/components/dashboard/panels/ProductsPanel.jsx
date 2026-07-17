import { useState } from "react";
import { apiPatch, apiPost } from "../../../apiClient.js";
import { useMyListings } from "../../../hooks/useMyListings.js";
import { D, glassCard, sectionTitle } from "../theme.js";

// Products management (business item 2, Wave H). Lists the owner's *approved*
// (published) product listings and lets them adjust operational details —
// price, specs, stock — without re-moderation (via the manage endpoint), plus
// restock and expiry warnings. Only surfaced for a product business (see
// BusinessCommandCenter.buildTabs).
const inputStyle = { padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${D.divider}`, fontSize: "0.8rem", fontFamily: "inherit", background: D.panelBg2, color: D.text, boxSizing: "border-box" };
const btn = { border: "none", borderRadius: 20, padding: "7px 14px", fontSize: "0.74rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

// Days until expiry; negative = already expired.
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

function ExpiryBadge({ listing }) {
  if (!listing.has_expiry || !listing.expiry_date) return null;
  const days = daysUntil(listing.expiry_date);
  if (days == null) return null;
  const expired = days < 0;
  const soon = days >= 0 && days <= 14;
  if (!expired && !soon) return null;
  return (
    <span style={{ background: expired ? `${D.red}22` : `${D.amber}22`, color: expired ? D.red : D.amber, borderRadius: 20, padding: "2px 9px", fontSize: "0.62rem", fontWeight: 800 }}>
      {expired ? `⚠️ Expired ${-days}d ago` : `⏳ Expires in ${days}d`}
    </span>
  );
}

function ProductRow({ listing, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(listing.price_amount ?? "");
  const [specs, setSpecs] = useState(listing.specs || []);
  const [restockOpen, setRestockOpen] = useState(false);
  const [restockQty, setRestockQty] = useState("");
  const [actionError, setActionError] = useState(null);

  const lowStock = listing.stock_quantity != null && listing.stock_quantity <= 3;

  const saveDetails = async () => {
    setActionError(null);
    try {
      await apiPatch(`/api/listings/mine/${listing.id}/manage/`, {
        price_amount: price === "" ? null : price,
        specs: specs.filter(s => s.label || s.value),
      });
      setEditing(false);
      onChanged();
    } catch { setActionError("Could not save. Please try again."); }
  };

  const restock = async () => {
    if (!restockQty) return;
    setActionError(null);
    try {
      await apiPost(`/api/listings/mine/${listing.id}/restock/`, { add: Number(restockQty) });
      setRestockOpen(false); setRestockQty("");
      onChanged();
    } catch { setActionError("Could not restock. Please try again."); }
  };

  const setSpec = (i, key, val) => setSpecs(prev => prev.map((s, idx) => idx === i ? { ...s, [key]: val } : s));

  return (
    <div style={{ ...glassCard, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem" }}>{listing.name}</div>
          <div style={{ color: D.textDim, fontSize: "0.74rem", marginTop: 2 }}>GHS {listing.price_amount ?? "—"}{listing.price_unit ? ` ${listing.price_unit}` : ""}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <ExpiryBadge listing={listing} />
          <span style={{ background: lowStock ? `${D.red}22` : `${D.green}22`, color: lowStock ? D.red : D.green, borderRadius: 20, padding: "2px 10px", fontSize: "0.66rem", fontWeight: 800 }}>
            {listing.stock_quantity == null ? "Stock not tracked" : `${listing.stock_quantity} in stock`}
          </span>
        </div>
      </div>

      {actionError && <div style={{ color: D.red, fontSize: "0.74rem", marginTop: 6 }}>{actionError}</div>}
      {lowStock && !restockOpen && <div style={{ color: D.red, fontSize: "0.7rem", marginTop: 6 }}>Running low — restock soon.</div>}

      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <button onClick={() => setEditing(e => !e)} style={{ ...btn, background: D.panelBg2, color: D.text, border: `1px solid ${D.divider}` }}>{editing ? "Close" : "✏️ Edit price & specs"}</button>
        <button onClick={() => setRestockOpen(o => !o)} style={{ ...btn, background: D.gold, color: "#1a1205" }}>📦 Restock</button>
      </div>

      {restockOpen && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="number" min={1} value={restockQty} onChange={e => setRestockQty(e.target.value)} placeholder="Add quantity" style={{ ...inputStyle, width: 140 }} />
          <button onClick={restock} disabled={!restockQty} style={{ ...btn, background: D.green, color: "#fff", cursor: restockQty ? "pointer" : "default" }}>Add to stock</button>
        </div>
      )}

      {editing && (
        <div style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text, display: "block", marginBottom: 4 }}>Price (GHS)</label>
            <input type="number" value={price} onChange={e => setPrice(e.target.value)} style={{ ...inputStyle, width: 160 }} />
          </div>
          <div style={{ ...sectionTitle, fontSize: "0.72rem", marginBottom: 6 }}>Specs</div>
          {specs.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input value={s.label || ""} onChange={e => setSpec(i, "label", e.target.value)} placeholder="Label" style={{ ...inputStyle, flex: 1 }} />
              <input value={s.value || ""} onChange={e => setSpec(i, "value", e.target.value)} placeholder="Value" style={{ ...inputStyle, flex: 1 }} />
              <button onClick={() => setSpecs(prev => prev.filter((_, idx) => idx !== i))} style={{ ...btn, background: `${D.red}22`, color: D.red }}>✕</button>
            </div>
          ))}
          <button onClick={() => setSpecs(prev => [...prev, { label: "", value: "" }])} style={{ ...btn, background: D.panelBg2, color: D.text, border: `1px solid ${D.divider}`, marginBottom: 10 }}>+ Add spec</button>
          <div>
            <button onClick={saveDetails} style={{ ...btn, background: D.gold, color: "#1a1205" }}>Save changes</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductsPanel() {
  const { data, isLoading, isError, refetch } = useMyListings();
  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading your products…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your products.</div>;
  const published = (data || []).filter(l => l.status === "published");

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem", marginBottom: 4 }}>Your products</div>
      <div style={{ color: D.textFaint, fontSize: "0.72rem", marginBottom: 14 }}>Approved listings. Adjust price, specs and stock here — changes go live without re-approval.</div>
      {published.length === 0 && <div style={{ color: D.textDim, fontSize: "0.82rem" }}>No approved products yet. Once a listing is approved it appears here.</div>}
      {published.map(l => <ProductRow key={l.id} listing={l} onChanged={refetch} />)}
    </div>
  );
}
