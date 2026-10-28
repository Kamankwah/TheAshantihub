import { useMemo, useState } from "react";
import { apiPatch, apiPost } from "../../../apiClient.js";
import { useEventPricingTiers } from "../../../hooks/useEventPricingTiers.js";
import { useFullCategoryTree } from "../../../hooks/useClientDrafts.js";
import { useListingFormMeta } from "../../../hooks/usePortfolio.js";
import CancellationPolicyField from "../../CancellationPolicyField.jsx";
import { D } from "../theme.js";
import { button, dim, field } from "./panelStyles.js";
import PhotoCapture from "./PhotoCapture.jsx";
import { card, errorStyle, errorText, h2, h3, labelStyle } from "./portfolioParts.jsx";

// Staff draft a product, service, event or stay for a client business. Nothing here publishes anything: the draft is
// sent to the owner for a texted confirmation, then a second person approves it. POST/PATCH
// businesses/<id>/drafts/ take the listing fields flat, plus `kind` on create.
const KINDS = [["product", "Product"], ["service", "Service"], ["event", "Event"], ["stay", "Stay"]];
const touch = { minHeight: 44 }; // 44 px targets on a phone
const input = { ...field, ...touch };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 10 };

// Plan 2's variant and media editors are not merged yet, so the existing photo capture is the one media editor. When
// Plan 2 lands, this is the single place to swap it (it gets the same props: businessId, initial, onStaged).
function MEDIA_EDITOR({ businessId, onStaged }) {
  return <PhotoCapture businessId={businessId} max={8} onStaged={onStaged} />;
}

function YesNo({ legend, name, value, onChange }) {
  return (
    <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <legend style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text, padding: 0, marginBottom: 4 }}>{legend}</legend>
      {[[true, "Yes"], [false, "No"]].map(([answer, text]) => (
        <label key={text} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.8rem", color: D.text, ...touch }}>
          <input type="radio" name={name} checked={value === answer} onChange={() => onChange(answer)} />{text}
        </label>
      ))}
    </fieldset>
  );
}

// Categories of the chosen kind, as "Department › Category" options: the deepest matching nodes.
function categoryOptions(tree, kind) {
  const fits = (node) => {
    if (kind === "stay") return node.kind === "service" && node.is_accommodation;
    if (kind === "service") return node.kind === "service" && !node.is_accommodation;
    return node.kind === kind;
  };
  const out = [];
  const walk = (nodes, path) => {
    for (const node of nodes || []) {
      const here = [...path, node.label];
      const before = out.length;
      walk(node.children, here);
      if (fits(node) && out.length === before) out.push({ id: node.id, label: here.join(" › ") });
    }
  };
  walk(tree, []);
  return out;
}

const toLocalInput = (iso) => {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const text = (value) => (value == null ? "" : String(value));

export default function ClientListingForm({ businessId, draft = null, onBack, onSaved }) {
  const tree = useFullCategoryTree();
  const meta = useListingFormMeta(businessId);
  const tiers = useEventPricingTiers();
  const p = draft?.payload || {};
  const editing = Boolean(draft);
  const [kind, setKind] = useState(draft?.kind || "");
  const [name, setName] = useState(text(p.name));
  const [category, setCategory] = useState(text(p.category));
  const [zone, setZone] = useState(text(p.zone));
  const [description, setDescription] = useState(text(p.description));
  const [price, setPrice] = useState(text(p.price_amount));
  const [stock, setStock] = useState(text(p.stock_quantity));
  const [priceUnit, setPriceUnit] = useState(text(p.price_unit));
  const [duration, setDuration] = useState(text(p.service_duration));
  const [units, setUnits] = useState(text(p.units_total));
  const [cancellationPolicy, setCancellationPolicy] = useState(text(p.cancellation_policy));
  const [warranty, setWarranty] = useState(p.has_warranty ?? null);
  const [warrantyDetails, setWarrantyDetails] = useState(text(p.warranty_details));
  const [expiry, setExpiry] = useState(p.has_expiry ?? null);
  const [expiryDate, setExpiryDate] = useState(text(p.expiry_date));
  const [returnPolicy, setReturnPolicy] = useState(text(p.return_policy));
  const [address, setAddress] = useState(text(p.address));
  const [eventDate, setEventDate] = useState(toLocalInput(p.event_date));
  const [visibilityDays, setVisibilityDays] = useState(text(p.visibility_days));
  const [accessLevel, setAccessLevel] = useState(text(p.access_level) || "public");
  const [refundDays, setRefundDays] = useState(text(p.refund_until_days_before));
  const [photos, setPhotos] = useState(null); // null: leave the photos the draft already has
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const options = useMemo(() => (kind ? categoryOptions(tree.data, kind) : []), [tree.data, kind]);
  const isEvent = kind === "event";
  const isStay = kind === "stay";
  const isProduct = kind === "product";
  const isService = kind === "service";
  const priceNeeded = isProduct || isStay;
  const priceOk = price !== "" && Number.isFinite(Number(price)) && Number(price) > 0;
  const answered = !isProduct || Boolean(
    warranty !== null && (!warranty || warrantyDetails.trim()) && expiry !== null && (!expiry || expiryDate) && returnPolicy.trim(),
  );
  const filled = Boolean(kind && name.trim() && category && zone && description.trim());
  const kindOk = isEvent
    ? Boolean(address.trim() && eventDate && visibilityDays)
    : (!priceNeeded || priceOk) && (!isStay || (Number(units) >= 1 && cancellationPolicy)) && answered;
  const ready = filled && kindOk && !busy;

  const body = () => {
    const common = { name: name.trim(), category: Number(category), zone: Number(zone), description: description.trim() };
    if (isEvent) {
      return {
        ...common, address: address.trim(), event_date: new Date(eventDate).toISOString(), visibility_days: Number(visibilityDays),
        access_level: accessLevel, ...(refundDays !== "" ? { refund_until_days_before: Number(refundDays) } : {}),
      };
    }
    const listing = { ...common, ...(price !== "" ? { price_amount: Number(price).toFixed(2) } : {}) };
    if (isProduct) {
      Object.assign(listing, {
        stock_quantity: stock === "" ? null : Number(stock), has_warranty: warranty, warranty_details: warranty ? warrantyDetails.trim() : "",
        has_expiry: expiry, expiry_date: expiry ? expiryDate : null, return_policy: returnPolicy.trim(),
      });
    }
    if (isService) Object.assign(listing, { price_unit: priceUnit.trim() || null, service_duration: duration.trim() });
    if (isStay) Object.assign(listing, { price_unit: "per night", units_total: Number(units), cancellation_policy: cancellationPolicy });
    if (photos) Object.assign(listing, { main_photo_id: photos[0]?.id ?? null, photo_ids: photos.slice(1).map((photo) => photo.id) });
    return listing;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setActionError(null);
    try {
      const base = `/api/portfolio/businesses/${businessId}/drafts/`;
      if (editing) await apiPatch(`${base}${draft.id}/`, body());
      else await apiPost(base, { kind, ...body() });
      onSaved?.();
    } catch (err) {
      setActionError(errorText(err, "Could not save the draft. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const loading = tree.isLoading || meta.isLoading;
  const failed = tree.isError || meta.isError;
  const title = editing ? "Edit the draft" : "Draft a listing";
  return (
    <form onSubmit={submit} noValidate aria-label={title} style={card}>
      <button type="button" onClick={onBack} style={{ ...button(D.panelBg, D.text), ...touch, alignSelf: "flex-start" }}>← Back to the drafts</button>
      <h2 style={h2}>{title}</h2>
      {editing && draft.status !== "draft" && <div style={dim}>Saving a change returns this draft to unsent: the owner has to confirm what it now says.</div>}
      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <legend style={{ ...h3, padding: 0, marginBottom: 6 }}>What are you listing?</legend>
        {KINDS.map(([value, label]) => (
          <label key={value} style={{ ...button(kind === value ? D.gold : D.panelBg, D.text), ...touch, display: "inline-flex", alignItems: "center", gap: 6, opacity: editing && kind !== value ? 0.4 : 1 }}>
            <input type="radio" name="kind" value={value} checked={kind === value} disabled={editing} onChange={() => { setKind(value); setCategory(""); }} />{label}
          </label>
        ))}
      </fieldset>
      {loading && kind && <div style={dim}>Loading…</div>}
      {failed && <div role="alert" style={errorStyle}>Couldn't load the categories and areas. Try again.</div>}
      {kind && (
        <>
          {!isEvent && (
            <fieldset style={{ border: `1px solid ${D.divider}`, borderRadius: 12, padding: 12, margin: 0, minWidth: 0 }}>
              <legend style={{ ...h3, padding: "0 4px" }}>Photos</legend>
              {editing && photos === null && <div style={dim}>The draft keeps the photos it has. Take new ones to replace them.</div>}
              <MEDIA_EDITOR businessId={businessId} onStaged={(list) => setPhotos(list.length ? list : null)} />
            </fieldset>
          )}
          <div style={grid}>
            <label style={labelStyle}>Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} style={input} /></label>
            <label style={labelStyle}>Category
              <select value={category} onChange={(e) => setCategory(e.target.value)} style={input}>
                <option value="">Choose a category</option>
                {options.map((option) => <option key={option.id} value={String(option.id)}>{option.label}</option>)}
              </select>
            </label>
            <label style={labelStyle}>Area
              <select value={zone} onChange={(e) => setZone(e.target.value)} style={input}>
                <option value="">Choose an area</option>
                {(meta.data?.zones || []).map((z) => <option key={z.id} value={String(z.id)}>{z.name}</option>)}
              </select>
            </label>
            {!isEvent && (
              <label style={labelStyle}>{isStay ? "Nightly price (GH₵)" : "Price (GH₵)"}
                <input type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} style={input} />
              </label>
            )}
            {isProduct && <label style={labelStyle}>In stock<input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} style={input} /></label>}
            {isService && (
              <>
                <label style={labelStyle}>Price unit<input value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} placeholder="per session" maxLength={30} style={input} /></label>
                <label style={labelStyle}>How long it takes<input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="About 2 hours" maxLength={100} style={input} /></label>
              </>
            )}
            {isStay && <label style={labelStyle}>Rooms or units<input type="number" min="1" step="1" value={units} onChange={(e) => setUnits(e.target.value)} style={input} /></label>}
            {isEvent && (
              <>
                <label style={labelStyle}>Event date and time<input type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} style={input} /></label>
                <label style={labelStyle}>Where it happens<input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={255} style={input} /></label>
                <label style={labelStyle}>Listed for
                  <select value={visibilityDays} onChange={(e) => setVisibilityDays(e.target.value)} style={input}>
                    <option value="">Choose how long</option>
                    {(Array.isArray(tiers.data) ? tiers.data : []).map((tier) => <option key={tier.duration_days} value={String(tier.duration_days)}>{`${tier.duration_days} days`}</option>)}
                  </select>
                </label>
              </>
            )}
          </div>
          <label style={labelStyle}>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={field} /></label>
          {isEvent && (
            <fieldset style={{ border: `1px solid ${D.divider}`, borderRadius: 12, padding: 12, margin: 0, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <legend style={{ ...h3, padding: "0 4px" }}>Tickets</legend>
              <div style={grid}>
                <label style={labelStyle}>Who can attend
                  <select value={accessLevel} onChange={(e) => setAccessLevel(e.target.value)} style={input}>
                    <option value="public">Anyone</option>
                    <option value="private">Invited guests only</option>
                  </select>
                </label>
                <label style={labelStyle}>Refund tickets until (days before)
                  <input type="number" min="0" step="1" value={refundDays} onChange={(e) => setRefundDays(e.target.value)} style={input} />
                </label>
              </div>
              <div style={dim}>Leave the refund days empty for no refunds, except if the event is cancelled. Ticket types and prices are not part of the draft.</div>
            </fieldset>
          )}
          {isStay && <CancellationPolicyField label="Cancellation policy" value={cancellationPolicy} onChange={setCancellationPolicy} labelStyle={labelStyle} inputStyle={input} hintStyle={dim} />}
          {isService && <div style={dim}>Customers can cancel a service for a full refund until the job is marked done.</div>}
          {isProduct && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <YesNo legend="Comes with a warranty?" name="warranty" value={warranty} onChange={setWarranty} />
              {warranty && <label style={labelStyle}>Warranty details<input value={warrantyDetails} onChange={(e) => setWarrantyDetails(e.target.value)} style={input} /></label>}
              <YesNo legend="Can it expire?" name="expiry" value={expiry} onChange={setExpiry} />
              {expiry && <label style={labelStyle}>Expiry date<input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} style={input} /></label>}
              <label style={labelStyle}>Return policy<textarea value={returnPolicy} onChange={(e) => setReturnPolicy(e.target.value)} rows={2} style={field} /></label>
            </div>
          )}
          <div style={dim}>Saving a draft publishes nothing. Send it to the owner to confirm by text, then a second person approves it.</div>
          {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
          <button type="submit" disabled={!ready} style={{ ...button(D.gold, D.text, !ready), ...touch, alignSelf: "flex-start" }}>{editing ? "Save changes" : "Save draft"}</button>
        </>
      )}
    </form>
  );
}
