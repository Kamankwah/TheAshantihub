import { useEffect, useState } from "react";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import {
  addFlashListings, createFlashSale, flashSaleAction, removeFlashListing, updateFlashSale, useEligibleListings, useFlashSale,
} from "../../../../hooks/useMarketingPromos.js";
import PromoCountdown from "../../../PromoCountdown.jsx";
import { D } from "../../theme.js";
import { SALE_STATUS, OffNotice, whenWord } from "./promoParts.jsx";
import { Honest, Loading, PageHead, Section, button, chip, dim, errorStyle, inputStyle, labelStyle, linkStyle, money, page, scroll, table, td, th } from "./mkParts.jsx";

// ─── 09 Flash sale editor ────────────────────────────────────────────────────
const localValue = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const STATE_WORD = { agreed: "Agreed", asked: "Asked, no answer yet", not_asked: "Not asked yet", declined: "Said no", withdrawn: "Withdrew" };

export default function FlashSaleEditor({ id, onBack, onOpenDetail }) {
  const isNew = id === "new";
  const { data, isLoading, isError, refetch } = useFlashSale(id);
  const [form, setForm] = useState(isNew ? { name: "", starts_at: "", ends_at: "", discount_pct: 20, stock_cap: 40, per_customer_limit: 1 } : null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [picked, setPicked] = useState([]);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const eligible = useEligibleListings(search, isNew ? null : id, adding);

  useEffect(() => {
    if (data && !isNew) setForm({ name: data.name, starts_at: localValue(data.starts_at), ends_at: localValue(data.ends_at), discount_pct: data.discount_pct, stock_cap: data.stock_cap, per_customer_limit: data.per_customer_limit });
  }, [data, isNew]);

  if (!form || (!isNew && !data)) return <div style={page}><PageHead crumb="Flash sales" title="Flash sale" /><Loading error={isError} onRetry={refetch} what="this flash sale" /></div>;

  const editable = isNew || data.editable;
  const body = () => ({ ...form, starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : "", ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : "" });
  const set = (patch) => { setNotice(""); setForm({ ...form, ...patch }); };
  async function run(fn, done) {
    setBusy(true); setActionError(""); setNotice("");
    try { const result = await fn(); if (done) setNotice(done); await refetch(); return result; } catch (error) { setActionError(apiErrorMessage(error, "That did not work. Try again.")); } finally { setBusy(false); }
  }
  async function save() {
    if (isNew) {
      setBusy(true); setActionError("");
      try { const made = await createFlashSale({ ...body(), listing_ids: picked }); onOpenDetail?.(String(made.id)); } catch (error) { setActionError(apiErrorMessage(error, "Could not save.")); } finally { setBusy(false); }
      return;
    }
    await run(() => updateFlashSale(id, body()), data.status === "waiting_sellers" || data.status === "scheduled" ? "Saved. If the discount or dates changed, sellers were asked again." : "Saved.");
  }
  const [statusLabel, statusColor] = SALE_STATUS[data?.status || "draft"];
  const sellers = {};
  (data?.listings || []).forEach((l) => { (sellers[l.business_id] ||= { name: l.business, rows: [] }).rows.push(l); });
  const previewListing = data?.listings?.[0];
  const sellerWord = (rows) => (rows.every((r) => r.state === "agreed") ? "Agreed" : rows.some((r) => r.state === "asked") ? "Asked, no answer yet" : STATE_WORD[rows[0].state]);

  return (
    <div style={page}>
      <PageHead crumb={<button type="button" onClick={onBack} style={linkStyle}>Flash sales</button>} title={isNew ? "New flash sale" : data.name}>
        {!isNew && <span style={chip(statusColor)}>{statusLabel}</span>}
        {!isNew && data.status === "live" && <button type="button" disabled={busy} onClick={() => { if (window.confirm("End this sale now? Orders already placed keep the sale price.")) run(() => flashSaleAction(id, "end"), "The sale has ended."); }} style={button(D.panelBg, D.text, busy)}>End early</button>}
        {!isNew && ["draft", "waiting_sellers", "scheduled"].includes(data.status) && <button type="button" disabled={busy} onClick={() => { if (window.confirm("Cancel this sale?")) run(() => flashSaleAction(id, "cancel"), "The sale is cancelled."); }} style={button(D.panelBg, D.text, busy)}>Cancel sale</button>}
        {editable && <button type="button" disabled={busy || !form.name} onClick={save} style={button(D.gold, D.text, busy || !form.name)}>{isNew ? "Create sale" : "Save changes"}</button>}
      </PageHead>
      <OffNotice data={data || { promos_enabled: false, off_notice: "Discounts are not applied at checkout yet. You can draft, edit and schedule here; nothing reaches customers until the owner switches checkout promotions on." }} />
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {notice && <div role="status" style={chip(D.green)}>{notice}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Section id="fe-det" title="Dates, discount and limits">
            <label style={labelStyle}>Name<input value={form.name} disabled={!editable} onChange={(e) => set({ name: e.target.value })} style={inputStyle} /></label>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={labelStyle}>Starts<input type="datetime-local" value={form.starts_at} disabled={!editable} onChange={(e) => set({ starts_at: e.target.value })} style={inputStyle} /></label>
              <label style={labelStyle}>Ends<input type="datetime-local" value={form.ends_at} disabled={!editable} onChange={(e) => set({ ends_at: e.target.value })} style={inputStyle} /></label>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={labelStyle}>Discount (% off)<input type="number" min={1} max={90} value={form.discount_pct} disabled={!editable} onChange={(e) => set({ discount_pct: e.target.value })} style={{ ...inputStyle, width: 110 }} /></label>
              <label style={labelStyle}>Stock cap for the sale (items)<input type="number" min={1} value={form.stock_cap} disabled={!editable} onChange={(e) => set({ stock_cap: e.target.value })} style={{ ...inputStyle, width: 150 }} /></label>
              <label style={labelStyle}>Per customer (items)<input type="number" min={1} value={form.per_customer_limit} disabled={!editable} onChange={(e) => set({ per_customer_limit: e.target.value })} style={{ ...inputStyle, width: 130 }} /></label>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <legend style={{ ...labelStyle, padding: 0 }}>Who pays for the discount</legend>
              <label style={{ display: "flex", gap: 8, fontSize: "0.8rem" }}><input type="radio" name="payer" checked readOnly /><span><strong>The sellers</strong>: each one agrees for their own listings.</span></label>
              <label style={{ display: "flex", gap: 8, fontSize: "0.8rem", opacity: 0.55 }}><input type="radio" name="payer" disabled /><span><strong>AshantiHub</strong>: arrives with the Accounting phase.</span></label>
            </fieldset>
            {!isNew && <div style={dim}>Changing the discount or dates asks the sellers again. The stock cap and per-customer limit can change without asking.</div>}
          </Section>

          <Section id="fe-lst" title={`Listings in the sale · ${isNew ? picked.length : data.listing_count}`} action={editable && <button type="button" onClick={() => setAdding(!adding)} style={button(D.panelBg, D.text)}>{adding ? "Close" : "Add listings"}</button>}>
            {adding && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, border: `1px dashed ${D.cardBorder}`, borderRadius: 10, padding: 10 }}>
                <label style={labelStyle}>Search eligible listings<input value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} /></label>
                {eligible.isLoading ? <div role="status" style={dim}>Loading…</div> : (eligible.data?.results || []).length === 0 ? <div style={dim}>No eligible listing found.</div> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                    {eligible.data.results.map((l) => (
                      <label key={l.id} style={{ display: "flex", gap: 8, fontSize: "0.8rem", alignItems: "center" }}>
                        <input type="checkbox" checked={picked.includes(l.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))} />
                        <span>{l.name} · {l.business} · {money(l.price)} · {l.in_stock} in stock</span>
                      </label>
                    ))}
                  </div>
                )}
                {!isNew && <button type="button" disabled={busy || picked.length === 0} onClick={async () => { await run(() => addFlashListings(id, picked), "Added. Sellers are asked about the new listings."); setPicked([]); }} style={button(D.gold, D.text, busy || picked.length === 0)}>Add {picked.length} to the sale</button>}
              </div>
            )}
            {!isNew && (data.listings.length === 0 ? <Honest>No listing yet. Only live listings from verified businesses with tracked stock can join; otherwise the cap can't be enforced.</Honest> : (
              <div style={scroll}>
                <table style={table}>
                  <thead><tr>{["Listing", "Business", "Normal price", "Sale price", "In stock", "Seller", ""].map((h, i) => <th key={i} scope="col" style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.listings.map((l) => (
                      <tr key={l.id}>
                        <th scope="row" style={{ ...td, textAlign: "left" }}>{l.name}{l.problem && <div style={{ ...dim, color: "#A33A00" }}>{l.problem}</div>}</th>
                        <td style={td}>{l.business}</td><td style={td}>{money(l.normal_price)}</td><td style={td}>{money(l.sale_price)}</td><td style={td}>{l.in_stock}</td>
                        <td style={td}>{STATE_WORD[l.state]}</td>
                        <td style={td}>{editable && <button type="button" disabled={busy} aria-label={`Remove ${l.name}`} onClick={() => run(() => removeFlashListing(id, l.id))} style={linkStyle}>Remove</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {isNew && <div style={dim}>Listings you tick are added when you create the sale.</div>}
          </Section>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <Section id="fe-agree" title="Sellers' agreement">
            {isNew ? <Honest>Create the sale first, then ask the sellers.</Honest> : Object.keys(sellers).length === 0 ? <Honest>No sellers yet.</Honest> : Object.values(sellers).map((s) => (
              <div key={s.name} style={{ fontSize: "0.8rem", display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span><strong>{s.name}</strong> · {s.rows.length} listing{s.rows.length === 1 ? "" : "s"}</span><span style={chip(sellerWord(s.rows) === "Agreed" ? D.green : D.amber)}>{sellerWord(s.rows)}</span>
              </div>
            ))}
            {!isNew && <div style={dim}>Sellers are told in their dashboard that AshantiHub is asking them to take part. They can withdraw until {whenWord(data.withdraw_until)} ({data.withdraw_cutoff_hours} hours before the start). Changing the discount, dates or listings asks them again.</div>}
            {!isNew && editable && <button type="button" disabled={busy || data.listing_count === 0} onClick={() => run(() => flashSaleAction(id, "ask"), "Sellers have been asked.")} style={button(D.gold, D.text, busy || data.listing_count === 0)}>{data.status === "draft" ? "Ask the sellers" : "Ask the sellers who haven't answered"}</button>}
          </Section>
          <Section id="fe-prev" title="Preview on the site">
            <div style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8, background: "#fff" }}>
              <strong>{form.name || "Your sale"} · {form.discount_pct}% off</strong>
              {form.starts_at && form.ends_at && new Date(form.ends_at) > new Date() ? <PromoCountdown startsAt={new Date(form.starts_at).toISOString()} endsAt={new Date(form.ends_at).toISOString()} /> : <span style={dim}>Pick future dates to see the countdown.</span>}
              {previewListing && <div style={{ fontSize: "0.82rem" }}><div style={{ fontWeight: 700 }}>{previewListing.name}</div><div><span style={{ fontWeight: 800 }}>{money(previewListing.sale_price)}</span> <s style={{ color: D.textDim }}>{money(previewListing.normal_price)}</s></div><div style={dim}>Up to {form.per_customer_limit} per customer · no coupons on sale items</div></div>}
            </div>
            <div style={dim}>The countdown shows on the site from 48 hours before the start, and only while checkout promotions are switched on. Prices stay plain dark text, never gold.</div>
          </Section>
        </div>
      </div>
    </div>
  );
}
