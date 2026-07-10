import { useState, useEffect, useRef } from "react";
import { useCategories } from "./hooks/useCategories.js";
import { useZones } from "./hooks/useZones.js";
import { useListings } from "./hooks/useListings.js";
import { useListing } from "./hooks/useListing.js";

// ─── Colors ──────────────────────────────────────────────────────────────────
const C = {
  gold:"#D4A017", deepGold:"#B8860B", darkBrown:"#2C1810",
  lightGold:"#F5DEB3", cream:"#FDF6E3", black:"#1A1A1A",
  kente1:"#CC0000", kente2:"#006400", kente3:"#000080",
  ghRed:"#CE1126", ghGold:"#FCD116", ghGreen:"#006B3F",
  whatsapp:"#25D366", orange:"#E8621A",
};

// ─── Credit Scoring System ────────────────────────────────────────────────────
const LENDING_PARTNERS = [
  { id:1, name:"Fidelity Bank Ghana", type:"Bank", logo:"🏦", minScore:600, maxLoan:"GHS 50,000", rate:"18–24% p.a.", turnaround:"3–5 days", focus:"SME Business Loans", contact:"0302 214 460", color:"#003087" },
  { id:2, name:"Sinapi Aba Savings & Loans", type:"Microfinance", logo:"🌱", minScore:400, maxLoan:"GHS 10,000", rate:"24–36% p.a.", turnaround:"1–2 days", focus:"Micro & Small Business", contact:"0322 495 822", color:"#2E8B57" },
  { id:3, name:"Opportunity International Ghana", type:"NGO Lender", logo:"🤝", minScore:350, maxLoan:"GHS 5,000", rate:"20–28% p.a.", turnaround:"2–3 days", focus:"Women & Youth Businesses", contact:"0302 785 960", color:"#FF6B35" },
  { id:4, name:"ARB Apex Bank", type:"Bank", logo:"🏛️", minScore:500, maxLoan:"GHS 25,000", rate:"20–26% p.a.", turnaround:"3–7 days", focus:"Rural & Informal Business", contact:"0322 022 328", color:"#8B0000" },
  { id:5, name:"Absa Ghana SME", type:"Bank", logo:"🔴", minScore:650, maxLoan:"GHS 100,000", rate:"16–22% p.a.", turnaround:"5–7 days", focus:"Established Businesses", contact:"0302 429 150", color:"#DC143C" },
  { id:6, name:"Ghana Enterprise Agency", type:"Government Grant", logo:"🇬🇭", minScore:300, maxLoan:"GHS 20,000", rate:"0% (Grant)", turnaround:"2–4 weeks", focus:"SME Development Grants", contact:"0302 685 132", color:C.ghGreen },
];

const MOCK_CREDIT_BUSINESSES = [
  { id:1, name:"Royal Ashanti Lodge", category:"Hotels", score:847, grade:"A", monthsOnPlatform:14, enquiries:312, bookings:89, rating:4.8, reviews:124, responseRate:96, priceUpdates:28, paymentHistory:100, loanEligible:true, maxLoan:50000, status:"Active" },
  { id:2, name:"Afia's Kitchen", category:"Food", score:721, grade:"B+", monthsOnPlatform:11, enquiries:189, bookings:67, rating:4.8, reviews:89, responseRate:88, priceUpdates:22, paymentHistory:100, loanEligible:true, maxLoan:10000, status:"Active" },
  { id:3, name:"Kofi Auto Works", category:"Suame Magazine", score:634, grade:"B", monthsOnPlatform:8, enquiries:144, bookings:44, rating:4.8, reviews:77, responseRate:82, priceUpdates:18, paymentHistory:83, loanEligible:true, maxLoan:5000, status:"Active" },
  { id:4, name:"Kente Palace Weavers", category:"Crafts", score:789, grade:"A-", monthsOnPlatform:12, enquiries:256, bookings:78, rating:4.9, reviews:156, responseRate:94, priceUpdates:24, paymentHistory:100, loanEligible:true, maxLoan:25000, status:"Active" },
  { id:5, name:"Ashanti Homegoing Planners", category:"Funeral", score:556, grade:"C+", monthsOnPlatform:6, enquiries:67, bookings:22, rating:4.9, reviews:34, responseRate:75, priceUpdates:10, paymentHistory:67, loanEligible:false, maxLoan:0, status:"Active" },
  { id:6, name:"Manhyia Rooftop Bar", category:"Pubs", score:698, grade:"B", monthsOnPlatform:9, enquiries:199, bookings:55, rating:4.9, reviews:144, responseRate:85, priceUpdates:20, paymentHistory:89, loanEligible:true, maxLoan:10000, status:"Active" },
];

const SCORE_FACTORS = [
  { key:"rating", label:"Customer Rating", weight:20, icon:"⭐", desc:"Average star rating from verified customers" },
  { key:"reviews", label:"Review Volume", weight:15, icon:"💬", desc:"Total number of customer reviews received" },
  { key:"responseRate", label:"WhatsApp Response Rate", weight:20, icon:"📱", desc:"% of customer enquiries responded to within 2 hours" },
  { key:"monthsOnPlatform", label:"Platform Tenure", weight:15, icon:"📅", desc:"How long the business has been active on AshantiHub" },
  { key:"priceUpdates", label:"Price Update Frequency", weight:10, icon:"🏷️", desc:"How regularly business updates their prices" },
  { key:"paymentHistory", label:"Listing Fee Payment History", weight:20, icon:"💰", desc:"% of listing fees paid on time" },
];

function getScoreColor(score) {
  if(score >= 800) return "#22c55e";
  if(score >= 700) return C.kente2;
  if(score >= 600) return C.gold;
  if(score >= 500) return C.orange;
  return C.kente1;
}

function getScoreGrade(score) {
  if(score >= 850) return { grade:"A+", label:"Exceptional", color:"#22c55e" };
  if(score >= 800) return { grade:"A", label:"Excellent", color:"#22c55e" };
  if(score >= 750) return { grade:"A-", label:"Very Good", color:"#16a34a" };
  if(score >= 700) return { grade:"B+", label:"Good", color:C.kente2 };
  if(score >= 650) return { grade:"B", label:"Above Average", color:C.kente2 };
  if(score >= 600) return { grade:"B-", label:"Average", color:C.gold };
  if(score >= 550) return { grade:"C+", label:"Below Average", color:C.orange };
  if(score >= 500) return { grade:"C", label:"Poor", color:C.orange };
  return { grade:"D", label:"Very Poor", color:C.kente1 };
}

function ScoreGauge({ score }) {
  const pct = (score / 1000) * 100;
  const color = getScoreColor(score);
  const { grade, label } = getScoreGrade(score);
  const r = 54, cx = 70, cy = 70;
  const circumference = Math.PI * r;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  return (
    <div style={{ textAlign:"center", position:"relative" }}>
      <svg width={140} height={90} viewBox="0 0 140 90">
        {/* Background arc */}
        <path d={`M ${cx-r},${cy} A ${r},${r} 0 0 1 ${cx+r},${cy}`}
          fill="none" stroke="#f0f0f0" strokeWidth="10" strokeLinecap="round"/>
        {/* Score arc */}
        <path d={`M ${cx-r},${cy} A ${r},${r} 0 0 1 ${cx+r},${cy}`}
          fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
          style={{ transition:"stroke-dashoffset 1s ease" }}/>
        {/* Score text */}
        <text x={cx} y={cy-8} textAnchor="middle" fontSize="22" fontWeight="900" fill={color}>{score}</text>
        <text x={cx} y={cy+8} textAnchor="middle" fontSize="10" fontWeight="700" fill="#888">out of 1000</text>
      </svg>
      <div style={{ marginTop:-8 }}>
        <span style={{ background:`${color}20`, color, borderRadius:20, padding:"3px 12px", fontSize:"0.75rem", fontWeight:900 }}>{grade} — {label}</span>
      </div>
    </div>
  );
}

function CreditDashboard({ onClose, user }) {
  const [creditTab, setCreditTab] = useState("overview");
  const [selectedBiz, setSelectedBiz] = useState(MOCK_CREDIT_BUSINESSES[0]);
  const [showLoanApp, setShowLoanApp] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [loanAmount, setLoanAmount] = useState("");
  const [loanPurpose, setLoanPurpose] = useState("");
  const [loanSubmitted, setLoanSubmitted] = useState(false);
  const [filterEligible, setFilterEligible] = useState(false);

  const eligibleCount = MOCK_CREDIT_BUSINESSES.filter(b=>b.loanEligible).length;
  const avgScore = Math.round(MOCK_CREDIT_BUSINESSES.reduce((s,b)=>s+b.score,0)/MOCK_CREDIT_BUSINESSES.length);
  const totalLoanPool = MOCK_CREDIT_BUSINESSES.filter(b=>b.loanEligible).reduce((s,b)=>s+b.maxLoan,0);

  const tabs = [
    { id:"overview", icon:"📊", label:"Credit Overview" },
    { id:"scores", icon:"🏅", label:"Business Scores" },
    { id:"partners", icon:"🤝", label:"Lending Partners" },
    { id:"apply", icon:"📋", label:"Loan Application" },
    { id:"insights", icon:"💡", label:"Insights" },
  ];

  const filteredBizzes = filterEligible
    ? MOCK_CREDIT_BUSINESSES.filter(b=>b.loanEligible)
    : MOCK_CREDIT_BUSINESSES;

  return (
    <div style={{ fontFamily:"'Georgia',serif", background:"#f4f5f7", minHeight:"100vh" }}>
      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,${C.darkBrown},${C.black})`, padding:"0 16px", position:"sticky", top:0, zIndex:100, boxShadow:"0 2px 20px rgba(0,0,0,0.4)" }}>
        <div style={{ position:"absolute", top:0, left:0, right:0, height:4, background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)` }}/>
        <div style={{ maxWidth:960, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", height:58 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <Flag w={44} h={30}/>
            <div>
              <div style={{ color:C.gold, fontWeight:900, fontSize:"0.95rem" }}>AshantiHub</div>
              <div style={{ color:"#aaa", fontSize:"0.62rem" }}>Credit & Financial Partnerships</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"1px solid #444", color:"#aaa", borderRadius:20, padding:"5px 14px", fontSize:"0.7rem", cursor:"pointer", fontFamily:"inherit" }}>← Exit</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:"white", borderBottom:"1px solid #e8e8e8", padding:"0 16px", overflowX:"auto" }}>
        <div style={{ maxWidth:960, margin:"0 auto", display:"flex" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setCreditTab(t.id)} style={{
              background:"none", border:"none",
              borderBottom:creditTab===t.id?`3px solid ${C.gold}`:"3px solid transparent",
              color:creditTab===t.id?C.darkBrown:"#888",
              padding:"12px 14px", fontSize:"0.74rem",
              fontWeight:creditTab===t.id?800:600, cursor:"pointer",
              whiteSpace:"nowrap", fontFamily:"inherit"
            }}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:960, margin:"0 auto", padding:"22px 16px 60px" }}>

        {/* ── OVERVIEW ── */}
        {creditTab === "overview" && (
          <>
            {/* Hero banner */}
            <div style={{ background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`, borderRadius:18, padding:"24px", marginBottom:22, color:"white" }}>
              <div style={{ fontWeight:900, fontSize:"1.1rem", color:C.gold, marginBottom:6 }}>🏅 AshantiHub Credit Score System</div>
              <div style={{ fontSize:"0.82rem", opacity:0.9, lineHeight:1.7, marginBottom:14 }}>
                Every business on AshantiHub earns a <strong style={{ color:C.gold }}>Credit Score (0–1000)</strong> based on their platform activity. This score unlocks access to business loans from our banking and microfinance partners — with no collateral required.
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
                {[
                  { icon:"🏪", label:"Businesses Scored", value:MOCK_CREDIT_BUSINESSES.length },
                  { icon:"✅", label:"Loan Eligible", value:eligibleCount },
                  { icon:"📈", label:"Average Score", value:avgScore },
                  { icon:"💰", label:"Total Loan Pool", value:`GHS ${totalLoanPool.toLocaleString()}` },
                ].map(s => (
                  <div key={s.label} style={{ background:"rgba(255,255,255,0.1)", borderRadius:12, padding:"12px", textAlign:"center" }}>
                    <div style={{ fontSize:"1.4rem", marginBottom:4 }}>{s.icon}</div>
                    <div style={{ fontWeight:900, color:C.gold, fontSize:"1rem" }}>{s.value}</div>
                    <div style={{ fontSize:"0.62rem", opacity:0.8 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* How scoring works */}
            <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)", marginBottom:20 }}>
              <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:16, fontSize:"0.92rem" }}>⚙️ How the Credit Score is Calculated</div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {SCORE_FACTORS.map(f => (
                  <div key={f.key} style={{ display:"flex", gap:12, alignItems:"center", padding:"10px", background:"#f9f9f9", borderRadius:12 }}>
                    <div style={{ fontSize:"1.4rem", width:36, textAlign:"center" }}>{f.icon}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                        <span style={{ fontWeight:700, fontSize:"0.8rem", color:C.darkBrown }}>{f.label}</span>
                        <span style={{ fontWeight:900, color:C.gold, fontSize:"0.78rem" }}>{f.weight}% weight</span>
                      </div>
                      <div style={{ fontSize:"0.68rem", color:"#888", marginBottom:4 }}>{f.desc}</div>
                      <div style={{ height:6, background:"#e0e0e0", borderRadius:10, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${f.weight*5}%`, background:`linear-gradient(90deg,${C.gold},${C.kente2})`, borderRadius:10 }}/>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Score bands */}
            <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
              <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:14, fontSize:"0.92rem" }}>📊 Score Bands & Loan Access</div>
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {[
                  { range:"800–1000", grade:"A / A+", label:"Exceptional", color:"#22c55e", maxLoan:"Up to GHS 50,000", partners:"All 6 partners" },
                  { range:"700–799", grade:"B+ / A-", label:"Good", color:C.kente2, maxLoan:"Up to GHS 25,000", partners:"4–5 partners" },
                  { range:"600–699", grade:"B / B-", label:"Average", color:C.gold, maxLoan:"Up to GHS 10,000", partners:"2–3 partners" },
                  { range:"500–599", grade:"C / C+", label:"Below Average", color:C.orange, maxLoan:"Up to GHS 5,000", partners:"1–2 partners" },
                  { range:"0–499", grade:"D", label:"Not Eligible", color:C.kente1, maxLoan:"Not eligible yet", partners:"Build score first" },
                ].map(b => (
                  <div key={b.range} style={{ display:"flex", gap:10, alignItems:"center", padding:"10px 12px", borderRadius:12, background:`${b.color}08`, border:`1px solid ${b.color}22` }}>
                    <div style={{ width:50, height:50, borderRadius:"50%", background:`${b.color}20`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, color:b.color, fontSize:"0.82rem", flexShrink:0 }}>{b.grade}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                        <span style={{ fontWeight:800, fontSize:"0.8rem", color:C.darkBrown }}>{b.range} — {b.label}</span>
                        <span style={{ fontWeight:700, color:b.color, fontSize:"0.72rem" }}>{b.maxLoan}</span>
                      </div>
                      <div style={{ fontSize:"0.68rem", color:"#888" }}>🤝 {b.partners}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── BUSINESS SCORES ── */}
        {creditTab === "scores" && (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:10 }}>
              <h2 style={{ margin:0, color:C.darkBrown, fontWeight:900, fontSize:"1.05rem" }}>🏅 Business Credit Scores</h2>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <label style={{ display:"flex", alignItems:"center", gap:6, fontSize:"0.74rem", fontWeight:600, cursor:"pointer" }}>
                  <div onClick={()=>setFilterEligible(f=>!f)} style={{ width:36, height:20, borderRadius:10, background:filterEligible?C.kente2:"#ccc", position:"relative", cursor:"pointer", transition:"background 0.3s" }}>
                    <div style={{ position:"absolute", top:2, left:filterEligible?18:2, width:16, height:16, borderRadius:"50%", background:"white", transition:"left 0.3s" }}/>
                  </div>
                  Eligible only
                </label>
                <button style={{ background:C.kente2, color:"white", border:"none", borderRadius:20, padding:"7px 14px", fontSize:"0.72rem", fontWeight:700, cursor:"pointer" }}>📥 Export</button>
              </div>
            </div>

            {/* Score cards */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:14, marginBottom:20 }}>
              {filteredBizzes.map(biz => {
                const { grade, label, color } = getScoreGrade(biz.score);
                return (
                  <div key={biz.id} onClick={()=>setSelectedBiz(biz)}
                    style={{ background:"white", borderRadius:16, padding:"18px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)", cursor:"pointer", border:`2px solid ${selectedBiz?.id===biz.id?C.gold:"transparent"}`, transition:"all 0.2s" }}
                    onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
                    onMouseLeave={e=>e.currentTarget.style.transform=""}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                      <div>
                        <div style={{ fontWeight:800, fontSize:"0.88rem", color:C.darkBrown }}>{biz.name}</div>
                        <div style={{ fontSize:"0.68rem", color:"#888", marginTop:2 }}>{biz.category} • {biz.monthsOnPlatform} months on platform</div>
                      </div>
                      <div style={{ textAlign:"center" }}>
                        <div style={{ fontWeight:900, fontSize:"1.4rem", color:getScoreColor(biz.score) }}>{biz.score}</div>
                        <div style={{ fontSize:"0.6rem", color, fontWeight:700 }}>{grade}</div>
                      </div>
                    </div>

                    {/* Mini score bar */}
                    <div style={{ height:8, background:"#f0f0f0", borderRadius:10, overflow:"hidden", marginBottom:10 }}>
                      <div style={{ height:"100%", width:`${(biz.score/1000)*100}%`, background:`linear-gradient(90deg,${C.kente1},${C.gold},${C.kente2})`, borderRadius:10 }}/>
                    </div>

                    {/* Key metrics */}
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, marginBottom:10 }}>
                      {[
                        ["⭐", biz.rating, "Rating"],
                        ["💬", biz.reviews, "Reviews"],
                        ["📱", `${biz.responseRate}%`, "Response"],
                        ["📦", biz.bookings, "Bookings"],
                        ["💰", `${biz.paymentHistory}%`, "Payments"],
                        ["🕐", biz.monthsOnPlatform+"mo", "Tenure"],
                      ].map(([icon,val,lbl])=>(
                        <div key={lbl} style={{ background:"#f9f9f9", borderRadius:8, padding:"6px", textAlign:"center" }}>
                          <div style={{ fontSize:"0.75rem" }}>{icon}</div>
                          <div style={{ fontWeight:800, fontSize:"0.72rem", color:C.darkBrown }}>{val}</div>
                          <div style={{ fontSize:"0.55rem", color:"#aaa" }}>{lbl}</div>
                        </div>
                      ))}
                    </div>

                    {biz.loanEligible ? (
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <span style={{ background:"#22c55e20", color:"#22c55e", borderRadius:20, padding:"3px 10px", fontSize:"0.65rem", fontWeight:800 }}>✅ Loan Eligible</span>
                        <span style={{ fontWeight:800, color:C.kente2, fontSize:"0.78rem" }}>Up to GHS {biz.maxLoan.toLocaleString()}</span>
                      </div>
                    ) : (
                      <div style={{ background:"#fee2e2", borderRadius:10, padding:"6px 10px", fontSize:"0.65rem", color:"#dc2626", fontWeight:600 }}>
                        ❌ Score too low — keep improving to unlock loans
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Selected business detail */}
            {selectedBiz && (
              <div style={{ background:"white", borderRadius:16, padding:"22px", boxShadow:"0 4px 20px rgba(0,0,0,0.1)", border:`2px solid ${C.gold}33` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20, flexWrap:"wrap", gap:14 }}>
                  <div>
                    <div style={{ fontWeight:900, fontSize:"1.05rem", color:C.darkBrown, marginBottom:4 }}>{selectedBiz.name}</div>
                    <div style={{ fontSize:"0.74rem", color:"#888" }}>{selectedBiz.category} • Active for {selectedBiz.monthsOnPlatform} months</div>
                  </div>
                  <ScoreGauge score={selectedBiz.score}/>
                </div>

                {/* Score breakdown */}
                <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:12, fontSize:"0.85rem" }}>📊 Score Breakdown</div>
                <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:18 }}>
                  {SCORE_FACTORS.map(f => {
                    const rawVal = selectedBiz[f.key];
                    let normalized = 0;
                    if(f.key==="rating") normalized = ((rawVal-3)/2)*100;
                    else if(f.key==="reviews") normalized = Math.min((rawVal/200)*100,100);
                    else if(f.key==="responseRate") normalized = rawVal;
                    else if(f.key==="monthsOnPlatform") normalized = Math.min((rawVal/24)*100,100);
                    else if(f.key==="priceUpdates") normalized = Math.min((rawVal/30)*100,100);
                    else if(f.key==="paymentHistory") normalized = rawVal;
                    const contribution = Math.round((normalized/100)*(f.weight/100)*1000);
                    return (
                      <div key={f.key} style={{ display:"flex", gap:10, alignItems:"center" }}>
                        <span style={{ fontSize:"1rem", width:24 }}>{f.icon}</span>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3, fontSize:"0.72rem" }}>
                            <span style={{ fontWeight:600, color:C.darkBrown }}>{f.label}</span>
                            <span style={{ color:"#888" }}>{rawVal}{f.key==="responseRate"||f.key==="paymentHistory"?"%":""} → <strong style={{ color:C.kente2 }}>+{contribution} pts</strong></span>
                          </div>
                          <div style={{ height:6, background:"#f0f0f0", borderRadius:10, overflow:"hidden" }}>
                            <div style={{ height:"100%", width:`${normalized}%`, background:getScoreColor(selectedBiz.score), borderRadius:10 }}/>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {selectedBiz.loanEligible && (
                  <button onClick={()=>{ setCreditTab("apply"); }}
                    style={{ width:"100%", background:C.kente2, color:"white", border:"none", borderRadius:20, padding:"12px", fontWeight:900, cursor:"pointer", fontFamily:"inherit", fontSize:"0.88rem" }}>
                    💰 Apply for a Business Loan →
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* ── LENDING PARTNERS ── */}
        {creditTab === "partners" && (
          <>
            <div style={{ marginBottom:20 }}>
              <h2 style={{ margin:"0 0 4px", color:C.darkBrown, fontWeight:900, fontSize:"1.05rem" }}>🤝 Lending Partners</h2>
              <p style={{ color:"#888", fontSize:"0.78rem", margin:0 }}>AshantiHub-verified financial partners offering loans to scored businesses</p>
            </div>

            {/* Revenue model banner */}
            <div style={{ background:`linear-gradient(135deg,${C.kente2},#003d22)`, borderRadius:16, padding:"18px 22px", marginBottom:20, color:"white" }}>
              <div style={{ fontWeight:900, color:C.gold, marginBottom:6, fontSize:"0.88rem" }}>💸 AshantiHub Referral Revenue Model</div>
              <div style={{ fontSize:"0.76rem", opacity:0.9, lineHeight:1.7 }}>
                For every business successfully referred to a lending partner, AshantiHub earns a <strong style={{ color:C.gold }}>1–3% referral commission</strong> on the loan value. At 1,000 businesses borrowing an average of GHS 5,000:
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginTop:12 }}>
                {[["GHS 5M","Total Loans"],["GHS 100K","AshantiHub Revenue (2%)"],["GHS 10K","Per Month Projected"]].map(([v,l])=>(
                  <div key={l} style={{ background:"rgba(255,255,255,0.1)", borderRadius:10, padding:"10px", textAlign:"center" }}>
                    <div style={{ fontWeight:900, color:C.gold, fontSize:"0.95rem" }}>{v}</div>
                    <div style={{ fontSize:"0.58rem", opacity:0.8 }}>{l}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:14 }}>
              {LENDING_PARTNERS.map(p => (
                <div key={p.id} style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)", borderTop:`4px solid ${p.color}` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
                    <div style={{ width:44, height:44, borderRadius:12, background:`${p.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.4rem" }}>{p.logo}</div>
                    <div>
                      <div style={{ fontWeight:800, fontSize:"0.88rem", color:C.darkBrown }}>{p.name}</div>
                      <span style={{ background:`${p.color}20`, color:p.color, borderRadius:20, padding:"2px 8px", fontSize:"0.62rem", fontWeight:700 }}>{p.type}</span>
                    </div>
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14, fontSize:"0.74rem" }}>
                    {[
                      ["📊 Min Score", `${p.minScore}+`],
                      ["💰 Max Loan", p.maxLoan],
                      ["📈 Interest Rate", p.rate],
                      ["⏱️ Turnaround", p.turnaround],
                      ["🎯 Focus", p.focus],
                    ].map(([k,v])=>(
                      <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:"1px solid #f5f5f5" }}>
                        <span style={{ color:"#888" }}>{k}</span>
                        <span style={{ fontWeight:700, color:C.darkBrown }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    <a href={`https://wa.me/233${p.contact.replace(/\s/g,"")}`} target="_blank" rel="noopener noreferrer"
                      style={{ flex:1, background:C.whatsapp, color:"white", borderRadius:20, padding:"8px", fontSize:"0.7rem", fontWeight:700, textDecoration:"none", textAlign:"center" }}>
                      📱 Contact
                    </a>
                    <button onClick={()=>{ setSelectedPartner(p); setCreditTab("apply"); }}
                      style={{ flex:2, background:p.color, color:"white", border:"none", borderRadius:20, padding:"8px", fontSize:"0.7rem", fontWeight:700, cursor:"pointer" }}>
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
            <h2 style={{ margin:"0 0 16px", color:C.darkBrown, fontWeight:900, fontSize:"1.05rem" }}>📋 Loan Application</h2>
            {loanSubmitted ? (
              <div style={{ background:"white", borderRadius:18, padding:"40px 24px", textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
                <div style={{ fontSize:"3.5rem", marginBottom:14 }}>🎉</div>
                <div style={{ fontWeight:900, color:C.kente2, fontSize:"1.1rem", marginBottom:8 }}>Application Submitted!</div>
                <div style={{ color:"#555", fontSize:"0.82rem", lineHeight:1.7, marginBottom:20, maxWidth:400, margin:"0 auto 20px" }}>
                  Your loan application for <strong>GHS {Number(loanAmount).toLocaleString()}</strong> has been submitted to <strong>{selectedPartner?.name || "our lending partners"}</strong>. They will contact you via WhatsApp within {selectedPartner?.turnaround || "3–5 days"}.
                </div>
                <div style={{ background:`${C.gold}15`, border:`1px solid ${C.gold}33`, borderRadius:14, padding:"16px", marginBottom:20, textAlign:"left", display:"inline-block", minWidth:300 }}>
                  <div style={{ fontWeight:800, color:C.deepGold, marginBottom:8, fontSize:"0.82rem" }}>📋 Application Reference</div>
                  {[
                    ["Reference", `AH-LOAN-${Date.now().toString().slice(-6)}`],
                    ["Business", selectedBiz?.name],
                    ["Credit Score", selectedBiz?.score],
                    ["Amount Requested", `GHS ${Number(loanAmount).toLocaleString()}`],
                    ["Partner", selectedPartner?.name || "Multiple Partners"],
                    ["Purpose", loanPurpose],
                    ["Status", "Under Review ⏳"],
                  ].map(([k,v])=>(
                    <div key={k} style={{ display:"flex", justifyContent:"space-between", fontSize:"0.72rem", marginBottom:4 }}>
                      <span style={{ color:"#888" }}>{k}</span>
                      <span style={{ fontWeight:700, color:C.darkBrown }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
                  <button onClick={()=>{ setLoanSubmitted(false); setLoanAmount(""); setLoanPurpose(""); }}
                    style={{ background:C.gold, color:C.darkBrown, border:"none", borderRadius:30, padding:"10px 22px", fontWeight:900, cursor:"pointer", fontFamily:"inherit" }}>
                    Apply for Another Loan
                  </button>
                  <button onClick={()=>setCreditTab("scores")}
                    style={{ background:"#f0f0f0", color:"#666", border:"none", borderRadius:30, padding:"10px 22px", fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                    Back to Scores
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, alignItems:"start" }}>
                {/* Application form */}
                <div style={{ background:"white", borderRadius:16, padding:"22px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
                  <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:16, fontSize:"0.92rem" }}>📝 Your Application</div>

                  {/* Business selector */}
                  <div style={{ marginBottom:14 }}>
                    <label style={{ fontSize:"0.76rem", fontWeight:700, color:C.darkBrown, marginBottom:6, display:"block" }}>Select Business</label>
                    <select value={selectedBiz?.id} onChange={e=>setSelectedBiz(MOCK_CREDIT_BUSINESSES.find(b=>b.id===Number(e.target.value)))}
                      style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:"1.5px solid #ddd", fontSize:"0.85rem", background:"white", fontFamily:"inherit", outline:"none" }}>
                      {MOCK_CREDIT_BUSINESSES.filter(b=>b.loanEligible).map(b=>(
                        <option key={b.id} value={b.id}>{b.name} — Score: {b.score}</option>
                      ))}
                    </select>
                  </div>

                  {/* Loan amount */}
                  <div style={{ marginBottom:14 }}>
                    <label style={{ fontSize:"0.76rem", fontWeight:700, color:C.darkBrown, marginBottom:6, display:"block" }}>Loan Amount (GHS) *</label>
                    <input type="number" value={loanAmount} onChange={e=>setLoanAmount(e.target.value)}
                      placeholder={`Max: GHS ${selectedBiz?.maxLoan?.toLocaleString()}`}
                      max={selectedBiz?.maxLoan}
                      style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`1.5px solid ${loanAmount&&Number(loanAmount)>selectedBiz?.maxLoan?"#ef4444":"#ddd"}`, fontSize:"0.85rem", fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}/>
                    {loanAmount && Number(loanAmount) > selectedBiz?.maxLoan && (
                      <div style={{ fontSize:"0.68rem", color:"#ef4444", marginTop:3 }}>Exceeds your maximum eligible amount of GHS {selectedBiz?.maxLoan?.toLocaleString()}</div>
                    )}
                  </div>

                  {/* Loan purpose */}
                  <div style={{ marginBottom:14 }}>
                    <label style={{ fontSize:"0.76rem", fontWeight:700, color:C.darkBrown, marginBottom:6, display:"block" }}>Purpose of Loan *</label>
                    <select value={loanPurpose} onChange={e=>setLoanPurpose(e.target.value)}
                      style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:"1.5px solid #ddd", fontSize:"0.85rem", background:"white", fontFamily:"inherit", outline:"none" }}>
                      <option value="">Select purpose...</option>
                      {["Stock / Inventory Purchase","Equipment / Machinery","Business Expansion","Working Capital","Marketing & Advertising","Hire Additional Staff","Renovate Premises","Vehicle / Transport","Other"].map(p=><option key={p}>{p}</option>)}
                    </select>
                  </div>

                  {/* Preferred partner */}
                  <div style={{ marginBottom:16 }}>
                    <label style={{ fontSize:"0.76rex", fontWeight:700, color:C.darkBrown, marginBottom:6, display:"block" }}>Preferred Lender</label>
                    <select value={selectedPartner?.id||""} onChange={e=>setSelectedPartner(LENDING_PARTNERS.find(p=>p.id===Number(e.target.value))||null)}
                      style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:"1.5px solid #ddd", fontSize:"0.85rem", background:"white", fontFamily:"inherit", outline:"none" }}>
                      <option value="">Best match for my score</option>
                      {LENDING_PARTNERS.filter(p=>p.minScore<=( selectedBiz?.score||0)).map(p=>(
                        <option key={p.id} value={p.id}>{p.name} — {p.maxLoan}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={()=>{ if(loanAmount&&loanPurpose&&Number(loanAmount)<=selectedBiz?.maxLoan) setLoanSubmitted(true); }}
                    style={{ width:"100%", background:loanAmount&&loanPurpose&&Number(loanAmount)<=selectedBiz?.maxLoan?C.kente2:"#ddd", color:"white", border:"none", borderRadius:20, padding:"12px", fontWeight:900, cursor:loanAmount&&loanPurpose?"pointer":"default", fontFamily:"inherit", fontSize:"0.88rem" }}>
                    🚀 Submit Application
                  </button>
                  <div style={{ fontSize:"0.65rem", color:"#aaa", marginTop:8, textAlign:"center" }}>Your AshantiHub Credit Score is shared with the lender. No collateral required for eligible businesses.</div>
                </div>

                {/* Score summary & partner match */}
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  {/* Your score card */}
                  {selectedBiz && (
                    <div style={{ background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`, borderRadius:16, padding:"20px", color:"white" }}>
                      <div style={{ fontWeight:800, color:C.gold, marginBottom:12, fontSize:"0.85rem" }}>Your Credit Score</div>
                      <ScoreGauge score={selectedBiz.score}/>
                      <div style={{ marginTop:14, fontSize:"0.74rem", lineHeight:1.8, opacity:0.9 }}>
                        <div>✅ Loan eligible up to <strong style={{ color:C.gold }}>GHS {selectedBiz.maxLoan.toLocaleString()}</strong></div>
                        <div>🤝 Eligible for <strong style={{ color:C.gold }}>{LENDING_PARTNERS.filter(p=>p.minScore<=selectedBiz.score).length} of {LENDING_PARTNERS.length}</strong> partners</div>
                        <div>📈 Score improves with more reviews and activity</div>
                      </div>
                    </div>
                  )}

                  {/* Matched partners */}
                  <div style={{ background:"white", borderRadius:16, padding:"18px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
                    <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:12, fontSize:"0.85rem" }}>🤝 Your Matched Partners</div>
                    {LENDING_PARTNERS.filter(p=>p.minScore<=(selectedBiz?.score||0)).map(p=>(
                      <div key={p.id} style={{ display:"flex", gap:10, alignItems:"center", padding:"8px 0", borderBottom:"1px solid #f5f5f5" }}>
                        <div style={{ width:32, height:32, borderRadius:8, background:`${p.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1rem" }}>{p.logo}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:700, fontSize:"0.76rem", color:C.darkBrown }}>{p.name}</div>
                          <div style={{ fontSize:"0.65rem", color:"#888" }}>{p.maxLoan} • {p.rate}</div>
                        </div>
                        <span style={{ background:"#22c55e20", color:"#22c55e", borderRadius:20, padding:"2px 7px", fontSize:"0.6rem", fontWeight:700 }}>✓ Match</span>
                      </div>
                    ))}
                    {LENDING_PARTNERS.filter(p=>p.minScore<=(selectedBiz?.score||0)).length===0 && (
                      <div style={{ color:"#aaa", fontSize:"0.76rem", textAlign:"center", padding:"10px" }}>Improve your score to unlock lenders</div>
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
            <h2 style={{ margin:"0 0 16px", color:C.darkBrown, fontWeight:900, fontSize:"1.05rem" }}>💡 Credit Insights & Tips</h2>

            {/* How to improve score */}
            <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)", marginBottom:20 }}>
              <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:14, fontSize:"0.88rem" }}>📈 How to Improve Your Credit Score</div>
              {[
                { icon:"⭐", tip:"Get more customer reviews", impact:"+50–100 pts", action:"Ask every customer to leave a review after their WhatsApp enquiry", color:"#f59e0b" },
                { icon:"📱", tip:"Respond to all WhatsApp enquiries", impact:"+30–80 pts", action:"Aim for 95%+ response rate. Reply within 2 hours.", color:C.whatsapp },
                { icon:"🏷️", tip:"Update your prices regularly", impact:"+20–40 pts", action:"Log into your Business Dashboard and update prices at least twice a month", color:C.kente3 },
                { icon:"💰", tip:"Pay listing fees on time", impact:"+40–60 pts", action:"Set a monthly MoMo reminder to pay your listing fee before the due date", color:C.kente2 },
                { icon:"📅", tip:"Stay active longer", impact:"+10 pts/month", action:"The longer your business is on AshantiHub, the higher your tenure score", color:C.gold },
                { icon:"📦", tip:"Convert enquiries to bookings", impact:"+20–50 pts", action:"Follow up on every WhatsApp enquiry. A higher booking rate boosts your score", color:C.orange },
              ].map(item => (
                <div key={item.tip} style={{ display:"flex", gap:12, padding:"12px 0", borderBottom:"1px solid #f5f5f5", alignItems:"flex-start" }}>
                  <div style={{ width:40, height:40, borderRadius:10, background:`${item.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.2rem", flexShrink:0 }}>{item.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                      <span style={{ fontWeight:800, fontSize:"0.8rem", color:C.darkBrown }}>{item.tip}</span>
                      <span style={{ background:`${item.color}20`, color:item.color, borderRadius:20, padding:"2px 8px", fontSize:"0.62rem", fontWeight:800 }}>{item.impact}</span>
                    </div>
                    <div style={{ fontSize:"0.7rem", color:"#555", lineHeight:1.5 }}>{item.action}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Platform economic impact */}
            <div style={{ background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`, borderRadius:16, padding:"22px", color:"white" }}>
              <div style={{ fontWeight:900, color:C.gold, marginBottom:14, fontSize:"0.88rem" }}>🌍 AshantiHub Economic Impact Projection</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:10 }}>
                {[
                  { icon:"🏪", val:"200,000", label:"Target Businesses" },
                  { icon:"👥", val:"2,000,000", label:"Jobs Created" },
                  { icon:"💰", val:"GHS 1B+", label:"Total Loans Facilitated" },
                  { icon:"💸", val:"GHS 20M+", label:"AshantiHub Referral Revenue" },
                  { icon:"🌱", val:"GHS 5B+", label:"SME Economic Output" },
                  { icon:"🇬🇭", val:"Top 10", label:"Ghana Fintech Impact" },
                ].map(s => (
                  <div key={s.label} style={{ background:"rgba(255,255,255,0.08)", borderRadius:12, padding:"14px", textAlign:"center" }}>
                    <div style={{ fontSize:"1.5rem", marginBottom:4 }}>{s.icon}</div>
                    <div style={{ fontWeight:900, color:C.gold, fontSize:"0.95rem" }}>{s.val}</div>
                    <div style={{ fontSize:"0.6rem", opacity:0.8 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

// ─── Payment System ───────────────────────────────────────────────────────────
const MOMO_NETWORKS = [
  { id:"mtn", name:"MTN MoMo", color:"#FCD116", textColor:"#1A1A1A", logo:"🟡", ussd:"*170#", fee:"1.5%" },
  { id:"vodafone", name:"Vodafone Cash", color:"#E31837", textColor:"white", logo:"🔴", ussd:"*110#", fee:"1.5%" },
  { id:"airteltigo", name:"AirtelTigo Money", color:"#E87722", textColor:"white", logo:"🟠", ussd:"*500#", fee:"1.5%" },
];

const SUBSCRIPTION_PLANS = [
  { id:"basic", name:"Basic", monthlyPrice:20, annualPrice:200, color:"#6b7280", features:["1 listing","WhatsApp connect","Basic analytics","Email support"] },
  { id:"standard", name:"Standard", monthlyPrice:100, annualPrice:1000, color:"#D4A017", features:["5 listings","Featured placement","Full analytics","Priority support","Price alerts"], recommended:true },
  { id:"premium", name:"Premium", monthlyPrice:200, annualPrice:2000, color:"#CC0000", features:["Unlimited listings","Top search","Advanced analytics","Account manager","WhatsApp broadcast"] },
];

const MOCK_TRANSACTIONS = [
  { id:"TXN001", ref:"MTN240601001", business:"Royal Ashanti Lodge", amount:200, plan:"Standard", network:"MTN MoMo", date:"2026-06-01", status:"Success", type:"subscription" },
  { id:"TXN002", ref:"VOD240601002", business:"Afia's Kitchen", amount:20, plan:"Basic", network:"Vodafone Cash", date:"2026-06-01", status:"Success", type:"subscription" },
  { id:"TXN003", ref:"MTN240602003", business:"Kente Palace Weavers", amount:1000, plan:"Standard Annual", network:"MTN MoMo", date:"2026-06-02", status:"Success", type:"annual" },
  { id:"TXN004", ref:"MTN240603004", business:"Ashanti Homegoing Planners", amount:200, plan:"Premium", network:"MTN MoMo", date:"2026-06-03", status:"Pending", type:"subscription" },
  { id:"TXN005", ref:"AIR240603005", business:"Kumasi Royal Rides", amount:20, plan:"Basic", network:"AirtelTigo", date:"2026-06-03", status:"Failed", type:"subscription" },
  { id:"TXN006", ref:"VOD240604006", business:"Manhyia Rooftop Bar", amount:200, plan:"Premium", network:"Vodafone Cash", date:"2026-06-04", status:"Success", type:"subscription" },
];

const MOCK_INVOICES = [
  { id:"INV-2026-001", business:"Royal Ashanti Lodge", plan:"Standard", amount:200, vat:26, total:226, date:"2026-06-01", due:"2026-07-01", status:"Paid", email:"royal@lodge.com" },
  { id:"INV-2026-002", business:"Afia's Kitchen", plan:"Basic", amount:20, vat:2.6, total:22.6, date:"2026-06-01", due:"2026-07-01", status:"Paid", email:"afia@kitchen.com" },
  { id:"INV-2026-003", business:"Kumasi Royal Rides", plan:"Basic", amount:20, vat:2.6, total:22.6, date:"2026-06-03", due:"2026-07-03", status:"Overdue", email:"kumasi@rides.com" },
];

// ─── MoMo Payment Component ───────────────────────────────────────────────────
function MoMoPayment({ amount, purpose, businessName, onSuccess, onClose }) {
  const [step, setStep] = useState(1);
  const [network, setNetwork] = useState(null);
  const [phone, setPhone] = useState("");
  const [processing, setProcessing] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [success, setSuccess] = useState(false);
  const [txnRef] = useState(`AH${Date.now().toString().slice(-8)}`);

  useEffect(() => {
    if (step === 3 && !success) {
      const timer = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) {
            clearInterval(timer);
            setSuccess(true);
            setTimeout(() => onSuccess && onSuccess(txnRef), 1000);
            return 0;
          }
          return c - 1;
        });
      }, 100);
      return () => clearInterval(timer);
    }
  }, [step, success]);

  const selectedNetwork = MOMO_NETWORKS.find(n => n.id === network);
  const fee = amount * 0.015;
  const total = amount + fee;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={e => { if(e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:"white", borderRadius:24, width:"100%", maxWidth:400, boxShadow:"0 24px 64px rgba(0,0,0,0.4)", overflow:"hidden" }}>

        {/* Header */}
        <div style={{ background:`linear-gradient(135deg,${C.darkBrown},${C.kente2})`, padding:"20px 24px", position:"relative" }}>
          <button onClick={onClose} style={{ position:"absolute", top:14, right:16, background:"none", border:"none", color:"white", fontSize:"1.4rem", cursor:"pointer", opacity:0.7 }}>✕</button>
          <div style={{ color:C.gold, fontWeight:900, fontSize:"0.9rem", marginBottom:2 }}>💰 Mobile Money Payment</div>
          <div style={{ color:"white", fontSize:"0.78rem", opacity:0.85 }}>{purpose}</div>
          {businessName && <div style={{ color:C.lightGold, fontSize:"0.72rem", opacity:0.75, marginTop:2 }}>{businessName}</div>}
          {/* Progress */}
          <div style={{ display:"flex", gap:4, marginTop:14 }}>
            {["Select Network","Enter Number","Confirm"].map((s,i) => (
              <div key={i} style={{ flex:1, textAlign:"center" }}>
                <div style={{ height:4, borderRadius:10, background:step>i+1?"#22c55e":step===i+1?C.gold:"rgba(255,255,255,0.2)", marginBottom:3 }}/>
                <div style={{ fontSize:"0.55rem", color:step===i+1?C.gold:"rgba(255,255,255,0.5)", fontWeight:step===i+1?800:400 }}>{s}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding:"22px 24px" }}>

          {/* Step 1 — Select Network */}
          {step === 1 && (
            <div>
              <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:14, fontSize:"0.88rem" }}>Select your mobile network</div>
              <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
                {MOMO_NETWORKS.map(n => (
                  <button key={n.id} onClick={() => { setNetwork(n.id); setStep(2); }}
                    style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 16px", borderRadius:14, border:`2px solid ${n.color}33`, background:`${n.color}08`, cursor:"pointer", textAlign:"left", transition:"all 0.2s" }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = n.color}
                    onMouseLeave={e => e.currentTarget.style.borderColor = `${n.color}33`}>
                    <div style={{ width:40, height:40, borderRadius:"50%", background:n.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.2rem", flexShrink:0 }}>{n.logo}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:800, fontSize:"0.88rem", color:C.darkBrown }}>{n.name}</div>
                      <div style={{ fontSize:"0.68rem", color:"#888" }}>Dial {n.ussd} • {n.fee} transaction fee</div>
                    </div>
                    <div style={{ color:"#ccc", fontSize:"1.2rem" }}>›</div>
                  </button>
                ))}
              </div>
              {/* Amount summary */}
              <div style={{ background:`${C.gold}12`, border:`1px solid ${C.gold}33`, borderRadius:12, padding:"12px 14px", fontSize:"0.78rem" }}>
                <div style={{ display:"flex", justifyContent:"space-between", color:"#555", marginBottom:4 }}>
                  <span>Amount</span><span style={{ fontWeight:700 }}>GHS {amount.toFixed(2)}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", color:"#888", marginBottom:6 }}>
                  <span>Transaction fee (1.5%)</span><span>GHS {fee.toFixed(2)}</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontWeight:900, color:C.darkBrown, borderTop:`1px solid ${C.gold}33`, paddingTop:6 }}>
                  <span>Total</span><span style={{ color:C.kente2 }}>GHS {total.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Step 2 — Enter Phone */}
          {step === 2 && selectedNetwork && (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
                <div style={{ width:36, height:36, borderRadius:"50%", background:selectedNetwork.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.1rem" }}>{selectedNetwork.logo}</div>
                <div style={{ fontWeight:800, color:C.darkBrown, fontSize:"0.88rem" }}>{selectedNetwork.name}</div>
              </div>

              <div style={{ marginBottom:14 }}>
                <label style={{ fontSize:"0.78rem", fontWeight:700, color:C.darkBrown, marginBottom:6, display:"block" }}>📱 {selectedNetwork.name} Number</label>
                <div style={{ display:"flex", gap:0, borderRadius:12, overflow:"hidden", border:`1.5px solid ${phone.length>=10?"#22c55e":"#ddd"}` }}>
                  <div style={{ background:"#f0f0f0", padding:"11px 12px", fontSize:"0.82rem", fontWeight:700, color:"#555", borderRight:"1px solid #ddd" }}>+233</div>
                  <input value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g,"").slice(0,10))}
                    placeholder="0244 000 000" maxLength={10}
                    style={{ flex:1, padding:"11px 12px", border:"none", fontSize:"0.88rem", outline:"none", fontFamily:"inherit", letterSpacing:1 }}/>
                  {phone.length>=10 && <div style={{ padding:"11px 12px", color:"#22c55e", fontSize:"1rem" }}>✓</div>}
                </div>
              </div>

              {/* Payment summary */}
              <div style={{ background:"#f9f9f9", borderRadius:12, padding:"12px 14px", marginBottom:16, fontSize:"0.76rem", lineHeight:1.8 }}>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span style={{ color:"#888" }}>Purpose</span><span style={{ fontWeight:700 }}>{purpose}</span></div>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span style={{ color:"#888" }}>Network</span><span style={{ fontWeight:700 }}>{selectedNetwork.name}</span></div>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span style={{ color:"#888" }}>Amount</span><span style={{ fontWeight:700 }}>GHS {amount}</span></div>
                <div style={{ display:"flex", justifyContent:"space-between" }}><span style={{ color:"#888" }}>Fee</span><span>GHS {fee.toFixed(2)}</span></div>
                <div style={{ display:"flex", justifyContent:"space-between", borderTop:`1px solid #e0e0e0`, paddingTop:4, marginTop:2 }}><span style={{ fontWeight:800 }}>Total</span><span style={{ fontWeight:900, color:C.kente2 }}>GHS {total.toFixed(2)}</span></div>
              </div>

              <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:10, padding:"10px 12px", fontSize:"0.7rem", color:"#1e40af", marginBottom:16, lineHeight:1.6 }}>
                📲 After tapping Pay, you will receive a <strong>prompt on your phone</strong>. Enter your {selectedNetwork.name} PIN to approve the payment.
              </div>

              <div style={{ display:"flex", gap:8 }}>
                <button onClick={() => setStep(1)} style={{ flex:1, background:"#f0f0f0", color:"#666", border:"none", borderRadius:20, padding:"11px", fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>← Back</button>
                <button onClick={() => { if(phone.length>=10) setStep(3); }}
                  style={{ flex:2, background:phone.length>=10?selectedNetwork.color:"#ddd", color:phone.length>=10?selectedNetwork.textColor:"#aaa", border:"none", borderRadius:20, padding:"11px", fontWeight:900, cursor:phone.length>=10?"pointer":"default", fontFamily:"inherit", fontSize:"0.85rem" }}>
                  Pay GHS {total.toFixed(2)} →
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Processing / Success */}
          {step === 3 && (
            <div style={{ textAlign:"center", padding:"10px 0" }}>
              {!success ? (
                <>
                  <div style={{ fontSize:"3rem", marginBottom:14 }}>
                    <div style={{ display:"inline-block", animation:"spin 1s linear infinite" }}>⏳</div>
                  </div>
                  <div style={{ fontWeight:900, color:C.darkBrown, fontSize:"1rem", marginBottom:6 }}>Processing Payment...</div>
                  <div style={{ color:"#555", fontSize:"0.78rem", marginBottom:16, lineHeight:1.6 }}>
                    Please approve the payment prompt on your phone.<br/>
                    <strong>Do not close this screen.</strong>
                  </div>
                  {/* Progress bar */}
                  <div style={{ background:"#f0f0f0", borderRadius:20, height:8, marginBottom:8, overflow:"hidden" }}>
                    <div style={{ height:"100%", borderRadius:20, background:`linear-gradient(90deg,${C.kente2},${C.gold})`, width:`${((30-countdown)/30)*100}%`, transition:"width 0.1s" }}/>
                  </div>
                  <div style={{ fontSize:"0.68rem", color:"#aaa" }}>Waiting for approval... {countdown}s</div>
                  <div style={{ marginTop:16, background:`${selectedNetwork?.color}15`, border:`1px solid ${selectedNetwork?.color}33`, borderRadius:12, padding:"10px 14px" }}>
                    <div style={{ fontSize:"0.72rem", color:"#444" }}>📱 Check your phone for the {selectedNetwork?.name} payment prompt</div>
                    <div style={{ fontSize:"0.68rem", color:"#888", marginTop:3 }}>Ref: <strong>{txnRef}</strong></div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize:"3.5rem", marginBottom:12 }}>✅</div>
                  <div style={{ fontWeight:900, color:"#22c55e", fontSize:"1.1rem", marginBottom:6 }}>Payment Successful!</div>
                  <div style={{ color:"#555", fontSize:"0.78rem", marginBottom:16, lineHeight:1.6 }}>
                    Your payment of <strong>GHS {total.toFixed(2)}</strong> has been received.<br/>
                    A receipt has been sent to your WhatsApp.
                  </div>
                  <div style={{ background:"#f0fdf4", border:"1px solid #22c55e33", borderRadius:14, padding:"14px", marginBottom:16, textAlign:"left" }}>
                    <div style={{ fontWeight:800, color:"#22c55e", marginBottom:8, fontSize:"0.82rem" }}>📋 Payment Receipt</div>
                    {[
                      ["Transaction Ref", txnRef],
                      ["Network", selectedNetwork?.name],
                      ["Amount Paid", `GHS ${total.toFixed(2)}`],
                      ["Purpose", purpose],
                      ["Date", new Date().toLocaleDateString("en-GH")],
                      ["Status", "✅ Confirmed"],
                    ].map(([k,v]) => (
                      <div key={k} style={{ display:"flex", justifyContent:"space-between", fontSize:"0.72rem", marginBottom:4 }}>
                        <span style={{ color:"#888" }}>{k}</span>
                        <span style={{ fontWeight:700, color:C.darkBrown }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={onClose} style={{ background:C.gold, color:C.darkBrown, border:"none", borderRadius:30, padding:"11px 28px", fontWeight:900, cursor:"pointer", fontFamily:"inherit" }}>
                    Done 🎉
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Invoice Generator ────────────────────────────────────────────────────────
function InvoiceModal({ invoice, onClose }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.65)", zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}
      onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div style={{ background:"white", borderRadius:20, width:"100%", maxWidth:480, boxShadow:"0 20px 60px rgba(0,0,0,0.3)", overflow:"hidden" }}>
        {/* Invoice Header */}
        <div style={{ background:`linear-gradient(135deg,${C.darkBrown},${C.black})`, padding:"22px 24px", position:"relative" }}>
          <button onClick={onClose} style={{ position:"absolute", top:14, right:16, background:"none", border:"none", color:"white", fontSize:"1.3rem", cursor:"pointer", opacity:0.7 }}>✕</button>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <Flag w={44} h={30}/>
            <div>
              <div style={{ color:C.gold, fontWeight:900, fontSize:"1rem" }}>AshantiHub Ltd</div>
              <div style={{ color:"#aaa", fontSize:"0.65rem" }}>Kumasi, Ashanti Region, Ghana</div>
            </div>
          </div>
          <div style={{ marginTop:14, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ color:"white", fontWeight:900, fontSize:"1.2rem" }}>TAX INVOICE</div>
            <div style={{ background:invoice.status==="Paid"?"#22c55e":invoice.status==="Overdue"?"#ef4444":"#f59e0b", color:"white", borderRadius:20, padding:"4px 12px", fontSize:"0.7rem", fontWeight:800 }}>{invoice.status}</div>
          </div>
        </div>

        <div style={{ padding:"22px 24px" }}>
          {/* Invoice details */}
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:10 }}>
            <div>
              <div style={{ fontSize:"0.68rem", color:"#888", marginBottom:2 }}>INVOICE NUMBER</div>
              <div style={{ fontWeight:800, color:C.darkBrown }}>{invoice.id}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:"0.68rem", color:"#888", marginBottom:2 }}>INVOICE DATE</div>
              <div style={{ fontWeight:700 }}>{invoice.date}</div>
            </div>
            <div>
              <div style={{ fontSize:"0.68rem", color:"#888", marginBottom:2 }}>DUE DATE</div>
              <div style={{ fontWeight:700, color:invoice.status==="Overdue"?"#ef4444":C.darkBrown }}>{invoice.due}</div>
            </div>
          </div>

          {/* Business details */}
          <div style={{ background:"#f9f9f9", borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
            <div style={{ fontSize:"0.68rem", color:"#888", marginBottom:4 }}>BILLED TO</div>
            <div style={{ fontWeight:800, color:C.darkBrown }}>{invoice.business}</div>
            <div style={{ fontSize:"0.74rem", color:"#555" }}>{invoice.email}</div>
          </div>

          {/* Line items */}
          <div style={{ marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"2px solid #f0f0f0", fontSize:"0.72rem", fontWeight:700, color:"#888" }}>
              <span>DESCRIPTION</span><span>AMOUNT</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:"1px solid #f5f5f5", fontSize:"0.78rem" }}>
              <span>AshantiHub {invoice.plan} Plan — Monthly Listing Fee</span>
              <span style={{ fontWeight:700 }}>GHS {invoice.amount.toFixed(2)}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", fontSize:"0.74rem", color:"#888" }}>
              <span>VAT (12.5%)</span>
              <span>GHS {invoice.vat.toFixed(2)}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderTop:"2px solid #f0f0f0", fontWeight:900, fontSize:"0.88rem", color:C.darkBrown }}>
              <span>TOTAL DUE</span>
              <span style={{ color:C.kente2, fontSize:"1rem" }}>GHS {invoice.total.toFixed(2)}</span>
            </div>
          </div>

          {/* Payment instructions */}
          <div style={{ background:`${C.gold}12`, border:`1.5px solid ${C.gold}33`, borderRadius:12, padding:"12px 14px", marginBottom:16, fontSize:"0.72rem", lineHeight:1.8 }}>
            <div style={{ fontWeight:800, color:C.deepGold, marginBottom:4 }}>💰 Payment Instructions</div>
            <div>Send payment via <strong>MTN MoMo, Vodafone Cash or AirtelTigo Money</strong> to:</div>
            <div style={{ fontWeight:900, color:C.darkBrown, fontSize:"0.85rem", margin:"4px 0" }}>0244 000 000 — AshantiHub Ltd</div>
            <div style={{ color:"#888" }}>Reference: {invoice.id} | Due: {invoice.due}</div>
          </div>

          {/* Footer */}
          <div style={{ textAlign:"center", fontSize:"0.65rem", color:"#aaa", marginBottom:14 }}>
            AshantiHub Ltd • Kumasi, Ashanti Region, Ghana • legal@ashantihub.com<br/>
            Registered under Ghana Companies Act 2019 • GRA TIN: GH-XXXX-XXXX
          </div>

          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => window.print()} style={{ flex:1, background:"#f0f0f0", color:"#666", border:"none", borderRadius:20, padding:"10px", fontWeight:700, cursor:"pointer", fontFamily:"inherit", fontSize:"0.78rem" }}>
              🖨️ Print / Save PDF
            </button>
            {invoice.status !== "Paid" && (
              <button style={{ flex:2, background:C.kente2, color:"white", border:"none", borderRadius:20, padding:"10px", fontWeight:900, cursor:"pointer", fontFamily:"inherit", fontSize:"0.82rem" }}>
                💰 Pay Now via MoMo
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Payment Dashboard (Admin) ─────────────────────────────────────────────────
function PaymentDashboard({ onClose }) {
  const [payTab, setPayTab] = useState("overview");
  const [showInvoice, setShowInvoice] = useState(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [billingCycle, setBillingCycle] = useState("monthly");

  const totalRevenue = MOCK_TRANSACTIONS.filter(t=>t.status==="Success").reduce((s,t)=>s+t.amount,0);
  const pendingRevenue = MOCK_TRANSACTIONS.filter(t=>t.status==="Pending").reduce((s,t)=>s+t.amount,0);
  const failedTxns = MOCK_TRANSACTIONS.filter(t=>t.status==="Failed").length;

  const statusColor = { Success:"#22c55e", Pending:"#f59e0b", Failed:"#ef4444" };

  const tabs = [
    { id:"overview", icon:"💰", label:"Overview" },
    { id:"transactions", icon:"📋", label:"Transactions" },
    { id:"invoices", icon:"🧾", label:"Invoices" },
    { id:"subscribe", icon:"⭐", label:"Subscribe" },
    { id:"reminders", icon:"🔔", label:"Reminders" },
  ];

  return (
    <div style={{ fontFamily:"'Georgia',serif", background:"#f4f5f7", minHeight:"100vh" }}>
      {showInvoice && <InvoiceModal invoice={showInvoice} onClose={()=>setShowInvoice(null)}/>}
      {showPayModal && selectedPlan && (
        <MoMoPayment
          amount={billingCycle==="monthly"?selectedPlan.monthlyPrice:selectedPlan.annualPrice}
          purpose={`AshantiHub ${selectedPlan.name} Plan — ${billingCycle==="monthly"?"Monthly":"Annual"}`}
          businessName="Your Business"
          onSuccess={(ref)=>{ setShowPayModal(false); alert(`Payment confirmed! Ref: ${ref}`); }}
          onClose={()=>setShowPayModal(false)}
        />
      )}

      {/* Header */}
      <div style={{ background:`linear-gradient(135deg,${C.darkBrown},${C.black})`, padding:"0 16px", position:"sticky", top:0, zIndex:100, boxShadow:"0 2px 20px rgba(0,0,0,0.4)" }}>
        <div style={{ position:"absolute", top:0, left:0, right:0, height:4, background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)` }}/>
        <div style={{ maxWidth:960, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", height:58 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <Flag w={44} h={30}/>
            <div>
              <div style={{ color:C.gold, fontWeight:900, fontSize:"0.95rem" }}>AshantiHub</div>
              <div style={{ color:"#aaa", fontSize:"0.62rem" }}>Payment Centre</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"1px solid #444", color:"#aaa", borderRadius:20, padding:"5px 14px", fontSize:"0.7rem", cursor:"pointer", fontFamily:"inherit" }}>← Exit</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background:"white", borderBottom:"1px solid #e8e8e8", padding:"0 16px", overflowX:"auto" }}>
        <div style={{ maxWidth:960, margin:"0 auto", display:"flex" }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setPayTab(t.id)} style={{
              background:"none", border:"none",
              borderBottom:payTab===t.id?`3px solid ${C.gold}`:"3px solid transparent",
              color:payTab===t.id?C.darkBrown:"#888",
              padding:"12px 16px", fontSize:"0.75rem", fontWeight:payTab===t.id?800:600,
              cursor:"pointer", whiteSpace:"nowrap", fontFamily:"inherit"
            }}>{t.icon} {t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:960, margin:"0 auto", padding:"22px 16px 60px" }}>

        {/* ── OVERVIEW ── */}
        {payTab === "overview" && (
          <>
            <h2 style={{ margin:"0 0 20px", color:C.darkBrown, fontWeight:900, fontSize:"1.05rem" }}>💰 Payment Overview</h2>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:14, marginBottom:24 }}>
              {[
                { icon:"💚", label:"Total Revenue", value:`GHS ${totalRevenue.toLocaleString()}`, sub:"This month", color:"#22c55e" },
                { icon:"⏳", label:"Pending", value:`GHS ${pendingRevenue}`, sub:"Awaiting confirmation", color:"#f59e0b" },
                { icon:"❌", label:"Failed Payments", value:failedTxns, sub:"Need follow-up", color:"#ef4444" },
                { icon:"🏪", label:"Active Subscribers", value:MOCK_TRANSACTIONS.filter(t=>t.status==="Success").length, sub:"Paying businesses", color:C.kente3 },
                { icon:"📈", label:"MRR", value:`GHS ${(totalRevenue).toLocaleString()}`, sub:"Monthly Recurring Revenue", color:C.gold },
              ].map(s => (
                <div key={s.label} style={{ background:"white", borderRadius:14, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)", borderLeft:`4px solid ${s.color}` }}>
                  <div style={{ fontSize:"1.3rem", marginBottom:4 }}>{s.icon}</div>
                  <div style={{ fontWeight:900, fontSize:"1.2rem", color:C.darkBrown }}>{s.value}</div>
                  <div style={{ fontSize:"0.7rem", fontWeight:700, color:"#555" }}>{s.label}</div>
                  <div style={{ fontSize:"0.62rem", color:s.color, fontWeight:600 }}>{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Revenue by network */}
            <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)", marginBottom:20 }}>
              <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:14, fontSize:"0.88rem" }}>📊 Revenue by Network</div>
              {MOMO_NETWORKS.map(n => {
                const netTotal = MOCK_TRANSACTIONS.filter(t=>t.status==="Success"&&t.network.includes(n.name.split(" ")[0])).reduce((s,t)=>s+t.amount,0);
                const pct = totalRevenue > 0 ? (netTotal/totalRevenue)*100 : 0;
                return (
                  <div key={n.id} style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.76rem", marginBottom:4 }}>
                      <span style={{ fontWeight:700 }}>{n.logo} {n.name}</span>
                      <span style={{ fontWeight:800, color:C.kente2 }}>GHS {netTotal} ({pct.toFixed(0)}%)</span>
                    </div>
                    <div style={{ height:8, background:"#f0f0f0", borderRadius:10, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${pct}%`, background:n.color, borderRadius:10 }}/>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Recent transactions */}
            <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
              <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:14, fontSize:"0.88rem" }}>🕐 Recent Transactions</div>
              {MOCK_TRANSACTIONS.slice(0,4).map(t => (
                <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #f5f5f5", flexWrap:"wrap", gap:8 }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:"0.8rem" }}>{t.business}</div>
                    <div style={{ fontSize:"0.68rem", color:"#888" }}>{t.network} • {t.date} • Ref: {t.ref}</div>
                  </div>
                  <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <span style={{ fontWeight:900, color:C.kente2 }}>GHS {t.amount}</span>
                    <span style={{ background:`${statusColor[t.status]}20`, color:statusColor[t.status], borderRadius:20, padding:"2px 8px", fontSize:"0.62rem", fontWeight:800 }}>{t.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── TRANSACTIONS ── */}
        {payTab === "transactions" && (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:10 }}>
              <h2 style={{ margin:0, color:C.darkBrown, fontWeight:900, fontSize:"1.05rem" }}>📋 All Transactions</h2>
              <button style={{ background:C.kente2, color:"white", border:"none", borderRadius:20, padding:"8px 16px", fontSize:"0.74rem", fontWeight:700, cursor:"pointer" }}>📥 Export CSV</button>
            </div>
            <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)", overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.74rem" }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #f0f0f0" }}>
                    {["TXN ID","Reference","Business","Plan","Amount","Network","Date","Status"].map(h=>(
                      <th key={h} style={{ textAlign:"left", padding:"8px 10px", color:"#888", fontWeight:700, whiteSpace:"nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MOCK_TRANSACTIONS.map(t => (
                    <tr key={t.id} style={{ borderBottom:"1px solid #f8f8f8" }}
                      onMouseEnter={e=>e.currentTarget.style.background="#fafafa"}
                      onMouseLeave={e=>e.currentTarget.style.background=""}>
                      <td style={{ padding:"10px", fontWeight:700, color:C.deepGold }}>{t.id}</td>
                      <td style={{ padding:"10px", color:"#555", fontSize:"0.68rem" }}>{t.ref}</td>
                      <td style={{ padding:"10px", fontWeight:600 }}>{t.business}</td>
                      <td style={{ padding:"10px", color:"#555" }}>{t.plan}</td>
                      <td style={{ padding:"10px", fontWeight:800, color:C.kente2 }}>GHS {t.amount}</td>
                      <td style={{ padding:"10px", color:"#555" }}>{t.network}</td>
                      <td style={{ padding:"10px", color:"#aaa" }}>{t.date}</td>
                      <td style={{ padding:"10px" }}>
                        <span style={{ background:`${statusColor[t.status]}20`, color:statusColor[t.status], borderRadius:20, padding:"3px 9px", fontSize:"0.62rem", fontWeight:800 }}>{t.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── INVOICES ── */}
        {payTab === "invoices" && (
          <>
            <h2 style={{ margin:"0 0 16px", color:C.darkBrown, fontWeight:900, fontSize:"1.05rem" }}>🧾 Invoices</h2>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:14 }}>
              {MOCK_INVOICES.map(inv => (
                <div key={inv.id} style={{ background:"white", borderRadius:16, padding:"18px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)", borderTop:`3px solid ${inv.status==="Paid"?"#22c55e":inv.status==="Overdue"?"#ef4444":"#f59e0b"}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                    <div>
                      <div style={{ fontWeight:800, fontSize:"0.85rem", color:C.darkBrown }}>{inv.id}</div>
                      <div style={{ fontSize:"0.7rem", color:"#888", marginTop:2 }}>{inv.business}</div>
                    </div>
                    <span style={{ background:inv.status==="Paid"?"#22c55e20":inv.status==="Overdue"?"#fee2e2":"#fef9c3", color:inv.status==="Paid"?"#22c55e":inv.status==="Overdue"?"#ef4444":"#b45309", borderRadius:20, padding:"3px 10px", fontSize:"0.62rem", fontWeight:800 }}>{inv.status}</span>
                  </div>
                  <div style={{ fontSize:"0.74rem", color:"#555", lineHeight:1.8, marginBottom:12 }}>
                    <div>📋 {inv.plan} Plan</div>
                    <div>📅 Due: {inv.due}</div>
                    <div>💰 Total: <strong style={{ color:C.kente2 }}>GHS {inv.total.toFixed(2)}</strong> <span style={{ color:"#aaa", fontSize:"0.65rem" }}>(incl. VAT)</span></div>
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    <button onClick={()=>setShowInvoice(inv)} style={{ flex:1, background:`${C.gold}22`, color:C.deepGold, border:"none", borderRadius:20, padding:"7px", fontSize:"0.7rem", fontWeight:700, cursor:"pointer" }}>🧾 View Invoice</button>
                    {inv.status !== "Paid" && (
                      <button style={{ flex:1, background:C.kente2, color:"white", border:"none", borderRadius:20, padding:"7px", fontSize:"0.7rem", fontWeight:700, cursor:"pointer" }}>💰 Pay Now</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── SUBSCRIBE ── */}
        {payTab === "subscribe" && (
          <>
            <div style={{ textAlign:"center", marginBottom:24 }}>
              <h2 style={{ margin:"0 0 6px", color:C.darkBrown, fontWeight:900, fontSize:"1.05rem" }}>⭐ Choose Your Plan</h2>
              <p style={{ color:"#888", fontSize:"0.78rem", margin:"0 0 16px" }}>List your business on AshantiHub. First 3 months FREE.</p>
              {/* Billing toggle */}
              <div style={{ display:"inline-flex", background:"#f0f0f0", borderRadius:30, padding:3, gap:3 }}>
                {["monthly","annual"].map(cycle => (
                  <button key={cycle} onClick={()=>setBillingCycle(cycle)} style={{
                    background:billingCycle===cycle?"white":"transparent",
                    border:"none", borderRadius:28, padding:"7px 18px",
                    fontWeight:billingCycle===cycle?800:600, fontSize:"0.78rem",
                    cursor:"pointer", color:billingCycle===cycle?C.darkBrown:"#888",
                    boxShadow:billingCycle===cycle?"0 2px 8px rgba(0,0,0,0.1)":"none"
                  }}>
                    {cycle==="monthly"?"Monthly":"Annual 🎁 2 months free"}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:14 }}>
              {SUBSCRIPTION_PLANS.map(plan => (
                <div key={plan.id} style={{ background:"white", borderRadius:18, padding:"22px", boxShadow:"0 2px 16px rgba(0,0,0,0.09)", border:`2px solid ${plan.recommended?C.gold:"transparent"}`, position:"relative" }}>
                  {plan.recommended && <div style={{ position:"absolute", top:-10, left:"50%", transform:"translateX(-50%)", background:C.gold, color:C.darkBrown, borderRadius:20, padding:"3px 14px", fontSize:"0.62rem", fontWeight:900, whiteSpace:"nowrap" }}>⭐ MOST POPULAR</div>}
                  <div style={{ fontWeight:900, color:plan.color, fontSize:"1rem", marginBottom:4 }}>{plan.name}</div>
                  <div style={{ fontWeight:900, fontSize:"1.8rem", color:C.darkBrown, marginBottom:2 }}>
                    GHS {billingCycle==="monthly"?plan.monthlyPrice:plan.annualPrice}
                    <span style={{ fontSize:"0.72rem", fontWeight:400, color:"#aaa" }}>/{billingCycle==="monthly"?"month":"year"}</span>
                  </div>
                  {billingCycle==="annual" && (
                    <div style={{ fontSize:"0.68rem", color:C.kente2, fontWeight:700, marginBottom:8 }}>🎁 Save GHS {plan.monthlyPrice*2} vs monthly</div>
                  )}
                  <div style={{ borderTop:"1px solid #f0f0f0", paddingTop:12, marginBottom:16 }}>
                    {plan.features.map(f => (
                      <div key={f} style={{ fontSize:"0.72rem", color:"#444", marginBottom:5, display:"flex", gap:6 }}>
                        <span style={{ color:C.kente2 }}>✓</span>{f}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => { setSelectedPlan(plan); setShowPayModal(true); }}
                    style={{ width:"100%", background:plan.recommended?C.gold:"#f0f0f0", color:plan.recommended?C.darkBrown:"#666", border:"none", borderRadius:20, padding:"11px", fontWeight:900, cursor:"pointer", fontFamily:"inherit", fontSize:"0.82rem" }}>
                    💰 Pay with MoMo
                  </button>
                </div>
              ))}
            </div>
            <div style={{ background:`${C.whatsapp}12`, border:`1.5px solid ${C.whatsapp}33`, borderRadius:14, padding:"14px 18px", marginTop:20 }}>
              <div style={{ fontWeight:800, color:"#1a5c2e", marginBottom:4, fontSize:"0.82rem" }}>💰 Accepted Payment Methods</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {MOMO_NETWORKS.map(n => (
                  <span key={n.id} style={{ background:`${n.color}20`, color:n.color===C.ghGold?C.darkBrown:"#333", borderRadius:20, padding:"4px 12px", fontSize:"0.72rem", fontWeight:700, border:`1px solid ${n.color}44` }}>
                    {n.logo} {n.name}
                  </span>
                ))}
              </div>
              <div style={{ fontSize:"0.7rem", color:"#555", marginTop:8, lineHeight:1.6 }}>
                All payments are processed securely via Hubtel. Transaction fee of 1.5% applies. Annual plans billed once and auto-renew after 12 months.
              </div>
            </div>
          </>
        )}

        {/* ── REMINDERS ── */}
        {payTab === "reminders" && (
          <>
            <h2 style={{ margin:"0 0 6px", color:C.darkBrown, fontWeight:900, fontSize:"1.05rem" }}>🔔 Payment Reminders</h2>
            <p style={{ color:"#888", fontSize:"0.78rem", margin:"0 0 20px" }}>Automated WhatsApp reminders sent to businesses before and after payment due dates</p>

            {/* Reminder schedule */}
            <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)", marginBottom:20 }}>
              <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:14, fontSize:"0.88rem" }}>📅 Automated Reminder Schedule</div>
              {[
                { days:"7 days before", icon:"📢", msg:"Your AshantiHub listing renews in 7 days. Payment of GHS [amount] due to MTN MoMo 0244 000 000.", color:"#3b82f6", status:"Active" },
                { days:"3 days before", icon:"⏰", msg:"Reminder: Your AshantiHub listing renews in 3 days. Tap here to pay now and keep your listing active.", color:"#f59e0b", status:"Active" },
                { days:"On due date", icon:"📅", msg:"Your AshantiHub listing is due for renewal today. Please send GHS [amount] to MoMo 0244 000 000 to continue.", color:C.kente1, status:"Active" },
                { days:"3 days overdue", icon:"⚠️", msg:"Your AshantiHub listing has been paused. Send GHS [amount] to 0244 000 000 to reactivate immediately.", color:"#ef4444", status:"Active" },
                { days:"7 days overdue", icon:"🔴", msg:"Final notice: Your AshantiHub listing will be permanently removed in 24 hours. Contact us to resolve.", color:"#7f1d1d", status:"Active" },
              ].map((r,i) => (
                <div key={i} style={{ display:"flex", gap:12, padding:"12px 0", borderBottom:"1px solid #f5f5f5", alignItems:"flex-start" }}>
                  <div style={{ width:40, height:40, borderRadius:"50%", background:`${r.color}20`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.1rem", flexShrink:0 }}>{r.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ fontWeight:800, fontSize:"0.8rem", color:r.color }}>{r.days}</span>
                      <span style={{ background:"#22c55e20", color:"#22c55e", borderRadius:20, padding:"2px 8px", fontSize:"0.6rem", fontWeight:700 }}>{r.status}</span>
                    </div>
                    <div style={{ fontSize:"0.72rem", color:"#555", lineHeight:1.5, background:"#f9f9f9", borderRadius:8, padding:"8px 10px" }}>
                      📱 "{r.msg}"
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Businesses needing follow-up */}
            <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
              <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:14, fontSize:"0.88rem" }}>⚠️ Businesses Needing Follow-up</div>
              {MOCK_TRANSACTIONS.filter(t=>t.status!=="Success").map(t => (
                <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #f5f5f5", flexWrap:"wrap", gap:8 }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:"0.8rem" }}>{t.business}</div>
                    <div style={{ fontSize:"0.68rem", color:"#888" }}>{t.plan} — GHS {t.amount} — {t.status}</div>
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    <a href={`https://wa.me/233244000001?text=${encodeURIComponent(`Hello! Your AshantiHub listing payment of GHS ${t.amount} is ${t.status}. Please send payment to MTN MoMo 0244 000 000 to keep your listing active. Reference: ${t.id}`)}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ background:C.whatsapp, color:"white", borderRadius:20, padding:"5px 12px", fontSize:"0.68rem", fontWeight:700, textDecoration:"none" }}>
                      📱 Send Reminder
                    </a>
                    <span style={{ background:`${statusColor[t.status]}20`, color:statusColor[t.status], borderRadius:20, padding:"5px 10px", fontSize:"0.65rem", fontWeight:800 }}>{t.status}</span>
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

const MOCK_REVIEWS = {
  1:[
    {id:1,author:"Emma Thompson",country:"🇬🇧",rating:5,text:"Absolutely stunning hotel. The kente decor is breathtaking and staff were incredibly welcoming.",date:"2026-05-28",helpful:12},
    {id:2,author:"Hans Mueller",country:"🇩🇪",rating:4,text:"Great location near the palace. Breakfast could be improved but overall wonderful stay.",date:"2026-05-15",helpful:8},
    {id:3,author:"Kwame Asante",country:"🇬🇭",rating:5,text:"Best hotel in Kumasi! Felt like royalty. Will definitely return for Akwasidae.",date:"2026-05-10",helpful:15},
  ],
};

const KUMASI_ZONES = ["All Zones","Manhyia","Adum","Kejetia","Asokwa","Nhyiaeso","Bantama","Suame","Bonwire","Citywide"];
const CURRENCIES = {GHS:1, USD:0.067, GBP:0.052, EUR:0.061};

// ─── Real Kumasi Photos ───────────────────────────────────────────────────────
const KUMASI_PHOTOS = {
  manhyiaPalace: "https://heroesofadventure.com/wp-content/uploads/2022/07/manhyia-palace-kumasi-ghana.jpg",
  kejetiaMarket: "https://www.ghanatravel.com/wp-content/uploads/2019/09/kejetia-market-kumasi.jpg",
  kenteWeaving: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Kente_weaving_ghana.jpg/1200px-Kente_weaving_ghana.jpg",
  akwasidae: "https://images.squarespace-cdn.com/content/v1/5b3a3e9af407b48ccd8c8c49/akwasidae-festival-kumasi-ashanti.jpg",
  suame: "https://live.staticflickr.com/7316/9004234952_5bee51c28c_b.jpg",
  hotel: "https://dynamic-media-cdn.tripadvisor.com/media/photo-o/2b/4a/94/b4/oak-plaza-suites-kumasi.jpg",
  chopBar: "https://i.ytimg.com/vi/kHJFJ7e5cds/maxresdefault.jpg",
  kumasi: "https://www.ghanatravel.com/wp-content/uploads/kumasi-aerial-ashanti.jpg",
};

const iStyle = { width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid #ddd",fontSize:"0.88rem",fontFamily:"inherit",outline:"none",boxSizing:"border-box" };
const lStyle = { fontSize:"0.78rem",fontWeight:700,color:C.darkBrown,marginBottom:5,display:"block" };
const btnP = (on=true) => ({ background:on?C.gold:"#ddd",color:on?C.darkBrown:"#aaa",border:"none",borderRadius:30,padding:"12px",fontWeight:900,fontSize:"0.88rem",cursor:on?"pointer":"default",fontFamily:"inherit",width:"100%" });

function Flag({w=50,h=33}) {
  return <svg width={w} height={h} viewBox="0 0 54 36" style={{borderRadius:4,boxShadow:"0 2px 8px rgba(0,0,0,0.4)",border:"1px solid #ffffff33",display:"block"}}>
    <rect x="0" y="0" width="54" height="12" fill="#D4A017"/>
    <rect x="0" y="12" width="54" height="12" fill="#1A1A1A"/>
    <rect x="0" y="24" width="54" height="12" fill="#006400"/>
    <rect x="0" y="11" width="54" height="1.5" fill="white" opacity="0.6"/>
    <rect x="0" y="23.5" width="54" height="1.5" fill="white" opacity="0.6"/>
    <g transform="translate(27,18)">
      <rect x="-8" y="-4.5" width="16" height="3" rx="1.5" fill="#D4A017"/>
      <rect x="-5" y="-1.5" width="3" height="4" rx="1" fill="#D4A017"/>
      <rect x="2" y="-1.5" width="3" height="4" rx="1" fill="#D4A017"/>
      <rect x="-7" y="2.5" width="14" height="2.5" rx="1.2" fill="#D4A017"/>
    </g>
  </svg>;
}

function Stars({rating,size="0.85rem"}) {
  return <span style={{color:C.gold,fontSize:size}}>
    {"★".repeat(Math.floor(rating))}{"☆".repeat(5-Math.floor(rating))}
    <span style={{color:"#888",marginLeft:4,fontSize:"0.75rem"}}>{rating}</span>
  </span>;
}

function WABtn({phone,name,style={}}) {
  const msg = encodeURIComponent(`Hello! I found ${name} on AshantiHub and I'd like to enquire.`);
  return <a href={`https://wa.me/${phone}?text=${msg}`} target="_blank" rel="noopener noreferrer"
    style={{display:"inline-flex",alignItems:"center",gap:5,background:C.whatsapp,color:"white",borderRadius:20,padding:"6px 12px",fontSize:"0.72rem",fontWeight:700,textDecoration:"none",...style}}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
    WhatsApp
  </a>;
}

// ─── Cookie Consent ───────────────────────────────────────────────────────────
function CookieBanner({onAccept,onDecline}) {
  return <div style={{position:"fixed",bottom:0,left:0,right:0,background:C.darkBrown,color:"white",padding:"16px 20px",zIndex:9999,boxShadow:"0 -4px 20px rgba(0,0,0,0.3)"}}>
    <div style={{maxWidth:900,margin:"0 auto",display:"flex",justifyContent:"space-between",alignItems:"center",gap:14,flexWrap:"wrap"}}>
      <div style={{flex:1}}>
        <div style={{fontWeight:800,color:C.gold,marginBottom:4,fontSize:"0.85rem"}}>🍪 AshantiHub uses cookies</div>
        <div style={{fontSize:"0.74rem",opacity:0.85,lineHeight:1.5}}>We use essential cookies to run the platform and analytics cookies to improve your experience. By accepting, you also agree to our <span style={{color:C.gold,textDecoration:"underline",cursor:"pointer"}}>Privacy Policy</span>.</div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onDecline} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.3)",borderRadius:20,padding:"8px 16px",fontSize:"0.74rem",fontWeight:700,cursor:"pointer"}}>Essential Only</button>
        <button onClick={onAccept} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"8px 18px",fontSize:"0.74rem",fontWeight:900,cursor:"pointer"}}>Accept All</button>
      </div>
    </div>
  </div>;
}

// ─── Reviews Modal ────────────────────────────────────────────────────────────
// ─── In-Platform Messaging System ─────────────────────────────────────────────
const MOCK_CONVERSATIONS = [
  {
    id:1, businessId:1, businessName:"Royal Ashanti Lodge", businessImg:"🏰",
    lastMessage:"Thank you for your enquiry! We have availability for your dates.", lastTime:"10:34 AM",
    unread:1, status:"online",
    messages:[
      {id:1,from:"customer",text:"Hello! I'd like to book a Deluxe Suite for June 20–23. Do you have availability?",time:"10:20 AM",read:true},
      {id:2,from:"business",text:"Akwaaba! Yes we have the Deluxe Suite available for those dates. The rate is GHS 750/night. Shall I reserve it for you?",time:"10:28 AM",read:true},
      {id:3,from:"customer",text:"That's perfect! Is breakfast included?",time:"10:30 AM",read:true},
      {id:4,from:"business",text:"Thank you for your enquiry! We have availability for your dates.",time:"10:34 AM",read:false},
    ]
  },
  {
    id:2, businessId:7, businessName:"Kente Palace Weavers", businessImg:"🧶",
    lastMessage:"Your kente cloth is ready for collection!", lastTime:"Yesterday",
    unread:2, status:"offline",
    messages:[
      {id:1,from:"customer",text:"Do you ship internationally to the UK?",time:"Yesterday 2:15 PM",read:true},
      {id:2,from:"business",text:"Yes! We ship via DHL. Delivery takes 5–7 days to UK. We can also arrange custom kente patterns.",time:"Yesterday 3:00 PM",read:true},
      {id:3,from:"customer",text:"Wonderful! I'd like to order 3 yards in blue and gold royal pattern.",time:"Yesterday 3:30 PM",read:true},
      {id:4,from:"business",text:"Your kente cloth is ready for collection!",time:"Yesterday 4:00 PM",read:false},
      {id:5,from:"business",text:"We have also prepared a gift package for you. Total: GHS 450 + GHS 80 shipping.",time:"Yesterday 4:02 PM",read:false},
    ]
  },
  {
    id:3, businessId:3, businessName:"Manhyia Palace Experience", businessImg:"👑",
    lastMessage:"Your tour is confirmed for June 22 at 9:00 AM!", lastTime:"2 days ago",
    unread:0, status:"online",
    messages:[
      {id:1,from:"customer",text:"I'd like to book the Manhyia Palace tour for 2 people on June 22.",time:"2 days ago",read:true},
      {id:2,from:"business",text:"Akwaaba! The Akwasidae Festival tour is our most popular. GHS 80/person includes guide and entrance. Please confirm your names.",time:"2 days ago",read:true},
      {id:3,from:"customer",text:"Emma Thompson and Hans Mueller.",time:"2 days ago",read:true},
      {id:4,from:"business",text:"Your tour is confirmed for June 22 at 9:00 AM!",time:"2 days ago",read:true},
    ]
  },
];

const QUICK_REPLIES = [
  "Is this available?",
  "What are your opening hours?",
  "Do you accept MoMo payment?",
  "Can you deliver?",
  "What is your best price?",
  "I'd like to make a booking",
];

const AUTO_TRANSLATE = {
  "hello":"Akwaaba",
  "thank you":"Medaase",
  "how much":"Εho sen?",
  "available":"Εwɔ hɔ",
  "good":"Ε yɛ fe",
};

function MessagingCenter({ user, onClose, initialBusiness }) {
  const [conversations, setConversations] = useState(MOCK_CONVERSATIONS);
  const [activeConv, setActiveConv] = useState(initialBusiness ? MOCK_CONVERSATIONS.find(c=>c.businessId===initialBusiness?.id) || MOCK_CONVERSATIONS[0] : MOCK_CONVERSATIONS[0]);
  const [newMessage, setNewMessage] = useState("");
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [searchConv, setSearchConv] = useState("");
  const [showNewChat, setShowNewChat] = useState(false);
  const [translating, setTranslating] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [activeConv?.messages]);

  // Mark messages as read when conversation opened
  useEffect(() => {
    if(activeConv) {
      setConversations(convs => convs.map(c =>
        c.id===activeConv.id ? {...c, unread:0, messages:c.messages.map(m=>({...m,read:true}))} : c
      ));
    }
  }, [activeConv?.id]);

  const sendMessage = () => {
    if(!newMessage.trim()) return;
    const msg = { id:Date.now(), from:"customer", text:newMessage, time:new Date().toLocaleTimeString("en-GH",{hour:"2-digit",minute:"2-digit"}), read:true };
    setConversations(convs => convs.map(c =>
      c.id===activeConv.id ? {...c, messages:[...c.messages,msg], lastMessage:newMessage, lastTime:"Just now"} : c
    ));
    setActiveConv(prev => ({...prev, messages:[...prev.messages,msg], lastMessage:newMessage, lastTime:"Just now"}));
    setNewMessage("");
    setShowQuickReplies(false);
    // Simulate business auto-reply after 2 seconds
    setTimeout(() => {
      const autoReplies = [
        "Thank you for your message! We will get back to you shortly. 🙏",
        "Akwaaba! We have received your message and will respond within 30 minutes.",
        "Thank you! A team member will assist you shortly. Meanwhile, feel free to visit our listing on AshantiHub.",
      ];
      const reply = { id:Date.now()+1, from:"business", text:autoReplies[Math.floor(Math.random()*autoReplies.length)], time:new Date().toLocaleTimeString("en-GH",{hour:"2-digit",minute:"2-digit"}), read:false, isAuto:true };
      setConversations(convs => convs.map(c =>
        c.id===activeConv.id ? {...c, messages:[...c.messages,reply], lastMessage:reply.text, lastTime:"Just now"} : c
      ));
      setActiveConv(prev => ({...prev, messages:[...prev.messages,reply]}));
    }, 2000);
  };

  const totalUnread = conversations.reduce((s,c)=>s+c.unread,0);
  const filteredConvs = conversations.filter(c => c.businessName.toLowerCase().includes(searchConv.toLowerCase()));

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:8}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"white",borderRadius:20,width:"100%",maxWidth:780,height:"85vh",display:"flex",overflow:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,0.4)"}}>

        {/* LEFT — Conversation List */}
        <div style={{width:260,borderRight:`1px solid #f0f0f0`,display:"flex",flexDirection:"column",flexShrink:0}}>
          {/* Header */}
          <div style={{background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`,padding:"16px",position:"relative"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{color:C.gold,fontWeight:900,fontSize:"0.9rem"}}>💬 Messages</div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                {totalUnread>0&&<span style={{background:C.kente1,color:"white",borderRadius:"50%",width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.6rem",fontWeight:900}}>{totalUnread}</span>}
                <button onClick={onClose} style={{background:"none",border:"none",color:"white",fontSize:"1.1rem",cursor:"pointer",opacity:0.7}}>✕</button>
              </div>
            </div>
            <input value={searchConv} onChange={e=>setSearchConv(e.target.value)} placeholder="Search conversations..."
              style={{width:"100%",padding:"7px 12px",borderRadius:20,border:"none",fontSize:"0.75rem",outline:"none",fontFamily:"inherit",background:"rgba(255,255,255,0.15)",color:"white"}}/>
          </div>

          {/* New Chat Button */}
          <button onClick={()=>setShowNewChat(true)}
            style={{margin:"10px 12px 4px",background:`${C.gold}15`,color:C.deepGold,border:`1.5px dashed ${C.gold}`,borderRadius:12,padding:"9px",fontSize:"0.74rem",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            ✉️ Start New Conversation
          </button>

          {/* Conversation list */}
          <div style={{flex:1,overflowY:"auto"}}>
            {filteredConvs.length===0&&(
              <div style={{padding:"20px",textAlign:"center",color:"#aaa",fontSize:"0.76rem"}}>No conversations found</div>
            )}
            {filteredConvs.map(conv=>(
              <div key={conv.id} onClick={()=>setActiveConv(conv)}
                style={{padding:"12px 14px",cursor:"pointer",borderBottom:"1px solid #f5f5f5",background:activeConv?.id===conv.id?`${C.gold}12`:"white",transition:"background 0.2s"}}
                onMouseEnter={e=>{ if(activeConv?.id!==conv.id) e.currentTarget.style.background="#fafafa"; }}
                onMouseLeave={e=>{ if(activeConv?.id!==conv.id) e.currentTarget.style.background="white"; }}>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  {/* Avatar */}
                  <div style={{position:"relative",flexShrink:0}}>
                    <div style={{width:44,height:44,borderRadius:"50%",background:`${C.gold}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.4rem",border:activeConv?.id===conv.id?`2px solid ${C.gold}`:"2px solid transparent"}}>
                      {conv.businessImg}
                    </div>
                    <div style={{position:"absolute",bottom:1,right:1,width:11,height:11,borderRadius:"50%",background:conv.status==="online"?"#22c55e":"#aaa",border:"2px solid white"}}/>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                      <span style={{fontWeight:800,fontSize:"0.78rem",color:C.darkBrown,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{conv.businessName}</span>
                      <span style={{fontSize:"0.6rem",color:"#aaa",flexShrink:0,marginLeft:4}}>{conv.lastTime}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:"0.68rem",color:"#888",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{conv.lastMessage}</span>
                      {conv.unread>0&&<span style={{background:C.kente2,color:"white",borderRadius:"50%",width:18,height:18,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.58rem",fontWeight:900,flexShrink:0,marginLeft:4}}>{conv.unread}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* User info */}
          <div style={{padding:"10px 14px",borderTop:"1px solid #f0f0f0",background:"#fafafa",display:"flex",gap:8,alignItems:"center"}}>
            <div style={{width:30,height:30,borderRadius:"50%",background:C.gold,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,color:C.darkBrown,fontSize:"0.75rem"}}>
              {user?.fullName?.[0]?.toUpperCase()||"?"}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:"0.72rem",color:C.darkBrown,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user?.fullName||"Guest"}</div>
              <div style={{fontSize:"0.6rem",color:"#22c55e",fontWeight:600}}>● Online</div>
            </div>
          </div>
        </div>

        {/* RIGHT — Chat Window */}
        <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
          {activeConv ? (
            <>
              {/* Chat Header */}
              <div style={{padding:"14px 18px",borderBottom:"1px solid #f0f0f0",display:"flex",alignItems:"center",gap:12,background:"white"}}>
                <div style={{position:"relative"}}>
                  <div style={{width:42,height:42,borderRadius:"50%",background:`${C.gold}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.3rem"}}>{activeConv.businessImg}</div>
                  <div style={{position:"absolute",bottom:1,right:1,width:10,height:10,borderRadius:"50%",background:activeConv.status==="online"?"#22c55e":"#aaa",border:"2px solid white"}}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:900,fontSize:"0.88rem",color:C.darkBrown}}>{activeConv.businessName}</div>
                  <div style={{fontSize:"0.65rem",color:activeConv.status==="online"?"#22c55e":"#aaa",fontWeight:600}}>
                    {activeConv.status==="online"?"● Online now":"● Offline — usually replies within 1 hour"}
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  {/* WhatsApp fallback */}
                  <a href={`https://wa.me/233244000000?text=${encodeURIComponent(`Hello ${activeConv.businessName}! I found you on AshantiHub.`)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{background:C.whatsapp,color:"white",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,textDecoration:"none",display:"flex",alignItems:"center",gap:4}}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp
                  </a>
                  <button onClick={onClose} style={{background:"#f0f0f0",border:"none",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#666",fontSize:"0.9rem"}}>✕</button>
                </div>
              </div>

              {/* Messages */}
              <div style={{flex:1,overflowY:"auto",padding:"16px",display:"flex",flexDirection:"column",gap:10,background:"#f8f9fa"}}>
                {/* Date divider */}
                <div style={{textAlign:"center",margin:"4px 0"}}>
                  <span style={{background:"#e0e0e0",color:"#888",borderRadius:20,padding:"3px 12px",fontSize:"0.62rem",fontWeight:600}}>Today</span>
                </div>

                {activeConv.messages.map(msg=>(
                  <div key={msg.id} style={{display:"flex",justifyContent:msg.from==="customer"?"flex-end":"flex-start",alignItems:"flex-end",gap:8}}>
                    {msg.from==="business"&&(
                      <div style={{width:28,height:28,borderRadius:"50%",background:`${C.gold}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.9rem",flexShrink:0}}>{activeConv.businessImg}</div>
                    )}
                    <div style={{maxWidth:"72%"}}>
                      <div style={{
                        background:msg.from==="customer"?`linear-gradient(135deg,${C.kente3},${C.darkBrown})`:"white",
                        color:msg.from==="customer"?"white":C.darkBrown,
                        borderRadius:msg.from==="customer"?"18px 18px 4px 18px":"18px 18px 18px 4px",
                        padding:"10px 14px",
                        fontSize:"0.78rem",
                        lineHeight:1.5,
                        boxShadow:"0 1px 4px rgba(0,0,0,0.1)",
                      }}>
                        {msg.isAuto&&<div style={{fontSize:"0.58rem",opacity:0.7,marginBottom:3}}>🤖 Auto-reply</div>}
                        {msg.text}
                      </div>
                      <div style={{fontSize:"0.58rem",color:"#aaa",marginTop:3,textAlign:msg.from==="customer"?"right":"left",display:"flex",gap:4,justifyContent:msg.from==="customer"?"flex-end":"flex-start",alignItems:"center"}}>
                        {msg.time}
                        {msg.from==="customer"&&<span style={{color:msg.read?"#22c55e":"#aaa"}}>{msg.read?"✓✓":"✓"}</span>}
                      </div>
                    </div>
                    {msg.from==="customer"&&(
                      <div style={{width:28,height:28,borderRadius:"50%",background:C.gold,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,color:C.darkBrown,fontSize:"0.7rem",flexShrink:0}}>
                        {user?.fullName?.[0]?.toUpperCase()||"U"}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef}/>
              </div>

              {/* Quick Replies */}
              {showQuickReplies&&(
                <div style={{padding:"8px 14px",borderTop:"1px solid #f0f0f0",display:"flex",gap:6,flexWrap:"wrap",background:"white"}}>
                  {QUICK_REPLIES.map(r=>(
                    <button key={r} onClick={()=>{setNewMessage(r);setShowQuickReplies(false);inputRef.current?.focus();}}
                      style={{background:`${C.gold}15`,color:C.deepGold,border:`1px solid ${C.gold}33`,borderRadius:20,padding:"4px 10px",fontSize:"0.68rem",fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      {r}
                    </button>
                  ))}
                </div>
              )}

              {/* Message Input */}
              <div style={{padding:"12px 14px",borderTop:"1px solid #f0f0f0",background:"white"}}>
                {!user&&(
                  <div style={{background:`${C.kente1}12`,border:`1px solid ${C.kente1}33`,borderRadius:10,padding:"8px 12px",marginBottom:10,fontSize:"0.72rem",color:C.kente1,fontWeight:600,textAlign:"center"}}>
                    ⚠️ Sign in to send messages to businesses
                  </div>
                )}
                <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
                  {/* Emoji/Quick Reply toggle */}
                  <button onClick={()=>setShowQuickReplies(q=>!q)}
                    style={{background:showQuickReplies?`${C.gold}20`:"#f0f0f0",border:"none",borderRadius:"50%",width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"1rem",flexShrink:0}}>
                    ⚡
                  </button>
                  <div style={{flex:1,background:"#f5f5f5",borderRadius:20,padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}>
                    <input
                      ref={inputRef}
                      value={newMessage}
                      onChange={e=>setNewMessage(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(user)sendMessage();}}}
                      placeholder={user?"Type a message...":"Sign in to message businesses"}
                      disabled={!user}
                      style={{flex:1,border:"none",background:"transparent",outline:"none",fontSize:"0.82rem",fontFamily:"inherit",color:C.darkBrown}}/>
                    {newMessage&&(
                      <button onClick={()=>setNewMessage("")} style={{background:"none",border:"none",color:"#aaa",cursor:"pointer",fontSize:"0.9rem",padding:0}}>✕</button>
                    )}
                  </div>
                  <button
                    onClick={()=>{if(user)sendMessage();}}
                    disabled={!newMessage.trim()||!user}
                    style={{background:newMessage.trim()&&user?C.kente2:"#ddd",color:"white",border:"none",borderRadius:"50%",width:38,height:38,display:"flex",alignItems:"center",justifyContent:"center",cursor:newMessage.trim()&&user?"pointer":"default",fontSize:"1rem",flexShrink:0,transition:"background 0.2s"}}>
                    ➤
                  </button>
                </div>
                <div style={{fontSize:"0.6rem",color:"#aaa",marginTop:6,textAlign:"center"}}>
                  💡 Messages are stored on AshantiHub • Also chat on <span style={{color:C.whatsapp,fontWeight:700}}>WhatsApp</span>
                </div>
              </div>
            </>
          ) : (
            <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:"#aaa"}}>
              <div style={{fontSize:"3rem"}}>💬</div>
              <div style={{fontWeight:700,fontSize:"0.88rem",color:C.darkBrown}}>Your Messages</div>
              <div style={{fontSize:"0.76rem",textAlign:"center",maxWidth:240,lineHeight:1.6}}>Select a conversation or start a new one to message a Kumasi business directly</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewsModal({item,user,onClose,onSubmit}) {
  const [newRating,setNewRating]=useState(0);
  const [newText,setNewText]=useState("");
  const [hover,setHover]=useState(0);
  const [submitted,setSubmitted]=useState(false);
  const reviews = MOCK_REVIEWS[item.id] || [];

  const handleSubmit = () => {
    if(!user){alert("Please sign in to leave a review");return;}
    if(!newRating||!newText.trim())return;
    onSubmit({author:user.fullName,rating:newRating,text:newText,date:new Date().toISOString().split("T")[0],helpful:0});
    setSubmitted(true);
  };

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:"white",borderRadius:22,width:"100%",maxWidth:520,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
      <div style={{background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`,borderRadius:"22px 22px 0 0",padding:"20px 24px",position:"relative"}}>
        <button onClick={onClose} style={{position:"absolute",top:14,right:16,background:"none",border:"none",color:"white",fontSize:"1.4rem",cursor:"pointer",opacity:0.7}}>✕</button>
        <div style={{color:C.gold,fontWeight:900,fontSize:"1rem",marginBottom:4}}>{item.name}</div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <Stars rating={item.rating}/>
          <span style={{color:"white",fontSize:"0.78rem",opacity:0.8}}>{item.reviews} reviews</span>
        </div>
      </div>
      <div style={{padding:"20px 24px"}}>
        {/* Write Review */}
        {!submitted ? (
          <div style={{background:`${C.gold}12`,border:`1.5px solid ${C.gold}33`,borderRadius:14,padding:"16px",marginBottom:20}}>
            <div style={{fontWeight:800,color:C.darkBrown,marginBottom:10,fontSize:"0.85rem"}}>✍️ Write a Review</div>
            <div style={{display:"flex",gap:4,marginBottom:12}}>
              {[1,2,3,4,5].map(s=>(
                <span key={s} onClick={()=>setNewRating(s)} onMouseEnter={()=>setHover(s)} onMouseLeave={()=>setHover(0)}
                  style={{fontSize:"1.8rem",cursor:"pointer",color:(hover||newRating)>=s?C.gold:"#ddd",transition:"color 0.1s"}}>★</span>
              ))}
            </div>
            <textarea value={newText} onChange={e=>setNewText(e.target.value)} placeholder="Share your experience..."
              style={{...iStyle,height:80,resize:"vertical",marginBottom:10}}/>
            <button onClick={handleSubmit} style={{...btnP(!!newRating&&newText.length>10),padding:"9px"}}>Submit Review</button>
            {!user&&<div style={{fontSize:"0.7rem",color:"#aaa",marginTop:6,textAlign:"center"}}>Sign in to leave a review</div>}
          </div>
        ) : (
          <div style={{background:"#f0fdf4",border:"1.5px solid #22c55e44",borderRadius:14,padding:"16px",marginBottom:20,textAlign:"center"}}>
            <div style={{fontSize:"2rem",marginBottom:6}}>🎉</div>
            <div style={{fontWeight:800,color:"#22c55e"}}>Review submitted! Thank you.</div>
          </div>
        )}
        {/* Existing Reviews */}
        <div style={{fontWeight:800,color:C.darkBrown,marginBottom:12,fontSize:"0.85rem"}}>Customer Reviews ({reviews.length})</div>
        {reviews.length===0&&<div style={{color:"#aaa",fontSize:"0.8rem",textAlign:"center",padding:"20px"}}>No reviews yet. Be the first!</div>}
        {reviews.map(r=>(
          <div key={r.id} style={{borderBottom:"1px solid #f0f0f0",paddingBottom:14,marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:30,height:30,borderRadius:"50%",background:`${C.gold}22`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,color:C.deepGold,fontSize:"0.8rem"}}>{r.author[0]}</div>
                <div>
                  <div style={{fontWeight:700,fontSize:"0.8rem"}}>{r.author} {r.country}</div>
                  <Stars rating={r.rating} size="0.7rem"/>
                </div>
              </div>
              <div style={{fontSize:"0.65rem",color:"#aaa"}}>{r.date}</div>
            </div>
            <div style={{fontSize:"0.78rem",color:"#444",lineHeight:1.6,marginBottom:6}}>{r.text}</div>
            <div style={{fontSize:"0.65rem",color:"#aaa"}}>👍 {r.helpful} found this helpful</div>
          </div>
        ))}
      </div>
    </div>
  </div>;
}

// ─── MoMo Payment Modal ───────────────────────────────────────────────────────
function MoMoModal({item,user,onClose}) {
  const [step,setStep]=useState(1);
  const [network,setNetwork]=useState("MTN");
  const [momoNum,setMomoNum]=useState(user?.phone||"");
  const [pin,setPin]=useState("");
  const [processing,setProcessing]=useState(false);
  const [done,setDone]=useState(false);

  const pay = () => {
    if(!momoNum||momoNum.length<10)return;
    setProcessing(true);
    setTimeout(()=>{setProcessing(false);setDone(true);},2500);
  };

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:"white",borderRadius:22,width:"100%",maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
      <div style={{background:`linear-gradient(135deg,${C.darkBrown},${C.kente2})`,borderRadius:"22px 22px 0 0",padding:"20px 24px",position:"relative"}}>
        <button onClick={onClose} style={{position:"absolute",top:14,right:16,background:"none",border:"none",color:"white",fontSize:"1.4rem",cursor:"pointer",opacity:0.7}}>✕</button>
        <div style={{color:C.gold,fontWeight:900,fontSize:"0.95rem"}}>💰 Mobile Money Payment</div>
        <div style={{color:"white",fontSize:"0.78rem",opacity:0.85,marginTop:4}}>{item.name}</div>
      </div>
      <div style={{padding:"22px 24px"}}>
        {done ? (
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:"3.5rem",marginBottom:12}}>✅</div>
            <div style={{fontWeight:900,color:C.kente2,fontSize:"1rem",marginBottom:6}}>Payment Successful!</div>
            <div style={{fontSize:"0.78rem",color:"#555",lineHeight:1.6,marginBottom:16}}>Your booking for <strong>{item.name}</strong> is confirmed. A receipt has been sent to your WhatsApp.</div>
            <div style={{background:`${C.gold}15`,border:`1px solid ${C.gold}33`,borderRadius:12,padding:"12px",fontSize:"0.74rem",color:"#444",marginBottom:16,lineHeight:1.7}}>
              <div>📋 <strong>Booking Ref:</strong> AH-{Math.floor(Math.random()*90000+10000)}</div>
              <div>💳 <strong>Network:</strong> {network} MoMo</div>
              <div>📱 <strong>Number:</strong> {momoNum}</div>
            </div>
            <button onClick={onClose} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:30,padding:"10px 24px",fontWeight:900,cursor:"pointer",fontFamily:"inherit"}}>Done</button>
          </div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {/* Network selector */}
            <div>
              <label style={lStyle}>Select Network</label>
              <div style={{display:"flex",gap:8}}>
                {["MTN","Vodafone","AirtelTigo"].map(n=>(
                  <button key={n} onClick={()=>setNetwork(n)} style={{flex:1,background:network===n?(n==="MTN"?"#FCD116":n==="Vodafone"?"#e31837":"#e87722"):"#f0f0f0",color:network===n?"white":C.darkBrown,border:"none",borderRadius:12,padding:"10px 6px",fontWeight:800,fontSize:"0.72rem",cursor:"pointer"}}>{n}</button>
                ))}
              </div>
            </div>
            {/* Amount */}
            <div style={{background:`${C.gold}12`,borderRadius:12,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:"0.78rem",color:"#555"}}>Amount to Pay</div>
              <div style={{fontWeight:900,color:C.darkBrown,fontSize:"1.1rem"}}>{item.price}</div>
            </div>
            {/* MoMo Number */}
            <div>
              <label style={lStyle}>📱 {network} MoMo Number</label>
              <input style={iStyle} placeholder="0244 000 000" value={momoNum} onChange={e=>setMomoNum(e.target.value)}/>
            </div>
            <div style={{background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:10,padding:"10px 12px",fontSize:"0.72rem",color:"#0369a1",lineHeight:1.6}}>
              📲 You will receive a <strong>prompt on your phone</strong> to approve this payment. Enter your {network} MoMo PIN when prompted.
            </div>
            <button onClick={pay} style={{...btnP(momoNum.length>=10),background:processing?"#aaa":C.kente2,color:"white"}}>
              {processing?"⏳ Processing...":"Pay Now →"}
            </button>
            <div style={{fontSize:"0.68rem",color:"#aaa",textAlign:"center"}}>🔒 Secured by AshantiHub • Powered by Hubtel</div>
          </div>
        )}
      </div>
    </div>
  </div>;
}

// ─── Business Card ─────────────────────────────────────────────────────────────
export function Card({item,accentColor,onWhatsApp,user,favourites,onFavourite,currency,onMessage}) {
  const [showReviews,setShowReviews]=useState(false);
  const [showPay,setShowPay]=useState(false);
  const [photoIdx,setPhotoIdx]=useState(0);
  const isFav = favourites.includes(item.id);

  const displayPrice = () => {
    const amount = parseFloat(item.price_amount)||0;
    if(currency==="GHS")return `GHS ${item.price_amount}${item.price_unit||""}`;
    const rate = CURRENCIES[currency];
    return `${currency} ${(amount*rate).toFixed(0)}${item.price_unit||""}`;
  };

  return <>
    {showReviews&&<ReviewsModal item={item} user={user} onClose={()=>setShowReviews(false)} onSubmit={()=>{}}/>}
    {showPay&&<MoMoModal item={item} user={user} onClose={()=>setShowPay(false)}/>}
    <div style={{background:"white",borderRadius:16,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.10)",border:`2px solid ${accentColor}22`,transition:"transform 0.2s"}}
      onMouseEnter={e=>e.currentTarget.style.transform="translateY(-4px)"}
      onMouseLeave={e=>e.currentTarget.style.transform=""}>
      {/* Photo strip */}
      <div style={{height:140,position:"relative",overflow:"hidden",background:`linear-gradient(135deg,${accentColor}22,${accentColor}44)`}}>
        {/* Real photo if available, fallback to category emoji */}
        {item.main_photo ? (
          <img src={item.main_photo} alt={item.name}
            style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
            onError={e=>{e.target.style.display="none";e.target.nextSibling.style.display="flex";}}
          />
        ) : null}
        {/* Emoji fallback */}
        <div style={{display:item.main_photo?"none":"flex",width:"100%",height:"100%",alignItems:"center",justifyContent:"center",fontSize:"3rem",position:"absolute",inset:0}}>
          {item.category?.icon}
        </div>
        {/* Gradient overlay on photos */}
        {item.main_photo&&<div style={{position:"absolute",inset:0,background:"linear-gradient(to bottom,transparent 40%,rgba(0,0,0,0.4))"}}/>}
        {/* Photo thumbnails */}
        {item.photos?.length>1&&(
          <div style={{position:"absolute",bottom:6,left:"50%",transform:"translateX(-50%)",display:"flex",gap:4,zIndex:2}}>
            {item.photos.map((p,i)=>(
              <img key={p.id} src={p.image} alt="" onClick={()=>setPhotoIdx(i)}
                style={{width:16,height:16,borderRadius:"50%",objectFit:"cover",border:photoIdx===i?"2px solid white":"1px solid rgba(255,255,255,0.6)",cursor:"pointer"}}/>
            ))}
          </div>
        )}
        <span style={{position:"absolute",top:8,right:8,background:accentColor,color:"white",fontSize:"0.6rem",fontWeight:700,padding:"2px 7px",borderRadius:20,zIndex:2}}>{item.tag}</span>
        <button onClick={()=>onFavourite(item.id)} style={{position:"absolute",top:8,left:8,background:"rgba(255,255,255,0.9)",border:"none",borderRadius:"50%",width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.9rem",zIndex:2}}>
          {isFav?"❤️":"🤍"}
        </button>
        <button onClick={()=>{if(navigator.share)navigator.share({title:item.name,text:item.description,url:window.location.href});else navigator.clipboard?.writeText(`Check out ${item.name} on AshantiHub!`);}}
          style={{position:"absolute",bottom:8,right:8,background:"rgba(255,255,255,0.9)",border:"none",borderRadius:"50%",width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.8rem",zIndex:2}}>
          📤
        </button>
      </div>
      <div style={{padding:"12px 14px"}}>
        <div style={{fontWeight:700,fontSize:"0.9rem",color:C.black,marginBottom:2}}>{item.name}</div>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
          <Stars rating={item.rating}/>
          <button onClick={()=>setShowReviews(true)} style={{background:"none",border:"none",color:accentColor,fontSize:"0.68rem",cursor:"pointer",fontWeight:600,padding:0}}>
            ({item.reviews} reviews)
          </button>
        </div>
        <div style={{fontSize:"0.68rem",color:"#888",marginBottom:4}}>📍 {item.zone?.name}</div>
        <div style={{color:"#555",fontSize:"0.75rem",marginBottom:10,lineHeight:1.4}}>{item.description}</div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={{fontWeight:800,color:accentColor,fontSize:"0.8rem"}}>{displayPrice()}</span>
          <div style={{display:"flex",gap:5}}>
            <button onClick={()=>{ if(onMessage) onMessage(item); }}
              style={{background:`${C.kente3}15`,color:C.kente3,border:`1px solid ${C.kente3}33`,borderRadius:20,padding:"5px 10px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:3}}>
              💬 Message
            </button>
            <WABtn phone={item.contact_phone} name={item.name} style={{fontSize:"0.68rem",padding:"5px 10px"}}/>
            <button onClick={()=>setShowPay(true)} style={{background:accentColor,color:"white",border:"none",borderRadius:20,padding:"5px 10px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer"}}>
              💳 Pay
            </button>
          </div>
        </div>
      </div>
    </div>
  </>;
}

// ─── Map View ─────────────────────────────────────────────────────────────────
export function MapView({listings}) {
  const filtered = listings.filter(i=>i.lat && i.lng);

  return <div style={{background:"white",borderRadius:16,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.1)",marginBottom:20}}>
    <div style={{background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`,padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{color:C.gold,fontWeight:800,fontSize:"0.88rem"}}>🗺️ Businesses on Map — Kumasi</div>
      <span style={{color:"white",fontSize:"0.7rem",opacity:0.8}}>{filtered.length} locations</span>
    </div>
    {/* Simulated map grid */}
    <div style={{position:"relative",height:280,background:"#e8f4e8",overflow:"hidden"}}>
      {/* Road grid simulation */}
      <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:0.3}}>
        {[60,120,180,240].map(y=><line key={y} x1="0" y1={y} x2="800" y2={y} stroke="#666" strokeWidth="1.5"/>)}
        {[80,160,240,320,400,480].map(x=><line key={x} x1={x} y1="0" x2={x} y2="400" stroke="#666" strokeWidth="1.5"/>)}
        <text x="140" y="25" fontSize="11" fill="#555" fontWeight="bold">MANHYIA</text>
        <text x="200" y="145" fontSize="11" fill="#555" fontWeight="bold">ADUM</text>
        <text x="60" y="200" fontSize="10" fill="#555">KEJETIA</text>
        <text x="320" y="200" fontSize="10" fill="#555">NHYIAESO</text>
        <text x="150" y="255" fontSize="10" fill="#555">BANTAMA</text>
        <text x="40" y="265" fontSize="9" fill="#555">SUAME</text>
      </svg>
      {/* Business pins */}
      {filtered.slice(0,12).map((item,i)=>{
        const x = 40 + ((parseFloat(item.lng)+1.63)*2000)%480;
        const y = 20 + ((parseFloat(item.lat)-6.68)*3000)%220;
        const catColor = item.category?.color||C.gold;
        return <div key={item.id} style={{position:"absolute",left:`${Math.min(Math.max(x,20),460)}px`,top:`${Math.min(Math.max(y,10),240)}px`,zIndex:10}}>
          <div style={{background:catColor,color:"white",borderRadius:"50% 50% 50% 0",width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.75rem",boxShadow:"0 2px 8px rgba(0,0,0,0.3)",transform:"rotate(-45deg)",cursor:"pointer"}}
            title={item.name}>
            <span style={{transform:"rotate(45deg)"}}>{item.category?.icon}</span>
          </div>
          <span style={{position:"absolute",width:1,height:1,padding:0,margin:-1,overflow:"hidden",clip:"rect(0,0,0,0)",whiteSpace:"nowrap",border:0}}>{item.name}</span>
        </div>;
      })}
      {/* Manhyia Palace marker */}
      <div style={{position:"absolute",left:"42%",top:"12%",zIndex:20}}>
        <div style={{background:C.gold,color:C.darkBrown,borderRadius:8,padding:"3px 8px",fontSize:"0.65rem",fontWeight:900,boxShadow:"0 2px 8px rgba(0,0,0,0.3)",whiteSpace:"nowrap"}}>👑 Manhyia Palace</div>
      </div>
      <div style={{position:"absolute",bottom:8,right:8,background:"rgba(255,255,255,0.9)",borderRadius:8,padding:"4px 8px",fontSize:"0.6rem",color:"#555"}}>
        📍 Kumasi, Ghana
      </div>
    </div>
    {/* Legend — derived from the categories actually present among the plotted pins (no more global CATEGORIES lookup) */}
    <div style={{padding:"10px 16px",display:"flex",gap:12,flexWrap:"wrap",borderTop:"1px solid #f0f0f0"}}>
      {Array.from(new Map(filtered.map(i=>[i.category?.slug, i.category]).filter(([slug])=>slug)).values()).slice(0,7).map(cat=>(
        <div key={cat.slug} style={{display:"flex",alignItems:"center",gap:4,fontSize:"0.65rem",color:"#555"}}>
          <div style={{width:10,height:10,borderRadius:"50%",background:cat.color}}/>
          {cat.label}
        </div>
      ))}
    </div>
  </div>;
}

// ─── Referral Modal ───────────────────────────────────────────────────────────
function ReferralModal({user,onClose}) {
  const code = user?`AH-${user.fullName?.slice(0,3).toUpperCase()}${Math.floor(Math.random()*1000)}`:"AH-GUEST";
  const [copied,setCopied]=useState(false);
  const copy = ()=>{navigator.clipboard?.writeText(code);setCopied(true);setTimeout(()=>setCopied(false),2000);};

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:"white",borderRadius:22,width:"100%",maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
      <div style={{background:`linear-gradient(135deg,${C.kente1},${C.kente3})`,borderRadius:"22px 22px 0 0",padding:"24px",textAlign:"center",position:"relative"}}>
        <button onClick={onClose} style={{position:"absolute",top:14,right:16,background:"none",border:"none",color:"white",fontSize:"1.4rem",cursor:"pointer",opacity:0.7}}>✕</button>
        <div style={{fontSize:"2.5rem",marginBottom:8}}>🎁</div>
        <div style={{color:C.gold,fontWeight:900,fontSize:"1.1rem",marginBottom:4}}>Refer a Friend</div>
        <div style={{color:"white",fontSize:"0.78rem",opacity:0.85}}>Earn GHS 10 credit for every friend who signs up</div>
      </div>
      <div style={{padding:"24px"}}>
        <div style={{background:`${C.gold}15`,border:`1.5px solid ${C.gold}33`,borderRadius:14,padding:"16px",marginBottom:16,textAlign:"center"}}>
          <div style={{fontSize:"0.72rem",color:"#888",marginBottom:6}}>Your Referral Code</div>
          <div style={{fontWeight:900,fontSize:"1.4rem",color:C.darkBrown,letterSpacing:3,marginBottom:10}}>{code}</div>
          <button onClick={copy} style={{background:copied?C.kente2:C.gold,color:copied?"white":C.darkBrown,border:"none",borderRadius:20,padding:"8px 20px",fontWeight:800,cursor:"pointer",fontFamily:"inherit",fontSize:"0.78rem"}}>
            {copied?"✓ Copied!":"Copy Code"}
          </button>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
          {[["👥","Your friend signs up with your code","They get GHS 5 welcome credit"],["💰","They make their first booking","You earn GHS 10 MoMo credit"],["🔁","No limit on referrals","Keep earning with every friend"]].map(([icon,step,reward])=>(
            <div key={step} style={{display:"flex",gap:12,alignItems:"flex-start",background:"#f9f9f9",borderRadius:10,padding:"10px 12px"}}>
              <span style={{fontSize:"1.2rem"}}>{icon}</span>
              <div>
                <div style={{fontWeight:700,fontSize:"0.78rem",color:C.darkBrown}}>{step}</div>
                <div style={{fontSize:"0.68rem",color:C.kente2,fontWeight:600}}>{reward}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:8}}>
          <a href={`https://wa.me/?text=${encodeURIComponent(`Join me on AshantiHub — the best platform for Kumasi and the Ashanti Region! Use my code ${code} when you sign up and get GHS 5 off your first booking. 🇬🇭👑 ashantihub.com`)}`}
            target="_blank" rel="noopener noreferrer"
            style={{flex:1,background:C.whatsapp,color:"white",border:"none",borderRadius:20,padding:"10px",fontWeight:700,textDecoration:"none",textAlign:"center",fontSize:"0.78rem"}}>
            📱 Share on WhatsApp
          </a>
          <a href={`https://www.facebook.com/sharer/sharer.php?u=ashantihub.com&quote=Join AshantiHub with code ${code}`}
            target="_blank" rel="noopener noreferrer"
            style={{flex:1,background:"#1877f2",color:"white",border:"none",borderRadius:20,padding:"10px",fontWeight:700,textDecoration:"none",textAlign:"center",fontSize:"0.78rem"}}>
            📘 Share on Facebook
          </a>
        </div>
      </div>
    </div>
  </div>;
}

// ─── Notifications Panel ──────────────────────────────────────────────────────
function NotificationsPanel({user,onClose}) {
  const notifs = user ? [
    {id:1,icon:"📅",title:"Akwasidae Festival in 15 days!",body:"Book your hotel and tours now before they fill up.",time:"Just now",unread:true},
    {id:2,icon:"✅",title:"Booking Confirmed",body:"Your enquiry to Royal Ashanti Lodge has been received.",time:"2 hours ago",unread:true},
    {id:3,icon:"🎁",title:"You have GHS 10 referral credit",body:"Your friend signed up using your referral code.",time:"Yesterday",unread:false},
    {id:4,icon:"💬",title:"New deal from Afia's Kitchen",body:"20% off fufu and light soup this weekend only!",time:"2 days ago",unread:false},
  ] : [];

  return <div style={{position:"fixed",inset:0,zIndex:999}} onClick={onClose}>
    <div style={{position:"absolute",top:65,right:16,background:"white",borderRadius:16,width:320,maxHeight:400,overflowY:"auto",boxShadow:"0 8px 40px rgba(0,0,0,0.2)",border:"1px solid #f0f0f0"}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"14px 16px",borderBottom:"1px solid #f0f0f0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontWeight:800,color:C.darkBrown,fontSize:"0.88rem"}}>🔔 Notifications</div>
        <span style={{background:`${C.kente1}20`,color:C.kente1,borderRadius:20,padding:"2px 8px",fontSize:"0.62rem",fontWeight:800}}>{notifs.filter(n=>n.unread).length} new</span>
      </div>
      {!user&&<div style={{padding:"20px",textAlign:"center",color:"#aaa",fontSize:"0.78rem"}}>Sign in to see your notifications</div>}
      {notifs.map(n=>(
        <div key={n.id} style={{padding:"12px 16px",borderBottom:"1px solid #f9f9f9",background:n.unread?`${C.gold}08`:"white",display:"flex",gap:10,alignItems:"flex-start"}}>
          <span style={{fontSize:"1.2rem",flexShrink:0}}>{n.icon}</span>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:"0.78rem",color:C.darkBrown,marginBottom:2}}>{n.title}</div>
            <div style={{fontSize:"0.7rem",color:"#666",lineHeight:1.4,marginBottom:2}}>{n.body}</div>
            <div style={{fontSize:"0.62rem",color:"#aaa"}}>{n.time}</div>
          </div>
          {n.unread&&<div style={{width:8,height:8,borderRadius:"50%",background:C.kente1,flexShrink:0,marginTop:4}}/>}
        </div>
      ))}
    </div>
  </div>;
}

// ─── Language Toggle ──────────────────────────────────────────────────────────
const TRANSLATIONS = {
  en:{search:"Search businesses...",welcome:"Discover Kumasi — All in One Place",tagline:"Hotels, tours, food, crafts, transport & more — The Marketplace of Ashanti.",signup:"Create Free Account",login:"Sign In",register:"Register Your Business",categories:"Categories",bookNow:"Book",pay:"Pay"},
  tw:{search:"Hwehwɛ adwuma...",welcome:"Hu Kumasi — Baako mu",tagline:"Ahemfie, akwantuo, aduane, nwonwa, kwan & bio — Ashanti Dwamfo.",signup:"Yɛ Account Foforo",login:"Wo ho hyɛ mu",register:"Kyerɛ Wo Adwuma",categories:"Nkyereɛ",bookNow:"Bɔ",pay:"Tua"},
};

// ─── Main App ─────────────────────────────────────────────────────────────────
// ─── Mock Data for Admin ──────────────────────────────────────────────────────
const mockCustomers = [
  {id:1,name:"James Osei",email:"james@gmail.com",phone:"0244111001",nationality:"Ghanaian",city:"Accra",country:"Ghana",purpose:"Business",visitDate:"2026-06-10",newsletter:true,smsUpdates:true,joined:"2026-05-20",spent:340},
  {id:2,name:"Emma Thompson",email:"emma@outlook.com",phone:"0244111002",nationality:"British",city:"London",country:"UK",purpose:"Tourism / Holiday",visitDate:"2026-06-15",newsletter:true,smsUpdates:false,joined:"2026-05-22",spent:820},
  {id:3,name:"Kwame Asante",email:"kwame@yahoo.com",phone:"0244111003",nationality:"Ghanaian",city:"Kumasi",country:"Ghana",purpose:"Cultural Visit",visitDate:"2026-06-08",newsletter:false,smsUpdates:true,joined:"2026-05-25",spent:150},
  {id:4,name:"Hans Mueller",email:"hans@web.de",phone:"0244111004",nationality:"German",city:"Berlin",country:"Germany",purpose:"Attending Festival",visitDate:"2026-06-22",newsletter:true,smsUpdates:true,joined:"2026-05-28",spent:1240},
  {id:5,name:"Abena Mensah",email:"abena@gmail.com",phone:"0244111005",nationality:"Ghanaian",city:"Takoradi",country:"Ghana",purpose:"Family Visit",visitDate:"2026-06-12",newsletter:true,smsUpdates:true,joined:"2026-05-30",spent:280},
  {id:6,name:"Sophie Dubois",email:"sophie@free.fr",phone:"0244111008",nationality:"French",city:"Paris",country:"France",purpose:"Tourism / Holiday",visitDate:"2026-06-25",newsletter:true,smsUpdates:true,joined:"2026-06-03",spent:970},
];

const mockBusinesses = [
  {id:1,name:"Royal Ashanti Lodge",category:"Hotels",owner:"Nana Prempeh",phone:"233244000001",location:"Manhyia",status:"Active",joined:"2026-04-01",revenue:4500},
  {id:2,name:"Afia's Kitchen",category:"Food",owner:"Afia Mensah",phone:"233244000007",location:"Adum",status:"Active",joined:"2026-04-05",revenue:1200},
  {id:3,name:"Kente Palace Weavers",category:"Crafts",owner:"Kweku Asare",phone:"233244000010",location:"Bonwire",status:"Active",joined:"2026-04-10",revenue:3200},
  {id:4,name:"Kofi Auto Works",category:"Suame Magazine",owner:"Kofi Agyei",phone:"233244000028",location:"Suame",status:"Pending",joined:"2026-05-15",revenue:0},
  {id:5,name:"Golden Knot Events",category:"Wedding Planners",owner:"Akua Boateng",phone:"233244000035",location:"Nhyiaeso",status:"Pending",joined:"2026-06-01",revenue:0},
  {id:6,name:"Manhyia Rooftop Bar",category:"Pubs & Bars",owner:"Kwame Frimpong",phone:"233244000047",location:"Manhyia",status:"Active",joined:"2026-05-01",revenue:2800},
];

const mockOrders = [
  {id:"ORD001",customer:"Emma Thompson",type:"Grocery Concierge",items:"Plantain, Tomatoes, Chicken, Rice",total:185,status:"Delivered",date:"2026-06-03",payment:"MoMo"},
  {id:"ORD002",customer:"Hans Mueller",type:"Tour Booking",items:"Manhyia Palace Experience ×2",total:160,status:"Confirmed",date:"2026-06-04",payment:"MoMo"},
  {id:"ORD003",customer:"James Osei",type:"Grocery Concierge",items:"Eggs, Palm Oil, Onions, Fish",total:98,status:"In Progress",date:"2026-06-04",payment:"Cash"},
  {id:"ORD004",customer:"Sophie Dubois",type:"Hotel Booking",items:"Royal Ashanti Lodge – 3 nights",total:1350,status:"Confirmed",date:"2026-06-02",payment:"Card"},
  {id:"ORD005",customer:"Abena Mensah",type:"Tour Booking",items:"Ashanti Heritage Walk ×3",total:180,status:"Pending",date:"2026-06-04",payment:"MoMo"},
];

const mockRiders = [
  {id:1,name:"Kweku Mensah",phone:"0244501001",whatsapp:"0244501001",zone:"Manhyia / Adum",type:"Motorbike",status:"Available",deliveries:87,rating:4.9,earnings:1740,todayDeliveries:4},
  {id:2,name:"Abena Asare",phone:"0244501002",whatsapp:"0244501002",zone:"Kejetia / Asafo",type:"Bicycle",status:"On Delivery",deliveries:64,rating:4.7,earnings:1280,todayDeliveries:3},
  {id:3,name:"Yaw Boateng",phone:"0244501003",whatsapp:"0244501003",zone:"Suame / Buokrom",type:"Motorbike",status:"Available",deliveries:112,rating:4.8,earnings:2240,todayDeliveries:6},
  {id:4,name:"Kofi Darko",phone:"0244501005",whatsapp:"0244501005",zone:"Adum / Bantama",type:"Tuk-Tuk",status:"Available",deliveries:95,rating:4.8,earnings:1900,todayDeliveries:5},
];

const mockPartners = [
  {id:1,name:"Bolt Food Ghana",type:"Corporate",coverage:"All Kumasi",categories:["Food"],contactName:"Ali Zaryab",contact:"0244600001",status:"Active",rateModel:"25% commission",joined:"2026-04-01"},
  {id:2,name:"Result Logistics",type:"Local",coverage:"Asafo / Central",categories:["Grocery","Pharmacy"],contactName:"Kwame Result",contact:"0244600002",status:"Active",rateModel:"GHS 15–30 flat",joined:"2026-04-15"},
  {id:3,name:"DHL Kumasi",type:"International",coverage:"International",categories:["Crafts"],contactName:"DHL Business Team",contact:"0244600003",status:"Active",rateModel:"DHL rates +10%",joined:"2026-05-10"},
];

const mockDeliveryOrders = [
  {id:"DEL001",rider:"Kweku Mensah",customer:"Emma Thompson",category:"Grocery",items:"Plantain, Tomatoes",pickup:"Kejetia Market",dropoff:"Royal Ashanti Lodge",distance:"2.3km",fee:20,status:"Delivered",time:"10:34 AM",payment:"MoMo"},
  {id:"DEL002",rider:"Yaw Boateng",customer:"Hans Mueller",category:"Pharmacy",items:"Paracetamol, Vitamin C",pickup:"Manhyia Pharmacy",dropoff:"Heritage Inn",distance:"1.1km",fee:15,status:"In Transit",time:"12:05 PM",payment:"Cash"},
  {id:"DEL003",rider:"Kofi Darko",customer:"Sophie Dubois",category:"Crafts",items:"Kente cloth x2",pickup:"Kente Palace Weavers",dropoff:"Prempeh Suites",distance:"4.2km",fee:30,status:"Pending",time:"1:20 PM",payment:"MoMo"},
];

function AdminDashboard({ onExit }) {
  const [adminTab, setAdminTab] = useState("overview");
  const [searchCustomer, setSearchCustomer] = useState("");
  const [selectedNationality, setSelectedNationality] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");

  const totalRevenue = mockBusinesses.reduce((s,b)=>s+b.revenue,0);
  const activeBusinesses = mockBusinesses.filter(b=>b.status==="Active").length;
  const pendingBusinesses = mockBusinesses.filter(b=>b.status==="Pending").length;
  const nationalities = ["All",...new Set(mockCustomers.map(c=>c.nationality))];
  const nationalityBreakdown = mockCustomers.reduce((acc,c)=>{acc[c.nationality]=(acc[c.nationality]||0)+1;return acc;},{});
  const purposeBreakdown = mockCustomers.reduce((acc,c)=>{acc[c.purpose]=(acc[c.purpose]||0)+1;return acc;},{});
  const statusColor = {Active:"#22c55e",Pending:"#f59e0b",Suspended:"#ef4444"};
  const orderStatusColor = {Delivered:"#22c55e",Confirmed:C.kente3,"In Progress":"#f59e0b",Pending:"#aaa"};
  const deliveryStatusColor = {Delivered:"#22c55e","In Transit":"#f59e0b",Pending:C.kente3};
  const riderStatusColor = {Available:"#22c55e","On Delivery":"#f59e0b",Offline:"#aaa"};

  const filteredCustomers = mockCustomers.filter(c=>
    (selectedNationality==="All"||c.nationality===selectedNationality)&&
    (c.name.toLowerCase().includes(searchCustomer.toLowerCase())||c.email.toLowerCase().includes(searchCustomer.toLowerCase()))
  );
  const filteredBusinesses = mockBusinesses.filter(b=>
    selectedStatus==="All"||b.status===selectedStatus
  );

  const StatCard = ({icon,label,value,sub,color}) => (
    <div style={{background:"white",borderRadius:14,padding:"16px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",borderLeft:`4px solid ${color}`}}>
      <div style={{fontSize:"1.4rem",marginBottom:4}}>{icon}</div>
      <div style={{fontWeight:900,fontSize:"1.3rem",color:C.darkBrown}}>{value}</div>
      <div style={{fontSize:"0.72rem",fontWeight:700,color:"#555"}}>{label}</div>
      {sub&&<div style={{fontSize:"0.62rem",color,fontWeight:600}}>{sub}</div>}
    </div>
  );

  const tabs = [
    {id:"overview",icon:"📊",label:"Overview"},
    {id:"customers",icon:"👥",label:"Customers"},
    {id:"businesses",icon:"🏪",label:"Businesses"},
    {id:"orders",icon:"📦",label:"Orders"},
    {id:"delivery",icon:"🚴",label:"Delivery"},
    {id:"credit",icon:"🏅",label:"Credit"},
    {id:"analytics",icon:"📈",label:"Analytics"},
  ];

  return (
    <div style={{fontFamily:"'Georgia',serif",background:"#f0f2f5",minHeight:"100vh"}}>
      <div style={{background:C.black,padding:"0 16px",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 20px rgba(0,0,0,0.5)"}}>
        <div style={{maxWidth:1100,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:56}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Flag w={40} h={27}/>
            <div style={{color:C.gold,fontWeight:900,fontSize:"0.95rem"}}>AshantiHub <span style={{color:"#666",fontSize:"0.7rem",fontWeight:400}}>Admin</span></div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{background:"#22c55e22",color:"#22c55e",borderRadius:20,padding:"3px 10px",fontSize:"0.65rem",fontWeight:700}}>🟢 Live</div>
            <button onClick={onExit} style={{background:"none",border:"1px solid #444",color:"#aaa",borderRadius:20,padding:"4px 12px",fontSize:"0.7rem",cursor:"pointer",fontFamily:"inherit"}}>← Exit</button>
          </div>
        </div>
      </div>

      <div style={{background:"white",borderBottom:"1px solid #e0e0e0",padding:"0 16px"}}>
        <div style={{maxWidth:1100,margin:"0 auto",display:"flex",overflowX:"auto"}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setAdminTab(t.id)} style={{background:"none",border:"none",borderBottom:adminTab===t.id?`3px solid ${C.gold}`:"3px solid transparent",color:adminTab===t.id?C.darkBrown:"#888",padding:"12px 16px",fontSize:"0.75rem",fontWeight:adminTab===t.id?800:600,cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit"}}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"22px 16px 60px"}}>

        {adminTab==="overview"&&(
          <>
            <h2 style={{color:C.darkBrown,fontWeight:900,margin:"0 0 18px",fontSize:"1rem"}}>📊 Platform Overview</h2>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12,marginBottom:24}}>
              <StatCard icon="👥" label="Total Customers" value={mockCustomers.length} sub="+3 this week" color={C.kente3}/>
              <StatCard icon="🏪" label="Active Businesses" value={activeBusinesses} sub={`${pendingBusinesses} pending`} color={C.kente2}/>
              <StatCard icon="📦" label="Total Orders" value={mockOrders.length} sub="Today: 2 new" color={C.orange}/>
              <StatCard icon="💰" label="Revenue" value={`GHS ${totalRevenue.toLocaleString()}`} sub="Listing fees" color={C.gold}/>
              <StatCard icon="🚴" label="Active Riders" value={mockRiders.filter(r=>r.status!=="Offline").length} sub="On the road" color="#C2185B"/>
              <StatCard icon="🌍" label="Nationalities" value={Object.keys(nationalityBreakdown).length} sub="Countries" color="#4527A0"/>
            </div>
            <div style={{background:"white",borderRadius:16,padding:"18px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",marginBottom:16}}>
              <div style={{fontWeight:800,color:C.darkBrown,marginBottom:12,fontSize:"0.88rem"}}>📦 Recent Orders</div>
              {mockOrders.map(o=>(
                <div key={o.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #f8f8f8",flexWrap:"wrap",gap:8}}>
                  <div><div style={{fontWeight:700,fontSize:"0.78rem"}}>{o.customer} — {o.type}</div><div style={{fontSize:"0.65rem",color:"#888"}}>{o.date} • {o.payment}</div></div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{fontWeight:800,color:C.kente2}}>GHS {o.total}</span>
                    <span style={{background:`${orderStatusColor[o.status]}22`,color:orderStatusColor[o.status],borderRadius:20,padding:"2px 8px",fontSize:"0.62rem",fontWeight:700}}>{o.status}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{background:"white",borderRadius:16,padding:"18px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
              <div style={{fontWeight:800,color:C.darkBrown,marginBottom:12,fontSize:"0.88rem"}}>⏳ Pending Approvals</div>
              {mockBusinesses.filter(b=>b.status==="Pending").map(b=>(
                <div key={b.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #f0f0f0",gap:10,flexWrap:"wrap"}}>
                  <div><div style={{fontWeight:700,fontSize:"0.82rem"}}>{b.name}</div><div style={{fontSize:"0.68rem",color:"#888"}}>{b.category} • {b.location} • {b.owner}</div></div>
                  <div style={{display:"flex",gap:6}}>
                    <button style={{background:"#22c55e",color:"white",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✓ Approve</button>
                    <button style={{background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✕ Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {adminTab==="customers"&&(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
              <h2 style={{color:C.darkBrown,fontWeight:900,margin:0,fontSize:"1rem"}}>👥 Customer Database</h2>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <input value={searchCustomer} onChange={e=>setSearchCustomer(e.target.value)} placeholder="Search customers..." style={{padding:"7px 12px",borderRadius:20,border:"1.5px solid #ddd",fontSize:"0.75rem",outline:"none",fontFamily:"inherit"}}/>
                <select value={selectedNationality} onChange={e=>setSelectedNationality(e.target.value)} style={{padding:"7px 12px",borderRadius:20,border:"1.5px solid #ddd",fontSize:"0.75rem",background:"white",fontFamily:"inherit"}}>
                  {nationalities.map(n=><option key={n}>{n}</option>)}
                </select>
                <button style={{background:C.kente2,color:"white",border:"none",borderRadius:20,padding:"7px 14px",fontSize:"0.72rem",fontWeight:700,cursor:"pointer"}}>📥 Export CSV</button>
              </div>
            </div>
            <div style={{background:"white",borderRadius:16,padding:"18px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:"0.72rem"}}>
                <thead><tr style={{borderBottom:"2px solid #f0f0f0"}}>
                  {["Name","Email","Nationality","From","Purpose","Visit Date","Newsletter","Spent"].map(h=>(
                    <th key={h} style={{textAlign:"left",padding:"8px 10px",color:"#888",fontWeight:700,whiteSpace:"nowrap"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filteredCustomers.map(c=>(
                    <tr key={c.id} style={{borderBottom:"1px solid #f8f8f8"}}>
                      <td style={{padding:"9px 10px",fontWeight:700}}>{c.name}</td>
                      <td style={{padding:"9px 10px",color:"#555"}}>{c.email}</td>
                      <td style={{padding:"9px 10px"}}><span style={{background:`${C.kente3}15`,color:C.kente3,borderRadius:20,padding:"2px 7px",fontWeight:700,fontSize:"0.65rem"}}>{c.nationality}</span></td>
                      <td style={{padding:"9px 10px",color:"#555",whiteSpace:"nowrap"}}>{c.city}, {c.country}</td>
                      <td style={{padding:"9px 10px",color:"#555"}}>{c.purpose}</td>
                      <td style={{padding:"9px 10px",color:"#555"}}>{c.visitDate}</td>
                      <td style={{padding:"9px 10px",textAlign:"center"}}>{c.newsletter?"✅":"❌"}</td>
                      <td style={{padding:"9px 10px",fontWeight:800,color:C.kente2}}>GHS {c.spent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {adminTab==="businesses"&&(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:10}}>
              <h2 style={{color:C.darkBrown,fontWeight:900,margin:0,fontSize:"1rem"}}>🏪 Business Listings</h2>
              <select value={selectedStatus} onChange={e=>setSelectedStatus(e.target.value)} style={{padding:"7px 12px",borderRadius:20,border:"1.5px solid #ddd",fontSize:"0.75rem",background:"white",fontFamily:"inherit"}}>
                {["All","Active","Pending","Suspended"].map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14}}>
              {filteredBusinesses.map(b=>(
                <div key={b.id} style={{background:"white",borderRadius:16,padding:"16px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",borderTop:`3px solid ${statusColor[b.status]}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div style={{fontWeight:800,fontSize:"0.85rem",color:C.darkBrown}}>{b.name}</div>
                    <span style={{background:`${statusColor[b.status]}20`,color:statusColor[b.status],borderRadius:20,padding:"2px 8px",fontSize:"0.62rem",fontWeight:800}}>{b.status}</span>
                  </div>
                  <div style={{fontSize:"0.72rem",color:"#666",lineHeight:1.8}}>
                    <div>📂 {b.category}</div><div>👤 {b.owner}</div><div>📍 {b.location}</div>
                    <div>💰 <strong style={{color:C.kente2}}>GHS {b.revenue.toLocaleString()}</strong></div>
                  </div>
                  {b.status==="Pending"&&(
                    <div style={{display:"flex",gap:6,marginTop:10}}>
                      <button style={{flex:1,background:"#22c55e",color:"white",border:"none",borderRadius:20,padding:"6px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✓ Approve</button>
                      <button style={{flex:1,background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:20,padding:"6px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✕ Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {adminTab==="orders"&&(
          <>
            <h2 style={{color:C.darkBrown,fontWeight:900,margin:"0 0 16px",fontSize:"1rem"}}>📦 Orders</h2>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {mockOrders.map(o=>(
                <div key={o.id} style={{background:"white",borderRadius:14,padding:"16px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:"0.82rem"}}>{o.customer} — {o.type}</div>
                    <div style={{fontSize:"0.68rem",color:"#888"}}>{o.items} • {o.date} • {o.payment}</div>
                  </div>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <span style={{fontWeight:900,color:C.kente2}}>GHS {o.total}</span>
                    <span style={{background:`${orderStatusColor[o.status]}22`,color:orderStatusColor[o.status],borderRadius:20,padding:"3px 10px",fontSize:"0.65rem",fontWeight:800}}>{o.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {adminTab==="delivery"&&(
          <>
            <h2 style={{color:C.darkBrown,fontWeight:900,margin:"0 0 16px",fontSize:"1rem"}}>🚴 Delivery Management</h2>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12,marginBottom:20}}>
              {[{icon:"🚴",label:"Active Riders",value:mockRiders.filter(r=>r.status!=="Offline").length,color:C.kente2},{icon:"📦",label:"Deliveries Today",value:mockDeliveryOrders.filter(d=>d.status==="Delivered").length,color:C.gold},{icon:"⏳",label:"In Transit",value:mockDeliveryOrders.filter(d=>d.status==="In Transit").length,color:"#f59e0b"},{icon:"🤝",label:"Partners",value:mockPartners.length,color:"#4527A0"}].map(s=>(
                <div key={s.label} style={{background:"white",borderRadius:12,padding:"14px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",borderLeft:`4px solid ${s.color}`}}>
                  <div style={{fontSize:"1.2rem",marginBottom:3}}>{s.icon}</div>
                  <div style={{fontWeight:900,fontSize:"1.2rem",color:C.darkBrown}}>{s.value}</div>
                  <div style={{fontSize:"0.65rem",fontWeight:700,color:"#555"}}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{background:"white",borderRadius:16,padding:"18px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",marginBottom:16}}>
              <div style={{fontWeight:800,color:C.darkBrown,marginBottom:12,fontSize:"0.85rem"}}>🏍️ Rider Fleet</div>
              {mockRiders.map(r=>(
                <div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #f5f5f5",flexWrap:"wrap",gap:8}}>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <div style={{width:36,height:36,borderRadius:"50%",background:`${riderStatusColor[r.status]}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1rem"}}>{r.type==="Motorbike"?"🏍️":r.type==="Bicycle"?"🚲":"🛺"}</div>
                    <div><div style={{fontWeight:700,fontSize:"0.78rem"}}>{r.name}</div><div style={{fontSize:"0.65rem",color:"#888"}}>{r.zone} • {r.deliveries} deliveries • ⭐{r.rating}</div></div>
                  </div>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <span style={{background:`${riderStatusColor[r.status]}20`,color:riderStatusColor[r.status],borderRadius:20,padding:"2px 8px",fontSize:"0.62rem",fontWeight:800}}>● {r.status}</span>
                    <span style={{background:`${C.kente2}15`,color:C.kente2,borderRadius:20,padding:"2px 8px",fontSize:"0.62rem",fontWeight:700}}>GHS {r.earnings}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{background:"white",borderRadius:16,padding:"18px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
              <div style={{fontWeight:800,color:C.darkBrown,marginBottom:12,fontSize:"0.85rem"}}>📦 Today's Deliveries</div>
              {mockDeliveryOrders.map(d=>(
                <div key={d.id} style={{padding:"10px 0",borderBottom:"1px solid #f5f5f5"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <span style={{fontWeight:700,fontSize:"0.78rem"}}>{d.id} — {d.customer}</span>
                    <span style={{background:`${deliveryStatusColor[d.status]}20`,color:deliveryStatusColor[d.status],borderRadius:20,padding:"2px 8px",fontSize:"0.62rem",fontWeight:800}}>{d.status}</span>
                  </div>
                  <div style={{fontSize:"0.65rem",color:"#888"}}>📍 {d.pickup} → {d.dropoff} • {d.distance} • GHS {d.fee}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {adminTab==="credit"&&<CreditDashboard onClose={()=>setAdminTab("overview")} user={null}/>}

        {adminTab==="analytics"&&(
          <>
            <h2 style={{color:C.darkBrown,fontWeight:900,margin:"0 0 18px",fontSize:"1rem"}}>📈 Analytics</h2>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
              <div style={{background:"white",borderRadius:16,padding:"18px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
                <div style={{fontWeight:800,color:C.darkBrown,marginBottom:12,fontSize:"0.85rem"}}>🌍 Visitors by Nationality</div>
                {Object.entries(nationalityBreakdown).sort((a,b)=>b[1]-a[1]).map(([nat,count])=>(
                  <div key={nat} style={{marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.72rem",marginBottom:3}}>
                      <span style={{fontWeight:600}}>{nat}</span>
                      <span style={{fontWeight:800,color:C.kente3}}>{count}</span>
                    </div>
                    <div style={{height:7,background:"#f0f0f0",borderRadius:10,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${(count/mockCustomers.length)*100}%`,background:C.kente3,borderRadius:10}}/>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{background:"white",borderRadius:16,padding:"18px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
                <div style={{fontWeight:800,color:C.darkBrown,marginBottom:12,fontSize:"0.85rem"}}>🎯 Purpose of Visit</div>
                {Object.entries(purposeBreakdown).sort((a,b)=>b[1]-a[1]).map(([purpose,count])=>(
                  <div key={purpose} style={{marginBottom:8}}>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.72rem",marginBottom:3}}>
                      <span style={{fontWeight:600}}>{purpose}</span>
                      <span style={{fontWeight:800,color:C.kente1}}>{count}</span>
                    </div>
                    <div style={{height:7,background:"#f0f0f0",borderRadius:10,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${(count/mockCustomers.length)*100}%`,background:C.kente1,borderRadius:10}}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`,borderRadius:16,padding:"20px",color:"white"}}>
              <div style={{fontWeight:800,color:C.gold,marginBottom:12,fontSize:"0.85rem"}}>💡 Key Insights</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
                {[{icon:"🇬🇧",text:"British visitors spend the most — avg GHS 895"},{icon:"🎪",text:"Festival visitors up 40% — target Akwasidae"},{icon:"📱",text:"87% opted in for WhatsApp updates"},{icon:"💍",text:"Wedding & Funeral have highest order value"}].map((insight,i)=>(
                  <div key={i} style={{background:"rgba(255,255,255,0.08)",borderRadius:10,padding:"10px 12px",fontSize:"0.72rem",lineHeight:1.5}}>
                    <span style={{fontSize:"1.1rem",marginRight:6}}>{insight.icon}</span>{insight.text}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

// ─── Business Dashboard ───────────────────────────────────────────────────────
const mockBusinessProfile = {name:"Royal Ashanti Lodge",category:"Hotels & Accommodation",owner:"Nana Prempeh",phone:"0244000001",whatsapp:"0244000001",location:"Near Manhyia Palace, Adum",status:"Active",description:"Luxury rooms with kente-draped interiors, rooftop pool and palace views.",joined:"2026-04-01",trialEnds:"2026-07-01",enquiries:42,bookings:18,views:310,rating:4.8,reviews:24};
const mockBusinessListings = [
  {id:1,name:"Standard Room",price:"GHS 450",unit:"per night",available:true,lastUpdated:"2026-06-01",tag:"Most Booked"},
  {id:2,name:"Deluxe Suite",price:"GHS 750",unit:"per night",available:true,lastUpdated:"2026-05-28",tag:"Featured"},
  {id:3,name:"Presidential Suite",price:"GHS 1,200",unit:"per night",available:false,lastUpdated:"2026-05-15",tag:"Premium"},
];
const mockEnquiries = [
  {id:1,customer:"Emma Thompson",country:"🇬🇧 UK",message:"I'd like to book 3 nights from June 15. Do you have availability?",time:"2 hours ago",status:"New"},
  {id:2,customer:"Hans Mueller",country:"🇩🇪 Germany",message:"What is your rate for the Akwasidae Festival weekend?",time:"5 hours ago",status:"Replied"},
  {id:3,customer:"Sophie Dubois",country:"🇫🇷 France",message:"Do you offer airport pickup from KIA?",time:"2 days ago",status:"New"},
];

function BusinessDashboard({ onExit }) {
  const [bizTab, setBizTab] = useState("overview");
  const [listings, setListings] = useState(mockBusinessListings);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saved, setSaved] = useState(false);
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);

  const saveEdit = (id) => {
    setListings(ls=>ls.map(l=>l.id===id?{...l,...editForm,lastUpdated:new Date().toISOString().split("T")[0]}:l));
    setEditingId(null); setSaved(true); setTimeout(()=>setSaved(false),2500);
  };

  const daysSince = (date) => Math.floor((new Date()-new Date(date))/86400000);
  const freshnessColor = (date) => { const d=daysSince(date); return d<=7?"#22c55e":d<=30?"#f59e0b":"#ef4444"; };
  const freshnessLabel = (date) => { const d=daysSince(date); return d===0?"Today":d<=7?`${d}d ago`:d<=30?`${d}d ago ⚠️`:`${d}d ago 🔴`; };

  const tabs = [
    {id:"overview",icon:"📊",label:"Overview"},
    {id:"listings",icon:"🏷️",label:"Listings & Prices"},
    {id:"enquiries",icon:"💬",label:"Enquiries"},
    {id:"subscription",icon:"💳",label:"Subscription"},
  ];

  return (
    <div style={{fontFamily:"'Georgia',serif",background:"#f4f5f7",minHeight:"100vh"}}>
      {showPayModal&&selectedPlan&&(
        <MoMoPayment amount={billingCycle==="monthly"?selectedPlan.monthlyPrice:selectedPlan.annualPrice} purpose={`AshantiHub ${selectedPlan.name} Plan`} businessName={mockBusinessProfile.name} onSuccess={()=>setShowPayModal(false)} onClose={()=>setShowPayModal(false)}/>
      )}
      <div style={{background:`linear-gradient(135deg,${C.darkBrown},${C.black})`,padding:"0 16px",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 20px rgba(0,0,0,0.4)"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
        <div style={{maxWidth:960,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:58}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Flag w={44} h={30}/>
            <div><div style={{color:C.gold,fontWeight:900,fontSize:"0.92rem"}}>AshantiHub</div><div style={{color:"#aaa",fontSize:"0.6rem"}}>Business Dashboard</div></div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{color:"white",fontWeight:700,fontSize:"0.75rem"}}>{mockBusinessProfile.name}</div>
            <div style={{background:"#22c55e22",color:"#22c55e",borderRadius:20,padding:"3px 8px",fontSize:"0.62rem",fontWeight:700}}>● Active</div>
            <button onClick={onExit} style={{background:"none",border:"1px solid #444",color:"#aaa",borderRadius:20,padding:"4px 12px",fontSize:"0.68rem",cursor:"pointer",fontFamily:"inherit"}}>← Exit</button>
          </div>
        </div>
      </div>

      <div style={{background:"white",borderBottom:"1px solid #e8e8e8",padding:"0 16px",overflowX:"auto"}}>
        <div style={{maxWidth:960,margin:"0 auto",display:"flex"}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setBizTab(t.id)} style={{background:"none",border:"none",borderBottom:bizTab===t.id?`3px solid ${C.gold}`:"3px solid transparent",color:bizTab===t.id?C.darkBrown:"#888",padding:"12px 16px",fontSize:"0.75rem",fontWeight:bizTab===t.id?800:600,cursor:"pointer",whiteSpace:"nowrap",fontFamily:"inherit"}}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {saved&&<div style={{position:"fixed",top:70,right:20,background:"#22c55e",color:"white",borderRadius:12,padding:"10px 18px",fontSize:"0.8rem",fontWeight:700,zIndex:999}}>✓ Saved!</div>}

      <div style={{maxWidth:960,margin:"0 auto",padding:"20px 16px 60px"}}>

        {bizTab==="overview"&&(
          <>
            <div style={{background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`,borderRadius:16,padding:"20px",marginBottom:18,color:"white",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
              <div>
                <div style={{color:C.gold,fontWeight:900,fontSize:"1.1rem",marginBottom:4}}>Akwaaba, {mockBusinessProfile.owner.split(" ")[0]}! 👋</div>
                <div style={{fontSize:"0.76rem",opacity:0.85}}>{mockBusinessProfile.name} • {mockBusinessProfile.location}</div>
                <div style={{marginTop:8,fontSize:"0.68rem",opacity:0.8}}>📅 Free trial ends: {mockBusinessProfile.trialEnds} • ⭐ {mockBusinessProfile.rating}/5</div>
              </div>
              <button onClick={()=>setBizTab("listings")} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:30,padding:"9px 18px",fontWeight:900,fontSize:"0.78rem",cursor:"pointer",fontFamily:"inherit"}}>Update Prices →</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12,marginBottom:18}}>
              {[{icon:"👁️",label:"Profile Views",value:mockBusinessProfile.views,color:C.kente3},{icon:"💬",label:"Enquiries",value:mockBusinessProfile.enquiries,color:C.kente2},{icon:"📅",label:"Bookings",value:mockBusinessProfile.bookings,color:C.gold},{icon:"⭐",label:"Avg Rating",value:mockBusinessProfile.rating,color:C.orange}].map(s=>(
                <div key={s.label} style={{background:"white",borderRadius:12,padding:"14px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",borderLeft:`4px solid ${s.color}`}}>
                  <div style={{fontSize:"1.2rem",marginBottom:3}}>{s.icon}</div>
                  <div style={{fontWeight:900,fontSize:"1.2rem",color:C.darkBrown}}>{s.value}</div>
                  <div style={{fontSize:"0.68rem",fontWeight:700,color:"#555"}}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{background:"white",borderRadius:16,padding:"18px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
              <div style={{fontWeight:800,color:C.darkBrown,marginBottom:12,fontSize:"0.85rem"}}>💬 Recent Enquiries</div>
              {mockEnquiries.slice(0,3).map(e=>(
                <div key={e.id} style={{display:"flex",gap:10,padding:"9px 0",borderBottom:"1px solid #f5f5f5",alignItems:"flex-start"}}>
                  <div style={{width:32,height:32,borderRadius:"50%",background:`${C.gold}22`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,color:C.deepGold,flexShrink:0}}>{e.customer[0]}</div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:"0.76rem"}}>{e.customer} <span style={{color:"#aaa",fontWeight:400}}>{e.country}</span></div>
                    <div style={{fontSize:"0.7rem",color:"#555",lineHeight:1.4}}>{e.message}</div>
                  </div>
                  {e.status==="New"&&<span style={{background:`${C.kente1}20`,color:C.kente1,borderRadius:20,padding:"2px 7px",fontSize:"0.6rem",fontWeight:800,flexShrink:0}}>New</span>}
                </div>
              ))}
            </div>
          </>
        )}

        {bizTab==="listings"&&(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
              <h2 style={{margin:0,color:C.darkBrown,fontWeight:900,fontSize:"0.98rem"}}>🏷️ Listings & Prices</h2>
              <a href="https://wa.me/233244000000?text=UPDATE%3A%20" target="_blank" rel="noopener noreferrer" style={{background:C.whatsapp,color:"white",borderRadius:20,padding:"6px 14px",fontSize:"0.7rem",fontWeight:700,textDecoration:"none"}}>📱 WhatsApp Update</a>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {listings.map(item=>(
                <div key={item.id} style={{background:"white",borderRadius:14,padding:"14px 16px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",border:editingId===item.id?`2px solid ${C.gold}`:"2px solid transparent"}}>
                  {editingId===item.id?(
                    <div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                        {[["Name","name",""],["Price","price","GHS"],["Unit","unit",""]].map(([l,k,p])=>(
                          <div key={k}><label style={{fontSize:"0.68rem",fontWeight:700,color:C.darkBrown,display:"block",marginBottom:3}}>{l}</label>
                          {k==="unit"?<select value={editForm[k]||""} onChange={e=>setEditForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",padding:"8px",borderRadius:8,border:"1.5px solid #ddd",fontSize:"0.8rem",background:"white",fontFamily:"inherit"}}>
                            {["per night","per person","per day","per item","per service"].map(u=><option key={u}>{u}</option>)}
                          </select>:<input value={editForm[k]||""} onChange={e=>setEditForm(f=>({...f,[k]:e.target.value}))} style={{width:"100%",padding:"8px",borderRadius:8,border:"1.5px solid #ddd",fontSize:"0.8rem",fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>}</div>
                        ))}
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={()=>setEditingId(null)} style={{flex:1,background:"#f0f0f0",color:"#666",border:"none",borderRadius:20,padding:"8px",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                        <button onClick={()=>saveEdit(item.id)} style={{flex:2,background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"8px",fontWeight:900,cursor:"pointer",fontFamily:"inherit"}}>✓ Save</button>
                      </div>
                    </div>
                  ):(
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                      <div>
                        <div style={{fontWeight:800,fontSize:"0.85rem",color:C.darkBrown}}>{item.name} <span style={{background:`${C.gold}22`,color:C.deepGold,borderRadius:20,padding:"2px 7px",fontSize:"0.6rem",fontWeight:700}}>{item.tag}</span></div>
                        <div style={{fontWeight:900,color:C.kente2,fontSize:"0.95rem",marginTop:2}}>{item.price} <span style={{color:"#aaa",fontWeight:400,fontSize:"0.72rem"}}>{item.unit}</span></div>
                        <div style={{fontSize:"0.62rem",color:freshnessColor(item.lastUpdated),fontWeight:700,marginTop:2}}>🕐 {freshnessLabel(item.lastUpdated)}</div>
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={()=>{setEditingId(item.id);setEditForm({name:item.name,price:item.price,unit:item.unit});}} style={{background:`${C.gold}22`,color:C.deepGold,border:"none",borderRadius:20,padding:"6px 12px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer"}}>✏️ Edit</button>
                        <button onClick={()=>{setListings(ls=>ls.map(l=>l.id===item.id?{...l,available:!l.available}:l));setSaved(true);setTimeout(()=>setSaved(false),2000);}} style={{background:item.available?"#fee2e2":"#dcfce7",color:item.available?"#ef4444":"#22c55e",border:"none",borderRadius:20,padding:"6px 12px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer"}}>{item.available?"Unavailable":"Available"}</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {bizTab==="enquiries"&&(
          <>
            <h2 style={{margin:"0 0 14px",color:C.darkBrown,fontWeight:900,fontSize:"0.98rem"}}>💬 Customer Enquiries</h2>
            {mockEnquiries.map(e=>(
              <div key={e.id} style={{background:"white",borderRadius:14,padding:"16px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",marginBottom:10,borderLeft:`4px solid ${e.status==="New"?C.kente1:C.kente2}`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,flexWrap:"wrap",gap:6}}>
                  <div style={{fontWeight:800,fontSize:"0.82rem"}}>{e.customer} <span style={{color:"#888",fontWeight:400}}>{e.country}</span></div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <span style={{fontSize:"0.65rem",color:"#aaa"}}>{e.time}</span>
                    {e.status==="New"&&<span style={{background:`${C.kente1}20`,color:C.kente1,borderRadius:20,padding:"2px 7px",fontSize:"0.6rem",fontWeight:800}}>New</span>}
                  </div>
                </div>
                <div style={{background:"#f9f9f9",borderRadius:8,padding:"9px 12px",fontSize:"0.74rem",color:"#444",lineHeight:1.5,marginBottom:10}}>"{e.message}"</div>
                <a href={`https://wa.me/233244000000?text=${encodeURIComponent(`Hello ${e.customer.split(" ")[0]}, thank you for your enquiry about ${mockBusinessProfile.name} on AshantiHub!`)}`} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:5,background:C.whatsapp,color:"white",borderRadius:20,padding:"6px 14px",fontSize:"0.7rem",fontWeight:700,textDecoration:"none"}}>📱 Reply on WhatsApp</a>
              </div>
            ))}
          </>
        )}

        {bizTab==="subscription"&&(
          <>
            <h2 style={{margin:"0 0 14px",color:C.darkBrown,fontWeight:900,fontSize:"0.98rem"}}>💳 Subscription</h2>
            <div style={{background:`linear-gradient(135deg,${C.kente2},#003d22)`,borderRadius:14,padding:"18px",color:"white",marginBottom:16}}>
              <div style={{fontWeight:900,fontSize:"1rem",color:C.gold,marginBottom:4}}>🎁 Free Trial Active</div>
              <div style={{fontSize:"0.78rem",opacity:0.9}}>Trial ends <strong>{mockBusinessProfile.trialEnds}</strong>. No charges until then.</div>
            </div>
            <div style={{display:"inline-flex",background:"#f0f0f0",borderRadius:30,padding:3,gap:3,marginBottom:16}}>
              {["monthly","annual"].map(c=>(
                <button key={c} onClick={()=>setBillingCycle(c)} style={{background:billingCycle===c?"white":"transparent",border:"none",borderRadius:28,padding:"6px 16px",fontWeight:billingCycle===c?800:600,fontSize:"0.75rem",cursor:"pointer",fontFamily:"inherit",color:billingCycle===c?C.darkBrown:"#888"}}>
                  {c==="monthly"?"Monthly":"Annual 🎁 Save 2 months"}
                </button>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
              {SUBSCRIPTION_PLANS.map(plan=>(
                <div key={plan.id} style={{background:"white",borderRadius:14,padding:"18px",boxShadow:"0 2px 14px rgba(0,0,0,0.08)",border:`2px solid ${plan.recommended?C.gold:"transparent"}`,position:"relative"}}>
                  {plan.recommended&&<div style={{position:"absolute",top:-9,left:"50%",transform:"translateX(-50%)",background:C.gold,color:C.darkBrown,borderRadius:20,padding:"2px 12px",fontSize:"0.58rem",fontWeight:900,whiteSpace:"nowrap"}}>⭐ MOST POPULAR</div>}
                  <div style={{fontWeight:900,color:plan.color,marginBottom:2}}>{plan.name}</div>
                  <div style={{fontWeight:900,fontSize:"1.5rem",color:C.darkBrown,marginBottom:10}}>GHS {billingCycle==="monthly"?plan.monthlyPrice:plan.annualPrice}<span style={{fontSize:"0.7rem",fontWeight:400,color:"#aaa"}}>/{billingCycle==="monthly"?"mo":"yr"}</span></div>
                  {plan.features.map(f=><div key={f} style={{fontSize:"0.7rem",color:"#444",marginBottom:4}}>✓ {f}</div>)}
                  <button onClick={()=>{setSelectedPlan(plan);setShowPayModal(true);}} style={{width:"100%",marginTop:12,background:plan.recommended?C.gold:"#f0f0f0",color:plan.recommended?C.darkBrown:"#666",border:"none",borderRadius:20,padding:"9px",fontWeight:900,cursor:"pointer",fontFamily:"inherit",fontSize:"0.78rem"}}>💰 Pay with MoMo</button>
                </div>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  );
}

// ─── Credit Category View (inline in main platform) ──────────────────────────
function CreditCategoryView({ onOpenFull, user }) {
  const [activeStep, setActiveStep] = useState(null);
  const eligiblePartners = LENDING_PARTNERS.filter(p => p.minScore <= 600);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>

      {/* Hero */}
      <div style={{ background:`linear-gradient(135deg,#7B2FBE,#4A0080)`, borderRadius:18, padding:"26px 22px", color:"white", textAlign:"center" }}>
        <div style={{ fontSize:"2.5rem", marginBottom:10 }}>🏅 💰 🇬🇭</div>
        <h2 style={{ fontWeight:900, margin:"0 0 8px", fontSize:"1.2rem", color:"#E9D5FF" }}>Business Credit — Powered by AshantiHub</h2>
        <p style={{ fontSize:"0.82rem", opacity:0.9, lineHeight:1.7, margin:"0 0 18px", maxWidth:480, marginLeft:"auto", marginRight:"auto" }}>
          Your activity on AshantiHub earns you a <strong style={{ color:C.ghGold }}>Credit Score</strong>. Use it to access business loans from Ghana's top banks and microfinance partners — <strong style={{ color:C.ghGold }}>no collateral required.</strong>
        </p>
        <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap" }}>
          <button onClick={onOpenFull} style={{ background:C.ghGold, color:C.darkBrown, border:"none", borderRadius:30, padding:"11px 22px", fontWeight:900, cursor:"pointer", fontFamily:"inherit", fontSize:"0.85rem" }}>
            🏅 Check My Credit Score
          </button>
          <button onClick={onOpenFull} style={{ background:"rgba(255,255,255,0.15)", color:"white", border:"1.5px solid rgba(255,255,255,0.4)", borderRadius:30, padding:"11px 22px", fontWeight:700, cursor:"pointer", fontFamily:"inherit", fontSize:"0.82rem" }}>
            💰 Apply for a Loan
          </button>
        </div>
      </div>

      {/* How it works */}
      <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
        <div style={{ fontWeight:900, color:C.darkBrown, marginBottom:4, fontSize:"0.92rem" }}>⚙️ How It Works</div>
        <p style={{ color:"#888", fontSize:"0.74rem", margin:"0 0 14px" }}>Every business listed on AshantiHub automatically builds a credit score based on 6 factors</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
          {SCORE_FACTORS.map((f,i) => (
            <div key={f.key} onClick={()=>setActiveStep(activeStep===i?null:i)}
              style={{ background:activeStep===i?`#7B2FBE15`:"#f9f9f9", borderRadius:12, padding:"12px 10px", textAlign:"center", cursor:"pointer", border:`1.5px solid ${activeStep===i?"#7B2FBE33":"transparent"}`, transition:"all 0.2s" }}>
              <div style={{ fontSize:"1.5rem", marginBottom:6 }}>{f.icon}</div>
              <div style={{ fontWeight:800, fontSize:"0.72rem", color:C.darkBrown, marginBottom:2 }}>{f.label}</div>
              <div style={{ fontWeight:900, color:"#7B2FBE", fontSize:"0.68rem" }}>{f.weight}% weight</div>
              {activeStep===i && <div style={{ fontSize:"0.65rem", color:"#555", marginTop:6, lineHeight:1.4 }}>{f.desc}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Score bands */}
      <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
        <div style={{ fontWeight:900, color:C.darkBrown, marginBottom:14, fontSize:"0.92rem" }}>📊 What Your Score Unlocks</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {[
            { range:"800–1000", grade:"A+", label:"Exceptional", color:"#22c55e", maxLoan:"GHS 50,000–100,000", partners:"All 6 partners", icon:"👑" },
            { range:"700–799", grade:"A-", label:"Very Good", color:C.kente2, maxLoan:"GHS 25,000–50,000", partners:"4–5 partners", icon:"🌟" },
            { range:"600–699", grade:"B", label:"Good", color:C.gold, maxLoan:"GHS 10,000–25,000", partners:"2–3 partners", icon:"✅" },
            { range:"500–599", grade:"C+", label:"Average", color:C.orange, maxLoan:"GHS 5,000–10,000", partners:"1–2 partners", icon:"📈" },
            { range:"0–499", grade:"D", label:"Building", color:"#aaa", maxLoan:"Keep improving!", partners:"Unlock soon", icon:"🔨" },
          ].map(b => (
            <div key={b.range} style={{ display:"flex", gap:10, alignItems:"center", padding:"10px 12px", borderRadius:12, background:`${b.color}08`, border:`1px solid ${b.color}22` }}>
              <div style={{ fontSize:"1.2rem", width:28, textAlign:"center" }}>{b.icon}</div>
              <div style={{ width:36, height:36, borderRadius:"50%", background:`${b.color}20`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, color:b.color, fontSize:"0.72rem", flexShrink:0 }}>{b.grade}</div>
              <div style={{ flex:1 }}>
                <div style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:4 }}>
                  <span style={{ fontWeight:800, fontSize:"0.78rem", color:C.darkBrown }}>{b.range} — {b.label}</span>
                  <span style={{ fontWeight:800, color:b.color, fontSize:"0.72rem" }}>{b.maxLoan}</span>
                </div>
                <div style={{ fontSize:"0.65rem", color:"#888" }}>🤝 {b.partners}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sample scored businesses */}
      <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
        <div style={{ fontWeight:900, color:C.darkBrown, marginBottom:4, fontSize:"0.92rem" }}>🏪 Top Scored Businesses on AshantiHub</div>
        <p style={{ color:"#888", fontSize:"0.72rem", margin:"0 0 14px" }}>These businesses have built strong credit scores through consistent platform activity</p>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {MOCK_CREDIT_BUSINESSES.filter(b=>b.loanEligible).slice(0,4).map(biz => {
            const { grade, color } = getScoreGrade(biz.score);
            return (
              <div key={biz.id} style={{ display:"flex", gap:12, alignItems:"center", padding:"12px", background:"#f9f9f9", borderRadius:12 }}>
                <div style={{ width:46, height:46, borderRadius:"50%", background:`${color}20`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, flexDirection:"column" }}>
                  <div style={{ fontWeight:900, color, fontSize:"0.95rem" }}>{biz.score}</div>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, fontSize:"0.82rem", color:C.darkBrown }}>{biz.name}</div>
                  <div style={{ fontSize:"0.68rem", color:"#888" }}>{biz.category} • ⭐{biz.rating} • {biz.reviews} reviews</div>
                  <div style={{ fontSize:"0.65rem", color, fontWeight:700, marginTop:2 }}>{grade} — Eligible up to GHS {biz.maxLoan.toLocaleString()}</div>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                  <span style={{ background:"#22c55e20", color:"#22c55e", borderRadius:20, padding:"2px 8px", fontSize:"0.6rem", fontWeight:800, whiteSpace:"nowrap" }}>✅ Loan Ready</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Lending partners preview */}
      <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
        <div style={{ fontWeight:900, color:C.darkBrown, marginBottom:4, fontSize:"0.92rem" }}>🤝 Our Lending Partners</div>
        <p style={{ color:"#888", fontSize:"0.72rem", margin:"0 0 14px" }}>AshantiHub-verified financial partners ready to lend to scored businesses</p>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:10, marginBottom:16 }}>
          {LENDING_PARTNERS.map(p => (
            <div key={p.id} style={{ background:"#f9f9f9", borderRadius:12, padding:"14px", borderLeft:`4px solid ${p.color}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
                <span style={{ fontSize:"1.4rem" }}>{p.logo}</span>
                <div>
                  <div style={{ fontWeight:800, fontSize:"0.76rem", color:C.darkBrown, lineHeight:1.2 }}>{p.name}</div>
                  <span style={{ background:`${p.color}20`, color:p.color, borderRadius:10, padding:"1px 6px", fontSize:"0.58rem", fontWeight:700 }}>{p.type}</span>
                </div>
              </div>
              <div style={{ fontSize:"0.68rem", color:"#555", lineHeight:1.7 }}>
                <div>💰 {p.maxLoan}</div>
                <div>📈 {p.rate}</div>
                <div>⏱️ {p.turnaround}</div>
                <div style={{ marginTop:4, fontWeight:700, color:p.color }}>Min Score: {p.minScore}+</div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={onOpenFull} style={{ width:"100%", background:"#7B2FBE", color:"white", border:"none", borderRadius:20, padding:"12px", fontWeight:900, cursor:"pointer", fontFamily:"inherit", fontSize:"0.88rem" }}>
          🏅 Open Full Credit Dashboard →
        </button>
      </div>

      {/* Tips to improve */}
      <div style={{ background:`linear-gradient(135deg,${C.darkBrown},#7B2FBE)`, borderRadius:16, padding:"20px 22px", color:"white" }}>
        <div style={{ fontWeight:900, color:C.ghGold, marginBottom:12, fontSize:"0.88rem" }}>💡 How to Improve Your Credit Score Fast</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:10 }}>
          {[
            { icon:"⭐", tip:"Get customer reviews", impact:"+50–100 pts" },
            { icon:"📱", tip:"Reply to all WhatsApp enquiries", impact:"+30–80 pts" },
            { icon:"🏷️", tip:"Update prices regularly", impact:"+20–40 pts" },
            { icon:"💰", tip:"Pay listing fees on time", impact:"+40–60 pts" },
            { icon:"📅", tip:"Stay active on AshantiHub", impact:"+10 pts/month" },
            { icon:"📦", tip:"Convert enquiries to bookings", impact:"+20–50 pts" },
          ].map(item => (
            <div key={item.tip} style={{ background:"rgba(255,255,255,0.08)", borderRadius:10, padding:"10px 12px", display:"flex", gap:8, alignItems:"flex-start" }}>
              <span style={{ fontSize:"1.2rem" }}>{item.icon}</span>
              <div>
                <div style={{ fontWeight:700, fontSize:"0.74rem" }}>{item.tip}</div>
                <div style={{ fontSize:"0.62rem", color:C.ghGold, fontWeight:700, marginTop:2 }}>{item.impact}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Economic impact */}
      <div style={{ background:`${C.ghGold}15`, border:`1.5px solid ${C.ghGold}44`, borderRadius:16, padding:"18px 20px" }}>
        <div style={{ fontWeight:900, color:C.darkBrown, marginBottom:10, fontSize:"0.88rem" }}>🌍 AshantiHub Credit — Economic Vision</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, textAlign:"center" }}>
          {[["200,000","Businesses to Score"],["GHS 1B+","Loans Facilitated"],["2,000,000","Jobs Created"]].map(([v,l])=>(
            <div key={l} style={{ background:"white", borderRadius:12, padding:"12px 8px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
              <div style={{ fontWeight:900, color:C.kente2, fontSize:"0.95rem" }}>{v}</div>
              <div style={{ fontSize:"0.6rem", color:"#888", marginTop:2 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ─── Loading Screen ───────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{position:"fixed",inset:0,background:`linear-gradient(135deg,${C.darkBrown},${C.black})`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:9999}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:5,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
      <Flag w={80} h={53}/>
      <div style={{color:C.gold,fontWeight:900,fontSize:"1.8rem",letterSpacing:2,marginTop:16,fontFamily:"Georgia,serif"}}>AshantiHub</div>
      <div style={{color:C.lightGold,fontSize:"0.65rem",letterSpacing:3,opacity:0.8,marginTop:4,fontFamily:"Georgia,serif"}}>THE MARKETPLACE OF ASHANTI</div>
      {/* Animated loading bar */}
      <div style={{width:120,height:4,background:"rgba(255,255,255,0.1)",borderRadius:10,marginTop:28,overflow:"hidden"}}>
        <div style={{height:"100%",background:`linear-gradient(90deg,${C.ghRed},${C.ghGold},${C.ghGreen})`,borderRadius:10,animation:"loadBar 1.5s ease-in-out infinite"}}/>
      </div>
      <div style={{color:"rgba(255,255,255,0.5)",fontSize:"0.65rem",marginTop:12}}>Loading Kumasi's marketplace...</div>
      <style>{`
        @keyframes loadBar { 0%{width:0%} 50%{width:100%} 100%{width:0%} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse { 0%,100%{box-shadow:0 4px 20px rgba(37,211,102,0.4)} 50%{box-shadow:0 4px 30px rgba(37,211,102,0.8)} }
      `}</style>
    </div>
  );
}

// ─── Offline Banner ───────────────────────────────────────────────────────────
function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => {
      setOffline(false);
      setShowReconnected(true);
      setTimeout(() => setShowReconnected(false), 3000);
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => { window.removeEventListener("offline", goOffline); window.removeEventListener("online", goOnline); };
  }, []);

  if (showReconnected) return (
    <div style={{position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",background:"#22c55e",color:"white",borderRadius:20,padding:"8px 20px",fontSize:"0.78rem",fontWeight:700,zIndex:9998,boxShadow:"0 4px 16px rgba(34,197,94,0.4)",whiteSpace:"nowrap"}}>
      ✅ Back online — AshantiHub is ready!
    </div>
  );

  if (!offline) return null;

  return (
    <div style={{background:"#1a1a1a",color:"white",padding:"10px 16px",textAlign:"center",position:"sticky",top:60,zIndex:99,borderBottom:`3px solid ${C.kente1}`}}>
      <div style={{fontSize:"0.76rem",fontWeight:700}}>
        📵 You appear to be offline. Some features may not work.
        <span style={{color:C.ghGold,marginLeft:8,cursor:"pointer"}} onClick={()=>window.location.reload()}>Retry →</span>
      </div>
    </div>
  );
}

// ─── 404 Not Found Page ───────────────────────────────────────────────────────
function NotFoundPage({ onHome }) {
  return (
    <div style={{fontFamily:"'Georgia',serif",background:C.cream,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{textAlign:"center",maxWidth:400}}>
        <div style={{fontSize:"4rem",marginBottom:12}}>👑</div>
        <div style={{background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`,borderRadius:20,padding:"28px 24px",marginBottom:20,color:"white"}}>
          <div style={{fontSize:"3rem",fontWeight:900,color:C.gold,marginBottom:4}}>404</div>
          <div style={{fontWeight:900,fontSize:"1.1rem",marginBottom:8}}>Page Not Found</div>
          <div style={{fontSize:"0.8rem",opacity:0.85,lineHeight:1.6}}>
            The page you're looking for doesn't exist or has been moved. Let's get you back to the marketplace.
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <button onClick={onHome} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:30,padding:"12px 28px",fontWeight:900,fontSize:"0.9rem",cursor:"pointer",fontFamily:"inherit"}}>
            🏠 Back to AshantiHub
          </button>
          <button onClick={()=>window.history.back()} style={{background:"transparent",color:C.darkBrown,border:`1.5px solid ${C.darkBrown}`,borderRadius:30,padding:"11px 28px",fontWeight:700,fontSize:"0.85rem",cursor:"pointer",fontFamily:"inherit"}}>
            ← Go Back
          </button>
          <a href="https://wa.me/233244000000?text=Hello AshantiHub, I need help." target="_blank" rel="noopener noreferrer"
            style={{display:"block",background:C.whatsapp,color:"white",border:"none",borderRadius:30,padding:"11px 28px",fontWeight:700,fontSize:"0.82rem",textDecoration:"none"}}>
            📱 Contact Support on WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Simple Analytics Tracker ─────────────────────────────────────────────────
const Analytics = {
  events: [],
  track: (event, data={}) => {
    const entry = { event, data, timestamp: new Date().toISOString(), page: window.location.pathname };
    Analytics.events.push(entry);
    // In production this would send to your analytics endpoint
    // console.log("📊 AshantiHub Analytics:", entry);
  },
  getReport: () => {
    const counts = Analytics.events.reduce((acc, e) => { acc[e.event] = (acc[e.event]||0)+1; return acc; }, {});
    return { totalEvents: Analytics.events.length, eventCounts: counts, sessionStart: Analytics.events[0]?.timestamp };
  }
};

// ─── PWA Install Prompt ───────────────────────────────────────────────────────
function PWAInstallBanner({ onDismiss }) {
  const [show, setShow] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); setShow(true); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) { deferredPrompt.prompt(); const { outcome } = await deferredPrompt.userChoice; if (outcome==="accepted") { setShow(false); Analytics.track("pwa_installed"); } }
  };

  if (!show) return null;

  return (
    <div style={{position:"fixed",bottom:cookieDismissedRef,left:16,right:76,background:C.darkBrown,borderRadius:16,padding:"14px 16px",zIndex:997,boxShadow:"0 4px 20px rgba(0,0,0,0.4)",display:"flex",gap:12,alignItems:"center"}}>
      <div style={{fontSize:"1.8rem"}}>👑</div>
      <div style={{flex:1}}>
        <div style={{color:C.gold,fontWeight:800,fontSize:"0.8rem",marginBottom:2}}>Install AshantiHub</div>
        <div style={{color:"#aaa",fontSize:"0.68rem"}}>Add to your home screen for quick access</div>
      </div>
      <div style={{display:"flex",gap:6}}>
        <button onClick={handleInstall} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"6px 12px",fontSize:"0.7rem",fontWeight:800,cursor:"pointer"}}>Install</button>
        <button onClick={()=>{setShow(false);onDismiss&&onDismiss();}} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"none",borderRadius:20,padding:"6px 10px",fontSize:"0.7rem",cursor:"pointer"}}>✕</button>
      </div>
    </div>
  );
}

// ─── Favourite drawer row ──────────────────────────────────────────────────────
// Fetches a single favourited listing by id via `useListing`. Kept as its own
// top-level component (rather than a `.map()` calling `useListing` inline inside
// `FavsDrawer`) because `favourites` is a variable-length array: calling a hook a
// variable number of times per render would violate the Rules of Hooks. Each
// `FavDrawerItem` instance calls exactly one hook every render, so the number of
// instances can change freely across renders without breaking hook-call-count
// consistency within any single instance.
function FavDrawerItem({id,onRemove}) {
  const {data:item,isLoading,isError} = useListing(id);

  if(isLoading){
    return <div style={{padding:"10px 14px",borderBottom:"1px solid #f9f9f9",display:"flex",gap:10,alignItems:"center"}}>
      <div style={{width:24,height:24,borderRadius:"50%",background:"#eee"}}/>
      <div style={{flex:1}}>
        <div style={{height:10,width:"60%",background:"#eee",borderRadius:4,marginBottom:6}}/>
        <div style={{height:8,width:"35%",background:"#f0f0f0",borderRadius:4}}/>
      </div>
    </div>;
  }

  if(isError||!item){
    return <div style={{padding:"10px 14px",borderBottom:"1px solid #f9f9f9",display:"flex",gap:10,alignItems:"center"}}>
      <div style={{flex:1,fontSize:"0.7rem",color:"#aaa",fontStyle:"italic"}}>No longer available</div>
      <button onClick={()=>onRemove(id)} style={{background:"none",border:"none",cursor:"pointer",color:C.kente1,fontSize:"1rem"}}>✕</button>
    </div>;
  }

  return <div style={{padding:"10px 14px",borderBottom:"1px solid #f9f9f9",display:"flex",gap:10,alignItems:"center"}}>
    <span style={{fontSize:"1.5rem"}}>{item.category?.icon}</span>
    <div style={{flex:1}}>
      <div style={{fontWeight:700,fontSize:"0.78rem"}}>{item.name}</div>
      <div style={{fontSize:"0.65rem",color:"#888"}}>GHS {item.price_amount}{item.price_unit||""}</div>
    </div>
    <button onClick={()=>onRemove(id)} style={{background:"none",border:"none",cursor:"pointer",color:C.kente1,fontSize:"1rem"}}>✕</button>
  </div>;
}

// ─── Listings loading skeleton ────────────────────────────────────────────────
function ListingsSkeleton() {
  return <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(245px,1fr))",gap:14}}>
    {Array.from({length:6}).map((_,i)=>(
      <div key={i} style={{background:"white",borderRadius:16,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.10)"}}>
        <div style={{height:140,background:"#eee"}}/>
        <div style={{padding:"12px 14px"}}>
          <div style={{height:14,width:"70%",background:"#eee",borderRadius:4,marginBottom:8}}/>
          <div style={{height:10,width:"40%",background:"#f0f0f0",borderRadius:4,marginBottom:8}}/>
          <div style={{height:10,width:"90%",background:"#f0f0f0",borderRadius:4}}/>
        </div>
      </div>
    ))}
  </div>;
}

export default function AshantiHub() {
  const [page,setPage]=useState("home");
  const [authModal,setAuthModal]=useState(null);
  const [user,setUser]=useState(null);
  const [legalDoc,setLegalDoc]=useState(null);
  const [showBizDash,setShowBizDash]=useState(false);
  const [isAdmin,setIsAdmin]=useState(false);
  const [showPayments,setShowPayments]=useState(false);
  const [showCredit,setShowCredit]=useState(false);
  const [adminClicks,setAdminClicks]=useState(0);
  const [favourites,setFavourites]=useState([]);
  const [showFavs,setShowFavs]=useState(false);
  const [showMap,setShowMap]=useState(false);
  const [showReferral,setShowReferral]=useState(false);
  const [showNotifs,setShowNotifs]=useState(false);
  const [currency,setCurrency]=useState("GHS");
  const [lang,setLang]=useState("en");
  const [showFilters,setShowFilters]=useState(false);

  // ── Live marketplace data (categories/zones/listings) ─────────────────────
  const [filters, setFilters] = useState({ category: "hotels" });
  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const { data: zones, isLoading: zonesLoading } = useZones();
  const {
    data: listingsData,
    isLoading: listingsLoading,
    isFetching: listingsFetching,
    isError: listingsError,
    fetchNextPage,
    hasNextPage,
    refetch: refetchListings,
  } = useListings(filters);
  const listings = listingsData ? listingsData.pages.flatMap((page) => page.results) : [];
  const [cookieConsent,setCookieConsent]=useState(false);
  const [cookieDismissed,setCookieDismissed]=useState(false);
  const [whatsappPrompt,setWhatsappPrompt]=useState(null);
  const [showMessaging,setShowMessaging]=useState(false);
  const [messagingBusiness,setMessagingBusiness]=useState(null);
  const [isLoading,setIsLoading]=useState(true);
  const [show404,setShow404]=useState(false);
  const T = TRANSLATIONS[lang];

  // Loading screen — simulate app boot
  useEffect(()=>{ const t=setTimeout(()=>setIsLoading(false),1800); return()=>clearTimeout(t); },[]);

  // Analytics page tracking
  useEffect(()=>{ if(!isLoading) Analytics.track("page_view",{page}); },[page,isLoading]);

  useEffect(()=>{
    const handler=(e)=>setLegalDoc(e.detail);
    window.addEventListener("openLegal",handler);
    return()=>window.removeEventListener("openLegal",handler);
  },[]);

  const handleLogoClick=()=>{const n=adminClicks+1;setAdminClicks(n);if(n>=5){setIsAdmin(true);setAdminClicks(0);}};
  const toggleFav=(id)=>setFavourites(f=>f.includes(id)?f.filter(x=>x!==id):[...f,id]);
  const handleWA=(item)=>{if(!user){setWhatsappPrompt(item);setAuthModal("signup");return;}const msg=encodeURIComponent(`Hello! I found ${item.name} on AshantiHub and I'd like to enquire.`);window.open(`https://wa.me/${item.phone}?text=${msg}`,"_blank");};

  const [showSearchResults,setShowSearchResults]=useState(false);
  const [searchFocused,setSearchFocused]=useState(false);

  // Static "popular searches" quick-fill suggestions shown when the search box is focused and empty.
  // (The old cross-category smart-search engine that scored against the in-memory `LISTINGS` mock
  // across every category at once has been removed — full-text search now happens server-side via
  // `filters.search`, scoped to whichever category tab is active, since there's no full listing set
  // held client-side anymore to search across.)
  const SEARCH_SUGGESTIONS = [
    "fufu restaurant","hotel near palace","kente cloth","car repair suame",
    "24 hour pharmacy","wedding planner","funeral organizer","cheap transport",
    "rooftop bar","fresh groceries","dental clinic","gym","tuk-tuk",
    "tour guide","adinkra crafts","petrol station","open now","highly rated",
  ];

  if(isAdmin) return <AdminDashboard onExit={()=>setIsAdmin(false)}/>;
  if(showBizDash) return <BusinessDashboard onExit={()=>setShowBizDash(false)}/>;
  if(showPayments) return <PaymentDashboard onClose={()=>setShowPayments(false)}/>;
  if(showCredit) return <CreditDashboard onClose={()=>setShowCredit(false)} user={user}/>;
  if(isLoading) return <LoadingScreen/>;
  if(show404) return <NotFoundPage onHome={()=>{ setShow404(false); setPage("home"); }}/>;

  const activeCatObj=categories?.find(c=>c.slug===filters.category);

  const Header=()=>(
    <div style={{background:`linear-gradient(135deg,${C.darkBrown} 0%,${C.black} 50%,${C.kente3} 100%)`,padding:"0 16px",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 20px rgba(0,0,0,0.4)"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
      <div style={{maxWidth:960,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:60,paddingTop:4}}>
        <div style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={handleLogoClick}>
          <Flag w={44} h={30}/>
          <span style={{fontSize:"1.3rem"}}>👑</span>
          <div>
            <div style={{color:C.gold,fontWeight:900,fontSize:"1rem",letterSpacing:1,lineHeight:1}}>AshantiHub</div>
            <div style={{color:C.lightGold,fontSize:"0.52rem",letterSpacing:2,opacity:0.8}}>THE MARKETPLACE OF ASHANTI</div>
          </div>
        </div>
        <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
          {/* Language */}
          <button onClick={()=>setLang(l=>l==="en"?"tw":"en")} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:20,padding:"4px 8px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>
            {lang==="en"?"🇬🇭 Twi":"🇬🇧 EN"}
          </button>
          {/* Currency */}
          <select value={currency} onChange={e=>setCurrency(e.target.value)} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:20,padding:"4px 8px",fontSize:"0.62rem",cursor:"pointer",outline:"none",fontFamily:"inherit"}}>
            <option value="GHS">GHS 🇬🇭</option>
            <option value="USD">USD 🇺🇸</option>
            <option value="GBP">GBP 🇬🇧</option>
            <option value="EUR">EUR 🇪🇺</option>
          </select>
          {/* Nav */}
          {["home","events","about"].map(p=>(
            <button key={p} onClick={()=>setPage(p)} style={{background:page===p?C.gold:"transparent",color:page===p?C.black:C.lightGold,border:`1px solid ${page===p?C.gold:"#ffffff33"}`,borderRadius:20,padding:"4px 9px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>
              {p==="home"?"🏠":p==="events"?"🥁":"ℹ️"} {p[0].toUpperCase()+p.slice(1)}
            </button>
          ))}
          {/* Notifications */}
          <button onClick={()=>setShowNotifs(n=>!n)} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.85rem",position:"relative"}}>
            🔔
            {user&&<span style={{position:"absolute",top:-2,right:-2,background:C.kente1,borderRadius:"50%",width:8,height:8}}/>}
          </button>
          {/* Messages */}
          <button onClick={()=>{setShowMessaging(true);if(!user)setAuthModal("signup");}} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.85rem",position:"relative"}}>
            💬
            {MOCK_CONVERSATIONS.reduce((s,c)=>s+c.unread,0)>0&&<span style={{position:"absolute",top:-3,right:-3,background:C.kente1,borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.52rem",fontWeight:900,color:"white"}}>{MOCK_CONVERSATIONS.reduce((s,c)=>s+c.unread,0)}</span>}
          </button>
          {/* Favourites */}
          <button onClick={()=>setShowFavs(f=>!f)} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.85rem",position:"relative"}}>
            ❤️
            {favourites.length>0&&<span style={{position:"absolute",top:-4,right:-4,background:C.kente1,borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.55rem",fontWeight:900,color:"white"}}>{favourites.length}</span>}
          </button>
          {/* User */}
          {user?(
            <button onClick={()=>setPage("profile")} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"5px 10px",fontSize:"0.68rem",fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
              <span style={{background:C.darkBrown,color:C.gold,borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"0.6rem",fontWeight:900}}>{user.fullName?.[0]?.toUpperCase()||"U"}</span>
              {user.fullName?.split(" ")[0]}
            </button>
          ):(
            <button onClick={()=>setAuthModal("signup")} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"5px 10px",fontSize:"0.68rem",fontWeight:900,cursor:"pointer"}}>{T.signup.split(" ")[0]} Up</button>
          )}
          <button onClick={()=>setShowBizDash(true)} style={{background:"transparent",color:C.lightGold,border:"1px solid #ffffff33",borderRadius:20,padding:"4px 9px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>🏪 Biz</button>
          <button onClick={()=>setShowPayments(true)} style={{background:"transparent",color:C.lightGold,border:"1px solid #ffffff33",borderRadius:20,padding:"4px 9px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>💳 Pay</button>
        </div>
      </div>
    </div>
  );

  // Favourites drawer — renders every favourited id regardless of which category/page
  // is currently loaded, fetching each one individually via `FavDrawerItem`/`useListing`
  // (there's no complete client-side listing set to look the full details up from
  // anymore, and no Favourite backend model to batch-fetch them from either).
  const FavsDrawer=()=>{
    return <div style={{position:"fixed",inset:0,zIndex:999}} onClick={()=>setShowFavs(false)}>
      <div style={{position:"absolute",top:65,right:16,background:"white",borderRadius:16,width:300,maxHeight:400,overflowY:"auto",boxShadow:"0 8px 40px rgba(0,0,0,0.2)"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"14px 16px",borderBottom:"1px solid #f0f0f0",fontWeight:800,color:C.darkBrown,fontSize:"0.85rem"}}>❤️ Saved Businesses ({favourites.length})</div>
        {favourites.length===0&&<div style={{padding:"20px",textAlign:"center",color:"#aaa",fontSize:"0.78rem"}}>No saved businesses yet.<br/>Tap ❤️ on any listing to save it.</div>}
        {favourites.map(id=><FavDrawerItem key={id} id={id} onRemove={toggleFav}/>)}
      </div>
    </div>;
  };

  return (
    <div style={{fontFamily:"'Georgia',serif",background:C.cream,minHeight:"100vh"}}>
      {!cookieDismissed&&<CookieBanner onAccept={()=>{setCookieConsent(true);setCookieDismissed(true);Analytics.track("cookie_accepted");}} onDecline={()=>{setCookieDismissed(true);Analytics.track("cookie_declined");}}/>}
      <OfflineBanner/>
      {showMessaging&&<MessagingCenter user={user} onClose={()=>{setShowMessaging(false);setMessagingBusiness(null);}} initialBusiness={messagingBusiness}/>}
      {showNotifs&&<NotificationsPanel user={user} onClose={()=>setShowNotifs(false)}/>}
      {showFavs&&<FavsDrawer/>}
      {showReferral&&<ReferralModal user={user} onClose={()=>setShowReferral(false)}/>}
      <Header/>

      {page==="home"&&(
        <>
          {/* Hero */}
          <div style={{padding:"40px 20px 36px",textAlign:"center",position:"relative",overflow:"hidden",minHeight:280}}>
            {/* Real Manhyia Palace photo */}
            <div style={{position:"absolute",inset:0,backgroundImage:`url(${KUMASI_PHOTOS.manhyiaPalace})`,backgroundSize:"cover",backgroundPosition:"center top"}}/>
            {/* Dark gradient overlay */}
            <div style={{position:"absolute",inset:0,background:`linear-gradient(160deg,rgba(204,0,0,0.85),rgba(44,24,16,0.9),rgba(0,0,128,0.85))`}}/>
            <div style={{position:"absolute",inset:0,opacity:0.04,backgroundImage:`repeating-linear-gradient(45deg,${C.gold} 0px,${C.gold} 2px,transparent 2px,transparent 20px),repeating-linear-gradient(-45deg,${C.gold} 0px,${C.gold} 2px,transparent 2px,transparent 20px)`}}/>
            <div style={{position:"absolute",bottom:0,left:0,right:0,height:5,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
            <div style={{position:"relative"}}>
              <div style={{fontSize:"2rem",marginBottom:8}}>👑</div>
              <h1 style={{color:"white",fontSize:"clamp(1.3rem,4vw,2rem)",fontWeight:900,margin:"0 0 8px"}}>{T.welcome.split("—")[0]}<span style={{color:C.gold}}>—</span>{T.welcome.split("—")[1]}</h1>
              <p style={{color:C.lightGold,fontSize:"0.82rem",margin:"0 auto 20px",maxWidth:460,lineHeight:1.6,opacity:0.9}}>{T.tagline}</p>
              {!user&&(
                <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:16,flexWrap:"wrap"}}>
                  <button onClick={()=>setAuthModal("signup")} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:30,padding:"9px 20px",fontWeight:900,fontSize:"0.82rem",cursor:"pointer",fontFamily:"inherit"}}>✨ {T.signup}</button>
                  <button onClick={()=>setAuthModal("login")} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"1.5px solid rgba(255,255,255,0.4)",borderRadius:30,padding:"9px 20px",fontWeight:700,fontSize:"0.82rem",cursor:"pointer",fontFamily:"inherit"}}>{T.login}</button>
                </div>
              )}
              {user&&<div style={{background:"rgba(255,255,255,0.12)",borderRadius:30,padding:"6px 16px",display:"inline-flex",gap:10,alignItems:"center",marginBottom:16}}>
                <span style={{color:C.lightGold,fontSize:"0.78rem"}}>👋 Akwaaba, <strong style={{color:C.gold}}>{user.fullName?.split(" ")[0]}</strong>!</span>
                <button onClick={()=>setShowReferral(true)} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"3px 10px",fontSize:"0.62rem",fontWeight:800,cursor:"pointer"}}>🎁 Refer & Earn</button>
              </div>}
              {/* Search — filters.search flows straight into useListings, scoped to the active category */}
              <div style={{position:"relative",maxWidth:480,margin:"0 auto"}}>
                <div style={{display:"flex",borderRadius:30,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.3)"}}>
                  <input
                    value={filters.search||""}
                    onChange={e=>{setFilters(f=>({...f,search:e.target.value}));setShowSearchResults(true);}}
                    onFocus={()=>{setSearchFocused(true);setShowSearchResults(true);}}
                    onBlur={()=>setTimeout(()=>{setSearchFocused(false);setShowSearchResults(false);},200)}
                    placeholder={T.search}
                    style={{flex:1,padding:"13px 18px",border:"none",fontSize:"0.85rem",background:"white",outline:"none",fontFamily:"inherit"}}/>
                  {filters.search&&<button onClick={()=>{setFilters(f=>({...f,search:""}));setShowSearchResults(false);}} style={{background:"white",border:"none",padding:"0 8px",cursor:"pointer",color:"#aaa",fontSize:"1.1rem"}}>✕</button>}
                  <button onClick={()=>setShowFilters(f=>!f)} style={{background:"#f5f5f5",border:"none",padding:"13px 14px",cursor:"pointer",fontSize:"0.85rem"}} title="Filters">⚙️</button>
                  <button style={{background:C.gold,color:C.black,border:"none",padding:"13px 18px",fontWeight:900,cursor:"pointer"}}>🔍</button>
                </div>

                {/* Search Dropdown — popular-suggestion quick-fill only when the box is empty; once
                    there's a query, results come live from the grid below via filters.search, so the
                    dropdown just gets out of the way (the old cross-category preview here required
                    the full in-memory LISTINGS set, which no longer exists client-side). */}
                {showSearchResults&&searchFocused&&!filters.search&&(
                  <div style={{position:"absolute",top:"calc(100% + 8px)",left:0,right:0,background:"white",borderRadius:16,boxShadow:"0 8px 40px rgba(0,0,0,0.2)",zIndex:500,overflow:"hidden",maxHeight:420,overflowY:"auto"}}>
                    <div style={{padding:"12px"}}>
                      <div style={{fontSize:"0.68rem",color:"#aaa",fontWeight:700,padding:"4px 8px 8px"}}>🔥 POPULAR SEARCHES</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {SEARCH_SUGGESTIONS.map(s=>(
                          <button key={s} onClick={()=>{setFilters(f=>({...f,search:s}));setShowSearchResults(false);}}
                            style={{background:`${C.gold}15`,color:C.darkBrown,border:`1px solid ${C.gold}33`,borderRadius:20,padding:"5px 12px",fontSize:"0.72rem",fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                            🔍 {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {/* Quick action buttons */}
              <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:12,flexWrap:"wrap"}}>
                <button onClick={()=>setShowMap(m=>!m)} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"1px solid rgba(255,255,255,0.3)",borderRadius:20,padding:"5px 12px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer"}}>
                  {showMap?"📋 List View":"🗺️ Map View"}
                </button>
                <button onClick={()=>setShowFavs(true)} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"1px solid rgba(255,255,255,0.3)",borderRadius:20,padding:"5px 12px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer"}}>
                  ❤️ Saved ({favourites.length})
                </button>
                {user&&<button onClick={()=>setShowReferral(true)} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"1px solid rgba(255,255,255,0.3)",borderRadius:20,padding:"5px 12px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer"}}>
                  🎁 Refer & Earn GHS 10
                </button>}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div style={{background:C.gold,padding:"10px 16px",display:"flex",justifyContent:"center",gap:"clamp(12px,4vw,50px)",flexWrap:"wrap"}}>
            {[["100K+","Annual Visitors"],["15","Categories"],["65+","Businesses"],["4","Currencies"]].map(([n,l])=>(
              <div key={l} style={{textAlign:"center"}}>
                <div style={{fontWeight:900,fontSize:"1rem",color:C.darkBrown}}>{n}</div>
                <div style={{fontSize:"0.58rem",color:C.darkBrown,opacity:0.8}}>{l}</div>
              </div>
            ))}
          </div>

          {/* WhatsApp notice */}
          <div style={{background:`${C.whatsapp}12`,borderBottom:`1.5px solid ${C.whatsapp}30`,padding:"8px 16px",textAlign:"center"}}>
            <span style={{fontSize:"0.72rem",color:"#1a5c2e",fontWeight:600}}>
              📱 Every business is WhatsApp-connected
              {!user&&<span> — <span onClick={()=>setAuthModal("signup")} style={{color:C.kente2,cursor:"pointer",fontWeight:800,textDecoration:"underline"}}>Sign up free</span> to message businesses instantly</span>}
            </span>
          </div>

          {/* Filters panel — all four inputs write straight into `filters`, which is useListings'
              query key. "Min Rating" was dropped: the real Listing model has no rating field, so it
              could never do anything meaningful; a Min/Max Price range (which the backend and
              useListings already support via min_price/max_price) replaces it. */}
          {showFilters&&(
            <div style={{background:"white",borderBottom:"1px solid #f0f0f0",padding:"14px 16px"}}>
              <div style={{maxWidth:960,margin:"0 auto",display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
                <div>
                  <label style={{fontSize:"0.68rem",fontWeight:700,color:C.darkBrown,marginBottom:3,display:"block"}}>Sort By</label>
                  <select value={filters.ordering||""} onChange={e=>setFilters(f=>({...f,ordering:e.target.value||undefined}))} style={{padding:"6px 10px",borderRadius:10,border:"1.5px solid #ddd",fontSize:"0.74rem",background:"white",fontFamily:"inherit"}}>
                    <option value="">🆕 Newest</option>
                    <option value="price_amount">💰 Lowest Price</option>
                    <option value="-price_amount">💰 Highest Price</option>
                  </select>
                </div>
                <div>
                  <label style={{fontSize:"0.68rem",fontWeight:700,color:C.darkBrown,marginBottom:3,display:"block"}}>Zone</label>
                  <select value={filters.zone||""} onChange={e=>setFilters(f=>({...f,zone:e.target.value||undefined}))} style={{padding:"6px 10px",borderRadius:10,border:"1.5px solid #ddd",fontSize:"0.74rem",background:"white",fontFamily:"inherit"}}>
                    <option value="">All Zones</option>
                    {(zones||[]).map(z=><option key={z.id} value={z.name}>{z.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:"0.68rem",fontWeight:700,color:C.darkBrown,marginBottom:3,display:"block"}}>Min Price (GHS)</label>
                  <input type="number" min="0" placeholder="Any" value={filters.minPrice??""} onChange={e=>setFilters(f=>({...f,minPrice:e.target.value===""?undefined:Number(e.target.value)}))} style={{width:80,padding:"6px 10px",borderRadius:10,border:"1.5px solid #ddd",fontSize:"0.74rem",background:"white",fontFamily:"inherit"}}/>
                </div>
                <div>
                  <label style={{fontSize:"0.68rem",fontWeight:700,color:C.darkBrown,marginBottom:3,display:"block"}}>Max Price (GHS)</label>
                  <input type="number" min="0" placeholder="Any" value={filters.maxPrice??""} onChange={e=>setFilters(f=>({...f,maxPrice:e.target.value===""?undefined:Number(e.target.value)}))} style={{width:80,padding:"6px 10px",borderRadius:10,border:"1.5px solid #ddd",fontSize:"0.74rem",background:"white",fontFamily:"inherit"}}/>
                </div>
                <button onClick={()=>setFilters(f=>({category:f.category,search:f.search}))} style={{background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:20,padding:"6px 14px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer",marginTop:14}}>
                  ✕ Clear Filters
                </button>
              </div>
            </div>
          )}

          {/* Category tabs — the old cross-category smart-search results banner that lived here has
              been removed along with the smart-search engine (see note above); the search box's
              results now just show up in the grid below, scoped to the active category tab. */}
          <div style={{maxWidth:960,margin:"0 auto",padding:"16px 14px 0"}}>
            <div style={{display:"flex",gap:7,overflowX:"auto",paddingBottom:4,scrollbarWidth:"none"}}>
              {(categories||[]).map(cat=>(
                <button key={cat.id} onClick={()=>setFilters(f=>({...f,category:cat.slug}))} style={{background:filters.category===cat.slug?cat.color:"white",color:filters.category===cat.slug?"white":C.black,border:`2px solid ${cat.color}`,borderRadius:30,padding:"6px 12px",fontSize:"0.72rem",fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",boxShadow:filters.category===cat.slug?`0 4px 12px ${cat.color}55`:"none",transition:"all 0.2s"}}>
                  {cat.icon} {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Map or List */}
          <div style={{maxWidth:960,margin:"0 auto",padding:"16px 14px 40px"}}>
            {showMap&&<MapView listings={listings}/>}
            {filters.category==="grocery"?(
              <div style={{background:"white",borderRadius:16,padding:"24px",textAlign:"center",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
                <div style={{fontSize:"2.5rem",marginBottom:10}}>🛒</div>
                <div style={{fontWeight:900,color:C.darkBrown,marginBottom:6}}>Grocery Concierge</div>
                <div style={{color:"#555",fontSize:"0.82rem",marginBottom:16,lineHeight:1.6}}>We shop Kejetia Market for you. Fresh groceries delivered to your hotel, home or office in Kumasi.</div>
                <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
                  {["🍌 Plantain","🍅 Tomatoes","🍗 Chicken","🍚 Rice","🐟 Tilapia","🥚 Eggs"].map(item=>(
                    <span key={item} style={{background:`${C.kente2}15`,color:C.kente2,borderRadius:20,padding:"4px 12px",fontSize:"0.72rem",fontWeight:600}}>{item}</span>
                  ))}
                </div>
                <button onClick={()=>handleWA({phone:"233244999000",name:"AshantiHub Grocery Concierge"})} style={{marginTop:16,background:C.whatsapp,color:"white",border:"none",borderRadius:30,padding:"11px 24px",fontWeight:900,cursor:"pointer",fontFamily:"inherit",fontSize:"0.85rem"}}>
                  📱 Order via WhatsApp
                </button>
              </div>
            ):(
              <>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <h2 style={{margin:0,color:C.darkBrown,fontSize:"0.95rem",fontWeight:900}}>
                    {activeCatObj?.icon} {activeCatObj?.label}
                    <span style={{color:"#999",fontWeight:400,fontSize:"0.72rem",marginLeft:6}}>{listings.length} results</span>
                  </h2>
                  <div style={{display:"flex",gap:6,alignItems:"center"}}>
                    <span style={{background:`${activeCatObj?.color}15`,border:`1px solid ${activeCatObj?.color}44`,borderRadius:20,padding:"3px 9px",fontSize:"0.65rem",color:activeCatObj?.color,fontWeight:700}}>📍 Kumasi</span>
                  </div>
                </div>

                {/* Airport info banner — shows only on transport tab */}
                {filters.category==="transport"&&(
                  <div style={{background:`linear-gradient(135deg,#003087,#001a5e)`,borderRadius:16,padding:"16px 18px",marginBottom:16,color:"white"}}>
                    <div style={{fontWeight:900,color:C.ghGold,marginBottom:8,fontSize:"0.88rem"}}>✈️ Getting to Kumasi — Airport Guide</div>
                    <div style={{fontSize:"0.74rem",opacity:0.9,lineHeight:1.7,marginBottom:10}}>
                      <strong style={{color:C.ghGold}}>Kumasi Airport (KMS)</strong> — Prempeh I International Airport is located 8km from the city centre.
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:8,marginBottom:10}}>
                      {[
                        {icon:"✈️",title:"From Accra by Air",desc:"40 min flight • Africa World Airlines & PassionAir • 7+ daily flights"},
                        {icon:"🚌",title:"From Accra by Road",desc:"4–5 hours • VIP Jeoun, STC buses • From GHS 85"},
                        {icon:"🚐",title:"Airport to City",desc:"20 min drive • Pre-book transfer on AshantiHub"},
                        {icon:"🌍",title:"International Flights",desc:"Fly to Accra (KIA) first, then connect to Kumasi"},
                      ].map(t=>(
                        <div key={t.title} style={{background:"rgba(255,255,255,0.1)",borderRadius:10,padding:"10px 12px"}}>
                          <div style={{fontSize:"1.2rem",marginBottom:4}}>{t.icon}</div>
                          <div style={{fontWeight:800,fontSize:"0.74rem",marginBottom:2}}>{t.title}</div>
                          <div style={{fontSize:"0.65rem",opacity:0.8,lineHeight:1.4}}>{t.desc}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{background:"rgba(255,255,255,0.12)",borderRadius:10,padding:"8px 12px",fontSize:"0.68rem",opacity:0.85}}>
                      💡 <strong>Pro tip:</strong> International visitors should fly into Kotoka International Airport (ACC) in Accra, then book the Accra–Kumasi domestic flight with Africa World Airlines or PassionAir. Book your airport transfer below.
                    </div>
                  </div>
                )}
                {listingsLoading ? (
                  <ListingsSkeleton/>
                ) : listingsError ? (
                  <div style={{textAlign:"center",padding:"30px"}}>
                    Something went wrong loading listings.{" "}
                    <button onClick={()=>refetchListings()} style={{background:"none",border:`1px solid ${C.kente1}`,color:C.kente1,borderRadius:20,padding:"4px 12px",fontSize:"0.75rem",fontWeight:700,cursor:"pointer"}}>Retry</button>
                  </div>
                ) : listings.length===0 ? (
                  <div style={{textAlign:"center",padding:"40px",color:"#aaa"}}>
                    <div style={{fontSize:"2rem",marginBottom:8}}>🔍</div>
                    <div>No results found. Try adjusting your filters.</div>
                  </div>
                ) : (
                  <>
                    {listingsFetching&&<div style={{height:3,background:C.gold,marginBottom:10,borderRadius:2}}/>}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(245px,1fr))",gap:14}}>
                      {listings.map(item=><Card key={item.id} item={item} accentColor={activeCatObj?.color} onWhatsApp={handleWA} user={user} favourites={favourites} onFavourite={toggleFav} currency={currency} onMessage={(biz)=>{setMessagingBusiness(biz);setShowMessaging(true);if(!user)setAuthModal("signup");}}/>)}
                    </div>
                    {hasNextPage&&(
                      <div style={{textAlign:"center",marginTop:18}}>
                        <button onClick={()=>fetchNextPage()} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:30,padding:"9px 24px",fontWeight:900,fontSize:"0.8rem",cursor:"pointer",fontFamily:"inherit"}}>Load more</button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Ghana flag divider */}
          <div style={{height:10,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>

          {/* CTA */}
          <div style={{background:C.darkBrown,padding:"28px 20px",textAlign:"center"}}>
            <div style={{fontSize:"1.8rem",marginBottom:6}}>🏪</div>
            <h3 style={{color:C.gold,margin:"0 0 6px",fontSize:"1rem"}}>Own a Business in Ashanti?</h3>
            <p style={{color:C.lightGold,fontSize:"0.78rem",margin:"0 0 14px",opacity:0.85}}>First 3 months FREE. WhatsApp-connected listings.</p>
            <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
              <button onClick={()=>setPage("register")} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:30,padding:"10px 22px",fontWeight:900,fontSize:"0.82rem",cursor:"pointer",fontFamily:"inherit"}}>Register Your Business →</button>
              <button onClick={()=>setShowBizDash(true)} style={{background:"transparent",color:C.lightGold,border:"1.5px solid #ffffff44",borderRadius:30,padding:"10px 22px",fontWeight:700,fontSize:"0.78rem",cursor:"pointer",fontFamily:"inherit"}}>🏪 Business Dashboard</button>
            </div>
          </div>

          {/* Referral CTA */}
          {user&&(
            <div style={{background:`linear-gradient(135deg,${C.kente1},${C.kente3})`,padding:"22px 20px",textAlign:"center"}}>
              <div style={{fontSize:"1.5rem",marginBottom:6}}>🎁</div>
              <div style={{color:C.gold,fontWeight:900,marginBottom:4,fontSize:"0.95rem"}}>Refer friends & earn GHS 10 each</div>
              <div style={{color:"white",fontSize:"0.75rem",marginBottom:12,opacity:0.85}}>Share AshantiHub and earn mobile money credit for every friend who signs up.</div>
              <button onClick={()=>setShowReferral(true)} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:30,padding:"9px 22px",fontWeight:900,fontSize:"0.82rem",cursor:"pointer",fontFamily:"inherit"}}>Get My Referral Code →</button>
            </div>
          )}
        </>
      )}

      {/* Events page */}
      {page==="events"&&(
        <div style={{maxWidth:700,margin:"0 auto",padding:"24px 20px"}}>
          {/* Events hero with real photo */}
          <div style={{borderRadius:18,overflow:"hidden",marginBottom:20,position:"relative",height:200}}>
            <img src={KUMASI_PHOTOS.akwasidae} alt="Akwasidae Festival Kumasi" style={{width:"100%",height:"100%",objectFit:"cover"}}
              onError={e=>{e.target.parentNode.style.background=`linear-gradient(135deg,${C.kente1},${C.darkBrown})`;e.target.style.display="none";}}/>
            <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(0,0,0,0.7),transparent)"}}/>
            <div style={{position:"absolute",bottom:16,left:16,color:"white"}}>
              <div style={{fontWeight:900,fontSize:"1.2rem"}}>🥁 Upcoming Events</div>
              <div style={{fontSize:"0.76rem",opacity:0.85}}>Plan your visit around Kumasi's cultural calendar</div>
            </div>
          </div>
          {[{name:"Akwasidae Festival",date:"Jun 22, 2026",desc:"The Asantehene receives homage — drumming, dancing and royal regalia.",color:C.kente1},{name:"Akwasidae Festival",date:"Aug 3, 2026",desc:"Next major gathering at Manhyia Palace.",color:C.gold},{name:"Kumasi Cultural Festival",date:"Sep 15, 2026",desc:"City-wide celebration of Ashanti arts, food, music and tradition.",color:C.kente2}].map((f,i)=>(
            <div key={i} style={{background:"white",borderRadius:16,overflow:"hidden",boxShadow:"0 4px 16px rgba(0,0,0,0.08)",borderLeft:`5px solid ${f.color}`,marginBottom:14}}>
              {i===0&&<img src={KUMASI_PHOTOS.akwasidae} alt={f.name} style={{width:"100%",height:120,objectFit:"cover",display:"block"}} onError={e=>e.target.style.display="none"}/>}
              {i===0&&<div style={{height:3,background:`linear-gradient(90deg,${C.ghRed},${C.ghGold},${C.ghGreen})`}}/>}
              <div style={{padding:16,display:"flex",gap:14,alignItems:"flex-start"}}>
                <div style={{background:f.color,color:"white",borderRadius:12,padding:"8px 10px",textAlign:"center",minWidth:55,fontSize:"0.65rem",fontWeight:700,flexShrink:0}}>{f.date.split(" ").slice(0,2).join("\n")}</div>
                <div>
                  <div style={{fontWeight:800,marginBottom:4}}>{f.name}</div>
                  <div style={{color:"#555",fontSize:"0.78rem",lineHeight:1.5,marginBottom:8}}>{f.desc}</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <span style={{background:`${C.gold}22`,color:C.deepGold,fontSize:"0.65rem",fontWeight:700,padding:"2px 9px",borderRadius:20}}>📍 Manhyia Palace</span>
                    <WABtn phone="233244000000" name="AshantiHub Events" style={{fontSize:"0.62rem",padding:"3px 9px"}}/>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* About page */}
      {page==="about"&&(
        <div style={{maxWidth:640,margin:"0 auto",padding:"24px 20px"}}>
          {/* About hero with real Kejetia photo */}
          <div style={{borderRadius:18,overflow:"hidden",marginBottom:20,position:"relative",height:180}}>
            <img src={KUMASI_PHOTOS.kejetiaMarket} alt="Kejetia Market Kumasi" style={{width:"100%",height:"100%",objectFit:"cover"}}
              onError={e=>{e.target.parentNode.style.background=`linear-gradient(135deg,${C.darkBrown},${C.kente3})`;e.target.style.display="none";}}/>
            <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(44,24,16,0.85),rgba(0,0,0,0.3))"}}/>
            <div style={{position:"absolute",bottom:0,left:0,right:0,padding:"18px 20px",display:"flex",alignItems:"flex-end",gap:12}}>
              <Flag w={60} h={40}/>
              <div>
                <div style={{color:C.gold,fontWeight:900,fontSize:"1.2rem"}}>👑 AshantiHub</div>
                <div style={{color:"white",fontSize:"0.72rem",opacity:0.85}}>The Marketplace of Ashanti — built for Ashanti, by Ashanti</div>
              </div>
            </div>
          </div>
          {[{icon:"🎯",title:"Our Mission",body:"Connect 100,000+ annual visitors and locals with the best businesses across 15 categories — all in one WhatsApp-powered platform."},{icon:"📊",title:"Data-Driven",body:"Customer accounts give us rich data — nationality, visit purpose, dates — helping us serve businesses and visitors better."},{icon:"📱",title:"WhatsApp-First",body:"Every business connects via WhatsApp. Customers message directly in one tap. No complicated checkout."},{icon:"🔒",title:"Verified & Secure",body:"All businesses verified with Ghana Card. Customer data protected under Ghana's Data Protection Act 2012."}].map((s,i)=>(
            <div key={i} style={{background:"white",borderRadius:16,padding:"16px 20px",marginBottom:12,boxShadow:"0 2px 12px rgba(0,0,0,0.07)",display:"flex",gap:14}}>
              <div style={{fontSize:"1.6rem",minWidth:36,textAlign:"center"}}>{s.icon}</div>
              <div>
                <div style={{fontWeight:800,color:C.darkBrown,marginBottom:5}}>{s.title}</div>
                <div style={{color:"#555",fontSize:"0.8rem",lineHeight:1.6}}>{s.body}</div>
              </div>
            </div>
          ))}
          <div style={{textAlign:"center",marginTop:8,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
            {!user&&<button onClick={()=>setAuthModal("signup")} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:30,padding:"10px 22px",fontWeight:900,fontSize:"0.82rem",cursor:"pointer",fontFamily:"inherit"}}>Create Free Account</button>}
            <button onClick={()=>setPage("register")} style={{background:C.kente2,color:"white",border:"none",borderRadius:30,padding:"10px 22px",fontWeight:900,fontSize:"0.82rem",cursor:"pointer",fontFamily:"inherit"}}>Register Business</button>
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{background:C.black,color:C.lightGold,textAlign:"center",padding:"20px",fontSize:"0.7rem",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:5,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
        <div style={{paddingTop:8}}>
          <div style={{marginBottom:4}}>
            <span style={{color:C.ghRed}}>★</span><span style={{color:C.ghGold}}>★</span><span style={{color:C.ghGreen}}>★</span>
            {"  "}<strong style={{color:C.gold}}>AshantiHub</strong>{"  "}
            <span style={{color:C.ghGreen}}>★</span><span style={{color:C.ghGold}}>★</span><span style={{color:C.ghRed}}>★</span>
          </div>
          <div style={{fontSize:"0.65rem",color:C.gold,fontWeight:600,marginBottom:4}}>The Marketplace of Ashanti 👑 • The Pride of Ghana 🇬🇭</div>
          <div style={{opacity:0.6,marginBottom:10,fontSize:"0.62rem"}}>Kumasi, Ashanti Region, Ghana • info@ashantihub.com</div>
          <div style={{display:"flex",justifyContent:"center",gap:12,flexWrap:"wrap",marginBottom:8}}>
            {[["terms","Terms & Conditions"],["privacy","Privacy Policy"],["business","Business Agreement"]].map(([doc,label])=>(
              <span key={doc} onClick={()=>setLegalDoc(doc)} style={{color:C.gold,cursor:"pointer",textDecoration:"underline",fontWeight:600,fontSize:"0.65rem"}}>{label}</span>
            ))}
          </div>
          <div style={{opacity:0.4,fontSize:"0.58rem"}}>© 2026 AshantiHub Ltd. All Rights Reserved • Registered under Ghana Companies Act 2019 • Data Protection Commission Registered</div>
        </div>
      </div>

      {/* Floating WhatsApp */}
      <div onClick={()=>user?window.open("https://wa.me/233244000000","_blank"):setAuthModal("signup")}
        style={{position:"fixed",bottom:cookieDismissed?24:100,right:20,background:C.whatsapp,color:"white",borderRadius:"50%",width:50,height:50,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 20px rgba(37,211,102,0.5)",zIndex:998,cursor:"pointer"}}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
      </div>
    </div>
  );
}
