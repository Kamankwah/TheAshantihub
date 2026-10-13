import { useFraudFlagCounts, useFraudFlags } from "../../../hooks/useFraudFlags.js";
import { D } from "../theme.js";
import { callout, chip, dim } from "./panelStyles.js";
import { formatDateTime } from "./portfolioParts.jsx";
import { Kpi, kpiGrid, page, section, sectionTitle } from "./insightsParts.jsx";
import { h2 } from "./portfolioParts.jsx";
import FraudCasesPanel from "./FraudCasesPanel.jsx";

// ─── Super Admin 12 Fraud & anomaly alerts ───────────────────────────────────
// The fraud-case queue (FraudCasesPanel, where every decision needs a note) with the
// cases that name a staff member put first, so nobody judges their own team. Money and
// activity anomalies have no detectors yet: each is listed as "Not monitored yet" and
// never as a zero, because a zero would claim someone is watching.
const NOT_MONITORED = [
  ["Rider cash not handed in", "Needs the delivery cash records, which arrive with the Delivery phase."],
  ["Payout number changes", "There are no payout records to compare yet; payouts arrive with the Accounting phase."],
  ["Reconciliation differences", "Needs Hubtel and bank statements, which are not connected."],
  ["Unusual refunds", "Refunds are listed in Money › Refunds, but nothing watches them for patterns yet."],
];

function StaffInvolved({ flags }) {
  return (
    <section aria-label="Needs you" style={{ ...section, border: `1px solid ${D.gold}` }}>
      <h3 style={sectionTitle}>{`Needs you · ${flags.length}`}</h3>
      <div style={dim}>These open cases name a staff member. Decide them below; a case about you is decided by someone else.</div>
      {flags.map((flag) => (
        <div key={flag.id} style={{ display: "flex", flexDirection: "column", gap: 3, borderTop: `1px solid ${D.divider}`, paddingTop: 8 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={chip(D.red)}>{flag.kind_label}</span>
            <span style={{ fontWeight: 800, fontSize: "0.85rem", color: D.text }}>{flag.title}</span>
          </div>
          <div style={dim}>{`About ${flag.staff_subject.full_name} · opened ${formatDateTime(flag.created_at)}`}</div>
          {flag.detail && <div style={{ fontSize: "0.8rem", color: D.text }}>{flag.detail}</div>}
        </div>
      ))}
    </section>
  );
}

export default function FraudAlertsPanel({ auth, onOpenBusiness }) {
  const open = useFraudFlags("open");
  const counts = useFraudFlagCounts();
  const loaded = (open.data?.pages || []).flatMap((p) => p.results);
  const involving = loaded.filter((flag) => flag.staff_subject);
  return (
    <div style={page}>
      <h2 style={{ ...h2, fontSize: "1.4rem" }}>Fraud &amp; anomaly alerts</h2>
      <div role="note" style={callout(D.amber)}>
        Operations works the fraud queue. Anything that names a staff member is shown to you first. Money anomalies have no monitoring yet: nothing below is a clean bill of health.
      </div>
      {counts.data && (
        <div style={kpiGrid}>
          <Kpi label="Open cases" value={counts.data.open} />
          <Kpi label="Open, naming a staff member" value={open.isLoading ? "…" : involving.length} sub={open.hasNextPage ? "among the cases loaded so far" : undefined} />
          <Kpi label="Confirmed" value={counts.data.confirmed} />
          <Kpi label="Dismissed" value={counts.data.dismissed} />
        </div>
      )}
      {involving.length > 0 && <StaffInvolved flags={involving} />}
      <FraudCasesPanel auth={auth} onOpenBusiness={onOpenBusiness} />
      <section aria-label="Money and activity anomalies" style={section}>
        <h3 style={sectionTitle}>Money and activity anomalies</h3>
        <div style={dim}>Not monitored yet. These are listed so you know what is not being watched, not as alerts.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          {NOT_MONITORED.map(([name, why]) => (
            <div key={name} style={{ border: `1px dashed ${D.cardBorder}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontWeight: 800, fontSize: "0.82rem", color: D.text }}>{name}</span>
              <span style={chip(D.textFaint)}>Not monitored yet</span>
              <span style={dim}>{why}</span>
            </div>
          ))}
        </div>
        <div style={dim}>Checks that do run today (outside-radius check-ins, self-dealing registrations, owners’ “This wasn’t me”) raise the cases above.</div>
      </section>
    </div>
  );
}
