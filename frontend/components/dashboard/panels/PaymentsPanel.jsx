// ─── Payments Panel — Business Command Center "Payments" tab body ────────────
// Re-theme + extraction of App.jsx's old light-styled `PaymentDashboard` into
// the dark "mission-control" command-center shell. The shell owns the outer
// full-screen header / exit button / Ghana-flag stripe and the top-level tab
// nav; this panel renders only the body content, keeping its OWN internal
// sub-tab bar (Overview / Transactions / Subscribe / Reminders).
//
// All user-visible text/labels/headings/copy are preserved exactly from the
// original PaymentDashboard — this is a re-theme, not a redesign. GHS amount
// expressions are likewise kept as the original `.toLocaleString()` inline
// form (not swapped to theme.js's `ghs()` helper) so the rendered strings stay
// byte-for-byte identical to what any existing test asserts on.
import { useState } from "react";
import { D, glassCard, sectionTitle } from "../theme.js";
import { apiPost } from "../../../apiClient.js";
import { useMyTransactions } from "../../../hooks/useMyTransactions.js";
import { useSubscriptionPlans } from "../../../hooks/useSubscriptionPlans.js";
import DataTableCard from "../widgets/DataTableCard.jsx";

// Local copy of App.jsx's MOMO_NETWORKS (components/ never imports from
// App.jsx, to avoid a circular dependency). Only the fields the "Accepted
// Payment Methods" chip row reads (id/name/color/logo) matter here.
const MOMO_NETWORKS = [
  { id: "mtn", name: "MTN MoMo", color: "#FCD116", logo: "🟡" },
  { id: "vodafone", name: "Vodafone Cash", color: "#E31837", logo: "🔴" },
  { id: "airteltigo", name: "AirtelTigo Money", color: "#E87722", logo: "🟠" },
];

// Subscription.cycle_months choices (backend/billing/models.py) — replaces
// the old monthly/annual billing_cycle now that plans price by a flat
// monthly_price * cycle_months multiple (no separate annual_price field).
const CYCLE_OPTIONS = [
  { months: 1, label: "1 month" },
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "12 months" },
];

export default function PaymentsPanel({ user, PaymentComponent }) {
  const [payTab, setPayTab] = useState("overview");
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [cycleMonths, setCycleMonths] = useState(1);
  const [actionError, setActionError] = useState(null);

  // Real data. The Transaction model (backend/billing/models.py) only tracks
  // amount/purpose/status/reference/created_at for the signed-in business
  // owner's own payments — it has no per-business/network breakdown, so the
  // old MOCK_TRANSACTIONS-driven "Revenue by Network" / "Active Subscribers"
  // / multi-business follow-up list are dropped rather than faked.
  const { data: transactions, isLoading: txLoading, isError: txError, refetch: refetchTx } = useMyTransactions();
  const { data: subPlans, isLoading: plansLoading, isError: plansError } = useSubscriptionPlans();

  const txList = transactions || [];
  const totalRevenue = txList.filter(t=>t.status==="success").reduce((s,t)=>s+Number(t.amount),0);
  const pendingRevenue = txList.filter(t=>t.status==="pending").reduce((s,t)=>s+Number(t.amount),0);
  const failedTxns = txList.filter(t=>t.status==="failed").length;
  const successTxns = txList.filter(t=>t.status==="success").length;
  const needsFollowUp = txList.filter(t=>t.status!=="success");

  const statusColor = { success:D.green, pending:D.amber, failed:D.red };
  const statusLabel = { success:"Success", pending:"Pending", failed:"Failed" };

  const tabs = [
    { id:"overview", icon:"💰", label:"Overview" },
    { id:"transactions", icon:"📋", label:"Transactions" },
    { id:"subscribe", icon:"⭐", label:"Subscribe" },
    { id:"reminders", icon:"🔔", label:"Reminders" },
  ];

  const cycleLabel = CYCLE_OPTIONS.find(c => c.months === cycleMonths)?.label || `${cycleMonths} months`;

  const recordSubscriptionPayment = async (ref) => {
    setShowPayModal(false);
    if(!selectedPlan) return;
    setActionError(null);
    const amount = Number(selectedPlan.monthly_price) * cycleMonths;
    try {
      await apiPost("/api/billing/transactions/mine/", {
        amount: amount.toFixed(2),
        purpose: `AshantiHub ${selectedPlan.name} Plan — ${cycleLabel}`,
        reference: ref,
        status: "success",
      });
      await apiPost("/api/billing/subscriptions/me/", { plan: selectedPlan.tier, cycle_months: cycleMonths });
      refetchTx();
    } catch (err) {
      setActionError("Payment was confirmed but we couldn't record it on your account. Please contact support with reference " + ref + ".");
    }
  };

  return (
    <div>
      {showPayModal && selectedPlan && (
        <PaymentComponent
          amount={Number(selectedPlan.monthly_price) * cycleMonths}
          purpose={`AshantiHub ${selectedPlan.name} Plan — ${cycleLabel}`}
          businessName={user?.fullName||"Your Business"}
          onSuccess={recordSubscriptionPayment}
          onClose={()=>setShowPayModal(false)}
        />
      )}

      {/* Internal sub-tab bar (the panel's own content, re-themed dark) */}
      <div style={{ borderBottom:`1px solid ${D.divider}`, marginBottom:4, overflowX:"auto" }}>
        <div style={{ display:"flex" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setPayTab(t.id)} style={{
              background:"none", border:"none",
              borderBottom:payTab===t.id?`3px solid ${D.gold}`:"3px solid transparent",
              color:payTab===t.id?D.text:D.textDim,
              padding:"12px 16px", fontSize:"0.75rem", fontWeight:payTab===t.id?800:600,
              cursor:"pointer", whiteSpace:"nowrap"
            }}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding:"22px 0 20px" }}>

        {actionError && <div style={{ background:`${D.red}1f`, color:D.red, border:`1px solid ${D.red}55`, borderRadius:12, padding:"10px 14px", fontSize:"0.78rem", marginBottom:16 }}>{actionError}</div>}

        {/* ── OVERVIEW ── */}
        {payTab === "overview" && (
          <>
            <h2 style={{ ...sectionTitle, margin:"0 0 20px", fontWeight:900, fontSize:"1.05rem" }}>💰 Payment Overview</h2>
            {txLoading && <div style={{ color:D.textDim, fontSize:"0.82rem", padding:"20px 0" }}>Loading your payment history…</div>}
            {txError && <div style={{ color:D.red, fontSize:"0.82rem", padding:"20px 0" }}>Could not load your payment history. Make sure you're signed in as a business owner.</div>}
            {!txLoading && !txError && (
              <>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:14, marginBottom:24 }}>
                  {[
                    { icon:"💚", label:"Total Paid", value:`GHS ${totalRevenue.toLocaleString()}`, sub:"All-time successful payments", color:D.green },
                    { icon:"⏳", label:"Pending", value:`GHS ${pendingRevenue.toLocaleString()}`, sub:"Awaiting confirmation", color:D.amber },
                    { icon:"❌", label:"Failed Payments", value:failedTxns, sub:"Need follow-up", color:D.red },
                    { icon:"✅", label:"Successful Payments", value:successTxns, sub:"Completed transactions", color:D.blue },
                  ].map(s => (
                    <div key={s.label} style={{ ...glassCard, padding:"16px", borderLeft:`4px solid ${s.color}` }}>
                      <div style={{ fontSize:"1.3rem", marginBottom:4 }}>{s.icon}</div>
                      <div style={{ fontWeight:900, fontSize:"1.2rem", color:D.text }}>{s.value}</div>
                      <div style={{ fontSize:"0.7rem", fontWeight:700, color:D.textDim }}>{s.label}</div>
                      <div style={{ fontSize:"0.62rem", color:s.color, fontWeight:600 }}>{s.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Recent transactions */}
                <div>
                  <div style={{ fontWeight:800, color:D.text, marginBottom:14, fontSize:"0.88rem" }}>🕐 Recent Transactions</div>
                  <DataTableCard
                    columns={[
                      { key:"purpose", label:"Purpose" },
                      { key:"amount", label:"Amount", align:"right" },
                      { key:"date", label:"Date" },
                      { key:"status", label:"Status" },
                    ]}
                    rows={txList.slice(0,4)}
                    emptyText="No payments yet."
                    renderCell={(t, c) => {
                      if (c.key === "purpose") return t.purpose;
                      if (c.key === "amount") return <span style={{ fontWeight:900, color:D.green }}>GHS {Number(t.amount).toLocaleString()}</span>;
                      if (c.key === "date") return t.created_at?.slice(0,10);
                      if (c.key === "status") return <span style={{ background:`${statusColor[t.status]}20`, color:statusColor[t.status], borderRadius:20, padding:"2px 8px", fontSize:"0.62rem", fontWeight:800 }}>{statusLabel[t.status]||t.status}</span>;
                      return null;
                    }}
                  />
                </div>
              </>
            )}
          </>
        )}

        {/* ── TRANSACTIONS ── */}
        {payTab === "transactions" && (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:10 }}>
              <h2 style={{ ...sectionTitle, margin:0, fontWeight:900, fontSize:"1.05rem" }}>📋 Your Transactions</h2>
            </div>
            {txLoading && <div style={{ color:D.textDim, fontSize:"0.82rem", padding:"20px 0" }}>Loading your payment history…</div>}
            {txError && <div style={{ color:D.red, fontSize:"0.82rem", padding:"20px 0" }}>Could not load your payment history. Make sure you're signed in as a business owner.</div>}
            {!txLoading && !txError && (
              <DataTableCard
                columns={[
                  { key:"reference", label:"Reference" },
                  { key:"purpose", label:"Purpose" },
                  { key:"amount", label:"Amount" },
                  { key:"date", label:"Date" },
                  { key:"status", label:"Status" },
                ]}
                rows={txList}
                emptyText="No payments yet."
                renderCell={(t, c) => {
                  if (c.key === "reference") return <span style={{ fontWeight:700, color:D.deepGold, fontSize:"0.68rem" }}>{t.reference}</span>;
                  if (c.key === "purpose") return t.purpose;
                  if (c.key === "amount") return <span style={{ fontWeight:800, color:D.green }}>GHS {Number(t.amount).toLocaleString()}</span>;
                  if (c.key === "date") return t.created_at?.slice(0,10);
                  if (c.key === "status") return <span style={{ background:`${statusColor[t.status]}20`, color:statusColor[t.status], borderRadius:20, padding:"3px 9px", fontSize:"0.62rem", fontWeight:800 }}>{statusLabel[t.status]||t.status}</span>;
                  return null;
                }}
              />
            )}
          </>
        )}

        {/* ── SUBSCRIBE ── */}
        {payTab === "subscribe" && (
          <>
            <div style={{ textAlign:"center", marginBottom:24 }}>
              <h2 style={{ ...sectionTitle, margin:"0 0 6px", fontWeight:900, fontSize:"1.05rem" }}>⭐ Choose Your Plan</h2>
              <p style={{ color:D.textDim, fontSize:"0.78rem", margin:"0 0 16px" }}>List your business on AshantiHub. First 3 months FREE.</p>
              {/* Billing cycle toggle */}
              <div style={{ display:"inline-flex", background:D.panelBg2, borderRadius:30, padding:3, gap:3 }}>
                {CYCLE_OPTIONS.map(cycle => (
                  <button key={cycle.months} onClick={()=>setCycleMonths(cycle.months)} style={{
                    background:cycleMonths===cycle.months?D.gold:"transparent",
                    border:"none", borderRadius:28, padding:"7px 18px",
                    fontWeight:cycleMonths===cycle.months?800:600, fontSize:"0.78rem",
                    cursor:"pointer", color:cycleMonths===cycle.months?D.pageBg:D.textDim,
                    boxShadow:cycleMonths===cycle.months?"0 2px 8px rgba(0,0,0,0.35)":"none"
                  }}>
                    {cycle.label}
                  </button>
                ))}
              </div>
            </div>
            {plansLoading && <div style={{ color:D.textDim, fontSize:"0.82rem", textAlign:"center", padding:"20px 0" }}>Loading plans…</div>}
            {plansError && <div style={{ color:D.red, fontSize:"0.82rem", textAlign:"center", padding:"20px 0" }}>Could not load subscription plans.</div>}
            {!plansLoading && !plansError && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:14 }}>
                {(subPlans||[]).map(plan => (
                  <div key={plan.id} style={{ ...glassCard, padding:"22px", border:`2px solid ${plan.is_recommended?D.gold:D.cardBorder}`, position:"relative" }}>
                    {plan.is_recommended && <div style={{ position:"absolute", top:-10, left:"50%", transform:"translateX(-50%)", background:D.gold, color:D.pageBg, borderRadius:20, padding:"3px 14px", fontSize:"0.62rem", fontWeight:900, whiteSpace:"nowrap" }}>⭐ MOST POPULAR</div>}
                    <div style={{ fontWeight:900, color:D.text, fontSize:"1rem", marginBottom:4 }}>{plan.name}</div>
                    <div style={{ fontWeight:900, fontSize:"1.8rem", color:D.text, marginBottom:2 }}>
                      GHS {(Number(plan.monthly_price) * cycleMonths).toLocaleString()}
                      <span style={{ fontSize:"0.72rem", fontWeight:400, color:D.textDim }}>/{cycleLabel}</span>
                    </div>
                    <div style={{ borderTop:`1px solid ${D.divider}`, paddingTop:12, marginBottom:16 }}>
                      {(plan.features||[]).map(f => (
                        <div key={f} style={{ fontSize:"0.72rem", color:D.textDim, marginBottom:5, display:"flex", gap:6 }}>
                          <span style={{ color:D.green }}>✓</span>{f}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => { setSelectedPlan(plan); setShowPayModal(true); }}
                      style={{ width:"100%", background:plan.is_recommended?D.gold:D.panelBg2, color:plan.is_recommended?D.pageBg:D.textDim, border:`1px solid ${plan.is_recommended?D.gold:D.cardBorder}`, borderRadius:20, padding:"11px", fontWeight:900, cursor:"pointer", fontSize:"0.82rem" }}>
                      💰 Pay with MoMo
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ background:`${D.whatsapp}12`, border:`1.5px solid ${D.whatsapp}33`, borderRadius:14, padding:"14px 18px", marginTop:20 }}>
              <div style={{ fontWeight:800, color:D.green, marginBottom:4, fontSize:"0.82rem" }}>💰 Accepted Payment Methods</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {MOMO_NETWORKS.map(n => (
                  <span key={n.id} style={{ background:`${n.color}20`, color:D.text, borderRadius:20, padding:"4px 12px", fontSize:"0.72rem", fontWeight:700, border:`1px solid ${n.color}44` }}>
                    {n.logo} {n.name}
                  </span>
                ))}
              </div>
              <div style={{ fontSize:"0.7rem", color:D.textDim, marginTop:8, lineHeight:1.6 }}>
                All payments are processed securely via Hubtel. Transaction fee of 1.5% applies. Multi-month cycles are billed once upfront and auto-renew at the end of the cycle.
              </div>
            </div>
          </>
        )}

        {/* ── REMINDERS ── */}
        {payTab === "reminders" && (
          <>
            <h2 style={{ ...sectionTitle, margin:"0 0 6px", fontWeight:900, fontSize:"1.05rem" }}>🔔 Payment Reminders</h2>
            <p style={{ color:D.textDim, fontSize:"0.78rem", margin:"0 0 20px" }}>Automated WhatsApp reminders sent before and after your payment due dates</p>

            {/* Reminder schedule */}
            <div style={{ ...glassCard, padding:"20px", marginBottom:20 }}>
              <div style={{ fontWeight:800, color:D.text, marginBottom:14, fontSize:"0.88rem" }}>📅 Automated Reminder Schedule</div>
              {[
                { days:"7 days before", icon:"📢", msg:"Your AshantiHub listing renews in 7 days. Payment of GHS [amount] due to MTN MoMo 0244 000 000.", color:D.blue, status:"Active" },
                { days:"3 days before", icon:"⏰", msg:"Reminder: Your AshantiHub listing renews in 3 days. Tap here to pay now and keep your listing active.", color:D.amber, status:"Active" },
                { days:"On due date", icon:"📅", msg:"Your AshantiHub listing is due for renewal today. Please send GHS [amount] to MoMo 0244 000 000 to continue.", color:D.gold, status:"Active" },
                { days:"3 days overdue", icon:"⚠️", msg:"Your AshantiHub listing has been paused. Send GHS [amount] to 0244 000 000 to reactivate immediately.", color:D.red, status:"Active" },
                { days:"7 days overdue", icon:"🔴", msg:"Final notice: Your AshantiHub listing will be permanently removed in 24 hours. Contact us to resolve.", color:D.red, status:"Active" },
              ].map((r,i) => (
                <div key={i} style={{ display:"flex", gap:12, padding:"12px 0", borderBottom:`1px solid ${D.divider}`, alignItems:"flex-start" }}>
                  <div style={{ width:40, height:40, borderRadius:"50%", background:`${r.color}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.1rem", flexShrink:0 }}>{r.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ fontWeight:800, fontSize:"0.8rem", color:r.color }}>{r.days}</span>
                      <span style={{ background:`${D.green}20`, color:D.green, borderRadius:20, padding:"2px 8px", fontSize:"0.6rem", fontWeight:700 }}>{r.status}</span>
                    </div>
                    <div style={{ fontSize:"0.72rem", color:D.textDim, lineHeight:1.5, background:D.panelBg2, borderRadius:8, padding:"8px 10px" }}>
                      📱 "{r.msg}"
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Your payments needing follow-up */}
            <div style={{ ...glassCard, padding:"20px" }}>
              <div style={{ fontWeight:800, color:D.text, marginBottom:14, fontSize:"0.88rem" }}>⚠️ Your Payments Needing Follow-up</div>
              {!txLoading && !txError && needsFollowUp.length===0 && <div style={{ color:D.textFaint, fontSize:"0.78rem" }}>Nothing needs follow-up — you're all caught up.</div>}
              {needsFollowUp.map(t => (
                <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:`1px solid ${D.divider}`, flexWrap:"wrap", gap:8 }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:"0.8rem", color:D.text }}>{t.purpose}</div>
                    <div style={{ fontSize:"0.68rem", color:D.textDim }}>GHS {Number(t.amount).toLocaleString()} — {statusLabel[t.status]||t.status}</div>
                  </div>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <button onClick={()=>setPayTab("subscribe")} style={{ background:D.green, color:D.pageBg, border:"none", borderRadius:20, padding:"5px 12px", fontSize:"0.68rem", fontWeight:700, cursor:"pointer" }}>💰 Pay Now</button>
                    <span style={{ background:`${statusColor[t.status]}20`, color:statusColor[t.status], borderRadius:20, padding:"5px 10px", fontSize:"0.65rem", fontWeight:800 }}>{statusLabel[t.status]||t.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
