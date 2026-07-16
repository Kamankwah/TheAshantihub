import { useState } from "react";
import { useTransactionsReport } from "../../../hooks/useTransactionsReport.js";
import { D, glassCard, ghs } from "../theme.js";
import KpiCard from "../../dashboard/charts/KpiCard.jsx";
import ChartFrame from "../../dashboard/charts/ChartFrame.jsx";
import SpendAreaChart from "../../dashboard/charts/SpendAreaChart.jsx";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-01" -> "Jan 2026" — SpendAreaChart's own convention uses an
// abbreviated month label; the report endpoint returns a sortable ISO
// "YYYY-MM" key and leaves display formatting to the caller (see
// backend/billing/views.py's TransactionReportView docstring).
function formatMonth(key) {
  const [year, month] = String(key).split("-");
  const idx = Number(month) - 1;
  return MONTH_LABELS[idx] ? `${MONTH_LABELS[idx]} ${year}` : key;
}

const STATUS_META = {
  success: { label: "Success", color: D.green },
  pending: { label: "Pending", color: D.amber },
  failed: { label: "Failed", color: D.red },
  refunded: { label: "Refunded", color: D.purple },
};

// Platform-wide transactions report (staff-only, transactions.report) — a
// KPI row + monthly spend chart + status breakdown, sourced from
// GET /api/billing/transactions/report/. IMPORTANT (honesty, mirroring
// BusinessCommandCenter's AnalyticsPanel note): total_amount is a raw sum
// across every status (including refunded/failed/pending rows), not a "net
// revenue" figure — see the status breakdown below for that.
export default function TransactionsReportPanel() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const { data, isLoading, isError } = useTransactionsReport({ dateFrom: dateFrom || undefined, dateTo: dateTo || undefined });

  const series = (data?.series || []).map(row => ({ month: formatMonth(row.month), amount: Number(row.amount) || 0 }));
  const statusEntries = Object.entries(data?.status_breakdown || {});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...glassCard, padding: "14px 18px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={{ color: D.textDim, fontSize: "0.66rem", fontWeight: 700, marginBottom: 4 }}>From</div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
        </div>
        <div>
          <div style={{ color: D.textDim, fontSize: "0.66rem", fontWeight: 700, marginBottom: 4 }}>To</div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
        </div>
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(""); setDateTo(""); }} style={{ background: "rgba(255,255,255,0.06)", color: D.textDim, border: `1px solid ${D.divider}`, borderRadius: 20, padding: "6px 14px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>Clear</button>
        )}
      </div>

      {isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the transactions report.</div>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(178px,1fr))", gap: 12 }}>
            <KpiCard icon="🧾" label="Total Transactions" value={data.summary?.count ?? 0} accent={D.gold} />
            <KpiCard icon="💰" label="Total Amount" value={ghs(data.summary?.total_amount)} accent={D.green} sub="Across all statuses" />
          </div>

          <ChartFrame title="Transaction volume by month" icon="📈">
            <SpendAreaChart data={series} />
          </ChartFrame>

          <ChartFrame title="Status breakdown" icon="🗂️" minHeight={40}>
            {statusEntries.length === 0 ? (
              <div style={{ color: D.textFaint, fontSize: "0.74rem" }}>No transactions in this range.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {statusEntries.map(([status, row]) => {
                  const meta = STATUS_META[status] || { label: status, color: D.textDim };
                  return (
                    <div key={status} style={{ background: `${meta.color}14`, border: `1px solid ${meta.color}33`, borderRadius: 12, padding: "8px 14px", minWidth: 130 }}>
                      <div style={{ color: meta.color, fontWeight: 800, fontSize: "0.72rem" }}>{meta.label}</div>
                      <div style={{ color: D.text, fontWeight: 900, fontSize: "1rem", marginTop: 2 }}>{row.count}</div>
                      <div style={{ color: D.textDim, fontSize: "0.65rem" }}>{ghs(row.amount)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </ChartFrame>
        </>
      )}
    </div>
  );
}
