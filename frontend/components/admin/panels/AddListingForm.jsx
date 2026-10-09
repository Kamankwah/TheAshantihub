import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useListingFormMeta, usePortfolioBusiness } from "../../../hooks/usePortfolio.js";
import { D } from "../theme.js";
import { button, callout, dim, field } from "./panelStyles.js";
import PhotoCapture from "./PhotoCapture.jsx";
import { SentNotice, card, errorStyle, errorText, firstName, h2, h3, labelStyle, money } from "./portfolioParts.jsx";

// A scout adds a product or service as the business (portfolio
// listing.create). The Operations lead's approval is its moderation. The
// product questions are the ones the owner's own listing form must answer.
export default function AddListingForm({ businessId, onBack, onSent }) {
  const business = usePortfolioBusiness(businessId);
  const meta = useListingFormMeta(businessId);
  if (business.isLoading || meta.isLoading) return <div style={card}><div style={dim}>Loading…</div></div>;
  if (business.isError || meta.isError || !business.data) {
    return (
      <div style={card}>
        <button type="button" onClick={onBack} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>← Back</button>
        <div role="alert" style={errorStyle}>Couldn't load the product form. Try again.</div>
      </div>
    );
  }
  return <ListingForm business={business.data} meta={meta.data || {}} onBack={onBack} onSent={onSent} />;
}

function YesNo({ legend, name, value, onChange }) {
  return (
    <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      <legend style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text, padding: 0, marginBottom: 4 }}>{legend}</legend>
      {[[true, "Yes"], [false, "No"]].map(([answer, text]) => (
        <label key={text} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.8rem", color: D.text }}>
          <input type="radio" name={name} checked={value === answer} onChange={() => onChange(answer)} />{text}
        </label>
      ))}
    </fieldset>
  );
}

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 10 };
// The server's own words for a missing reason (portfolio.proposals.REASON_REQUIRED).
const REASON_NEEDED = "Say why — the approver sees it.";

function ListingForm({ business, meta, onBack, onSent }) {
  const isService = business.business_kind === "service";
  const [photos, setPhotos] = useState([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [zone, setZone] = useState(String(business.zone?.id ?? ""));
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [priceUnit, setPriceUnit] = useState("");
  const [duration, setDuration] = useState("");
  const [description, setDescription] = useState("");
  const [warranty, setWarranty] = useState(null);
  const [warrantyDetails, setWarrantyDetails] = useState("");
  const [expiry, setExpiry] = useState(null);
  const [expiryDate, setExpiryDate] = useState("");
  const [returnPolicy, setReturnPolicy] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [sent, setSent] = useState(null);

  const owner = firstName(business.owner_name);
  const backLabel = `Back to ${business.business_name}`;
  const priceOk = price !== "" && Number.isFinite(Number(price)) && Number(price) >= 0;
  const productAnswered = isService || Boolean(
    warranty !== null && (!warranty || warrantyDetails.trim()) && expiry !== null && (!expiry || expiryDate) && returnPolicy.trim(),
  );
  const reasonGiven = note.trim().length > 0;
  const ready = Boolean(photos.length > 0 && name.trim() && category && zone && priceOk && description.trim() && productAnswered && reasonGiven) && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setActionError(null);
    const listing = {
      name: name.trim(), category: Number(category), zone: Number(zone), description: description.trim(),
      price_amount: Number(price).toFixed(2),
      ...(isService
        ? { price_unit: priceUnit.trim() || null, service_duration: duration.trim() }
        : {
          stock_quantity: stock === "" ? null : Number(stock),
          has_warranty: warranty, warranty_details: warranty ? warrantyDetails.trim() : "",
          has_expiry: expiry, expiry_date: expiry ? expiryDate : null,
          return_policy: returnPolicy.trim(),
        }),
    };
    try {
      const result = await apiPost(`/api/portfolio/businesses/${business.id}/listings/`, {
        listing, main_photo_id: photos[0].id, photo_ids: photos.slice(1).map((p) => p.id), reason: note.trim(),
      });
      setSent(result);
      onSent?.();
    } catch (err) {
      setActionError(errorText(err, "Could not send the listing. Try again."));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div style={card}>
        <h2 style={h2}>Add a product or service</h2>
        <SentNotice approverName={sent.approver_name} status={sent.status} ownerName={business.owner_name} onBack={onBack} backLabel={backLabel} />
      </div>
    );
  }

  const first = photos[0];
  return (
    <form onSubmit={submit} noValidate aria-label="Add a product or service" style={card}>
      <button type="button" onClick={onBack} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>← {backLabel}</button>
      <div>
        <h2 style={h2}>Add a product or service</h2>
        <div style={dim}>{[business.business_name, business.zone?.name].filter(Boolean).join(" · ")}</div>
      </div>
      <div style={{ fontSize: "0.8rem", color: D.text }}>Listing type: <strong>{isService ? "Service" : "Product"}</strong></div>
      <div style={dim}>{isService ? "This business is registered for services, so its listings are services." : "This business is registered for products, so its listings are products."}</div>
      <fieldset style={{ border: `1px solid ${D.divider}`, borderRadius: 12, padding: 12, margin: 0, minWidth: 0 }}>
        <legend style={{ ...h3, padding: "0 4px" }}>Photos</legend>
        <PhotoCapture businessId={business.id} max={8} onStaged={setPhotos} />
      </fieldset>
      <div style={grid}>
        <label style={labelStyle}>Name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} style={field} /></label>
        <label style={labelStyle}>Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={field}>
            <option value="">Choose a category</option>
            {(meta.categories || []).map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Area
          <select value={zone} onChange={(e) => setZone(e.target.value)} style={field}>
            <option value="">Choose an area</option>
            {(meta.zones || []).map((z) => <option key={z.id} value={String(z.id)}>{z.name}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Price (GH₵)<input type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} style={field} /></label>
        {isService ? (
          <>
            <label style={labelStyle}>Price unit<input value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} placeholder="per session" maxLength={30} style={field} /></label>
            <label style={labelStyle}>How long it takes<input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="About 5 hours" maxLength={100} style={field} /></label>
          </>
        ) : (
          <label style={labelStyle}>In stock<input type="number" min="0" step="1" value={stock} onChange={(e) => setStock(e.target.value)} style={field} /></label>
        )}
      </div>
      <label style={labelStyle}>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={field} /></label>
      {!isService && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <YesNo legend="Comes with a warranty?" name="warranty" value={warranty} onChange={setWarranty} />
          {warranty && <label style={labelStyle}>Warranty details<input value={warrantyDetails} onChange={(e) => setWarrantyDetails(e.target.value)} style={field} /></label>}
          <YesNo legend="Can it expire?" name="expiry" value={expiry} onChange={setExpiry} />
          {expiry && <label style={labelStyle}>Expiry date<input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} style={field} /></label>}
          <label style={labelStyle}>Return policy<textarea value={returnPolicy} onChange={(e) => setReturnPolicy(e.target.value)} rows={2} style={field} /></label>
        </div>
      )}
      <section aria-label="How customers will see it" style={{ ...callout(D.gold), fontWeight: 400, display: "flex", gap: 12, alignItems: "center" }}>
        {first
          ? <img src={first.url} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
          : <div style={{ width: 64, height: 64, borderRadius: 8, background: D.panelBg2, flexShrink: 0 }} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800 }}>{name.trim() || "Product name"}</div>
          <div style={{ fontVariantNumeric: "tabular-nums" }}>{priceOk ? money(price) : "Price"}{isService && priceUnit.trim() ? ` ${priceUnit.trim()}` : ""}</div>
          <div style={dim}>{`${business.business_name} · ${business.kyc_status === "verified" ? "Verified business" : "KYC waiting"}`}</div>
        </div>
      </section>
      <label style={labelStyle}>Why add it (Operations sees this)<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={field} /></label>
      {!reasonGiven && <div style={dim}>{REASON_NEEDED}</div>}
      <div style={dim}>{`Your Operations lead's approval is this listing's moderation: it goes live when they approve it. ${owner} is told and can undo it for 7 days.`}</div>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {!ready && !busy && <div style={dim}>{`Take at least one photo, fill in every field${isService ? "" : " (including the three questions)"} and say why, to send it.`}</div>}
      <button type="submit" disabled={!ready} style={{ ...button(D.gold, D.text, !ready), alignSelf: "flex-start" }}>Send for approval</button>
    </form>
  );
}
