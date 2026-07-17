// ─── Payments Panel — Business Command Center "Payments" tab body ────────────
// Reworked for business item 4 (Wave I):
// - Overview now shows CUSTOMER SALES (money customers paid for this owner's
//   listings, via GET /api/orders/owner/report/) — NOT the owner's own outgoing
//   spend — with date + product/service filters and a CSV export.
// - The old "Subscribe" tab became "My Transactions & Subscription": the
//   owner's subscription state + their own outgoing payments (subscriptions,
//   promotions, events) + the plan grid (now kind-gated).
// - Reminders is real (subscription expiry, unpaid events, failed payments) —
//   the old hardcoded WhatsApp-schedule mock is gone.
import { useState } from "react";
import { D, glassCard, sectionTitle } from "../theme.js";
import { apiDownload, apiPost } from "../../../apiClient.js";
import { useMyTransactions } from "../../../hooks/useMyTransactions.js";
import { useSubscriptionPlans } from "../../../hooks/useSubscriptionPlans.js";
import { useMySubscription } from "../../../hooks/useMySubscription.js";
import { useMyEvents } from "../../../hooks/useMyEvents.js";
import { useOwnerSalesReport } from "../../../hooks/useOwnerSalesReport.js";
import DataTableCard from "../widgets/DataTableCard.jsx";

const CYCLE_OPTIONS = [
  { months: 1, label: "1 month" },
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "12 months" },
];

const inputStyle = { padding: "7px 10px", borderRadius: 8, border: `1.5px solid ${D.divider}`, fontSize: "0.76rem", fontFamily: "inherit", background: D.panelBg2, color: D.text };

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

export default function PaymentsPanel({ user, PaymentComponent, businessKind }) {
  const [payTab, setPayTab] = useState("overview");
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [cycleMonths, setCycleMonths] = useState(1);
  const [actionError, setActionError] = useState(null);
  // Sales-report filters (Wave I).
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [kind, setKind] = useState("");
  const [exporting, setExporting] = useState(false);

  const { data: transactions, isLoading: txLoading, isError: txError, refetch: refetchTx } = useMyTransactions();
  const { data: subPlans, isLoading: plansLoading, isError: plansError } = useSubscriptionPlans();
  const { data: subscription } = useMySubscription();
  const { data: myEvents } = useMyEvents();
  const report = useOwnerSalesReport({ dateFrom, dateTo, kind });

  const txList = transactions || [];
  const statusColor = { success: D.green, pending: D.amber, failed: D.red };
  const statusLabel = { success: "Success", pending: "Pending", failed: "Failed" };

  // Kind-gate the plan grid (fixes a Wave A gap where this tab showed every
  // plan regardless of the business's registered kind).
  const kindLocked = businessKind === "product" || businessKind === "service";
  const visiblePlans = kindLocked ? (subPlans || []).filter(p => p.kind === businessKind) : (subPlans || []);

  // Real payment reminders (Wave I) — derived, not mocked.
  const reminders = [];
  const subEnd = subscription?.current_period_end;
  const subDays = daysUntil(subEnd);
  if (subscription?.id && subDays != null && subDays <= 14) {
    reminders.push({
      icon: subDays < 0 ? "🔴" : "⏰", color: subDays < 0 ? D.red : D.amber,
      title: subDays < 0 ? "Your subscription has lapsed" : `Subscription renews in ${subDays} day${subDays === 1 ? "" : "s"}`,
      body: "Renew from the plans below to keep your listings live.", action: () => setPayTab("subscription"),
    });
  }
  (myEvents || []).filter(e => e.status === "approved" && !e.paid_at).forEach(e => {
    reminders.push({ icon: "🎉", color: D.gold, title: `“${e.name}” is approved but unpaid`, body: "Pay to publish it in the Events tab.", action: null });
  });
  txList.filter(t => t.status === "failed").forEach(t => {
    reminders.push({ icon: "⚠️", color: D.red, title: `Failed payment — ${t.purpose}`, body: `GHS ${Number(t.amount).toLocaleString()} didn't go through.`, action: null });
  });

  const tabs = [
    { id: "overview", icon: "📈", label: "Sales Overview" },
    { id: "subscription", icon: "💳", label: "My Transactions & Subscription" },
    { id: "reminders", icon: "🔔", label: "Reminders" },
  ];

  const cycleLabel = CYCLE_OPTIONS.find(c => c.months === cycleMonths)?.label || `${cycleMonths} months`;

  const exportCsv = async () => {
    setExporting(true);
    setActionError(null);
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (kind) params.set("kind", kind);
    try {
      await apiDownload(`/api/orders/owner/report/export/${params.toString() ? `?${params}` : ""}`, "ashantihub-sales.csv");
    } catch { setActionError("Could not export the CSV. Please try again."); }
    finally { setExporting(false); }
  };

  const recordSubscriptionPayment = async (ref) => {
    setShowPayModal(false);
    if (!selectedPlan) return;
    setActionError(null);
    const amount = Number(selectedPlan.monthly_price) * cycleMonths;
    try {
      const response = await apiPost("/api/billing/transactions/mine/", {
        kind: "subscription",
        amount: amount.toFixed(2),
        purpose: `AshantiHub ${selectedPlan.name} Plan — ${cycleLabel}`,
        metadata: { plan: selectedPlan.tier, cycle_months: cycleMonths },
      });
      if (response?.mode === "redirect") { window.location.href = response.checkout_url; return; }
      await apiPost("/api/billing/subscriptions/me/", { plan: selectedPlan.tier, cycle_months: cycleMonths });
      refetchTx();
    } catch (err) {
      setActionError("Payment was confirmed but we couldn't record it on your account. Please contact support with reference " + ref + ".");
    }
  };

  const summary = report.data?.summary;

  return (
    <div>
      {showPayModal && selectedPlan && (
        <PaymentComponent
          amount={Number(selectedPlan.monthly_price) * cycleMonths}
          purpose={`AshantiHub ${selectedPlan.name} Plan — ${cycleLabel}`}
          businessName={user?.fullName || "Your Business"}
          onSuccess={recordSubscriptionPayment}
          onClose={() => setShowPayModal(false)}
        />
      )}

      <div style={{ borderBottom: `1px solid ${D.divider}`, marginBottom: 4, overflowX: "auto" }}>
        <div style={{ display: "flex" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setPayTab(t.id)} style={{
              background: "none", border: "none",
              borderBottom: payTab === t.id ? `3px solid ${D.gold}` : "3px solid transparent",
              color: payTab === t.id ? D.text : D.textDim,
              padding: "12px 16px", fontSize: "0.75rem", fontWeight: payTab === t.id ? 800 : 600,
              cursor: "pointer", whiteSpace: "nowrap",
            }}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "22px 0 20px" }}>
        {actionError && <div style={{ background: `${D.red}1f`, color: D.red, border: `1px solid ${D.red}55`, borderRadius: 12, padding: "10px 14px", fontSize: "0.78rem", marginBottom: 16 }}>{actionError}</div>}

        {/* ── SALES OVERVIEW (customer sales) ── */}
        {payTab === "overview" && (
          <>
            <h2 style={{ ...sectionTitle, margin: "0 0 6px", fontWeight: 900, fontSize: "1.05rem" }}>📈 Sales Overview</h2>
            <p style={{ color: D.textDim, fontSize: "0.76rem", margin: "0 0 16px" }}>What customers have paid for your listings. (Your own subscription/promotion spend is under “My Transactions & Subscription”.)</p>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
              <label style={{ fontSize: "0.66rem", color: D.textDim }}>From<br /><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inputStyle, marginTop: 3 }} /></label>
              <label style={{ fontSize: "0.66rem", color: D.textDim }}>To<br /><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inputStyle, marginTop: 3 }} /></label>
              <label style={{ fontSize: "0.66rem", color: D.textDim }}>Type<br />
                <select value={kind} onChange={e => setKind(e.target.value)} style={{ ...inputStyle, marginTop: 3 }}>
                  <option value="">All</option>
                  <option value="product">Products</option>
                  <option value="service">Services</option>
                </select>
              </label>
              <button onClick={exportCsv} disabled={exporting} style={{ background: D.gold, color: "#1a1205", border: "none", borderRadius: 20, padding: "8px 16px", fontWeight: 800, fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit", opacity: exporting ? 0.6 : 1 }}>{exporting ? "Exporting…" : "⬇ Export CSV"}</button>
            </div>

            {report.isLoading && <div style={{ color: D.textDim, fontSize: "0.82rem" }}>Loading your sales…</div>}
            {report.isError && <div style={{ color: D.red, fontSize: "0.82rem" }}>Could not load your sales report.</div>}
            {summary && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 14, marginBottom: 22 }}>
                  {[
                    { icon: "💰", label: "Total Sales", value: `GHS ${Number(summary.total_sales).toLocaleString()}`, color: D.green },
                    { icon: "🧾", label: "Orders", value: summary.order_count, color: D.blue },
                    { icon: "📦", label: "Items Sold", value: summary.item_count, color: D.gold },
                  ].map(s => (
                    <div key={s.label} style={{ ...glassCard, padding: "16px", borderLeft: `4px solid ${s.color}` }}>
                      <div style={{ fontSize: "1.3rem", marginBottom: 4 }}>{s.icon}</div>
                      <div style={{ fontWeight: 900, fontSize: "1.2rem", color: D.text }}>{s.value}</div>
                      <div style={{ fontSize: "0.7rem", fontWeight: 700, color: D.textDim }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <DataTableCard
                  columns={[
                    { key: "date", label: "Date" },
                    { key: "item", label: "Item" },
                    { key: "customer", label: "Customer" },
                    { key: "quantity", label: "Qty", align: "right" },
                    { key: "line_total", label: "Amount", align: "right" },
                  ]}
                  rows={report.data?.rows || []}
                  emptyText="No sales in this range yet."
                  renderCell={(r, c) => {
                    if (c.key === "date") return r.date?.slice(0, 10);
                    if (c.key === "item") return <span>{r.item} <span style={{ color: D.textFaint, fontSize: "0.66rem" }}>({r.kind})</span></span>;
                    if (c.key === "customer") return r.customer;
                    if (c.key === "quantity") return r.quantity;
                    if (c.key === "line_total") return <span style={{ fontWeight: 800, color: D.green }}>GHS {Number(r.line_total).toLocaleString()}</span>;
                    return null;
                  }}
                />
              </>
            )}
          </>
        )}

        {/* ── MY TRANSACTIONS & SUBSCRIPTION ── */}
        {payTab === "subscription" && (
          <>
            <h2 style={{ ...sectionTitle, margin: "0 0 14px", fontWeight: 900, fontSize: "1.05rem" }}>💳 My Transactions & Subscription</h2>

            {/* Subscription status */}
            <div style={{ ...glassCard, padding: "16px 18px", marginBottom: 18 }}>
              <div style={{ fontWeight: 800, color: D.text, fontSize: "0.85rem", marginBottom: 6 }}>Your subscription</div>
              {subscription?.id ? (
                <div style={{ color: D.textDim, fontSize: "0.78rem" }}>
                  {subscription.plan_name || subscription.plan} · <span style={{ color: subscription.status === "active" ? D.green : D.amber, fontWeight: 700 }}>{subscription.status}</span>
                  {subEnd && <> · renews {subEnd.slice(0, 10)}{subDays != null && subDays >= 0 ? ` (${subDays}d)` : ""}</>}
                </div>
              ) : (
                <div style={{ color: D.textDim, fontSize: "0.78rem" }}>No active subscription — choose a plan below.</div>
              )}
            </div>

            {/* Owner's own outgoing payments */}
            <div style={{ fontWeight: 800, color: D.text, marginBottom: 10, fontSize: "0.85rem" }}>Your payments (subscriptions, promotions, events)</div>
            {txLoading && <div style={{ color: D.textDim, fontSize: "0.82rem", marginBottom: 18 }}>Loading…</div>}
            {txError && <div style={{ color: D.red, fontSize: "0.82rem", marginBottom: 18 }}>Could not load your transactions.</div>}
            {!txLoading && !txError && (
              <div style={{ marginBottom: 24 }}>
                <DataTableCard
                  columns={[
                    { key: "reference", label: "Reference" },
                    { key: "purpose", label: "Purpose" },
                    { key: "amount", label: "Amount", align: "right" },
                    { key: "date", label: "Date" },
                    { key: "status", label: "Status" },
                  ]}
                  rows={txList}
                  emptyText="No payments yet."
                  renderCell={(t, c) => {
                    if (c.key === "reference") return <span style={{ fontWeight: 700, color: D.deepGold, fontSize: "0.68rem" }}>{t.reference}</span>;
                    if (c.key === "purpose") return t.purpose;
                    if (c.key === "amount") return <span style={{ fontWeight: 800, color: D.text }}>GHS {Number(t.amount).toLocaleString()}</span>;
                    if (c.key === "date") return t.created_at?.slice(0, 10);
                    if (c.key === "status") return <span style={{ background: `${statusColor[t.status]}20`, color: statusColor[t.status], borderRadius: 20, padding: "3px 9px", fontSize: "0.62rem", fontWeight: 800 }}>{statusLabel[t.status] || t.status}</span>;
                    return null;
                  }}
                />
              </div>
            )}

            {/* Plan grid (kind-gated) */}
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ ...sectionTitle, margin: "0 0 6px", fontWeight: 900, fontSize: "0.95rem" }}>⭐ Plans</div>
              <div style={{ display: "inline-flex", background: D.panelBg2, borderRadius: 30, padding: 3, gap: 3 }}>
                {CYCLE_OPTIONS.map(cycle => (
                  <button key={cycle.months} onClick={() => setCycleMonths(cycle.months)} style={{
                    background: cycleMonths === cycle.months ? D.gold : "transparent", border: "none", borderRadius: 28,
                    padding: "6px 15px", fontWeight: cycleMonths === cycle.months ? 800 : 600, fontSize: "0.74rem",
                    cursor: "pointer", color: cycleMonths === cycle.months ? D.pageBg : D.textDim,
                  }}>{cycle.label}</button>
                ))}
              </div>
            </div>
            {plansLoading && <div style={{ color: D.textDim, fontSize: "0.82rem", textAlign: "center" }}>Loading plans…</div>}
            {plansError && <div style={{ color: D.red, fontSize: "0.82rem", textAlign: "center" }}>Could not load plans.</div>}
            {!plansLoading && !plansError && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 14 }}>
                {visiblePlans.map(plan => (
                  <div key={plan.id} style={{ ...glassCard, padding: "22px", border: `2px solid ${plan.is_recommended ? D.gold : D.cardBorder}`, position: "relative" }}>
                    {plan.is_recommended && <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: D.gold, color: D.pageBg, borderRadius: 20, padding: "3px 14px", fontSize: "0.62rem", fontWeight: 900, whiteSpace: "nowrap" }}>⭐ MOST POPULAR</div>}
                    <div style={{ fontWeight: 900, color: D.text, fontSize: "1rem", marginBottom: 4 }}>{plan.name}</div>
                    <div style={{ fontWeight: 900, fontSize: "1.8rem", color: D.text, marginBottom: 2 }}>
                      GHS {(Number(plan.monthly_price) * cycleMonths).toLocaleString()}
                      <span style={{ fontSize: "0.72rem", fontWeight: 400, color: D.textDim }}>/{cycleLabel}</span>
                    </div>
                    <div style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 12, marginBottom: 16 }}>
                      {(plan.features || []).map(f => (
                        <div key={f} style={{ fontSize: "0.72rem", color: D.textDim, marginBottom: 5, display: "flex", gap: 6 }}>
                          <span style={{ color: D.green }}>✓</span>{f}
                        </div>
                      ))}
                    </div>
                    <button onClick={() => { setSelectedPlan(plan); setShowPayModal(true); }} style={{ width: "100%", background: plan.is_recommended ? D.gold : D.panelBg2, color: plan.is_recommended ? D.pageBg : D.textDim, border: `1px solid ${plan.is_recommended ? D.gold : D.cardBorder}`, borderRadius: 20, padding: "11px", fontWeight: 900, cursor: "pointer", fontSize: "0.82rem" }}>
                      💰 Pay with MoMo
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── REMINDERS (real) ── */}
        {payTab === "reminders" && (
          <>
            <h2 style={{ ...sectionTitle, margin: "0 0 6px", fontWeight: 900, fontSize: "1.05rem" }}>🔔 Payment Reminders</h2>
            <p style={{ color: D.textDim, fontSize: "0.78rem", margin: "0 0 20px" }}>Things needing your attention, drawn from your real subscription, events and payments.</p>
            <div style={{ ...glassCard, padding: "18px" }}>
              {reminders.length === 0 && <div style={{ color: D.textFaint, fontSize: "0.8rem" }}>Nothing needs attention — you're all caught up. 🎉</div>}
              {reminders.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: i < reminders.length - 1 ? `1px solid ${D.divider}` : "none", alignItems: "flex-start" }}>
                  <div style={{ width: 38, height: 38, borderRadius: "50%", background: `${r.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.05rem", flexShrink: 0 }}>{r.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: "0.8rem", color: r.color }}>{r.title}</div>
                    <div style={{ fontSize: "0.72rem", color: D.textDim, marginTop: 2 }}>{r.body}</div>
                  </div>
                  {r.action && <button onClick={r.action} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "6px 14px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Resolve</button>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
