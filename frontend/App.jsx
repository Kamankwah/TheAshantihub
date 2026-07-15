import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate, useMatch } from "react-router-dom";
import { useCategories } from "./hooks/useCategories.js";
import { useZones } from "./hooks/useZones.js";
import { useListings } from "./hooks/useListings.js";
import { useListing } from "./hooks/useListing.js";
import { useEvents } from "./hooks/useEvents.js";
import { useAuth } from "./hooks/useAuth.js";
import { useTheme } from "./hooks/useTheme.js";
import { useKYCQueue } from "./hooks/useKYCQueue.js";
import { useModerationQueue } from "./hooks/useModerationQueue.js";
import { useHeroModerationQueue } from "./hooks/useHeroModerationQueue.js";
import { useCustomers } from "./hooks/useCustomers.js";
import { useBusinessOwners } from "./hooks/useBusinessOwners.js";
import { useStaffRoster } from "./hooks/useStaffRoster.js";
import { useMyListings } from "./hooks/useMyListings.js";
import { useMyHeroSubmission } from "./hooks/useMyHeroSubmission.js";
import { useBusinessProfile } from "./hooks/useBusinessProfile.js";
import { useSubscriptionPlans } from "./hooks/useSubscriptionPlans.js";
import { useMySubscription } from "./hooks/useMySubscription.js";
import { useMyTransactions } from "./hooks/useMyTransactions.js";
import { useMyCreditScore } from "./hooks/useMyCreditScore.js";
import { useCart } from "./hooks/useCart.js";
import { useSiteSettings } from "./hooks/useSiteSettings.js";
import { apiPost, apiPatch } from "./apiClient.js";
import { C, CURRENCIES } from "./theme.js";
import Flag from "./components/Flag.jsx";
import Navbar from "./components/Navbar.jsx";
import Hero from "./components/Hero.jsx";
import HeroCarousel from "./components/HeroCarousel.jsx";
import Sidebar from "./components/Sidebar.jsx";
import ListingDetailPage from "./components/ListingDetailPage.jsx";
import ChatLauncher from "./components/ChatLauncher.jsx";
import { Footer2 } from "./components/ui/footer-2.tsx";
import { BusinessCtaBand } from "./components/ui/business-cta-band.tsx";
import { HomeCtaBand } from "./components/ui/home-cta-band.tsx";
import { EventsCtaBand } from "./components/ui/events-cta-band.tsx";
import { AboutCtaBand } from "./components/ui/about-cta-band.tsx";
import { ContactCtaBand } from "./components/ui/contact-cta-band.tsx";
import AccountPanel from "./components/AccountPanel.jsx";
import BusinessRegistrationFlow from "./components/BusinessRegistrationFlow.jsx";
import CartDrawer from "./components/CartDrawer.jsx";
import EventHeroCarousel from "./components/EventHeroCarousel.jsx";
import EventCard from "./components/EventCard.jsx";
import EventDetailPage from "./components/EventDetailPage.jsx";
import EventSubmissionPanel from "./components/EventSubmissionPanel.jsx";

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

// Mirrors the "Score Bands & Loan Access" table below — a client-side-only
// mapping from score to an illustrative max loan amount. The backend's naive
// scoring stub (backend/credit/scoring.py) does not compute a max loan value.
function maxLoanForScore(score) {
  if(score >= 800) return 50000;
  if(score >= 700) return 25000;
  if(score >= 600) return 10000;
  if(score >= 500) return 5000;
  return 0;
}

// Labels/icons for the real factor keys returned by GET /api/credit/scores/me/
// (backend/credit/scoring.py) — replaces the old mock SCORE_FACTORS shape for
// the real per-owner factor breakdown.
const CREDIT_FACTOR_META = {
  listings_published: { icon:"🏷️", label:"Published Listings", desc:"Number of your listings that are live on AshantiHub (up to 10 counted)" },
  account_tenure_months: { icon:"📅", label:"Account Tenure", desc:"How long your business has been on AshantiHub (up to 24 months counted)" },
  kyc_verified: { icon:"🪪", label:"KYC Verified", desc:"Whether your Ghana Card / business KYC has been verified by AshantiHub staff" },
  payout_verified: { icon:"🏦", label:"Payout Details Verified", desc:"Whether your MoMo/bank payout details have been verified" },
};

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
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [loanAmount, setLoanAmount] = useState("");
  const [loanPurpose, setLoanPurpose] = useState("");
  const [loanSubmitted, setLoanSubmitted] = useState(false);

  // Real, single-business-owner data. The backend (GET /api/credit/scores/me/)
  // only exposes the current business owner's own score — there is no
  // aggregate/multi-business endpoint on the client, so (unlike the old mock
  // MOCK_CREDIT_BUSINESSES-driven UI) this dashboard shows one score, not a
  // browsable list/dropdown of businesses.
  const { data: scoreData, isLoading, isError, refetch } = useMyCreditScore();
  const score = scoreData?.score ?? null;
  const maxLoan = score != null ? maxLoanForScore(score) : 0;
  const loanEligible = scoreData?.loan_eligible ?? false;
  const matchedPartners = score != null ? LENDING_PARTNERS.filter(p => p.minScore <= score) : [];

  const tabs = [
    { id:"overview", icon:"📊", label:"Credit Overview" },
    { id:"score", icon:"🏅", label:"My Score" },
    { id:"partners", icon:"🤝", label:"Lending Partners" },
    { id:"apply", icon:"📋", label:"Loan Application" },
    { id:"insights", icon:"💡", label:"Insights" },
  ];

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

        {isLoading && (
          <div style={{ color:"#888", fontSize:"0.85rem", textAlign:"center", padding:"60px 0" }}>Loading your AshantiHub Credit Score…</div>
        )}

        {isError && (
          <div style={{ background:"white", borderRadius:16, padding:"30px 24px", textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
            <div style={{ color:"#dc2626", fontWeight:700, fontSize:"0.85rem", marginBottom:14 }}>Could not load your AshantiHub Credit Score. Make sure you're signed in as a business owner.</div>
            <button onClick={()=>refetch()} style={{ background:C.gold, color:C.darkBrown, border:"none", borderRadius:20, padding:"8px 18px", fontWeight:800, cursor:"pointer", fontFamily:"inherit" }}>Retry</button>
          </div>
        )}

        {!isLoading && !isError && scoreData && (
          <>

        {/* ── OVERVIEW ── */}
        {creditTab === "overview" && (
          <>
            {/* Hero banner */}
            <div style={{ background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`, borderRadius:18, padding:"24px", marginBottom:22, color:"white" }}>
              <div style={{ fontWeight:900, fontSize:"1.1rem", color:C.gold, marginBottom:6 }}>🏅 AshantiHub Credit Score System</div>
              <div style={{ fontSize:"0.82rem", opacity:0.9, lineHeight:1.7, marginBottom:14 }}>
                Every business on AshantiHub earns a <strong style={{ color:C.gold }}>Credit Score (300–1000)</strong> based on their platform activity. This score unlocks access to business loans from our banking and microfinance partners — with no collateral required.
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
                {[
                  { icon:"🏅", label:"Your Score", value:score },
                  { icon:"📊", label:"Grade", value:`${scoreData.grade} — ${scoreData.grade_label}` },
                  { icon: loanEligible?"✅":"❌", label:"Loan Status", value: loanEligible?"Eligible":"Not yet eligible" },
                  { icon:"💰", label:"Max Loan", value: maxLoan>0?`GHS ${maxLoan.toLocaleString()}`:"—" },
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
              <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:16, fontSize:"0.92rem" }}>⚙️ How Your Credit Score is Calculated</div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {Object.entries(scoreData.factors||{}).map(([key,f]) => {
                  const meta = CREDIT_FACTOR_META[key] || { icon:"📌", label:key, desc:"" };
                  return (
                    <div key={key} style={{ display:"flex", gap:12, alignItems:"center", padding:"10px", background:"#f9f9f9", borderRadius:12 }}>
                      <div style={{ fontSize:"1.4rem", width:36, textAlign:"center" }}>{meta.icon}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                          <span style={{ fontWeight:700, fontSize:"0.8rem", color:C.darkBrown }}>{meta.label}</span>
                          <span style={{ fontWeight:900, color:C.gold, fontSize:"0.78rem" }}>{Math.round(f.weight*100)}% weight</span>
                        </div>
                        <div style={{ fontSize:"0.68rem", color:"#888", marginBottom:4 }}>{meta.desc}</div>
                        <div style={{ height:6, background:"#e0e0e0", borderRadius:10, overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${f.score_pct}%`, background:`linear-gradient(90deg,${C.gold},${C.kente2})`, borderRadius:10 }}/>
                        </div>
                      </div>
                    </div>
                  );
                })}
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
                  { range:"300–499", grade:"D", label:"Not Eligible", color:C.kente1, maxLoan:"Not eligible yet", partners:"Build score first" },
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

        {/* ── MY SCORE ── */}
        {creditTab === "score" && (
          <div style={{ background:"white", borderRadius:16, padding:"22px", boxShadow:"0 4px 20px rgba(0,0,0,0.1)", border:`2px solid ${C.gold}33` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20, flexWrap:"wrap", gap:14 }}>
              <div>
                <div style={{ fontWeight:900, fontSize:"1.05rem", color:C.darkBrown, marginBottom:4 }}>{user?.fullName || "Your Business"}</div>
                <div style={{ fontSize:"0.74rem", color:"#888" }}>
                  AshantiHub Credit Score{scoreData.computed_at ? ` • computed ${new Date(scoreData.computed_at).toLocaleDateString("en-GH")}` : ""}
                </div>
              </div>
              <ScoreGauge score={score}/>
            </div>

            {/* Score breakdown */}
            <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:12, fontSize:"0.85rem" }}>📊 Score Breakdown</div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:18 }}>
              {Object.entries(scoreData.factors||{}).map(([key,f]) => {
                const meta = CREDIT_FACTOR_META[key] || { icon:"📌", label:key };
                const displayValue = typeof f.value === "boolean" ? (f.value ? "Verified" : "Not verified") : f.value;
                return (
                  <div key={key} style={{ display:"flex", gap:10, alignItems:"center" }}>
                    <span style={{ fontSize:"1rem", width:24 }}>{meta.icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3, fontSize:"0.72rem" }}>
                        <span style={{ fontWeight:600, color:C.darkBrown }}>{meta.label}</span>
                        <span style={{ color:"#888" }}>{String(displayValue)} <span style={{ color:"#aaa" }}>({Math.round(f.weight*100)}% weight)</span></span>
                      </div>
                      <div style={{ height:6, background:"#f0f0f0", borderRadius:10, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${f.score_pct}%`, background:getScoreColor(score), borderRadius:10 }}/>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {loanEligible ? (
              <button onClick={()=>{ setCreditTab("apply"); }}
                style={{ width:"100%", background:C.kente2, color:"white", border:"none", borderRadius:20, padding:"12px", fontWeight:900, cursor:"pointer", fontFamily:"inherit", fontSize:"0.88rem" }}>
                💰 Apply for a Business Loan →
              </button>
            ) : (
              <div style={{ background:"#fee2e2", borderRadius:10, padding:"10px 14px", fontSize:"0.7rem", color:"#dc2626", fontWeight:600, textAlign:"center" }}>
                ❌ Score too low — keep improving to unlock loans. See the Insights tab for tips.
              </div>
            )}
          </div>
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
            {!loanEligible && !loanSubmitted && (
              <div style={{ background:"white", borderRadius:18, padding:"40px 24px", textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
                <div style={{ fontSize:"2.6rem", marginBottom:12 }}>🔒</div>
                <div style={{ fontWeight:900, color:C.darkBrown, fontSize:"1rem", marginBottom:8 }}>Not loan-eligible yet</div>
                <div style={{ color:"#555", fontSize:"0.82rem", lineHeight:1.7, marginBottom:18, maxWidth:420, marginLeft:"auto", marginRight:"auto" }}>
                  Your current AshantiHub Credit Score is <strong>{score}</strong>. You need a score of at least <strong>600</strong> to apply for a loan through our lending partners.
                </div>
                <button onClick={()=>setCreditTab("insights")}
                  style={{ background:C.gold, color:C.darkBrown, border:"none", borderRadius:30, padding:"10px 22px", fontWeight:900, cursor:"pointer", fontFamily:"inherit" }}>
                  See how to improve your score →
                </button>
              </div>
            )}
            {/* loanSubmitted alone (not loanEligible && loanSubmitted) — once submitted, keep
                showing the confirmation even if a later score refetch (e.g. on window focus)
                drops loanEligible below 600, rather than leaving this tab blank. */}
            {loanSubmitted && (
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
                    ["Business", user?.fullName || "Your Business"],
                    ["Credit Score", score],
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
                  <button onClick={()=>setCreditTab("score")}
                    style={{ background:"#f0f0f0", color:"#666", border:"none", borderRadius:30, padding:"10px 22px", fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                    Back to My Score
                  </button>
                </div>
              </div>
            )}
            {loanEligible && !loanSubmitted && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, alignItems:"start" }}>
                {/* Application form */}
                <div style={{ background:"white", borderRadius:16, padding:"22px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
                  <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:16, fontSize:"0.92rem" }}>📝 Your Application</div>

                  {/* Loan amount */}
                  <div style={{ marginBottom:14 }}>
                    <label style={{ fontSize:"0.76rem", fontWeight:700, color:C.darkBrown, marginBottom:6, display:"block" }}>Loan Amount (GHS) *</label>
                    <input type="number" value={loanAmount} onChange={e=>setLoanAmount(e.target.value)}
                      placeholder={`Max: GHS ${maxLoan.toLocaleString()}`}
                      max={maxLoan}
                      style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`1.5px solid ${loanAmount&&Number(loanAmount)>maxLoan?"#ef4444":"#ddd"}`, fontSize:"0.85rem", fontFamily:"inherit", outline:"none", boxSizing:"border-box" }}/>
                    {loanAmount && Number(loanAmount) > maxLoan && (
                      <div style={{ fontSize:"0.68rem", color:"#ef4444", marginTop:3 }}>Exceeds your maximum eligible amount of GHS {maxLoan.toLocaleString()}</div>
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
                    <label style={{ fontSize:"0.76rem", fontWeight:700, color:C.darkBrown, marginBottom:6, display:"block" }}>Preferred Lender</label>
                    <select value={selectedPartner?.id||""} onChange={e=>setSelectedPartner(LENDING_PARTNERS.find(p=>p.id===Number(e.target.value))||null)}
                      style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:"1.5px solid #ddd", fontSize:"0.85rem", background:"white", fontFamily:"inherit", outline:"none" }}>
                      <option value="">Best match for my score</option>
                      {matchedPartners.map(p=>(
                        <option key={p.id} value={p.id}>{p.name} — {p.maxLoan}</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={()=>{ if(loanAmount&&loanPurpose&&Number(loanAmount)<=maxLoan) setLoanSubmitted(true); }}
                    style={{ width:"100%", background:loanAmount&&loanPurpose&&Number(loanAmount)<=maxLoan?C.kente2:"#ddd", color:"white", border:"none", borderRadius:20, padding:"12px", fontWeight:900, cursor:loanAmount&&loanPurpose?"pointer":"default", fontFamily:"inherit", fontSize:"0.88rem" }}>
                    🚀 Submit Application
                  </button>
                  <div style={{ fontSize:"0.65rem", color:"#aaa", marginTop:8, textAlign:"center" }}>Your AshantiHub Credit Score is shared with the lender. No collateral required for eligible businesses.</div>
                </div>

                {/* Score summary & partner match */}
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  {/* Your score card */}
                  <div style={{ background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`, borderRadius:16, padding:"20px", color:"white" }}>
                    <div style={{ fontWeight:800, color:C.gold, marginBottom:12, fontSize:"0.85rem" }}>Your Credit Score</div>
                    <ScoreGauge score={score}/>
                    <div style={{ marginTop:14, fontSize:"0.74rem", lineHeight:1.8, opacity:0.9 }}>
                      <div>✅ Loan eligible up to <strong style={{ color:C.gold }}>GHS {maxLoan.toLocaleString()}</strong></div>
                      <div>🤝 Eligible for <strong style={{ color:C.gold }}>{matchedPartners.length} of {LENDING_PARTNERS.length}</strong> partners</div>
                      <div>📈 Score improves with more listings, tenure and verification</div>
                    </div>
                  </div>

                  {/* Matched partners */}
                  <div style={{ background:"white", borderRadius:16, padding:"18px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
                    <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:12, fontSize:"0.85rem" }}>🤝 Your Matched Partners</div>
                    {matchedPartners.map(p=>(
                      <div key={p.id} style={{ display:"flex", gap:10, alignItems:"center", padding:"8px 0", borderBottom:"1px solid #f5f5f5" }}>
                        <div style={{ width:32, height:32, borderRadius:8, background:`${p.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1rem" }}>{p.logo}</div>
                        <div style={{ flex:1 }}>
                          <div style={{ fontWeight:700, fontSize:"0.76rem", color:C.darkBrown }}>{p.name}</div>
                          <div style={{ fontSize:"0.65rem", color:"#888" }}>{p.maxLoan} • {p.rate}</div>
                        </div>
                        <span style={{ background:"#22c55e20", color:"#22c55e", borderRadius:20, padding:"2px 7px", fontSize:"0.6rem", fontWeight:700 }}>✓ Match</span>
                      </div>
                    ))}
                    {matchedPartners.length===0 && (
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
                { icon:"🏷️", tip:"Publish more listings", impact:"up to 25% of score", action:"Get listings approved and published — this factor counts up to 10 published listings.", color:C.kente3 },
                { icon:"📅", tip:"Stay active longer", impact:"up to 20% of score", action:"The longer your business account exists on AshantiHub, the higher your tenure score (counted up to 24 months).", color:C.gold },
                { icon:"🪪", tip:"Complete KYC verification", impact:"up to 30% of score", action:"Submit your Ghana Card and business details for KYC review and get verified by AshantiHub staff.", color:"#7B2FBE" },
                { icon:"🏦", tip:"Verify your payout details", impact:"up to 25% of score", action:"Add and verify your MoMo/bank payout details in your Business Dashboard profile.", color:C.kente2 },
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

// SUBSCRIPTION_PLANS / MOCK_TRANSACTIONS / MOCK_INVOICES (mock data + the
// InvoiceModal component that rendered MOCK_INVOICES) were removed here —
// PaymentDashboard and BusinessDashboard's Subscription tab now read real
// data via useSubscriptionPlans/useMyTransactions/useMySubscription. There is
// no backend Invoice model (only Subscription + Transaction), so the old
// Invoices tab was dropped rather than left as dead mock UI.

// ─── MoMo Payment Component ───────────────────────────────────────────────────
// Exported (like Card/groupCategoriesByKind below) so it's reusable
// from frontend/components/* (CartDrawer's checkout step, Phase 4 —
// docs/BUSINESS_EVENTS_ROADMAP.md) without duplicating the simulated-payment
// UI. Passed down as a `PaymentComponent` prop rather than imported directly,
// same "avoid an App.jsx <-> components/ circular import" convention as
// ListingDetailPage's `CardComponent` prop.
export function MoMoPayment({ amount, purpose, businessName, onSuccess, onClose }) {
  const [step, setStep] = useState(1);
  const [network, setNetwork] = useState(null);
  const [phone, setPhone] = useState("");
  const [processing, setProcessing] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [success, setSuccess] = useState(false);
  const [txnRef] = useState(`AH${Date.now().toString().slice(-8)}`);

  useEffect(() => {
    if (step === 3 && !success) {
      let successTimeout;
      const timer = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) {
            clearInterval(timer);
            setSuccess(true);
            // Cancelled below on unmount/step-change — without this, closing the
            // modal in this 1s window still let onSuccess fire afterward, now
            // triggering real transaction/subscription writes (previously
            // harmless, since it only called a mock success handler).
            successTimeout = setTimeout(() => onSuccess && onSuccess(txnRef), 1000);
            return 0;
          }
          return c - 1;
        });
      }, 100);
      return () => { clearInterval(timer); clearTimeout(successTimeout); };
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

// ─── Payment Dashboard (Business Owner's own payment history) ─────────────────
function PaymentDashboard({ onClose }) {
  const [payTab, setPayTab] = useState("overview");
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [billingCycle, setBillingCycle] = useState("monthly");
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

  const statusColor = { success:"#22c55e", pending:"#f59e0b", failed:"#ef4444" };
  const statusLabel = { success:"Success", pending:"Pending", failed:"Failed" };

  const tabs = [
    { id:"overview", icon:"💰", label:"Overview" },
    { id:"transactions", icon:"📋", label:"Transactions" },
    { id:"subscribe", icon:"⭐", label:"Subscribe" },
    { id:"reminders", icon:"🔔", label:"Reminders" },
  ];

  const recordSubscriptionPayment = async (ref) => {
    setShowPayModal(false);
    if(!selectedPlan) return;
    setActionError(null);
    const amount = billingCycle==="monthly" ? Number(selectedPlan.monthly_price) : Number(selectedPlan.annual_price);
    try {
      await apiPost("/api/billing/transactions/mine/", {
        amount: amount.toFixed(2),
        purpose: `AshantiHub ${selectedPlan.name} Plan — ${billingCycle==="monthly"?"Monthly":"Annual"}`,
        reference: ref,
        status: "success",
      });
      await apiPost("/api/billing/subscriptions/me/", { plan: selectedPlan.tier, billing_cycle: billingCycle });
      refetchTx();
    } catch (err) {
      setActionError("Payment was confirmed but we couldn't record it on your account. Please contact support with reference " + ref + ".");
    }
  };

  return (
    <div style={{ fontFamily:"'Georgia',serif", background:"#f4f5f7", minHeight:"100vh" }}>
      {showPayModal && selectedPlan && (
        <MoMoPayment
          amount={billingCycle==="monthly"?Number(selectedPlan.monthly_price):Number(selectedPlan.annual_price)}
          purpose={`AshantiHub ${selectedPlan.name} Plan — ${billingCycle==="monthly"?"Monthly":"Annual"}`}
          businessName="Your Business"
          onSuccess={recordSubscriptionPayment}
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

        {actionError && <div style={{ background:"#fee2e2", color:"#dc2626", borderRadius:12, padding:"10px 14px", fontSize:"0.78rem", marginBottom:16 }}>{actionError}</div>}

        {/* ── OVERVIEW ── */}
        {payTab === "overview" && (
          <>
            <h2 style={{ margin:"0 0 20px", color:C.darkBrown, fontWeight:900, fontSize:"1.05rem" }}>💰 Payment Overview</h2>
            {txLoading && <div style={{ color:"#888", fontSize:"0.82rem", padding:"20px 0" }}>Loading your payment history…</div>}
            {txError && <div style={{ color:"#dc2626", fontSize:"0.82rem", padding:"20px 0" }}>Could not load your payment history. Make sure you're signed in as a business owner.</div>}
            {!txLoading && !txError && (
              <>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:14, marginBottom:24 }}>
                  {[
                    { icon:"💚", label:"Total Paid", value:`GHS ${totalRevenue.toLocaleString()}`, sub:"All-time successful payments", color:"#22c55e" },
                    { icon:"⏳", label:"Pending", value:`GHS ${pendingRevenue.toLocaleString()}`, sub:"Awaiting confirmation", color:"#f59e0b" },
                    { icon:"❌", label:"Failed Payments", value:failedTxns, sub:"Need follow-up", color:"#ef4444" },
                    { icon:"✅", label:"Successful Payments", value:successTxns, sub:"Completed transactions", color:C.kente3 },
                  ].map(s => (
                    <div key={s.label} style={{ background:"white", borderRadius:14, padding:"16px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)", borderLeft:`4px solid ${s.color}` }}>
                      <div style={{ fontSize:"1.3rem", marginBottom:4 }}>{s.icon}</div>
                      <div style={{ fontWeight:900, fontSize:"1.2rem", color:C.darkBrown }}>{s.value}</div>
                      <div style={{ fontSize:"0.7rem", fontWeight:700, color:"#555" }}>{s.label}</div>
                      <div style={{ fontSize:"0.62rem", color:s.color, fontWeight:600 }}>{s.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Recent transactions */}
                <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
                  <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:14, fontSize:"0.88rem" }}>🕐 Recent Transactions</div>
                  {txList.length===0 && <div style={{ color:"#aaa", fontSize:"0.78rem" }}>No payments yet.</div>}
                  {txList.slice(0,4).map(t => (
                    <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #f5f5f5", flexWrap:"wrap", gap:8 }}>
                      <div>
                        <div style={{ fontWeight:700, fontSize:"0.8rem" }}>{t.purpose}</div>
                        <div style={{ fontSize:"0.68rem", color:"#888" }}>{t.created_at?.slice(0,10)} • Ref: {t.reference}</div>
                      </div>
                      <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                        <span style={{ fontWeight:900, color:C.kente2 }}>GHS {Number(t.amount).toLocaleString()}</span>
                        <span style={{ background:`${statusColor[t.status]}20`, color:statusColor[t.status], borderRadius:20, padding:"2px 8px", fontSize:"0.62rem", fontWeight:800 }}>{statusLabel[t.status]||t.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── TRANSACTIONS ── */}
        {payTab === "transactions" && (
          <>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:10 }}>
              <h2 style={{ margin:0, color:C.darkBrown, fontWeight:900, fontSize:"1.05rem" }}>📋 Your Transactions</h2>
            </div>
            {txLoading && <div style={{ color:"#888", fontSize:"0.82rem", padding:"20px 0" }}>Loading your payment history…</div>}
            {txError && <div style={{ color:"#dc2626", fontSize:"0.82rem", padding:"20px 0" }}>Could not load your payment history. Make sure you're signed in as a business owner.</div>}
            {!txLoading && !txError && (
              <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)", overflowX:"auto" }}>
                {txList.length===0 ? <div style={{ color:"#aaa", fontSize:"0.78rem" }}>No payments yet.</div> : (
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:"0.74rem" }}>
                    <thead>
                      <tr style={{ borderBottom:"2px solid #f0f0f0" }}>
                        {["Reference","Purpose","Amount","Date","Status"].map(h=>(
                          <th key={h} style={{ textAlign:"left", padding:"8px 10px", color:"#888", fontWeight:700, whiteSpace:"nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {txList.map(t => (
                        <tr key={t.id} style={{ borderBottom:"1px solid #f8f8f8" }}
                          onMouseEnter={e=>e.currentTarget.style.background="#fafafa"}
                          onMouseLeave={e=>e.currentTarget.style.background=""}>
                          <td style={{ padding:"10px", fontWeight:700, color:C.deepGold, fontSize:"0.68rem" }}>{t.reference}</td>
                          <td style={{ padding:"10px", fontWeight:600 }}>{t.purpose}</td>
                          <td style={{ padding:"10px", fontWeight:800, color:C.kente2 }}>GHS {Number(t.amount).toLocaleString()}</td>
                          <td style={{ padding:"10px", color:"#aaa" }}>{t.created_at?.slice(0,10)}</td>
                          <td style={{ padding:"10px" }}>
                            <span style={{ background:`${statusColor[t.status]}20`, color:statusColor[t.status], borderRadius:20, padding:"3px 9px", fontSize:"0.62rem", fontWeight:800 }}>{statusLabel[t.status]||t.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
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
            {plansLoading && <div style={{ color:"#888", fontSize:"0.82rem", textAlign:"center", padding:"20px 0" }}>Loading plans…</div>}
            {plansError && <div style={{ color:"#dc2626", fontSize:"0.82rem", textAlign:"center", padding:"20px 0" }}>Could not load subscription plans.</div>}
            {!plansLoading && !plansError && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:14 }}>
                {(subPlans||[]).map(plan => (
                  <div key={plan.id} style={{ background:"white", borderRadius:18, padding:"22px", boxShadow:"0 2px 16px rgba(0,0,0,0.09)", border:`2px solid ${plan.is_recommended?C.gold:"transparent"}`, position:"relative" }}>
                    {plan.is_recommended && <div style={{ position:"absolute", top:-10, left:"50%", transform:"translateX(-50%)", background:C.gold, color:C.darkBrown, borderRadius:20, padding:"3px 14px", fontSize:"0.62rem", fontWeight:900, whiteSpace:"nowrap" }}>⭐ MOST POPULAR</div>}
                    <div style={{ fontWeight:900, color:C.darkBrown, fontSize:"1rem", marginBottom:4 }}>{plan.name}</div>
                    <div style={{ fontWeight:900, fontSize:"1.8rem", color:C.darkBrown, marginBottom:2 }}>
                      GHS {billingCycle==="monthly"?Number(plan.monthly_price).toLocaleString():Number(plan.annual_price).toLocaleString()}
                      <span style={{ fontSize:"0.72rem", fontWeight:400, color:"#aaa" }}>/{billingCycle==="monthly"?"month":"year"}</span>
                    </div>
                    <div style={{ borderTop:"1px solid #f0f0f0", paddingTop:12, marginBottom:16 }}>
                      {(plan.features||[]).map(f => (
                        <div key={f} style={{ fontSize:"0.72rem", color:"#444", marginBottom:5, display:"flex", gap:6 }}>
                          <span style={{ color:C.kente2 }}>✓</span>{f}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => { setSelectedPlan(plan); setShowPayModal(true); }}
                      style={{ width:"100%", background:plan.is_recommended?C.gold:"#f0f0f0", color:plan.is_recommended?C.darkBrown:"#666", border:"none", borderRadius:20, padding:"11px", fontWeight:900, cursor:"pointer", fontFamily:"inherit", fontSize:"0.82rem" }}>
                      💰 Pay with MoMo
                    </button>
                  </div>
                ))}
              </div>
            )}
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
            <p style={{ color:"#888", fontSize:"0.78rem", margin:"0 0 20px" }}>Automated WhatsApp reminders sent before and after your payment due dates</p>

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

            {/* Your payments needing follow-up */}
            <div style={{ background:"white", borderRadius:16, padding:"20px", boxShadow:"0 2px 12px rgba(0,0,0,0.07)" }}>
              <div style={{ fontWeight:800, color:C.darkBrown, marginBottom:14, fontSize:"0.88rem" }}>⚠️ Your Payments Needing Follow-up</div>
              {!txLoading && !txError && needsFollowUp.length===0 && <div style={{ color:"#aaa", fontSize:"0.78rem" }}>Nothing needs follow-up — you're all caught up.</div>}
              {needsFollowUp.map(t => (
                <div key={t.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #f5f5f5", flexWrap:"wrap", gap:8 }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:"0.8rem" }}>{t.purpose}</div>
                    <div style={{ fontSize:"0.68rem", color:"#888" }}>GHS {Number(t.amount).toLocaleString()} — {statusLabel[t.status]||t.status}</div>
                  </div>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <button onClick={()=>setPayTab("subscribe")} style={{ background:C.kente2, color:"white", border:"none", borderRadius:20, padding:"5px 12px", fontSize:"0.68rem", fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>💰 Pay Now</button>
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

const MOCK_REVIEWS = {
  1:[
    {id:1,author:"Emma Thompson",country:"🇬🇧",rating:5,text:"Absolutely stunning hotel. The kente decor is breathtaking and staff were incredibly welcoming.",date:"2026-05-28",helpful:12},
    {id:2,author:"Hans Mueller",country:"🇩🇪",rating:4,text:"Great location near the palace. Breakfast could be improved but overall wonderful stay.",date:"2026-05-15",helpful:8},
    {id:3,author:"Kwame Asante",country:"🇬🇭",rating:5,text:"Best hotel in Kumasi! Felt like royalty. Will definitely return for Akwasidae.",date:"2026-05-10",helpful:15},
  ],
};

const KUMASI_ZONES = ["All Zones","Manhyia","Adum","Kejetia","Asokwa","Nhyiaeso","Bantama","Suame","Bonwire","Citywide"];

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
// Fraud-prevention (docs/UI_MODERNIZATION_ROADMAP.md Phase F): businesses can
// no longer be messaged directly, in-app or via WhatsApp. Every conversation
// here is with AshantiHub Support *about* a business/listing/event — staff
// relay to and from the business on the customer's behalf — never a direct
// customer<->business channel. `businessName`/`businessImg` are kept as the
// "what this thread is about" context (shown as a "Re:" line), not as who
// the customer is chatting with; `from` is "customer" or "support" (never
// "business") to keep that honest in the transcript itself.
const MOCK_CONVERSATIONS = [
  {
    id:1, businessId:1, businessName:"Royal Ashanti Lodge", businessImg:"🏰",
    lastMessage:"Good news — Royal Ashanti Lodge has availability for your dates!", lastTime:"10:34 AM",
    unread:1, status:"online",
    messages:[
      {id:1,from:"customer",text:"Hello! I'd like to book a Deluxe Suite at Royal Ashanti Lodge for June 20–23. Do they have availability?",time:"10:20 AM",read:true},
      {id:2,from:"support",text:"Akwaaba! We've checked with Royal Ashanti Lodge — they have the Deluxe Suite available for those dates. The rate is GHS 750/night. Shall we confirm the booking for you?",time:"10:28 AM",read:true},
      {id:3,from:"customer",text:"That's perfect! Is breakfast included?",time:"10:30 AM",read:true},
      {id:4,from:"support",text:"Good news — Royal Ashanti Lodge has availability for your dates! We've confirmed breakfast is included and will send your booking reference shortly.",time:"10:34 AM",read:false},
    ]
  },
  {
    id:2, businessId:7, businessName:"Kente Palace Weavers", businessImg:"🧶",
    lastMessage:"Your kente cloth is ready for collection — details from Kente Palace Weavers below!", lastTime:"Yesterday",
    unread:2, status:"offline",
    messages:[
      {id:1,from:"customer",text:"Do you know if Kente Palace Weavers ship internationally to the UK?",time:"Yesterday 2:15 PM",read:true},
      {id:2,from:"support",text:"Yes! Kente Palace Weavers ship via DHL — delivery takes 5–7 days to the UK. They can also arrange custom kente patterns.",time:"Yesterday 3:00 PM",read:true},
      {id:3,from:"customer",text:"Wonderful! I'd like to order 3 yards in blue and gold royal pattern.",time:"Yesterday 3:30 PM",read:true},
      {id:4,from:"support",text:"We've passed that on — your kente cloth is ready for collection! Kente Palace Weavers have also prepared a gift package for you.",time:"Yesterday 4:00 PM",read:false},
      {id:5,from:"support",text:"Total: GHS 450 + GHS 80 shipping. Let us know if you'd like us to confirm shipping on your behalf.",time:"Yesterday 4:02 PM",read:false},
    ]
  },
  {
    id:3, businessId:3, businessName:"Manhyia Palace Experience", businessImg:"👑",
    lastMessage:"Your tour with Manhyia Palace Experience is confirmed for June 22 at 9:00 AM!", lastTime:"2 days ago",
    unread:0, status:"online",
    messages:[
      {id:1,from:"customer",text:"I'd like to book the Manhyia Palace Experience tour for 2 people on June 22.",time:"2 days ago",read:true},
      {id:2,from:"support",text:"Akwaaba! The Akwasidae Festival tour is their most popular. GHS 80/person includes guide and entrance. Please confirm your names and we'll book it with them.",time:"2 days ago",read:true},
      {id:3,from:"customer",text:"Emma Thompson and Hans Mueller.",time:"2 days ago",read:true},
      {id:4,from:"support",text:"Your tour with Manhyia Palace Experience is confirmed for June 22 at 9:00 AM!",time:"2 days ago",read:true},
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
    // Simulate an AshantiHub Support auto-reply after 2 seconds — staff relay
    // to/from the business, never a direct customer<->business channel
    // (fraud-prevention, docs/UI_MODERNIZATION_ROADMAP.md Phase F).
    setTimeout(() => {
      const autoReplies = [
        "Thank you for your message! We'll pass this on and get back to you shortly. 🙏",
        "Akwaaba! We've received your message and will follow up with the business within 30 minutes.",
        "Thank you! A support team member will assist you shortly.",
      ];
      const reply = { id:Date.now()+1, from:"support", text:autoReplies[Math.floor(Math.random()*autoReplies.length)], time:new Date().toLocaleTimeString("en-GH",{hour:"2-digit",minute:"2-digit"}), read:false, isAuto:true };
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
                      <span style={{fontWeight:800,fontSize:"0.78rem",color:C.darkBrown,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>AshantiHub Support</span>
                      <span style={{fontSize:"0.6rem",color:"#aaa",flexShrink:0,marginLeft:4}}>{conv.lastTime}</span>
                    </div>
                    <div style={{fontSize:"0.64rem",color:C.deepGold,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:2}}>Re: {conv.businessName}</div>
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
                  <div style={{fontWeight:900,fontSize:"0.88rem",color:C.darkBrown}}>AshantiHub Support</div>
                  <div style={{fontSize:"0.68rem",color:C.deepGold,fontWeight:700,marginBottom:1}}>Re: {activeConv.businessName}</div>
                  <div style={{fontSize:"0.65rem",color:activeConv.status==="online"?"#22c55e":"#aaa",fontWeight:600}}>
                    {activeConv.status==="online"?"● Support team online now":"● Support team offline — usually replies within 1 hour"}
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}>
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
                    {msg.from==="support"&&(
                      <div style={{width:28,height:28,borderRadius:"50%",background:`${C.gold}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.9rem",flexShrink:0}}>🎧</div>
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
                    ⚠️ Sign in to message AshantiHub Support
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
                      placeholder={user?"Type a message...":"Sign in to message AshantiHub Support"}
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
                  💡 Messages are stored on AshantiHub • Handled by AshantiHub Support, who relay to the business on your behalf
                </div>
              </div>
            </>
          ) : (
            <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12,color:"#aaa"}}>
              <div style={{fontSize:"3rem"}}>💬</div>
              <div style={{fontWeight:700,fontSize:"0.88rem",color:C.darkBrown}}>Your Messages</div>
              <div style={{fontSize:"0.76rem",textAlign:"center",maxWidth:240,lineHeight:1.6}}>Select a conversation or start a new one to reach AshantiHub Support about a Kumasi business</div>
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

// ─── Category strip grouping (Business tab, Phase 3) ──────────────────────
// Splits the flat `useCategories()` list into Products/Services rows by
// `Category.kind` (docs/BUSINESS_EVENTS_ROADMAP.md Phase 1/3).
// `kind==="event"` categories are dropped entirely — the Events tab is a
// separate, still-static page until Phase 6. Categories with no explicit
// `kind` (older/seed data, or the test-suite's MSW mocks) default into
// Products, mirroring Category.kind's own backend default of "product".
// Exported (like Card above) so it's unit-testable without having
// to render the whole AshantiHub tree.
export function groupCategoriesByKind(categories) {
  const list = categories || [];
  return {
    productCategories: list.filter(c=>c.kind!=="event"&&c.kind!=="service"),
    serviceCategories: list.filter(c=>c.kind==="service"),
  };
}

// ─── Business Card ─────────────────────────────────────────────────────────────
export function Card({item,accentColor,user,favourites,onFavourite,currency,onMessage,onOpen}) {
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
    <div style={{background:"rgba(255,255,255,0.04)",backdropFilter:"blur(6px)",borderRadius:16,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.3)",border:`1.5px solid ${accentColor}55`,transition:"transform 0.2s"}}
      onMouseEnter={e=>e.currentTarget.style.transform="translateY(-4px)"}
      onMouseLeave={e=>e.currentTarget.style.transform=""}>
      {/* Photo strip — clicking it opens the PDP (ListingDetailPage) when onOpen is provided;
          the favourite/share buttons inside it stopPropagation so they don't also trigger it. */}
      <div onClick={()=>onOpen&&onOpen(item.id)} style={{height:140,position:"relative",overflow:"hidden",background:`linear-gradient(135deg,${accentColor}22,${accentColor}44)`,cursor:onOpen?"pointer":"default"}}>
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
              <img key={p.id} src={p.image} alt="" onClick={(e)=>{e.stopPropagation();setPhotoIdx(i);}}
                style={{width:16,height:16,borderRadius:"50%",objectFit:"cover",border:photoIdx===i?"2px solid white":"1px solid rgba(255,255,255,0.6)",cursor:"pointer"}}/>
            ))}
          </div>
        )}
        <span style={{position:"absolute",top:8,right:8,background:accentColor,color:"white",fontSize:"0.6rem",fontWeight:700,padding:"2px 7px",borderRadius:20,zIndex:2}}>{item.tag}</span>
        <button onClick={(e)=>{e.stopPropagation();onFavourite(item.id);}} style={{position:"absolute",top:8,left:8,background:"rgba(255,255,255,0.9)",border:"none",borderRadius:"50%",width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.9rem",zIndex:2}}>
          {isFav?"❤️":"🤍"}
        </button>
        <button onClick={(e)=>{e.stopPropagation();if(navigator.share)navigator.share({title:item.name,text:item.description,url:window.location.href});else navigator.clipboard?.writeText(`Check out ${item.name} on AshantiHub!`);}}
          style={{position:"absolute",bottom:8,right:8,background:"rgba(255,255,255,0.9)",border:"none",borderRadius:"50%",width:26,height:26,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.8rem",zIndex:2}}>
          📤
        </button>
      </div>
      <div style={{padding:"12px 14px"}}>
        <div onClick={()=>onOpen&&onOpen(item.id)} style={{fontWeight:700,fontSize:"0.9rem",color:"white",marginBottom:2,cursor:onOpen?"pointer":"default"}}>{item.name}</div>
        {/* Reviews are out of scope until a future sub-project builds them; the real Listing
            model has no rating/reviews field, so this whole slot is hidden rather than
            rendering broken placeholders (empty stars, "( reviews)") for every real listing. */}
        {item.rating!=null&&(
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
            <Stars rating={item.rating}/>
            <button onClick={()=>setShowReviews(true)} style={{background:"none",border:"none",color:accentColor,fontSize:"0.68rem",cursor:"pointer",fontWeight:600,padding:0}}>
              ({item.reviews} reviews)
            </button>
          </div>
        )}
        <div style={{fontSize:"0.68rem",color:"rgba(255,255,255,0.6)",marginBottom:4}}>📍 {item.zone?.name}</div>
        <div style={{color:"rgba(255,255,255,0.75)",fontSize:"0.75rem",marginBottom:10,lineHeight:1.4}}>{item.description}</div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <span style={{fontWeight:800,color:accentColor,fontSize:"0.8rem"}}>{displayPrice()}</span>
          <div style={{display:"flex",gap:5}}>
            {/* Businesses can no longer be contacted directly (fraud-prevention —
                docs/UI_MODERNIZATION_ROADMAP.md Phase F): this opens MessagingCenter
                framed as an AshantiHub Support conversation about this listing,
                not a direct line to the business. */}
            <button onClick={()=>{ if(onMessage) onMessage(item); }}
              style={{background:`${C.kente3}15`,color:C.kente3,border:`1px solid ${C.kente3}33`,borderRadius:20,padding:"5px 10px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:3}}>
              🎧 Contact Support
            </button>
            <button onClick={()=>setShowPay(true)} style={{background:accentColor,color:"white",border:"none",borderRadius:20,padding:"5px 10px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer"}}>
              💳 Pay
            </button>
          </div>
        </div>
      </div>
    </div>
  </>;
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

const authInputStyle={width:"100%",boxSizing:"border-box",padding:"10px 12px",borderRadius:10,border:"1.5px solid #ddd",marginBottom:10,fontSize:"0.82rem",fontFamily:"inherit"};
const authSubmitStyle={width:"100%",background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"12px",fontWeight:900,fontSize:"0.85rem",cursor:"pointer",fontFamily:"inherit",marginTop:4};

export function AuthModal({authState,auth,onClose,onSuccess}) {
  const lockedAccountType = authState==="staff-login" ? "staff" : null;
  const [mode,setMode]=useState(authState==="staff-login" ? "login" : authState);
  const [accountType,setAccountType]=useState(lockedAccountType || "customer");
  const [identifier,setIdentifier]=useState("");
  const [password,setPassword]=useState("");
  const [fullName,setFullName]=useState("");
  const [phone,setPhone]=useState("");
  const [email,setEmail]=useState("");
  const [error,setError]=useState(null);
  const [submitting,setSubmitting]=useState(false);

  const handleLogin=async(e)=>{
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result=await auth.login(lockedAccountType||accountType,identifier,password);
      onSuccess(result);
    } catch (err) {
      setError("Invalid credentials. Please check your details and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCustomerSignup=async(e)=>{
    e.preventDefault();
    setError(null);
    if(!phone && !email){
      setError("Please provide a phone number or email address.");
      return;
    }
    setSubmitting(true);
    try {
      const result=await auth.registerCustomer({full_name:fullName,phone:phone||undefined,email:email||undefined,password});
      onSuccess(result);
    } catch (err) {
      setError("Could not create your account. Please check your details.");
    } finally {
      setSubmitting(false);
    }
  };

  return <div data-testid="auth-modal-backdrop" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:"white",borderRadius:22,width:"100%",maxWidth:440,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
      <div style={{background:`linear-gradient(135deg,${C.kente1},${C.kente3})`,borderRadius:"22px 22px 0 0",padding:"20px 24px",position:"relative"}}>
        <button onClick={onClose} style={{position:"absolute",top:14,right:16,background:"none",border:"none",color:"white",fontSize:"1.4rem",cursor:"pointer",opacity:0.7}}>✕</button>
        <div style={{color:C.gold,fontWeight:900,fontSize:"1.1rem"}}>{lockedAccountType==="staff"?"Staff Sign In":mode==="login"?"Welcome back":"Create your account"}</div>
      </div>
      <div style={{padding:"20px 24px"}}>
        {!lockedAccountType && <div style={{display:"flex",gap:8,marginBottom:16}}>
          <button type="button" onClick={()=>setMode("login")} style={{flex:1,padding:"8px",borderRadius:20,border:"none",cursor:"pointer",fontWeight:800,fontSize:"0.78rem",background:mode==="login"?C.gold:"#eee",color:mode==="login"?C.darkBrown:"#666"}}>Sign In</button>
          <button type="button" onClick={()=>setMode("signup")} style={{flex:1,padding:"8px",borderRadius:20,border:"none",cursor:"pointer",fontWeight:800,fontSize:"0.78rem",background:mode==="signup"?C.gold:"#eee",color:mode==="signup"?C.darkBrown:"#666"}}>Sign Up</button>
        </div>}

        {error && <div style={{background:"#fdecea",color:"#b00020",borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:"0.78rem"}}>{error}</div>}

        {mode==="login" && <form onSubmit={handleLogin}>
          {!lockedAccountType && <div style={{display:"flex",gap:8,marginBottom:12}}>
            <button type="button" onClick={()=>setAccountType("customer")} style={{flex:1,padding:"6px",borderRadius:20,border:`1.5px solid ${C.gold}`,cursor:"pointer",fontWeight:700,fontSize:"0.72rem",background:accountType==="customer"?C.gold:"white"}}>Customer</button>
            <button type="button" onClick={()=>setAccountType("business_owner")} style={{flex:1,padding:"6px",borderRadius:20,border:`1.5px solid ${C.gold}`,cursor:"pointer",fontWeight:700,fontSize:"0.72rem",background:accountType==="business_owner"?C.gold:"white"}}>Business Owner</button>
          </div>}
          <input value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="Phone or email" required style={authInputStyle}/>
          <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password" required style={authInputStyle}/>
          <button type="submit" disabled={submitting} style={authSubmitStyle}>{submitting?"Signing in…":"Sign In"}</button>
        </form>}

        {mode==="signup" && <form onSubmit={handleCustomerSignup}>
          <input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Full name" required style={authInputStyle}/>
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Phone (+233...)" style={authInputStyle}/>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="Email" style={authInputStyle}/>
          <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password (min 8 characters)" required minLength={8} style={authInputStyle}/>
          <button type="submit" disabled={submitting} style={authSubmitStyle}>{submitting?"Creating account…":"Create Free Account"}</button>
        </form>}
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
  en:{search:"Search businesses...",signup:"Create Free Account",login:"Sign In",register:"Register Your Business",categories:"Categories",bookNow:"Book",pay:"Pay"},
  tw:{search:"Hwehwɛ adwuma...",signup:"Yɛ Account Foforo",login:"Wo ho hyɛ mu",register:"Kyerɛ Wo Adwuma",categories:"Nkyereɛ",bookNow:"Bɔ",pay:"Tua"},
};

// ─── Main App ─────────────────────────────────────────────────────────────────
const DASHBOARD_THEME = {
  light: { pageBg:"#f0f2f5", sidebarBg:C.cream, sidebarText:C.darkBrown, cardBg:"#ffffff", text:C.darkBrown, textMuted:"#666", border:"#e0e0e0" },
  dark:  { pageBg:"#14161c", sidebarBg:"#0d0e12", sidebarText:C.cream, cardBg:"#1c1f26", text:C.cream, textMuted:"#9aa0aa", border:"#2a2d35" },
};

const ROLE_COLORS = { super_admin:C.gold, admin:C.kente3, accountant:C.kente1, marketing:C.kente2, support:C.ghGreen };

function ComingSoonPanel({theme,feature}) {
  return <div style={{background:theme.cardBg,borderRadius:16,padding:"40px 24px",textAlign:"center",border:`1px solid ${theme.border}`}}>
    <div style={{fontSize:"2rem",marginBottom:10}}>🚧</div>
    <div style={{color:theme.text,fontWeight:800,fontSize:"0.9rem",marginBottom:4}}>Coming soon</div>
    <div style={{color:theme.textMuted,fontSize:"0.78rem"}}>{feature} isn't built yet.</div>
  </div>;
}

// Promotions went live as a business-owner self-serve feature in
// docs/BUSINESS_EVENTS_ROADMAP.md Phase 5 (BusinessDashboard's Listings &
// Prices tab — "📣 Promote"), so the old ComingSoonPanel placeholder here
// would now be actively misleading to staff. There's no backend "list all
// promotions" endpoint in this phase's scope (only the purchase endpoint and
// the `is_promoted` flag on listings), so this stays a minimal informational
// panel rather than a fabricated admin promotions-management UI.
function PromotionsInfoPanel({theme}) {
  return <div style={{background:theme.cardBg,borderRadius:16,padding:"40px 24px",textAlign:"center",border:`1px solid ${theme.border}`}}>
    <div style={{fontSize:"2rem",marginBottom:10}}>📣</div>
    <div style={{color:theme.text,fontWeight:800,fontSize:"0.9rem",marginBottom:4}}>Promotions are self-serve</div>
    <div style={{color:theme.textMuted,fontSize:"0.78rem",maxWidth:420,margin:"0 auto"}}>Business owners now purchase Featured and Boost promotions directly from their own dashboard's Listings &amp; Prices tab. There's nothing for staff to manage here yet — a future phase may add an admin view of active promotions.</div>
  </div>;
}

function StaffOverviewPanel({auth,theme,roleColor}) {
  const permissions = auth.user?.permissions||[];
  return <div>
    <h2 style={{color:theme.text,fontWeight:900,margin:"0 0 6px",fontSize:"1.1rem"}}>Akwaaba, {auth.user?.full_name?.split(" ")[0]}!</h2>
    <div style={{color:theme.textMuted,fontSize:"0.8rem",marginBottom:20}}>
      You're signed in as <span style={{color:roleColor,fontWeight:800,textTransform:"capitalize"}}>{auth.user?.role?.replace("_"," ")}</span>.
    </div>
    <div style={{background:theme.cardBg,borderRadius:16,padding:"18px",border:`1px solid ${theme.border}`}}>
      <div style={{color:theme.text,fontWeight:800,fontSize:"0.82rem",marginBottom:10}}>Your permissions</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
        {permissions.map(p=>(
          <span key={p} style={{background:`${roleColor}18`,color:roleColor,borderRadius:20,padding:"3px 10px",fontSize:"0.68rem",fontWeight:700}}>{p}</span>
        ))}
      </div>
    </div>
  </div>;
}

function KYCQueuePanel({theme}) {
  const {data,isLoading,isError,refetch} = useKYCQueue();
  const [rejectingId,setRejectingId] = useState(null);
  const [rejectReason,setRejectReason] = useState("");
  const [actionError,setActionError] = useState(null);

  const approve = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/accounts/kyc/${id}/approve/`,{}); refetch(); }
    catch (err) { setActionError("Could not approve this submission. Please try again."); }
  };
  const reject = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/accounts/kyc/${id}/reject/`,{reason:rejectReason}); setRejectingId(null); setRejectReason(""); refetch(); }
    catch (err) { setActionError("Could not reject this submission. Please try again."); }
  };

  if(isLoading) return <div style={{color:theme.textMuted,fontSize:"0.8rem"}}>Loading…</div>;
  if(isError) return <div style={{color:"#dc2626",fontSize:"0.8rem"}}>Could not load the KYC queue.</div>;
  const items = data||[];

  return <div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`}}>
    <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:14}}>Pending KYC submissions ({items.length})</div>
    {actionError&&<div style={{color:"#dc2626",fontSize:"0.8rem",marginBottom:10}}>{actionError}</div>}
    {items.length===0&&<div style={{color:theme.textMuted,fontSize:"0.8rem"}}>No pending submissions.</div>}
    {items.map(o=>(
      <div key={o.id} style={{padding:"12px 0",borderBottom:`1px solid ${theme.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div>
            <div style={{color:theme.text,fontWeight:700,fontSize:"0.82rem"}}>{o.full_name}</div>
            <div style={{color:theme.textMuted,fontSize:"0.68rem"}}>{o.login_phone} • submitted {o.created_at?.slice(0,10)}</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>approve(o.id)} style={{background:"#22c55e",color:"white",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✓ Approve</button>
            <button onClick={()=>setRejectingId(o.id)} style={{background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✕ Reject</button>
          </div>
        </div>
        {rejectingId===o.id&&<div style={{marginTop:8,display:"flex",gap:6}}>
          <input value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder="Rejection reason" style={{flex:1,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
          <button onClick={()=>reject(o.id)} disabled={!rejectReason} style={{background:"#dc2626",color:"white",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:rejectReason?"pointer":"default"}}>Confirm reject</button>
        </div>}
      </div>
    ))}
  </div>;
}

function ListingsModerationPanel({theme}) {
  const {data,isLoading,isError,refetch} = useModerationQueue();
  const [rejectingId,setRejectingId] = useState(null);
  const [rejectReason,setRejectReason] = useState("");
  const [actionError,setActionError] = useState(null);

  const approve = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/moderation/${id}/approve/`,{}); refetch(); }
    catch (err) { setActionError("Could not approve this listing."); }
  };
  const reject = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/moderation/${id}/reject/`,{reason:rejectReason}); setRejectingId(null); setRejectReason(""); refetch(); }
    catch (err) { setActionError("Could not reject this listing."); }
  };

  if(isLoading) return <div style={{color:theme.textMuted,fontSize:"0.8rem"}}>Loading…</div>;
  if(isError) return <div style={{color:"#dc2626",fontSize:"0.8rem"}}>Could not load the moderation queue.</div>;
  const items = data||[];

  return <div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`}}>
    <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:14}}>Pending listings ({items.length})</div>
    {actionError&&<div style={{color:"#dc2626",fontSize:"0.8rem",marginBottom:10}}>{actionError}</div>}
    {items.length===0&&<div style={{color:theme.textMuted,fontSize:"0.8rem"}}>No pending listings.</div>}
    {items.map(l=>(
      <div key={l.id} style={{padding:"12px 0",borderBottom:`1px solid ${theme.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div>
            <div style={{color:theme.text,fontWeight:700,fontSize:"0.82rem"}}>{l.name}</div>
            <div style={{color:theme.textMuted,fontSize:"0.68rem"}}>{l.category?.label} • {l.zone?.name} • GHS {l.price_amount} • {l.contact_phone}</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>approve(l.id)} style={{background:"#22c55e",color:"white",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✓ Approve</button>
            <button onClick={()=>setRejectingId(l.id)} style={{background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✕ Reject</button>
          </div>
        </div>
        {rejectingId===l.id&&<div style={{marginTop:8,display:"flex",gap:6}}>
          <input value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder="Rejection reason" style={{flex:1,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
          <button onClick={()=>reject(l.id)} disabled={!rejectReason} style={{background:"#dc2626",color:"white",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:rejectReason?"pointer":"default"}}>Confirm reject</button>
        </div>}
      </div>
    ))}
  </div>;
}

function HeroApprovalPanel({theme}) {
  const {data,isLoading,isError,refetch} = useHeroModerationQueue();
  const [rejectingId,setRejectingId] = useState(null);
  const [rejectReason,setRejectReason] = useState("");
  const [actionError,setActionError] = useState(null);

  const approve = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/hero/${id}/approve/`,{}); refetch(); }
    catch (err) { setActionError("Could not approve this submission."); }
  };
  const reject = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/hero/${id}/reject/`,{reason:rejectReason}); setRejectingId(null); setRejectReason(""); refetch(); }
    catch (err) { setActionError("Could not reject this submission."); }
  };

  if(isLoading) return <div style={{color:theme.textMuted,fontSize:"0.8rem"}}>Loading…</div>;
  if(isError) return <div style={{color:"#dc2626",fontSize:"0.8rem"}}>Could not load the hero approval queue.</div>;
  const items = data||[];

  return <div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`}}>
    <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:14}}>Pending hero submissions ({items.length})</div>
    {actionError&&<div style={{color:"#dc2626",fontSize:"0.8rem",marginBottom:10}}>{actionError}</div>}
    {items.length===0&&<div style={{color:theme.textMuted,fontSize:"0.8rem"}}>No pending submissions.</div>}
    {items.map(s=>(
      <div key={s.id} style={{padding:"12px 0",borderBottom:`1px solid ${theme.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
          <div style={{display:"flex",gap:10}}>
            {s.media_type==="video" ? (
              <video src={s.media} muted style={{width:80,height:80,objectFit:"cover",borderRadius:10,background:"#000",flexShrink:0}}/>
            ) : (
              <img src={s.media} alt={s.caption||""} style={{width:80,height:80,objectFit:"cover",borderRadius:10,flexShrink:0}}/>
            )}
            <div>
              <div style={{color:theme.text,fontWeight:700,fontSize:"0.82rem"}}>{s.business_owner_name}</div>
              <div style={{color:theme.textMuted,fontSize:"0.72rem",margin:"3px 0",maxWidth:320}}>"{s.caption}"</div>
              <div style={{color:theme.textMuted,fontSize:"0.65rem"}}>Submitted {s.submitted_at?.slice(0,10)}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>approve(s.id)} style={{background:"#22c55e",color:"white",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✓ Approve</button>
            <button onClick={()=>setRejectingId(s.id)} style={{background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>✕ Reject</button>
          </div>
        </div>
        {rejectingId===s.id&&<div style={{marginTop:8,display:"flex",gap:6}}>
          <input value={rejectReason} onChange={e=>setRejectReason(e.target.value)} placeholder="Rejection reason" style={{flex:1,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
          <button onClick={()=>reject(s.id)} disabled={!rejectReason} style={{background:"#dc2626",color:"white",border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.7rem",fontWeight:700,cursor:rejectReason?"pointer":"default"}}>Confirm reject</button>
        </div>}
      </div>
    ))}
  </div>;
}

function UsersPanel({theme}) {
  const [subTab,setSubTab] = useState("customers");
  const customers = useCustomers();
  const owners = useBusinessOwners();
  const active = subTab==="customers"?customers:owners;

  return <div>
    <div style={{display:"flex",gap:8,marginBottom:14}}>
      <button onClick={()=>setSubTab("customers")} style={{padding:"6px 14px",borderRadius:20,border:"none",cursor:"pointer",fontWeight:700,fontSize:"0.75rem",background:subTab==="customers"?C.gold:theme.border,color:subTab==="customers"?C.darkBrown:theme.textMuted,fontFamily:"inherit"}}>Customers</button>
      <button onClick={()=>setSubTab("owners")} style={{padding:"6px 14px",borderRadius:20,border:"none",cursor:"pointer",fontWeight:700,fontSize:"0.75rem",background:subTab==="owners"?C.gold:theme.border,color:subTab==="owners"?C.darkBrown:theme.textMuted,fontFamily:"inherit"}}>Business Owners</button>
    </div>
    {active.isLoading&&<div style={{color:theme.textMuted,fontSize:"0.8rem"}}>Loading…</div>}
    {active.isError&&<div style={{color:"#dc2626",fontSize:"0.8rem"}}>Could not load this list.</div>}
    {active.data&&<div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`}}>
      <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:4}}>{active.data.count} total</div>
      {active.data.count>20&&<div style={{color:theme.textMuted,fontSize:"0.68rem",marginBottom:10}}>Showing first 20 of {active.data.count}.</div>}
      {active.data.results.map(u=>(
        <div key={u.id} style={{padding:"10px 0",borderBottom:`1px solid ${theme.border}`}}>
          <div style={{color:theme.text,fontWeight:700,fontSize:"0.8rem"}}>{u.full_name}</div>
          <div style={{color:theme.textMuted,fontSize:"0.68rem"}}>
            {subTab==="customers"?`${u.phone||"—"} • ${u.email||"—"}`:`${u.login_phone} • KYC: ${u.kyc_status}`}
          </div>
        </div>
      ))}
    </div>}
  </div>;
}

function CategoriesZonesPanel({theme,auth}) {
  const categories = useCategories();
  const zones = useZones();
  const [newCategoryLabel,setNewCategoryLabel] = useState("");
  const [newZoneName,setNewZoneName] = useState("");
  const [actionError,setActionError] = useState(null);

  const addCategory = async () => {
    if(!newCategoryLabel) return;
    setActionError(null);
    try {
      const slug = newCategoryLabel.toLowerCase().replace(/\s+/g,"-");
      await apiPost("/api/listings/categories/",{slug,icon:"🆕",label:newCategoryLabel,color:"#888888"});
      setNewCategoryLabel("");
      categories.refetch();
    } catch (err) { setActionError("Could not add this category."); }
  };
  const addZone = async () => {
    if(!newZoneName) return;
    setActionError(null);
    try {
      await apiPost("/api/listings/zones/",{name:newZoneName});
      setNewZoneName("");
      zones.refetch();
    } catch (err) { setActionError("Could not add this zone."); }
  };

  return <div>
    {actionError&&<div style={{color:"#dc2626",fontSize:"0.8rem",marginBottom:10}}>{actionError}</div>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:16}}>
    <div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`}}>
      <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:12}}>Categories</div>
      {(categories.data||[]).map(c=>(
        <div key={c.id} style={{padding:"6px 0",color:theme.text,fontSize:"0.8rem"}}>{c.icon} {c.label}</div>
      ))}
      {auth.hasPermission("categories.manage")&&<div style={{marginTop:12,display:"flex",gap:6}}>
        <input value={newCategoryLabel} onChange={e=>setNewCategoryLabel(e.target.value)} placeholder="New category label" style={{flex:1,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
        <button onClick={addCategory} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"6px 14px",fontSize:"0.72rem",fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Add category</button>
      </div>}
    </div>
    <div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`}}>
      <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:12}}>Zones</div>
      {(zones.data||[]).map(z=>(
        <div key={z.id} style={{padding:"6px 0",color:theme.text,fontSize:"0.8rem"}}>{z.name}</div>
      ))}
      {auth.hasPermission("zones.manage")&&<div style={{marginTop:12,display:"flex",gap:6}}>
        <input value={newZoneName} onChange={e=>setNewZoneName(e.target.value)} placeholder="New zone name" style={{flex:1,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
        <button onClick={addZone} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"6px 14px",fontSize:"0.72rem",fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Add zone</button>
      </div>}
    </div>
    </div>
  </div>;
}

const SITE_SETTINGS_FIELDS = [
  {key:"contact_email",label:"Contact email",placeholder:"hello@ashantihub.com"},
  {key:"contact_phone",label:"Contact phone",placeholder:"+233 20 111 2233"},
  {key:"contact_address",label:"Contact address",placeholder:"Adum, Kumasi"},
  {key:"facebook_url",label:"Facebook URL",placeholder:"https://facebook.com/ashantihub"},
  {key:"instagram_url",label:"Instagram URL",placeholder:"https://instagram.com/ashantihub"},
  {key:"linkedin_url",label:"LinkedIn URL",placeholder:"https://linkedin.com/company/ashantihub"},
  {key:"twitter_url",label:"Twitter / X URL",placeholder:"https://x.com/ashantihub"},
];

function SiteSettingsForm({theme,initial,onSaved}) {
  // `initial` is only passed once the GET has resolved (see SiteSettingsPanel
  // below), so this lazy useState seed is race-free — no useEffect re-seeding
  // needed, and no risk of clobbering in-flight edits.
  const [form,setForm] = useState(() => ({...initial}));
  const [actionError,setActionError] = useState(null);
  const [saved,setSaved] = useState(false);

  const showToast = () => { setSaved(true); setTimeout(()=>setSaved(false),2500); };

  const setField = (key,value) => setForm(f=>({...f,[key]:value}));

  const save = async () => {
    setActionError(null);
    try {
      await apiPatch("/api/core/site-settings/", {...form});
      showToast();
      onSaved();
    } catch (err) {
      setActionError("Could not save site settings. Please try again.");
    }
  };

  return <div>
    {saved&&<div style={{position:"fixed",top:70,right:20,background:"#22c55e",color:"white",borderRadius:12,padding:"10px 18px",fontSize:"0.8rem",fontWeight:700,zIndex:999}}>✓ Saved!</div>}
    {actionError&&<div style={{color:"#dc2626",fontSize:"0.8rem",marginBottom:10}}>{actionError}</div>}
    <div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`,maxWidth:520}}>
      <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:12}}>Footer contact & social links</div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {SITE_SETTINGS_FIELDS.map(f=>(
          <label key={f.key} style={{display:"flex",flexDirection:"column",gap:4}}>
            <span style={{color:theme.textMuted,fontSize:"0.68rem",fontWeight:700}}>{f.label}</span>
            <input value={form[f.key]} onChange={e=>setField(f.key,e.target.value)} placeholder={f.placeholder} style={{padding:"8px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.78rem",fontFamily:"inherit",background:theme.pageBg,color:theme.text}}/>
          </label>
        ))}
      </div>
      <button onClick={save} style={{marginTop:16,background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"8px 20px",fontSize:"0.78rem",fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Save</button>
    </div>
  </div>;
}

function SiteSettingsPanel({theme}) {
  const settings = useSiteSettings();

  return <div>
    {settings.isLoading&&<div style={{color:theme.textMuted,fontSize:"0.8rem"}}>Loading…</div>}
    {settings.isError&&<div style={{color:"#dc2626",fontSize:"0.8rem",marginBottom:10}}>Could not load site settings.</div>}
    {settings.data&&<SiteSettingsForm theme={theme} initial={settings.data} onSaved={settings.refetch}/>}
  </div>;
}

const STATUS_COLORS = {active:"#22c55e",invited:"#f59e0b",invite_expired:"#dc2626"};

function StaffManagementPanel({theme}) {
  const {data,isLoading,isError,refetch} = useStaffRoster();
  const [inviteName,setInviteName] = useState("");
  const [inviteEmail,setInviteEmail] = useState("");
  const [inviteRole,setInviteRole] = useState("");
  const [actionError,setActionError] = useState(null);

  const sendInvite = async () => {
    if(!inviteName||!inviteEmail||!inviteRole) return;
    setActionError(null);
    try {
      await apiPost("/api/accounts/staff/invite/",{full_name:inviteName,email:inviteEmail,role:inviteRole});
      setInviteName(""); setInviteEmail(""); setInviteRole("");
      refetch();
    } catch (err) { setActionError("Could not send the invite. Check the details and try again."); }
  };

  return <div>
    <div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`,marginBottom:16}}>
      <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:12}}>Invite a staff member</div>
      {actionError&&<div style={{color:"#dc2626",fontSize:"0.8rem",marginBottom:10}}>{actionError}</div>}
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        <input value={inviteName} onChange={e=>setInviteName(e.target.value)} placeholder="Full name" style={{flex:1,minWidth:120,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
        <input value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="Email" style={{flex:1,minWidth:120,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}/>
        <select value={inviteRole} onChange={e=>setInviteRole(e.target.value)} style={{width:120,padding:"6px 10px",borderRadius:10,border:`1.5px solid ${theme.border}`,fontSize:"0.75rem",fontFamily:"inherit"}}>
          <option value="">Role</option>
          <option value="super_admin">Super Admin</option>
          <option value="admin">Admin</option>
          <option value="accountant">Accountant</option>
          <option value="marketing">Marketing</option>
          <option value="support">Support</option>
        </select>
        <button onClick={sendInvite} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"6px 14px",fontSize:"0.72rem",fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>Send invite</button>
      </div>
    </div>

    {isLoading&&<div style={{color:theme.textMuted,fontSize:"0.8rem"}}>Loading…</div>}
    {isError&&<div style={{color:"#dc2626",fontSize:"0.8rem"}}>Could not load the staff roster.</div>}
    {data&&<div style={{background:theme.cardBg,borderRadius:16,padding:18,border:`1px solid ${theme.border}`}}>
      <div style={{color:theme.text,fontWeight:800,fontSize:"0.88rem",marginBottom:10}}>{data.count} staff members</div>
      {data.results.map(s=>(
        <div key={s.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:`1px solid ${theme.border}`}}>
          <div>
            <div style={{color:theme.text,fontWeight:700,fontSize:"0.8rem"}}>{s.full_name}</div>
            <div style={{color:theme.textMuted,fontSize:"0.68rem"}}>{s.email} • {s.role}</div>
          </div>
          <span style={{background:`${STATUS_COLORS[s.status]}22`,color:STATUS_COLORS[s.status],borderRadius:20,padding:"2px 8px",fontSize:"0.62rem",fontWeight:700}}>{s.status}</span>
        </div>
      ))}
    </div>}
  </div>;
}

export function StaffDashboard({auth,onExit}) {
  const {theme,toggleTheme} = useTheme();
  const t = DASHBOARD_THEME[theme];
  const [activeTab,setActiveTab] = useState("overview");
  const [sidebarCollapsed,setSidebarCollapsed] = useState(false);
  const role = auth.user?.role;
  const roleColor = ROLE_COLORS[role]||C.gold;

  const NAV_ITEMS = [
    {id:"overview",icon:"📊",label:"Overview",show:true},
    {id:"kyc",icon:"🪪",label:"KYC Queue",show:auth.hasPermission("kyc.approve")},
    {id:"moderation",icon:"📋",label:"Listings Moderation",show:auth.hasPermission("listings.moderate")},
    {id:"hero",icon:"🌟",label:"Hero Approval",show:auth.hasPermission("hero_media.approve")},
    {id:"users",icon:"👥",label:"Users",show:auth.hasPermission("users.view")},
    {id:"categories-zones",icon:"🗂️",label:"Categories & Zones",show:auth.hasPermission("categories.manage")||auth.hasPermission("zones.manage")},
    {id:"site-settings",icon:"🧭",label:"Site Settings",show:auth.hasPermission("site_settings.manage")},
    {id:"staff",icon:"🛡️",label:"Staff Management",show:auth.hasPermission("staff.manage")},
    {id:"escrow",icon:"💰",label:"Escrow Ledger",show:auth.hasPermission("escrow.view")||auth.hasPermission("escrow.release")},
    {id:"disputes",icon:"⚖️",label:"Disputes",show:auth.hasPermission("disputes.resolve_financial")||auth.hasPermission("disputes.flag")},
    {id:"transactions",icon:"📈",label:"Transactions Report",show:auth.hasPermission("transactions.report")},
    {id:"promotions",icon:"🎯",label:"Promotions",show:auth.hasPermission("promotions.manage")},
    {id:"analytics",icon:"📊",label:"Analytics",show:auth.hasPermission("analytics.view")},
    {id:"messaging",icon:"💬",label:"Messaging / Tickets",show:auth.hasPermission("messaging.manage")},
  ].filter(item=>item.show);

  return <div style={{fontFamily:"'Georgia',serif",background:t.pageBg,minHeight:"100vh",display:"flex"}}>
    <div style={{width:sidebarCollapsed?60:220,background:t.sidebarBg,borderLeft:`4px solid ${roleColor}`,transition:"width 0.2s",flexShrink:0,position:"sticky",top:0,height:"100vh",overflowY:"auto"}}>
      <div style={{padding:"16px 12px",display:"flex",alignItems:"center",gap:8}}>
        <Flag w={28} h={19}/>
        {!sidebarCollapsed&&<div style={{color:t.sidebarText,fontWeight:900,fontSize:"0.85rem"}}>AshantiHub Staff</div>}
      </div>
      <button onClick={()=>setSidebarCollapsed(s=>!s)} style={{background:"none",border:"none",color:t.textMuted,cursor:"pointer",padding:"4px 12px",fontSize:"0.7rem",fontFamily:"inherit"}}>{sidebarCollapsed?"→":"← Collapse"}</button>
      <nav>
        {NAV_ITEMS.map(item=>(
          <button key={item.id} onClick={()=>setActiveTab(item.id)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:activeTab===item.id?`${roleColor}22`:"none",border:"none",borderLeft:activeTab===item.id?`3px solid ${roleColor}`:"3px solid transparent",color:t.sidebarText,padding:"10px 12px",fontSize:"0.78rem",fontWeight:activeTab===item.id?800:600,cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}>
            <span>{item.icon}</span>{!sidebarCollapsed&&<span>{item.label}</span>}
          </button>
        ))}
      </nav>
    </div>

    <div style={{flex:1,minWidth:0}}>
      <div style={{background:t.cardBg,borderBottom:`1px solid ${t.border}`,padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:56,position:"sticky",top:0,zIndex:10}}>
        <div style={{color:t.text,fontWeight:800,fontSize:"0.9rem"}}>{NAV_ITEMS.find(i=>i.id===activeTab)?.label}</div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={toggleTheme} title="Toggle theme" style={{background:"none",border:`1px solid ${t.border}`,borderRadius:20,padding:"4px 10px",cursor:"pointer",fontSize:"0.8rem"}}>{theme==="dark"?"☀️":"🌙"}</button>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{background:roleColor,color:"white",borderRadius:20,padding:"2px 8px",fontSize:"0.62rem",fontWeight:800,textTransform:"capitalize"}}>{role?.replace("_"," ")}</span>
            <span style={{color:t.text,fontSize:"0.78rem",fontWeight:700}}>{auth.user?.full_name}</span>
          </div>
          <button onClick={onExit} style={{background:"none",border:`1px solid ${t.border}`,color:t.textMuted,borderRadius:20,padding:"4px 12px",fontSize:"0.7rem",cursor:"pointer",fontFamily:"inherit"}}>← Exit</button>
        </div>
      </div>

      <div style={{padding:"22px 20px 60px"}}>
        {activeTab==="overview"&&<StaffOverviewPanel auth={auth} theme={t} roleColor={roleColor}/>}
        {activeTab==="kyc"&&<KYCQueuePanel theme={t}/>}
        {activeTab==="moderation"&&<ListingsModerationPanel theme={t}/>}
        {activeTab==="hero"&&<HeroApprovalPanel theme={t}/>}
        {activeTab==="users"&&<UsersPanel theme={t}/>}
        {activeTab==="categories-zones"&&<CategoriesZonesPanel theme={t} auth={auth}/>}
        {activeTab==="site-settings"&&<SiteSettingsPanel theme={t}/>}
        {activeTab==="staff"&&<StaffManagementPanel theme={t}/>}
        {activeTab==="escrow"&&<ComingSoonPanel theme={t} feature="Escrow Ledger"/>}
        {activeTab==="disputes"&&<ComingSoonPanel theme={t} feature="Disputes"/>}
        {activeTab==="transactions"&&<ComingSoonPanel theme={t} feature="Transactions Report"/>}
        {activeTab==="promotions"&&<PromotionsInfoPanel theme={t}/>}
        {activeTab==="analytics"&&<ComingSoonPanel theme={t} feature="Analytics"/>}
        {activeTab==="messaging"&&<ComingSoonPanel theme={t} feature="Messaging / Tickets"/>}
      </div>
    </div>
  </div>;
}

// ─── Business Dashboard ───────────────────────────────────────────────────────
const mockEnquiries = [
  {id:1,customer:"Emma Thompson",country:"🇬🇧 UK",message:"I'd like to book 3 nights from June 15. Do you have availability?",time:"2 hours ago",status:"New"},
  {id:2,customer:"Hans Mueller",country:"🇩🇪 Germany",message:"What is your rate for the Akwasidae Festival weekend?",time:"5 hours ago",status:"Replied"},
  {id:3,customer:"Sophie Dubois",country:"🇫🇷 France",message:"Do you offer airport pickup from KIA?",time:"2 days ago",status:"New"},
];
// mockEnquiries / the Enquiries tab below are intentionally left on mock data —
// real-time+AI messaging is a separate, larger Phase-2 initiative
// (docs/PROJECT_SCOPE.md) and explicitly out of scope for this data-wiring pass.

const LISTING_STATUS_META = {
  draft: { label:"Draft", color:"#6b7280" },
  pending_review: { label:"Pending Review", color:"#f59e0b" },
  published: { label:"Published", color:"#22c55e" },
  rejected: { label:"Rejected", color:"#ef4444" },
};

const HERO_STATUS_META = {
  pending: { label:"Pending Review", color:"#f59e0b" },
  approved: { label:"Live", color:"#22c55e" },
  rejected: { label:"Rejected", color:"#ef4444" },
};

export function BusinessDashboard({ onExit, user, auth }) {
  const [bizTab, setBizTab] = useState("overview");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [resubmitting, setResubmitting] = useState(false);
  // Hero Spotlight (docs/BUSINESS_EVENTS_ROADMAP.md Phase 2). heroSubmitPhoto/
  // heroCaption/heroActionError/heroExtendDays/showHeroExtendPay are local UI
  // state for the submit/extend forms; the submission's actual status is
  // sourced from useMyHeroSubmission() below, which survives a page reload
  // (refetched after a successful submit/extend, same pattern as the rest of
  // this dashboard's mutation handling).
  const [heroSubmitPhoto, setHeroSubmitPhoto] = useState(null);
  const [heroCaption, setHeroCaption] = useState("");
  const [heroActionError, setHeroActionError] = useState(null);
  const [heroExtendDays, setHeroExtendDays] = useState(7);
  const [showHeroExtendPay, setShowHeroExtendPay] = useState(false);
  // Promotions (docs/BUSINESS_EVENTS_ROADMAP.md Phase 5). promote*/
  // showPromotePay mirror the Hero Spotlight submit/extend state shape above
  // — small inline-form local UI state. There's no "my promotions" list
  // endpoint in this phase (only the purchase call), so unlike heroSubmission
  // there's nothing to source from a query; promoteResult just holds the
  // just-created Promotion (with its server-computed amount_paid) between the
  // POST and the payment modal it opens.
  const [promoteListingId, setPromoteListingId] = useState(null);
  const [promoteKind, setPromoteKind] = useState("featured");
  const [promoteDays, setPromoteDays] = useState(7);
  const [promoteKeywords, setPromoteKeywords] = useState("");
  const [promoteActionError, setPromoteActionError] = useState(null);
  const [promoteResult, setPromoteResult] = useState(null);
  const [showPromotePay, setShowPromotePay] = useState(false);
  const isVerified = user?.kycStatus === "verified";
  const isRejected = user?.kycStatus === "rejected";

  const { data: listings, isLoading: listingsLoading, isError: listingsError, refetch: refetchListings } = useMyListings();
  const { data: profile, isLoading: profileLoading, isError: profileError } = useBusinessProfile();
  const { data: subPlans, isLoading: plansLoading, isError: plansError } = useSubscriptionPlans();
  const { data: subscription, isLoading: subLoading, isError: subError, refetch: refetchSubscription } = useMySubscription();
  const { data: heroSubmission, refetch: refetchHeroSubmission } = useMyHeroSubmission();

  if (resubmitting) {
    return <BusinessRegistrationFlow
      user={user} auth={auth} initialStep="business_info" prefill={profile}
      setPage={()=>setResubmitting(false)} setShowBizDash={()=>setResubmitting(false)}
    />;
  }

  const listingList = listings || [];
  const publishedCount = listingList.filter(l=>l.status==="published").length;
  const pendingCount = listingList.filter(l=>l.status==="pending_review").length;
  const draftCount = listingList.filter(l=>l.status==="draft").length;

  const showToast = () => { setSaved(true); setTimeout(()=>setSaved(false),2500); };

  const saveEdit = async (id) => {
    setActionError(null);
    try {
      await apiPatch(`/api/listings/mine/${id}/`, {
        name: editForm.name,
        price_amount: editForm.price_amount,
        price_unit: editForm.price_unit,
      });
      setEditingId(null);
      showToast();
      refetchListings();
    } catch (err) {
      setActionError("Could not save this listing. It may already be published, or a field may be invalid.");
    }
  };

  const submitForReview = async (id) => {
    setActionError(null);
    try {
      await apiPost(`/api/listings/mine/${id}/submit/`, {});
      showToast();
      refetchListings();
    } catch (err) {
      setActionError("Could not submit this listing for review.");
    }
  };

  const submitHeroPhoto = async () => {
    if(!heroSubmitPhoto||!heroCaption.trim()) return;
    setHeroActionError(null);
    try {
      await apiPost("/api/hero/submit/", {
        listing_photo: heroSubmitPhoto.id,
        caption: heroCaption.trim(),
      });
      setHeroSubmitPhoto(null);
      setHeroCaption("");
      showToast();
      refetchHeroSubmission();
    } catch (err) {
      setHeroActionError("Could not submit this photo for Hero — you may already have a pending or active submission.");
    }
  };

  const extendHeroSubmission = async (ref) => {
    setShowHeroExtendPay(false);
    if(!heroSubmission?.id) return;
    setHeroActionError(null);
    try {
      await apiPost(`/api/hero/${heroSubmission.id}/extend/`, { days: heroExtendDays });
      showToast();
      refetchHeroSubmission();
    } catch (err) {
      setHeroActionError("Payment was confirmed but we couldn't extend your Hero Spotlight. Please contact support with reference " + ref + ".");
    }
  };

  // Per the backend contract (docs/BUSINESS_EVENTS_ROADMAP.md Phase 5), a
  // single POST /api/listings/{id}/promote/ call both validates and applies
  // the promotion, returning amount_paid — unlike the hero-extend flow above,
  // there's no separate "confirm after payment" write. The MoMoPayment modal
  // here is purely the established simulated-pay UI step; on success we just
  // refetch + toast, we don't call the API again.
  const submitPromotion = async () => {
    if (!promoteListingId) return;
    if (promoteKind === "boost" && !promoteKeywords.trim()) return;
    setPromoteActionError(null);
    try {
      const body = { kind: promoteKind, days: promoteDays };
      if (promoteKind === "boost") body.keywords = promoteKeywords.trim();
      const res = await apiPost(`/api/listings/${promoteListingId}/promote/`, body);
      setPromoteResult(res);
      setPromoteListingId(null);
      setShowPromotePay(true);
    } catch (err) {
      setPromoteActionError("Could not create this promotion — it may already be active on this listing, or the listing isn't published yet.");
    }
  };

  const confirmPromotion = () => {
    setShowPromotePay(false);
    setPromoteResult(null);
    setPromoteKind("featured");
    setPromoteDays(7);
    setPromoteKeywords("");
    showToast();
    refetchListings();
  };

  const recordSubscriptionPayment = async (ref) => {
    setShowPayModal(false);
    if(!selectedPlan) return;
    setActionError(null);
    const amount = billingCycle==="monthly" ? Number(selectedPlan.monthly_price) : Number(selectedPlan.annual_price);
    try {
      await apiPost("/api/billing/transactions/mine/", {
        amount: amount.toFixed(2),
        purpose: `AshantiHub ${selectedPlan.name} Plan — ${billingCycle==="monthly"?"Monthly":"Annual"}`,
        reference: ref,
        status: "success",
      });
      await apiPost("/api/billing/subscriptions/me/", { plan: selectedPlan.tier, billing_cycle: billingCycle });
      showToast();
      refetchSubscription();
    } catch (err) {
      setActionError("Payment was confirmed but we couldn't record it on your account. Please contact support with reference " + ref + ".");
    }
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
        <MoMoPayment amount={billingCycle==="monthly"?Number(selectedPlan.monthly_price):Number(selectedPlan.annual_price)} purpose={`AshantiHub ${selectedPlan.name} Plan`} businessName={user?.fullName||"Your Business"} onSuccess={recordSubscriptionPayment} onClose={()=>setShowPayModal(false)}/>
      )}
      {showHeroExtendPay&&heroSubmission?.id&&(
        <MoMoPayment amount={heroExtendDays*5} purpose={`Extend Hero Spotlight — ${heroExtendDays} day${heroExtendDays===1?"":"s"}`} businessName={user?.fullName||"Your Business"} onSuccess={extendHeroSubmission} onClose={()=>setShowHeroExtendPay(false)}/>
      )}
      {showPromotePay&&promoteResult&&(
        <MoMoPayment amount={Number(promoteResult.amount_paid)} purpose={`${promoteResult.kind==="boost"?"Boost":"Featured"} promotion — ${promoteResult.kind==="boost"?promoteResult.keywords:"listing"}`} businessName={user?.fullName||"Your Business"} onSuccess={confirmPromotion} onClose={()=>setShowPromotePay(false)}/>
      )}
      <div style={{background:`linear-gradient(135deg,${C.darkBrown},${C.black})`,padding:"0 16px",position:"sticky",top:0,zIndex:100,boxShadow:"0 2px 20px rgba(0,0,0,0.4)"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
        <div style={{maxWidth:960,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:58}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <Flag w={44} h={30}/>
            <div><div style={{color:C.gold,fontWeight:900,fontSize:"0.92rem"}}>AshantiHub</div><div style={{color:"#aaa",fontSize:"0.6rem"}}>Business Dashboard</div></div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{color:"white",fontWeight:700,fontSize:"0.75rem"}}>{user?.fullName||"Your Business"}</div>
            <button onClick={onExit} style={{background:"none",border:"1px solid #444",color:"#aaa",borderRadius:20,padding:"4px 12px",fontSize:"0.68rem",cursor:"pointer",fontFamily:"inherit"}}>← Exit</button>
          </div>
        </div>
      </div>

      <div style={{background:"white",borderBottom:"1px solid #e8e8e8",padding:"0 16px",overflowX:"auto"}}>
        <div style={{maxWidth:960,margin:"0 auto",display:"flex"}}>
          {tabs.map(t=>(
            <button key={t.id} disabled={!isVerified} onClick={()=>isVerified&&setBizTab(t.id)} style={{background:"none",border:"none",borderBottom:bizTab===t.id?`3px solid ${C.gold}`:"3px solid transparent",color:!isVerified?"#ccc":bizTab===t.id?C.darkBrown:"#888",padding:"12px 16px",fontSize:"0.75rem",fontWeight:bizTab===t.id?800:600,cursor:isVerified?"pointer":"not-allowed",whiteSpace:"nowrap",fontFamily:"inherit"}}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {saved&&<div style={{position:"fixed",top:70,right:20,background:"#22c55e",color:"white",borderRadius:12,padding:"10px 18px",fontSize:"0.8rem",fontWeight:700,zIndex:999}}>✓ Saved!</div>}

      <div style={{maxWidth:960,margin:"0 auto",padding:"20px 16px 60px"}}>

        {actionError&&<div style={{background:"#fee2e2",color:"#dc2626",borderRadius:12,padding:"10px 14px",fontSize:"0.78rem",marginBottom:16}}>{actionError}</div>}

        {!isVerified ? (
          <div style={{background:"white",borderRadius:16,padding:"28px 24px",textAlign:"center",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
            {isRejected ? (
              <>
                <div style={{fontSize:"2rem",marginBottom:10}}>⚠️</div>
                <div style={{fontWeight:900,color:"#dc2626",fontSize:"1.05rem",marginBottom:8}}>Your application needs changes</div>
                <div style={{color:"#555",fontSize:"0.85rem",lineHeight:1.6,marginBottom:18,maxWidth:420,marginLeft:"auto",marginRight:"auto"}}>{user?.kycRejectionReason || "Our team found an issue with your submission."}</div>
                <button onClick={()=>setResubmitting(true)} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:30,padding:"11px 24px",fontWeight:900,fontSize:"0.85rem",cursor:"pointer",fontFamily:"inherit"}}>Fix and Resubmit</button>
              </>
            ) : (
              <>
                <div style={{fontSize:"2rem",marginBottom:10}}>⏳</div>
                <div style={{fontWeight:900,color:C.darkBrown,fontSize:"1.05rem",marginBottom:8}}>Your application is under review</div>
                <div style={{color:"#555",fontSize:"0.85rem",lineHeight:1.6}}>Our team is verifying your Ghana Card and business details. This usually takes 1-2 business days — you'll be able to manage listings, enquiries and your subscription here as soon as you're approved.</div>
              </>
            )}
          </div>
        ) : (
          <>

        {bizTab==="overview"&&(
          <>
            <div style={{background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`,borderRadius:16,padding:"20px",marginBottom:18,color:"white",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
              <div>
                <div style={{color:C.gold,fontWeight:900,fontSize:"1.1rem",marginBottom:4}}>Akwaaba, {user?.fullName?.split(" ")[0]||"there"}! 👋</div>
                <div style={{fontSize:"0.76rem",opacity:0.85}}>
                  {profileLoading ? "Loading your business details…" : profileError ? "Complete your KYC profile to see your business details here." : (profile?.gps_address ? `📍 ${profile.gps_address}` : "No location on file yet")}
                  {profile?.business_contact_phone ? ` • ${profile.business_contact_phone}` : ""}
                </div>
                <div style={{marginTop:8,fontSize:"0.68rem",opacity:0.8}}>
                  {subLoading ? "Loading subscription…" : subError ? "" : subscription?.id
                    ? `💳 ${subscription.plan?.name} plan • ${subscription.status} • renews ${subscription.current_period_end?.slice(0,10)}`
                    : "💳 No active subscription yet — see the Subscription tab"}
                </div>
              </div>
              <button onClick={()=>setBizTab("listings")} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:30,padding:"9px 18px",fontWeight:900,fontSize:"0.78rem",cursor:"pointer",fontFamily:"inherit"}}>Update Prices →</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12,marginBottom:18}}>
              {[
                {icon:"✅",label:"Published Listings",value:publishedCount,color:C.kente2},
                {icon:"⏳",label:"Pending Review",value:pendingCount,color:C.gold},
                {icon:"📝",label:"Drafts",value:draftCount,color:C.kente3},
                {icon:"💬",label:"Enquiries",value:mockEnquiries.length,color:C.orange},
              ].map(s=>(
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

            {heroSubmitPhoto&&(
              <div style={{background:"white",borderRadius:14,padding:"14px 16px",marginBottom:14,boxShadow:"0 2px 12px rgba(0,0,0,0.07)",border:`2px solid ${C.gold}`}}>
                <div style={{display:"flex",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
                  <img src={heroSubmitPhoto.image} alt="" style={{width:64,height:64,objectFit:"cover",borderRadius:10,flexShrink:0}}/>
                  <div style={{flex:1,minWidth:200}}>
                    <div style={{fontWeight:800,fontSize:"0.82rem",color:C.darkBrown,marginBottom:6}}>🌟 Submit this photo for Hero Spotlight</div>
                    <textarea value={heroCaption} onChange={e=>setHeroCaption(e.target.value.slice(0,140))} maxLength={140} placeholder="A one-sentence caption for the hero slider…" style={{width:"100%",minHeight:56,padding:8,borderRadius:8,border:"1.5px solid #ddd",fontSize:"0.78rem",fontFamily:"inherit",resize:"vertical",boxSizing:"border-box"}}/>
                    <div style={{fontSize:"0.62rem",color:"#aaa",textAlign:"right",marginBottom:8}}>{heroCaption.length}/140</div>
                    {heroActionError&&<div style={{color:"#dc2626",fontSize:"0.72rem",marginBottom:8}}>{heroActionError}</div>}
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={()=>{setHeroSubmitPhoto(null);setHeroCaption("");setHeroActionError(null);}} style={{flex:1,background:"#f0f0f0",color:"#666",border:"none",borderRadius:20,padding:"8px",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                      <button onClick={submitHeroPhoto} disabled={!heroCaption.trim()} style={{flex:2,background:heroCaption.trim()?C.gold:"#eee",color:heroCaption.trim()?C.darkBrown:"#aaa",border:"none",borderRadius:20,padding:"8px",fontWeight:900,cursor:heroCaption.trim()?"pointer":"default",fontFamily:"inherit"}}>✓ Submit for Hero</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {heroSubmission?.id&&!heroSubmitPhoto&&(
              <div style={{background:"white",borderRadius:14,padding:"14px 16px",marginBottom:14,boxShadow:"0 2px 12px rgba(0,0,0,0.07)",borderLeft:`4px solid ${HERO_STATUS_META[heroSubmission.status]?.color||"#888"}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                  <div>
                    <div style={{fontWeight:800,fontSize:"0.82rem",color:C.darkBrown}}>🌟 Hero Spotlight — <span style={{color:HERO_STATUS_META[heroSubmission.status]?.color}}>{HERO_STATUS_META[heroSubmission.status]?.label||heroSubmission.status}</span></div>
                    {heroSubmission.caption&&<div style={{fontSize:"0.7rem",color:"#888",marginTop:2}}>"{heroSubmission.caption}"</div>}
                    {heroSubmission.status==="approved"&&heroSubmission.expires_at&&<div style={{fontSize:"0.68rem",color:"#888",marginTop:2}}>Live until {heroSubmission.expires_at.slice(0,10)}</div>}
                    {heroSubmission.status==="rejected"&&heroSubmission.rejection_reason&&<div style={{fontSize:"0.68rem",color:"#dc2626",marginTop:2}}>Rejected: {heroSubmission.rejection_reason}</div>}
                  </div>
                  {heroSubmission.status==="approved"&&(
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <input type="number" min={1} value={heroExtendDays} onChange={e=>setHeroExtendDays(Math.max(1,Number(e.target.value)||1))} style={{width:56,padding:"6px 8px",borderRadius:8,border:"1.5px solid #ddd",fontSize:"0.75rem",fontFamily:"inherit"}}/>
                      <button onClick={()=>setShowHeroExtendPay(true)} style={{background:C.kente2,color:"white",border:"none",borderRadius:20,padding:"7px 14px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer"}}>💰 Extend {heroExtendDays}d</button>
                    </div>
                  )}
                </div>
                {heroActionError&&<div style={{color:"#dc2626",fontSize:"0.72rem",marginTop:8}}>{heroActionError}</div>}
              </div>
            )}

            {promoteListingId&&(
              <div style={{background:"white",borderRadius:14,padding:"14px 16px",marginBottom:14,boxShadow:"0 2px 12px rgba(0,0,0,0.07)",border:`2px solid ${C.kente1}`}}>
                <div style={{fontWeight:800,fontSize:"0.82rem",color:C.darkBrown,marginBottom:10}}>📣 Promote "{listingList.find(l=>l.id===promoteListingId)?.name}"</div>
                <div style={{display:"grid",gridTemplateColumns:promoteKind==="boost"?"1fr 1fr 1fr":"1fr 1fr",gap:10,marginBottom:10}}>
                  <div>
                    <label style={{fontSize:"0.68rem",fontWeight:700,color:C.darkBrown,display:"block",marginBottom:3}}>Type</label>
                    <select value={promoteKind} onChange={e=>setPromoteKind(e.target.value)} style={{width:"100%",padding:"8px",borderRadius:8,border:"1.5px solid #ddd",fontSize:"0.8rem",background:"white",fontFamily:"inherit"}}>
                      <option value="featured">Featured</option>
                      <option value="boost">Boost</option>
                    </select>
                  </div>
                  <div>
                    <label style={{fontSize:"0.68rem",fontWeight:700,color:C.darkBrown,display:"block",marginBottom:3}}>Days</label>
                    <input type="number" min={1} value={promoteDays} onChange={e=>setPromoteDays(Math.max(1,Number(e.target.value)||1))} style={{width:"100%",padding:"8px",borderRadius:8,border:"1.5px solid #ddd",fontSize:"0.8rem",fontFamily:"inherit",boxSizing:"border-box"}}/>
                  </div>
                  {promoteKind==="boost"&&(
                    <div>
                      <label style={{fontSize:"0.68rem",fontWeight:700,color:C.darkBrown,display:"block",marginBottom:3}}>Keywords</label>
                      <input value={promoteKeywords} onChange={e=>setPromoteKeywords(e.target.value)} placeholder="e.g. jollof, catering" style={{width:"100%",padding:"8px",borderRadius:8,border:"1.5px solid #ddd",fontSize:"0.8rem",fontFamily:"inherit",boxSizing:"border-box"}}/>
                    </div>
                  )}
                </div>
                {promoteActionError&&<div style={{color:"#dc2626",fontSize:"0.72rem",marginBottom:8}}>{promoteActionError}</div>}
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>{setPromoteListingId(null);setPromoteActionError(null);}} style={{flex:1,background:"#f0f0f0",color:"#666",border:"none",borderRadius:20,padding:"8px",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                  <button onClick={submitPromotion} disabled={promoteKind==="boost"&&!promoteKeywords.trim()} style={{flex:2,background:(promoteKind==="boost"&&!promoteKeywords.trim())?"#eee":C.kente1,color:(promoteKind==="boost"&&!promoteKeywords.trim())?"#aaa":"white",border:"none",borderRadius:20,padding:"8px",fontWeight:900,cursor:(promoteKind==="boost"&&!promoteKeywords.trim())?"default":"pointer",fontFamily:"inherit"}}>📣 Promote {promoteDays}d</button>
                </div>
              </div>
            )}

            {listingsLoading&&<div style={{color:"#888",fontSize:"0.8rem"}}>Loading your listings…</div>}
            {listingsError&&<div style={{color:"#dc2626",fontSize:"0.8rem"}}>Could not load your listings. Make sure you're signed in as a business owner.</div>}
            {!listingsLoading&&!listingsError&&listingList.length===0&&(
              <div style={{background:"white",borderRadius:14,padding:"24px",textAlign:"center",color:"#888",fontSize:"0.82rem"}}>You don't have any listings yet.</div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {listingList.map(item=>{
                const statusMeta = LISTING_STATUS_META[item.status]||{label:item.status,color:"#888"};
                const canEdit = item.status!=="published";
                return (
                <div key={item.id} style={{background:"white",borderRadius:14,padding:"14px 16px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",border:editingId===item.id?`2px solid ${C.gold}`:"2px solid transparent"}}>
                  {editingId===item.id?(
                    <div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                        <div><label style={{fontSize:"0.68rem",fontWeight:700,color:C.darkBrown,display:"block",marginBottom:3}}>Name</label>
                          <input value={editForm.name||""} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))} style={{width:"100%",padding:"8px",borderRadius:8,border:"1.5px solid #ddd",fontSize:"0.8rem",fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                        </div>
                        <div><label style={{fontSize:"0.68rem",fontWeight:700,color:C.darkBrown,display:"block",marginBottom:3}}>Price (GHS)</label>
                          <input type="number" value={editForm.price_amount||""} onChange={e=>setEditForm(f=>({...f,price_amount:e.target.value}))} style={{width:"100%",padding:"8px",borderRadius:8,border:"1.5px solid #ddd",fontSize:"0.8rem",fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                        </div>
                        <div><label style={{fontSize:"0.68rem",fontWeight:700,color:C.darkBrown,display:"block",marginBottom:3}}>Unit</label>
                          <select value={editForm.price_unit||""} onChange={e=>setEditForm(f=>({...f,price_unit:e.target.value}))} style={{width:"100%",padding:"8px",borderRadius:8,border:"1.5px solid #ddd",fontSize:"0.8rem",background:"white",fontFamily:"inherit"}}>
                            {["per night","per person","per day","per item","per service"].map(u=><option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={()=>setEditingId(null)} style={{flex:1,background:"#f0f0f0",color:"#666",border:"none",borderRadius:20,padding:"8px",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                        <button onClick={()=>saveEdit(item.id)} style={{flex:2,background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"8px",fontWeight:900,cursor:"pointer",fontFamily:"inherit"}}>✓ Save</button>
                      </div>
                    </div>
                  ):(
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                      <div>
                        <div style={{fontWeight:800,fontSize:"0.85rem",color:C.darkBrown}}>{item.name} <span style={{background:`${statusMeta.color}22`,color:statusMeta.color,borderRadius:20,padding:"2px 7px",fontSize:"0.6rem",fontWeight:700}}>{statusMeta.label}</span></div>
                        <div style={{fontWeight:900,color:C.kente2,fontSize:"0.95rem",marginTop:2}}>{item.price_amount!=null?`GHS ${item.price_amount}`:"No price set"} <span style={{color:"#aaa",fontWeight:400,fontSize:"0.72rem"}}>{item.price_unit}</span></div>
                        {item.updated_at&&<div style={{fontSize:"0.62rem",color:freshnessColor(item.updated_at),fontWeight:700,marginTop:2}}>🕐 {freshnessLabel(item.updated_at)}</div>}
                        {item.status==="rejected"&&item.rejection_reason&&<div style={{fontSize:"0.65rem",color:"#dc2626",marginTop:3}}>Rejected: {item.rejection_reason}</div>}
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        {canEdit&&<button onClick={()=>{setEditingId(item.id);setEditForm({name:item.name,price_amount:item.price_amount,price_unit:item.price_unit});}} style={{background:`${C.gold}22`,color:C.deepGold,border:"none",borderRadius:20,padding:"6px 12px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer"}}>✏️ Edit</button>}
                        {(item.status==="draft"||item.status==="rejected")&&<button onClick={()=>submitForReview(item.id)} style={{background:C.kente2,color:"white",border:"none",borderRadius:20,padding:"6px 12px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer"}}>📤 Submit for Review</button>}
                        {item.status==="published"&&<button onClick={()=>{setPromoteListingId(item.id);setPromoteKind("featured");setPromoteDays(7);setPromoteKeywords("");setPromoteActionError(null);}} style={{background:`${C.kente1}22`,color:C.kente1,border:"none",borderRadius:20,padding:"6px 12px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer"}}>📣 Promote</button>}
                      </div>
                    </div>
                  )}
                  {/* Gallery photos — Submit for Hero. */}
                  {item.photos.length>0&&(
                    <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #f0f0f0"}}>
                      <div style={{fontSize:"0.66rem",fontWeight:700,color:C.darkBrown,marginBottom:6}}>📸 Gallery</div>
                      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                        {item.photos.map(photo=>(
                          <div key={photo.id} style={{textAlign:"center"}}>
                            <img src={photo.image} alt="" style={{width:56,height:56,objectFit:"cover",borderRadius:8,border:heroSubmitPhoto?.id===photo.id?`2px solid ${C.gold}`:"1px solid #eee",display:"block"}}/>
                            <button onClick={()=>{setHeroSubmitPhoto({id:photo.id,image:photo.image,listingId:item.id});setHeroCaption("");setHeroActionError(null);}} style={{display:"block",marginTop:4,background:"none",border:"none",color:C.deepGold,fontSize:"0.6rem",fontWeight:700,cursor:"pointer",fontFamily:"inherit",padding:0}}>🌟 Submit for Hero</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );})}
            </div>
          </>
        )}

        {bizTab==="enquiries"&&(
          <>
            <h2 style={{margin:"0 0 4px",color:C.darkBrown,fontWeight:900,fontSize:"0.98rem"}}>💬 Customer Enquiries</h2>
            {/* Fraud-prevention (docs/UI_MODERNIZATION_ROADMAP.md Phase F):
                business owners can no longer reply to a customer's enquiry
                directly — every enquiry is routed through AshantiHub Support,
                who relay between the customer and the business. The action
                below opens a discussion with Support about the enquiry, not
                a reply back to the customer. */}
            <div style={{color:"#777",fontSize:"0.76rem",lineHeight:1.6,marginBottom:14}}>
              For customer safety, enquiries are routed through AshantiHub Support rather than sent to you directly. Discuss or resolve an enquiry with Support below — Support will relay your response to the customer.
            </div>
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
                <a href={`https://wa.me/233244000000?text=${encodeURIComponent(`Hello AshantiHub team, I'd like to discuss an enquiry from ${e.customer.split(" ")[0]}: "${e.message}"`)}`} target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:5,background:C.whatsapp,color:"white",borderRadius:20,padding:"6px 14px",fontSize:"0.7rem",fontWeight:700,textDecoration:"none"}}>💬 Discuss with AshantiHub Support</a>
              </div>
            ))}
          </>
        )}

        {bizTab==="subscription"&&(
          <>
            <h2 style={{margin:"0 0 14px",color:C.darkBrown,fontWeight:900,fontSize:"0.98rem"}}>💳 Subscription</h2>
            {subLoading&&<div style={{color:"#888",fontSize:"0.8rem",marginBottom:16}}>Loading your subscription…</div>}
            {subError&&<div style={{color:"#dc2626",fontSize:"0.8rem",marginBottom:16}}>Could not load your subscription. Make sure you're signed in as a business owner.</div>}
            {!subLoading&&!subError&&(
              subscription?.id?(
                <div style={{background:`linear-gradient(135deg,${C.kente2},#003d22)`,borderRadius:14,padding:"18px",color:"white",marginBottom:16}}>
                  <div style={{fontWeight:900,fontSize:"1rem",color:C.gold,marginBottom:4}}>💳 {subscription.plan?.name} Plan — {subscription.status}</div>
                  <div style={{fontSize:"0.78rem",opacity:0.9}}>Billing: {subscription.billing_cycle} • Renews <strong>{subscription.current_period_end?.slice(0,10)}</strong></div>
                </div>
              ):(
                <div style={{background:`linear-gradient(135deg,${C.kente2},#003d22)`,borderRadius:14,padding:"18px",color:"white",marginBottom:16}}>
                  <div style={{fontWeight:900,fontSize:"1rem",color:C.gold,marginBottom:4}}>🎁 No Active Subscription</div>
                  <div style={{fontSize:"0.78rem",opacity:0.9}}>Choose a plan below to activate your listings.</div>
                </div>
              )
            )}
            <div style={{display:"inline-flex",background:"#f0f0f0",borderRadius:30,padding:3,gap:3,marginBottom:16}}>
              {["monthly","annual"].map(c=>(
                <button key={c} onClick={()=>setBillingCycle(c)} style={{background:billingCycle===c?"white":"transparent",border:"none",borderRadius:28,padding:"6px 16px",fontWeight:billingCycle===c?800:600,fontSize:"0.75rem",cursor:"pointer",fontFamily:"inherit",color:billingCycle===c?C.darkBrown:"#888"}}>
                  {c==="monthly"?"Monthly":"Annual 🎁 Save 2 months"}
                </button>
              ))}
            </div>
            {plansLoading&&<div style={{color:"#888",fontSize:"0.8rem"}}>Loading plans…</div>}
            {plansError&&<div style={{color:"#dc2626",fontSize:"0.8rem"}}>Could not load subscription plans.</div>}
            {!plansLoading&&!plansError&&(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12}}>
                {(subPlans||[]).map(plan=>(
                  <div key={plan.id} style={{background:"white",borderRadius:14,padding:"18px",boxShadow:"0 2px 14px rgba(0,0,0,0.08)",border:`2px solid ${plan.is_recommended?C.gold:"transparent"}`,position:"relative"}}>
                    {plan.is_recommended&&<div style={{position:"absolute",top:-9,left:"50%",transform:"translateX(-50%)",background:C.gold,color:C.darkBrown,borderRadius:20,padding:"2px 12px",fontSize:"0.58rem",fontWeight:900,whiteSpace:"nowrap"}}>⭐ MOST POPULAR</div>}
                    <div style={{fontWeight:900,color:C.darkBrown,marginBottom:2}}>{plan.name}</div>
                    <div style={{fontWeight:900,fontSize:"1.5rem",color:C.darkBrown,marginBottom:10}}>GHS {billingCycle==="monthly"?Number(plan.monthly_price).toLocaleString():Number(plan.annual_price).toLocaleString()}<span style={{fontSize:"0.7rem",fontWeight:400,color:"#aaa"}}>/{billingCycle==="monthly"?"mo":"yr"}</span></div>
                    {(plan.features||[]).map(f=><div key={f} style={{fontSize:"0.7rem",color:"#444",marginBottom:4}}>✓ {f}</div>)}
                    <button onClick={()=>{setSelectedPlan(plan);setShowPayModal(true);}} style={{width:"100%",marginTop:12,background:plan.is_recommended?C.gold:"#f0f0f0",color:plan.is_recommended?C.darkBrown:"#666",border:"none",borderRadius:20,padding:"9px",fontWeight:900,cursor:"pointer",fontFamily:"inherit",fontSize:"0.78rem"}}>💰 Pay with MoMo</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

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
  return <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(215px,1fr))",gap:14}}>
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

// ─── Routing (docs/UI_MODERNIZATION_ROADMAP.md Phase D) ──────────────────────
// AshantiHub's `page` state used to be a bare useState with zero URL sync —
// visiting a path like /business directly, or hard-reloading while on it,
// always bounced to home because nothing ever read window.location. These
// two maps are the single source of truth translating between the two:
// PATH_TO_PAGE for "URL → page" (derived below via useLocation()),
// PAGE_TO_PATH for "page → URL" (used by the setPage() wrapper below, which
// is what actually gets handed to Navbar/Footer2/etc. as the `setPage` prop
// so every existing `setPage("x")` call site — including Navbar.jsx, which
// is NOT touched by this phase — keeps working unchanged).
// `isAdmin` stays local state, not a route (see the /staff effects below —
// it can be set by the 5-click-logo gesture or a staff login while sitting
// on some other path, not just by URL). `showBizDash`/`showPayments`/
// `showCredit`/`selectedListingId`/`selectedEventId` were originally scoped
// out of the first Phase-D slice as local state too, but were brought into
// real routing in a follow-up slice (see DASH_PATH_TO_FLAG/FLAG_TO_DASH_PATH
// and the businessDetailMatch/eventDetailMatch useMatch()es below) so every
// page in the app is hard-reload-safe, per an explicit scope override.
const PATH_TO_PAGE = {
  "/": "home",
  "/business": "business",
  "/events": "events",
  "/about": "about",
  "/contact": "contact",
  "/register": "register",
};
const PAGE_TO_PATH = {
  home: "/",
  business: "/business",
  events: "/events",
  about: "/about",
  contact: "/contact",
  register: "/register",
};
// Full-page dashboard "routes" (isAdmin/showBizDash-style early returns) that
// now have real URLs too. Same two-map convention as PATH_TO_PAGE/
// PAGE_TO_PATH above, just keyed by the boolean flag name instead of `page`.
const DASH_PATH_TO_FLAG = {
  "/business-dashboard": "showBizDash",
  "/payments": "showPayments",
  "/credit": "showCredit",
};
const FLAG_TO_DASH_PATH = {
  showBizDash: "/business-dashboard",
  showPayments: "/payments",
  showCredit: "/credit",
};
// /staff is a real path but not part of the page switch above — it drives
// `isAdmin`/the staff-login modal instead (see the two effects below), so it
// must not be treated as a 404 even though it has no PATH_TO_PAGE entry.
// The three dashboard paths above are static (no :id) so they belong in this
// same set; /business/:id and /events/:id are dynamic-segment paths handled
// separately via useMatch() below, since a Set of exact strings can't match
// them.
const KNOWN_PATHS = new Set([...Object.keys(PATH_TO_PAGE), ...Object.keys(DASH_PATH_TO_FLAG), "/staff"]);

export default function AshantiHub() {
  const location = useLocation();
  const navigate = useNavigate();
  // /business/:id and /events/:id are dynamic-segment paths — useMatch()
  // (rather than hand-parsing location.pathname, and without introducing
  // <Routes>/<Route> element matching, which would force splitting
  // AshantiHub into route-specific components) is the idiomatic way to both
  // detect "are we on a detail route" and extract the :id param in one shot.
  const businessDetailMatch = useMatch("/business/:id");
  const eventDetailMatch = useMatch("/events/:id");
  // `page` is now derived straight from the URL rather than owned locally —
  // hard reloading on any of these paths renders that page immediately
  // instead of bouncing to home. Unrecognized paths (other than /staff, see
  // above) fall back to "home" here; the real 404 page is rendered by the
  // `show404` early return further down, which takes precedence.
  // /business/:id and /events/:id have no PATH_TO_PAGE entry (they're not in
  // the static map — see businessDetailMatch/eventDetailMatch above), so
  // they're folded in here: a business/event detail URL is still page
  // "business"/"events" so the surrounding tab chrome (hero carousel,
  // banner, search bar, category tabs, CTA footer) stays mounted, exactly as
  // it already does when selectedListingId/selectedEventId was local state.
  const page = PATH_TO_PAGE[location.pathname]
    ?? (businessDetailMatch ? "business" : eventDetailMatch ? "events" : "home");
  const setPage = (id) => {
    const path = PAGE_TO_PATH[id] ?? "/";
    if (location.pathname !== path) navigate(path);
  };
  const show404 = !KNOWN_PATHS.has(location.pathname) && !businessDetailMatch && !eventDetailMatch;
  const [authModal,setAuthModal]=useState(null);
  const auth=useAuth();
  const user=auth.user ? {fullName:auth.user.full_name,accountType:auth.user.account_type,id:auth.user.id,registrationStep:auth.user.registration_step,kycStatus:auth.user.kyc_status,kycRejectionReason:auth.user.kyc_rejection_reason} : null;
  // Site-wide light/dark toggle (docs/UI_MODERNIZATION_ROADMAP.md Phase E) —
  // same useTheme() hook StaffDashboard already uses internally, but lifted
  // here so the customer-facing Navbar can offer the same control. The
  // `dark` class on <html> is what Tailwind's `dark:` variants (and the CSS
  // variable swap in index.css's `.dark` block) key off of; this only
  // affects Tailwind-built surfaces (currently the footer) — the legacy
  // inline-style `C`-palette surfaces are unaffected by design.
  const {theme,toggleTheme} = useTheme();
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  const [legalDoc,setLegalDoc]=useState(null);
  // showBizDash/showPayments/showCredit — same "derive from the URL, wrap the
  // setter in a navigate() closure" pattern as `page`/`setPage` above, so
  // Navbar.jsx/BusinessRegistrationFlow.jsx/the inline CTA buttons in this
  // file keep calling setShowBizDash(true)/setShowBizDash(false) etc.
  // unchanged while the URL (and hard-reload-safety) comes along for free.
  const showBizDash = location.pathname === FLAG_TO_DASH_PATH.showBizDash;
  const setShowBizDash = (val) => {
    const path = val ? FLAG_TO_DASH_PATH.showBizDash : "/";
    if (val ? !showBizDash : showBizDash) navigate(path);
  };
  const showPayments = location.pathname === FLAG_TO_DASH_PATH.showPayments;
  const setShowPayments = (val) => {
    const path = val ? FLAG_TO_DASH_PATH.showPayments : "/";
    if (val ? !showPayments : showPayments) navigate(path);
  };
  const showCredit = location.pathname === FLAG_TO_DASH_PATH.showCredit;
  const setShowCredit = (val) => {
    const path = val ? FLAG_TO_DASH_PATH.showCredit : "/";
    if (val ? !showCredit : showCredit) navigate(path);
  };
  const [isAdmin,setIsAdmin]=useState(false);
  const [adminClicks,setAdminClicks]=useState(0);
  const [favourites,setFavourites]=useState([]);
  const [showFavs,setShowFavs]=useState(false);
  const [showCart,setShowCart]=useState(false);
  const [showAccount,setShowAccount]=useState(false);
  const [showReferral,setShowReferral]=useState(false);
  const [showNotifs,setShowNotifs]=useState(false);
  const [currency,setCurrency]=useState("GHS");
  const [lang,setLang]=useState("en");
  const [showFilters,setShowFilters]=useState(false);

  // ── Live marketplace data (categories/zones/listings) ─────────────────────
  const [filters, setFilters] = useState({ category: "hotels" });
  // PDP (ListingDetailPage) selection — mirrors the isAdmin/showBizDash-style
  // "flag swaps in a full component" convention, but scoped inside the
  // page==="business" block (see the JSX below) rather than a top-level
  // early return, so the hero carousel/banner/search/category tabs/CTA
  // stay mounted around the PDP instead of also disappearing. Now derived
  // from the /business/:id URL (via businessDetailMatch above) rather than
  // local state, so a direct/hard-reloaded visit to /business/123 opens the
  // PDP immediately; the setter is a navigate() closure so Card's
  // onOpen={(id)=>setSelectedListingId(id)} and ListingDetailPage's own
  // onOpenListing/onBack call sites need zero changes.
  const selectedListingId = businessDetailMatch ? businessDetailMatch.params.id : null;
  const setSelectedListingId = (id) => {
    const path = id != null ? `/business/${id}` : "/business";
    if (location.pathname !== path) navigate(path);
  };

  // Free-text search + price inputs are debounced before they hit `filters` (useListings' query
  // key), so a user typing a search term or a price doesn't fire one backend request per keystroke.
  // Local state updates instantly (input stays responsive); the debounced effect below writes into
  // `filters` ~300ms after the user stops typing. Category tabs / zone dropdown are discrete
  // click/select events and are NOT debounced — they write straight into `filters`.
  const [searchInput, setSearchInput] = useState("");
  const [minPriceInput, setMinPriceInput] = useState("");
  const [maxPriceInput, setMaxPriceInput] = useState("");

  useEffect(()=>{
    const t=setTimeout(()=>{
      setFilters(f=>(f.search===searchInput?f:{...f,search:searchInput||undefined}));
    },300);
    return ()=>clearTimeout(t);
  },[searchInput]);

  useEffect(()=>{
    const t=setTimeout(()=>{
      const val = minPriceInput===""?undefined:Number(minPriceInput);
      setFilters(f=>(f.minPrice===val?f:{...f,minPrice:val}));
    },300);
    return ()=>clearTimeout(t);
  },[minPriceInput]);

  useEffect(()=>{
    const t=setTimeout(()=>{
      const val = maxPriceInput===""?undefined:Number(maxPriceInput);
      setFilters(f=>(f.maxPrice===val?f:{...f,maxPrice:val}));
    },300);
    return ()=>clearTimeout(t);
  },[maxPriceInput]);

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

  // ── Events tab (docs/BUSINESS_EVENTS_ROADMAP.md Phase 6) ──────────────────
  // Same filters-state/debounced-search/PDP-swap conventions as the Business
  // tab above, kept as its own independent state rather than reusing
  // `filters`/`selectedListingId` — the two tabs' underlying data (Listing
  // vs Event) and filter shapes (Event has no price/kind/verified) are
  // different enough that sharing state would just mean constantly stripping
  // Business-only fields back out.
  const [eventFilters, setEventFilters] = useState({});
  // Same URL-derived pattern as selectedListingId above, backed by
  // /events/:id via eventDetailMatch instead of /business/:id.
  const selectedEventId = eventDetailMatch ? eventDetailMatch.params.id : null;
  const setSelectedEventId = (id) => {
    const path = id != null ? `/events/${id}` : "/events";
    if (location.pathname !== path) navigate(path);
  };
  const [eventSearchInput, setEventSearchInput] = useState("");
  const [showEventFilters, setShowEventFilters] = useState(false);
  const [showEventSubmit, setShowEventSubmit] = useState(false);

  useEffect(()=>{
    const t=setTimeout(()=>{
      setEventFilters(f=>(f.search===eventSearchInput?f:{...f,search:eventSearchInput||undefined}));
    },300);
    return ()=>clearTimeout(t);
  },[eventSearchInput]);

  const {
    data: eventsData,
    isLoading: eventsLoading,
    isFetching: eventsFetching,
    isError: eventsError,
    fetchNextPage: fetchNextEventsPage,
    hasNextPage: hasNextEventsPage,
    refetch: refetchEvents,
  } = useEvents(eventFilters);
  const events = eventsData ? eventsData.pages.flatMap((page) => page.results) : [];
  const eventCategories = (categories||[]).filter(c=>c.kind==="event");
  const activeEventCatObj = eventCategories.find(c=>c.slug===eventFilters.category);

  // Cart (docs/BUSINESS_EVENTS_ROADMAP.md Phase 4) — customer-only. Fetched
  // here (rather than only inside CartDrawer) so the Navbar's cart-icon badge
  // count is available regardless of which page/overlay is showing, same as
  // `unreadMessages` below is computed here for ChatLauncher. `enabled` is
  // gated to signed-in Customer accounts so anonymous visitors and business
  // owners (who have no Cart) don't fire a doomed-to-401/403 request every
  // render. CartDrawer itself also calls useCart() — same query key, so
  // React Query dedupes/shares the cache rather than double-fetching.
  const isCustomer = user?.accountType === "customer";
  const { data: cart, refetch: refetchCart } = useCart(isCustomer);
  const cartItemCount = cart?.items?.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  // Add-to-cart (docs/BUSINESS_EVENTS_ROADMAP.md Phase 4) — passed down to
  // ListingDetailPage as `onAddToCart`, same "AshantiHub owns the mutation,
  // the component just calls the callback and owns its own local adding/
  // added/error UI state" convention as onMessage above. Throws (rather
  // than swallowing) on failure so ListingDetailPage's
  // own try/catch can surface a specific message next to the button.
  const handleAddToCart = async (item, quantity = 1) => {
    if (!user) { setAuthModal("signup"); throw new Error("Please sign in as a customer to add items to your cart."); }
    if (!isCustomer) { throw new Error("Only customer accounts can add items to a cart."); }
    await apiPost("/api/cart/items/", { listing: item.id, quantity });
    refetchCart();
  };

  const [cookieConsent,setCookieConsent]=useState(false);
  const [cookieDismissed,setCookieDismissed]=useState(false);
  const [showMessaging,setShowMessaging]=useState(false);
  const [messagingBusiness,setMessagingBusiness]=useState(null);
  const [isLoading,setIsLoading]=useState(true);
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

  // ── `/staff` route (docs/UI_MODERNIZATION_ROADMAP.md Phase D) ────────────
  // Replaces the old hand-rolled 3-effect pushState/popstate dance with real
  // router-based handling, now that react-router is available. `isAdmin`
  // stays the actual state driving StaffDashboard's early return below — it
  // is not itself derived from the URL, since it can also be set by the
  // 5-click-logo gesture (handleLogoClick) or a successful staff login
  // (AuthModal's onSuccess) while already sitting on some other path.
  //
  // Three effects:
  // 1. One-time deep-link prompt — if a visitor lands directly on /staff and
  //    isn't already a logged-in staff session, open the staff-login modal.
  //    Gated by a ref so it only ever fires once (matches the old behavior);
  //    it waits for the session-restore fetch (auth.isLoading) to settle so
  //    a logged-in staff member refreshing on /staff isn't briefly (and
  //    incorrectly) sent to the login modal while auth.user is still null.
  // 2. URL → isAdmin sync — keeps isAdmin consistent with the current path
  //    for any navigation react-router already knows about, including
  //    browser back/forward (no manual popstate listener needed — a
  //    location change re-renders this component with the new
  //    `location.pathname`, and this effect just reacts to it). Landing on
  //    /staff already logged in as staff (direct visit or hard reload) also
  //    flows through here once auth.isLoading settles.
  // 3. isAdmin → URL sync — whenever isAdmin becomes true via some *other*
  //    path (the 5-click-logo gesture, or a successful staff login while
  //    already on /staff from effect 1's modal), navigate to /staff so the
  //    URL reflects it; whenever it becomes false (StaffDashboard's
  //    onExit), navigate back to "/".
  const staffLoginPromptShown=useRef(false);
  useEffect(()=>{
    if(staffLoginPromptShown.current) return;
    if(auth.isLoading) return;
    if(location.pathname!=="/staff") return;
    staffLoginPromptShown.current=true;
    if(auth.user?.account_type!=="staff") setAuthModal("staff-login");
  },[auth.isLoading,auth.user,location.pathname]);

  useEffect(()=>{
    if(auth.isLoading) return;
    const shouldBeAdmin = location.pathname==="/staff" && auth.user?.account_type==="staff";
    setIsAdmin((current)=> current===shouldBeAdmin ? current : shouldBeAdmin);
  },[location.pathname,auth.user,auth.isLoading]);

  // Tracks the *previous* isAdmin value so the "navigate home" branch below
  // only fires on a genuine true→false transition (StaffDashboard's onExit),
  // not merely because isAdmin's initial `useState(false)` value happens to
  // be false on the very first render. Without this, a not-yet-staff visitor
  // landing on /staff would get redirected to "/" by this effect in the same
  // commit that effect #1 opens the login modal in, before effect #2 (URL →
  // isAdmin sync) even has a chance to settle — silently defeating every
  // direct /staff visit for a non-staff session, mirroring exactly the race
  // the old hand-rolled version's `staffUrlHandled` ref guard existed to
  // prevent. Found via manual browser verification, not caught by tests.
  const wasAdminRef=useRef(isAdmin);
  useEffect(()=>{
    const wasAdmin=wasAdminRef.current;
    wasAdminRef.current=isAdmin;
    if(isAdmin){
      if(location.pathname!=="/staff") navigate("/staff");
    }else if(wasAdmin && location.pathname==="/staff"){
      navigate("/");
    }
  },[isAdmin]);

  const handleLogoClick=()=>{
    const n=adminClicks+1;
    setAdminClicks(n);
    if(n>=5){
      setAdminClicks(0);
      if(auth.user?.account_type==="staff"){setIsAdmin(true);}
      else{setAuthModal("staff-login");}
    }
  };
  const toggleFav=(id)=>setFavourites(f=>f.includes(id)?f.filter(x=>x!==id):[...f,id]);
  // Businesses can no longer be contacted directly (fraud-prevention —
  // docs/UI_MODERNIZATION_ROADMAP.md Phase F): the old handleWA/WABtn combo
  // that opened a wa.me chat with *a business* is gone. AshantiHub's own
  // WhatsApp-based concierge/support channels (grocery concierge, Contact
  // page, floating WhatsApp button, NotFoundPage) are genuine platform
  // support, not business contact, so they stay as inline wa.me links below.
  const handleConciergeWA=(phone,name)=>{if(!user){setAuthModal("signup");return;}const msg=encodeURIComponent(`Hello ${name}! I'd like some help via AshantiHub.`);window.open(`https://wa.me/${phone}?text=${msg}`,"_blank");};

  const showRegistrationFlow = (page==="register" && !user) ||
    (user?.accountType==="business_owner" && user.registrationStep && user.registrationStep!=="complete");
  if(showRegistrationFlow) return <BusinessRegistrationFlow user={user} auth={auth} initialStep={user?.registrationStep} setPage={setPage} setShowBizDash={setShowBizDash}/>;

  if(isAdmin) return <StaffDashboard auth={auth} onExit={()=>setIsAdmin(false)}/>;
  if(showBizDash) return <BusinessDashboard onExit={()=>setShowBizDash(false)} user={user} auth={auth}/>;
  if(showPayments) return <PaymentDashboard onClose={()=>setShowPayments(false)}/>;
  if(showCredit) return <CreditDashboard onClose={()=>setShowCredit(false)} user={user}/>;
  if(isLoading) return <LoadingScreen/>;
  if(show404) return <NotFoundPage onHome={()=>setPage("home")}/>;

  const activeCatObj=categories?.find(c=>c.slug===filters.category);

  // Category strip grouping for the Business tab — see groupCategoriesByKind above.
  const {productCategories,serviceCategories}=groupCategoriesByKind(categories);

  // Unread-messages badge count for Navbar — MOCK_CONVERSATIONS is mock
  // messaging data (Phase-2 messaging is out of scope, see App.jsx notes
  // near MessagingCenter), so this stays computed here rather than moving.
  const unreadMessages = MOCK_CONVERSATIONS.reduce((s, c) => s + c.unread, 0);

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
      {authModal&&<AuthModal authState={authModal} auth={auth} onClose={()=>setAuthModal(null)} onSuccess={(result)=>{setAuthModal(null);if(result.account_type==="staff"){setIsAdmin(true);}}}/>}
      {showMessaging&&<MessagingCenter user={user} onClose={()=>{setShowMessaging(false);setMessagingBusiness(null);}} initialBusiness={messagingBusiness}/>}
      {showNotifs&&<NotificationsPanel user={user} onClose={()=>setShowNotifs(false)}/>}
      {showFavs&&<FavsDrawer/>}
      {showCart&&isCustomer&&<CartDrawer user={user} currency={currency} onClose={()=>setShowCart(false)} PaymentComponent={MoMoPayment}/>}
      {showReferral&&<ReferralModal user={user} onClose={()=>setShowReferral(false)}/>}
      {showAccount&&user&&<AccountPanel
        user={user}
        favourites={favourites}
        onClose={()=>setShowAccount(false)}
        onOpenSaved={()=>{setShowAccount(false);setShowFavs(true);}}
        onOpenMessages={()=>{setShowAccount(false);setShowMessaging(true);}}
      />}
      <Navbar
        page={page} setPage={setPage}
        lang={lang} setLang={setLang}
        user={user} auth={auth}
        handleLogoClick={handleLogoClick}
        setAuthModal={setAuthModal}
        setShowNotifs={setShowNotifs}
        setShowBizDash={setShowBizDash}
        setShowPayments={setShowPayments}
        setShowAccount={setShowAccount}
        setShowCart={setShowCart}
        cartCount={cartItemCount}
        theme={theme} toggleTheme={toggleTheme}
        T={T}
      />

      {page==="home"&&(
        <>
          <Hero
            T={T}
            user={user}
            setAuthModal={setAuthModal}
            setPage={setPage}
          />

          {/* Referral CTA */}
          {user&&(
            <div style={{background:`linear-gradient(135deg,${C.kente1},${C.kente3})`,padding:"22px 20px",textAlign:"center"}}>
              <div style={{fontSize:"1.5rem",marginBottom:6}}>🎁</div>
              <div style={{color:C.gold,fontWeight:900,marginBottom:4,fontSize:"0.95rem"}}>Refer friends & earn GHS 10 each</div>
              <div style={{color:"white",fontSize:"0.75rem",marginBottom:12,opacity:0.85}}>Share AshantiHub and earn mobile money credit for every friend who signs up.</div>
              <button onClick={()=>setShowReferral(true)} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:30,padding:"9px 22px",fontWeight:900,fontSize:"0.82rem",cursor:"pointer",fontFamily:"inherit"}}>Get My Referral Code →</button>
            </div>
          )}

          <HomeCtaBand/>
        </>
      )}

      {/* Business page — the marketplace browsing experience (search, category
          tabs, filters, listings grid) that used to live directly on the home
          page, relocated here per the redesign brief so "Business" in the nav
          is where customers browse businesses. The business owner's own
          private BusinessDashboard is a click away via the button below,
          rather than what this nav item opens directly. */}
      {page==="business"&&(
        <>
          {/* Hero carousel — approved/non-expired hero-media submissions
              (docs/BUSINESS_EVENTS_ROADMAP.md Phase 2/3). Renders nothing when
              there are none active, so it never leaves a disruptive empty gap. */}
          <HeroCarousel/>

          {/* Support-contact notice — was a "message businesses directly on
              WhatsApp" pitch; reworded for the fraud-prevention change
              (docs/UI_MODERNIZATION_ROADMAP.md Phase F) where all business
              contact is routed through AshantiHub Support instead. */}
          <div style={{background:C.void,borderBottom:`1.5px solid ${C.whatsapp}30`,padding:"10px 16px",textAlign:"center"}}>
            <span style={{fontSize:"0.72rem",color:C.lightGold,fontWeight:600}}>
              🛡️ For your safety, business contact is handled by AshantiHub Support
              {!user&&<span> — <span onClick={()=>setAuthModal("signup")} style={{color:C.gold,cursor:"pointer",fontWeight:800,textDecoration:"underline"}}>Sign up free</span> to reach Support instantly</span>}
            </span>
          </div>

          {/* Mobile "open filters" bar — search now lives inside Sidebar as its
              first field (docs/UI_MODERNIZATION_ROADMAP.md Phase G; the old
              standalone top search bar, its POPULAR SEARCHES suggestions
              dropdown, Map View toggle, Saved button, and currency selector
              are all gone — Saved businesses are reachable via AccountPanel's
              existing "❤️ Saved Businesses" entry instead). On desktop the
              Sidebar is always visible alongside the grid, so this bar is
              mobile-only (ah-filter-trigger-bar media query below); on mobile
              it opens Sidebar as a slide-in panel. */}
          <div className="ah-filter-trigger-bar" style={{background:C.darkBrown,padding:"12px 16px"}}>
            <button onClick={() => setShowFilters((f) => !f)} style={{ background: "#f5f5f5", border: "none", borderRadius: 30, padding: "10px 20px", cursor: "pointer", fontSize: "0.8rem", fontWeight: 700, fontFamily: "inherit" }}>
              ⚙️ Filters & Search
            </button>
            <style>{`
              .ah-filter-trigger-bar { display: none; }
              @media (max-width: 760px) { .ah-filter-trigger-bar { display: block; } }
            `}</style>
          </div>

          {selectedListingId ? (
            <ListingDetailPage
              id={selectedListingId}
              onBack={()=>setSelectedListingId(null)}
              user={user}
              favourites={favourites}
              onFavourite={toggleFav}
              currency={currency}
              onMessage={(biz)=>{setMessagingBusiness(biz);setShowMessaging(true);if(!user)setAuthModal("signup");}}
              onOpenListing={(otherId)=>setSelectedListingId(otherId)}
              onAddToCart={handleAddToCart}
              CardComponent={Card}
            />
          ) : (
          <div style={{background:C.void,paddingBottom:1}}>
          {/* Category tabs — split into Products/Services rows by Category.kind
              (docs/BUSINESS_EVENTS_ROADMAP.md Phase 3). The old cross-category
              smart-search results banner that lived here has been removed
              along with the smart-search engine (see note above); the search
              box's results now just show up in the grid below, scoped to the
              active category tab. */}
          <div style={{maxWidth:1280,margin:"0 auto",padding:"16px 14px 0"}}>
            {productCategories.length>0&&(
              <>
                <div style={{color:C.lightGold,fontSize:"0.62rem",fontWeight:800,letterSpacing:1.5,opacity:0.65,marginBottom:5}}>PRODUCTS</div>
                <div style={{display:"flex",gap:7,overflowX:"auto",paddingBottom:8,scrollbarWidth:"none"}}>
                  {productCategories.map(cat=>(
                    <button key={cat.id} onClick={()=>setFilters(f=>({...f,category:cat.slug,kind:cat.kind}))} style={{background:filters.category===cat.slug?cat.color:"rgba(255,255,255,0.06)",color:"white",border:`2px solid ${cat.color}`,borderRadius:30,padding:"6px 12px",fontSize:"0.72rem",fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",boxShadow:filters.category===cat.slug?`0 4px 12px ${cat.color}55`:"none",transition:"all 0.2s"}}>
                      {cat.icon} {cat.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {serviceCategories.length>0&&(
              <>
                <div style={{color:C.lightGold,fontSize:"0.62rem",fontWeight:800,letterSpacing:1.5,opacity:0.65,margin:"10px 0 5px"}}>SERVICES</div>
                <div style={{display:"flex",gap:7,overflowX:"auto",paddingBottom:4,scrollbarWidth:"none"}}>
                  {serviceCategories.map(cat=>(
                    <button key={cat.id} onClick={()=>setFilters(f=>({...f,category:cat.slug,kind:cat.kind}))} style={{background:filters.category===cat.slug?cat.color:"rgba(255,255,255,0.06)",color:"white",border:`2px solid ${cat.color}`,borderRadius:30,padding:"6px 12px",fontSize:"0.72rem",fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",boxShadow:filters.category===cat.slug?`0 4px 12px ${cat.color}55`:"none",transition:"all 0.2s"}}>
                      {cat.icon} {cat.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Sidebar (filters) + main content — desktop: fixed column beside the
              grid; mobile: Sidebar becomes a slide-in panel toggled by the ⚙️
              trigger above, matching Navbar.jsx's mobile-menu convention. */}
          <div style={{maxWidth:1280,margin:"0 auto",padding:"16px 14px 40px",display:"flex",gap:20,alignItems:"flex-start"}}>
            <Sidebar
              zones={zones}
              filters={filters}
              setFilters={setFilters}
              minPriceInput={minPriceInput}
              setMinPriceInput={setMinPriceInput}
              maxPriceInput={maxPriceInput}
              setMaxPriceInput={setMaxPriceInput}
              onClear={()=>{setSearchInput("");setFilters(f=>({category:f.category,kind:f.kind}));setMinPriceInput("");setMaxPriceInput("");}}
              open={showFilters}
              onClose={()=>setShowFilters(false)}
              search={searchInput}
              onSearchChange={setSearchInput}
            />
            <div style={{flex:1,minWidth:0}}>
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
                <button onClick={()=>handleConciergeWA("233244999000","AshantiHub Grocery Concierge")} style={{marginTop:16,background:C.whatsapp,color:"white",border:"none",borderRadius:30,padding:"11px 24px",fontWeight:900,cursor:"pointer",fontFamily:"inherit",fontSize:"0.85rem"}}>
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
                    {/* Dense multi-column tile grid ("4x5" per the redesign brief — reads as 4
                        columns on desktop, fewer on narrower viewports; not a hard-coded 20-item
                        page). Promoted/boosted sorting-first lands in a later phase — this renders
                        `listings` in whatever order the API returns, unsorted client-side. */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(215px,1fr))",gap:14}}>
                      {listings.map(item=><Card key={item.id} item={item} accentColor={activeCatObj?.color} user={user} favourites={favourites} onFavourite={toggleFav} currency={currency} onMessage={(biz)=>{setMessagingBusiness(biz);setShowMessaging(true);if(!user)setAuthModal("signup");}} onOpen={(id)=>setSelectedListingId(id)}/>)}
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
          </div>
          </div>
          )}

          {/* Ghana flag divider */}
          <div style={{height:10,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>

          {/* CTA */}
          <BusinessCtaBand onRegister={()=>setPage("register")}/>
        </>
      )}

      {/* Events page — a full Events tab rebuilt on the Business tab's
          Sidebar/grid/PDP-swap conventions (docs/BUSINESS_EVENTS_ROADMAP.md
          Phase 6): hero carousel of live events that have uploaded media ->
          intro banner + "Submit an Event" toggle (EventSubmissionPanel) ->
          search bar -> category strip (Category.kind==="event") + Sidebar
          (zone + clear only — price range/sort/verified toggle are hidden,
          since GET /api/events/ has no price/ordering/verified concept) +
          a teaser-card grid with infinite scroll. `selectedEventId` swaps
          the Sidebar+grid area for EventDetailPage, same "flag swaps in a
          component, scoped inside the page==='events' block" convention as
          `selectedListingId`/ListingDetailPage in the Business tab above. */}
      {page==="events"&&(
        <>
          <EventHeroCarousel onOpen={(id)=>setSelectedEventId(id)}/>

          <div style={{background:C.void,borderBottom:`1.5px solid ${C.gold}30`,padding:"10px 16px",textAlign:"center"}}>
            <span style={{fontSize:"0.72rem",color:C.lightGold,fontWeight:600}}>
              🥁 Plan your visit around Kumasi's cultural calendar
              {!user&&<span> — <span onClick={()=>setAuthModal("signup")} style={{color:C.gold,cursor:"pointer",fontWeight:800,textDecoration:"underline"}}>Sign up free</span> to submit your own event</span>}
            </span>
          </div>

          {/* Search bar */}
          <div style={{background:C.darkBrown,padding:"16px",position:"relative"}}>
            <div style={{maxWidth:1280,margin:"0 auto",position:"relative"}}>
              <div style={{display:"flex",borderRadius:30,overflow:"hidden",boxShadow:"0 4px 20px rgba(0,0,0,0.35)"}}>
                <input
                  value={eventSearchInput}
                  onChange={(e)=>setEventSearchInput(e.target.value)}
                  placeholder="Search events…"
                  style={{flex:1,padding:"13px 18px",border:"none",fontSize:"0.85rem",background:"white",outline:"none",fontFamily:"inherit"}}/>
                {eventSearchInput&&<button onClick={()=>{setEventSearchInput("");setEventFilters(f=>({...f,search:undefined}));}} style={{background:"white",border:"none",padding:"0 8px",cursor:"pointer",color:"#aaa",fontSize:"1.1rem"}}>✕</button>}
                {/* Filters trigger — mobile-only, same convention as the Business tab's ⚙️ trigger (Sidebar becomes a slide-in panel there too). */}
                <button onClick={()=>setShowEventFilters(f=>!f)} className="ah-event-filter-trigger" style={{background:"#f5f5f5",border:"none",padding:"13px 14px",cursor:"pointer",fontSize:"0.85rem"}} title="Filters">⚙️</button>
                <button style={{background:C.gold,color:C.black,border:"none",padding:"13px 18px",fontWeight:900,cursor:"pointer"}}>🔍</button>
              </div>
              <div style={{marginTop:10,display:"flex",justifyContent:"flex-end"}}>
                <button onClick={()=>setShowEventSubmit(s=>!s)} style={{background:showEventSubmit?C.gold:"rgba(255,255,255,0.12)",color:showEventSubmit?C.darkBrown:"white",border:"1px solid rgba(255,255,255,0.3)",borderRadius:20,padding:"6px 14px",fontSize:"0.72rem",fontWeight:700,cursor:"pointer"}}>
                  {showEventSubmit?"✕ Close":"📅 Submit an Event"}
                </button>
              </div>
            </div>
            <style>{`
              @media (min-width: 761px) { .ah-event-filter-trigger { display: none !important; } }
            `}</style>
          </div>

          {showEventSubmit&&(
            <div style={{maxWidth:1280,margin:"0 auto",padding:"16px 14px 0"}}>
              <EventSubmissionPanel user={user} categories={categories} zones={zones} PaymentComponent={MoMoPayment}/>
            </div>
          )}

          {selectedEventId ? (
            <EventDetailPage id={selectedEventId} onBack={()=>setSelectedEventId(null)} user={user}/>
          ) : (
          <div style={{background:C.void,paddingBottom:1}}>
            {eventCategories.length>0&&(
              <div style={{maxWidth:1280,margin:"0 auto",padding:"16px 14px 0"}}>
                <div style={{color:C.lightGold,fontSize:"0.62rem",fontWeight:800,letterSpacing:1.5,opacity:0.65,marginBottom:5}}>CATEGORIES</div>
                <div style={{display:"flex",gap:7,overflowX:"auto",paddingBottom:8,scrollbarWidth:"none"}}>
                  <button onClick={()=>setEventFilters(f=>({...f,category:undefined}))} style={{background:!eventFilters.category?C.gold:"rgba(255,255,255,0.06)",color:!eventFilters.category?C.darkBrown:"white",border:`2px solid ${C.gold}`,borderRadius:30,padding:"6px 12px",fontSize:"0.72rem",fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                    🥁 All Events
                  </button>
                  {eventCategories.map(cat=>(
                    <button key={cat.id} onClick={()=>setEventFilters(f=>({...f,category:cat.slug}))} style={{background:eventFilters.category===cat.slug?cat.color:"rgba(255,255,255,0.06)",color:"white",border:`2px solid ${cat.color}`,borderRadius:30,padding:"6px 12px",fontSize:"0.72rem",fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",boxShadow:eventFilters.category===cat.slug?`0 4px 12px ${cat.color}55`:"none",transition:"all 0.2s"}}>
                      {cat.icon} {cat.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{maxWidth:1280,margin:"0 auto",padding:"16px 14px 40px",display:"flex",gap:20,alignItems:"flex-start"}}>
              <Sidebar
                zones={zones}
                filters={eventFilters}
                setFilters={setEventFilters}
                onClear={()=>setEventFilters(f=>({category:f.category,search:f.search}))}
                open={showEventFilters}
                onClose={()=>setShowEventFilters(false)}
                showPriceRange={false}
                showSort={false}
                showVerifiedToggle={false}
              />
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <h2 style={{margin:0,color:C.darkBrown,fontSize:"0.95rem",fontWeight:900}}>
                    {activeEventCatObj?activeEventCatObj.icon:"🥁"} {activeEventCatObj?activeEventCatObj.label:"All Events"}
                    <span style={{color:"#999",fontWeight:400,fontSize:"0.72rem",marginLeft:6}}>{events.length} results</span>
                  </h2>
                  <span style={{background:`${C.gold}15`,border:`1px solid ${C.gold}44`,borderRadius:20,padding:"3px 9px",fontSize:"0.65rem",color:C.gold,fontWeight:700}}>📍 Kumasi</span>
                </div>

                {eventsLoading ? (
                  <ListingsSkeleton/>
                ) : eventsError ? (
                  <div style={{textAlign:"center",padding:"30px"}}>
                    Something went wrong loading events.{" "}
                    <button onClick={()=>refetchEvents()} style={{background:"none",border:`1px solid ${C.kente1}`,color:C.kente1,borderRadius:20,padding:"4px 12px",fontSize:"0.75rem",fontWeight:700,cursor:"pointer"}}>Retry</button>
                  </div>
                ) : events.length===0 ? (
                  <div style={{textAlign:"center",padding:"40px",color:"#aaa"}}>
                    <div style={{fontSize:"2rem",marginBottom:8}}>🥁</div>
                    <div>No events found. Try adjusting your filters.</div>
                  </div>
                ) : (
                  <>
                    {eventsFetching&&<div style={{height:3,background:C.gold,marginBottom:10,borderRadius:2}}/>}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(215px,1fr))",gap:14}}>
                      {events.map(item=><EventCard key={item.id} item={item} onOpen={(id)=>setSelectedEventId(id)}/>)}
                    </div>
                    {hasNextEventsPage&&(
                      <div style={{textAlign:"center",marginTop:18}}>
                        <button onClick={()=>fetchNextEventsPage()} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:30,padding:"9px 24px",fontWeight:900,fontSize:"0.8rem",cursor:"pointer",fontFamily:"inherit"}}>Load more</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          )}

          <EventsCtaBand imageUrl={KUMASI_PHOTOS.akwasidae} onSubmitEvent={()=>setShowEventSubmit(true)}/>
        </>
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
        </div>
      )}

      {page==="about"&&(
        <AboutCtaBand user={user} onCreateAccount={()=>setAuthModal("signup")} onRegister={()=>setPage("register")}/>
      )}

      {/* Contact page */}
      {page==="contact"&&(
        <div style={{maxWidth:640,margin:"0 auto",padding:"24px 20px"}}>
          <div style={{borderRadius:18,overflow:"hidden",marginBottom:20,position:"relative",padding:"28px 24px",background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
            <div style={{color:C.gold,fontWeight:900,fontSize:"1.3rem",marginBottom:6}}>👑 Get In Touch</div>
            <div style={{color:"white",fontSize:"0.82rem",opacity:0.9,lineHeight:1.6}}>Questions about a listing, a partnership, or your business account? We're based in Kumasi and we reply fast — WhatsApp is the quickest way to reach us.</div>
          </div>

          <div style={{display:"grid",gap:12,marginBottom:20}}>
            {[
              {icon:"📍",title:"Location",body:"Kumasi, Ashanti Region, Ghana"},
              {icon:"✉️",title:"Email",body:"info@ashantihub.com"},
              {icon:"🕑",title:"Support Hours",body:"Mon–Sat, 8:00am – 8:00pm GMT"},
            ].map((c,i)=>(
              <div key={i} style={{background:"white",borderRadius:16,padding:"14px 18px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",display:"flex",gap:14,alignItems:"center"}}>
                <div style={{fontSize:"1.4rem"}}>{c.icon}</div>
                <div>
                  <div style={{fontWeight:800,color:C.darkBrown,fontSize:"0.82rem"}}>{c.title}</div>
                  <div style={{color:"#555",fontSize:"0.78rem"}}>{c.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {page==="contact"&&(
        <ContactCtaBand
          user={user}
          onCreateAccount={()=>setAuthModal("signup")}
          whatsappPhone="233244000000"
          whatsappName="AshantiHub Support"
          WhatsAppButton={WABtn}
        />
      )}

      {/* Footer — every page except the redesigned full-viewport home landing page */}
      {page!=="home"&&<Footer2 setPage={setPage} setShowBizDash={setShowBizDash} setLegalDoc={setLegalDoc}/>}

      {/* Floating chat launcher — opens the existing (mock, Phase-2) MessagingCenter */}
      <ChatLauncher
        unreadMessages={unreadMessages}
        onOpen={() => { setShowMessaging(true); if (!user) setAuthModal("signup"); }}
        bottom={(cookieDismissed ? 24 : 100) + 64}
      />

      {/* Floating WhatsApp */}
      <div onClick={()=>user?window.open("https://wa.me/233244000000","_blank"):setAuthModal("signup")}
        style={{position:"fixed",bottom:cookieDismissed?24:100,right:20,background:C.whatsapp,color:"white",borderRadius:"50%",width:50,height:50,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 20px rgba(37,211,102,0.5)",zIndex:998,cursor:"pointer"}}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
      </div>
    </div>
  );
}
