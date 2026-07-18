import { useState } from "react";
import { apiPost, apiPatch, apiPostForm } from "../../../apiClient.js";
import { useMyListings } from "../../../hooks/useMyListings.js";
import { useMyHeroSubmission } from "../../../hooks/useMyHeroSubmission.js";
import { useCategories } from "../../../hooks/useCategories.js";
import { useZones } from "../../../hooks/useZones.js";
import { D, glassCard, LISTING_STATUS_META, HERO_STATUS_META } from "../theme.js";

// Listings & Prices panel — ported from App.jsx's BusinessDashboard "listings"
// tab, re-themed dark. Owns its own listing create / edit / hero-submit /
// promote state and mutations (plain apiPost/apiPatch + refetch, the app
// convention). The simulated-pay modal is passed in as `PaymentComponent`
// (App.jsx's MoMoPayment) to avoid an App.jsx ⇄ components/ circular import.
const inputStyle = {
  width: "100%", padding: "8px", borderRadius: 8, border: `1.5px solid ${D.cardBorder}`,
  fontSize: "0.8rem", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  background: D.panelBg2, color: D.text,
};
const labelStyle = { fontSize: "0.68rem", fontWeight: 700, color: D.textDim, display: "block", marginBottom: 3 };
const textareaStyle = { ...inputStyle, minHeight: 56, resize: "vertical" };
const fieldGrid2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 };

const PRICE_UNITS = ["per night", "per person", "per day", "per item", "per service"];

// Blank state for the create form. Booleans the owner must consciously answer
// (has_warranty/has_expiry) are tri-state selects — "" (unanswered) / "yes" /
// "no" — so the form can force an explicit answer for products, mirroring the
// server-side rule in OwnerListingSerializer.validate().
const emptyCreateForm = () => ({
  category: "", zone: "", name: "", description: "", price_amount: "", price_unit: "per item", tag: "",
  has_warranty: "", warranty_details: "", has_expiry: "", expiry_date: "", return_policy: "",
  brand: "", condition: "", dimensions: "", weight: "", stock_quantity: "",
  service_duration: "", whats_included: "", requirements: "", revisions: "", delivery_time: "",
  specs: [],
});

// The product/service decision fields, shaped for a POST/PATCH body. Sent
// unconditionally by both the create and edit forms (same "include
// unconditionally" convention saveEdit already used for service_duration/
// specs) — blanks/false are harmless for the non-applicable kind.
const decisionFieldsBody = (form) => ({
  service_duration: form.service_duration || "",
  whats_included: form.whats_included || "",
  requirements: form.requirements || "",
  revisions: form.revisions || "",
  delivery_time: form.delivery_time || "",
  has_warranty: form.has_warranty === "yes",
  warranty_details: form.warranty_details || "",
  has_expiry: form.has_expiry === "yes",
  expiry_date: form.expiry_date || null,
  return_policy: form.return_policy || "",
  brand: form.brand || "",
  condition: form.condition || "",
  dimensions: form.dimensions || "",
  weight: form.weight || "",
  stock_quantity: form.stock_quantity === "" || form.stock_quantity == null ? null : Number(form.stock_quantity),
  // Only meaningful for accommodation listings; omitted (undefined → not sent,
  // backend keeps its default of 1) when blank.
  units_total: form.units_total === "" || form.units_total == null ? undefined : Number(form.units_total),
});

// Best-effort readable message from apiClient.js's thrown error (.body carries
// the parsed DRF field-error object when there is one).
const formatApiError = (err, fallback) => {
  const body = err?.body;
  if (body && typeof body === "object") {
    const parts = Object.entries(body).map(([field, msgs]) => {
      const msg = Array.isArray(msgs) ? msgs[0] : String(msgs);
      return field === "detail" || field === "non_field_errors" ? msg : `${field.replaceAll("_", " ")}: ${msg}`;
    });
    if (parts.length > 0) return parts.join(" ");
  }
  return fallback;
};

// ─── Shared field editors (create + edit forms) ──────────────────────────────

function SpecsEditor({ specs, onChange }) {
  const list = specs || [];
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={labelStyle}>Specs</label>
      {list.map((spec, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input value={spec.label || ""} placeholder="Label (e.g. Material)" onChange={e => onChange(list.map((s, si) => si === i ? { ...s, label: e.target.value } : s))} style={inputStyle} />
          <input value={spec.value || ""} placeholder="Value (e.g. Cotton)" onChange={e => onChange(list.map((s, si) => si === i ? { ...s, value: e.target.value } : s))} style={inputStyle} />
          <button onClick={() => onChange(list.filter((_, si) => si !== i))} style={{ background: `${D.red}26`, color: D.red, border: "none", borderRadius: 8, padding: "0 10px", fontWeight: 700, cursor: "pointer" }}>✕</button>
        </div>
      ))}
      <button onClick={() => onChange([...list, { label: "", value: "" }])} style={{ background: "none", border: `1.5px dashed ${D.cardBorderStrong}`, color: D.gold, borderRadius: 8, padding: "6px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>+ Add spec</button>
    </div>
  );
}

// Kind-branched decision fields. Product: warranty/expiry conscious-answer
// selects with conditional detail inputs, required return policy, plus the
// Amazon-style attributes. Service: Fiverr-style gig fields. `update(field,
// value)` patches a single key on the owning form state.
function DecisionFields({ kind, isAccommodation, form, update }) {
  // Accommodation (hotel / real estate / Airbnb) — a distinct form from the
  // generic service form: rooms/units + nightly-rate framing + amenities and
  // house rules, since these listings are booked by date, not requested.
  if (isAccommodation) {
    return (
      <>
        <div style={{ background: `${D.gold}14`, border: `1px solid ${D.gold}44`, borderRadius: 10, padding: "8px 12px", marginBottom: 10, color: D.textDim, fontSize: "0.72rem" }}>
          🏨 Accommodation listing — the <b>price above is charged per night</b>, and guests book it by date in the Bookings tab.
        </div>
        <div style={fieldGrid2}>
          <div>
            <label style={labelStyle}>Rooms / units available *</label>
            <input type="number" min={1} value={form.units_total ?? ""} placeholder="e.g. 8" onChange={e => update("units_total", e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Check-in / check-out</label>
            <input value={form.service_duration || ""} placeholder="e.g. Check-in 2pm · Check-out 11am" onChange={e => update("service_duration", e.target.value)} style={inputStyle} />
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Amenities</label>
          <textarea value={form.whats_included || ""} placeholder="e.g. Free Wi-Fi, air conditioning, breakfast, parking, 24/7 security" onChange={e => update("whats_included", e.target.value)} style={textareaStyle} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>House rules & cancellation policy</label>
          <textarea value={form.requirements || ""} placeholder="e.g. No smoking indoors. Free cancellation up to 48h before check-in." onChange={e => update("requirements", e.target.value)} style={textareaStyle} />
        </div>
      </>
    );
  }
  if (kind === "product") {
    return (
      <>
        <div style={fieldGrid2}>
          <div>
            <label style={labelStyle}>Warranty? *</label>
            <select value={form.has_warranty || ""} onChange={e => update("has_warranty", e.target.value)} style={inputStyle}>
              <option value="">— Please answer —</option>
              <option value="yes">Yes — comes with a warranty</option>
              <option value="no">No warranty</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Expires? *</label>
            <select value={form.has_expiry || ""} onChange={e => update("has_expiry", e.target.value)} style={inputStyle}>
              <option value="">— Please answer —</option>
              <option value="yes">Yes — has an expiry date</option>
              <option value="no">No expiry date</option>
            </select>
          </div>
        </div>
        {form.has_warranty === "yes" && (
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Warranty details *</label>
            <textarea value={form.warranty_details || ""} placeholder="e.g. 12-month manufacturer warranty covering defects" onChange={e => update("warranty_details", e.target.value)} style={textareaStyle} />
          </div>
        )}
        {form.has_expiry === "yes" && (
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Expiry date *</label>
            <input type="date" value={form.expiry_date || ""} onChange={e => update("expiry_date", e.target.value)} style={inputStyle} />
          </div>
        )}
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Return policy *</label>
          <textarea value={form.return_policy || ""} placeholder="e.g. Returns accepted within 7 days if unused, buyer covers transport" onChange={e => update("return_policy", e.target.value)} style={textareaStyle} />
        </div>
        <div style={fieldGrid2}>
          <div>
            <label style={labelStyle}>Brand</label>
            <input value={form.brand || ""} placeholder="e.g. Bonwire Weavers" onChange={e => update("brand", e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Condition</label>
            <select value={form.condition || ""} onChange={e => update("condition", e.target.value)} style={inputStyle}>
              <option value="">Not specified</option>
              <option value="new">New</option>
              <option value="used">Used</option>
              <option value="refurbished">Refurbished</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Dimensions</label>
            <input value={form.dimensions || ""} placeholder="e.g. 180cm x 30cm" onChange={e => update("dimensions", e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Weight</label>
            <input value={form.weight || ""} placeholder="e.g. 0.4 kg" onChange={e => update("weight", e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Stock quantity</label>
            <input type="number" min={0} value={form.stock_quantity ?? ""} placeholder="Leave blank if not tracked" onChange={e => update("stock_quantity", e.target.value)} style={inputStyle} />
          </div>
        </div>
      </>
    );
  }
  if (kind === "service") {
    return (
      <>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Service duration (e.g. '1 hour', '2-3 days')</label>
          <input value={form.service_duration || ""} placeholder="e.g. 2 hours" onChange={e => update("service_duration", e.target.value)} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>What's included</label>
          <textarea value={form.whats_included || ""} placeholder="What the customer gets — e.g. transport, materials, consultation" onChange={e => update("whats_included", e.target.value)} style={textareaStyle} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Requirements from the customer</label>
          <textarea value={form.requirements || ""} placeholder="What you need from the customer before you can start" onChange={e => update("requirements", e.target.value)} style={textareaStyle} />
        </div>
        <div style={fieldGrid2}>
          <div>
            <label style={labelStyle}>Revisions</label>
            <input value={form.revisions || ""} placeholder="e.g. 2 free revisions" onChange={e => update("revisions", e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Delivery time</label>
            <input value={form.delivery_time || ""} placeholder="e.g. 3-5 business days" onChange={e => update("delivery_time", e.target.value)} style={inputStyle} />
          </div>
        </div>
      </>
    );
  }
  return null;
}

export default function ListingsPanel({ user, PaymentComponent, showToast, businessKind }) {
  // A business owner registers as a "product" or "service" business
  // (BusinessOwnerProfile.business_kind). When set, the create form is locked to
  // that kind: only matching categories are selectable and only that kind's
  // field set can appear. When it's null (older accounts backfilled before the
  // field existed), fall back to offering both kinds so nothing breaks.
  const kindLocked = businessKind === "product" || businessKind === "service";
  const createButtonLabel = businessKind === "product"
    ? "➕ List a New Product"
    : businessKind === "service"
      ? "➕ List a New Service"
      : "➕ List a New Product / Service";
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [actionError, setActionError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createPhoto, setCreatePhoto] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [creating, setCreating] = useState(false);
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
  const { data: categories } = useCategories();
  const { data: zones } = useZones();
  const listingList = listings || [];
  // Business listings are product/service only — event-kind categories belong
  // to the Events tab's submission flow, not this panel. When the owner's
  // business_kind is known, narrow further to just that kind so they can't
  // pick a category the backend (OwnerListingSerializer.validate) would reject.
  const listableCategories = (categories || []).filter(c =>
    kindLocked ? c.kind === businessKind : (c.kind === "product" || c.kind === "service"),
  );
  const zoneList = zones || [];
  const categoryKindById = (id) => (categories || []).find(c => c.id === Number(id))?.kind;
  const categoryIsAccommodationById = (id) => !!(categories || []).find(c => c.id === Number(id))?.is_accommodation;

  const toast = () => { if (showToast) showToast(); };

  const updateCreate = (field, value) => setCreateForm(f => ({ ...f, [field]: value }));
  const createKind = categoryKindById(createForm.category);
  const createIsAccommodation = categoryIsAccommodationById(createForm.category);
  // Client-side mirror of OwnerListingSerializer.validate()'s product rules,
  // so the button stays disabled until the owner has consciously answered.
  const productAnswersComplete = createKind !== "product" || (
    createForm.has_warranty !== "" && createForm.has_expiry !== "" &&
    createForm.return_policy.trim() !== "" &&
    (createForm.has_warranty !== "yes" || createForm.warranty_details.trim() !== "") &&
    (createForm.has_expiry !== "yes" || createForm.expiry_date !== "")
  );
  const canSubmitCreate = Boolean(
    createForm.category && createForm.zone && createForm.name.trim() &&
    createForm.description.trim() && productAnswersComplete,
  );

  const submitCreate = async () => {
    if (!canSubmitCreate || creating) return;
    setCreateError(null); setCreating(true);
    try {
      const created = await apiPost("/api/listings/mine/", {
        category: Number(createForm.category), zone: Number(createForm.zone),
        name: createForm.name.trim(), description: createForm.description.trim(),
        price_amount: createForm.price_amount === "" ? null : createForm.price_amount,
        price_unit: createForm.price_unit, tag: createForm.tag.trim() || null,
        specs: createForm.specs,
        ...decisionFieldsBody(createForm),
      });
      if (createPhoto) {
        // Photo goes to the existing gallery endpoint (same "JSON create,
        // then multipart photo" two-step as EventSubmissionPanel's flow) —
        // its failure shouldn't roll back the already-created listing.
        try {
          const fd = new FormData();
          fd.append("image", createPhoto);
          fd.append("order", "0");
          await apiPostForm(`/api/listings/${created.id}/photos/`, fd);
        } catch {
          setActionError("Your listing was created, but the photo failed to upload — you can add it again later.");
        }
      }
      setShowCreate(false); setCreateForm(emptyCreateForm()); setCreatePhoto(null);
      toast(); refetchListings();
    } catch (err) {
      setCreateError(formatApiError(err, "Could not create this listing. Please check the fields and try again."));
    } finally {
      setCreating(false);
    }
  };

  const saveEdit = async (id) => {
    setActionError(null);
    try {
      await apiPatch(`/api/listings/mine/${id}/`, {
        name: editForm.name, price_amount: editForm.price_amount, price_unit: editForm.price_unit,
        specs: editForm.specs,
        ...decisionFieldsBody(editForm),
      });
      setEditingId(null); toast(); refetchListings();
    } catch (err) {
      setActionError(formatApiError(err, "Could not save this listing. It may already be published, or a field may be invalid."));
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
    try {
      const response = await apiPost(`/api/hero/${heroSubmission.id}/extend/`, { days: heroExtendDays });
      // Hubtel integration (docs/HUBTEL_INTEGRATION.md) — added for
      // consistency with every other PaymentComponent onSuccess handler in
      // this app; currently inert, since backend/listings/views.py's
      // HeroExtendView is not one of the call sites routed through
      // payments.services.process_payment() yet (it doesn't even book a
      // billing.Transaction today), so this response never actually carries
      // a "mode" field. Left here so a future conversion of that endpoint
      // doesn't also require frontend surgery.
      if (response?.mode === "redirect") {
        window.location.href = response.checkout_url;
        return;
      }
      toast(); refetchHeroSubmission();
    }
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
      // Hubtel integration (docs/HUBTEL_INTEGRATION.md) — same "added for
      // consistency, currently inert" note as extendHeroSubmission above:
      // ListingPromoteView isn't routed through process_payment() yet, so
      // `res` never actually carries a "mode" field today. Checked here
      // (right after this apiPost, not in confirmPromotion below) because
      // this flow is apiPost-first — the promotion is already fully applied
      // by the time PaymentComponent opens, unlike the pay-first call sites
      // elsewhere in this app.
      if (res?.mode === "redirect") {
        window.location.href = res.checkout_url;
        return;
      }
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
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => { setShowCreate(s => !s); setCreateError(null); }} style={{ background: D.gold, color: "#1a1205", border: "none", borderRadius: 20, padding: "7px 16px", fontSize: "0.72rem", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>{createButtonLabel}</button>
          <a href="https://wa.me/233244000000?text=UPDATE%3A%20" target="_blank" rel="noopener noreferrer" style={{ background: D.whatsapp, color: "#04210f", borderRadius: 20, padding: "6px 14px", fontSize: "0.7rem", fontWeight: 800, textDecoration: "none" }}>📱 WhatsApp Update</a>
        </div>
      </div>

      {actionError && <div style={{ background: `${D.red}1f`, color: D.red, borderRadius: 12, padding: "10px 14px", fontSize: "0.78rem", marginBottom: 14 }}>{actionError}</div>}

      {showCreate && (
        <div style={{ ...glassCard, padding: "16px", marginBottom: 14, border: `2px solid ${D.cardBorderStrong}` }}>
          <div style={{ fontWeight: 900, fontSize: "0.88rem", color: D.text, marginBottom: 10 }}>➕ New Listing</div>
          <div style={fieldGrid2}>
            <div>
              <label style={labelStyle}>Category *</label>
              <select value={createForm.category} onChange={e => updateCreate("category", e.target.value)} style={inputStyle}>
                <option value="">Choose a category…</option>
                {listableCategories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label} ({c.kind})</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Zone *</label>
              <select value={createForm.zone} onChange={e => updateCreate("zone", e.target.value)} style={inputStyle}>
                <option value="">Choose a zone…</option>
                {zoneList.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Name *</label>
              <input value={createForm.name} placeholder="e.g. Hand-woven Kente Scarf" onChange={e => updateCreate("name", e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Tag</label>
              <input value={createForm.tag} placeholder="e.g. Best Seller" onChange={e => updateCreate("tag", e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Price (GHS)</label>
              <input type="number" min={0} value={createForm.price_amount} placeholder="Leave blank if unpriced" onChange={e => updateCreate("price_amount", e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Unit</label>
              <select value={createForm.price_unit} onChange={e => updateCreate("price_unit", e.target.value)} style={inputStyle}>
                {PRICE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Description *</label>
            <textarea value={createForm.description} placeholder="Describe what you're offering — customers see this on your listing page" onChange={e => updateCreate("description", e.target.value)} style={textareaStyle} />
          </div>
          {!createKind && (
            <div style={{ color: D.textFaint, fontSize: "0.72rem", marginBottom: 10 }}>Choose a category above to fill in the product or service details.</div>
          )}
          <DecisionFields kind={createKind} isAccommodation={createIsAccommodation} form={createForm} update={updateCreate} />
          {createKind && <SpecsEditor specs={createForm.specs} onChange={specs => setCreateForm(f => ({ ...f, specs }))} />}
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Photo (optional)</label>
            <input type="file" accept="image/jpeg,image/png" onChange={e => setCreatePhoto(e.target.files?.[0] || null)} style={{ ...inputStyle, padding: "6px" }} />
          </div>
          {createError && <div style={{ color: D.red, fontSize: "0.72rem", marginBottom: 8 }}>{createError}</div>}
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => { setShowCreate(false); setCreateError(null); }} style={{ flex: 1, background: D.panelBg2, color: D.textDim, border: `1px solid ${D.divider}`, borderRadius: 20, padding: "8px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <button onClick={submitCreate} disabled={!canSubmitCreate || creating} style={{ flex: 2, background: canSubmitCreate && !creating ? D.gold : D.panelBg2, color: canSubmitCreate && !creating ? "#1a1205" : D.textFaint, border: "none", borderRadius: 20, padding: "8px", fontWeight: 900, cursor: canSubmitCreate && !creating ? "pointer" : "default", fontFamily: "inherit" }}>{creating ? "Creating…" : "✓ Create Listing"}</button>
          </div>
        </div>
      )}

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

      {/* Discoverability: when the owner has no hero submission yet, explain the
          feature so it's obvious how to get featured (they were previously left
          to notice the small per-photo button on their own). */}
      {!heroSubmission?.id && !heroSubmitPhoto && (
        <div style={{ ...glassCard, padding: "12px 16px", marginBottom: 14, borderLeft: `4px solid ${D.gold}` }}>
          <div style={{ fontWeight: 800, fontSize: "0.82rem", color: D.text }}>🌟 Hero Spotlight</div>
          <div style={{ fontSize: "0.72rem", color: D.textDim, marginTop: 2, lineHeight: 1.5 }}>
            Feature one of your listing photos in the big slider on the homepage. Scroll to any listing below and click the gold <b style={{ color: D.gold }}>Submit for Hero</b> button under a photo. Our team reviews it, then it goes live on the homepage.
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
                <button onClick={() => setShowHeroExtendPay(true)} style={{ background: D.kente2, color: "#fff", border: "none", borderRadius: 20, padding: "7px 14px", fontSize: "0.7rem", fontWeight: 800, cursor: "pointer" }}>💰 Extend {heroExtendDays}d</button>
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
          <div style={{ color: D.textFaint, fontSize: "0.68rem", marginBottom: 8 }}>ℹ️ Promotions are reviewed by our team before they go live. Your listing starts ranking higher once approved.</div>
          {promoteActionError && <div style={{ color: D.red, fontSize: "0.72rem", marginBottom: 8 }}>{promoteActionError}</div>}
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => { setPromoteListingId(null); setPromoteActionError(null); }} style={{ flex: 1, background: D.panelBg2, color: D.textDim, border: `1px solid ${D.divider}`, borderRadius: 20, padding: "8px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
            <button onClick={submitPromotion} disabled={promoteKind === "boost" && !promoteKeywords.trim()} style={{ flex: 2, background: (promoteKind === "boost" && !promoteKeywords.trim()) ? D.panelBg2 : D.kente1, color: (promoteKind === "boost" && !promoteKeywords.trim()) ? D.textFaint : "#fff", border: "none", borderRadius: 20, padding: "8px", fontWeight: 900, cursor: (promoteKind === "boost" && !promoteKeywords.trim()) ? "default" : "pointer", fontFamily: "inherit" }}>📣 Promote {promoteDays}d</button>
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
                  {/* Kind-branched decision fields. OwnerListingSerializer's
                      `category` is a plain id, so the kind comes from the
                      already-fetched categories list; "service" is the
                      fallback when it can't be resolved (categories still
                      loading / legacy row), preserving this form's historical
                      always-show-service_duration behavior. */}
                  <DecisionFields kind={categoryKindById(item.category) || "service"} isAccommodation={categoryIsAccommodationById(item.category)} form={editForm} update={(field, value) => setEditForm(f => ({ ...f, [field]: value }))} />
                  <SpecsEditor specs={editForm.specs} onChange={specs => setEditForm(f => ({ ...f, specs }))} />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setEditingId(null)} style={{ flex: 1, background: D.panelBg2, color: D.textDim, border: `1px solid ${D.divider}`, borderRadius: 20, padding: "8px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                    <button onClick={() => saveEdit(item.id)} style={{ flex: 2, background: D.gold, color: "#1a1205", border: "none", borderRadius: 20, padding: "8px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>✓ Save</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 10, background: D.panelBg2, flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.3rem" }}>
                    {item.photos?.[0]?.image ? <img src={item.photos[0].image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "🏷️"}
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 800, fontSize: "0.85rem", color: D.text }}>{item.name} <span style={{ background: `${statusMeta.color}22`, color: statusMeta.color, borderRadius: 20, padding: "2px 7px", fontSize: "0.6rem", fontWeight: 700 }}>{statusMeta.label}</span></div>
                    <div style={{ fontWeight: 900, color: D.green, fontSize: "0.95rem", marginTop: 2 }}>{item.price_amount != null ? `GHS ${item.price_amount}` : "No price set"} <span style={{ color: D.textFaint, fontWeight: 400, fontSize: "0.72rem" }}>{item.price_unit}</span></div>
                    {item.updated_at && (
                      <>
                        <div style={{ fontSize: "0.62rem", color: freshnessColor(item.updated_at), fontWeight: 700, marginTop: 2 }}>🕐 {freshnessLabel(item.updated_at)}</div>
                        <div style={{ marginTop: 4, height: 4, width: 120, maxWidth: "100%", background: D.panelBg2, borderRadius: 10, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${Math.max(6, 100 - Math.min(100, daysSince(item.updated_at) * 3))}%`, background: freshnessColor(item.updated_at), borderRadius: 10 }} />
                        </div>
                      </>
                    )}
                    {item.status === "rejected" && item.rejection_reason && <div style={{ fontSize: "0.65rem", color: D.red, marginTop: 3 }}>Rejected: {item.rejection_reason}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {canEdit && <button onClick={() => { setEditingId(item.id); setEditForm({
                      name: item.name, price_amount: item.price_amount, price_unit: item.price_unit,
                      specs: item.specs || [], service_duration: item.service_duration || "",
                      whats_included: item.whats_included || "", requirements: item.requirements || "",
                      revisions: item.revisions || "", delivery_time: item.delivery_time || "",
                      // Tri-state selects seeded to the stored boolean — an
                      // existing row has already "answered" (default no).
                      has_warranty: item.has_warranty ? "yes" : "no",
                      warranty_details: item.warranty_details || "",
                      has_expiry: item.has_expiry ? "yes" : "no",
                      expiry_date: item.expiry_date || "",
                      return_policy: item.return_policy || "",
                      brand: item.brand || "", condition: item.condition || "",
                      dimensions: item.dimensions || "", weight: item.weight || "",
                      stock_quantity: item.stock_quantity ?? "",
                      units_total: item.units_total ?? "",
                    }); }} style={{ background: D.goldSoft, color: D.gold, border: "none", borderRadius: 20, padding: "6px 12px", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}>✏️ Edit</button>}
                    {(item.status === "draft" || item.status === "rejected") && <button onClick={() => submitForReview(item.id)} style={{ background: D.kente2, color: "#fff", border: "none", borderRadius: 20, padding: "6px 12px", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}>📤 Submit for Review</button>}
                    {item.status === "published" && <button onClick={() => { setPromoteListingId(item.id); setPromoteKind("featured"); setPromoteDays(7); setPromoteKeywords(""); setPromoteActionError(null); }} style={{ background: `${D.red}18`, color: D.kente1, border: "none", borderRadius: 20, padding: "6px 12px", fontSize: "0.68rem", fontWeight: 700, cursor: "pointer" }}>📣 Promote</button>}
                  </div>
                </div>
              )}
              {item.photos.length > 0 ? (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${D.divider}` }}>
                  <div style={{ fontSize: "0.66rem", fontWeight: 700, color: D.textDim, marginBottom: 6 }}>🌟 Feature a photo on the homepage — pick one to submit:</div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {item.photos.map(photo => (
                      <div key={photo.id} style={{ textAlign: "center" }}>
                        <img src={photo.image} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: heroSubmitPhoto?.id === photo.id ? `2px solid ${D.gold}` : `1px solid ${D.divider}`, display: "block", marginBottom: 4 }} />
                        <button onClick={() => { setHeroSubmitPhoto({ id: photo.id, image: photo.image, listingId: item.id }); setHeroCaption(""); setHeroActionError(null); }} style={{ background: D.goldSoft, color: D.gold, border: `1px solid ${D.gold}55`, borderRadius: 20, padding: "4px 10px", fontSize: "0.62rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>🌟 Submit for Hero</button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${D.divider}`, fontSize: "0.64rem", color: D.textFaint }}>
                  🌟 Add a photo to this listing (via the Products/Services tab) to submit it for the homepage Hero Spotlight.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
