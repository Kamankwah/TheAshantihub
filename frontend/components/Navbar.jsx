import { useEffect, useState } from "react";
import { C } from "../theme.js";
import logoIcon from "../assets/logo/logo-icon.png";

// ─── Navbar ────────────────────────────────────────────────────────────────
// Three-group layout: logo pinned far left, page nav centered, utility
// actions (language, notifications, auth) pinned far right. Replaces the old
// single-row "core actions + More popover" hybrid — Messages/Saved/Payments/
// currency (formerly in the "More" popover) are dropped from the navbar
// entirely per the redesign brief; Messages stays reachable via the floating
// ChatLauncher, Saved/Payments no longer have a navbar entry point.
// Transparent glass look over the home Hero; per-nav-item hover shows a gold
// glow border (no ambient whole-bar hover effect) via .ah-nav-item:hover.
const NAV_BREAKPOINT = 760;
const SOLIDIFY_SCROLL_Y = 60;

const NAV_ITEMS = [
  { id: "home", label: "Home" },
  { id: "business", label: "Business" },
  { id: "events", label: "Events" },
  { id: "about", label: "About" },
  { id: "contact", label: "Contact" },
];

export default function Navbar({
  page, setPage,
  lang, setLang,
  user, auth,
  handleLogoClick,
  setAuthModal,
  setShowNotifs,
  T,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const act = (fn) => (...args) => { fn(...args); setMenuOpen(false); };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SOLIDIFY_SCROLL_Y);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const transparent = page === "home" && !scrolled;

  const onLogoClick = () => {
    handleLogoClick();
    setPage("home");
    setMenuOpen(false);
  };

  const NavLinks = ({ stacked = false }) => (
    <>
      {NAV_ITEMS.map(({ id, label }) => {
        const active = page === id;
        return (
          <button
            key={id}
            className="ah-nav-item"
            onClick={act(() => setPage(id))}
            style={{
              background: active ? C.gold : "transparent",
              color: active ? C.black : "white",
              border: `1.5px solid ${active ? C.gold : "transparent"}`,
              borderRadius: 24,
              padding: "9px 18px",
              fontSize: "0.9rem",
              fontWeight: 700,
              cursor: "pointer",
              width: stacked ? "100%" : "auto",
              textAlign: stacked ? "left" : "center",
              transition: "border-color 0.2s ease, background 0.2s ease",
            }}
          >
            {label}
          </button>
        );
      })}
    </>
  );

  const UtilityActions = ({ stacked = false }) => (
    <>
      <button onClick={act(() => setLang(l => l === "en" ? "tw" : "en"))} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.25)",borderRadius:24,padding:"8px 14px",fontSize:"0.8rem",fontWeight:700,cursor:"pointer",width:stacked?"100%":"auto"}}>
        {lang === "en" ? "🇬🇭 Twi" : "🇬🇧 EN"}
      </button>
      <button onClick={act(() => setShowNotifs(n => !n))} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.25)",borderRadius:"50%",width:38,height:38,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"1.05rem",position:"relative",flexShrink:0}}>
        🔔
        {user && <span style={{position:"absolute",top:-2,right:-2,background:C.kente1,borderRadius:"50%",width:9,height:9}}/>}
      </button>
      {user ? (
        <button onClick={act(() => setPage("profile"))} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:24,padding:"8px 14px",fontSize:"0.82rem",fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",gap:6,width:stacked?"100%":"auto",justifyContent:stacked?"flex-start":"center"}}>
          <span style={{background:C.darkBrown,color:C.gold,borderRadius:"50%",width:20,height:20,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"0.68rem",fontWeight:900,flexShrink:0}}>{user.fullName?.[0]?.toUpperCase() || "U"}</span>
          {user.fullName?.split(" ")[0]}
          <span onClick={(e) => { e.stopPropagation(); auth.logout(); setMenuOpen(false); }} style={{marginLeft:4,opacity:0.7,cursor:"pointer",fontSize:"0.8rem"}} title="Sign out">⏻</span>
        </button>
      ) : (
        <>
          <button onClick={act(() => setAuthModal("login"))} style={{background:"transparent",color:"white",border:"1.5px solid rgba(255,255,255,0.4)",borderRadius:24,padding:"8px 16px",fontSize:"0.82rem",fontWeight:700,cursor:"pointer",width:stacked?"100%":"auto"}}>{T.login}</button>
          <button onClick={act(() => setAuthModal("signup"))} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:24,padding:"8px 16px",fontSize:"0.82rem",fontWeight:900,cursor:"pointer",width:stacked?"100%":"auto"}}>{T.signup}</button>
        </>
      )}
    </>
  );

  return (
    <div style={{
      background: transparent ? "rgba(12,8,4,0.32)" : `linear-gradient(135deg,${C.darkBrown} 0%,${C.black} 50%,${C.kente3} 100%)`,
      backdropFilter: transparent ? "blur(14px)" : "none",
      WebkitBackdropFilter: transparent ? "blur(14px)" : "none",
      borderBottom: transparent ? "1px solid rgba(255,255,255,0.08)" : "none",
      padding: "0 20px", position: "sticky", top: 0, zIndex: 100,
      boxShadow: "0 2px 20px rgba(0,0,0,0.4)",
      transition: "background 0.3s ease, backdrop-filter 0.3s ease",
    }}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:4,background:`linear-gradient(90deg,${C.ghRed} 33%,${C.ghGold} 33%,${C.ghGold} 66%,${C.ghGreen} 66%)`}}/>
      <div style={{maxWidth:1200,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:72,paddingTop:4,gap:16}}>
        <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",flexShrink:0}} onClick={onLogoClick}>
          <img src={logoIcon} alt="AshantiHub" style={{height:44,width:"auto",display:"block"}}/>
          <div>
            <div style={{color:C.gold,fontWeight:900,fontSize:"1.15rem",letterSpacing:1,lineHeight:1}}>AshantiHub</div>
            <div style={{color:C.lightGold,fontSize:"0.56rem",letterSpacing:2,opacity:0.8}}>THE MARKETPLACE OF ASHANTI</div>
          </div>
        </div>

        <div className="ah-navbar-links" style={{display:"flex",gap:6,alignItems:"center",justifyContent:"center",flex:1}}>
          <NavLinks/>
        </div>

        <div className="ah-navbar-utility" style={{display:"flex",gap:10,alignItems:"center",flexShrink:0}}>
          <UtilityActions/>
        </div>

        <button
          className="ah-navbar-hamburger"
          onClick={() => setMenuOpen(o => !o)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          style={{display:"none",background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:8,width:38,height:38,alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"1.15rem",flexShrink:0}}
        >
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>

      {menuOpen && (
        <div className="ah-navbar-mobile-menu" style={{maxWidth:1200,margin:"0 auto",display:"flex",flexDirection:"column",gap:8,padding:"10px 0 18px",borderTop:"1px solid rgba(255,255,255,0.12)"}}>
          <NavLinks stacked/>
          <div style={{width:"100%",borderTop:"1px dashed rgba(255,255,255,0.15)",margin:"4px 0"}}/>
          <UtilityActions stacked/>
        </div>
      )}

      <style>{`
        .ah-nav-item:hover { border-color: ${C.gold} !important; box-shadow: 0 0 0 3px ${C.gold}22; }
        @media (max-width: ${NAV_BREAKPOINT}px) {
          .ah-navbar-links, .ah-navbar-utility { display: none !important; }
          .ah-navbar-hamburger { display: flex !important; }
        }
        @media (min-width: ${NAV_BREAKPOINT + 1}px) {
          .ah-navbar-mobile-menu { display: none !important; }
        }
      `}</style>
    </div>
  );
}
