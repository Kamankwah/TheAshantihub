import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate, useMatch } from "react-router-dom";
import { useCategories } from "./hooks/useCategories.js";
import { useZones } from "./hooks/useZones.js";
import { useListings } from "./hooks/useListings.js";
import { useListing } from "./hooks/useListing.js";
import { useEvents } from "./hooks/useEvents.js";
import { useAuth } from "./hooks/useAuth.js";
import { useTheme } from "./hooks/useTheme.js";
import { useMyListings } from "./hooks/useMyListings.js";
import { useMyHeroSubmission } from "./hooks/useMyHeroSubmission.js";
import { useBusinessProfile } from "./hooks/useBusinessProfile.js";
import { useSubscriptionPlans } from "./hooks/useSubscriptionPlans.js";
import { useMySubscription } from "./hooks/useMySubscription.js";
import { useMyTransactions } from "./hooks/useMyTransactions.js";
import { useMyCreditScore } from "./hooks/useMyCreditScore.js";
import { useCart } from "./hooks/useCart.js";
import { useListingReviews } from "./hooks/useListingReviews.js";
import { useReviewEligibility } from "./hooks/useReviewEligibility.js";
import { useOrders } from "./hooks/useOrders.js";
import { useMyConversations } from "./hooks/useMyConversations.js";
import { useMyTickets } from "./hooks/useMyTickets.js";
import { useMyCustomerProfile } from "./hooks/useMyCustomerProfile.js";
import { useSiteSettings } from "./hooks/useSiteSettings.js";
import { apiFetch, apiPost, apiPatch } from "./apiClient.js";
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
import { AccountProfileCard } from "./components/ui/account-profile-card.tsx";
import { AboutPage } from "./components/ui/about-page.tsx";
import { AboutTestimonialsSection } from "./components/ui/about-testimonials-section.tsx";
import { AboutFaqSection } from "./components/ui/about-faq-section.tsx";
import { ContactPage } from "./components/ui/contact-page.tsx";
import BusinessRegistrationFlow from "./components/BusinessRegistrationFlow.jsx";
import CartDrawer from "./components/CartDrawer.jsx";
import EventHeroCarousel from "./components/EventHeroCarousel.jsx";
import EventCard, { formatEventDate } from "./components/EventCard.jsx";
import EventDetailPage from "./components/EventDetailPage.jsx";
import EventSubmissionPanel from "./components/EventSubmissionPanel.jsx";
import BusinessCommandCenter from "./components/dashboard/BusinessCommandCenter.jsx";
import AdminCommandCenter from "./components/admin/AdminCommandCenter.jsx";
import { D, glassCard, ghs } from "./components/dashboard/theme.js";
import KpiCard from "./components/dashboard/charts/KpiCard.jsx";
import ChartFrame from "./components/dashboard/charts/ChartFrame.jsx";
import SpendAreaChart from "./components/dashboard/charts/SpendAreaChart.jsx";
import ListingsDonut from "./components/dashboard/charts/ListingsDonut.jsx";

// ─── Payment System ───────────────────────────────────────────────────────────
const MOMO_NETWORKS = [
  { id:"mtn", name:"MTN MoMo", color:"#FCD116", textColor:"#1A1A1A", logo:"🟡", ussd:"*170#", fee:"1.5%" },
  { id:"vodafone", name:"Vodafone Cash", color:"#E31837", textColor:"white", logo:"🔴", ussd:"*110#", fee:"1.5%" },
  { id:"airteltigo", name:"AirtelTigo Money", color:"#E87722", textColor:"white", logo:"🟠", ussd:"*500#", fee:"1.5%" },
];

// SUBSCRIPTION_PLANS / MOCK_TRANSACTIONS / MOCK_INVOICES (mock data + the
// InvoiceModal component that rendered MOCK_INVOICES) were removed here —
// the Business Command Center's Payments and Subscription tabs now read real
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

  // Hubtel integration (docs/HUBTEL_INTEGRATION.md, plan Workstream E) — the
  // real 30s "processing" countdown/success-receipt UI below only makes
  // sense in simulated mode, where there's no real gateway and onSuccess's
  // caller records the payment directly. When payments_provider is
  // "hubtel", the *real* wait/confirmation happens on Hubtel's own hosted
  // checkout page after redirect — reached in each of the ~7 onSuccess
  // handlers' own added `mode==="redirect"` branch (see e.g.
  // CartDrawer.jsx's handlePaymentSuccess) once process_payment()'s
  // response comes back. So step 3 here just fires onSuccess immediately
  // (no countdown) and shows a "redirecting" message instead of the
  // simulated processing/receipt UI — the caller is what actually performs
  // `window.location.href = checkout_url`. `useSiteSettings()` is read here
  // rather than threaded down as a prop since every one of this component's
  // ~7 call sites would otherwise need to plumb it through identically.
  const { data: siteSettings } = useSiteSettings();
  const isHubtel = siteSettings?.payments_provider === "hubtel";

  useEffect(() => {
    if (step === 3 && !success && isHubtel) {
      // No countdown in Hubtel mode — call onSuccess right away so the
      // caller can redirect to the real Hubtel checkout_url as soon as
      // possible, rather than making the user sit through a fake wait for
      // a "success" this component has no way of actually confirming.
      onSuccess && onSuccess(txnRef);
      return;
    }
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
  }, [step, success, isHubtel]);

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
              {isHubtel ? (
                // Hubtel mode: onSuccess already fired the instant this step
                // was reached (see the effect above) — the caller is about
                // to redirect the browser to Hubtel's real checkout_url, so
                // this is just a brief "hang on" message, not a fake
                // processing/receipt UI this component can't actually back.
                <>
                  <div style={{ fontSize:"3rem", marginBottom:14 }}>
                    <div style={{ display:"inline-block", animation:"spin 1s linear infinite" }}>⏳</div>
                  </div>
                  <div style={{ fontWeight:900, color:C.darkBrown, fontSize:"1rem", marginBottom:6 }}>Redirecting to secure payment…</div>
                  <div style={{ color:"#555", fontSize:"0.78rem", lineHeight:1.6 }}>
                    You're being taken to Hubtel to complete your GHS {amount.toFixed(2)} payment.
                  </div>
                </>
              ) : !success ? (
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
// customer<->business channel. Backed by the real `messaging` app
// (useMyConversations()/POST /api/messaging/conversations/(:id/messages/)?)
// as of the system-admin-dashboard real-data-wiring work — this used to read
// a hardcoded MOCK_CONVERSATIONS array (deleted). `subject` is kept as the
// "what this thread is about" context (shown as a "Re:" line when set), not
// as who the customer is chatting with; `sender_type` is "customer",
// "business_owner", or "staff" (never a business itself) to keep that
// honest in the transcript itself. Read/unread has no backing field on the
// real `Message` model (unlike the old mock's per-message `read` flag), so
// this derives a "needs your attention" indicator instead: a conversation is
// flagged whenever it's `open` and its most recent message is from staff —
// naturally clearing itself once the caller replies (their own reply becomes
// the new most-recent message), no separate "mark as read" call needed.
const QUICK_REPLIES = [
  "Is this available?",
  "What are your opening hours?",
  "Do you accept MoMo payment?",
  "Can you deliver?",
  "What is your best price?",
  "I'd like to make a booking",
];

function needsCustomerAttention(conv) {
  const last = conv.messages?.[conv.messages.length - 1];
  return conv.status === "open" && last?.sender_type === "staff";
}

function formatConvTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-GH", { month: "short", day: "numeric" });
}

// `embedded` (messaging fixes work) — false (default) renders as the
// existing small bottom-right-anchored floating widget (Card's Contact
// Support, ListingDetailPage, ChatLauncher's own render all use this
// default); true renders the same two-pane layout inline in normal document
// flow instead, sized to fill its container — used only by UserPanel's
// Messages tab, where a full floating widget/backdrop makes no sense inside
// an already-dedicated dashboard tab.
function MessagingCenter({ user, onClose, initialBusiness, embedded = false, onRequestSignIn }) {
  // "Signed in" is not the same thing as "holds a support inbox here":
  // /api/messaging/conversations/ admits only Customer/BusinessOwner
  // (messaging/views.py's IsCustomerOrBusinessOwner). A staff session is
  // signed in but reads these same threads through the admin MessagingPanel
  // (/api/messaging/staff/) instead, so gating on !!user fired a guaranteed
  // 403 — and would 403 again on send, since POST is gated identically.
  const canHoldConversation = user?.accountType === "customer" || user?.accountType === "business_owner";
  const selfSenderType = user?.accountType === "business_owner" ? "business_owner" : "customer";
  const { data: conversationsData, refetch } = useMyConversations(canHoldConversation);
  const conversations = conversationsData || [];
  const [activeConvId, setActiveConvId] = useState(null);
  const [newMessage, setNewMessage] = useState("");
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [searchConv, setSearchConv] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const hasAutoSelectedRef = useRef(false);
  // Set when a guest attempts a send (sign-in modal opens instead); once the
  // sign-in completes and `user` flips to an account that can hold a
  // conversation, the effect below fires the send automatically so the
  // guest's typed message goes out without a second press of the button.
  const pendingSendRef = useRef(false);

  useEffect(() => {
    if (canHoldConversation && pendingSendRef.current && newMessage.trim()) {
      pendingSendRef.current = false;
      sendMessage();
    }
    if (canHoldConversation) pendingSendRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canHoldConversation]);

  // Auto-pick a starting conversation the first time the list loads —
  // preferring one already "about" the business/listing this was opened
  // for, else the most recently active one (Conversation.Meta.ordering is
  // ["-updated_at"], so conversations[0] is already that). Only runs once
  // per mount (hasAutoSelectedRef) so the "✉️ Start New Conversation"
  // button below (which deliberately sets activeConvId back to null) isn't
  // immediately overridden by this effect re-picking the same conversation.
  useEffect(() => {
    if (hasAutoSelectedRef.current || conversations.length === 0) return;
    hasAutoSelectedRef.current = true;
    const bySubject = initialBusiness && conversations.find(c => c.subject?.includes(initialBusiness.name));
    setActiveConvId((bySubject || conversations[0]).id);
  }, [conversations, initialBusiness]);

  const activeConv = conversations.find(c => c.id === activeConvId) || null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [activeConv?.messages]);

  const sendMessage = async () => {
    if(!newMessage.trim()) return;
    // A guest can type freely — the sign-in ask happens only at the moment
    // they actually try to send (user-initiated, never automatic on open).
    // Their draft stays in the input, and pendingSendRef makes it auto-send
    // the moment sign-in completes (see the effect below) so they don't
    // have to press send twice.
    if(!canHoldConversation){ pendingSendRef.current = true; onRequestSignIn?.(); return; }
    setSending(true);
    setActionError(null);
    try {
      if (activeConv) {
        await apiPost(`/api/messaging/conversations/${activeConv.id}/messages/`, { body: newMessage });
      } else {
        const subject = initialBusiness ? `Re: ${initialBusiness.name}` : "";
        const created = await apiPost(`/api/messaging/conversations/`, { subject, body: newMessage });
        setActiveConvId(created.id);
      }
      setNewMessage("");
      setShowQuickReplies(false);
      await refetch();
    } catch (err) {
      setActionError("Could not send your message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const totalUnread = conversations.filter(needsCustomerAttention).length;
  const filteredConvs = conversations.filter(c => (c.subject || "AshantiHub Support").toLowerCase().includes(searchConv.toLowerCase()));

  // Wrapper chrome branches on `embedded` — see the prop comment above.
  // Embedded: a plain, unstyled div in normal document flow (no fixed
  // positioning, no backdrop, nothing to click "outside" of). Widget
  // (default): a small fixed bottom-right panel — same corner/footprint
  // convention as ChatLauncher's own floating bubble, sitting just above it
  // — with a shadow instead of a full-page dark backdrop, so the rest of the
  // page stays visible/usable behind it.
  const wrapperStyle = embedded
    ? undefined
    : {position:"fixed",bottom:92,right:20,zIndex:2000,width:380,maxWidth:"calc(100vw - 40px)",height:600,maxHeight:"calc(100vh - 120px)"};
  const panelStyle = embedded
    ? {background:"white",borderRadius:20,width:"100%",height:"70vh",display:"flex",overflow:"hidden",boxShadow:"0 8px 32px rgba(0,0,0,0.14)"}
    : {background:"white",borderRadius:20,width:"100%",height:"100%",display:"flex",overflow:"hidden",boxShadow:"0 16px 48px rgba(0,0,0,0.28)"};

  return (
    <div style={wrapperStyle}>
      <div style={panelStyle}>

        {/* LEFT — Conversation List. Narrower in the floating-widget layout
            (380px total) than the embedded dashboard-tab layout (fills its
            container), so the chat pane itself still has usable room. */}
        <div style={{width:embedded?260:120,borderRight:`1px solid #f0f0f0`,display:"flex",flexDirection:"column",flexShrink:0}}>
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

          {/* New Chat Button — clears the active selection so the input
              below starts a fresh conversation on send. Also clears the
              draft and focuses the input: for a caller with no
              conversations yet the compose state is already showing, so
              without the focus jump this click looked like it did nothing. */}
          <button onClick={()=>{setActiveConvId(null);setNewMessage("");inputRef.current?.focus();}}
            style={{margin:"10px 12px 4px",background:`${C.gold}15`,color:C.deepGold,border:`1.5px dashed ${C.gold}`,borderRadius:12,padding:"9px",fontSize:"0.74rem",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            ✉️ Start New Conversation
          </button>

          {/* Conversation list */}
          <div style={{flex:1,overflowY:"auto"}}>
            {filteredConvs.length===0&&(
              <div style={{padding:"20px",textAlign:"center",color:"#aaa",fontSize:"0.76rem"}}>No conversations found</div>
            )}
            {filteredConvs.map(conv=>{
              const lastMsg = conv.messages?.[conv.messages.length-1];
              const attention = needsCustomerAttention(conv);
              return (
              <div key={conv.id} onClick={()=>setActiveConvId(conv.id)}
                style={{padding:"12px 14px",cursor:"pointer",borderBottom:"1px solid #f5f5f5",background:activeConvId===conv.id?`${C.gold}12`:"white",transition:"background 0.2s"}}
                onMouseEnter={e=>{ if(activeConvId!==conv.id) e.currentTarget.style.background="#fafafa"; }}
                onMouseLeave={e=>{ if(activeConvId!==conv.id) e.currentTarget.style.background="white"; }}>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  {/* Avatar */}
                  <div style={{position:"relative",flexShrink:0}}>
                    <div style={{width:44,height:44,borderRadius:"50%",background:`${C.gold}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.4rem",border:activeConvId===conv.id?`2px solid ${C.gold}`:"2px solid transparent"}}>
                      🎧
                    </div>
                    <div style={{position:"absolute",bottom:1,right:1,width:11,height:11,borderRadius:"50%",background:"#22c55e",border:"2px solid white"}}/>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                      <span style={{fontWeight:800,fontSize:"0.78rem",color:C.darkBrown,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>AshantiHub Support</span>
                      <span style={{fontSize:"0.6rem",color:"#aaa",flexShrink:0,marginLeft:4}}>{formatConvTime(lastMsg?.created_at||conv.updated_at)}</span>
                    </div>
                    {conv.subject&&<div style={{fontSize:"0.64rem",color:C.deepGold,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:2}}>Re: {conv.subject}</div>}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:"0.68rem",color:"#888",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{lastMsg?.body||"No messages yet"}</span>
                      {attention&&<span style={{width:10,height:10,borderRadius:"50%",background:C.kente2,flexShrink:0,marginLeft:4}}/>}
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
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

        {/* RIGHT — Chat Window. Always rendered — a signed-out visitor sees
            the same chat surface (greeted as "Guest") rather than a sign-in
            wall, per the concierge-style design ask; only the composer at the
            bottom branches on who the caller is (real input for customers/
            business owners, a sign-in button for guests, a pointer to the
            admin MessagingPanel for staff sessions, whose inbox lives there —
            /api/messaging/conversations/ 403s a StaffUser). */}
        <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
          {(
            <>
              {/* Chat Header */}
              <div style={{padding:"14px 18px",borderBottom:"1px solid #f0f0f0",display:"flex",alignItems:"center",gap:12,background:"white"}}>
                <div style={{position:"relative"}}>
                  <div style={{width:42,height:42,borderRadius:"50%",background:`${C.gold}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.3rem"}}>🎧</div>
                  <div style={{position:"absolute",bottom:1,right:1,width:10,height:10,borderRadius:"50%",background:"#22c55e",border:"2px solid white"}}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:900,fontSize:"0.88rem",color:C.darkBrown}}>AshantiHub Support</div>
                  <div style={{fontSize:"0.68rem",color:C.deepGold,fontWeight:700,marginBottom:1}}>{activeConv?.subject ? `Re: ${activeConv.subject}` : "New conversation"}</div>
                  {/* "Starts once staff replies" status (messaging fixes work) —
                      an open conversation with zero staff messages yet is
                      waiting, not "online"; a brand-new (no activeConv at all)
                      caller still sees the original "online" copy, matching
                      what this line always showed before a conversation exists. */}
                  {activeConv && !activeConv.messages.some(m=>m.sender_type==="staff") ? (
                    <div style={{fontSize:"0.65rem",color:"#f59e0b",fontWeight:600}}>🕐 Waiting for a staff reply...</div>
                  ) : (
                    <div style={{fontSize:"0.65rem",color:"#22c55e",fontWeight:600}}>● Support team online now</div>
                  )}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={onClose} style={{background:"#f0f0f0",border:"none",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",color:"#666",fontSize:"0.9rem"}}>✕</button>
                </div>
              </div>

              {/* Messages */}
              <div style={{flex:1,overflowY:"auto",padding:"16px",display:"flex",flexDirection:"column",gap:10,background:"#f8f9fa"}}>
                {activeConv&&activeConv.messages.length>0&&(
                  <div style={{textAlign:"center",margin:"4px 0"}}>
                    <span style={{background:"#e0e0e0",color:"#888",borderRadius:20,padding:"3px 12px",fontSize:"0.62rem",fontWeight:600}}>Conversation started {formatConvTime(activeConv.created_at)}</span>
                  </div>
                )}
                {/* Auto-welcome (messaging fixes work) — a purely client-side
                    bubble, not a real Message, styled exactly like an
                    incoming staff message bubble (same JSX/styling as the
                    msg.sender_type==="staff" case below). Always shown
                    whenever there's no active conversation yet; the old
                    plain "send a message below..." placeholder is trimmed
                    down underneath it now that the bubble carries the
                    greeting. */}
                {!activeConv&&(
                  <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",gap:14}}>
                    <div style={{display:"flex",justifyContent:"flex-start",alignItems:"flex-end",gap:8}}>
                      <div style={{width:28,height:28,borderRadius:"50%",background:`${C.gold}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.9rem",flexShrink:0}}>🎧</div>
                      <div style={{maxWidth:"72%"}}>
                        <div style={{background:"white",color:C.darkBrown,borderRadius:"18px 18px 18px 4px",padding:"10px 14px",fontSize:"0.78rem",lineHeight:1.5,boxShadow:"0 1px 4px rgba(0,0,0,0.1)"}}>
                          👋 Welcome to AshantiHub! Hello {user?.fullName || "Guest"}, how can I assist you today?
                        </div>
                      </div>
                    </div>
                    <div style={{textAlign:"center",color:"#aaa",fontSize:"0.7rem",lineHeight:1.6,padding:"0 24px"}}>
                      Send a message below to start a new conversation{initialBusiness?` about ${initialBusiness.name}`:""}.
                    </div>
                  </div>
                )}
                {(activeConv?.messages||[]).map(msg=>{
                  const isSelf = msg.sender_type===selfSenderType;
                  return (
                  <div key={msg.id} style={{display:"flex",justifyContent:isSelf?"flex-end":"flex-start",alignItems:"flex-end",gap:8}}>
                    {msg.sender_type==="staff"&&(
                      <div style={{width:28,height:28,borderRadius:"50%",background:`${C.gold}20`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.9rem",flexShrink:0}}>🎧</div>
                    )}
                    <div style={{maxWidth:"72%"}}>
                      <div style={{
                        background:isSelf?`linear-gradient(135deg,${C.kente3},${C.darkBrown})`:"white",
                        color:isSelf?"white":C.darkBrown,
                        borderRadius:isSelf?"18px 18px 4px 18px":"18px 18px 18px 4px",
                        padding:"10px 14px",
                        fontSize:"0.78rem",
                        lineHeight:1.5,
                        boxShadow:"0 1px 4px rgba(0,0,0,0.1)",
                      }}>
                        {msg.body}
                      </div>
                      <div style={{fontSize:"0.58rem",color:"#aaa",marginTop:3,textAlign:isSelf?"right":"left"}}>
                        {formatConvTime(msg.created_at)}
                      </div>
                    </div>
                    {isSelf&&(
                      <div style={{width:28,height:28,borderRadius:"50%",background:C.gold,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,color:C.darkBrown,fontSize:"0.7rem",flexShrink:0}}>
                        {user?.fullName?.[0]?.toUpperCase()||"U"}
                      </div>
                    )}
                  </div>
                  );
                })}
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

              {/* Composer — guests get the same real input as customers/
                  business owners and can type freely; sendMessage() is what
                  asks a guest to sign in, only at the moment they hit send
                  (user-initiated, never automatic on open). Only a staff
                  session loses the composer — its inbox is the admin
                  MessagingPanel, and posting here would 403. */}
              {user?.accountType!=="staff" ? (
              <div style={{padding:"12px 14px",borderTop:"1px solid #f0f0f0",background:"white"}}>
                {actionError&&(
                  <div style={{background:`${C.kente1}12`,border:`1px solid ${C.kente1}33`,borderRadius:10,padding:"8px 12px",marginBottom:10,fontSize:"0.72rem",color:C.kente1,fontWeight:600,textAlign:"center"}}>
                    {actionError}
                  </div>
                )}
                <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
                  {/* Emoji/Quick Reply toggle */}
                  <button onClick={()=>setShowQuickReplies(q=>!q)}
                    style={{background:showQuickReplies?`${C.gold}20`:"#f0f0f0",border:"none",borderRadius:"50%",width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"1rem",flexShrink:0}}>
                    ⚡
                  </button>
                  {/* minWidth:0 on both the pill and the input lets them
                      shrink inside the narrow 380px widget — without it the
                      input's intrinsic min-width pushes the send button out
                      of the panel entirely (worse once the ✕ appears). */}
                  <div style={{flex:1,minWidth:0,background:"#f5f5f5",borderRadius:20,padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}>
                    <input
                      ref={inputRef}
                      value={newMessage}
                      onChange={e=>setNewMessage(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(!sending)sendMessage();}}}
                      placeholder="Type a message..."
                      disabled={sending}
                      style={{flex:1,minWidth:0,border:"none",background:"transparent",outline:"none",fontSize:"0.82rem",fontFamily:"inherit",color:C.darkBrown}}/>
                    {newMessage&&(
                      <button onClick={()=>setNewMessage("")} style={{background:"none",border:"none",color:"#aaa",cursor:"pointer",fontSize:"0.9rem",padding:0}}>✕</button>
                    )}
                  </div>
                  <button
                    onClick={()=>{if(!sending)sendMessage();}}
                    disabled={!newMessage.trim()||sending}
                    style={{background:newMessage.trim()&&!sending?C.kente2:"#ddd",color:"white",border:"none",borderRadius:"50%",width:38,height:38,display:"flex",alignItems:"center",justifyContent:"center",cursor:newMessage.trim()&&!sending?"pointer":"default",fontSize:"1rem",flexShrink:0,transition:"background 0.2s"}}>
                    ➤
                  </button>
                </div>
                <div style={{fontSize:"0.6rem",color:"#aaa",marginTop:6,textAlign:"center"}}>
                  {canHoldConversation
                    ? "💡 Messages are stored on AshantiHub • Handled by AshantiHub Support, who relay to the business on your behalf"
                    : "Browsing as Guest — you'll be asked to sign in when you send"}
                </div>
              </div>
              ) : (
              <div style={{padding:"14px",borderTop:"1px solid #f0f0f0",background:"white",textAlign:"center",fontSize:"0.74rem",color:"#888",lineHeight:1.6}}>
                Staff replies to support threads live in the Messaging tab of the staff dashboard.
              </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewsModal({item,user,onClose}) {
  const [newRating,setNewRating]=useState(0);
  const [newText,setNewText]=useState("");
  const [hover,setHover]=useState(0);
  const [submitted,setSubmitted]=useState(false);
  const [actionError,setActionError]=useState(null);
  // GET /api/reviews/listing/{id}/ — real paginated review data (Phase 4),
  // replacing the old MOCK_REVIEWS[item.id] lookup. avg_rating/review_count
  // are top-level fields on this same envelope, not read off `item` anymore.
  const reviewsQuery = useListingReviews(item.id);
  // Only meaningfully fires for a signed-in user — useReviewEligibility's
  // own `enabled` guard (targetType/targetId != null) naturally short-circuits
  // it for a signed-out visitor since we pass an empty object in that case.
  const eligibility = useReviewEligibility(user ? {targetType:"listing",targetId:item.id} : {});
  const reviews = reviewsQuery.data?.results || [];
  const avgRating = reviewsQuery.data?.avg_rating ?? 0;
  const reviewCount = reviewsQuery.data?.review_count ?? 0;

  const handleSubmit = async () => {
    if(!user){alert("Please sign in to leave a review");return;}
    if(!newRating||!newText.trim())return;
    setActionError(null);
    try {
      await apiPost("/api/reviews/",{target_type:"listing",target_id:item.id,rating:newRating,comment:newText});
      setSubmitted(true);
      reviewsQuery.refetch();
      eligibility.refetch();
    } catch(err) {
      setActionError("Could not submit your review. Please try again.");
    }
  };

  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:"white",borderRadius:22,width:"100%",maxWidth:520,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
      <div style={{background:`linear-gradient(135deg,${C.darkBrown},${C.kente3})`,borderRadius:"22px 22px 0 0",padding:"20px 24px",position:"relative"}}>
        <button onClick={onClose} style={{position:"absolute",top:14,right:16,background:"none",border:"none",color:"white",fontSize:"1.4rem",cursor:"pointer",opacity:0.7}}>✕</button>
        <div style={{color:C.gold,fontWeight:900,fontSize:"1rem",marginBottom:4}}>{item.name}</div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <Stars rating={avgRating}/>
          <span style={{color:"white",fontSize:"0.78rem",opacity:0.8}}>{reviewCount} reviews</span>
        </div>
      </div>
      <div style={{padding:"20px 24px"}}>
        {/* Write Review */}
        {!submitted ? (
          <div style={{background:`${C.gold}12`,border:`1.5px solid ${C.gold}33`,borderRadius:14,padding:"16px",marginBottom:20}}>
            <div style={{fontWeight:800,color:C.darkBrown,marginBottom:10,fontSize:"0.85rem"}}>✍️ Write a Review</div>
            {!user ? (
              <div style={{fontSize:"0.7rem",color:"#aaa",textAlign:"center"}}>Sign in to leave a review</div>
            ) : eligibility.isLoading ? (
              <div style={{fontSize:"0.75rem",color:"#aaa",textAlign:"center"}}>Checking your eligibility…</div>
            ) : eligibility.data?.eligible ? (
              <>
                <div style={{display:"flex",gap:4,marginBottom:12}}>
                  {[1,2,3,4,5].map(s=>(
                    <span key={s} onClick={()=>setNewRating(s)} onMouseEnter={()=>setHover(s)} onMouseLeave={()=>setHover(0)}
                      style={{fontSize:"1.8rem",cursor:"pointer",color:(hover||newRating)>=s?C.gold:"#ddd",transition:"color 0.1s"}}>★</span>
                  ))}
                </div>
                <textarea value={newText} onChange={e=>setNewText(e.target.value)} placeholder="Share your experience..."
                  style={{...iStyle,height:80,resize:"vertical",marginBottom:10}}/>
                {actionError&&<div style={{color:"#dc2626",fontSize:"0.75rem",marginBottom:8}}>{actionError}</div>}
                <button onClick={handleSubmit} style={{...btnP(!!newRating&&newText.length>10),padding:"9px"}}>Submit Review</button>
              </>
            ) : eligibility.data?.already_reviewed ? (
              <div style={{fontSize:"0.75rem",color:"#aaa",textAlign:"center"}}>You've already reviewed this.</div>
            ) : (
              <div style={{fontSize:"0.75rem",color:"#aaa",textAlign:"center"}}>You can review this after a completed purchase.</div>
            )}
          </div>
        ) : (
          <div style={{background:"#f0fdf4",border:"1.5px solid #22c55e44",borderRadius:14,padding:"16px",marginBottom:20,textAlign:"center"}}>
            <div style={{fontSize:"2rem",marginBottom:6}}>🎉</div>
            <div style={{fontWeight:800,color:"#22c55e"}}>Review submitted! Thank you.</div>
          </div>
        )}
        {/* Existing Reviews */}
        <div style={{fontWeight:800,color:C.darkBrown,marginBottom:12,fontSize:"0.85rem"}}>Customer Reviews ({reviewCount})</div>
        {reviewsQuery.isLoading&&<div style={{color:"#aaa",fontSize:"0.8rem",textAlign:"center",padding:"20px"}}>Loading reviews…</div>}
        {!reviewsQuery.isLoading&&reviews.length===0&&<div style={{color:"#aaa",fontSize:"0.8rem",textAlign:"center",padding:"20px"}}>No reviews yet. Be the first!</div>}
        {reviews.map(r=>(
          <div key={r.id} style={{borderBottom:"1px solid #f0f0f0",paddingBottom:14,marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:30,height:30,borderRadius:"50%",background:`${C.gold}22`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,color:C.deepGold,fontSize:"0.8rem"}}>{r.author_name?.[0]}</div>
                <div>
                  <div style={{fontWeight:700,fontSize:"0.8rem"}}>{r.author_name}</div>
                  <Stars rating={r.rating} size="0.7rem"/>
                </div>
              </div>
              <div style={{fontSize:"0.65rem",color:"#aaa",display:"flex",alignItems:"center",gap:5}}>
                {r.created_at?.slice(0,10)}
                {r.verified&&<span style={{background:"#22c55e22",color:"#22c55e",borderRadius:20,padding:"2px 7px",fontSize:"0.58rem",fontWeight:700}}>✓ Verified Purchase</span>}
              </div>
            </div>
            <div style={{fontSize:"0.78rem",color:"#444",lineHeight:1.6}}>{r.comment}</div>
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
    {showReviews&&<ReviewsModal item={item} user={user} onClose={()=>setShowReviews(false)}/>}
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
        {/* Listing's public serializer now returns avg_rating/review_count directly
            (Phase 4 of the reviews/ratings work) — a listing with zero reviews shows
            no stars at all rather than "0.0 ★ (0 reviews)". */}
        {item.review_count>0&&(
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
            <Stars rating={item.avg_rating}/>
            <button onClick={()=>setShowReviews(true)} style={{background:"none",border:"none",color:accentColor,fontSize:"0.68rem",cursor:"pointer",fontWeight:600,padding:0}}>
              ({item.review_count} reviews)
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
  // "Forgot password?" (staff onboarding + account-recovery work) — a third
  // inline `mode`, reachable from the login form regardless of
  // lockedAccountType (a staff member locked into "staff-login" needs
  // password recovery too), rather than a separate route/component — the
  // request step only needs an email + account-type, no URL state, so it
  // fits this modal's existing mode-toggle convention. The confirm step
  // (token from a real emailed link) is the separate /reset-password route
  // (ResetPasswordPage, below) since that step needs URL query params.
  const [resetAccountType,setResetAccountType]=useState(lockedAccountType || "customer");
  const [resetEmail,setResetEmail]=useState("");
  const [resetSubmitting,setResetSubmitting]=useState(false);
  const [resetSubmitted,setResetSubmitted]=useState(false);

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

  // Always resolves to the same generic "check your email" state regardless
  // of success/failure — the backend itself never reveals whether the email
  // matched an account (see docs plan), so there is nothing more specific to
  // show here even on a genuine network error.
  const handleForgotPassword=async(e)=>{
    e.preventDefault();
    setResetSubmitting(true);
    try {
      await auth.requestPasswordReset(lockedAccountType||resetAccountType,resetEmail);
    } catch (err) {
      // Intentionally swallowed — see comment above.
    } finally {
      setResetSubmitting(false);
      setResetSubmitted(true);
    }
  };

  const handleSignup=async(e)=>{
    e.preventDefault();
    setError(null);
    if(!phone && !email){
      setError("Please provide a phone number or email address.");
      return;
    }
    setSubmitting(true);
    try {
      const result=accountType==="business_owner"
        ? await auth.registerBusinessOwner({full_name:fullName,login_phone:phone||undefined,email:email||undefined,password})
        : await auth.registerCustomer({full_name:fullName,phone:phone||undefined,email:email||undefined,password});
      onSuccess(result);
    } catch (err) {
      setError("Could not create your account. Please check your details.");
    } finally {
      setSubmitting(false);
    }
  };

  return <div data-testid="auth-modal-backdrop" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div style={{background:"white",borderRadius:22,width:"100%",maxWidth:440,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
      <div style={{background:`linear-gradient(135deg,${C.kente1},${C.kente3})`,borderRadius:"22px 22px 0 0",padding:"20px 24px",position:"relative"}}>
        <button onClick={onClose} style={{position:"absolute",top:14,right:16,background:"none",border:"none",color:"white",fontSize:"1.4rem",cursor:"pointer",opacity:0.7}}>✕</button>
        <div style={{color:C.gold,fontWeight:900,fontSize:"1.1rem"}}>{mode==="forgot"?"Reset your password":lockedAccountType==="staff"?"Staff Sign In":mode==="login"?"Welcome back":"Create your account"}</div>
      </div>
      <div style={{padding:"20px 24px"}}>
        {!lockedAccountType && mode!=="forgot" && <div style={{display:"flex",gap:8,marginBottom:16}}>
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
          <div style={{textAlign:"center",marginTop:10}}>
            <button type="button" onClick={()=>{setMode("forgot");setError(null);setResetSubmitted(false);}} style={{background:"none",border:"none",color:C.deepGold,fontSize:"0.74rem",fontWeight:700,cursor:"pointer",textDecoration:"underline",fontFamily:"inherit"}}>Forgot password?</button>
          </div>
        </form>}

        {mode==="forgot" && <div>
          <button type="button" onClick={()=>{setMode("login");setResetSubmitted(false);}} style={{background:"none",border:"none",color:C.deepGold,fontSize:"0.74rem",fontWeight:700,cursor:"pointer",marginBottom:14,padding:0,fontFamily:"inherit"}}>← Back to Sign In</button>
          {resetSubmitted ? (
            <div style={{background:"#eafaf0",color:"#1b7a43",borderRadius:10,padding:"12px 14px",fontSize:"0.8rem",lineHeight:1.6}}>
              If an account exists for that email, we've sent a password reset link. Please check your inbox (and spam folder).
            </div>
          ) : (
            <form onSubmit={handleForgotPassword}>
              <div style={{fontSize:"0.76rem",color:"#666",marginBottom:12,lineHeight:1.5}}>Enter your account email and we'll send you a link to reset your password.</div>
              {!lockedAccountType && <div style={{display:"flex",gap:6,marginBottom:12}}>
                <button type="button" onClick={()=>setResetAccountType("customer")} style={{flex:1,padding:"6px",borderRadius:20,border:`1.5px solid ${C.gold}`,cursor:"pointer",fontWeight:700,fontSize:"0.68rem",background:resetAccountType==="customer"?C.gold:"white"}}>Customer</button>
                <button type="button" onClick={()=>setResetAccountType("business_owner")} style={{flex:1,padding:"6px",borderRadius:20,border:`1.5px solid ${C.gold}`,cursor:"pointer",fontWeight:700,fontSize:"0.68rem",background:resetAccountType==="business_owner"?C.gold:"white"}}>Business Owner</button>
                <button type="button" onClick={()=>setResetAccountType("staff")} style={{flex:1,padding:"6px",borderRadius:20,border:`1.5px solid ${C.gold}`,cursor:"pointer",fontWeight:700,fontSize:"0.68rem",background:resetAccountType==="staff"?C.gold:"white"}}>Staff</button>
              </div>}
              <input value={resetEmail} onChange={e=>setResetEmail(e.target.value)} type="email" placeholder="Email" required style={authInputStyle}/>
              <button type="submit" disabled={resetSubmitting} style={authSubmitStyle}>{resetSubmitting?"Sending…":"Send Reset Link"}</button>
            </form>
          )}
        </div>}

        {mode==="signup" && <form onSubmit={handleSignup}>
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <button type="button" onClick={()=>setAccountType("customer")} style={{flex:1,padding:"6px",borderRadius:20,border:`1.5px solid ${C.gold}`,cursor:"pointer",fontWeight:700,fontSize:"0.72rem",background:accountType==="customer"?C.gold:"white"}}>Customer</button>
            <button type="button" onClick={()=>setAccountType("business_owner")} style={{flex:1,padding:"6px",borderRadius:20,border:`1.5px solid ${C.gold}`,cursor:"pointer",fontWeight:700,fontSize:"0.72rem",background:accountType==="business_owner"?C.gold:"white"}}>Business Owner</button>
          </div>
          <input value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Full name" required style={authInputStyle}/>
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Phone (+233...)" style={authInputStyle}/>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email" placeholder="Email" style={authInputStyle}/>
          <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password (min 8 characters)" required minLength={8} style={authInputStyle}/>
          <button type="submit" disabled={submitting} style={authSubmitStyle}>{submitting?"Creating account…":accountType==="business_owner"?"Create Business Account":"Create Free Account"}</button>
        </form>}
      </div>
    </div>
  </div>;
}

// ─── Staff Activation Page (/staff/activate) ─────────────────────────────────
// Consumes the invite-email link (docs plan Workstream B) — reads ?token=
// from the URL, lets the invited staffer set their password, then reuses
// exactly the same onSuccess() mechanism AuthModal's login/signup already
// hand off to AshantiHub (flips isAdmin true + navigates to /staff for a
// staff result) rather than inventing a second post-auth wiring path.
function StaffActivatePage({auth,onSuccess}) {
  const location=useLocation();
  const token=new URLSearchParams(location.search).get("token")||"";
  const [password,setPassword]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [error,setError]=useState(null);
  const [submitting,setSubmitting]=useState(false);

  const handleSubmit=async(e)=>{
    e.preventDefault();
    setError(null);
    if(!token){setError("This activation link is missing its token. Please use the link from your invite email.");return;}
    if(password.length<8){setError("Password must be at least 8 characters.");return;}
    if(password!==confirmPassword){setError("Passwords do not match.");return;}
    setSubmitting(true);
    try {
      const result=await auth.activateStaff(token,password);
      onSuccess(result);
    } catch (err) {
      setError("This activation link is invalid or has expired. Please ask an admin to resend your invite.");
    } finally {
      setSubmitting(false);
    }
  };

  return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:`linear-gradient(135deg,${C.kente1},${C.kente3})`,padding:16}}>
    <div style={{background:"white",borderRadius:22,width:"100%",maxWidth:440,boxShadow:"0 20px 60px rgba(0,0,0,0.3)",overflow:"hidden"}}>
      <div style={{background:`linear-gradient(135deg,${C.kente1},${C.kente3})`,padding:"20px 24px"}}>
        <div style={{color:C.gold,fontWeight:900,fontSize:"1.1rem"}}>Activate Your Staff Account</div>
      </div>
      <div style={{padding:"20px 24px"}}>
        {error && <div style={{background:"#fdecea",color:"#b00020",borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:"0.78rem"}}>{error}</div>}
        {!token && !error && <div style={{background:"#fdecea",color:"#b00020",borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:"0.78rem"}}>No activation token found in this link. Please use the exact link from your invite email.</div>}
        <form onSubmit={handleSubmit}>
          <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="Password (min 8 characters)" required minLength={8} style={authInputStyle}/>
          <input value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} type="password" placeholder="Confirm password" required minLength={8} style={authInputStyle}/>
          <button type="submit" disabled={submitting} style={authSubmitStyle}>{submitting?"Activating…":"Activate Account"}</button>
        </form>
      </div>
    </div>
  </div>;
}

// ─── Password Reset Confirm Page (/reset-password) ───────────────────────────
// The confirm half of the reset flow — AuthModal's "Forgot password?" (see
// above) handles the request step inline since it only needs an email/
// account-type and no URL state; this page is the destination of the emailed
// reset link, which does carry URL state (?token=&type=), so it needs its
// own route. On success it hands control back to the normal sign-in flow —
// navigate home and open AuthModal in login mode — rather than logging the
// user in directly, since a password reset on its own carries no session
// token to store.
function ResetPasswordPage({auth,setPage,setAuthModal}) {
  const location=useLocation();
  const params=new URLSearchParams(location.search);
  const token=params.get("token")||"";
  const accountType=params.get("type")||"customer";
  const [password,setPassword]=useState("");
  const [confirmPassword,setConfirmPassword]=useState("");
  const [error,setError]=useState(null);
  const [submitting,setSubmitting]=useState(false);
  const [success,setSuccess]=useState(false);

  const handleSubmit=async(e)=>{
    e.preventDefault();
    setError(null);
    if(!token){setError("This reset link is missing its token. Please request a new one.");return;}
    if(password.length<8){setError("Password must be at least 8 characters.");return;}
    if(password!==confirmPassword){setError("Passwords do not match.");return;}
    setSubmitting(true);
    try {
      await auth.confirmPasswordReset(accountType,token,password);
      setSuccess(true);
    } catch (err) {
      setError("This reset link is invalid or has expired. Please request a new one.");
    } finally {
      setSubmitting(false);
    }
  };

  return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:`linear-gradient(135deg,${C.kente1},${C.kente3})`,padding:16}}>
    <div style={{background:"white",borderRadius:22,width:"100%",maxWidth:440,boxShadow:"0 20px 60px rgba(0,0,0,0.3)",overflow:"hidden"}}>
      <div style={{background:`linear-gradient(135deg,${C.kente1},${C.kente3})`,padding:"20px 24px"}}>
        <div style={{color:C.gold,fontWeight:900,fontSize:"1.1rem"}}>Reset Your Password</div>
      </div>
      <div style={{padding:"20px 24px"}}>
        {success ? (
          <>
            <div style={{background:"#eafaf0",color:"#1b7a43",borderRadius:10,padding:"12px 14px",marginBottom:16,fontSize:"0.8rem",lineHeight:1.6}}>Your password has been reset. You can now sign in with your new password.</div>
            <button onClick={()=>{setAuthModal("login");setPage("home");}} style={authSubmitStyle}>Sign In</button>
          </>
        ) : (
          <>
            {error && <div style={{background:"#fdecea",color:"#b00020",borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:"0.78rem"}}>{error}</div>}
            {!token && !error && <div style={{background:"#fdecea",color:"#b00020",borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:"0.78rem"}}>No reset token found in this link. Please request a new one from the sign-in screen.</div>}
            <form onSubmit={handleSubmit}>
              <input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="New password (min 8 characters)" required minLength={8} style={authInputStyle}/>
              <input value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} type="password" placeholder="Confirm new password" required minLength={8} style={authInputStyle}/>
              <button type="submit" disabled={submitting} style={authSubmitStyle}>{submitting?"Resetting…":"Reset Password"}</button>
            </form>
          </>
        )}
      </div>
    </div>
  </div>;
}

// ─── Payment Return Page (/payment/return) ───────────────────────────────────
// Hubtel integration (docs/HUBTEL_INTEGRATION.md, plan Workstream E) — where
// a customer/business owner lands back after Hubtel's hosted checkout
// (MoMoPayment's redirect, and every onSuccess handler's own added
// `mode==="redirect"` branch, both point here via `?reference=`). The
// redirect itself is never trusted as proof of payment — this page polls
// GET /api/payments/checkout-sessions/{reference}/ (the only source of
// truth, resolved by payments.views.HubtelWebhookView) rather than reading
// anything off the URL/query string as a success signal. Functional-but-
// not-fully-polished per the launch plan: this path is entirely unexercised
// until real Hubtel credentials exist (payments_provider stays "simulated"
// until then), so nothing has ever actually redirected here in practice.
const PAYMENT_RETURN_POLL_INTERVAL_MS = 2000;
const PAYMENT_RETURN_TIMEOUT_MS = 60000;

function PaymentReturnPage({setPage}) {
  const location = useLocation();
  const reference = new URLSearchParams(location.search).get("reference") || "";
  const [session,setSession] = useState(null);
  const [error,setError] = useState(null);
  const [timedOut,setTimedOut] = useState(false);

  useEffect(() => {
    if (!reference) { setError("No payment reference found in this link."); return; }

    let cancelled = false;
    const startedAt = Date.now();

    const poll = async () => {
      if (cancelled) return;
      try {
        const data = await apiFetch(`/api/payments/checkout-sessions/${reference}/`);
        if (cancelled) return;
        setSession(data);
        if (data.status !== "pending") return; // stop polling — resolved
        if (Date.now() - startedAt >= PAYMENT_RETURN_TIMEOUT_MS) { setTimedOut(true); return; }
        setTimeout(poll, PAYMENT_RETURN_POLL_INTERVAL_MS);
      } catch (err) {
        if (!cancelled) setError("Could not check this payment's status. Please check your account for the latest status.");
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [reference]);

  const status = session?.status;
  const isDone = status && status !== "pending";

  return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:`linear-gradient(135deg,${C.kente1},${C.kente3})`,padding:16}}>
    <div style={{background:"white",borderRadius:22,width:"100%",maxWidth:440,boxShadow:"0 20px 60px rgba(0,0,0,0.3)",overflow:"hidden",textAlign:"center"}}>
      <div style={{background:`linear-gradient(135deg,${C.kente1},${C.kente3})`,padding:"20px 24px"}}>
        <div style={{color:C.gold,fontWeight:900,fontSize:"1.1rem"}}>Payment Status</div>
      </div>
      <div style={{padding:"28px 24px"}}>
        {error ? (
          <div style={{background:"#fdecea",color:"#b00020",borderRadius:10,padding:"12px 14px",fontSize:"0.8rem",lineHeight:1.6}}>{error}</div>
        ) : !session ? (
          <div style={{color:"#555",fontSize:"0.82rem"}}>Confirming your payment…</div>
        ) : status === "success" ? (
          <>
            <div style={{fontSize:"3rem",marginBottom:10}}>✅</div>
            <div style={{fontWeight:900,color:"#22c55e",fontSize:"1rem",marginBottom:8}}>Payment Successful!</div>
            <div style={{color:"#555",fontSize:"0.8rem",lineHeight:1.6}}>Your payment of GHS {session.amount} for "{session.purpose}" has been confirmed.</div>
          </>
        ) : status === "failed" ? (
          <>
            <div style={{fontSize:"3rem",marginBottom:10}}>❌</div>
            <div style={{fontWeight:900,color:"#dc2626",fontSize:"1rem",marginBottom:8}}>Payment Failed</div>
            <div style={{color:"#555",fontSize:"0.8rem",lineHeight:1.6}}>Your payment could not be completed. Please try again.</div>
          </>
        ) : status === "expired" ? (
          <>
            <div style={{fontSize:"3rem",marginBottom:10}}>⏰</div>
            <div style={{fontWeight:900,color:"#d97706",fontSize:"1rem",marginBottom:8}}>Payment Expired</div>
            <div style={{color:"#555",fontSize:"0.8rem",lineHeight:1.6}}>This checkout session expired before payment was completed. Please try again.</div>
          </>
        ) : timedOut ? (
          <div style={{color:"#555",fontSize:"0.82rem",lineHeight:1.6}}>Still confirming your payment — this is taking longer than expected. Check "My Account" shortly for the latest status.</div>
        ) : (
          <div style={{color:"#555",fontSize:"0.82rem"}}>Confirming your payment…</div>
        )}
        {(isDone || error || timedOut) && (
          <button onClick={()=>setPage("home")} style={{...authSubmitStyle,marginTop:16}}>Back to AshantiHub</button>
        )}
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

// The staff dashboard is the Admin Command Center (frontend/components/
// admin/*), the light "artisan" restyle of the old inline-in-App.jsx
// StaffDashboard — matching the Business Command Center's visual system
// (frontend/components/dashboard/*) while keeping every panel's behavior/
// text unchanged (see frontend/StaffDashboard.test.jsx, the behavioral
// contract). This thin wrapper keeps the historical `StaffDashboard` export/
// signature (used by StaffDashboard.test.jsx and the `/staff` route below)
// while delegating to the new shell — same convention as `BusinessDashboard`
// delegating to `BusinessCommandCenter` just below.
export function StaffDashboard({auth,onExit}) {
  return <AdminCommandCenter auth={auth} onExit={onExit} />;
}

// The business-owner dashboard is the unified light "artisan" Business
// Command Center (frontend/components/dashboard/*), which replaced the three
// former inline-styled dashboards (BusinessDashboard / PaymentDashboard /
// CreditDashboard) — folding Payments and Credit in as tabs and adding the
// Analytics and Deliveries tabs. This thin wrapper keeps the historical
// `BusinessDashboard` export/signature (used by BusinessDashboard.test.jsx)
// while delegating to the new shell and injecting the simulated-pay modal.
export function BusinessDashboard({ onExit, user, auth }) {
  return <BusinessCommandCenter initialTab="analytics" onExit={onExit} user={user} auth={auth} PaymentComponent={MoMoPayment} />;
}

// ─── Account Center (customer "My Account" dashboard) ─────────────────────────
// Redesigned to match the business-owner side's Business Command Center
// (frontend/components/dashboard/*) — the same always-light "artisan"
// shell language, reusing its `D` palette, `glassCard`, and the shared
// KpiCard/ChartFrame/SpendAreaChart/ListingsDonut chart primitives directly
// rather than duplicating them, plus a `.command-center.account-grid` square-
// grid background variant (frontend/index.css) BusinessCommandCenter itself
// doesn't opt into. Routed at /my-account (see showAccount/setShowAccount
// above), a top-level early return like StaffDashboard/BusinessCommandCenter.
// Still defined here (not frontend/components/) because it reuses
// MessagingCenter/MOCK_CONVERSATIONS/FavDrawerItem/NotificationsPanel, all
// module-top-level in this file — App.jsx importing components/dashboard/* is
// the established one-directional convention (already done for
// BusinessCommandCenter/EventSubmissionPanel above); components/ itself never
// imports back into App.jsx. Always-light — no light/dark toggle of its own,
// matching BusinessCommandCenter's own "one consistent dashboard visual
// language" choice; this also resolves MyEventsTab's old "known limitation"
// note below, since EventSubmissionPanel was already hardcoded always-dark.
const ACCOUNT_NAV_ITEMS = [
  { id: "overview", icon: "📊", label: "Overview", group: "main" },
  { id: "orders", icon: "📦", label: "Orders & Delivery", group: "main" },
  { id: "saved", icon: "❤️", label: "Saved Businesses", group: "main" },
  { id: "messages", icon: "💬", label: "Messages", group: "main" },
  { id: "events", icon: "🎉", label: "My Events", group: "main" },
  { id: "tickets", icon: "🎟️", label: "My Tickets", group: "main" },
  { id: "profile", icon: "👤", label: "Profile", group: "system" },
  { id: "settings", icon: "⚙️", label: "Settings", group: "system" },
];
const ACCOUNT_NAV_GROUPS = [
  { id: "main", label: "Main" },
  { id: "system", label: "System" },
];

// Orders (order id / item name) and Tickets (event name / ticket code) are the
// only two tabs whose already-loaded data is cheaply client-side filterable —
// the topbar search box only renders for these rather than sitting inert
// (non-functional) on every other tab.
const ACCOUNT_SEARCHABLE_TABS = new Set(["orders", "tickets"]);

const accountMenuItemStyle = { display: "block", width: "100%", textAlign: "left", background: "none", border: "none", color: D.textDim, padding: "8px 10px", borderRadius: 8, fontSize: "0.76rem", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };

export function UserPanel({ user, auth, favourites, toggleFav, onExit, lang, setLang }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const { data: categories } = useCategories();
  const { data: zones } = useZones();

  const goTab = (id) => { setActiveTab(id); setSearchQuery(""); setSidebarOpen(false); };
  const activeItem = ACCOUNT_NAV_ITEMS.find(i=>i.id===activeTab);
  const signOut = () => { auth.logout(); onExit(); };

  // /my-account is a real URL anyone can hit directly, and AshantiHub's own
  // `showAccount` early return sits above its isLoading check — so without
  // these two gates this page mounted for a signed-out visitor (and during
  // session restore), whose tab panels immediately fired customer-scoped
  // queries (GET /api/orders/, GET /api/events/tickets/mine/ — both
  // [IsAuthenticated, IsCustomer]) and spammed 401s, x4 each on React
  // Query's default retries. Same gate BusinessCommandCenter already grew
  // for the identical bug on /business-dashboard; customer-only because
  // that's who this page is for (Navbar sends a business owner to
  // BusinessCommandCenter instead) and who those endpoints admit.
  // Placed below this component's own hooks so the rules of hooks still
  // hold; the queries live in the tab panels below, which never mount.
  const isCustomer = user?.accountType === "customer";
  if (auth.isLoading) {
    return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:D.pageBg,color:D.textDim}}>Loading…</div>;
  }
  if (!isCustomer) {
    return (
      <div style={{minHeight:"100vh",background:D.pageBg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,padding:20,textAlign:"center"}}>
        <div style={{fontSize:"1.15rem",fontWeight:700,color:D.text}}>Sign in with a customer account to view this page.</div>
        <button onClick={onExit} style={{padding:"10px 24px",borderRadius:8,border:"none",background:D.gold,color:"#1a1205",fontWeight:700,cursor:"pointer",fontSize:"0.85rem"}}>← Back to AshantiHub</button>
      </div>
    );
  }

  return <div className="shadcn-scope command-center account-grid" style={{minHeight:"100vh",display:"flex"}}>
    <div className="ah-account-backdrop" onClick={()=>setSidebarOpen(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:190,display:sidebarOpen?"block":"none"}}/>

    <div className={`ah-account-sidebar${sidebarOpen?" ah-account-sidebar-open":""}`} style={{background:D.panelSolid,borderRight:`1px solid ${D.cardBorder}`,display:"flex",flexDirection:"column"}}>
      <div style={{padding:"18px 16px",display:"flex",alignItems:"center",gap:10,borderBottom:`1px solid ${D.divider}`}}>
        <Flag w={30} h={20}/>
        <div>
          <div style={{color:D.gold,fontWeight:900,fontSize:"0.88rem",lineHeight:1}}>AshantiHub</div>
          <div style={{color:D.textFaint,fontSize:"0.6rem",letterSpacing:"0.06em",textTransform:"uppercase"}}>My Account</div>
        </div>
      </div>

      <nav style={{flex:1,overflowY:"auto",padding:"14px 10px"}}>
        {ACCOUNT_NAV_GROUPS.map(group=>(
          <div key={group.id} style={{marginBottom:14}}>
            <div style={{padding:"0 8px 6px",fontSize:"0.62rem",fontWeight:800,letterSpacing:"0.08em",textTransform:"uppercase",color:D.textFaint}}>{group.label}</div>
            {ACCOUNT_NAV_ITEMS.filter(i=>i.group===group.id).map(item=>{
              const active = activeTab===item.id;
              return (
                <button key={item.id} onClick={()=>goTab(item.id)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:active?D.goldSoft:"none",border:"none",borderLeft:active?`3px solid ${D.gold}`:"3px solid transparent",borderRadius:"0 10px 10px 0",color:active?D.gold:D.textDim,padding:"9px 10px",fontSize:"0.78rem",fontWeight:active?800:600,cursor:"pointer",textAlign:"left",fontFamily:"inherit",marginBottom:2}}>
                  <span>{item.icon}</span><span>{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <button onClick={()=>goTab("profile")} style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderTop:`1px solid ${D.divider}`,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",width:"100%",textAlign:"left"}}>
        <div style={{width:36,height:36,borderRadius:"50%",overflow:"hidden",background:D.gold,color:"#1a1205",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:"0.9rem",flexShrink:0}}>
          {user?.avatar ? <img src={user.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : (user?.fullName?.[0]?.toUpperCase()||"U")}
        </div>
        <div style={{minWidth:0,flex:1}}>
          <div style={{color:D.text,fontWeight:700,fontSize:"0.78rem",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{user?.fullName||"Customer"}</div>
          <div style={{color:D.textFaint,fontSize:"0.64rem"}}>Customer Account</div>
        </div>
      </button>
    </div>

    <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column"}}>
      <div style={{background:"rgba(253,246,227,0.9)",backdropFilter:"blur(8px)",borderBottom:`1px solid ${D.divider}`,padding:"0 16px",display:"flex",alignItems:"center",gap:12,height:64,position:"sticky",top:0,zIndex:80}}>
        <button className="ah-account-hamburger" onClick={()=>setSidebarOpen(true)} style={{display:"none",background:"none",border:`1px solid ${D.divider}`,borderRadius:8,color:D.text,width:34,height:34,cursor:"pointer",fontSize:"1rem",flexShrink:0}}>☰</button>

        {/* Label only (no icon) — MessagingCenter renders its own "💬 Messages"
            header when that tab is active, so icon+label here would duplicate
            it verbatim on screen. */}
        <div style={{color:D.text,fontWeight:800,fontSize:"0.92rem",whiteSpace:"nowrap"}}>{activeItem?.label}</div>

        {ACCOUNT_SEARCHABLE_TABS.has(activeTab) && (
          <input
            value={searchQuery}
            onChange={e=>setSearchQuery(e.target.value)}
            placeholder={activeTab==="orders" ? "Search orders…" : "Search tickets…"}
            style={{flex:1,maxWidth:320,marginLeft:8,background:D.panelBg2,border:`1px solid ${D.divider}`,borderRadius:10,padding:"7px 12px",fontSize:"0.76rem",color:D.text,fontFamily:"inherit"}}
          />
        )}

        <div style={{flex:1}}/>

        <div style={{position:"relative"}}>
          <button onClick={()=>setShowNotifs(v=>!v)} title="Notifications" style={{background:"none",border:`1px solid ${D.divider}`,borderRadius:10,width:34,height:34,cursor:"pointer",fontSize:"0.9rem",color:D.text}}>🔔</button>
          {showNotifs && <NotificationsPanel user={user} onClose={()=>setShowNotifs(false)}/>}
        </div>

        <div style={{position:"relative"}}>
          <button onClick={()=>setShowProfileMenu(v=>!v)} style={{display:"flex",alignItems:"center",gap:6,background:"none",border:`1px solid ${D.divider}`,borderRadius:20,padding:"4px 10px 4px 4px",cursor:"pointer"}}>
            <div style={{width:26,height:26,borderRadius:"50%",overflow:"hidden",background:D.gold,color:"#1a1205",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:"0.72rem"}}>
              {user?.avatar ? <img src={user.avatar} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/> : (user?.fullName?.[0]?.toUpperCase()||"U")}
            </div>
            <span style={{color:D.text,fontSize:"0.7rem"}}>▾</span>
          </button>
          {showProfileMenu && (
            <div onClick={()=>setShowProfileMenu(false)} style={{position:"fixed",inset:0,zIndex:98}}>
              <div onClick={e=>e.stopPropagation()} style={{position:"absolute",top:44,right:0,width:180,...glassCard,padding:6,zIndex:99}}>
                <button onClick={()=>{goTab("profile");setShowProfileMenu(false);}} style={accountMenuItemStyle}>👤 Profile</button>
                <button onClick={()=>{goTab("settings");setShowProfileMenu(false);}} style={accountMenuItemStyle}>⚙️ Settings</button>
                <div style={{height:1,background:D.divider,margin:"4px 6px"}}/>
                <button onClick={signOut} style={{...accountMenuItemStyle,color:D.red}}>🚪 Sign Out</button>
              </div>
            </div>
          )}
        </div>

        <button onClick={onExit} style={{background:"none",border:`1px solid ${D.divider}`,color:D.textDim,borderRadius:20,padding:"6px 14px",fontSize:"0.7rem",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>← Exit</button>
      </div>

      <div style={{padding:"22px 20px 60px",flex:1}}>
        {activeTab==="overview"&&<OverviewPanel favourites={favourites} user={user}/>}
        {activeTab==="orders"&&<OrdersDeliveryTab searchQuery={searchQuery}/>}
        {activeTab==="saved"&&<SavedBusinessesTab favourites={favourites} toggleFav={toggleFav}/>}
        {activeTab==="messages"&&<MessagingCenter user={user} onClose={()=>goTab("profile")} embedded/>}
        {activeTab==="events"&&<MyEventsTab user={user} categories={categories} zones={zones}/>}
        {activeTab==="tickets"&&<TicketsTab searchQuery={searchQuery}/>}
        {activeTab==="profile"&&<AccountProfileCard user={user} auth={auth}/>}
        {activeTab==="settings"&&<SettingsTab user={user} auth={auth} lang={lang} setLang={setLang} onSignOut={signOut}/>}
      </div>
    </div>

    <style>{`
      .ah-account-sidebar{ width:260px; height:100vh; position:sticky; top:0; flex-shrink:0; transition:transform .25s ease-out; }
      @media (max-width:760px){
        .ah-account-sidebar{ position:fixed; top:0; left:0; bottom:0; width:82vw; max-width:280px; z-index:200; transform:translateX(-100%); }
        .ah-account-sidebar.ah-account-sidebar-open{ transform:translateX(0); }
        .ah-account-hamburger{ display:inline-flex !important; }
      }
      @media (min-width:761px){
        .ah-account-backdrop{ display:none !important; }
        .ah-account-hamburger{ display:none; }
      }
    `}</style>
  </div>;
}

const ACCOUNT_MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const ORDER_STATUS_META = {
  pending: { label: "Pending", color: D.amber },
  paid: { label: "Paid", color: D.green },
  cancelled: { label: "Cancelled", color: D.red },
};

// Bucket the customer's paid orders into a 6-month spend series — same shape
// AnalyticsPanel.jsx's own buildSpendSeries produces for the business-owner
// side (bucketed by month, last 6 months), redefined locally since the two
// source different data (this customer's orders vs an owner's AshantiHub
// payment transactions) and this is this file's only caller.
function buildOrderSpendSeries(orders, now) {
  const buckets = [];
  const index = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const row = { key, month: ACCOUNT_MONTH_LABELS[d.getMonth()], amount: 0 };
    buckets.push(row);
    index[key] = row;
  }
  for (const o of orders || []) {
    if (o.status !== "paid" || !o.placed_at) continue;
    const key = String(o.placed_at).slice(0, 7);
    if (index[key]) index[key].amount += Number(o.total_amount) || 0;
  }
  return buckets;
}

// The Account panel's default landing tab — KPI row + charts, mirroring
// AnalyticsPanel.jsx's own shape/welcome-strip convention but sourced from
// real customer data (orders, tickets, saved businesses) instead of a
// business owner's listings/subscription/credit data. Reuses the dashboard's
// shared KpiCard/ChartFrame/SpendAreaChart/ListingsDonut chart primitives
// directly rather than forking parallel copies.
function OverviewPanel({ user, favourites }) {
  const now = new Date();
  const { data: ordersData } = useOrders();
  const { data: ticketsData } = useMyTickets();
  const orders = ordersData || [];
  const tickets = ticketsData || [];
  const paidOrders = orders.filter(o=>o.status==="paid");
  const totalSpent = paidOrders.reduce((s,o)=>s+(Number(o.total_amount)||0),0);
  const activeTickets = tickets.filter(t=>!t.refunded_at);

  const spendSeries = buildOrderSpendSeries(orders, now);
  const statusCounts = orders.reduce((acc,o)=>{acc[o.status]=(acc[o.status]||0)+1;return acc;},{});
  const donutData = Object.entries(ORDER_STATUS_META).map(([key,meta])=>({name:meta.label,value:statusCounts[key]||0,color:meta.color}));

  const kpis = [
    { icon:"📦", label:"Total Orders", value: orders.length, accent: D.gold, sub: `${paidOrders.length} paid` },
    { icon:"💰", label:"Total Spent", value: ghs(totalSpent), accent: D.green, sub: "last 6 months" },
    { icon:"❤️", label:"Saved Businesses", value: favourites.length, accent: D.red, sub: favourites.length===1?"business saved":"businesses saved" },
    { icon:"🎟️", label:"My Tickets", value: activeTickets.length, accent: D.blue, sub: `${tickets.length} total` },
  ];

  const firstName = user?.fullName?.split(" ")[0] || "there";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{...glassCard,padding:"18px 20px",background:"linear-gradient(135deg, rgba(23,31,51,0.92), rgba(30,24,55,0.85))"}}>
        <div style={{color:D.gold,fontWeight:900,fontSize:"1.12rem",marginBottom:3}}>Akwaaba, {firstName}! 👋</div>
        <div style={{fontSize:"0.74rem",color:D.textDim}}>Here's what's happening with your AshantiHub account.</div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(178px,1fr))",gap:12}}>
        {kpis.map(k=><KpiCard key={k.label} {...k}/>)}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:14}}>
        <ChartFrame title="Your spend over time" icon="💸">
          <SpendAreaChart data={spendSeries}/>
        </ChartFrame>
        <ChartFrame title="Orders by status" icon="📦">
          <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
            <ListingsDonut data={donutData} centerLabel="Orders" emptyMessage="You haven't placed any orders yet."/>
            <div style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",justifyContent:"center",marginTop:8}}>
              {donutData.filter(d=>d.value>0).map(d=>(
                <span key={d.name} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:"0.64rem",color:D.textDim}}>
                  <span style={{width:8,height:8,borderRadius:2,background:d.color}}/>{d.name} ({d.value})
                </span>
              ))}
            </div>
          </div>
        </ChartFrame>
      </div>
    </div>
  );
}

// The Profile tab's body is AccountProfileCard (frontend/components/ui/
// account-profile-card.tsx), a shadcn/Tailwind card — see that file for why
// it replaced this inline D-palette form.

const DELIVERY_STEPS = [
  { id: "processing", label: "Processing" },
  { id: "shipped", label: "Shipped" },
  { id: "out_for_delivery", label: "Out for Delivery" },
  { id: "delivered", label: "Delivered" },
];

function DeliveryStepper({ status }) {
  const activeIndex = DELIVERY_STEPS.findIndex(s=>s.id===status);
  return <div style={{display:"flex",alignItems:"flex-start",marginTop:12}}>
    {DELIVERY_STEPS.map((step,i)=>(
      <div key={step.id} style={{display:"flex",alignItems:"center",flex:i<DELIVERY_STEPS.length-1?1:"none"}}>
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,minWidth:60}}>
          <div style={{width:10,height:10,borderRadius:"50%",background:i<=activeIndex?D.gold:D.divider,flexShrink:0}}/>
          <span style={{fontSize:"0.6rem",color:i<=activeIndex?D.text:D.textFaint,fontWeight:i<=activeIndex?800:600,textAlign:"center"}}>{step.label}</span>
        </div>
        {i<DELIVERY_STEPS.length-1&&<div style={{flex:1,height:2,background:i<activeIndex?D.gold:D.divider,margin:"5px 4px 0"}}/>}
      </div>
    ))}
  </div>;
}

// GET /api/orders/ is NOT paginated (unlike most staff moderation-queue
// endpoints elsewhere in App.jsx) — reads the array directly, not
// data?.results. Read-only: no customer-side actions, the delivery stepper
// is only rendered for a paid order (delivery_status is otherwise still
// "processing" by default but meaningless until payment clears). `searchQuery`
// filters client-side by order id or an item's listing_name (see
// ACCOUNT_SEARCHABLE_TABS above).
function OrdersDeliveryTab({ searchQuery }) {
  const { data, isLoading, isError } = useOrders();
  const orders = data || [];
  const q = (searchQuery||"").trim().toLowerCase();
  const filtered = q
    ? orders.filter(o => String(o.id).includes(q) || (o.items||[]).some(it=>it.listing_name?.toLowerCase().includes(q)))
    : orders;

  if (isLoading) return <div style={{color:D.textDim,fontSize:"0.8rem"}}>Loading…</div>;
  if (isError) return <div style={{color:D.red,fontSize:"0.8rem"}}>Could not load your orders.</div>;
  if (orders.length===0) return <div style={{color:D.textDim,fontSize:"0.8rem"}}>No orders yet.</div>;
  if (filtered.length===0) return <div style={{color:D.textDim,fontSize:"0.8rem"}}>No orders match "{searchQuery}".</div>;

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    {filtered.map(o=>{
      const statusMeta = ORDER_STATUS_META[o.status]||{label:o.status,color:D.textDim};
      return (
      <div key={o.id} style={{...glassCard,padding:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={{color:D.text,fontWeight:800,fontSize:"0.85rem"}}>Order #{o.id}</div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{color:D.textDim,fontSize:"0.7rem"}}>{o.placed_at?.slice(0,10)}</span>
            <span style={{background:`${statusMeta.color}22`,color:statusMeta.color,borderRadius:20,padding:"2px 10px",fontSize:"0.65rem",fontWeight:700}}>{statusMeta.label}</span>
          </div>
        </div>
        <div style={{marginTop:10}}>
          {(o.items||[]).map(it=>(
            <div key={it.id} style={{display:"flex",justifyContent:"space-between",fontSize:"0.76rem",color:D.textDim,padding:"3px 0"}}>
              <span>{it.listing_name} × {it.quantity}</span>
              <span>GHS {it.line_total}</span>
            </div>
          ))}
        </div>
        <div style={{marginTop:8,color:D.text,fontWeight:800,fontSize:"0.8rem"}}>Total: GHS {o.total_amount}</div>
        {o.status==="paid" && <DeliveryStepper status={o.delivery_status}/>}
      </div>
      );
    })}
  </div>;
}

// Reuses FavDrawerItem (also module-top-level in this file) exactly as
// FavsDrawer does, just without the drawer's fixed-position overlay chrome —
// a plain list in this tab's content column instead. Same empty-state copy
// as FavsDrawer's. The inner list keeps its own light card background (same
// look FavsDrawer itself already relies on) — a light content card sitting on
// this panel's dark shell is a normal, established look elsewhere in the app.
function SavedBusinessesTab({ favourites, toggleFav }) {
  return <div>
    {favourites.length===0 && <div style={{padding:"20px",textAlign:"center",color:D.textFaint,fontSize:"0.78rem"}}>No saved businesses yet.<br/>Tap ❤️ on any listing to save it.</div>}
    {favourites.length>0 && <div style={{background:"white",borderRadius:16,overflow:"hidden",maxWidth:420,boxShadow:"0 4px 24px rgba(0,0,0,0.35)"}}>
      {favourites.map(id=><FavDrawerItem key={id} id={id} onRemove={toggleFav}/>)}
    </div>}
  </div>;
}

// Mounts the same self-contained EventSubmissionPanel used on the public
// Events page (form + "My Events" list + ticket management) — an organizer
// submits and manages events straight from their account. Its own hardcoded
// always-dark styling now matches this panel's always-dark shell exactly
// (previously a known mismatch against UserPanel's old light/dark toggle,
// resolved by dropping that toggle).
function MyEventsTab({ user, categories, zones }) {
  return <EventSubmissionPanel user={user} categories={categories} zones={zones} PaymentComponent={MoMoPayment}/>;
}

// Full-width, D-styled ticket list — replaces the old MyTicketsDrawer overlay
// mount (a light-styled fixed-position drawer, mismatched against this
// panel's dark shell; frontend/components/MyTicketsDrawer.jsx was deleted
// once this became its only caller's replacement). Status badge derivation
// mirrors that component's own ticketStatus() exactly (TicketSerializer has
// no single status field): refunded takes priority, then delivered, then the
// raw escrow_status. `searchQuery` filters client-side by event name or
// ticket code (see ACCOUNT_SEARCHABLE_TABS above).
function accountTicketStatus(t) {
  if (t.refunded_at) return { label: "Refunded", color: D.red };
  if (t.delivered_at) return { label: "Delivered", color: D.green };
  if (t.escrow_status === "released") return { label: "Released", color: D.green };
  return { label: "Held", color: D.gold };
}

function TicketsTab({ searchQuery }) {
  const { data, isLoading, isError, refetch } = useMyTickets();
  const [copiedId, setCopiedId] = useState(null);
  const tickets = data || [];
  const q = (searchQuery||"").trim().toLowerCase();
  const filtered = q
    ? tickets.filter(t => t.event?.name?.toLowerCase().includes(q) || t.code?.toLowerCase().includes(q))
    : tickets;

  const copyCode = (t) => {
    navigator.clipboard?.writeText(t.code);
    setCopiedId(t.id);
    setTimeout(()=>setCopiedId(cur=>cur===t.id?null:cur),1500);
  };

  if (isLoading) return <div style={{color:D.textDim,fontSize:"0.8rem"}}>Loading your tickets…</div>;
  if (isError) return <div style={{color:D.red,fontSize:"0.8rem"}}>Could not load your tickets. <button onClick={()=>refetch()} style={{marginLeft:8,background:"none",border:`1px solid ${D.red}`,color:D.red,borderRadius:20,padding:"3px 12px",fontSize:"0.7rem",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Retry</button></div>;
  if (tickets.length===0) return <div style={{color:D.textDim,fontSize:"0.8rem"}}>You haven't bought any tickets yet.<br/>Buy tickets from an event's page to see them here.</div>;
  if (filtered.length===0) return <div style={{color:D.textDim,fontSize:"0.8rem"}}>No tickets match "{searchQuery}".</div>;

  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    {filtered.map(t=>{
      const status = accountTicketStatus(t);
      return (
        <div key={t.id} style={{...glassCard,padding:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
            <div>
              <div style={{fontWeight:800,fontSize:"0.82rem",color:D.text}}>{t.event?.name}</div>
              <div style={{fontSize:"0.68rem",color:D.textFaint}}>{formatEventDate(t.event?.event_date)}</div>
              <div style={{fontSize:"0.74rem",color:D.textDim,marginTop:3}}>{t.ticket_type?.name} · GHS {t.price}</div>
            </div>
            <span style={{background:`${status.color}22`,color:status.color,borderRadius:20,padding:"2px 10px",fontSize:"0.65rem",fontWeight:800,whiteSpace:"nowrap"}}>{status.label}</span>
          </div>
          <div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontFamily:"monospace",fontSize:"0.8rem",fontWeight:800,color:D.text,background:D.panelBg2,borderRadius:8,padding:"4px 10px"}}>{t.code}</span>
            <button onClick={()=>copyCode(t)} style={{background:"none",border:`1px solid ${D.cardBorderStrong}`,color:D.gold,borderRadius:20,padding:"3px 11px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {copiedId===t.id ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      );
    })}
  </div>;
}

function NotificationToggleRow({ label, checked, onToggle, disabled }) {
  return <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0"}}>
    <span style={{color:D.text,fontSize:"0.78rem"}}>{label}</span>
    <button
      onClick={onToggle}
      disabled={disabled}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      style={{width:40,height:22,borderRadius:20,border:"none",cursor:disabled?"wait":"pointer",background:checked?D.gold:D.divider,position:"relative",flexShrink:0,padding:0}}
    >
      <span style={{position:"absolute",top:2,left:checked?20:2,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left .15s ease"}}/>
    </button>
  </div>;
}

// Account type/id + the existing app-wide language toggle (lang/setLang,
// threaded down from the AshantiHub root — not a new preference, reuses what
// already exists) + real, persisted notification-preference toggles (own
// useMyCustomerProfile() query, same "component owns its data" convention as
// AccountProfileCard — PATCHed via the same auth.updateProfile() the Profile
// tab uses, since email_notifications_enabled/sms_notifications_enabled are
// writable CustomerProfileSerializer fields) + Sign Out. These toggles are
// honest about their own limit: there's still no email/SMS transport
// anywhere in this app to actually honor them (see AccountProfileCard.tsx's
// recovery-code notes) — the preference itself is real and saved, delivery
// is future work.
function SettingsTab({ user, auth, lang, setLang, onSignOut }) {
  const { data: profile, refetch } = useMyCustomerProfile();
  const [busyField, setBusyField] = useState(null);

  const toggleNotif = async (field) => {
    if (!profile) return;
    setBusyField(field);
    try {
      await auth.updateProfile({ [field]: !profile[field] });
      await refetch();
    } finally {
      setBusyField(null);
    }
  };

  return <div style={{display:"flex",flexDirection:"column",gap:16,maxWidth:460}}>
    <div style={{...glassCard,padding:18}}>
      <div style={{fontWeight:800,color:D.text,fontSize:"0.85rem",marginBottom:12}}>Account</div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.78rem",padding:"6px 0",borderBottom:`1px solid ${D.divider}`}}>
        <span style={{color:D.textDim}}>Account type</span>
        <span style={{color:D.text,fontWeight:700}}>Customer</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.78rem",padding:"6px 0",borderBottom:`1px solid ${D.divider}`}}>
        <span style={{color:D.textDim}}>Account ID</span>
        <span style={{color:D.text,fontWeight:700}}>#{user?.id}</span>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:"0.78rem",padding:"6px 0"}}>
        <span style={{color:D.textDim}}>Email</span>
        <span style={{color:D.text,fontWeight:700}}>{user?.email||"Not set"}</span>
      </div>
    </div>

    <div style={{...glassCard,padding:18}}>
      <div style={{fontWeight:800,color:D.text,fontSize:"0.85rem",marginBottom:10}}>Language</div>
      <div style={{display:"flex",gap:8}}>
        {[{id:"en",label:"English"},{id:"tw",label:"Twi"}].map(l=>(
          <button key={l.id} onClick={()=>setLang?.(l.id)} style={{background:lang===l.id?D.goldSoft:"none",border:`1px solid ${lang===l.id?D.cardBorderStrong:D.divider}`,color:lang===l.id?D.gold:D.textDim,borderRadius:20,padding:"6px 16px",fontSize:"0.76rem",fontWeight:lang===l.id?800:600,cursor:"pointer",fontFamily:"inherit"}}>{l.label}</button>
        ))}
      </div>
    </div>

    <div style={{...glassCard,padding:18}}>
      <div style={{fontWeight:800,color:D.text,fontSize:"0.85rem",marginBottom:2}}>Notification preferences</div>
      {!profile ? (
        <div style={{color:D.textFaint,fontSize:"0.76rem",marginTop:8}}>Loading…</div>
      ) : (
        <div style={{marginTop:6}}>
          <NotificationToggleRow label="Email notifications" checked={!!profile.email_notifications_enabled} onToggle={()=>toggleNotif("email_notifications_enabled")} disabled={busyField==="email_notifications_enabled"}/>
          <NotificationToggleRow label="SMS notifications" checked={!!profile.sms_notifications_enabled} onToggle={()=>toggleNotif("sms_notifications_enabled")} disabled={busyField==="sms_notifications_enabled"}/>
        </div>
      )}
    </div>

    <div style={{...glassCard,padding:18}}>
      <div style={{fontWeight:800,color:D.text,fontSize:"0.85rem",marginBottom:10}}>Session</div>
      <button onClick={onSignOut} style={{background:"none",border:`1px solid ${D.red}`,color:D.red,borderRadius:20,padding:"8px 20px",fontSize:"0.78rem",fontWeight:800,cursor:"pointer",fontFamily:"inherit"}}>🚪 Sign Out</button>
    </div>
  </div>;
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
  // Staff onboarding + account-recovery work: two more standalone pages,
  // each rendered as its own early return below (same convention as
  // showRegistrationFlow/isAdmin/showAccount) rather than living inside the
  // normal page==="..." JSX switch, since neither needs the surrounding
  // Navbar/Footer chrome.
  "/staff/activate": "staff-activate",
  "/reset-password": "reset-password",
  // Hubtel integration (docs/HUBTEL_INTEGRATION.md, plan Workstream E) — the
  // page a customer/business owner lands back on after Hubtel's hosted
  // checkout. Same "standalone early return, no Navbar/Footer chrome"
  // convention as the two staff/reset-password pages above; unexercised
  // until real Hubtel credentials exist (payments_provider stays
  // "simulated" until then, so nothing ever redirects here today), but
  // built now per the launch plan.
  "/payment/return": "payment-return",
};
const PAGE_TO_PATH = {
  home: "/",
  business: "/business",
  events: "/events",
  about: "/about",
  contact: "/contact",
  register: "/register",
  "staff-activate": "/staff/activate",
  "reset-password": "/reset-password",
  "payment-return": "/payment/return",
};
// Full-page dashboard "routes" (isAdmin/showBizDash-style early returns) that
// now have real URLs too. Same two-map convention as PATH_TO_PAGE/
// PAGE_TO_PATH above, just keyed by the boolean flag name instead of `page`.
const DASH_PATH_TO_FLAG = {
  "/business-dashboard": "showBizDash",
  "/payments": "showPayments",
  "/credit": "showCredit",
  "/my-account": "showAccount",
};
const FLAG_TO_DASH_PATH = {
  showBizDash: "/business-dashboard",
  showPayments: "/payments",
  showCredit: "/credit",
  showAccount: "/my-account",
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
  const user=auth.user ? {fullName:auth.user.full_name,accountType:auth.user.account_type,id:auth.user.id,registrationStep:auth.user.registration_step,kycStatus:auth.user.kyc_status,kycRejectionReason:auth.user.kyc_rejection_reason,avatar:auth.user.avatar,email:auth.user.email,phone:auth.user.phone} : null;
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
  const showAccount = location.pathname === FLAG_TO_DASH_PATH.showAccount;
  const setShowAccount = (val) => {
    const path = val ? FLAG_TO_DASH_PATH.showAccount : "/";
    if (val ? !showAccount : showAccount) navigate(path);
  };
  const [isAdmin,setIsAdmin]=useState(false);
  const [adminClicks,setAdminClicks]=useState(0);
  const [favourites,setFavourites]=useState([]);
  const [showFavs,setShowFavs]=useState(false);
  const [showCart,setShowCart]=useState(false);
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

  // Unread-messages badge count for ChatLauncher — real `messaging` app data
  // (see MessagingCenter's notes on needsCustomerAttention above) rather
  // than the old MOCK_CONVERSATIONS. Same query key as MessagingCenter's own
  // useMyConversations() call, so React Query shares the cache instead of
  // double-fetching once the messaging modal is actually opened. Must be
  // called here, alongside useCart above — not further down near where
  // unreadMessages is actually computed — because several early `return`s
  // (showRegistrationFlow/isAdmin/showAccount/showBizDash.../isLoading/
  // show404, below) sit between here and there; a hook call placed after
  // any of them would violate the rules of hooks (it wouldn't run on every
  // render), which is exactly what happened here initially — React's
  // "Rendered more hooks than during the previous render" error, caught by
  // App.routing.test.jsx's route-switching tests exercising both an
  // early-return path and a normal-render path across renders.
  //
  // Gated on the account types the endpoint actually admits, not on merely
  // being signed in — same reason as MessagingCenter's own call above, and
  // the same convention as useCart(isCustomer) beside it. Because this sits
  // above the isAdmin early return, a !!user gate fired this (and its 3
  // default React Query retries) on every staff dashboard load, for an
  // endpoint that 403s a staff session by design.
  const { data: myConversationsData } = useMyConversations(isCustomer || user?.accountType === "business_owner");

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

  // The single post-auth-success handler every auth surface funnels into —
  // AuthModal's login/signup (below) and now StaffActivatePage's activation
  // (staff onboarding work) both hand their result here rather than each
  // separately deciding whether to flip isAdmin, so a staff activation
  // behaves identically to a staff login.
  const handleAuthSuccess=(result)=>{setAuthModal(null);if(result.account_type==="staff"){setIsAdmin(true);}};

  const showRegistrationFlow = (page==="register" && !user) ||
    (user?.accountType==="business_owner" && user.registrationStep && user.registrationStep!=="complete");
  if(showRegistrationFlow) return <BusinessRegistrationFlow user={user} auth={auth} initialStep={user?.registrationStep} setPage={setPage} setShowBizDash={setShowBizDash}/>;

  if(isAdmin) return <StaffDashboard auth={auth} onExit={()=>setIsAdmin(false)}/>;
  if(showAccount) return <UserPanel onExit={()=>setShowAccount(false)} user={user} auth={auth} favourites={favourites} toggleFav={toggleFav} lang={lang} setLang={setLang}/>;
  if(showBizDash||showPayments||showCredit) return <BusinessCommandCenter
    initialTab={showPayments?"payments":showCredit?"credit":"analytics"}
    onExit={()=>{setShowBizDash(false);setShowPayments(false);setShowCredit(false);}}
    user={user} auth={auth} PaymentComponent={MoMoPayment}/>;
  // Staff onboarding + account-recovery work — two more standalone early
  // returns, same convention as showAccount/showBizDash above.
  if(page==="staff-activate") return <StaffActivatePage auth={auth} onSuccess={handleAuthSuccess}/>;
  if(page==="reset-password") return <ResetPasswordPage auth={auth} setPage={setPage} setAuthModal={setAuthModal}/>;
  if(page==="payment-return") return <PaymentReturnPage setPage={setPage}/>;
  if(isLoading) return <LoadingScreen/>;
  if(show404) return <NotFoundPage onHome={()=>setPage("home")}/>;

  const activeCatObj=categories?.find(c=>c.slug===filters.category);

  // Category strip grouping for the Business tab — see groupCategoriesByKind above.
  const {productCategories,serviceCategories}=groupCategoriesByKind(categories);

  const unreadMessages = (myConversationsData || []).filter(needsCustomerAttention).length;

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
      {authModal&&<AuthModal authState={authModal} auth={auth} onClose={()=>setAuthModal(null)} onSuccess={handleAuthSuccess}/>}
      {showMessaging&&<MessagingCenter user={user} onClose={()=>{setShowMessaging(false);setMessagingBusiness(null);}} initialBusiness={messagingBusiness} onRequestSignIn={()=>setAuthModal("login")}/>}
      {showNotifs&&<NotificationsPanel user={user} onClose={()=>setShowNotifs(false)}/>}
      {showFavs&&<FavsDrawer/>}
      {showCart&&isCustomer&&<CartDrawer user={user} currency={currency} onClose={()=>setShowCart(false)} PaymentComponent={MoMoPayment}/>}
      {showReferral&&<ReferralModal user={user} onClose={()=>setShowReferral(false)}/>}
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
              are all gone — Saved businesses are reachable via UserPanel's
              existing "❤️ Saved Businesses" tab instead). On desktop the
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
              onMessage={(biz)=>{setMessagingBusiness(biz);setShowMessaging(true);}}
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
                      {listings.map(item=><Card key={item.id} item={item} accentColor={activeCatObj?.color} user={user} favourites={favourites} onFavourite={toggleFav} currency={currency} onMessage={(biz)=>{setMessagingBusiness(biz);setShowMessaging(true);}} onOpen={(id)=>setSelectedListingId(id)}/>)}
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
            <EventDetailPage id={selectedEventId} onBack={()=>setSelectedEventId(null)} user={user} PaymentComponent={MoMoPayment}/>
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
      {page==="about"&&(<>
        <AboutPage/>
        <AboutTestimonialsSection/>
        <AboutFaqSection/>
      </>)}

      {page==="about"&&(
        <AboutCtaBand user={user} onCreateAccount={()=>setAuthModal("signup")} onRegister={()=>setPage("register")}/>
      )}

      {/* Contact page */}
      {page==="contact"&&(
        <ContactPage user={user} onCreateAccount={()=>setAuthModal("signup")} WhatsAppButton={WABtn}/>
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

      {/* Floating chat launcher — opens MessagingCenter (real, DB-backed
          backend.messaging support chat) as its default small bottom-right
          widget (embedded=false). */}
      <ChatLauncher
        unreadMessages={unreadMessages}
        onOpen={() => setShowMessaging(true)}
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
