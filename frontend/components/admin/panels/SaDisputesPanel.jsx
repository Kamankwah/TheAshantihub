import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSaDisputeCounts, useSaDisputes } from "../../../hooks/useMarketplace.js";
import { D } from "../theme.js";
import { DisputeRow } from "./DisputesPanel.jsx";
import { button, callout, dim } from "./panelStyles.js";
import { Chip, ExportButton, FilterBar, KpiStrip, LoadState, Pager, ScreenHeader, col, dateTime, showing, tableStyle, td, th } from "./marketplaceParts.jsx";
import { card, h3, money, useDebounced } from "./portfolioParts.jsx";

// Super Admin > Disputes & returns (screen 22): every dispute across the teams.
// A dispute has four states, so only the stages they support are drawn:
// open (Support takes it in), investigating (Accounting decides the refund)
// and closed. There is no returns model, no answer-due timer and no Delivery
// stage yet, so none is shown. Opening a case shows its evidence and the same
// flag / resolve actions as the Disputes queue.

const STAGES = [
  ["1", "Intake", "Support takes the complaint", "with_support", "support"],
  ["2", "Decision", "Accounting investigates and decides the refund", "with_accounting", "accounting"],
  ["3", "Closed", "The customer and the business are told the outcome", "closed_this_month", null],
];
const REASONS = [["", "All types"], ["order_issue", "Order issue"], ["payment_issue", "Payment issue"], ["delivery_issue", "Delivery issue"], ["quality_issue", "Quality issue"], ["other", "Other"]];
const TEAM_COLOR = { support: D.blue, accounting: D.amber };

export default function SaDisputesPanel({ auth }) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ scope: "open", team: "", reason: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [exportError, setExportError] = useState(null);
  const q = useDebounced(search.trim());
  const params = { ...filters, q };
  const list = useSaDisputes({ ...params, page });
  const { data: counts } = useSaDisputeCounts();
  const rows = list.data?.results || [];
  const change = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  const refresh = () => ["sa-disputes", "disputes-queue", "staff-badges"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  const opened = rows.find((r) => r.id === openId);

  const tiles = counts ? [
    { label: "Open cases", value: counts.open, sub: `${counts.opened_today} opened today` },
    { label: "With Support", value: counts.with_support, sub: "Taking in the details" },
    { label: "With Accounting", value: counts.with_accounting, sub: "Refund decisions" },
    { label: "Closed this month", value: counts.closed_this_month, sub: "Resolved or turned down" },
    { label: "Order value at stake", value: money(counts.order_value_at_stake), sub: "Whole orders of open cases" },
  ] : [];
  const filterDefs = [
    { key: "scope", label: "Which cases", options: [["open", "Open"], ["closed", "Closed"], ["all", "All"]] },
    { key: "team", label: "With", options: [["", "All teams"], ["support", "Support"], ["accounting", "Accounting"]] },
    { key: "reason", label: "Type", options: REASONS },
  ];

  return (
    <div style={col}>
      <ScreenHeader title="Disputes & returns" note="Every case, whichever team has it. Returns are not a separate record yet; a return arrives as a dispute.">
        <ExportButton path="/api/marketplace/disputes/export/" params={params} filename="disputes.csv" label="Export (CSV)" onError={setExportError} />
      </ScreenHeader>
      {exportError && <div role="alert" style={callout(D.red)}>{exportError}</div>}
      <KpiStrip tiles={tiles} label="Disputes summary" />

      <section aria-label="How a case moves" style={card}>
        <h3 style={h3}>How a case moves</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 10 }}>
          {STAGES.map(([n, name, who, key]) => (
            <div key={name} style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: 800, fontSize: "0.85rem", color: D.text }}>{`${n} · ${name}`}</div>
              <div style={dim}>{who}</div>
              <div style={{ fontWeight: 800, fontSize: "0.8rem", color: D.text }}>{counts ? `${counts[key]} ${key === "closed_this_month" ? "this month" : counts[key] === 1 ? "case" : "cases"}` : ""}</div>
            </div>
          ))}
        </div>
      </section>

      <div style={card}>
        <h3 style={h3}>Cases</h3>
        <FilterBar filters={filterDefs} values={filters} onChange={change} search={search} onSearch={(v) => { setSearch(v); setPage(1); }} searchLabel="Case, order or customer" />
      </div>

      {opened && (
        <section aria-label={`Case ${opened.id}`} style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <h3 style={h3}>{`Case #${opened.id} · ${opened.reason_label}`}</h3>
            <button type="button" onClick={() => setOpenId(null)} style={button(D.panelBg, D.text)}>Close</button>
          </div>
          <div style={dim}>{opened.team_label ? `With ${opened.team_label} · ${opened.stage}` : "Closed"}{opened.businesses.length ? ` · ${opened.businesses.join(", ")}` : ""}</div>
          {opened.status === "open" || opened.status === "investigating" ? (
            <DisputeRow dispute={opened} state="pending" canFlag={Boolean(auth?.hasPermission?.("disputes.flag"))} canResolve={Boolean(auth?.hasPermission?.("disputes.resolve_financial"))} onDone={refresh} />
          ) : (
            <DisputeRow dispute={opened} state={opened.status === "resolved" ? "approved" : "rejected"} canFlag={false} canResolve={false} onDone={refresh} />
          )}
        </section>
      )}

      <div style={card}>
        <LoadState query={list} what="the cases" />
        {!list.isLoading && !list.isError && rows.length === 0 && <div style={dim}>No case matches.</div>}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Cases" style={{ ...tableStyle, minWidth: 820 }}>
              <thead><tr><th style={th}>Case</th><th style={th}>Order · business · customer</th><th style={th}>With</th><th style={th}>Stage</th><th style={th}>Opened</th><th style={th}>At stake</th><th style={th} /></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td style={td}><div style={{ fontWeight: 800 }}>{`#${d.id}`}</div><div style={dim}>{d.reason_label}</div></td>
                    <td style={td}>{`${d.order ? `Order #${d.order}` : "No order"}${d.businesses.length ? ` · ${d.businesses.join(", ")}` : ""}`}<div style={dim}>{d.raised_by_name || "Logged by staff"}</div></td>
                    <td style={td}>{d.team ? <Chip color={TEAM_COLOR[d.team]}>{d.team_label}</Chip> : <Chip color={D.green}>Closed</Chip>}{d.flagged_by_name && <div style={dim}>{`Flagged by ${d.flagged_by_name}`}</div>}</td>
                    <td style={td}>{d.stage}</td>
                    <td style={td}>{dateTime(d.created_at)}</td>
                    <td style={td}>{d.at_stake ? money(d.at_stake) : d.refund_amount ? `Refunded ${money(d.refund_amount)}` : "—"}</td>
                    <td style={td}><button type="button" aria-label={`Open case ${d.id}`} onClick={() => setOpenId(d.id)} style={button(D.panelBg, D.text)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && <div style={dim}>{`${showing(list.data, rows)} · oldest open case first. Every case is with AshantiHub, never between the customer and the business directly.`}</div>}
      </div>
      <Pager data={list.data} page={page} setPage={setPage} />
    </div>
  );
}
