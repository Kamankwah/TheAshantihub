import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useFeaturedCandidates, useFeaturedGrid } from "../../../../hooks/useMarketingBanners.js";
import { D } from "../../theme.js";
import SponsoredProducts from "./SponsoredProducts.jsx";
import { Honest, Loading, PageHead, Section, button, chip, dim, errorStyle, figures, inputStyle, labelStyle, linkStyle, money, page, scroll, table, td, th } from "./mkParts.jsx";

// ─── 13 Featured listings ────────────────────────────────────────────────────
// Which paid featured promotion holds which place on the site, week by week. A place is booked
// here for a featured promotion that an owner already bought (the promotion itself is approved
// under Promotions). Slot prices are the price of the place, not what the owner paid.
const CELL = {
  booked: { bg: "#F5ECD8", fg: "#2C1810", border: "1px solid #F5ECD8" },
  waiting: { bg: "#FBF3DC", fg: "#6A4A00", border: "1px solid #D4A017" },
  open: { bg: "#FFFFFF", fg: "rgba(44,24,16,0.72)", border: "1px dashed #2C181066" },
  held: { bg: "#FDE8E8", fg: "#A30000", border: "1px solid #FDE8E8" },
  stopped: { bg: "#EEE", fg: "#555", border: "1px solid #CCC" },
};
const WORD = { open: "Open", booked: "Booked", waiting: "Waiting in Promotions", held: "Held", stopped: "Promotion stopped" };
const shiftDate = (iso, weeks) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + weeks * 7); return d.toISOString().slice(0, 10); };

function BookForm({ grid, canManage, onBooked }) {
  const [q, setQ] = useState("");
  const { data } = useFeaturedCandidates(q, canManage);
  const [form, setForm] = useState({ promotion_id: "", slot_key: "home-1", category: "", position: "1", week_start: grid.weeks[0].start, weeks: "1" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!canManage) return null;
  const slot = grid.slots.find((s) => s.key === form.slot_key);
  const chosen = data?.promotions.find((p) => String(p.promotion_id) === String(form.promotion_id));
  const set = (patch) => { setError(""); setForm({ ...form, ...patch }); };

  async function book(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiPost("/api/marketing/featured/bookings/", {
        promotion_id: Number(form.promotion_id), slot_key: form.slot_key, week_start: form.week_start, weeks: Number(form.weeks),
        category: slot.kind === "category_top" ? Number(form.category) || null : null, position: slot.kind === "category_top" ? Number(form.position) : null,
      });
      onBooked();
    } catch (e) { setError(apiErrorMessage(e, "That booking did not work.")); } finally { setBusy(false); }
  }

  return (
    <Section id="ft-book" title="Give a featured promotion a place">
      <form onSubmit={book} aria-label="Book a slot" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, alignItems: "start" }}>
        <label style={labelStyle}>Find a promotion<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business or listing" style={inputStyle} /></label>
        <label style={labelStyle}>Featured promotion
          <select value={form.promotion_id} onChange={(e) => set({ promotion_id: e.target.value })} required style={inputStyle}>
            <option value="">Choose…</option>
            {(data?.promotions || []).map((p) => <option key={p.promotion_id} value={p.promotion_id}>{p.business} · {p.listing_name} ({p.status === "pending" ? "waiting in Promotions" : "active"}, {p.weeks_placed}/{p.weeks_paid} weeks placed)</option>)}
          </select>
        </label>
        <label style={labelStyle}>Slot
          <select value={form.slot_key} onChange={(e) => set({ slot_key: e.target.value })} style={inputStyle}>
            {grid.slots.map((s) => <option key={s.key} value={s.key}>{s.label} · {money(s.weekly_price)} a week</option>)}
          </select>
        </label>
        {slot?.kind === "category_top" && (
          <>
            <label style={labelStyle}>Category
              <select value={form.category} onChange={(e) => set({ category: e.target.value })} required style={inputStyle}>
                <option value="">Choose…</option>
                {grid.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label style={labelStyle}>Place
              <select value={form.position} onChange={(e) => set({ position: e.target.value })} style={inputStyle}>
                {Array.from({ length: slot.capacity }, (_, i) => <option key={i + 1} value={i + 1}>Top {i + 1}</option>)}
              </select>
            </label>
          </>
        )}
        <label style={labelStyle}>First week
          <select value={form.week_start} onChange={(e) => set({ week_start: e.target.value })} style={inputStyle}>
            {grid.weeks.map((w) => <option key={w.start} value={w.start}>{w.label}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Weeks
          <select value={form.weeks} onChange={(e) => set({ weeks: e.target.value })} style={inputStyle}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 8 }}>
          {chosen?.blockers.length > 0 && <div role="alert" style={errorStyle}>{chosen.blockers.map((b) => b.message).join(" ")}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" disabled={busy || !form.promotion_id || chosen?.blockers.length > 0} style={button(D.gold, D.text, busy || !form.promotion_id || chosen?.blockers.length > 0)}>{busy ? "Booking…" : "Book the place"}</button>
            <span style={dim}>Booking does not charge anyone or change what the owner paid. A promotion can hold as many weeks as it paid for.</span>
          </div>
          {error && <div role="alert" style={errorStyle}>{error}</div>}
        </div>
      </form>
    </Section>
  );
}

export default function FeaturedListingsPanel({ auth }) {
  const [from, setFrom] = useState("");
  const { data, isError, refetch } = useFeaturedGrid(from);
  const [error, setError] = useState("");
  const canManage = auth?.hasPermission?.("site_promo.manage");
  if (!data) return <div style={page}><PageHead title="Featured listings" /><Loading error={isError} onRetry={refetch} what="the featured slots" /></div>;

  async function release(cell) {
    setError("");
    try { await apiPost(`/api/marketing/featured/bookings/${cell.booking_id}/release/`, {}); refetch(); } catch (e) { setError(apiErrorMessage(e, "Could not release it.")); }
  }
  const { prices, summary } = data;

  return (
    <div style={page}>
      <PageHead title="Featured listings">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {prices.slots.map((p) => <span key={p.key} style={chip(D.text)}>{p.label}: {money(p.weekly_price)} a week · {p.places} {p.per}</span>)}
        </div>
      </PageHead>
      <Honest>Slot prices are fixed on the slot rows and aren't changed here. Owners buy a featured promotion at {money(prices.promotion_daily_rate)} a day; the two prices are not reconciled yet, and a booking changes neither. Each promotion also passes Moderation › Promotions.</Honest>
      {error && <div role="alert" style={errorStyle}>{error}</div>}

      <Section id="ft-grid" title="Slots by week" action={
        <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" style={linkStyle} onClick={() => setFrom(shiftDate(data.weeks[0].start, -4))}>Earlier weeks</button>
          <button type="button" style={linkStyle} onClick={() => setFrom(shiftDate(data.weeks[0].start, 4))}>Later weeks</button>
        </span>
      }>
        <div style={dim}>Booked for {summary.week_label}: {summary.booked} {summary.booked === 1 ? "slot" : "slots"} · {money(summary.list_price_total)} at list price{summary.waiting ? ` · ${summary.waiting} waiting in Promotions` : ""}. List price is the price of the places, not money received.</div>
        <div style={scroll}>
          <table style={table}>
            <thead><tr>
              <th scope="col" style={th}>Slot</th>
              {data.weeks.map((w) => <th key={w.start} scope="col" style={th}>{w.label}{w.current ? " · this week" : ""}</th>)}
            </tr></thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={`${row.slot_key}-${row.category?.id || 0}-${row.position}`}>
                  <th scope="row" style={{ ...td, textAlign: "left" }}>{row.name}</th>
                  {row.cells.map((cell) => {
                    const look = CELL[cell.state];
                    return (
                      <td key={cell.week_start} style={td}>
                        <div style={{ background: look.bg, color: look.fg, border: look.border, borderRadius: 8, padding: "6px 8px", fontWeight: 700, minWidth: 120 }}>
                          {cell.state === "open" ? WORD.open : cell.business}
                          {cell.state !== "open" && cell.state !== "booked" && <div style={{ fontWeight: 600, fontSize: "0.7rem" }}>{WORD[cell.state]}{cell.reason ? `: ${cell.reason}` : ""}</div>}
                          {cell.booking_id && canManage && <button type="button" aria-label={`Release ${row.name} for ${cell.business}`} style={{ ...linkStyle, fontSize: "0.7rem", display: "block" }} onClick={() => release(cell)}>Release</button>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", ...dim }}>
          {["booked", "waiting", "open", "held"].map((k) => <span key={k} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 3, background: CELL[k].bg, border: CELL[k].border }} />{k === "booked" ? "Booked" : k === "held" ? "Held: business under review" : WORD[k]}</span>)}
        </div>
        <div style={{ ...dim, ...figures }}>Releasing a place frees it for someone else. It is not a refund: nothing is paid back.</div>
      </Section>

      <BookForm key={data.weeks[0].start} grid={data} canManage={canManage} onBooked={refetch} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
        <Section id="ft-look" title="Paid and verified must never look alike">
          <div><span style={{ border: "2px solid #D4A017", borderRadius: 6, padding: "1px 8px", fontWeight: 800, fontSize: "0.75rem" }}>Featured</span> Paid placement: gold outline, the word “Featured”, no tick. It means the business paid for the spot, nothing more.</div>
          <div><span style={{ color: "#00500A", fontWeight: 800, fontSize: "0.75rem" }}>✓ Verified</span> Verification: a green tick on a plain field. Earned through KYC by Operations. It can never be bought and never turns gold.</div>
          <div style={dim}>A featured listing from a verified business shows both, side by side, each in its own style.</div>
        </Section>
        <Section id="ft-block" title="Who can't book">
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, fontSize: "0.8rem" }}>
            <li>A business with an open fraud case: its place is held until Operations closes the case.</li>
            <li>A business whose subscription is overdue, until it pays.</li>
            <li>A listing that is hidden, out of stock or still waiting for moderation.</li>
          </ul>
          <div style={dim}>A held business does not show on the site while the hold lasts.</div>
        </Section>
      </div>
      {auth?.hasPermission?.("deals.manage") && <SponsoredProducts />}
    </div>
  );
}
