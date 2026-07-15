import { useState } from "react";
import { apiPost, apiPatch } from "../../../apiClient.js";
import { useMyListings } from "../../../hooks/useMyListings.js";
import { useMyHeroSubmission } from "../../../hooks/useMyHeroSubmission.js";
import { D, glassCard, LISTING_STATUS_META, HERO_STATUS_META } from "../theme.js";

// Listings & Prices panel — ported from App.jsx's BusinessDashboard "listings"
// tab, re-themed dark. Owns its own listing edit / hero-submit / promote state
// and mutations (plain apiPost/apiPatch + refetch, the app convention). The
// simulated-pay modal is passed in as `PaymentComponent` (App.jsx's MoMoPayment)
// to avoid an App.jsx ⇄ components/ circular import.
const inputStyle = {
  width: "100%", padding: "8px", borderRadius: 8, border: `1.5px solid ${D.cardBorder}`,
  fontSize: "0.8rem", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  background: D.panelBg2, color: D.text,
};
const labelStyle = { fontSize: "0.68rem", fontWeight: 700, color: D.textDim, display: "block", marginBottom: 3 };

export default function ListingsPanel({ user, PaymentComponent, showToast }) {
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [actionError, setActionError] = useState(null);
  const [heroSubmitPhoto, setHeroSubmitPhoto] = useState(null);
  const [heroCaption, setHeroCaption] = useState("");
  const [heroActionError, setHeroActionError] = useState(null);
  const [heroExtendDays, setHeroExtendDays] = useState(7);
  const [showHeroExtendPay, setShowHeroExtendPay] = useState(false);
  const [promoteListingId, setPromoteListingId] = useState(null);
  const [promoteKind, setPromoteKind] = useState("featured");
  const [promoteDays, setPromoteDays] = useState(7);
  const [promoteKeywords, setPromoteKeywords] = useState("");
  const [promoteActionError, setPromoteActionError] = useState(null);
  const [promoteResult, setPromoteResult] = useState(null);
  const [showPromotePay, setShowPromotePay] = useState(false);

  const { data: listings, isLoading: listingsLoading, isError: listingsError, refetch: refetchListings } = useMyListings();
  const { data: heroSubmission, refetch: refetchHeroSubmission } = useMyHeroSubmission();
  const listingList = listings || [];

  const toast = () => { if (showToast) showToast(); };

  const saveEdit = async (id) => {
    setActionError(null);
    try {
      await apiPatch(`/api/listings/mine/${id}/`, {
        name: editForm.name, price_amount: editForm.price_amount, price_unit: editForm.price_unit,
        specs: editForm.specs, service_duration: editForm.service_duration,
      });
      setEditingId(null); toast(); refetchListings();
    } catch (err) {
      setActionError("Could not save this listing. It may already be published, or a field may be invalid.");
    }
  };

  const submitForReview = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/mine/${id}/submit/`, {}); toast(); refetchListings(); }
    catch (err) { setActionError("Could not submit this listing for review."); }
  };

  const submitHeroPhoto = async () => {
    if (!heroSubmitPhoto || !heroCaption.trim()) return;
    setHeroActionError(null);
    try {
      await apiPost("/api/hero/submit/", { listing_photo: heroSubmitPhoto.id, caption: heroCaption.trim() });
      setHeroSubmitPhoto(null); setHeroCaption(""); toast(); refetchHeroSubmission();
    } catch (err) {
      setHeroActionError("Could not submit this photo for Hero — you may already have a pending or active submission.");
    }
  };

  const extendHeroSubmission = async (ref) => {
    setShowHeroExtendPay(false);
    if (!heroSubmission?.id) return;
    setHeroActionError(null);
    try { await apiPost(`/api/hero/${heroSubmission.id}/extend/`, { days: heroExtendDays }); toast(); refetchHeroSubmission(); }
    catch (err) { setHeroActionError("Payment was confirmed but we couldn't extend your Hero Spotlight. Please contact support with reference " + ref + "."); }
  };

  const submitPromotion = async () => {
    if (!promoteListingId) return;
    if (promoteKind === "boost" && !promoteKeywords.trim()) return;
    setPromoteActionError(null);
    try {
      const body = { kind: promoteKind, days: promoteDays };
      if (promoteKind === "boost") body.keywords = promoteKeywords.trim();
      const res = await apiPost(`/api/listings/${promoteListingId}/promote/`, body);
      setPromoteResult(res); setPromoteListingId(null); setShowPromotePay(true);
    } catch (err) {
      setPromoteActionError("Could not create this promotion — it may already be active on this listing, or the listing isn't published yet.");
    }
  };

  const confirmPromotion = () => {
    setShowPromotePay(false); setPromoteResult(null); setPromoteKind("featured");
    setPromoteDays(7); setPromoteKeywords(""); toast(); refetchListings();
  };

  const daysSince = (date) => Math.floor((new Date() - new Date(date)) / 86400000);
  const freshnessColor = (date) => { const d = daysSince(date); return d <= 7 ? D.green : d <= 30 ? D.amber : D.red; };
  const freshnessLabel = (date) => { const d = daysSince(date); return d === 0 ? "Today" : d <= 7 ? `${d}d ago` : d <= 30 ? `${d}d ago ⚠️` : `${d}d ago 🔴`; };

  return (
    <>
      {showHeroExtendPay && heroSubmission?.id && PaymentComponent && (
        <PaymentComponent amount={heroExtendDays * 5} purpose={`Extend Hero Spotlight — ${heroExtendDays} day${heroExtendDays === 1 ? "" : "s"}`} businessName={user?.fullName || "Your Business"} onSuccess={extendHeroSubmission} onClose={() => setShowHeroExtendPay(false)} />
      )}
      {showPromotePay && promoteResult && PaymentComponent && (
        <PaymentComponent amount={Number(promoteResult.amount_paid)} purpose={`${promoteResult.kind === "boost" ? "Boost" : "Featured"} promotion — ${promoteResult.kind === "boost" ? promoteResult.keywords : "listing"}`} businessName={user?.fullName || "Your Business"} onSuccess={confirmPromotion} onClose={() => setShowPromotePay(false)} />
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, color: D.text, fontWeight: 900, fontSize: "0.98rem" }}>🏷️ Listings &amp; Prices</h2>
        <a href="https://wa.me/233244000000?text=UPDATE%3A%20" target="_blank" rel="noopener noreferrer" style={{ background: D.whatsapp, color: "#04210f", borderRadius: 20, padding: "6px 14px", fontSize: "0.7rem", fontWeight: 800, textDecoration: "none" }}>📱 WhatsApp Update</a>
      </div>

      {actionError && <div style={{ background: "rgba(248,113,113,0.12)", color: D.red, borderRadius: 12, padding: "10px 14px", fontSize: "0.78rem", marginBottom: 14 }}>{actionError}</div>}

      {heroSubmitPhoto && (
        <div style={{ ...glassCard, padding: "14px 16px", marginBottom: 14, border: `2px solid ${D.cardBorderStrong}` }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <img src={heroSubmitPhoto.image} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 800, fontSize: "0.82rem", color: D.text, marginBottom: 6 }}>🌟 Submit this photo for Hero Spotlight</div>
              <textarea value={heroCaption} onChange={e => setHeroCaption(e.target.value.slice(0, 140))} maxLength={140} placeholder="A one-sentence caption for the hero slider…" style={{ ...inputStyle, minHeight: 56, resize: "vertical" }} />
              <div style={{ fontSize: "0.62rem", color: D.textFaint, textAlign: "right", marginBottom: 8 }}>{heroCaption.length}/140</div>
              {heroActionError && <div style={{ color: D.red, fontSize: "0.72rem", marginBottom: 8 }}>{heroActionError}</div>}
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { setHeroSubmitPhoto(null); setHeroCaption(""); setHeroActionError(null); }} style={{ flex: 1, background: D.panelBg2, color: D.textDim, border: `1px solid ${D.divider}`, borderRadius: 20, padding: "8px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                <button onClick={submitHeroPhoto} disabled={!heroCaption.trim()} style={{ flex: 2, background: heroCaption.trim() ? D.gold : D.panelBg2, color: heroCaption.trim() ? "#1a1205" : D.textFaint, border: "none", borderRadius: 20, padding: "8px", fontWeight: 900, cursor: heroCaption.trim() ? "pointer" : "default", fontFamily: "inherit" }}>✓ Submit for Hero</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {heroSubmission?.id && !heroSubmitPhoto && (
        <div style={{ ...glassCard, padding: "14px 16px", marginBottom: 14, borderLeft: `4px solid ${HERO_STATUS_META[heroSubmission.status]?.color || D.textDim}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: "0.82rem", color: D.text }}>🌟 Hero Spotlight — <span style={{ color: HERO_STATUS_META[heroSubmission.status]?.color }}>{HERO_STATUS_META[heroSubmission.status]?.label || heroSubmission.status}</span></div>
              {heroSubmission.caption && <div style={{ fontSize: "0.7rem", color: D.textDim, marginTop: 2 }}>"{heroSubmission.caption}"</div>}
              {heroSubmission.status === "approved" && heroSubmission.expires_at && <div style={{ fontSize: "0.68rem", color: D.textDim, marginTop: 2 }}>Live until {heroSubmission.expires_at.slice(0, 10)}</div>}
              {heroSubmission.status === "rejected" && heroSubmission.rejection_reason && <div style={{ fontSize: "0.68rem", color: D.red, marginTop: 2 }}>Rejected: {heroSubmission.rejection_reason}</div>}
            </div>
            {heroSubmission.status === "approved" && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="number" min={1} value={heroExtendDays} onChange={e => setHeroExtendDays(Math.max(1, Number(e.target.value) || 1))} style={{ ...inputStyle, width: 56, padding: "6px 8px" }} />
                <button onClick={() => setShowHeroExtendPay(true)} style={{ background: D.kente2, color: "#04210f", border: "none", borderRadius: 20, padding: "7px 14px", fontSize: "0.7rem", fontWeight: 800, cursor: "pointer" }}>💰 Extend {heroExtendDays}d</button>
              </div>
            )}
          </div>
          {heroActionError && <div style={{ color: D.red, fontSize: "0.72rem", marginTop: 8 }}>{heroActionError}</div>}
        </div>
      )}

      {promoteListingId && (
        <div style={{ ...glassCard, padding: "14px 16px", marginBottom: 14, border: `2px solid ${D.cardBorderStrong}` }}>
          <div style={{ fontWeight: 800, fontSize: "0.82rem", color: D.text, marginBottom: 10 }}>📣 Promote "{listingList.find(l => l.id === promoteListingId)?.name}"</div>
          <div style={{ display: "grid", gridTemplateColumns: promoteKind === "boost" ? "1fr 1fr 1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={labelStyle}>Type</label>
              <select value={promoteKind} onChange={e => setPromoteKind(e.target.value)} style={inputStyle}>
                <option value="featured">Featured</option>
                <option value="boost">Boost</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Days</label>
              <input type="number" min={1} value={promoteDays} onChange={e => setPromoteDays(Math.max(1, Number(e.target.value) || 1))} style={inputStyle} />
            </div>
            {promoteKind === "boost" && (
              <div>
                <label style={labelStyle}>Keywords</label>
                <input value={promoteKeywords} onChange={e => setPromoteKeywords(e.target.value)} placeholder="e.g. jollof, catering" style={inputStyle} />
              </div>
            )}
          </div>
          {promoteActionError && <div style={{ color: D.red, fontSize: "0.72rem", marginBottom: 8 }}>{promoteActionError}</div>}
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => { setPromoteListingId(null); setPromoteActionError(null); }} style={{ flex: 1, background: D.panelBg2, color: D.textDim, border: `1px solid ${D.divider}`, borderRadius: 20, padding: "8px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <button onClick={submitPromotion} disabled={promoteKind === "boost" && !promoteKeywords.trim()} style={{ flex: 2, background: (promoteKind === "boost" && !promoteKeywords.trim()) ? D.panelBg2 : D.kente1, color: (promoteKind === "boost" && !promoteKeywords.trim()) ? D.textFaint : "#2a0606", border: "none", borderRadius: 20, padding: "8px", fontWeight: 900, cursor: (promoteKind === "boost" && !promoteKeywords.trim()) ? "default" : "pointer", fontFamily: "inherit" }}>📣 Promote {promoteDays}d</button>
          </div>
        </div>
      )}

      {listingsLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading your listings…</div>}
      {listingsError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your listings. Make sure you're signed in as a business owner.</div>}
      {!listingsLoading && !listingsError && listingList.length === 0 && (
        <div style={{ ...glassCard, padding: "24px", textAlign: "center", color: D.textDim, fontSize: "0.82rem" }}>You don't have any listings yet.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {listingList.map(item => {
          const statusMeta = LISTING_STATUS_META[item.status] || { label: item.status, color: D.textDim };
          const canEdit = item.status !== "published";
          return (
            <div key={item.id} style={{ ...glassCard, padding: "14px 16px", border: editingId === item.id ? `2px solid ${D.cardBorderStrong}` : `1px solid ${D.cardBorder}` }}>
              {editingId === item.id ? (
                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                    <div><label style={labelStyle}>Name</label>
                      <input value={editForm.name || ""} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} />
                    </div>
                    <div><label style={labelStyle}>Price (GHS)</label>
                      <input type="number" value={editForm.price_amount || ""} onChange={e => setEditForm(f => ({ ...f, price_amount: e.target.value }))} style={inputStyle} />
                    </div>
                    <div><label style={labelStyle}>Unit</label>
                      <select value={editForm.price_unit || ""} onChange={e => setEditForm(f => ({ ...f, price_unit: e.target.value }))} style={inputStyle}>
                        {["per night", "per person", "per day", "per item", "per service"].map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={labelStyle}>Service duration (e.g. '1 hour', '2-3 days')</label>
                    <input value={editForm.service_duration || ""} placeholder="e.g. 2 hours" onChange={e => setEditForm(f => ({ ...f, service_duration: e.target.value }))} style={inputStyle} />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={labelStyle}>Specs</label>
                    {(editForm.specs || []).map((spec, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                        <input value={spec.label || ""} placeholder="Label (e.g. Material)" onChange={e => setEditForm(f => ({ ...f, specs: f.specs.map((s, si) => si === i ? { ...s, label: e.target.value } : s) }))} style={inputStyle} />
                        <input value={spec.value || ""} placeholder="Value (e.g. Cotton)" onChange={e => setEditForm(f => ({ ...f, specs: f.specs.map((s, si) => si === i ? { ...s, value: e.target.value } : s) }))} style={inputStyle} />
                        <button onClick={() => setEditForm(f => ({ ...f, specs: f.specs.filter((_, si) => si !== i) }))} style={{ background: "rgba(248,113,113,0.15)", color: D.red, border: "none", borderRadius: 8, padding: "0 10px", fontWeight: 700, cursor: "pointer" }}>✕</button>
                      </div>
                    ))}
                    <button onClick={() => setEditForm(f => ({ ...f, specs: [...(f.specs || []), { label: "", value: "" }] }))} style={{ background: "none", border: `1.5px dashed ${D.cardBorderStrong}`, color: D.gold, borderRadius: 8, padding: "6px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>+ Add spec</button>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setEditingId(null)} style={{ flex: 1, background: D.panelBg2, color: D.textDim, border: `1px solid ${D.divider}`, borderRadius: 20, padding: "8px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                    <button onClick={() => saveEdit(item.id)} style={{ flex: 2, background: D.gold, color: "#1a1205", border: "none", borderRadius: 20, padding: "8px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>✓ Save</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: "0.85rem", color: D.text }}>{item.name} <span style={{ background: `${statusMeta.color}22`, color: statusMeta.color, borderRadius: 20, padding: "2px 7px", fontSize: "0.6rem", fontWeight: 700 }}>{statusMeta.label}</span></div>
                    <div style={{ fontWeight: 900, color: D.green, fontSize: "0.95rem", marginTop: 2 }}>{item.price_amount != null ? `GHS ${item.price_amount}` : "No price set"} <span style={{ color: D.textFaint, fontWeight: 400, fontSize: "0.72rem" }}>{item.price_unit}</span></div>
                    {item.updated_at && <div style={{ fontSize: "0.62rem", color: freshnessColor(item.updated_at), fontWeight: 700, marginTop: 2 }}>🕐 {freshnessLabel(item.updated_at)}</div>}
                    {item.status === "rejected" && item.rejection_reason && <div style={{ fontSize: "0.65rem", color: D.red, marginTop: 3 }}>Rejected: {item.rejection_reason}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {canEdit && <button onClick={() => { setEditingId(item.id); setEditForm({ name: item.name, price_amount: item.price_amount, price_unit: item.price_unit, specs: item.specs || [], service_duration: item.service_duration || "" }); }} style={{ background: D.goldSoft, color: D.gold, border: "none", borderRadius: 20, padding: "6px 12px", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}>✏️ Edit</button>}
                    {(item.status === "draft" || item.status === "rejected") && <button onClick={() => submitForReview(item.id)} style={{ background: D.kente2, color: "#04210f", border: "none", borderRadius: 20, padding: "6px 12px", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}>📤 Submit for Review</button>}
                    {item.status === "published" && <button onClick={() => { setPromoteListingId(item.id); setPromoteKind("featured"); setPromoteDays(7); setPromoteKeywords(""); setPromoteActionError(null); }} style={{ background: "rgba(248,113,113,0.15)", color: D.kente1, border: "none", borderRadius: 20, padding: "6px 12px", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}>📣 Promote</button>}
                  </div>
                </div>
              )}
              {item.photos.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${D.divider}` }}>
                  <div style={{ fontSize: "0.66rem", fontWeight: 700, color: D.textDim, marginBottom: 6 }}>📸 Gallery</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {item.photos.map(photo => (
                      <div key={photo.id} style={{ textAlign: "center" }}>
                        <img src={photo.image} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: heroSubmitPhoto?.id === photo.id ? `2px solid ${D.gold}` : `1px solid ${D.divider}`, display: "block" }} />
                        <button onClick={() => { setHeroSubmitPhoto({ id: photo.id, image: photo.image, listingId: item.id }); setHeroCaption(""); setHeroActionError(null); }} style={{ display: "block", marginTop: 4, background: "none", border: "none", color: D.gold, fontSize: "0.6rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>🌟 Submit for Hero</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
