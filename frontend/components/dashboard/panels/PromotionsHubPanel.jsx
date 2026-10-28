import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useFlashInvitations, usePromotionPricing } from "../../../hooks/usePromotionPricing.js";
import { DEFAULT_LISTINGS_PATH, useMyListings } from "../../../hooks/useMyListings.js";
import { D, glassCard, tint } from "../theme.js";
import HeroSlideForm from "../HeroSlideForm.jsx";
import DiscountsPanel from "./DiscountsPanel.jsx";
import DeliveryPromosPanel from "./DeliveryPromosPanel.jsx";

// ─── Promotion hub — every promotion tool in one place ───
// Cards open the existing tools: Discount, Hero ad (Plan 1's slide form), Sponsored ad (featured/boost request),
// Free-delivery promo and Flash-sale invitations (read-only). Sponsored ads are free until prices are set: the
// "Free for now" line shows only while the pricing switch is off, and no price is ever invented. A sponsored request
// always waits for staff approval. `direct` (Ashanti Direct's operators) hides the owner-scoped cards.
const labelStyle = { display: "block", fontSize: "0.68rem", fontWeight: 700, color: D.textDim, marginBottom: 3 };
const inputStyle = {
  width: "100%", padding: "8px", borderRadius: 8, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.8rem",
  fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: D.panelBg2, color: D.text,
};
const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const ANSWER = { agreed: "You agreed", declined: "You declined", asked: "Waiting for your answer", mixed: "Partly answered" };

function SponsoredAd({ listings, listingId, promoteBase, PaymentComponent, user, pricing, onChanged, showToast }) {
  const [picked, setPicked] = useState(listingId ? String(listingId) : "");
  const [kind, setKind] = useState("featured");
  const [days, setDays] = useState(7);
  const [keywords, setKeywords] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [paying, setPaying] = useState(null);
  const published = listings.filter((l) => l.status === "published");
  const target = listingId || (picked ? Number(picked) : null);
  const needsKeywords = kind === "boost" && !keywords.trim();

  const reset = () => { setPaying(null); setKind("featured"); setDays(7); setKeywords(""); };
  const submit = async () => {
    if (!target || needsKeywords) return;
    setError(null); setNotice(null);
    try {
      const body = { kind, days };
      if (kind === "boost") body.keywords = keywords.trim();
      const res = await apiPost(`${promoteBase}/${target}/promote/`, body);
      if (res?.mode === "redirect") { window.location.href = res.checkout_url; return; }
      if (res?.free) {
        // Nothing to pay: the request goes straight to staff review.
        setNotice("Sent for review. It costs nothing for now and goes live once our team approves it.");
        reset(); if (showToast) showToast(); onChanged?.();
        return;
      }
      setPaying(res);
    } catch (err) {
      setError("Could not create this promotion — it may already be active on this listing, or the listing isn't published yet.");
    }
  };
  const confirmPaid = () => { reset(); setNotice("Paid. It goes live once our team approves it."); if (showToast) showToast(); onChanged?.(); };

  return (
    <div style={{ ...glassCard, padding: "14px 16px", marginTop: 12, border: `2px solid ${D.cardBorderStrong}` }}>
      {paying && PaymentComponent && (
        <PaymentComponent amount={Number(paying.amount_paid)} purpose={`${paying.kind === "boost" ? "Boost" : "Featured"} promotion — ${paying.kind === "boost" ? paying.keywords : "listing"}`} businessName={user?.fullName || "Your Business"} onSuccess={confirmPaid} onClose={() => setPaying(null)} />
      )}
      <div style={{ fontWeight: 800, fontSize: "0.82rem", color: D.text, marginBottom: 10 }}>
        📣 Sponsored ad{listingId ? ` — "${listings.find((l) => l.id === listingId)?.name || "this listing"}"` : ""}
      </div>
      {!listingId && (
        <div style={{ marginBottom: 10 }}>
          <label htmlFor="promo-listing" style={labelStyle}>Listing</label>
          <select id="promo-listing" value={picked} onChange={(e) => setPicked(e.target.value)} style={inputStyle}>
            <option value="">Choose a published listing</option>
            {published.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: kind === "boost" ? "1fr 1fr 1fr" : "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={inputStyle}>
            <option value="featured">Featured</option>
            <option value="boost">Boost</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Days</label>
          <input type="number" min={1} value={days} onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))} style={inputStyle} />
        </div>
        {kind === "boost" && (
          <div>
            <label style={labelStyle}>Keywords</label>
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. jollof, catering" style={inputStyle} />
          </div>
        )}
      </div>
      {pricing?.enabled === false && <div style={{ color: D.green, fontSize: "0.72rem", fontWeight: 700, marginBottom: 6 }}>Free for now. Prices will be announced before any charge.</div>}
      <div style={{ color: D.textFaint, fontSize: "0.68rem", marginBottom: 8 }}>ℹ️ Promotions are reviewed by our team before they go live. Your listing starts ranking higher once approved.</div>
      {notice && <div style={{ color: D.green, fontSize: "0.74rem", marginBottom: 8 }}>{notice}</div>}
      {error && <div style={{ color: D.red, fontSize: "0.72rem", marginBottom: 8 }}>{error}</div>}
      <button onClick={submit} disabled={!target || needsKeywords} style={{ width: "100%", background: (!target || needsKeywords) ? D.panelBg2 : D.kente1, color: (!target || needsKeywords) ? D.textFaint : "#fff", border: "none", borderRadius: 20, padding: "8px", fontWeight: 900, cursor: (!target || needsKeywords) ? "default" : "pointer", fontFamily: "inherit" }}>📣 Promote {days}d</button>
    </div>
  );
}

// Read-only: the sales AshantiHub has invited this business to join. Answering an invitation is not built here.
function FlashInvitations() {
  const { data, isLoading, isError } = useFlashInvitations();
  const rows = data?.results || [];
  return (
    <div style={{ ...glassCard, padding: "14px 16px", marginTop: 12 }}>
      <div style={{ fontWeight: 800, fontSize: "0.82rem", color: D.text, marginBottom: 8 }}>⚡ Flash-sale invitations</div>
      {isLoading && <div style={{ color: D.textDim, fontSize: "0.78rem" }}>Loading invitations…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.78rem" }}>Could not load your invitations.</div>}
      {!isLoading && !isError && rows.length === 0 && <div style={{ color: D.textDim, fontSize: "0.78rem" }}>No flash-sale invitations yet. When AshantiHub invites you to a sale, it shows here.</div>}
      {rows.map((r) => (
        <div key={r.sale_id} style={{ borderTop: `1px solid ${D.divider}`, padding: "8px 0", fontSize: "0.78rem", color: D.text }}>
          <div style={{ fontWeight: 800 }}>{r.name} <span style={{ color: D.textDim, fontWeight: 600 }}>— {ANSWER[r.answer] || r.answer}</span></div>
          <div style={{ color: D.textDim, fontSize: "0.72rem" }}>{when(r.starts_at)} to {when(r.ends_at)}{r.discount_pct != null ? ` · ${r.discount_pct}% off` : ""}</div>
          {(r.listings || []).map((l) => (
            <div key={l.id} style={{ color: D.textDim, fontSize: "0.72rem" }}>{l.name}: GH₵ {l.sale_price} instead of GH₵ {l.normal_price}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

const CARDS = [
  { id: "discount", icon: "🏷️", title: "Discount", note: "Put an item on sale. Goes live at once.", ownerOnly: false },
  { id: "hero", icon: "🌟", title: "Hero ad", note: "Send a homepage slider slide for approval.", ownerOnly: true },
  { id: "sponsored", icon: "📣", title: "Sponsored ad", note: "Feature or boost a listing.", ownerOnly: false },
  { id: "delivery", icon: "🎁", title: "Free-delivery promo", note: "Waive the delivery fee on your items.", ownerOnly: true },
  { id: "flash", icon: "⚡", title: "Flash-sale invitations", note: "Sales AshantiHub invited you to.", ownerOnly: true },
];

export default function PromotionsHubPanel({
  basePath = DEFAULT_LISTINGS_PATH, promoteBase = "/api/listings", listingId = null, direct = false,
  user, PaymentComponent, showToast, onChanged, onClose,
}) {
  const [open, setOpen] = useState(listingId ? "sponsored" : null);
  const { data: pricing } = usePromotionPricing();
  const mine = useMyListings(true, basePath);
  const all = mine.data || [];
  const scoped = listingId ? all.filter((l) => l.id === listingId) : null;
  const cards = CARDS.filter((c) => !(direct && c.ownerOnly));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <h2 style={{ margin: 0, color: D.text, fontWeight: 900, fontSize: "0.98rem" }}>📣 Promotions</h2>
        {onClose && <button onClick={onClose} style={{ background: D.panelBg2, color: D.textDim, border: `1px solid ${D.divider}`, borderRadius: 20, padding: "6px 14px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Close</button>}
      </div>
      {pricing?.enabled === false && !listingId && open !== "sponsored" && <div style={{ color: D.green, fontSize: "0.74rem", fontWeight: 700, marginBottom: 8 }}>Free for now. Prices will be announced before any charge.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        {cards.map((c) => (
          <button key={c.id} type="button" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}
            style={{ ...glassCard, textAlign: "left", padding: "12px 14px", cursor: "pointer", fontFamily: "inherit", border: `${open === c.id ? 2 : 1}px solid ${open === c.id ? D.cardBorderStrong : D.cardBorder}`, background: open === c.id ? tint(D.gold, "18") : glassCard.background }}>
            <div style={{ fontWeight: 800, fontSize: "0.82rem", color: D.text }}>{c.icon} {c.title}</div>
            <div style={{ color: D.textDim, fontSize: "0.7rem", marginTop: 3 }}>{c.note}</div>
          </button>
        ))}
      </div>
      {open === "discount" && <div style={{ marginTop: 12 }}><DiscountsPanel basePath={basePath} listings={scoped || undefined} /></div>}
      {open === "hero" && !direct && <div style={{ marginTop: 12 }}><HeroSlideForm mode="business" /></div>}
      {open === "sponsored" && (
        <SponsoredAd listings={all} listingId={listingId} promoteBase={promoteBase} PaymentComponent={PaymentComponent}
          user={user} pricing={pricing} onChanged={() => (onChanged ? onChanged() : mine.refetch())} showToast={showToast} />
      )}
      {open === "delivery" && !direct && <div style={{ marginTop: 12 }}><DeliveryPromosPanel /></div>}
      {open === "flash" && !direct && <FlashInvitations />}
    </div>
  );
}
