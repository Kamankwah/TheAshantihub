import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useMyCreditScore } from "../../../hooks/useMyCreditScore.js";
import { useLendingPartners } from "../../../hooks/useLendingPartners.js";
import {
  D,
  glassCard,
  sectionTitle,
  getScoreColor,
  getScoreGrade,
  maxLoanForScore,
  CREDIT_FACTOR_META,
} from "../theme.js";

// Lending partners now come from GET /api/credit/partners/ (item 16), not the
// old hardcoded LENDING_PARTNERS constant. `partner_type` is a slug from the
// backend; this maps it back to the display label the UI used to show.
const PARTNER_TYPE_LABELS = {
  bank: "Bank",
  microfinance: "Microfinance",
  ngo: "NGO Lender",
  government: "Government Grant",
  other: "Other",
};

// Shared warm gold/cream gradient for the hero banners — matches the light
// theme's welcome-strip treatment (AnalyticsPanel).
const HERO_GRADIENT = "linear-gradient(135deg, rgba(212,160,23,0.18), rgba(232,98,26,0.08))";

// Local light-themed port of App.jsx's ScoreGauge — background arc uses the
// theme's divider tint and the "out of 1000" caption uses D.textDim (do not
// import from App.jsx).
function ScoreGauge({ score }) {
  const pct = (score / 1000) * 100;
  const color = getScoreColor(score);
  const { grade, label } = getScoreGrade(score);
  const r = 54, cx = 70, cy = 70;
  const circumference = Math.PI * r;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  return (
    <div style={{ textAlign:"center", position:"relative" }}>
      <svg width={140} height={90} viewBox="0 0 140 90">
        {/* Background arc */}
        <path d={`M ${cx-r},${cy} A ${r},${r} 0 0 1 ${cx+r},${cy}`}
          fill="none" stroke={D.divider} strokeWidth="10" strokeLinecap="round"/>
        {/* Score arc */}
        <path d={`M ${cx-r},${cy} A ${r},${r} 0 0 1 ${cx+r},${cy}`}
          fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
          style={{ transition:"stroke-dashoffset 1s ease" }}/>
        {/* Score text */}
        <text x={cx} y={cy-8} textAnchor="middle" fontSize="22" fontWeight="900" fill={color}>{score}</text>
        <text x={cx} y={cy+8} textAnchor="middle" fontSize="10" fontWeight="700" fill={D.textDim}>out of 1000</text>
      </svg>
      <div style={{ marginTop:-8 }}>
        <span style={{ background:`${color}20`, color, borderRadius:20, padding:"3px 12px", fontSize:"0.75rem", fontWeight:900 }}>{grade} — {label}</span>
      </div>
    </div>
  );
}

export default function CreditPanel({ user }) {
  const [creditTab, setCreditTab] = useState("overview");
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [loanAmount, setLoanAmount] = useState("");
  const [loanPurpose, setLoanPurpose] = useState("");
  const [loanSubmitted, setLoanSubmitted] = useState(false);
  const [submittedApp, setSubmittedApp] = useState(null); // the real created application
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Real, single-business-owner data. The backend (GET /api/credit/scores/me/)
  // only exposes the current business owner's own score — there is no
  // aggregate/multi-business endpoint on the client, so (unlike the old mock
  // MOCK_CREDIT_BUSINESSES-driven UI) this dashboard shows one score, not a
  // browsable list/dropdown of businesses.
  const { data: scoreData, isLoading, isError, refetch } = useMyCreditScore();
  const { data: partnersData } = useLendingPartners();
  const partners = partnersData || [];
  const score = scoreData?.score ?? null;
  const maxLoan = score != null ? maxLoanForScore(score) : 0;
  const loanEligible = scoreData?.loan_eligible ?? false;
  const matchedPartners = score != null ? partners.filter(p => p.min_score <= score) : [];

  const submitLoan = async () => {
    if (submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const app = await apiPost("/api/credit/loans/submit/", {
        lending_partner: selectedPartner?.id ?? null,
        amount: loanAmount,
        purpose: loanPurpose,
      });
      setSubmittedApp(app);
      setLoanSubmitted(true);
    } catch {
      setSubmitError("Could not submit your application. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const tabs = [
    { id:"overview", icon:"📊", label:"Credit Overview" },
    { id:"score", icon:"🏅", label:"My Score" },
    { id:"partners", icon:"🤝", label:"Lending Partners" },
    { id:"apply", icon:"📋", label:"Loan Application" },
    { id:"insights", icon:"💡", label:"Insights" },
  ];

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ borderBottom:`1px solid ${D.divider}`, overflowX:"auto", marginBottom:22 }}>
        <div style={{ display:"flex" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setCreditTab(t.id)} style={{
              background:"none", border:"none",
              borderBottom:creditTab===t.id?`3px solid ${D.gold}`:"3px solid transparent",
              color:creditTab===t.id?D.text:D.textDim,
              padding:"12px 14px", fontSize:"0.74rem",
              fontWeight:creditTab===t.id?800:600, cursor:"pointer",
              whiteSpace:"nowrap"
            }}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ paddingBottom:20 }}>

        {isLoading && (
          <div style={{ color:D.textDim, fontSize:"0.85rem", textAlign:"center", padding:"60px 0" }}>Loading your AshantiHub Credit Score…</div>
        )}

        {isError && (
          <div style={{ ...glassCard, padding:"30px 24px", textAlign:"center" }}>
            <div style={{ color:D.red, fontWeight:700, fontSize:"0.85rem", marginBottom:14 }}>Could not load your AshantiHub Credit Score. Make sure you're signed in as a business owner.</div>
            <button onClick={()=>refetch()} style={{ background:D.gold, color:D.pageBg, border:"none", borderRadius:20, padding:"8px 18px", fontWeight:800, cursor:"pointer" }}>Retry</button>
          </div>
        )}

        {!isLoading && !isError && scoreData && (
          <>

        {/* ── OVERVIEW ── */}
        {creditTab === "overview" && (
          <>
            {/* Hero banner */}
            <div style={{ background:HERO_GRADIENT, border:`1px solid ${D.cardBorder}`, borderRadius:18, padding:"24px", marginBottom:22, color:D.text }}>
              <div style={{ fontWeight:900, fontSize:"1.1rem", color:D.gold, marginBottom:6 }}>🏅 AshantiHub Credit Score System</div>
              <div style={{ fontSize:"0.82rem", opacity:0.9, lineHeight:1.7, marginBottom:14 }}>
                Every business on AshantiHub earns a <strong style={{ color:D.gold }}>Credit Score (300–1000)</strong> based on their platform activity. This score unlocks access to business loans from our banking and microfinance partners — with no collateral required.
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
                {[
                  { icon:"🏅", label:"Your Score", value:score },
                  { icon:"📊", label:"Grade", value:`${scoreData.grade} — ${scoreData.grade_label}` },
                  { icon: loanEligible?"✅":"❌", label:"Loan Status", value: loanEligible?"Eligible":"Not yet eligible" },
                  { icon:"💰", label:"Max Loan", value: maxLoan>0?`GHS ${maxLoan.toLocaleString()}`:"—" },
                ].map(s => (
                  <div key={s.label} style={{ background:"rgba(255,255,255,0.55)", borderRadius:12, padding:"12px", textAlign:"center" }}>
                    <div style={{ fontSize:"1.4rem", marginBottom:4 }}>{s.icon}</div>
                    <div style={{ fontWeight:900, color:D.gold, fontSize:"1rem" }}>{s.value}</div>
                    <div style={{ fontSize:"0.62rem", opacity:0.8 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* How scoring works */}
            <div style={{ ...glassCard, padding:"20px", marginBottom:20 }}>
              <div style={{ ...sectionTitle, marginBottom:16 }}>⚙️ How Your Credit Score is Calculated</div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {Object.entries(scoreData.factors||{}).map(([key,f]) => {
                  const meta = CREDIT_FACTOR_META[key] || { icon:"📌", label:key, desc:"" };
                  return (
                    <div key={key} style={{ display:"flex", gap:12, alignItems:"center", padding:"10px", background:D.panelBg2, borderRadius:12 }}>
                      <div style={{ fontSize:"1.4rem", width:36, textAlign:"center" }}>{meta.icon}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                          <span style={{ fontWeight:700, fontSize:"0.8rem", color:D.text }}>{meta.label}</span>
                          <span style={{ fontWeight:900, color:D.gold, fontSize:"0.78rem" }}>{Math.round(f.weight*100)}% weight</span>
                        </div>
                        <div style={{ fontSize:"0.68rem", color:D.textDim, marginBottom:4 }}>{meta.desc}</div>
                        <div style={{ height:6, background:"rgba(255,255,255,0.7)", borderRadius:10, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${f.score_pct}%`, background:`linear-gradient(90deg,${D.gold},${D.green})`, borderRadius:10 }}/>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Score bands */}
            <div style={{ ...glassCard, padding:"20px" }}>
              <div style={{ ...sectionTitle, marginBottom:14 }}>📊 Score Bands & Loan Access</div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {[
                  { range:"800–1000", grade:"A / A+", label:"Exceptional", color:D.green, maxLoan:"Up to GHS 50,000", partners:"All 6 partners" },
                  { range:"700–799", grade:"B+ / A-", label:"Good", color:D.kente2, maxLoan:"Up to GHS 25,000", partners:"4–5 partners" },
                  { range:"600–699", grade:"B / B-", label:"Average", color:D.gold, maxLoan:"Up to GHS 10,000", partners:"2–3 partners" },
                  { range:"500–599", grade:"C / C+", label:"Below Average", color:D.amber, maxLoan:"Up to GHS 5,000", partners:"1–2 partners" },
                  { range:"300–499", grade:"D", label:"Not Eligible", color:D.red, maxLoan:"Not eligible yet", partners:"Build score first" },
                ].map(b => (
                  <div key={b.range} style={{ display:"flex", gap:10, alignItems:"center", padding:"10px 12px", borderRadius:12, background:`${b.color}1e`, border:`1px solid ${b.color}55` }}>
                    <div style={{ width:50, height:50, borderRadius:"50%", background:`${b.color}20`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, color:b.color, fontSize:"0.82rem", flexShrink:0 }}>{b.grade}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                        <span style={{ fontWeight:800, fontSize:"0.8rem", color:D.text }}>{b.range} — {b.label}</span>
                        <span style={{ fontWeight:700, color:b.color, fontSize:"0.72rem" }}>{b.maxLoan}</span>
                      </div>
                      <div style={{ fontSize:"0.68rem", color:D.textDim }}>🤝 {b.partners}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── MY SCORE ── */}
        {creditTab === "score" && (
          <div style={{ ...glassCard, padding:"22px", border:`1px solid ${D.cardBorderStrong}` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20, flexWrap:"wrap", gap:14 }}>
              <div>
                <div style={{ fontWeight:900, fontSize:"1.05rem", color:D.text, marginBottom:4 }}>{user?.fullName || "Your Business"}</div>
                <div style={{ fontSize:"0.74rem", color:D.textDim }}>
                  AshantiHub Credit Score{scoreData.computed_at ? ` • computed ${new Date(scoreData.computed_at).toLocaleDateString("en-GH")}` : ""}
                </div>
              </div>
              <ScoreGauge score={score}/>
            </div>

            {/* Score breakdown */}
            <div style={{ fontWeight:800, color:D.text, marginBottom:12, fontSize:"0.85rem" }}>📊 Score Breakdown</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:18 }}>
              {Object.entries(scoreData.factors||{}).map(([key,f]) => {
                const meta = CREDIT_FACTOR_META[key] || { icon:"📌", label:key };
                const displayValue = typeof f.value === "boolean" ? (f.value ? "Verified" : "Not verified") : f.value;
                return (
                  <div key={key} style={{ display:"flex", gap:10, alignItems:"center" }}>
                    <span style={{ fontSize:"1rem", width:24 }}>{meta.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3, fontSize:"0.72rem" }}>
                        <span style={{ fontWeight:600, color:D.text }}>{meta.label}</span>
                        <span style={{ color:D.textDim }}>{String(displayValue)} <span style={{ color:D.textFaint }}>({Math.round(f.weight*100)}% weight)</span></span>
                      </div>
                      <div style={{ height:6, background:D.panelBg2, borderRadius:10, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${f.score_pct}%`, background:getScoreColor(score), borderRadius:10 }}/>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {loanEligible ? (
              <button onClick={()=>{ setCreditTab("apply"); }}
                style={{ width:"100%", background:D.green, color:D.pageBg, border:"none", borderRadius:20, padding:"12px", fontWeight:900, cursor:"pointer", fontSize:"0.88rem" }}>
                💰 Apply for a Business Loan →
              </button>
            ) : (
              <div style={{ background:`${D.red}1f`, borderRadius:10, padding:"10px 14px", fontSize:"0.7rem", color:D.red, fontWeight:600, textAlign:"center" }}>
                ❌ Score too low — keep improving to unlock loans. See the Insights tab for tips.
              </div>
            )}
          </div>
        )}

        {/* ── LENDING PARTNERS ── */}
        {creditTab === "partners" && (
          <>
            <div style={{ marginBottom:20 }}>
              <h2 style={{ margin:"0 0 4px", color:D.text, fontWeight:900, fontSize:"1.05rem" }}>🤝 Lending Partners</h2>
              <p style={{ color:D.textDim, fontSize:"0.78rem", margin:0 }}>AshantiHub-verified financial partners offering loans to scored businesses</p>
            </div>

            {/* Revenue model banner */}
            <div style={{ background:HERO_GRADIENT, border:`1px solid ${D.cardBorder}`, borderRadius:16, padding:"18px 22px", marginBottom:20, color:D.text }}>
              <div style={{ fontWeight:900, color:D.gold, marginBottom:6, fontSize:"0.88rem" }}>💸 AshantiHub Referral Revenue Model</div>
              <div style={{ fontSize:"0.76rem", opacity:0.9, lineHeight:1.7 }}>
                For every business successfully referred to a lending partner, AshantiHub earns a <strong style={{ color:D.gold }}>1–3% referral commission</strong> on the loan value. At 1,000 businesses borrowing an average of GHS 5,000:
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginTop:12 }}>
                {[["GHS 5M","Total Loans"],["GHS 100K","AshantiHub Revenue (2%)"],["GHS 10K","Per Month Projected"]].map(([v,l])=>(
                  <div key={l} style={{ background:"rgba(255,255,255,0.55)", borderRadius:10, padding:"10px", textAlign:"center" }}>
                    <div style={{ fontWeight:900, color:D.gold, fontSize:"0.95rem" }}>{v}</div>
                    <div style={{ fontSize:"0.58rem", opacity:0.8 }}>{l}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:14 }}>
              {partners.map(p => (
                <div key={p.id} style={{ ...glassCard, padding:"20px", borderTop:`4px solid ${p.color || D.gold}` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
                    <div style={{ width:44, height:44, borderRadius:12, background:`${p.color || D.gold}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.4rem" }}>{p.logo}</div>
                    <div>
                      <div style={{ fontWeight:800, fontSize:"0.88rem", color:D.text }}>{p.name}</div>
                      <span style={{ background:`${p.color || D.gold}20`, color:p.color || D.gold, borderRadius:20, padding:"2px 8px", fontSize:"0.62rem", fontWeight:700 }}>{PARTNER_TYPE_LABELS[p.partner_type] || p.partner_type}</span>
                    </div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14, fontSize:"0.74rem" }}>
                    {[
                      ["📊 Min Score", `${p.min_score}+`],
                      ["💰 Max Loan", p.max_loan],
                      ["📈 Interest Rate", p.interest_rate],
                      ["⏱️ Turnaround", p.turnaround],
                      ["🎯 Focus", p.focus],
                    ].map(([k,v])=>(
                      <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${D.divider}` }}>
                        <span style={{ color:D.textDim }}>{k}</span>
                        <span style={{ fontWeight:700, color:D.text }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    <a href={`https://wa.me/233${(p.contact||"").replace(/\s/g,"")}`} target="_blank" rel="noopener noreferrer"
                      style={{ flex:1, background:D.whatsapp, color:"white", borderRadius:20, padding:"8px", fontSize:"0.7rem", fontWeight:700, textDecoration:"none", textAlign:"center" }}>
                      📱 Contact
                    </a>
                    <button onClick={()=>{ setSelectedPartner(p); setCreditTab("apply"); }}
                      style={{ flex:2, background:p.color || D.gold, color:"white", border:"none", borderRadius:20, padding:"8px", fontSize:"0.7rem", fontWeight:700, cursor:"pointer" }}>
                      Apply for Loan →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── LOAN APPLICATION ── */}
        {creditTab === "apply" && (
          <>
            <h2 style={{ margin:"0 0 16px", color:D.text, fontWeight:900, fontSize:"1.05rem" }}>📋 Loan Application</h2>
            {!loanEligible && !loanSubmitted && (
              <div style={{ ...glassCard, borderRadius:18, padding:"40px 24px", textAlign:"center" }}>
                <div style={{ fontSize:"2.6rem", marginBottom:12 }}>🔒</div>
                <div style={{ fontWeight:900, color:D.text, fontSize:"1rem", marginBottom:8 }}>Not loan-eligible yet</div>
                <div style={{ color:D.textDim, fontSize:"0.82rem", lineHeight:1.7, marginBottom:18, maxWidth:420, marginLeft:"auto", marginRight:"auto" }}>
                  Your current AshantiHub Credit Score is <strong>{score}</strong>. You need a score of at least <strong>600</strong> to apply for a loan through our lending partners.
                </div>
                <button onClick={()=>setCreditTab("insights")}
                  style={{ background:D.gold, color:D.pageBg, border:"none", borderRadius:30, padding:"10px 22px", fontWeight:900, cursor:"pointer" }}>
                  See how to improve your score →
                </button>
              </div>
            )}
            {/* loanSubmitted alone (not loanEligible && loanSubmitted) — once submitted, keep
                showing the confirmation even if a later score refetch (e.g. on window focus)
                drops loanEligible below 600, rather than leaving this tab blank. */}
            {loanSubmitted && (
              <div style={{ ...glassCard, borderRadius:18, padding:"40px 24px", textAlign:"center" }}>
                <div style={{ fontSize:"3.5rem", marginBottom:14 }}>🎉</div>
                <div style={{ fontWeight:900, color:D.green, fontSize:"1.1rem", marginBottom:8 }}>Application Submitted!</div>
                <div style={{ color:D.textDim, fontSize:"0.82rem", lineHeight:1.7, marginBottom:20, maxWidth:400, margin:"0 auto 20px" }}>
                  Your loan application for <strong>GHS {Number(loanAmount).toLocaleString()}</strong> has been submitted to <strong>{selectedPartner?.name || "our lending partners"}</strong>. They will contact you via WhatsApp within {selectedPartner?.turnaround || "3–5 days"}.
                </div>
                <div style={{ background:D.goldSoft, border:`1px solid ${D.cardBorder}`, borderRadius:14, padding:"16px", marginBottom:20, textAlign:"left", display:"inline-block", minWidth:300 }}>
                  <div style={{ fontWeight:800, color:D.gold, marginBottom:8, fontSize:"0.82rem" }}>📋 Application Reference</div>
                  {[
                    ["Reference", submittedApp ? `AH-LOAN-${submittedApp.id}` : "—"],
                    ["Business", user?.fullName || "Your Business"],
                    ["Credit Score", submittedApp?.score_at_application ?? score],
                    ["Amount Requested", `GHS ${Number(loanAmount).toLocaleString()}`],
                    ["Partner", submittedApp?.lending_partner_name || selectedPartner?.name || "Multiple Partners"],
                    ["Purpose", loanPurpose],
                    ["Status", "Submitted ⏳"],
                  ].map(([k,v])=>(
                    <div key={k} style={{ display:"flex", justifyContent:"space-between", fontSize:"0.72rem", marginBottom:4 }}>
                      <span style={{ color:D.textDim }}>{k}</span>
                      <span style={{ fontWeight:700, color:D.text }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
                  <button onClick={()=>{ setLoanSubmitted(false); setSubmittedApp(null); setLoanAmount(""); setLoanPurpose(""); }}
                    style={{ background:D.gold, color:D.pageBg, border:"none", borderRadius:30, padding:"10px 22px", fontWeight:900, cursor:"pointer" }}>
                    Apply for Another Loan
                  </button>
                  <button onClick={()=>setCreditTab("score")}
                    style={{ background:D.panelBg2, color:D.textDim, border:`1px solid ${D.divider}`, borderRadius:30, padding:"10px 22px", fontWeight:700, cursor:"pointer" }}>
                    Back to My Score
                  </button>
                </div>
              </div>
            )}
            {loanEligible && !loanSubmitted && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, alignItems:"start" }}>
                {/* Application form */}
                <div style={{ ...glassCard, padding:"22px" }}>
                  <div style={{ ...sectionTitle, marginBottom:16 }}>📝 Your Application</div>

                  {/* Loan amount */}
                  <div style={{ marginBottom:14 }}>
                    <label style={{ fontSize:"0.76rem", fontWeight:700, color:D.text, marginBottom:6, display:"block" }}>Loan Amount (GHS) *</label>
                    <input type="number" value={loanAmount} onChange={e=>setLoanAmount(e.target.value)}
                      placeholder={`Max: GHS ${maxLoan.toLocaleString()}`}
                      max={maxLoan}
                      style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`1.5px solid ${loanAmount&&Number(loanAmount)>maxLoan?D.red:D.divider}`, background:D.panelBg2, color:D.text, fontSize:"0.85rem", outline:"none", boxSizing:"border-box" }}/>
                    {loanAmount && Number(loanAmount) > maxLoan && (
                      <div style={{ fontSize:"0.68rem", color:D.red, marginTop:3 }}>Exceeds your maximum eligible amount of GHS {maxLoan.toLocaleString()}</div>
                    )}
                  </div>

                  {/* Loan purpose */}
                  <div style={{ marginBottom:14 }}>
                    <label style={{ fontSize:"0.76rem", fontWeight:700, color:D.text, marginBottom:6, display:"block" }}>Purpose of Loan *</label>
                    <select value={loanPurpose} onChange={e=>setLoanPurpose(e.target.value)}
                      style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`1.5px solid ${D.divider}`, fontSize:"0.85rem", background:D.panelBg2, color:D.text, outline:"none" }}>
                      <option value="">Select purpose...</option>
                      {["Stock / Inventory Purchase","Equipment / Machinery","Business Expansion","Working Capital","Marketing & Advertising","Hire Additional Staff","Renovate Premises","Vehicle / Transport","Other"].map(p=><option key={p}>{p}</option>)}
                    </select>
                  </div>

                  {/* Preferred partner */}
                  <div style={{ marginBottom:16 }}>
                    <label style={{ fontSize:"0.76rem", fontWeight:700, color:D.text, marginBottom:6, display:"block" }}>Preferred Lender</label>
                    <select value={selectedPartner?.id||""} onChange={e=>setSelectedPartner(partners.find(p=>p.id===Number(e.target.value))||null)}
                      style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`1.5px solid ${D.divider}`, fontSize:"0.85rem", background:D.panelBg2, color:D.text, outline:"none" }}>
                      <option value="">Best match for my score</option>
                      {matchedPartners.map(p=>(
                        <option key={p.id} value={p.id}>{p.name} — {p.max_loan}</option>
                      ))}
                    </select>
                  </div>

                  {submitError && <div style={{ color:D.red, fontSize:"0.72rem", marginBottom:8 }}>{submitError}</div>}
                  <button
                    onClick={()=>{ if(loanAmount&&loanPurpose&&Number(loanAmount)<=maxLoan) submitLoan(); }}
                    disabled={submitting}
                    style={{ width:"100%", background:loanAmount&&loanPurpose&&Number(loanAmount)<=maxLoan?D.green:D.panelBg2, color:loanAmount&&loanPurpose&&Number(loanAmount)<=maxLoan?D.pageBg:D.textFaint, border:"none", borderRadius:20, padding:"12px", fontWeight:900, cursor:loanAmount&&loanPurpose&&!submitting?"pointer":"default", fontSize:"0.88rem", opacity:submitting?0.6:1 }}>
                    {submitting ? "Submitting…" : "🚀 Submit Application"}
                  </button>
                  <div style={{ fontSize:"0.65rem", color:D.textFaint, marginTop:8, textAlign:"center" }}>Your AshantiHub Credit Score is shared with the lender. No collateral required for eligible businesses.</div>
                </div>

                {/* Score summary & partner match */}
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  {/* Your score card */}
                  <div style={{ background:HERO_GRADIENT, border:`1px solid ${D.cardBorder}`, borderRadius:16, padding:"20px", color:D.text }}>
                    <div style={{ fontWeight:800, color:D.gold, marginBottom:12, fontSize:"0.85rem" }}>Your Credit Score</div>
                    <ScoreGauge score={score}/>
                    <div style={{ marginTop:14, fontSize:"0.74rem", lineHeight:1.8, opacity:0.9 }}>
                      <div>✅ Loan eligible up to <strong style={{ color:D.gold }}>GHS {maxLoan.toLocaleString()}</strong></div>
                      <div>🤝 Eligible for <strong style={{ color:D.gold }}>{matchedPartners.length} of {partners.length}</strong> partners</div>
                      <div>📈 Score improves with more listings, tenure and verification</div>
                    </div>
                  </div>

                  {/* Matched partners */}
                  <div style={{ ...glassCard, padding:"18px" }}>
                    <div style={{ fontWeight:800, color:D.text, marginBottom:12, fontSize:"0.85rem" }}>🤝 Your Matched Partners</div>
                    {matchedPartners.map(p=>(
                      <div key={p.id} style={{ display:"flex", gap:10, alignItems:"center", padding:"8px 0", borderBottom:`1px solid ${D.divider}` }}>
                        <div style={{ width:32, height:32, borderRadius:8, background:`${p.color || D.gold}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1rem" }}>{p.logo}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:700, fontSize:"0.76rem", color:D.text }}>{p.name}</div>
                          <div style={{ fontSize:"0.65rem", color:D.textDim }}>{p.max_loan} • {p.interest_rate}</div>
                        </div>
                        <span style={{ background:`${D.green}22`, color:D.green, borderRadius:20, padding:"2px 7px", fontSize:"0.6rem", fontWeight:700 }}>✓ Match</span>
                      </div>
                    ))}
                    {matchedPartners.length===0 && (
                      <div style={{ color:D.textFaint, fontSize:"0.76rem", textAlign:"center", padding:"10px" }}>Improve your score to unlock lenders</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── INSIGHTS ── */}
        {creditTab === "insights" && (
          <>
            <h2 style={{ margin:"0 0 16px", color:D.text, fontWeight:900, fontSize:"1.05rem" }}>💡 Credit Insights & Tips</h2>

            {/* How to improve score */}
            <div style={{ ...glassCard, padding:"20px", marginBottom:20 }}>
              <div style={{ fontWeight:800, color:D.text, marginBottom:14, fontSize:"0.88rem" }}>📈 How to Improve Your Credit Score</div>
              {[
                { icon:"🏷️", tip:"Publish more listings", impact:"up to 25% of score", action:"Get listings approved and published — this factor counts up to 10 published listings.", color:D.kente3 },
                { icon:"📅", tip:"Stay active longer", impact:"up to 20% of score", action:"The longer your business account exists on AshantiHub, the higher your tenure score (counted up to 24 months).", color:D.gold },
                { icon:"🪪", tip:"Complete KYC verification", impact:"up to 30% of score", action:"Submit your Ghana Card and business details for KYC review and get verified by AshantiHub staff.", color:D.purple },
                { icon:"🏦", tip:"Verify your payout details", impact:"up to 25% of score", action:"Add and verify your MoMo/bank payout details in your Business Dashboard profile.", color:D.kente2 },
              ].map(item => (
                <div key={item.tip} style={{ display:"flex", gap:12, padding:"12px 0", borderBottom:`1px solid ${D.divider}`, alignItems:"flex-start" }}>
                  <div style={{ width:40, height:40, borderRadius:10, background:`${item.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.2rem", flexShrink:0 }}>{item.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                      <span style={{ fontWeight:800, fontSize:"0.8rem", color:D.text }}>{item.tip}</span>
                      <span style={{ background:`${item.color}20`, color:item.color, borderRadius:20, padding:"2px 8px", fontSize:"0.62rem", fontWeight:800 }}>{item.impact}</span>
                    </div>
                    <div style={{ fontSize:"0.7rem", color:D.textDim, lineHeight:1.5 }}>{item.action}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Platform economic impact */}
            <div style={{ background:HERO_GRADIENT, border:`1px solid ${D.cardBorder}`, borderRadius:16, padding:"22px", color:D.text }}>
              <div style={{ fontWeight:900, color:D.gold, marginBottom:14, fontSize:"0.88rem" }}>🌍 AshantiHub Economic Impact Projection</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 }}>
                {[
                  { icon:"🏪", val:"200,000", label:"Target Businesses" },
                  { icon:"👥", val:"2,000,000", label:"Jobs Created" },
                  { icon:"💰", val:"GHS 1B+", label:"Total Loans Facilitated" },
                  { icon:"💸", val:"GHS 20M+", label:"AshantiHub Referral Revenue" },
                  { icon:"🌱", val:"GHS 5B+", label:"SME Economic Output" },
                  { icon:"🇬🇭", val:"Top 10", label:"Ghana Fintech Impact" },
                ].map(s => (
                  <div key={s.label} style={{ background:"rgba(255,255,255,0.55)", borderRadius:12, padding:"14px", textAlign:"center" }}>
                    <div style={{ fontSize:"1.5rem", marginBottom:4 }}>{s.icon}</div>
                    <div style={{ fontWeight:900, color:D.gold, fontSize:"0.95rem" }}>{s.val}</div>
                    <div style={{ fontSize:"0.6rem", opacity:0.8 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

          </>
        )}

      </div>
    </div>
  );
}
