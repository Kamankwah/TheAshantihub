import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBusinessCounts } from "../../../hooks/useMarketplace.js";
import { usePortfolio, useReassignableScouts } from "../../../hooks/usePortfolio.js";
import { useZones } from "../../../hooks/useZones.js";
import { D } from "../theme.js";
import { button, callout, chip, dim } from "./panelStyles.js";
import SaBusinessDetail from "./SaBusinessDetail.jsx";
import SuspendSheet from "./SuspendSheet.jsx";
import { Chip, ExportButton, FilterBar, KpiStrip, LoadState, Pager, ScreenHeader, col, dateOnly, showing, tableStyle, td, th } from "./marketplaceParts.jsx";
import { HealthChip, card, flagCount, h3, listingsLiveText, subscriptionText, useDebounced } from "./portfolioParts.jsx";

// Super Admin > Businesses (screen 16): every business, with the counts that
// matter on top, filters, a CSV of the list, and suspend / lift (reason, then
// the password, recorded). /staff/all-portfolios/<id> opens one business page.

const HEALTH_RULES = [
  ["At risk", D.red, (paused) => `${paused ? "Subscription paused, " : ""}no listing live, no order in 60 days once KYC is 30+ days old, or a confirmed fraud case.`],
  ["Needs attention", D.amber, () => "Subscription overdue, fewer than 3 listings live, no order in 30 days, an open dispute, or no scout call or visit in 30 days."],
  ["Healthy", D.green, () => "None of the above. Health is worked out live from records and saved each night for reports."],
];
const KYC = [["", "Any"], ["verified", "Verified"], ["pending", "Waiting"], ["suspended", "Suspended"]];
const HEALTH = [["", "Any"], ["healthy", "Healthy"], ["needs_attention", "Needs attention"], ["at_risk", "At risk"], ["new", "New · KYC waiting"]];
const FLAGS = [["", "Any"], ["fraud", "Fraud case"], ["dispute", "Open dispute"], ["no_login", "No owner login"]];
const SUBSCRIPTION = [["", "Any"], ["active", "Active"], ["trial", "Trial"], ["overdue", "Overdue"], ["paused", "Paused"], ["none", "No plan"]];
const EMPTY = { kyc: "", subscription: "", health: "", scout: "", zone: "", flag: "", unassigned: "" };

function kycChip(b) {
  if (b.is_suspended) return <Chip color={D.red}>Suspended</Chip>;
  if (b.kyc_status === "verified") return <Chip color={D.green}>Verified business</Chip>;
  if (b.kyc_status === "pending") return <Chip color={D.amber}>KYC waiting</Chip>;
  return <Chip color={D.textFaint}>{b.kyc_status}</Chip>;
}

function flagsOf(b) {
  const flags = [];
  if (flagCount(b.open_fraud_flags) > 0) flags.push("🚩 Fraud case open");
  if ((b.health?.reasons || []).includes("Open dispute")) flags.push("Open dispute");
  if (b.needs_claim) flags.push("Owner hasn't set a login");
  return flags;
}

export default function SaBusinessesPanel({ auth, detailId, onOpenDetail }) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(EMPTY);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [suspending, setSuspending] = useState(null); // a list row
  const [notice, setNotice] = useState(null);
  const [exportError, setExportError] = useState(null);
  const q = useDebounced(search.trim());
  const params = { scope: "all", ...filters, unassigned: filters.scout === "none" ? true : false, scout: filters.scout === "none" ? "" : filters.scout, q };
  const list = usePortfolio({ ...params, page }, { enabled: detailId == null });
  const { data: counts } = useBusinessCounts();
  const { scouts } = useReassignableScouts(auth);
  const { data: zones } = useZones();
  const rows = list.data?.results || [];
  const pauseOn = Boolean(counts?.pause_enabled); // unknown (still loading) reads as off: never claim a pause that may not exist

  if (detailId != null) return <SaBusinessDetail key={detailId} businessId={detailId} auth={auth} onBack={() => onOpenDetail?.(null)} />;

  const change = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  const refresh = () => {
    list.refetch();
    queryClient.invalidateQueries({ queryKey: ["sa-businesses"] });
    queryClient.invalidateQueries({ queryKey: ["portfolio-business"] });
  };
  const tiles = counts ? [
    { label: "Live on AshantiHub", value: counts.live, sub: `${counts.activated_this_month} activated this month` },
    { label: "KYC waiting", value: counts.kyc_waiting, sub: "In the KYC queue", tone: D.amber },
    { label: "Overdue", value: counts.overdue, sub: pauseOn ? "Days 1–14 · still visible" : "Unpaid · still visible", tone: D.amber },
    ...(pauseOn ? [{ label: "Paused", value: counts.paused, sub: "Day 15+ · listings hidden", tone: D.red }] : []),
    { label: "At risk", value: counts.at_risk, sub: "See how health works below", tone: D.red },
    { label: "Fraud cases open", value: counts.fraud_open, sub: (counts.fraud_open_names || []).join(", ") || "None open", tone: D.red },
    { label: "Suspended", value: counts.suspended, sub: "Listings hidden" },
  ] : [];
  const filterDefs = [
    { key: "kyc", label: "KYC", options: KYC },
    { key: "subscription", label: "Subscription", options: pauseOn ? SUBSCRIPTION : SUBSCRIPTION.filter(([v]) => v !== "paused") },
    { key: "health", label: "Health", options: HEALTH },
    { key: "scout", label: "Account manager", options: [["", "Anyone"], ["none", "None"], ...scouts.map((s) => [String(s.id), s.full_name])] },
    { key: "zone", label: "Area", options: [["", "All areas"], ...(zones || []).map((z) => [String(z.id), z.name])] },
    { key: "flag", label: "Flags", options: FLAGS },
  ];
  const exportParams = { scope: "all", ...params, page: undefined };

  return (
    <div style={col}>
      <ScreenHeader title="Businesses" note="Every business on AshantiHub, whoever manages it.">
        <ExportButton path="/api/portfolio/businesses/export/" params={exportParams} filename="businesses.csv" label="Export (CSV)" onError={setExportError} />
      </ScreenHeader>
      {exportError && <div role="alert" style={callout(D.red)}>{exportError}</div>}
      <KpiStrip tiles={tiles} label="Businesses summary" />

      <div style={card}>
        <h3 style={h3}>All businesses</h3>
        <FilterBar filters={filterDefs} values={filters} onChange={change} search={search} onSearch={(v) => { setSearch(v); setPage(1); }} searchLabel="Business, owner or phone" />
      </div>

      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      {suspending && (
        <SuspendSheet kind="business" id={suspending.id} name={suspending.business_name} suspended={suspending.is_suspended}
          onCancel={() => setSuspending(null)} onDone={(message) => { setSuspending(null); setNotice(message); refresh(); }} />
      )}

      <div style={card}>
        <LoadState query={list} what="the businesses" />
        {!list.isLoading && !list.isError && rows.length === 0 && <div style={dim}>No business matches these filters.</div>}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Businesses" style={{ ...tableStyle, minWidth: 980 }}>
              <thead>
                <tr><th style={th}>Business</th><th style={th}>KYC</th><th style={th}>Subscription</th><th style={th}>Account manager</th><th style={th}>Health</th><th style={th}>Flags</th><th style={th}>Last order</th><th style={th}>Actions</th></tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const flags = flagsOf(b);
                  return (
                    <tr key={b.id}>
                      <td style={td}>
                        <div style={{ fontWeight: 800 }}>{b.business_name}</div>
                        <div style={dim}>{[b.zone?.name, listingsLiveText(b) + " live"].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td style={td}>{kycChip(b)}{b.is_suspended && b.suspension_reason && <div style={dim}>{b.suspension_reason}</div>}</td>
                      <td style={td}>{subscriptionText(b.subscription, b.kyc_status)}{b.subscription?.plan_name && <div style={dim}>{b.subscription.plan_name}</div>}</td>
                      <td style={td}>{b.account_manager?.full_name || <span style={{ color: D.amber, fontWeight: 800 }}>{b.registration_channel === "self" ? "None · self-registered" : "None"}</span>}</td>
                      <td style={td}><HealthChip rating={b.health?.rating} /><div style={dim}>{b.health?.reasons?.[0] || ""}</div></td>
                      <td style={td}>{flags.length ? flags.map((f) => <div key={f} style={{ ...chip(D.red), display: "inline-block", marginBottom: 2 }}>{f}</div>) : "—"}</td>
                      <td style={td}>{b.last_order_at ? dateOnly(b.last_order_at) : "No orders yet"}</td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button type="button" aria-label={`Open ${b.business_name}`} onClick={() => onOpenDetail?.(b.id)} style={button(D.panelBg, D.text)}>Open</button>
                          <button type="button" aria-label={`${b.is_suspended ? "Lift suspension of" : "Suspend"} ${b.business_name}`} onClick={() => { setNotice(null); setSuspending(b); }}
                            style={button(b.is_suspended ? D.gold : D.panelBg, b.is_suspended ? D.text : D.red)}>{b.is_suspended ? "Lift suspension" : "Suspend"}</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && <div style={dim}>{`${showing(list.data, rows)} · sorted at risk first. Suspending hides a business's listings and events at once (nothing is deleted), tells the owner why, asks for your password and is recorded.`}</div>}
      </div>
      <Pager data={list.data} page={page} setPage={setPage} />

      <section aria-label="How health is worked out" style={card}>
        <h3 style={h3}>How health is worked out</h3>
        {HEALTH_RULES.map(([name, color, body]) => (
          <div key={name} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={chip(color)}>{name}</span>
            <span style={{ fontSize: "0.8rem", color: D.text, flex: 1, minWidth: 220 }}>{body(pauseOn)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
