import { useAnalyticsOverview } from "../../../hooks/useAnalyticsOverview.js";
import { D } from "../theme.js";
import KpiCard from "../../dashboard/charts/KpiCard.jsx";
import ChartFrame from "../../dashboard/charts/ChartFrame.jsx";
import ListingsDonut from "../../dashboard/charts/ListingsDonut.jsx";

// Marketplace Analytics tab (staff-only, analytics.view). Every figure here is
// a REAL count from GET /api/core/analytics/ (accounts/listings/orders/events
// row counts) — no fabricated data or invented time-series, matching this
// codebase's real-derived-only honesty principle (see the Business Command
// Center's AnalyticsPanel note in CLAUDE.md). This replaces the old
// "Coming soon" placeholder that used to render on this tab.

const LISTING_STATUS_META = [
  { key: "published", name: "Published", color: D.green },
  { key: "pending_review", name: "Pending Review", color: D.amber },
  { key: "draft", name: "Draft", color: D.textDim },
  { key: "rejected", name: "Rejected", color: D.red },
];

const LISTING_KIND_META = [
  { key: "product", name: "Products", color: D.gold },
  { key: "service", name: "Services", color: D.blue },
  { key: "event", name: "Events", color: D.purple },
];

const ORDER_STATUS_META = [
  { key: "paid", name: "Paid", color: D.green },
  { key: "pending", name: "Pending", color: D.amber },
  { key: "cancelled", name: "Cancelled", color: D.red },
];

const EVENT_STATUS_META = [
  { key: "approved", name: "Approved", color: D.green },
  { key: "pending", name: "Pending", color: D.amber },
  { key: "rejected", name: "Rejected", color: D.red },
];

const toSlices = (obj, meta) =>
  meta.map(m => ({ name: m.name, value: (obj || {})[m.key] || 0, color: m.color }));

export default function AnalyticsPanel() {
  const { data, isLoading, isError } = useAnalyticsOverview();

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError || !data) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load analytics.</div>;

  const kyc = data.business_owners_by_kyc || {};

  const kpis = [
    { icon: "👥", label: "Customers", value: data.customers ?? 0, accent: D.blue },
    { icon: "🏪", label: "Business Owners", value: data.business_owners ?? 0, accent: D.kente3, sub: `${kyc.verified ?? 0} verified · ${kyc.pending ?? 0} pending` },
    { icon: "🛍️", label: "Live Listings", value: (data.listings_by_status || {}).published ?? 0, accent: D.gold, sub: `${data.listings_total ?? 0} total` },
    { icon: "📦", label: "Orders", value: data.orders_total ?? 0, accent: D.green, sub: `${(data.orders_by_status || {}).paid ?? 0} paid` },
    { icon: "🎉", label: "Events", value: data.events_total ?? 0, accent: D.purple, sub: `${(data.events_by_status || {}).approved ?? 0} approved` },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ color: D.textFaint, fontSize: "0.72rem" }}>
        Live platform snapshot — real counts across accounts, listings, orders and events.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(178px,1fr))", gap: 12 }}>
        {kpis.map(k => <KpiCard key={k.label} {...k} />)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 16 }}>
        <ChartFrame title="Listings by status" icon="📋">
          <ListingsDonut data={toSlices(data.listings_by_status, LISTING_STATUS_META)} centerLabel="Listings" emptyMessage="No listings yet." />
        </ChartFrame>
        <ChartFrame title="Live listings by kind" icon="🗂️">
          <ListingsDonut data={toSlices(data.listings_by_kind, LISTING_KIND_META)} centerLabel="Live" emptyMessage="No published listings yet." />
        </ChartFrame>
        <ChartFrame title="Orders by status" icon="📦">
          <ListingsDonut data={toSlices(data.orders_by_status, ORDER_STATUS_META)} centerLabel="Orders" emptyMessage="No orders yet." />
        </ChartFrame>
        <ChartFrame title="Events by status" icon="🎉">
          <ListingsDonut data={toSlices(data.events_by_status, EVENT_STATUS_META)} centerLabel="Events" emptyMessage="No events yet." />
        </ChartFrame>
      </div>
    </div>
  );
}
