import { useEffect, useRef, useState } from "react";
import { C } from "../theme.js";
import logoIcon from "../assets/logo/logo-icon.png";

// ─── Navbar ────────────────────────────────────────────────────────────────
// Same "hybrid" core-row + "More" popover + mobile-hamburger structure as
// before (nothing was removed from the app, see MoreActions below) —
// restyled to a glass/blur look over the new full-viewport home Hero, and
// solidifying to the original dark gradient once scrolled past it or on any
// non-home page (which has no dark hero to blend into). "Business" is
// promoted out of the "More" popover into the always-visible core row per
// the redesign brief: Home, Business, Events, About, Contact.
const NAV_BREAKPOINT = 760;
const SOLIDIFY_SCROLL_Y = 60;

const NAV_ITEMS = [
  { id: "home", icon: "🏠", label: "Home", type: "page" },
  { id: "business", icon: "🏪", label: "Business", type: "biz" },
  { id: "events", icon: "🥁", label: "Events", type: "page" },
  { id: "about", icon: "ℹ️", label: "About", type: "page" },
  { id: "contact", icon: "✉️", label: "Contact", type: "page" },
];

export default function Navbar({
  page, setPage,
  lang, setLang,
  currency, setCurrency,
  user, auth,
  handleLogoClick,
  setAuthModal,
  setShowNotifs,
  setShowMessaging,
  setShowFavs,
  favourites,
  unreadMessages,
  setShowBizDash,
  setShowPayments,
  T,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const moreRef = useRef(null);

  const act = (fn) => (...args) => { fn(...args); setMenuOpen(false); setMoreOpen(false); };

  useEffect(() => {
    if (!moreOpen) return;
    const onClick = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [moreOpen]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SOLIDIFY_SCROLL_Y);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const transparent = page === "home" && !scrolled;

  const CoreActions = () => (
    <>
      <button onClick={act(() => setLang(l => l === "en" ? "tw" : "en"))} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:20,padding:"4px 8px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>
        {lang === "en" ? "🇬🇭 Twi" : "🇬🇧 EN"}
      </button>
      {NAV_ITEMS.map(({ id, icon, label, type }) => {
        const active = type === "page" && page === id;
        return (
          <button key={id} onClick={act(() => type === "biz" ? setShowBizDash(true) : setPage(id))} style={{background:active?C.gold:"transparent",color:active?C.black:C.lightGold,border:`1px solid ${active?C.gold:"#ffffff33"}`,borderRadius:20,padding:"4px 9px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>
            {icon} {label}
          </button>
        );
      })}
      <button onClick={act(() => setShowNotifs(n => !n))} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.85rem",position:"relative"}}>
        🔔
        {user && <span style={{position:"absolute",top:-2,right:-2,background:C.kente1,borderRadius:"50%",width:8,height:8}}/>}
      </button>
      {user ? (
        <button onClick={act(() => setPage("profile"))} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"5px 10px",fontSize:"0.68rem",fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
          <span style={{background:C.darkBrown,color:C.gold,borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"0.6rem",fontWeight:900}}>{user.fullName?.[0]?.toUpperCase() || "U"}</span>
          {user.fullName?.split(" ")[0]}
          <span onClick={(e) => { e.stopPropagation(); auth.logout(); setMenuOpen(false); }} style={{marginLeft:6,opacity:0.7,cursor:"pointer",fontSize:"0.68rem"}} title="Sign out">⏻</span>
        </button>
      ) : (
        <>
          <button onClick={act(() => setAuthModal("login"))} style={{background:"transparent",color:C.lightGold,border:"1px solid #ffffff33",borderRadius:20,padding:"5px 12px",fontSize:"0.68rem",fontWeight:700,cursor:"pointer"}}>{T.login}</button>
          <button onClick={act(() => setAuthModal("signup"))} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"5px 12px",fontSize:"0.68rem",fontWeight:900,cursor:"pointer"}}>{T.signup}</button>
        </>
      )}
    </>
  );

  const MoreActions = ({ stacked = false }) => (
    <>
      <select value={currency} onChange={e => { setCurrency(e.target.value); setMenuOpen(false); setMoreOpen(false); }} style={{background:stacked?"rgba(255,255,255,0.1)":"#fff",color:stacked?"white":C.darkBrown,border:`1px solid ${stacked?"rgba(255,255,255,0.2)":"#ddd"}`,borderRadius:20,padding:"4px 8px",fontSize:"0.7rem",cursor:"pointer",outline:"none",fontFamily:"inherit",width:stacked?"auto":"100%"}}>
        <option value="GHS">GHS 🇬🇭</option>
        <option value="USD">USD 🇺🇸</option>
        <option value="GBP">GBP 🇬🇧</option>
        <option value="EUR">EUR 🇪🇺</option>
      </select>
      <button onClick={act(() => { setShowMessaging(true); if (!user) setAuthModal("signup"); })} style={moreBtnStyle(stacked)}>
        💬 <span>Messages</span>
        {unreadMessages > 0 && <span style={pillStyle}>{unreadMessages}</span>}
      </button>
      <button onClick={act(() => setShowFavs(f => !f))} style={moreBtnStyle(stacked)}>
        ❤️ <span>Saved</span>
        {favourites.length > 0 && <span style={pillStyle}>{favourites.length}</span>}
      </button>
      <button onClick={act(() => setShowPayments(true))} style={moreBtnStyle(stacked)}>💳 <span>Payments</span></button>
    </>
  );

  return (
    <div style={{
      background: transparent ? "rgba(12,8,4,0.32)" : `linear-gradient(135deg,${C.darkBrown} 0%,${C.black} 50%,${C.kente3} 100%)`,
      backdropFilter: transparent ? "blur(14px)" : "none",
      WebkitBackdropFilter: transparent ? "blur(14px)" : "none",
      borderBottom: transparent ? "1px solid rgba(255,255,255,0.08)" : "none",
      padding: "0 16px", position: "sticky", top: 0, zIndex: 100,
      boxShadow: "0 2px 20px rgba(0,0,0,0.4)",
      transition: "background 0.3s ease, backdrop-filter 0.3s ease",
    }}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
      <div style={{maxWidth:960,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:60,paddingTop:4}}>
        <div style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={handleLogoClick}>
          <img src={logoIcon} alt="AshantiHub" style={{height:40,width:"auto",display:"block"}}/>
          <div>
            <div style={{color:C.gold,fontWeight:900,fontSize:"1rem",letterSpacing:1,lineHeight:1}}>AshantiHub</div>
            <div style={{color:C.lightGold,fontSize:"0.52rem",letterSpacing:2,opacity:0.8}}>THE MARKETPLACE OF ASHANTI</div>
          </div>
        </div>

        <div className="ah-navbar-actions" style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
          <CoreActions/>
          <div ref={moreRef} style={{position:"relative"}}>
            <button onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen} style={{background:"transparent",color:C.lightGold,border:"1px solid #ffffff33",borderRadius:20,padding:"4px 9px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>
              ⋯ More
            </button>
            {moreOpen && (
              <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,background:"white",borderRadius:14,boxShadow:"0 10px 40px rgba(0,0,0,0.25)",padding:10,display:"flex",flexDirection:"column",gap:8,minWidth:190,zIndex:200}}>
                <MoreActions/>
              </div>
            )}
          </div>
        </div>

        <button
          className="ah-navbar-hamburger"
          onClick={() => setMenuOpen(o => !o)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          style={{display:"none",background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,width:34,height:34,alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"1.05rem",flexShrink:0}}
        >
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>

      {menuOpen && (
        <div className="ah-navbar-mobile-menu" style={{maxWidth:960,margin:"0 auto",display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",padding:"10px 0 16px",borderTop:"1px solid rgba(255,255,255,0.12)"}}>
          <CoreActions/>
          <div style={{width:"100%",borderTop:"1px dashed rgba(255,255,255,0.15)",margin:"4px 0"}}/>
          <MoreActions stacked/>
        </div>
      )}

      <style>{`
        @media (max-width: ${NAV_BREAKPOINT}px) {
          .ah-navbar-actions { display: none !important; }
          .ah-navbar-hamburger { display: flex !important; }
        }
        @media (min-width: ${NAV_BREAKPOINT + 1}px) {
          .ah-navbar-mobile-menu { display: none !important; }
        }
      `}</style>
    </div>
  );
}

const moreBtnStyle = (stacked) => ({
  background: stacked ? "rgba(255,255,255,0.1)" : "#f6f6f6",
  color: stacked ? "white" : C.darkBrown,
  border: `1px solid ${stacked ? "rgba(255,255,255,0.2)" : "#e5e5e5"}`,
  borderRadius: 20,
  padding: "6px 10px",
  fontSize: "0.72rem",
  fontWeight: 700,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 6,
  position: "relative",
  width: stacked ? "auto" : "100%",
  justifyContent: stacked ? "center" : "flex-start",
});

const pillStyle = {
  background: C.kente1,
  color: "white",
  borderRadius: "50%",
  minWidth: 16,
  height: 16,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "0.55rem",
  fontWeight: 900,
  padding: "0 3px",
};
