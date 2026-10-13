import { useState } from "react";
import { useMarketingPeriodAnalytics } from "../../../../hooks/useMarketingModeration.js";
import { D } from "../../theme.js";
import { ExportBar } from "../insightsParts.jsx";
import { Honest, Kpi, Loading, PageHead, QueueSwitch, Section, dim, errorStyle, money, page } from "./mkParts.jsx";

// ─── 17 Analytics (period view for Marketing) ────────────────────────────────
// Real counts for the last 7, 30 or 90 days from AshantiHub's own records. The opt-ins
// tile reads the consent ledger and says so plainly while nothing has been recorded.
const PERIODS = [[7, "Last 7 days"], [30, "30 days"], [90, "90 days"]];
const NOT_RECORDED = [
  ["Visits and page views", "AshantiHub does not record who looks at which page."],
  ["Orders by campaign", "No campaign links exist yet, so no order can be tied to one."],
  ["Order value by category", "Orders are stored with a total only, not split by category."],
];
const fmtNum = (n) => Number(n || 0).toLocaleString("en-GB");

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
          <Section id="not-recorded" title="Not recorded yet">
            {NOT_RECORDED.map(([what, why]) => <p key={what} style={{ ...dim, margin: 0 }}><b style={{ color: D.text }}>{what}</b> {"—"} {why}</p>)}
          </Section>
        </>
      )}
    </div>
  );
}
