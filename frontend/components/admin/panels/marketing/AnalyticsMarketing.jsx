import { useState } from "react";
import { useMarketingPeriodAnalytics } from "../../../../hooks/useMarketingModeration.js";
import { D } from "../../theme.js";
import { ExportBar } from "../insightsParts.jsx";
import { Honest, Kpi, Loading, PageHead, QueueSwitch, Section, dim, errorStyle, money, page, scroll, table, td, th } from "./mkParts.jsx";

// ─── 17 Analytics (period view for Marketing) ────────────────────────────────
// Real counts for the last 7, 30 or 90 days from AshantiHub's own records. The opt-ins
// tile reads the consent ledger and says so plainly while nothing has been recorded.
const PERIODS = [[7, "Last 7 days"], [30, "30 days"], [90, "90 days"]];
const NOT_RECORDED = [
  ["Visits and page views", "AshantiHub does not record who looks at which page, so the orders that did not come from a campaign link or coupon cannot be split by source."],
  ["WhatsApp results", "WhatsApp is not connected; nothing has been sent."],
  ["AshantiHub's income from these orders", "Order value is what customers paid businesses; commission and fees live in Accounting."],
];
const fmtNum = (n) => Number(n || 0).toLocaleString("en-GB");

function MarketplaceView({ m, days }) {
  const t = m.totals;
  const src = m.sources;
  const top = Math.max(1, ...m.categories.map((c) => c.orders + c.bookings));
  const reach = (k) => m.reachable.find((r) => r.channel === k)?.opted_in ?? 0;
  return (
    <>
      <div role="group" aria-label="On AshantiHub now" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <Kpi label="Businesses on AshantiHub" value={fmtNum(t.businesses)} sub={`${fmtNum(t.businesses_verified)} KYC verified`} />
        <Kpi label="Live listings" value={fmtNum(t.live_listings)} sub="Published products and services" />
        <Kpi label="Customers" value={fmtNum(t.customers)} sub="Accounts" />
        <Kpi label="Order value" value={money(m.order_value)} sub={`Last ${days} days, paid to businesses`} />
        <Kpi label="Live events" value={fmtNum(t.live_events)} sub="Approved" />
        <Kpi label="Active promotions" value={fmtNum(t.active_promotions)} sub="Running now" />
        <Kpi label="Reachable by SMS" value={fmtNum(reach("sms"))} sub="Opted in, see Consent" />
        <Kpi label="Reachable by email" value={fmtNum(reach("email"))} sub="Opted in" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, alignItems: "start" }}>
        <Section id="by-category" title={`By category · last ${days} days`}>
          {m.categories.length === 0 ? <Honest>No live listing or order in a category yet.</Honest> : (
            <div style={scroll}>
              <table style={table}>
                <thead><tr>{["Category", "Live listings", "Orders and bookings", "Order value"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {m.categories.map((c) => (
                    <tr key={c.id}>
                      <th scope="row" style={{ ...td, textAlign: "left" }}>{c.name}</th>
                      <td style={td}>{fmtNum(c.live_listings)}</td>
                      <td style={td}><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><b style={{ minWidth: 28 }}>{fmtNum(c.orders + c.bookings)}</b><span aria-hidden="true" style={{ display: "inline-block", width: 90, height: 8, borderRadius: 99, background: D.panelBg2 }}><span style={{ display: "block", height: 8, borderRadius: 99, background: D.text, width: `${Math.round(100 * (c.orders + c.bookings) / top)}%` }} /></span></span><div style={dim}>{fmtNum(c.orders)} orders · {fmtNum(c.bookings)} bookings</div></td>
                      <td style={td}>{money(c.order_value)}</td>
                    </tr>
                  ))}
                  <tr><th scope="row" style={{ ...td, textAlign: "left" }}>All categories</th><td style={td}><b>{fmtNum(m.category_totals.live_listings)}</b></td><td style={td}><b>{fmtNum(m.category_totals.orders + m.category_totals.bookings)}</b></td><td style={td}><b>{money(m.category_totals.order_value)}</b></td></tr>
                </tbody>
              </table>
            </div>
          )}
          <div style={dim}>Order value counts only product orders; bookings are counted but carry no order value here.</div>
        </Section>
        <Section id="sources" title={`Where the ${fmtNum(src.orders)} orders came from`}>
          {[["A campaign link (SMS, email, in-app)", `${fmtNum(src.campaign)}${src.campaign ? ` · ${money(src.campaign_value)}` : ""}`], ["A coupon, without a campaign link", fmtNum(src.coupon)], ["Everything else", fmtNum(src.other)]].map(([l, v]) => (
            <div key={l} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.82rem" }}><span>{l}</span><b>{v}</b></div>
          ))}
          <div style={dim}>A campaign order is one placed within 7 days after the same customer clicked a campaign link.</div>
        </Section>
      </div>
    </>
  );
}

export default function AnalyticsMarketing() {
  const [days, setDays] = useState(30);
  const { data, isLoading, isError, refetch } = useMarketingPeriodAnalytics(days);
  const [exportError, setExportError] = useState("");
  const opt = data?.opt_ins;
  return (
    <div style={page}>
      <PageHead title="Analytics">
        <QueueSwitch label="Period" value={days} onChange={setDays} options={PERIODS} />
        <ExportBar path={`/api/marketing/analytics/?days=${days}`} stem={`marketing-analytics-${days}d`} onError={setExportError} label="Export analytics" />
      </PageHead>
      {exportError && <div role="alert" style={errorStyle}>{exportError}</div>}
      <Honest>Every number here is counted from AshantiHub's own records, with no estimates or projections. Where we do not record something, the screen says so. Order counts include simulated payments until Hubtel payments are connected.</Honest>
      {isLoading || isError || !data ? <Loading error={isError} onRetry={refetch} what="analytics" /> : (
        <>
          <div role="group" aria-label={`Last ${days} days`} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
            <Kpi label="New customers" value={fmtNum(data.customers)} sub={`Signed up in the last ${days} days`} />
            <Kpi label="New businesses" value={fmtNum(data.business_owners)} sub="Registered" />
            <Kpi label="New listings" value={fmtNum(data.listings)} sub="Created, any status" />
            <Kpi label="Orders placed" value={fmtNum(data.orders)} sub={`${fmtNum(data.orders_paid)} paid`} />
            <Kpi label="Events submitted" value={fmtNum(data.events)} sub="Sent for approval" />
            <Kpi label="Hero submissions" value={fmtNum(data.hero_submissions)} sub="Sent for approval" />
            <Kpi label="Promotions approved" value={fmtNum(data.promotions_started)} sub={`${fmtNum(data.promotions_bought)} bought`} />
            <Kpi label="Promotion revenue" value={money(data.promotion_revenue)} sub="What owners paid, simulated payments" />
            <Kpi label="Opt-ins" value={opt?.state === "tracked" ? fmtNum(opt.opted_in) : "—"}
              sub={opt?.state === "tracked" ? `${fmtNum(opt.opted_out)} opted out. From the consent ledger.` : (opt?.note || "No opt-ins recorded yet.")} />
          </div>
          {data.marketplace && <MarketplaceView m={data.marketplace} days={days} />}
          <Section id="not-recorded" title="Not recorded yet">
            {NOT_RECORDED.map(([what, why]) => <p key={what} style={{ ...dim, margin: 0 }}><b style={{ color: D.text }}>{what}</b> {"—"} {why}</p>)}
          </Section>
        </>
      )}
    </div>
  );
}
