import CancellationPolicyField from "../../CancellationPolicyField.jsx";
import { D } from "../theme.js";

// Form pieces shared by the Listings panel (create and edit of a draft) and the approved-listing
// card's revision editor, so the decision fields are written once.
export const inputStyle = {
  width: "100%", padding: "8px", borderRadius: 8, border: `1.5px solid ${D.cardBorder}`,
  fontSize: "0.8rem", fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  background: D.panelBg2, color: D.text,
};
export const labelStyle = { fontSize: "0.68rem", fontWeight: 700, color: D.textDim, display: "block", marginBottom: 3 };
export const textareaStyle = { ...inputStyle, minHeight: 56, resize: "vertical" };
export const fieldGrid2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 };
export const policyHint = { fontSize: "0.66rem", color: D.textFaint, marginTop: 3 };


// Kind-branched decision fields. Product: warranty/expiry conscious-answer
// selects with conditional detail inputs, required return policy, plus the
// Amazon-style attributes. Service: Fiverr-style gig fields. `update(field,
// value)` patches a single key on the owning form state.
// `hideStock`: the approved-listing editor leaves stock out (stock is a live edit, not part of an approved-edit).
export function DecisionFields({ kind, isAccommodation, form, update, hideStock = false }) {
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
          <label style={labelStyle}>House rules</label>
          <textarea value={form.requirements || ""} placeholder="e.g. No smoking indoors. Quiet after 10pm." onChange={e => update("requirements", e.target.value)} style={textareaStyle} />
        </div>
        <CancellationPolicyField value={form.cancellation_policy} onChange={v => update("cancellation_policy", v)} labelStyle={labelStyle} inputStyle={inputStyle} hintStyle={policyHint} />
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
          {!hideStock && (
          <div>
            <label style={labelStyle}>Stock quantity</label>
            <input type="number" min={0} value={form.stock_quantity ?? ""} placeholder="Leave blank if not tracked" onChange={e => update("stock_quantity", e.target.value)} style={inputStyle} />
          </div>
          )}
        </div>
      </>
    );
  }
  if (kind === "service") {
    return (
      <>
        {/* A service has no scheduled start, so no policy tiers apply: it is cancelled in full until the job is done. */}
        <div style={{ ...policyHint, marginBottom: 10 }}>Customers can cancel a service for a full refund until you mark the job done.</div>
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
