import { useState } from "react";
import { endListingDiscount, startListingDiscount, useListingDiscounts } from "../../../hooks/useListingDiscounts.js";
import { DEFAULT_LISTINGS_PATH, useMyListings } from "../../../hooks/useMyListings.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard, sectionTitle } from "../theme.js";

// ─── Discounts — a sale price on one of your published items (or one variant) ───
// A discount goes live at once; no approval. The server owns every rule (1% to 90% off, goods and food only,
// one running discount per item or variant) and its message is shown as sent. The struck-through original price
// reaches shoppers only after the same regular price has stood for 7 full days.

const money = (value) => `GH₵ ${Number(value).toFixed(2)}`;
const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const field = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.74rem", fontWeight: 700, color: D.text };
const input = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: D.panelBg, minHeight: 36, boxSizing: "border-box" };
const btn = (bg, color, disabled) => ({ background: bg, color, border: bg === D.panelBg ? `1px solid ${D.cardBorder}` : "none", borderRadius: 10, padding: "7px 12px", fontSize: "0.76rem", fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "inherit" });

// The price a shopper will see, in whole cents (a preview; the server computes the saved price). Returns
// {cents} inside the server's bounds (below the regular price, 1% to 90% off), {outside: true} outside them, or null
// while nothing usable is typed.
function previewPrice(regular, mode, value) {
  const base = Math.round(Number(regular) * 100);
  const n = Number(value);
  if (!base || value === "" || !Number.isFinite(n) || n <= 0) return null;
  if (mode === "percent" && (n < 1 || n > 90)) return { outside: true };
  const cents = mode === "percent" ? Math.round((base * (100 - n)) / 100 + 1e-9) : Math.round(n * 100);
  const lowest = Math.round(base * 0.1 + 1e-9);
  const highest = Math.round(base * 0.99 + 1e-9);
  return cents > 0 && cents < base && cents >= lowest && cents <= highest ? { cents: cents / 100 } : { outside: true };
}

export default function DiscountsPanel({ basePath = DEFAULT_LISTINGS_PATH, listings: given }) {
  const own = useMyListings(!given, basePath);
  const all = given || own.data || [];
  const published = all.filter((l) => l.status === "published");
  const [listingId, setListingId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [mode, setMode] = useState("percent");
  const [value, setValue] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const listing = published.find((l) => String(l.id) === String(listingId)) || null;
  const variants = (listing?.variants || []).filter((v) => v.is_active !== false);
  const needsVariant = variants.length > 0;
  const variant = variants.find((v) => String(v.id) === String(variantId)) || null;
  const regular = needsVariant ? variant?.price_amount : listing?.price_amount;
  const shown = regular != null ? previewPrice(regular, mode, value) : null;

  const { data: live, isError, refetch } = useListingDiscounts(listing ? listing.id : null, basePath);

  const pickListing = (id) => { setListingId(id); setVariantId(""); setMessage(""); };

  const submit = async (e) => {
    e.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      const body = mode === "percent" ? { percent_off: value } : { sale_price: value };
      if (needsVariant) body.variant = Number(variantId);
      if (endsAt) body.ends_at = new Date(endsAt).toISOString();
      await startListingDiscount(listing.id, body, basePath);
      setValue("");
      setEndsAt("");
      await refetch();
    } catch (error) {
      setMessage(apiErrorMessage(error, "Could not start the discount."));
    } finally {
      setBusy(false);
    }
  };

  const end = async (row) => {
    setMessage("");
    setBusy(true);
    try {
      await endListingDiscount(listing.id, row.variant ? { variant: row.variant } : {}, basePath);
      await refetch();
    } catch (error) {
      setMessage(apiErrorMessage(error, "Could not end the discount."));
    } finally {
      setBusy(false);
    }
  };

  const ready = listing && (!needsVariant || variant) && value !== "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={sectionTitle}>Discounts</div>
        <div style={{ color: D.textDim, fontSize: "0.76rem", lineHeight: 1.5 }}>
          A discount applies the moment you start it. Goods and food only. Struck-through original price shows only after 7 days of the same price.
        </div>
      </div>

      <form onSubmit={submit} style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }} aria-label="New discount">
        <label style={field}>Item
          <select value={listingId} onChange={(e) => pickListing(e.target.value)} style={input}>
            <option value="">Choose a published item</option>
            {published.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        {listing && needsVariant && (
          <label style={field}>Variant
            <select value={variantId} onChange={(e) => { setVariantId(e.target.value); setMessage(""); }} style={input}>
              <option value="">Choose a variant</option>
              {variants.map((v) => <option key={v.id} value={v.id}>{v.label} ({money(v.price_amount)})</option>)}
            </select>
          </label>
        )}
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <legend style={{ fontSize: "0.74rem", fontWeight: 700, color: D.text, padding: 0, marginBottom: 4 }}>Set it as</legend>
          <label style={{ fontSize: "0.78rem", color: D.text }}><input type="radio" name="discount-mode" checked={mode === "percent"} onChange={() => { setMode("percent"); setValue(""); }} /> Percent off</label>
          <label style={{ fontSize: "0.78rem", color: D.text }}><input type="radio" name="discount-mode" checked={mode === "price"} onChange={() => { setMode("price"); setValue(""); }} /> Sale price</label>
        </fieldset>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={field}>{mode === "percent" ? "Percent (1 to 90)" : "Sale price (GH₵)"}
            <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} style={input} placeholder={mode === "percent" ? "e.g. 20" : "e.g. 80.00"} />
          </label>
          <label style={field}>Ends (optional)
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} style={input} />
          </label>
        </div>
        {regular != null && (
          <div style={{ fontSize: "0.78rem", color: D.text }} aria-live="polite">
            Regular price {money(regular)}.{" "}
            {shown?.cents != null
              ? <strong>Shoppers will see {money(shown.cents)}.</strong>
              : shown?.outside
                ? <span style={{ color: D.red }}>That is outside what is allowed: between 1% and 90% off the regular price.</span>
                : <span style={{ color: D.textDim }}>Enter {mode === "percent" ? "1 to 90" : "a lower price"} to see the price shoppers will see.</span>}
          </div>
        )}
        {message && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{message}</div>}
        <div><button type="submit" disabled={busy || !ready} style={btn(D.gold, D.darkBrown, busy || !ready)}>Start discount</button></div>
      </form>

      {listing && (
        <div style={{ ...glassCard, padding: 16 }}>
          <div style={{ ...sectionTitle, marginBottom: 8 }}>Live now</div>
          {isError && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>Couldn't load the discounts. <button type="button" onClick={() => refetch()} style={btn(D.panelBg, D.text)}>Try again</button></div>}
          {live && live.length === 0 && <div style={{ color: D.textDim, fontSize: "0.78rem" }}>No discount is running on this item.</div>}
          {(live || []).map((row) => (
            <div key={row.variant ?? "listing"} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 0", borderTop: `1px solid ${D.cardBorder}` }}>
              <div style={{ fontSize: "0.8rem", color: D.text }}>
                <strong>{row.label || listing.name}</strong>: {money(row.sale_price)} instead of {money(row.regular_price)} ({row.percent_off}% off)
                <div style={{ color: D.textDim, fontSize: "0.72rem" }}>{row.ends_at ? `Ends ${when(row.ends_at)}` : "No end date"}</div>
              </div>
              <button type="button" disabled={busy} onClick={() => end(row)} aria-label={`End discount${row.label ? ` on ${row.label}` : ""}`} style={btn(D.panelBg, D.text, busy)}>End</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
