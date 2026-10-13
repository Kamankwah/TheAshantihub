import { useState } from "react";
import { useCoupons } from "../../../../hooks/useMarketingPromos.js";
import { D } from "../../theme.js";
import CouponEditor from "./CouponEditor.jsx";
import { OffNotice } from "./promoParts.jsx";
import { Honest, Kpi, Loading, PageHead, Section, button, chip, dim, money, page, scroll, table, td, th } from "./mkParts.jsx";

// ─── 10 Coupons ──────────────────────────────────────────────────────────────
export const COUPON_STATUS = {
  draft: ["Draft", D.textDim], waiting_approval: ["Waiting for Super Admin", D.amber], active: ["Live", D.green], paused: ["Paused", D.amber], expired: ["Ended", D.textDim],
};
export const valueWord = (c) => (c.kind === "percent" ? `${Number(c.value)}% off${c.max_discount ? `, up to ${money(c.max_discount)}` : ""}` : `${money(c.value)} off`);
const dateWord = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "No end date");
const FILTERS = [["all", "All"], ["active", "Live"], ["waiting_approval", "Waiting for Super Admin"], ["paused", "Paused"], ["expired", "Ended"], ["draft", "Drafts"]];

export default function CouponsPanel({ detailId, onOpenDetail }) {
  const { data, isError, refetch } = useCoupons();
  const [filter, setFilter] = useState("all");
  if (detailId) return <CouponEditor id={detailId} onBack={() => { refetch(); onOpenDetail?.(null); }} onOpenDetail={onOpenDetail} />;
  if (!data) return <div style={page}><PageHead title="Coupons" /><Loading error={isError} onRetry={refetch} what="coupons" /></div>;
  const rows = data.results.filter((c) => filter === "all" || c.effective_status === filter);
  const k = data.kpis;
  return (
    <div style={page}>
      <PageHead title="Coupons"><button type="button" onClick={() => onOpenDetail?.("new")} style={button(D.gold, D.text)}>New coupon</button></PageHead>
      <OffNotice data={data} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <Kpi label="Live coupons" value={k.live} sub={`${k.waiting} waiting for Super Admin · ${k.paused} paused`} />
        <Kpi label="Redeemed, last 7 days" value={k.redeemed_7d} sub="Across all codes" />
        <Kpi label="Discount cost, last 7 days" value={money(k.cost_7d)} sub="Paid by AshantiHub" />
        <Kpi label="Most live coupons can still cost" value={money(k.most_still_payable)} sub="Budget caps minus cost so far" />
      </div>
      <Section id="cp-all" title={`All coupons · ${rows.length}`} action={
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.75rem", fontWeight: 700 }}>Status
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ padding: "6px 8px", borderRadius: 8, border: `1px solid ${D.cardBorder}`, fontFamily: "inherit" }}>
            {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      }>
        {rows.length === 0 ? <Honest>{data.results.length === 0 ? "No coupon yet." : "No coupon in this status."}</Honest> : (
          <div style={scroll}>
            <table style={table}>
              <thead><tr>{["Code", "Value", "Minimum spend", "Uses / limit", "Per customer", "Expiry", "Cost so far", "Status"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((c) => {
                  const [label, color] = COUPON_STATUS[c.effective_status] || [c.effective_status, D.textDim];
                  return (
                    <tr key={c.id}>
                      <td style={td}><button type="button" onClick={() => onOpenDetail?.(String(c.id))} style={{ background: "none", border: 0, padding: 0, font: "inherit", fontWeight: 800, color: D.text, textDecoration: "underline", cursor: "pointer" }}>{c.code_mode === "single_use" ? `${c.code}-•••••` : c.code}</button><div style={dim}>{c.code_mode === "single_use" ? `${c.usage_limit} single-use codes` : "One shared code"}{c.category_label ? ` · ${c.category_label}` : ""}</div></td>
                      <td style={td}>{valueWord(c)}</td><td style={td}>{money(c.min_spend)}</td>
                      <td style={td}>{c.uses} / {c.usage_limit}</td><td style={td}>{c.code_mode === "single_use" ? "1 code each" : c.per_customer_limit}</td>
                      <td style={td}>{dateWord(c.expires_at)}</td><td style={td}>{money(c.cost_to_date)}<div style={dim}>of {money(c.budget_cap)} cap</div></td>
                      <td style={td}><span style={chip(color)}>{label}</span>{c.paused_reason && <div style={dim}>{c.paused_reason}</div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={dim}>Cost so far is the discount AshantiHub has paid on orders that stand (a cancelled order gives the use back). Order payments are simulated until Hubtel payments are connected.</div>
      </Section>
      <Section id="cp-rules" title="Rules for every coupon">
        <p style={{ margin: 0, fontSize: "0.82rem", lineHeight: 1.6 }}>AshantiHub pays the discount: the seller always receives the full price. One coupon per order, never on top of a flash-sale price. A coupon whose most-it-can-cost is above {money(data.threshold)} waits for Super Admin before anyone can use it.</p>
      </Section>
    </div>
  );
}
