import { useState } from "react";
import { C } from "../theme.js";
import Flag from "./Flag.jsx";

// ─── Navbar ────────────────────────────────────────────────────────────────
// Extracted from the inline `Header` closure that used to live inside
// `AshantiHub` (App.jsx). App.jsx continues to own all the state this
// component acts on/reflects — everything below is a prop.
//
// Adds a hamburger/mobile menu for narrow viewports: below `NAV_BREAKPOINT`
// the desktop action row (`.ah-navbar-actions`) is hidden in favour of a
// hamburger toggle (`.ah-navbar-hamburger`) that reveals a stacked dropdown
// of the same actions. This follows the same "local <style> tag" convention
// the app already uses for one-off @keyframes (see LoadingScreen), just
// extended to a @media query — no CSS modules/framework introduced.
const NAV_BREAKPOINT = 760;

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

  // Wraps an action so picking it from the mobile dropdown also closes the
  // dropdown; harmless no-op when triggered from the always-open desktop row.
  const act = (fn) => (...args) => { fn(...args); setMenuOpen(false); };

  const Actions = () => (
    <>
      {/* Language */}
      <button onClick={act(() => setLang(l => l === "en" ? "tw" : "en"))} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:20,padding:"4px 8px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>
        {lang === "en" ? "🇬🇭 Twi" : "🇬🇧 EN"}
      </button>
      {/* Currency */}
      <select value={currency} onChange={e => { setCurrency(e.target.value); setMenuOpen(false); }} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:20,padding:"4px 8px",fontSize:"0.62rem",cursor:"pointer",outline:"none",fontFamily:"inherit"}}>
        <option value="GHS">GHS 🇬🇭</option>
        <option value="USD">USD 🇺🇸</option>
        <option value="GBP">GBP 🇬🇧</option>
        <option value="EUR">EUR 🇪🇺</option>
      </select>
      {/* Nav */}
      {["home", "events", "about"].map(p => (
        <button key={p} onClick={act(() => setPage(p))} style={{background:page===p?C.gold:"transparent",color:page===p?C.black:C.lightGold,border:`1px solid ${page===p?C.gold:"#ffffff33"}`,borderRadius:20,padding:"4px 9px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>
          {p === "home" ? "🏠" : p === "events" ? "🥁" : "ℹ️"} {p[0].toUpperCase() + p.slice(1)}
        </button>
      ))}
      {/* Notifications */}
      <button onClick={act(() => setShowNotifs(n => !n))} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.85rem",position:"relative"}}>
        🔔
        {user && <span style={{position:"absolute",top:-2,right:-2,background:C.kente1,borderRadius:"50%",width:8,height:8}}/>}
      </button>
      {/* Messages */}
      <button onClick={act(() => { setShowMessaging(true); if (!user) setAuthModal("signup"); })} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.85rem",position:"relative"}}>
        💬
        {unreadMessages > 0 && <span style={{position:"absolute",top:-3,right:-3,background:C.kente1,borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.52rem",fontWeight:900,color:"white"}}>{unreadMessages}</span>}
      </button>
      {/* Favourites */}
      <button onClick={act(() => setShowFavs(f => !f))} style={{background:"rgba(255,255,255,0.1)",color:"white",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"50%",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"0.85rem",position:"relative"}}>
        ❤️
        {favourites.length > 0 && <span style={{position:"absolute",top:-4,right:-4,background:C.kente1,borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"0.55rem",fontWeight:900,color:"white"}}>{favourites.length}</span>}
      </button>
      {/* User */}
      {user ? (
        <button onClick={act(() => setPage("profile"))} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"5px 10px",fontSize:"0.68rem",fontWeight:900,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
          <span style={{background:C.darkBrown,color:C.gold,borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:"0.6rem",fontWeight:900}}>{user.fullName?.[0]?.toUpperCase() || "U"}</span>
          {user.fullName?.split(" ")[0]}
          <span onClick={(e) => { e.stopPropagation(); auth.logout(); setMenuOpen(false); }} style={{marginLeft:6,opacity:0.7,cursor:"pointer",fontSize:"0.68rem"}} title="Sign out">⏻</span>
        </button>
      ) : (
        <button onClick={act(() => setAuthModal("signup"))} style={{background:C.gold,color:C.darkBrown,border:"none",borderRadius:20,padding:"5px 10px",fontSize:"0.68rem",fontWeight:900,cursor:"pointer"}}>{T.signup.split(" ")[0]} Up</button>
      )}
      <button onClick={act(() => setShowBizDash(true))} style={{background:"transparent",color:C.lightGold,border:"1px solid #ffffff33",borderRadius:20,padding:"4px 9px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>🏪 Biz</button>
      <button onClick={act(() => setShowPayments(true))} style={{background:"transparent",color:C.lightGold,border:"1px solid #ffffff33",borderRadius:20,padding:"4px 9px",fontSize:"0.62rem",fontWeight:700,cursor:"pointer"}}>💳 Pay</button>
    </>
  );

  return (
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

        {/* Desktop action row — hidden below NAV_BREAKPOINT via the <style> block below */}
        <div className="ah-navbar-actions" style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
          <Actions/>
        </div>

        {/* Hamburger toggle — only shown below NAV_BREAKPOINT */}
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

      {/* Mobile dropdown menu — mirrors the desktop action row, stacked vertically */}
      {menuOpen && (
        <div className="ah-navbar-mobile-menu" style={{maxWidth:960,margin:"0 auto",display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",padding:"10px 0 16px",borderTop:"1px solid rgba(255,255,255,0.12)"}}>
          <Actions/>
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
